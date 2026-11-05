-- Testes de isolamento, permissões e fluxos do banco.
-- Rodar: npm run test:db (ver scripts/test-db.sh). Falha na primeira asserção quebrada.
\set ON_ERROR_STOP 1
\set QUIET 1
set client_min_messages = warning;
\o /dev/null

create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FALHOU: %', msg; end if;
  raise notice 'ok - %', msg;
end $$;
create or replace function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), false);
end $$;
create or replace function pg_temp.empty_or_denied(sql text) returns boolean language plpgsql as $$
declare n bigint;
begin
  execute 'select count(*) from (' || sql || ') q' into n;
  return n = 0;
exception when insufficient_privilege then
  return true;
end $$;
create or replace function pg_temp.fails(sql text) returns boolean language plpgsql as $$
begin
  execute sql;
  return false;
exception when others then
  return true;
end $$;

-- Usuários (o trigger cria os perfis)
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@a.test'),
  ('00000000-0000-0000-0000-00000000000b', 'membro@a.test'),
  ('00000000-0000-0000-0000-00000000000c', 'fin@a.test'),
  ('00000000-0000-0000-0000-00000000000d', 'admin@b.test'),
  ('00000000-0000-0000-0000-00000000000e', 'cliente1@x.test'),
  ('00000000-0000-0000-0000-00000000000f', 'cliente2@y.test');

set client_min_messages = notice;
select pg_temp.ok((select count(*) from public.profiles) = 6, 'perfil criado automaticamente para cada usuário');

-- ===== Organização A (admin cria) ===========================================
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.create_organization('Estúdio A', 'estudio-a') as org_a \gset
select pg_temp.ok(public.has_perm(:'org_a', 'finance.read'), 'admin tem todas as permissões');
select pg_temp.ok(pg_temp.fails($$select public.create_organization('Outro', 'outro')$$), 'quem já é membro não cria outra organização');
select pg_temp.ok((select count(*) from public.project_templates) = 7, 'modelos de projeto padrão criados');
select pg_temp.ok((select count(*) from public.pipeline_stages) = 8, 'pipeline padrão com 8 etapas');

-- ===== Organização B ========================================================
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select public.create_organization('Estúdio B', 'estudio-b') as org_b \gset
insert into public.clients (organization_id, legal_name) values (:'org_b', 'Cliente do B') returning id as client_b \gset

-- Equipe de A (convite aceito — feito pela Edge Function com service role)
reset role;
insert into public.organization_members (organization_id, user_id, role, status, hourly_cost) values
  (:'org_a', '00000000-0000-0000-0000-00000000000b', 'member', 'active', 80),
  (:'org_a', '00000000-0000-0000-0000-00000000000c', 'finance', 'active', null);
update public.organization_members set hourly_cost = 120 where user_id = '00000000-0000-0000-0000-00000000000a';

-- ===== Admin A cria clientes, projeto e tarefas ==============================
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into public.clients (organization_id, legal_name, document) values (:'org_a', 'Arara Torrefação Ltda', '12345678000190') returning id as client1 \gset
insert into public.clients (organization_id, legal_name) values (:'org_a', 'Lume Ótica') returning id as client2 \gset
select pg_temp.ok(pg_temp.fails(format($$insert into public.clients (organization_id, legal_name, document) values (%L, 'Doc inválido', '123')$$, :'org_a')), 'CPF/CNPJ inválido é rejeitado');
select pg_temp.ok(pg_temp.fails(format($$insert into public.projects (organization_id, client_id, name) values (%L, %L, 'Mistura')$$, :'org_a', :'client_b')), 'projeto não pode usar cliente de outra organização');

insert into public.projects (organization_id, client_id, name, category, contracted_amount, owner_id, due_date)
values (:'org_a', :'client1', 'Rebranding Arara', 'branding', 20000, '00000000-0000-0000-0000-00000000000a', current_date - 1)
returning id as proj1 \gset
insert into public.projects (organization_id, client_id, name, category, owner_id)
values (:'org_a', :'client2', 'Campanha Lume', 'campaign', '00000000-0000-0000-0000-00000000000a') returning id as proj2 \gset
insert into public.tasks (organization_id, project_id, title, client_visible) values (:'org_a', :'proj1', 'Briefing', true) returning id as task1 \gset
insert into public.tasks (organization_id, project_id, title) values (:'org_a', :'proj1', 'Pesquisa interna') returning id as task2 \gset
select pg_temp.ok(pg_temp.fails(format($$insert into public.tasks (organization_id, project_id, parent_id, title) values (%L, %L, %L, 'Sub em outro projeto')$$, :'org_a', :'proj2', :'task1')), 'subtarefa precisa estar no mesmo projeto da tarefa-mãe');
insert into public.task_comments (organization_id, task_id, author_id, body) values (:'org_a', :'task1', '00000000-0000-0000-0000-00000000000a', 'Comentário interno sigiloso');
insert into public.project_comments (organization_id, project_id, author_id, body, is_internal) values
  (:'org_a', :'proj1', '00000000-0000-0000-0000-00000000000a', 'Margem apertada neste projeto', true),
  (:'org_a', :'proj1', '00000000-0000-0000-0000-00000000000a', 'Primeira apresentação na sexta', false);
select pg_temp.ok((select count(*) from public.activity_logs where entity_type = 'projects') >= 2, 'alterações de projeto ficam no log de atividades');

-- ===== Isolamento entre organizações ========================================
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.ok((select count(*) from public.clients) = 1, 'admin B vê só o próprio cliente');
select pg_temp.ok((select count(*) from public.projects) = 0, 'admin B não vê projetos de A');
select pg_temp.ok((select count(*) from public.organizations) = 1, 'admin B vê só a própria organização');
update public.clients set legal_name = 'hack' where id = :'client1';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.ok((select legal_name from public.clients where id = :'client1') = 'Arara Torrefação Ltda', 'admin B não altera cliente de A');

-- ===== Colaborador ==========================================================
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.ok((select count(*) from public.clients) = 2, 'colaborador lê clientes (clients.read)');
select pg_temp.ok(pg_temp.fails(format($$insert into public.clients (organization_id, legal_name) values (%L, 'Novo')$$, :'org_a')), 'colaborador não cria cliente sem clients.write');
select pg_temp.ok((select count(*) from public.projects) = 0, 'colaborador não vê projetos em que não participa');
select pg_temp.ok(not public.has_perm(:'org_a', 'finance.read'), 'colaborador sem acesso financeiro');
update public.organization_members set role = 'admin' where user_id = '00000000-0000-0000-0000-00000000000b';
reset role;
select pg_temp.ok((select role from public.organization_members where user_id = '00000000-0000-0000-0000-00000000000b') = 'member', 'colaborador não promove a si mesmo');

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into public.project_members (organization_id, project_id, user_id) values (:'org_a', :'proj1', '00000000-0000-0000-0000-00000000000b');
update public.tasks set assignee_id = '00000000-0000-0000-0000-00000000000b' where id = :'task2';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.ok((select count(*) from public.projects) = 1, 'colaborador vê o projeto em que participa');
select pg_temp.ok((select count(*) from public.notifications where kind = 'task_assigned') = 1, 'colaborador recebe notificação de tarefa atribuída');
update public.tasks set status = 'done' where id = :'task2';
select pg_temp.ok((select completed_at is not null from public.tasks where id = :'task2'), 'tarefa concluída registra data');
insert into public.time_entries (organization_id, project_id, task_id, user_id, minutes) values (:'org_a', :'proj1', :'task2', '00000000-0000-0000-0000-00000000000b', 150);
select pg_temp.ok(pg_temp.fails(format($$insert into public.time_entries (organization_id, project_id, user_id, minutes) values (%L, %L, %L, 30)$$, :'org_a', :'proj2', '00000000-0000-0000-0000-00000000000b')), 'colaborador não lança horas em projeto sem acesso');
select pg_temp.ok((select count(*) from public.accounts_receivable) = 0, 'colaborador não lê contas a receber');
select pg_temp.ok((public.dashboard_summary(:'org_a', current_date - 30, current_date) -> 'finance') = 'null'::jsonb, 'dashboard do colaborador não traz números financeiros');

-- ===== Proposta aprovada → projeto + tarefas + contrato + parcelas ==========
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select id as tpl_branding from public.project_templates where category = 'branding' \gset
select id as ctpl from public.contract_templates where category = 'branding' \gset
insert into public.services (organization_id, name, category, unit_price) values (:'org_a', 'Identidade visual', 'branding', 12000) returning id as svc1 \gset
insert into public.proposals (organization_id, client_id, title, template_id, installments, discount_type, discount_value, number)
values (:'org_a', :'client2', 'Identidade Lume', :'tpl_branding', 3, 'percent', 10, 0) returning id as prop1 \gset
insert into public.proposal_items (organization_id, proposal_id, service_id, description, quantity, unit_price) values
  (:'org_a', :'prop1', :'svc1', 'Identidade visual', 1, 12000),
  (:'org_a', :'prop1', null, 'Papelaria', 2, 1500);
select pg_temp.ok((select subtotal = 15000 and total = 13500 from public.proposals where id = :'prop1'), 'totais da proposta recalculados no servidor (com 10% de desconto)');
select public.approve_proposal(:'prop1', :'ctpl', current_date) as result \gset
select (:'result'::jsonb ->> 'project_id') as proj3 \gset
select pg_temp.ok((select status from public.proposals where id = :'prop1') = 'approved', 'proposta marcada como aprovada');
select pg_temp.ok((select contracted_amount from public.projects where id = :'proj3') = 13500, 'projeto criado com o valor contratado');
select pg_temp.ok((select count(*) from public.tasks where project_id = :'proj3') = 13, 'tarefas do modelo criadas sem a etapa opcional de naming');
select pg_temp.ok((select count(*) from public.accounts_receivable where project_id = :'proj3' and status = 'scheduled') = 3, 'três parcelas criadas como previstas');
select pg_temp.ok((select sum(amount) from public.accounts_receivable where project_id = :'proj3') = 13500, 'parcelas somam exatamente o total');
select pg_temp.ok((select count(*) from public.contracts where proposal_id = :'prop1') = 1, 'contrato em rascunho gerado');
select pg_temp.ok(pg_temp.fails(format($$select public.approve_proposal(%L)$$, :'prop1')), 'proposta não é aprovada duas vezes');
select pg_temp.ok(pg_temp.fails(format($$update public.contracts set status = 'signed' where proposal_id = %L$$, :'prop1')), 'contrato não vira assinado sem o provedor de assinatura');

-- ===== Financeiro: previsto ≠ faturado ≠ recebido ===========================
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.ok((select count(*) from public.accounts_receivable) = 3, 'financeiro vê contas a receber');
select pg_temp.ok((select count(*) from public.projects) = 0, 'financeiro não vê projetos sem projects.read_all');
update public.accounts_receivable set status = 'open' where project_id = :'proj3' and installment_no = 1;
select pg_temp.ok((select count(*) from public.transactions) = 0, 'parcela faturada (em aberto) não entra no caixa');
update public.accounts_receivable set status = 'paid', paid_at = current_date where project_id = :'proj3' and installment_no = 1;
select pg_temp.ok((select sum(amount) from public.transactions where direction = 'in') = 4500, 'baixa da parcela gera entrada no caixa');
select id as cat_out from public.financial_categories where name = 'Terceirizados / freelancers' \gset
insert into public.accounts_payable (organization_id, project_id, category_id, description, amount, due_date, cost_type, status, paid_at)
values (:'org_a', :'proj3', :'cat_out', 'Ilustrador freelancer', 2000, current_date, 'outsourced', 'paid', current_date);
select pg_temp.ok(pg_temp.fails(format($$insert into public.accounts_payable (organization_id, project_id, category_id, description, amount, due_date) values (%L, %L, %L, 'x', 10, current_date)$$, :'org_b', :'proj3', :'cat_out')), 'despesa não pode ligar a projeto de outra organização');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.ok((select outsourced_cost = 2000 and received_amount = 4500 and projected_result = 11500 from public.project_profitability where project_id = :'proj3'), 'despesa do projeto impacta a rentabilidade');
select pg_temp.ok((select internal_cost = 200 from public.project_profitability where project_id = :'proj1'), 'horas × custo/hora entram como custo interno');
select pg_temp.ok((public.dashboard_summary(:'org_a', current_date - 30, current_date) -> 'finance' ->> 'received')::numeric = 4500, 'dashboard financeiro mostra só o recebido como receita');
select pg_temp.ok((public.dashboard_summary(:'org_a', current_date - 30, current_date) ->> 'projects_late')::int = 1, 'dashboard conta projeto atrasado');

-- ===== Portal do cliente ====================================================
reset role;
insert into public.client_users (organization_id, client_id, user_id) values
  (:'org_a', :'client1', '00000000-0000-0000-0000-00000000000e'),
  (:'org_a', :'client2', '00000000-0000-0000-0000-00000000000f');
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into public.approvals (organization_id, project_id, title, requested_by) values (:'org_a', :'proj1', 'Conceito 1', '00000000-0000-0000-0000-00000000000a') returning id as appr1 \gset

select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
select pg_temp.ok((select count(*) from public.projects) = 0, 'cliente não lê a tabela de projetos (valores internos)');
select pg_temp.ok((select count(*) from public.portal_projects) = 1, 'cliente vê só o próprio projeto no portal');
select pg_temp.ok((select progress from public.portal_projects) = 50, 'portal mostra progresso calculado');
select pg_temp.ok(not exists (select 1 from information_schema.columns where table_name = 'portal_projects' and column_name = 'contracted_amount'), 'portal não expõe valor contratado');
select pg_temp.ok((select count(*) from public.portal_tasks) = 1, 'cliente vê só tarefas marcadas como visíveis');
select pg_temp.ok((select count(*) from public.portal_comments) = 1 and (select count(*) from public.project_comments) = 0, 'cliente não vê comentários internos');
select pg_temp.ok((select count(*) from public.task_comments) = 0, 'cliente não vê comentários das tarefas');
select pg_temp.ok((select count(*) from public.accounts_receivable) = 0 and (select count(*) from public.transactions) = 0, 'cliente não vê financeiro');
select pg_temp.ok((select count(*) from public.clients) = 1, 'cliente vê só o próprio cadastro');
insert into public.approval_events (organization_id, approval_id, decision, comment, actor_user_id)
values (:'org_a', :'appr1', 'changes_requested', 'Testar uma versão mais clara', '00000000-0000-0000-0000-00000000000e');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000f');
select pg_temp.ok((select count(*) from public.portal_projects) = 2 and not exists (select 1 from public.portal_projects where name = 'Rebranding Arara'), 'outro cliente vê só os próprios 2 projetos');
select pg_temp.ok((select count(*) from public.approvals where id = :'appr1') = 0, 'outro cliente não vê aprovações alheias');
select pg_temp.ok(pg_temp.fails(format($$select public.portal_add_comment(%L, 'oi')$$, :'proj1')), 'outro cliente não comenta em projeto alheio');
select pg_temp.ok((select count(*) from public.portal_proposals) = 1, 'cliente vê a proposta enviada para ele');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.ok((select status from public.approvals where id = :'appr1') = 'changes_requested', 'resposta do cliente atualiza a aprovação');
select pg_temp.ok((select count(*) from public.notifications where kind = 'approval_changes') = 1, 'quem pediu a aprovação é notificado da alteração solicitada');

-- ===== Links seguros ========================================================
select public.create_share_link(:'proj1', 'Diretoria', array['progress','files'], now() + interval '7 days') as token \gset
select pg_temp.ok(length(:'token') = 64, 'token aleatório de 256 bits');
select pg_temp.ok((select count(*) from public.share_links where token_hash = digest(:'token', 'sha256')) = 1, 'banco guarda só o hash do token');
select pg_temp.ok(not exists (select 1 from information_schema.columns where table_name = 'share_links' and column_name = 'token'), 'token bruto não é armazenado');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.ok(pg_temp.fails(format($$select public.create_share_link(%L, 'x', null, null)$$, :'proj1')), 'colaborador sem portal.share não cria link');

-- ===== Último admin ==========================================================
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.ok(pg_temp.fails($$update public.organization_members set role = 'manager' where user_id = '00000000-0000-0000-0000-00000000000a'$$), 'organização nunca fica sem administrador');

-- ===== Convite =================================================================
reset role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000010', 'nova@a.test');
insert into public.invitations (organization_id, email, role, invited_by) values (:'org_a', 'nova@a.test', 'manager', '00000000-0000-0000-0000-00000000000a');
insert into public.organization_members (organization_id, user_id, role, status) values (:'org_a', '00000000-0000-0000-0000-000000000010', 'manager', 'invited');
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000000010');
select pg_temp.ok((public.session_context() -> 'memberships') = '[]'::jsonb and (public.session_context() ->> 'pending_invites')::boolean, 'convidado ainda não acessa a organização antes de aceitar');
select pg_temp.ok((select count(*) from public.clients) = 0, 'convite pendente não dá acesso a dados');
select pg_temp.ok((public.accept_invitation() ->> 'members')::int = 1, 'aceite ativa a associação');
select pg_temp.ok((public.session_context() -> 'memberships' -> 0 ->> 'role') = 'manager', 'contexto da sessão traz papel e organização');
select pg_temp.ok((public.session_context() -> 'memberships' -> 0 -> 'permissions') ? 'projects.write', 'contexto traz permissões efetivas do gestor');
select pg_temp.ok(not ((public.session_context() -> 'memberships' -> 0 -> 'permissions') ? 'finance.read'), 'gestor não tem financeiro por padrão');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
select pg_temp.ok(jsonb_array_length(public.session_context() -> 'client_accounts') = 1 and (public.session_context() -> 'memberships') = '[]'::jsonb, 'conta de cliente é identificada para ir ao portal');
select pg_temp.ok(pg_temp.fails($$select public.create_organization('Cliente cria', 'cliente-cria')$$), 'conta de cliente não cria organização');
select pg_temp.ok((select count(*) from public.team_directory((select organization_id from public.client_users limit 1))) = 0, 'cliente não lista a equipe');

-- ===== Fase 2: CRM =========================================================
reset role; set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into public.leads (organization_id, name, company, email) values (:'org_a', 'Ana Ribeiro', 'Bodega 81', 'ana@bodega.test') returning id as lead1 \gset
select id as st_new from public.pipeline_stages where organization_id = :'org_a' and position = 1 \gset
select id as st_prop from public.pipeline_stages where organization_id = :'org_a' and position = 5 \gset
select id as st_lost from public.pipeline_stages where organization_id = :'org_a' and kind = 'lost' \gset
insert into public.opportunities (organization_id, title, lead_id, stage_id, estimated_value) values (:'org_a', 'Cardápio Bodega', :'lead1', :'st_new', 8000) returning id as opp1 \gset
select pg_temp.ok(pg_temp.fails(format($$select public.move_opportunity(%L, %L)$$, :'opp1', :'st_lost')), 'marcar como perdida exige motivo');
select public.move_opportunity(:'opp1', :'st_prop');
select pg_temp.ok((select stage_id from public.opportunities where id = :'opp1') = :'st_prop', 'oportunidade muda de etapa');
select pg_temp.ok((select count(*) from public.crm_activities where opportunity_id = :'opp1') = 1, 'mudança de etapa fica no histórico');
select public.convert_lead_to_client(:'lead1') as client3 \gset
select pg_temp.ok((select legal_name from public.clients where id = :'client3') = 'Bodega 81', 'lead convertido vira cliente');
select pg_temp.ok((select client_id from public.opportunities where id = :'opp1') = :'client3' and (select client_id from public.crm_activities where opportunity_id = :'opp1') = :'client3', 'histórico do lead acompanha o novo cliente');
select pg_temp.ok((select count(*) from public.client_contacts where client_id = :'client3' and is_primary) = 1, 'contato principal criado na conversão');
select pg_temp.ok(public.convert_lead_to_client(:'lead1') = :'client3', 'conversão repetida não duplica cliente');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.ok((select count(*) from public.leads) = 0, 'colaborador sem crm.read não vê leads');

-- ===== Fase 2: propostas ====================================================
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into public.proposals (organization_id, client_id, title, number, valid_until) values (:'org_a', :'client1', 'Manual de marca Arara', 0, current_date + 15) returning id as prop2 \gset
select pg_temp.ok(pg_temp.fails(format($$select public.send_proposal(%L)$$, :'prop2')), 'proposta sem itens não é enviada');
insert into public.proposal_items (organization_id, proposal_id, description, unit_price) values (:'org_a', :'prop2', 'Manual de marca', 6000);
select public.send_proposal(:'prop2');
select pg_temp.ok((select status = 'sent' and sent_at is not null from public.proposals where id = :'prop2'), 'proposta enviada');
select pg_temp.ok((select number from public.proposals where id = :'prop2') = 2, 'numeração sequencial por estúdio');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000f');
select pg_temp.ok(pg_temp.fails(format($$select public.portal_view_proposal(%L)$$, :'prop2')), 'cliente de outra conta não abre a proposta');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
select public.portal_view_proposal(:'prop2');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.ok((select status from public.proposals where id = :'prop2') = 'viewed', 'proposta marcada como visualizada pelo cliente');
select pg_temp.ok((select count(*) from public.notifications where kind = 'proposal_viewed') = 1, 'equipe é avisada da visualização');
select public.reject_proposal(:'prop2', 'Orçamento acima do previsto');
select pg_temp.ok((select status = 'rejected' and notes like '%acima do previsto%' from public.proposals where id = :'prop2'), 'recusa registra motivo');

-- ===== Fase 2: contratos ====================================================
select id as ctpl_social from public.contract_templates where organization_id = :'org_a' and category = 'social_media' \gset
select public.create_contract(:'client1', :'ctpl_social', 'Contrato social media Arara') as ctr \gset
select pg_temp.ok((public.contract_variables(:'ctr') ->> 'nome_cliente') = 'Arara Torrefação Ltda', 'variável nome_cliente preenchida do cadastro');
select pg_temp.ok((public.contract_variables(:'ctr') ->> 'cpf_cnpj') = '12.345.678/0001-90', 'CNPJ formatado na variável');
select pg_temp.ok(public.save_contract_version(:'ctr', '<p>Texto revisado do contrato de social media.</p>', 'Revisão jurídica') = 2, 'nova versão salva');
select pg_temp.ok((select current_version from public.contracts where id = :'ctr') = 2, 'contrato aponta para a versão atual');
update public.contract_versions set body_html = 'x' where contract_id = :'ctr';
select pg_temp.ok(not exists (select 1 from public.contract_versions where contract_id = :'ctr' and body_html = 'x'), 'versões anteriores não podem ser alteradas');
reset role;
select pg_temp.ok(pg_temp.fails(format($$update public.contract_versions set body_html = 'x' where contract_id = %L$$, :'ctr')), 'nem o dono do banco altera versão (trigger de imutabilidade)');
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.ok(pg_temp.fails(format($$select public.save_contract_version(%L, '<p>tentativa de alteração indevida</p>')$$, :'ctr')), 'colaborador não altera contrato');

-- ===== Fase 2 (complemento): link público e assinatura =======================
reset role; set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into public.proposals (organization_id, client_id, title, number, valid_until) values (:'org_a', :'client2', 'Fotos de catálogo', 0, current_date + 20) returning id as prop3 \gset
insert into public.proposal_items (organization_id, proposal_id, description, unit_price) values (:'org_a', :'prop3', 'Diária de estúdio', 3500);
select pg_temp.ok(pg_temp.fails(format($$select public.create_proposal_link(%L)$$, :'prop3')), 'rascunho não gera link público');
select public.send_proposal(:'prop3');
select public.create_proposal_link(:'prop3', 30) as ptoken \gset
select id as plink from public.proposal_links where token_hash = digest(:'ptoken', 'sha256') \gset
select pg_temp.ok((select expires_at::date <= current_date + 21 from public.proposal_links where id = :'plink'), 'link expira até o fim da validade da proposta');
select pg_temp.ok(pg_temp.fails(format($$select public.record_proposal_acceptance(%L, 'Ana', null)$$, :'plink')), 'aceite só pela Edge Function (service role)');
reset role; set role service_role; select pg_temp.as_user(null);
select public.record_proposal_acceptance(:'plink', 'Ana Ribeiro', 'Pode seguir');
select pg_temp.ok((select client_accepted_name = 'Ana Ribeiro' and status = 'negotiation' from public.proposals where id = :'prop3'), 'aceite do cliente registrado com nome e data');
select pg_temp.ok(pg_temp.fails(format($$select public.record_proposal_acceptance(%L, 'Outra pessoa', null)$$, :'plink')), 'aceite não é registrado duas vezes');
select pg_temp.ok((select count(*) from public.notifications where kind = 'proposal_accepted') = 1, 'equipe é avisada do aceite');
reset role; set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
update public.contracts set status = 'in_review' where id = :'ctr';
select public.mark_contract_sent_for_signature(:'ctr', 'zapsign', 'doc-123');
select pg_temp.ok((select status from public.contracts where id = :'ctr') = 'sent_for_signature', 'contrato enviado para assinatura');
select pg_temp.ok(pg_temp.fails(format($$select public.mark_contract_signature(%L, 'signed')$$, :'ctr')), 'usuário não marca contrato como assinado');
reset role; set role service_role; select pg_temp.as_user(null);
select public.mark_contract_signature(:'ctr', 'signed', 'Assinado por todas as partes');
select pg_temp.ok((select status = 'signed' and signed_at is not null from public.contracts where id = :'ctr'), 'retorno do provedor marca como assinado');
reset role; set role authenticated;

-- ===== Fase 3: financeiro ===================================================
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select id as ar2 from public.accounts_receivable where project_id = :'proj3' and installment_no = 2 \gset
select public.invoice_receivable(:'ar2');
select pg_temp.ok((select status from public.accounts_receivable where id = :'ar2') = 'open', 'parcela prevista passa a faturada');
select pg_temp.ok(pg_temp.fails(format($$select public.settle('receivable', %L, current_date + 1, 100)$$, :'ar2')), 'baixa com data futura é recusada');
select public.settle('receivable', :'ar2', current_date, 4500, 'pix');
select pg_temp.ok((select sum(amount) from public.transactions where direction = 'in') = 9000, 'baixa soma no caixa');
select public.reopen('receivable', :'ar2');
select pg_temp.ok((select sum(amount) from public.transactions where direction = 'in') = 4500, 'estorno remove a entrada do caixa');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.ok((select count(*) from public.notifications where kind = 'payment_received') >= 1, 'responsável pelo projeto é avisado do pagamento');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select id as cat_sw from public.financial_categories where organization_id = :'org_a' and name = 'Softwares e assinaturas' \gset
insert into public.accounts_payable (organization_id, category_id, description, amount, due_date, recurrence) values (:'org_a', :'cat_sw', 'Adobe CC', 290, current_date, 'monthly') returning id as ap1 \gset
select public.settle('payable', :'ap1', current_date, 290);
select pg_temp.ok((select due_date = (current_date + interval '1 month')::date and status = 'open' from public.accounts_payable where recurrence_parent_id = :'ap1'), 'conta recorrente gera a próxima ao ser paga');
select public.reopen('payable', :'ap1'); select public.settle('payable', :'ap1', current_date, 290);
select pg_temp.ok((select count(*) from public.accounts_payable where recurrence_parent_id = :'ap1') = 1, 'recorrência não duplica ao pagar de novo');
select pg_temp.ok((public.finance_report(:'org_a', current_date - 30, current_date) ->> 'income')::numeric = 4500, 'relatório usa só o recebido no período');
select pg_temp.ok(jsonb_array_length(public.finance_report(:'org_a', current_date - 30, current_date) -> 'forecast') = 6, 'previsão de caixa para 6 meses');
select pg_temp.ok((public.finance_report(:'org_a', current_date - 30, current_date) ->> 'contracted_not_billed')::numeric = 4500, 'previsto separado do faturado');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.ok(pg_temp.fails(format($$select public.finance_report(%L, current_date - 30, current_date)$$, :'org_a')), 'colaborador não acessa relatório financeiro');
select pg_temp.ok(pg_temp.fails(format($$select public.settle('payable', %L, current_date, 1)$$, :'ap1')), 'colaborador não dá baixa');
select pg_temp.ok(pg_temp.fails(format($$select * from public.team_workload(%L, current_date, current_date + 7)$$, :'org_a')), 'colaborador sem team.read não vê carga da equipe');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.ok((select count(*) from public.team_workload(:'org_a', current_date - 7, current_date + 7)) >= 3, 'gestor vê carga de trabalho da equipe');
select pg_temp.ok((select logged_hours from public.team_workload(:'org_a', current_date - 7, current_date + 7) where user_id = '00000000-0000-0000-0000-00000000000b') = 2.5, 'horas lançadas entram na carga');

-- ===== Fase 3: alertas diários ==============================================
update public.tasks set due_date = current_date + 1, status = 'todo', assignee_id = '00000000-0000-0000-0000-00000000000b' where id = :'task1';
select pg_temp.ok(pg_temp.fails('select public.run_daily_alerts()'), 'usuário não executa a rotina diária');
reset role; set role service_role; select pg_temp.as_user(null);
select public.run_daily_alerts() as alerts \gset
select public.run_daily_alerts();
reset role;
select pg_temp.ok((select count(*) from public.notifications where kind = 'deadline_soon' and user_id = '00000000-0000-0000-0000-00000000000b') = 1, 'alerta de prazo é criado uma vez por dia');
set role authenticated;

-- ===== Anônimo ==============================================================
reset role; set role anon; select pg_temp.as_user(null);
select pg_temp.ok(pg_temp.empty_or_denied('select * from public.clients'), 'anônimo não lê clientes');
select pg_temp.ok(pg_temp.empty_or_denied('select * from public.portal_projects'), 'anônimo não lê o portal');
select pg_temp.ok(pg_temp.empty_or_denied('select * from public.accounts_receivable'), 'anônimo não lê o financeiro');
select pg_temp.ok(pg_temp.fails($$select public.create_share_link(gen_random_uuid(), 'x', null, null)$$), 'anônimo não executa RPCs');
reset role; set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.ok(pg_temp.fails($$select public.find_user_id_by_email('admin@a.test')$$), 'usuário comum não procura contas por e-mail');
select pg_temp.ok(pg_temp.fails($$select public.mark_overdue()$$), 'usuário comum não executa rotinas internas');
reset role;
\echo 'TODOS OS TESTES PASSARAM'
