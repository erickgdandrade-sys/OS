-- =============================================================================
-- NEXO Studio OS — 0012 Complemento da Fase 2
-- Link público de proposta com aceite registrado, PDFs gerados no servidor,
-- assinatura eletrônica por provedor (webhook) e identidade do estúdio.
-- =============================================================================

alter table public.proposals
  add column client_accepted_at timestamptz,
  add column client_accepted_name text,
  add column client_accept_note text,
  add column pdf_file_id uuid;
alter table public.proposals
  add constraint proposals_pdf_fk foreign key (organization_id, pdf_file_id) references public.files(organization_id, id) on delete set null (pdf_file_id);

alter table public.contracts
  add column signature_status_detail text,
  add column signature_sent_at timestamptz;

-- Links públicos de proposta (mesmo modelo de segurança dos links do portal).
create table public.proposal_links (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  proposal_id     uuid not null,
  token_hash      bytea not null unique,
  expires_at      timestamptz,
  revoked_at      timestamptz,
  last_used_at    timestamptz,
  use_count       int not null default 0,
  created_by      uuid not null default auth.uid() references auth.users(id),
  created_at      timestamptz not null default now(),
  foreign key (organization_id, proposal_id) references public.proposals(organization_id, id) on delete cascade
);
create index idx_proposal_links on public.proposal_links(proposal_id);
alter table public.proposal_links enable row level security;
create policy proposal_links_select on public.proposal_links for select using (public.has_perm(organization_id, 'proposals.write'));
create policy proposal_links_update on public.proposal_links for update
  using (public.has_perm(organization_id, 'proposals.write')) with check (public.has_perm(organization_id, 'proposals.write'));

create or replace function public.create_proposal_link(p_proposal uuid, p_days int default 30)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare pr public.proposals; v_token text;
begin
  select * into pr from public.proposals where id = p_proposal;
  if not found or not public.has_perm(pr.organization_id, 'proposals.write') then raise exception 'forbidden' using errcode = '42501'; end if;
  if pr.status in ('draft', 'rejected', 'expired') then raise exception 'proposal_not_shareable'; end if;
  if p_days is not null and (p_days < 1 or p_days > 180) then raise exception 'invalid_days'; end if;
  v_token := encode(gen_random_bytes(32), 'hex');
  insert into public.proposal_links (organization_id, proposal_id, token_hash, expires_at, created_by)
  values (pr.organization_id, pr.id, digest(v_token, 'sha256'),
          case when p_days is null then null else least(now() + make_interval(days => p_days), (pr.valid_until + 1)::timestamptz) end, auth.uid());
  return v_token;
end $$;

-- Aceite pelo link (chamado só pela Edge Function `proposal-public`, com service role).
-- Registra quem aceitou e avisa a equipe; a aprovação formal (que gera projeto,
-- contrato e parcelas) continua sendo um ato da equipe.
create or replace function public.record_proposal_acceptance(p_link uuid, p_name text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare l public.proposal_links; pr public.proposals;
begin
  select * into l from public.proposal_links where id = p_link;
  if not found or l.revoked_at is not null or (l.expires_at is not null and l.expires_at < now()) then raise exception 'link_expired_or_revoked'; end if;
  select * into pr from public.proposals where id = l.proposal_id for update;
  if pr.status not in ('sent', 'viewed', 'negotiation') then raise exception 'proposal_not_open'; end if;
  if pr.client_accepted_at is not null then raise exception 'already_accepted'; end if;
  if length(trim(coalesce(p_name, ''))) < 3 then raise exception 'name_required'; end if;
  update public.proposals set client_accepted_at = now(), client_accepted_name = trim(p_name), client_accept_note = nullif(trim(p_note), ''),
    status = 'negotiation' where id = pr.id;
  perform public.notify(pr.organization_id, pr.created_by, 'proposal_accepted', 'Cliente aceitou a proposta: ' || pr.title,
    trim(p_name) || coalesce(' — ' || nullif(trim(p_note), ''), ''), '/propostas/' || pr.id);
end $$;

-- Retorno do provedor de assinatura (Edge Function `signature-webhook`, service role).
create or replace function public.mark_contract_signature(p_contract uuid, p_event text, p_detail text default null, p_signed_at timestamptz default null)
returns void language plpgsql security definer set search_path = public as $$
declare c public.contracts;
begin
  select * into c from public.contracts where id = p_contract for update;
  if not found then raise exception 'contract_not_found'; end if;
  perform set_config('nexo.signature_webhook', 'on', true);
  if p_event = 'signed' then
    update public.contracts set status = 'signed', signed_at = coalesce(p_signed_at, now()), signature_status_detail = p_detail where id = c.id;
    perform public.notify(c.organization_id, c.created_by, 'contract_signed', 'Contrato assinado: ' || c.title, p_detail, '/contratos/' || c.id);
  elsif p_event = 'refused' then
    update public.contracts set status = 'in_review', signature_status_detail = coalesce(p_detail, 'Assinatura recusada') where id = c.id;
  elsif p_event = 'progress' then
    update public.contracts set signature_status_detail = p_detail where id = c.id;
  else
    raise exception 'invalid_event';
  end if;
end $$;

-- Marca envio para assinatura (chamado pela Edge Function `signature-send`, com o JWT do usuário).
create or replace function public.mark_contract_sent_for_signature(p_contract uuid, p_provider text, p_envelope text)
returns void language plpgsql security invoker set search_path = public as $$
declare c public.contracts;
begin
  select * into c from public.contracts where id = p_contract for update;
  if not found or not public.has_perm(c.organization_id, 'contracts.write') then raise exception 'forbidden' using errcode = '42501'; end if;
  if c.status <> 'in_review' then raise exception 'contract_not_reviewed'; end if;
  update public.contracts set status = 'sent_for_signature', signature_provider = p_provider, signature_envelope_id = p_envelope,
    signature_sent_at = now(), signature_status_detail = 'Enviado para assinatura' where id = c.id;
end $$;

grant execute on function public.create_proposal_link(uuid, int), public.mark_contract_sent_for_signature(uuid, text, text) to authenticated;
revoke execute on function public.create_proposal_link(uuid, int), public.mark_contract_sent_for_signature(uuid, text, text) from public, anon;
revoke execute on function public.record_proposal_acceptance(uuid, text, text), public.mark_contract_signature(uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.record_proposal_acceptance(uuid, text, text), public.mark_contract_signature(uuid, text, text, timestamptz) to service_role;
