-- =============================================================================
-- NEXO Studio OS — 0014 Administrador inicial, cadastro restrito e contrato completo
-- =============================================================================

-- Configurações da instalação (só o servidor lê; nenhum acesso pela API pública).
create table public.platform_settings (
  key   text primary key,
  value text not null
);
alter table public.platform_settings enable row level security;   -- sem políticas: invisível para anon/authenticated
insert into public.platform_settings (key, value) values
  ('bootstrap_admin_email', 'erickgdandrade@gmail.com'),
  ('allow_new_organizations', 'false');
revoke all on public.platform_settings from anon, authenticated;

create or replace function public.platform_setting(p_key text)
returns text language sql stable security definer set search_path = public as $$
  select value from public.platform_settings where key = p_key;
$$;
revoke execute on function public.platform_setting(text) from public, anon, authenticated;

-- Criação de estúdio:
--  • o primeiro só pode ser criado pelo e-mail do administrador inicial;
--  • depois disso, só se a instalação permitir vários estúdios (desligado por padrão).
create or replace function public.create_organization(p_name text, p_slug text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_email text;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if exists (select 1 from public.organization_members where user_id = auth.uid()) then
    raise exception 'already_member' using errcode = '42501';
  end if;
  if exists (select 1 from public.client_users where user_id = auth.uid()) then
    raise exception 'client_account' using errcode = '42501';
  end if;
  select lower(email) into v_email from auth.users where id = auth.uid();
  if not exists (select 1 from public.organizations) then
    if v_email is distinct from lower(public.platform_setting('bootstrap_admin_email')) then
      raise exception 'not_bootstrap_admin' using errcode = '42501';
    end if;
  elsif coalesce(public.platform_setting('allow_new_organizations'), 'false') <> 'true' then
    raise exception 'org_creation_closed' using errcode = '42501';
  end if;
  insert into public.organizations (name, slug, email) values (p_name, lower(p_slug), v_email) returning id into v_org;
  insert into public.organization_members (organization_id, user_id, role, status, joined_at)
  values (v_org, auth.uid(), 'admin', 'active', now());
  perform public.seed_default_role_permissions(v_org);
  return v_org;
end $$;

-- Cadastro de usuários é exclusivo do administrador, mesmo que a matriz tente conceder.
create or replace function public.has_perm(p_org uuid, p_perm text)
returns boolean language sql stable security definer set search_path = public as $$
  with me as (
    select m.role from public.organization_members m
    where m.organization_id = p_org and m.user_id = auth.uid() and m.status = 'active'
  )
  select case
    when not exists (select 1 from me) then false
    when (select role from me) = 'admin' then true
    when p_perm = 'users.manage' then false
    when exists (select 1 from public.member_permissions mp
                 where mp.organization_id = p_org and mp.user_id = auth.uid() and mp.permission = p_perm) then
      (select mp.granted from public.member_permissions mp
       where mp.organization_id = p_org and mp.user_id = auth.uid() and mp.permission = p_perm)
    else exists (select 1 from public.role_permissions rp, me
                 where rp.organization_id = p_org and rp.role = me.role and rp.permission = p_perm)
  end;
$$;
update public.permissions set description = 'Convidar, editar e desativar usuários (exclusivo do administrador)' where key = 'users.manage';
delete from public.role_permissions where permission = 'users.manage';

-- Dados do representante legal do estúdio (usados nos contratos).
alter table public.organizations add column legal_representative jsonb not null default '{}'::jsonb;

-- ---------------------------------------------------------------------------
-- Modelo completo de contrato de prestação de serviços criativos
-- ---------------------------------------------------------------------------
create or replace function public.default_contract_body(p_object text)
returns text language sql immutable as $body$
select
'<h1>Contrato de prestação de serviços</h1>'
'<p>Pelo presente instrumento particular, as partes abaixo qualificadas celebram este contrato de prestação de serviços, que se regerá pelas cláusulas e condições a seguir.</p>'
'<h2>1. Das partes</h2>'
'<p><strong>CONTRATADA:</strong> {{nome_estudio}}, inscrita no CPF/CNPJ sob o nº {{documento_estudio}}, com sede em {{endereco_estudio}}, neste ato representada por {{representante_estudio}}, CPF nº {{cpf_representante_estudio}}, e-mail {{email_estudio}}.</p>'
'<p><strong>CONTRATANTE:</strong> {{nome_cliente}}, inscrito(a) no CPF/CNPJ sob o nº {{cpf_cnpj}}, com endereço em {{endereco_cliente}}, neste ato representado(a) por {{representante_cliente}}, CPF nº {{cpf_representante_cliente}}, e-mail {{email_cliente}}.</p>'
'<h2>2. Do objeto</h2>'
'<p>O presente contrato tem por objeto a prestação, pela CONTRATADA, dos serviços de ' || p_object || ': {{servico_contratado}}.</p>'
'<h2>3. Do escopo e dos entregáveis</h2>'
'<p>3.1. O escopo contratado compreende: {{escopo}}</p>'
'<p>3.2. Serão entregues: {{entregaveis}}</p>'
'<p>3.3. Qualquer serviço não descrito nesta cláusula será considerado fora do escopo e dependerá de orçamento e aceite prévios e por escrito.</p>'
'<h2>4. Dos prazos</h2>'
'<p>4.1. Os serviços terão início em {{data_inicio}}, com entrega final prevista para {{data_entrega}}.</p>'
'<p>4.2. Os prazos ficam suspensos enquanto houver pendência de responsabilidade da CONTRATANTE, como envio de informações, materiais, acessos, aprovações ou pagamentos, e serão prorrogados pelo mesmo período do atraso.</p>'
'<p>4.3. A CONTRATANTE terá até {{prazo_aprovacao}} dias úteis para aprovar ou solicitar ajustes em cada etapa apresentada. Sem manifestação nesse prazo, a etapa será considerada aprovada.</p>'
'<h2>5. Das obrigações da CONTRATADA</h2>'
'<p>5.1. Executar os serviços com qualidade técnica, dentro do escopo e dos prazos acordados;</p>'
'<p>5.2. Manter a CONTRATANTE informada sobre o andamento dos trabalhos, inclusive pelo portal do cliente;</p>'
'<p>5.3. Guardar sigilo sobre as informações recebidas, nos termos da cláusula 12;</p>'
'<p>5.4. Entregar os arquivos finais nos formatos previstos no escopo após a quitação integral.</p>'
'<h2>6. Das obrigações da CONTRATANTE</h2>'
'<p>6.1. Fornecer, nos prazos combinados, as informações, conteúdos, materiais e acessos necessários;</p>'
'<p>6.2. Indicar um responsável para aprovações e comunicações;</p>'
'<p>6.3. Efetuar os pagamentos nas datas acordadas;</p>'
'<p>6.4. Garantir que os materiais fornecidos (textos, imagens, marcas, músicas) não violam direitos de terceiros, respondendo integralmente por eles.</p>'
'<h2>7. Do valor e da forma de pagamento</h2>'
'<p>7.1. Pelos serviços, a CONTRATANTE pagará à CONTRATADA o valor total de {{valor_total}}.</p>'
'<p>7.2. Condições de pagamento: {{condicoes_pagamento}}.</p>'
'<p>7.3. Despesas extraordinárias não previstas no escopo, como impressão, mídia paga, locações, deslocamentos, banco de imagens e taxas de registro, serão previamente orçadas e pagas pela CONTRATANTE.</p>'
'<h2>8. Do atraso no pagamento e do reajuste</h2>'
'<p>8.1. O atraso no pagamento sujeitará a CONTRATANTE a multa de {{multa_atraso}}% sobre o valor em atraso e juros de mora de {{juros_atraso}}% ao mês, calculados pro rata die, além de correção monetária pelo IPCA.</p>'
'<p>8.2. Atrasos superiores a 15 (quinze) dias autorizam a CONTRATADA a suspender os serviços até a regularização, sem prejuízo dos prazos.</p>'
'<p>8.3. Em contratos com duração superior a 12 (doze) meses, os valores serão reajustados anualmente pela variação do IPCA.</p>'
'<h2>9. Das revisões e alterações</h2>'
'<p>9.1. Estão incluídas {{numero_revisoes}} rodada(s) de revisão por etapa. Revisões adicionais ou mudanças de direção após a aprovação de uma etapa serão orçadas à parte.</p>'
'<p>9.2. Alterações de escopo deverão ser formalizadas por escrito, com novo prazo e valor, quando houver.</p>'
'<h2>10. Da propriedade intelectual</h2>'
'<p>10.1. Após a quitação integral, a CONTRATADA cede à CONTRATANTE, em caráter definitivo, os direitos patrimoniais sobre as peças finais aprovadas, para os usos previstos no objeto, nos termos da Lei nº 9.610/1998. Os direitos morais permanecem com os autores.</p>'
'<p>10.2. Estudos, alternativas não aprovadas, arquivos de trabalho e metodologias permanecem de propriedade da CONTRATADA, salvo previsão expressa no escopo.</p>'
'<p>10.3. Fontes tipográficas, imagens de banco e softwares de terceiros seguem as licenças de seus titulares; eventuais licenças adicionais serão adquiridas pela CONTRATANTE.</p>'
'<p>10.4. Quando o objeto incluir criação de nome (naming), a CONTRATADA realizará pesquisa preliminar de anterioridade, sem garantia de registrabilidade. A verificação e o pedido de registro junto ao INPI são de responsabilidade da CONTRATANTE ou de sua assessoria jurídica.</p>'
'<h2>11. Do portfólio</h2>'
'<p>A CONTRATADA poderá divulgar os trabalhos realizados em seu portfólio, site e redes sociais após o lançamento público, salvo pedido de sigilo por escrito da CONTRATANTE.</p>'
'<h2>12. Da confidencialidade</h2>'
'<p>As partes manterão sigilo sobre informações estratégicas, comerciais e técnicas a que tiverem acesso em razão deste contrato, durante sua vigência e por 2 (dois) anos após o seu término.</p>'
'<h2>13. Da proteção de dados pessoais</h2>'
'<p>As partes tratarão os dados pessoais compartilhados exclusivamente para a execução deste contrato, em conformidade com a Lei nº 13.709/2018 (LGPD), adotando medidas de segurança adequadas e comunicando à outra parte qualquer incidente que possa afetar os titulares.</p>'
'<h2>14. Da responsabilidade</h2>'
'<p>A responsabilidade da CONTRATADA por danos diretos decorrentes deste contrato fica limitada ao valor total contratado. Nenhuma das partes responderá por lucros cessantes ou danos indiretos.</p>'
'<h2>15. Da rescisão</h2>'
'<p>15.1. Qualquer das partes poderá rescindir este contrato mediante aviso prévio por escrito de 30 (trinta) dias.</p>'
'<p>15.2. Em caso de rescisão, a CONTRATANTE pagará pelos serviços já executados e pelas despesas já incorridas, proporcionalmente às etapas concluídas ou em andamento.</p>'
'<p>15.3. O descumprimento de qualquer cláusula, não sanado em 10 (dez) dias após notificação, autoriza a rescisão imediata pela parte prejudicada.</p>'
'<h2>16. Do caso fortuito e da força maior</h2>'
'<p>Nenhuma das partes será responsabilizada por atrasos ou falhas decorrentes de caso fortuito ou força maior, nos termos do art. 393 do Código Civil.</p>'
'<h2>17. Das comunicações</h2>'
'<p>As comunicações entre as partes serão feitas pelos e-mails indicados na cláusula 1 e pelo portal do cliente, e terão validade para todos os fins deste contrato.</p>'
'<h2>18. Das disposições gerais</h2>'
'<p>18.1. Este contrato não gera vínculo empregatício, societário ou de exclusividade entre as partes.</p>'
'<p>18.2. A tolerância quanto ao descumprimento de qualquer cláusula não implica renúncia ou novação.</p>'
'<p>18.3. As partes reconhecem a validade da assinatura eletrônica deste instrumento, nos termos da Medida Provisória nº 2.200-2/2001 e da Lei nº 14.063/2020.</p>'
'<h2>19. Do foro</h2>'
'<p>Fica eleito o foro da comarca de {{cidade_foro}} para dirimir quaisquer questões oriundas deste contrato, com renúncia a qualquer outro, por mais privilegiado que seja.</p>'
'<p>E, por estarem de acordo, as partes assinam o presente instrumento.</p>'
'<p>{{cidade_assinatura}}, {{data_hoje}}.</p>'
'<h2>Assinaturas</h2>'
'<p>______________________________________<br>CONTRATADA: {{nome_estudio}}<br>{{representante_estudio}}</p>'
'<p>______________________________________<br>CONTRATANTE: {{nome_cliente}}<br>{{representante_cliente}}</p>'
'<p>Testemunha 1: ______________________ CPF: ______________</p>'
'<p>Testemunha 2: ______________________ CPF: ______________</p>';
$body$;

create or replace function public.seed_complete_contract_templates(p_org uuid)
returns void language sql security definer set search_path = public as $$
  insert into public.contract_templates (organization_id, name, category, body_html)
  select p_org, t.name, t.category::public.project_category, public.default_contract_body(t.obj)
  from (values
    ('Contrato completo — Branding e identidade visual', 'branding', 'branding e identidade visual'),
    ('Contrato completo — Naming', 'naming', 'criação de nome (naming)'),
    ('Contrato completo — Social media (recorrente)', 'social_media', 'gestão de redes sociais, em regime mensal e recorrente'),
    ('Contrato completo — Fotografia', 'photography', 'produção fotográfica'),
    ('Contrato completo — Produção audiovisual', 'audiovisual', 'produção audiovisual'),
    ('Contrato completo — Website e landing page', 'website', 'design e desenvolvimento de website'),
    ('Contrato completo — Design gráfico', 'graphic_design', 'design gráfico'),
    ('Contrato completo — Prestação de serviços criativos', 'other', 'serviços criativos')
  ) as t(name, category, obj)
  where not exists (select 1 from public.contract_templates c where c.organization_id = p_org and c.name = t.name);
$$;
do $$ begin perform public.seed_complete_contract_templates(id) from public.organizations; end $$;

create or replace function public.after_org_created_contracts()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.seed_complete_contract_templates(new.id);
  return new;
end $$;
create trigger trg_org_seed_contracts after insert on public.organizations
  for each row execute function public.after_org_created_contracts();

-- Gera contrato a partir da tela de geração: corpo já preenchido e revisado
-- pelo usuário, com as variáveis usadas guardadas na versão 1.
create or replace function public.generate_contract(p_client uuid, p_template uuid, p_title text, p_body_html text, p_variables jsonb, p_proposal uuid default null)
returns uuid language plpgsql security invoker set search_path = public as $$
declare v_org uuid; v_id uuid;
begin
  select organization_id into v_org from public.clients where id = p_client;
  if v_org is null or not public.has_perm(v_org, 'contracts.write') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_template is not null and not exists (select 1 from public.contract_templates where id = p_template and organization_id = v_org) then
    raise exception 'contract_template_not_found';
  end if;
  if length(coalesce(p_body_html, '')) < 200 then raise exception 'contract_body_too_short'; end if;
  insert into public.contracts (organization_id, client_id, proposal_id, template_id, title, status, created_by, number)
  values (v_org, p_client, p_proposal, p_template, coalesce(nullif(trim(p_title), ''), 'Contrato'), 'draft', auth.uid(), 0) returning id into v_id;
  insert into public.contract_versions (organization_id, contract_id, version, body_html, variables, note, created_by)
  values (v_org, v_id, 1, p_body_html, coalesce(p_variables, '{}'::jsonb), 'Gerado pela tela de contratos', auth.uid());
  return v_id;
end $$;
grant execute on function public.generate_contract(uuid, uuid, text, text, jsonb, uuid) to authenticated;
revoke execute on function public.generate_contract(uuid, uuid, text, text, jsonb, uuid) from public, anon;
revoke execute on function public.default_contract_body(text), public.seed_complete_contract_templates(uuid) from public, anon, authenticated;

create or replace function public.format_document(p text)
returns text language sql immutable as $$
  select case length(regexp_replace(coalesce(p, ''), '\D', '', 'g'))
    when 11 then regexp_replace(regexp_replace(p, '\D', '', 'g'), '(\d{3})(\d{3})(\d{3})(\d{2})', '\1.\2.\3-\4')
    when 14 then regexp_replace(regexp_replace(p, '\D', '', 'g'), '(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})', '\1.\2.\3/\4-\5')
    else nullif(p, '') end;
$$;

-- Variáveis de contrato ampliadas (partes completas e cláusulas de mora/prazos).
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
    'cpf_cnpj', public.format_document(cl.document),
    'endereco_cliente', nullif(concat_ws(', ', cl.address ->> 'street', cl.address ->> 'city', cl.address ->> 'state', cl.address ->> 'zip'), ''),
    'representante_cliente', cl.address ->> 'contact_name',
    'cpf_representante_cliente', public.format_document(cl.address ->> 'contact_document'),
    'email_cliente', cl.email::text,
    'nome_estudio', coalesce(o.legal_name, o.name),
    'documento_estudio', public.format_document(o.document),
    'endereco_estudio', nullif(concat_ws(', ', o.address ->> 'street', o.address ->> 'city', o.address ->> 'state', o.address ->> 'zip'), ''),
    'representante_estudio', o.legal_representative ->> 'name',
    'cpf_representante_estudio', public.format_document(o.legal_representative ->> 'document'),
    'email_estudio', o.email::text,
    'servico_contratado', coalesce(pr.title, pj.name, c.title),
    'escopo', coalesce(pr.scope, pj.scope),
    'entregaveis', coalesce(pr.deliverables, pr.scope, pj.scope),
    'valor_total', case when coalesce(pr.total, pj.contracted_amount) is not null
        then 'R$ ' || replace(replace(replace(to_char(coalesce(pr.total, pj.contracted_amount), 'FM999G999G990D00'), ',', '#'), '.', ','), '#', '.') end,
    'condicoes_pagamento', case when pr.id is not null then
        pr.installments || 'x' || case when pr.first_due_date is not null then ', primeira parcela em ' || to_char(pr.first_due_date, 'DD/MM/YYYY') else '' end
        || case when pr.terms is not null then '. ' || pr.terms else '' end end,
    'data_inicio', to_char(pj.start_date, 'DD/MM/YYYY'),
    'data_entrega', to_char(pj.due_date, 'DD/MM/YYYY'),
    'numero_revisoes', coalesce(pr.revisions, 2)::text,
    'prazo_aprovacao', '5', 'multa_atraso', '2', 'juros_atraso', '1',
    'cidade_foro', o.address ->> 'city',
    'cidade_assinatura', o.address ->> 'city',
    'data_hoje', to_char((now() at time zone 'America/Sao_Paulo')::date, 'DD/MM/YYYY')
  );
  return (select jsonb_object_agg(key, value) from jsonb_each(v) where value <> 'null'::jsonb);
end $$;

grant execute on function public.format_document(text) to authenticated, service_role;

-- Contas do portal do cliente também são cadastro de usuário: só o administrador.
drop policy client_users_write on public.client_users;
create policy client_users_write on public.client_users for all
  using (public.has_perm(organization_id, 'users.manage')) with check (public.has_perm(organization_id, 'users.manage'));
