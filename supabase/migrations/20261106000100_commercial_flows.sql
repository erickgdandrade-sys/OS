-- =============================================================================
-- NEXO Studio OS — 0011 Fluxos comerciais (Fase 2)
-- Envio/recusa de proposta, visualização pelo portal, versões de contrato,
-- mudança de etapa no pipeline e notificações comerciais.
-- =============================================================================

-- Envia a proposta: exige itens e validade; congela a data de envio.
create or replace function public.send_proposal(p_proposal uuid)
returns void language plpgsql security invoker set search_path = public as $$
declare pr public.proposals;
begin
  select * into pr from public.proposals where id = p_proposal for update;
  if not found then raise exception 'proposal_not_found'; end if;
  if not public.has_perm(pr.organization_id, 'proposals.write') then raise exception 'forbidden' using errcode = '42501'; end if;
  if pr.status not in ('draft', 'negotiation') then raise exception 'proposal_not_editable'; end if;
  if not exists (select 1 from public.proposal_items where proposal_id = pr.id) then raise exception 'proposal_without_items'; end if;
  if pr.valid_until is null or pr.valid_until < (now() at time zone 'America/Sao_Paulo')::date then raise exception 'proposal_invalid_validity'; end if;
  update public.proposals set status = 'sent', sent_at = coalesce(sent_at, now()) where id = pr.id;
end $$;

-- Recusa (pela equipe, registrando o motivo nas observações).
create or replace function public.reject_proposal(p_proposal uuid, p_reason text default null)
returns void language plpgsql security invoker set search_path = public as $$
declare pr public.proposals;
begin
  select * into pr from public.proposals where id = p_proposal for update;
  if not found then raise exception 'proposal_not_found'; end if;
  if not public.has_perm(pr.organization_id, 'proposals.write') then raise exception 'forbidden' using errcode = '42501'; end if;
  if pr.status in ('approved', 'rejected') then raise exception 'proposal_closed'; end if;
  update public.proposals set status = 'rejected', decided_at = now(),
    notes = concat_ws(E'\n', notes, case when p_reason is not null then 'Motivo da recusa: ' || p_reason end)
  where id = pr.id;
end $$;

-- Cliente abriu a proposta no portal: marca como visualizada e avisa quem criou.
create or replace function public.portal_view_proposal(p_proposal uuid)
returns void language plpgsql security definer set search_path = public as $$
declare pr public.proposals;
begin
  select * into pr from public.proposals where id = p_proposal;
  if not found or not public.is_client_user(pr.client_id) or pr.status = 'draft' then raise exception 'forbidden' using errcode = '42501'; end if;
  if pr.status = 'sent' then
    update public.proposals set status = 'viewed', viewed_at = now() where id = pr.id;
    perform public.notify(pr.organization_id, pr.created_by, 'proposal_viewed', 'Proposta visualizada: ' || pr.title, null, '/propostas/' || pr.id);
  end if;
end $$;

-- Propostas vencidas viram 'expired' (rotina diária, junto de mark_overdue).
create or replace function public.expire_proposals()
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.proposals set status = 'expired'
  where status in ('sent', 'viewed', 'negotiation') and valid_until < (now() at time zone 'America/Sao_Paulo')::date;
  get diagnostics n = row_count;
  return n;
end $$;

-- Variáveis de contrato montadas no servidor, a partir dos dados cadastrados.
create or replace function public.contract_variables(p_contract uuid)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare c public.contracts; cl public.clients; o public.organizations; pr public.proposals; pj public.projects; v jsonb;
begin
  select * into c from public.contracts where id = p_contract;
  if not found then raise exception 'contract_not_found'; end if;
  select * into cl from public.clients where id = c.client_id;
  select * into o from public.organizations where id = c.organization_id;
  select * into pr from public.proposals where id = c.proposal_id;
  select * into pj from public.projects where contract_id = c.id or (c.proposal_id is not null and proposal_id = c.proposal_id) order by created_at limit 1;
  v := jsonb_build_object(
    'nome_cliente', cl.legal_name,
    'cpf_cnpj', case length(cl.document)
        when 11 then regexp_replace(cl.document, '(\d{3})(\d{3})(\d{3})(\d{2})', '\1.\2.\3-\4')
        when 14 then regexp_replace(cl.document, '(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})', '\1.\2.\3/\4-\5') end,
    'endereco_cliente', nullif(concat_ws(', ', cl.address ->> 'street', cl.address ->> 'city', cl.address ->> 'state', cl.address ->> 'zip'), ''),
    'nome_estudio', coalesce(o.legal_name, o.name),
    'documento_estudio', case length(o.document)
        when 14 then regexp_replace(o.document, '(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})', '\1.\2.\3/\4-\5')
        when 11 then regexp_replace(o.document, '(\d{3})(\d{3})(\d{3})(\d{2})', '\1.\2.\3-\4') end,
    'servico_contratado', coalesce(pr.title, pj.name, c.title),
    'escopo', coalesce(pr.scope, pj.scope),
    'entregaveis', pr.deliverables,
    'valor_total', case when coalesce(pr.total, pj.contracted_amount) is not null
        then 'R$ ' || replace(replace(replace(to_char(coalesce(pr.total, pj.contracted_amount), 'FM999G999G990D00'), ',', '#'), '.', ','), '#', '.') end,
    'condicoes_pagamento', case when pr.id is not null then
        pr.installments || 'x' || case when pr.first_due_date is not null then ', primeira parcela em ' || to_char(pr.first_due_date, 'DD/MM/YYYY') else '' end
        || case when pr.terms is not null then '. ' || pr.terms else '' end end,
    'data_inicio', to_char(pj.start_date, 'DD/MM/YYYY'),
    'data_entrega', to_char(pj.due_date, 'DD/MM/YYYY'),
    'numero_revisoes', pr.revisions::text,
    'data_hoje', to_char((now() at time zone 'America/Sao_Paulo')::date, 'DD/MM/YYYY'),
    'cidade_estudio', o.address ->> 'city'
  );
  return (select jsonb_object_agg(key, value) from jsonb_each(v) where value <> 'null'::jsonb);
end $$;

-- Salva nova versão (revisada) do contrato. Versões são imutáveis.
create or replace function public.save_contract_version(p_contract uuid, p_body_html text, p_note text default null)
returns int language plpgsql security invoker set search_path = public as $$
declare c public.contracts; v_next int;
begin
  select * into c from public.contracts where id = p_contract for update;
  if not found then raise exception 'contract_not_found'; end if;
  if not public.has_perm(c.organization_id, 'contracts.write') then raise exception 'forbidden' using errcode = '42501'; end if;
  if c.status in ('signed', 'sent_for_signature', 'cancelled') then raise exception 'contract_locked'; end if;
  if length(coalesce(p_body_html, '')) < 20 then raise exception 'contract_body_too_short'; end if;
  v_next := coalesce((select max(version) from public.contract_versions where contract_id = c.id), 0) + 1;
  insert into public.contract_versions (organization_id, contract_id, version, body_html, variables, note, created_by)
  values (c.organization_id, c.id, v_next, p_body_html, public.contract_variables(c.id), p_note, auth.uid());
  update public.contracts set current_version = v_next where id = c.id;
  return v_next;
end $$;

-- Cria contrato avulso (sem proposta), a partir de modelo, para um cliente.
create or replace function public.create_contract(p_client uuid, p_template uuid, p_title text, p_proposal uuid default null)
returns uuid language plpgsql security invoker set search_path = public as $$
declare v_org uuid; v_body text; v_id uuid;
begin
  select organization_id into v_org from public.clients where id = p_client;
  if v_org is null or not public.has_perm(v_org, 'contracts.write') then raise exception 'forbidden' using errcode = '42501'; end if;
  select body_html into v_body from public.contract_templates where id = p_template and organization_id = v_org;
  if v_body is null then raise exception 'contract_template_not_found'; end if;
  insert into public.contracts (organization_id, client_id, proposal_id, template_id, title, status, created_by, number)
  values (v_org, p_client, p_proposal, p_template, coalesce(nullif(trim(p_title), ''), 'Contrato'), 'draft', auth.uid(), 0) returning id into v_id;
  insert into public.contract_versions (organization_id, contract_id, version, body_html, note, created_by)
  values (v_org, v_id, 1, v_body, 'Criado a partir do modelo', auth.uid());
  return v_id;
end $$;

-- Pipeline: mover oportunidade e registrar a mudança como atividade.
create or replace function public.move_opportunity(p_opportunity uuid, p_stage uuid, p_position double precision default 0, p_lost_reason text default null)
returns void language plpgsql security invoker set search_path = public as $$
declare o public.opportunities; s public.pipeline_stages; old_name text;
begin
  select * into o from public.opportunities where id = p_opportunity for update;
  if not found then raise exception 'opportunity_not_found'; end if;
  select * into s from public.pipeline_stages where id = p_stage and organization_id = o.organization_id;
  if not found then raise exception 'stage_not_found'; end if;
  if s.kind = 'lost' and coalesce(trim(p_lost_reason), '') = '' and o.lost_reason is null then raise exception 'lost_reason_required'; end if;
  select name into old_name from public.pipeline_stages where id = o.stage_id;
  update public.opportunities set stage_id = p_stage, position = p_position,
    lost_reason = case when s.kind = 'lost' then coalesce(nullif(trim(p_lost_reason), ''), lost_reason) else null end
  where id = o.id;
  if o.stage_id <> p_stage then
    insert into public.crm_activities (organization_id, kind, subject, opportunity_id, lead_id, client_id, done_at, created_by)
    values (o.organization_id, 'note', 'Etapa: ' || old_name || ' → ' || s.name, o.id, o.lead_id, o.client_id, now(), auth.uid());
  end if;
end $$;

grant execute on function public.send_proposal(uuid), public.reject_proposal(uuid, text), public.portal_view_proposal(uuid),
  public.contract_variables(uuid), public.save_contract_version(uuid, text, text), public.create_contract(uuid, uuid, text, uuid),
  public.move_opportunity(uuid, uuid, double precision, text) to authenticated;
revoke execute on function public.send_proposal(uuid), public.reject_proposal(uuid, text), public.portal_view_proposal(uuid),
  public.contract_variables(uuid), public.save_contract_version(uuid, text, text), public.create_contract(uuid, uuid, text, uuid),
  public.move_opportunity(uuid, uuid, double precision, text), public.expire_proposals() from public, anon;
revoke execute on function public.expire_proposals() from authenticated;

-- Autor preenchido pelo servidor quando o cliente da API não informa.
alter table public.proposals alter column created_by set default auth.uid();
alter table public.contracts alter column created_by set default auth.uid();
alter table public.clients alter column created_by set default auth.uid();
alter table public.projects alter column created_by set default auth.uid();
alter table public.tasks alter column created_by set default auth.uid();
alter table public.leads alter column owner_id set default auth.uid();
alter table public.opportunities alter column owner_id set default auth.uid();
alter table public.crm_activities alter column created_by set default auth.uid();
alter table public.meetings alter column created_by set default auth.uid();
