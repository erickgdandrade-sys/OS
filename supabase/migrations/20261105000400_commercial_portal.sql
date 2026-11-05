-- =============================================================================
-- NEXO Studio OS — 0004 Serviços, propostas, contratos e portal do cliente
-- =============================================================================

create table public.services (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  category        public.project_category not null default 'other',
  description     text,
  unit            text not null default 'projeto',      -- projeto, hora, mês, diária, peça
  unit_price      numeric(14,2) not null default 0 check (unit_price >= 0),
  default_template_id uuid,
  default_revisions int not null default 2 check (default_revisions >= 0),
  is_recurring    boolean not null default false,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, default_template_id) references public.project_templates(organization_id, id) on delete set null (default_template_id)
);

create type public.proposal_status as enum ('draft', 'sent', 'viewed', 'negotiation', 'approved', 'rejected', 'expired');

create table public.proposals (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  number          int not null,
  client_id       uuid not null,
  opportunity_id  uuid,
  title           text not null,
  status          public.proposal_status not null default 'draft',
  intro           text,
  scope           text,
  deliverables    text,
  terms           text,                      -- condições
  notes           text,
  revisions       int not null default 2 check (revisions >= 0),
  discount_type   text not null default 'none' check (discount_type in ('none', 'percent', 'amount')),
  discount_value  numeric(14,2) not null default 0 check (discount_value >= 0),
  installments    int not null default 1 check (installments between 1 and 48),
  first_due_date  date,
  valid_until     date,
  template_id     uuid,                      -- modelo de projeto a usar na aprovação
  subtotal        numeric(14,2) not null default 0,
  total           numeric(14,2) not null default 0,
  sent_at         timestamptz,
  viewed_at       timestamptz,
  decided_at      timestamptz,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, number),
  check (discount_type <> 'percent' or discount_value <= 100),
  foreign key (organization_id, client_id) references public.clients(organization_id, id) on delete restrict,
  foreign key (organization_id, opportunity_id) references public.opportunities(organization_id, id) on delete set null (opportunity_id),
  foreign key (organization_id, template_id) references public.project_templates(organization_id, id) on delete set null (template_id)
);
create trigger trg_proposals_updated before update on public.proposals for each row execute function public.set_updated_at();
create trigger trg_proposals_log after insert or update or delete on public.proposals for each row execute function public.log_activity();

create table public.proposal_items (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  proposal_id     uuid not null,
  service_id      uuid,
  position        int not null default 0,
  description     text not null,
  details         text,
  quantity        numeric(10,2) not null default 1 check (quantity > 0),
  unit_price      numeric(14,2) not null check (unit_price >= 0),
  is_package      boolean not null default false,
  line_total      numeric(14,2) generated always as (round(quantity * unit_price, 2)) stored,
  foreign key (organization_id, proposal_id) references public.proposals(organization_id, id) on delete cascade,
  foreign key (organization_id, service_id) references public.services(organization_id, id) on delete set null (service_id)
);
create index idx_proposal_items on public.proposal_items(proposal_id, position);

-- Numeração sequencial por organização e recálculo de totais no servidor.
create or replace function public.proposals_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.number is null or new.number = 0 then
    select coalesce(max(number), 0) + 1 into new.number from public.proposals where organization_id = new.organization_id;
  end if;
  return new;
end $$;
create trigger trg_proposals_number before insert on public.proposals for each row execute function public.proposals_before_insert();

create or replace function public.recalc_proposal(p_proposal uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_sub numeric(14,2); p public.proposals;
begin
  select * into p from public.proposals where id = p_proposal;
  select coalesce(sum(line_total), 0) into v_sub from public.proposal_items where proposal_id = p_proposal;
  update public.proposals set subtotal = v_sub,
    total = greatest(0, case p.discount_type
      when 'percent' then round(v_sub * (1 - p.discount_value / 100), 2)
      when 'amount' then v_sub - p.discount_value else v_sub end)
  where id = p_proposal;
end $$;

create or replace function public.proposal_items_changed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.recalc_proposal(coalesce(new.proposal_id, old.proposal_id));
  return null;
end $$;
create trigger trg_proposal_items_recalc after insert or update or delete on public.proposal_items
  for each row execute function public.proposal_items_changed();

create or replace function public.proposal_discount_changed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.discount_type is distinct from old.discount_type or new.discount_value is distinct from old.discount_value then
    perform public.recalc_proposal(new.id);
  end if;
  return null;
end $$;
create trigger trg_proposal_discount after update of discount_type, discount_value on public.proposals
  for each row execute function public.proposal_discount_changed();

-- ---------------------------------------------------------------------------
-- Contratos: modelos com variáveis {{...}}, versões imutáveis e assinatura
-- por provedor externo (status só muda via webhook do provedor).
-- ---------------------------------------------------------------------------
create table public.contract_templates (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  category        public.project_category not null default 'other',
  body_html       text not null,                 -- cláusulas com {{variaveis}}
  is_archived     boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, id)
);
create trigger trg_contract_tpl_updated before update on public.contract_templates for each row execute function public.set_updated_at();

create type public.contract_status as enum ('draft', 'in_review', 'sent_for_signature', 'signed', 'cancelled', 'expired');

create table public.contracts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  number          int not null,
  client_id       uuid not null,
  proposal_id     uuid,
  template_id     uuid,
  title           text not null,
  status          public.contract_status not null default 'draft',
  current_version int not null default 1,
  signature_provider text,                       -- 'clicksign' | 'docusign' | 'zapsign' ...
  signature_envelope_id text,
  signed_at       timestamptz,
  client_visible  boolean not null default false,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, number),
  foreign key (organization_id, client_id) references public.clients(organization_id, id) on delete restrict,
  foreign key (organization_id, proposal_id) references public.proposals(organization_id, id) on delete set null (proposal_id),
  foreign key (organization_id, template_id) references public.contract_templates(organization_id, id) on delete set null (template_id)
);
create trigger trg_contracts_updated before update on public.contracts for each row execute function public.set_updated_at();
create trigger trg_contracts_log after insert or update or delete on public.contracts for each row execute function public.log_activity();

create or replace function public.contracts_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.number is null or new.number = 0 then
    select coalesce(max(number), 0) + 1 into new.number from public.contracts where organization_id = new.organization_id;
  end if;
  return new;
end $$;
create trigger trg_contracts_number before insert on public.contracts for each row execute function public.contracts_before_insert();

-- Contrato assinado não pode ter status alterado manualmente para trás.
create or replace function public.contracts_guard()
returns trigger language plpgsql as $$
begin
  if old.status = 'signed' and new.status <> 'signed' and new.status <> 'cancelled' then
    raise exception 'signed_contract_locked';
  end if;
  if new.status = 'signed' and old.status <> 'signed' and current_setting('nexo.signature_webhook', true) is distinct from 'on' then
    raise exception 'signature_requires_provider';
  end if;
  return new;
end $$;
create trigger trg_contracts_guard before update on public.contracts for each row execute function public.contracts_guard();

create table public.contract_versions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  contract_id     uuid not null,
  version         int not null,
  body_html       text not null,                -- já com variáveis resolvidas
  variables       jsonb not null default '{}'::jsonb,
  pdf_file_id     uuid,
  note            text,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (contract_id, version),
  foreign key (organization_id, contract_id) references public.contracts(organization_id, id) on delete cascade,
  foreign key (organization_id, pdf_file_id) references public.files(organization_id, id) on delete set null (pdf_file_id)
);
create or replace function public.contract_versions_immutable()
returns trigger language plpgsql as $$ begin raise exception 'contract_version_immutable'; end $$;
create trigger trg_contract_versions_immutable before update on public.contract_versions
  for each row execute function public.contract_versions_immutable();

alter table public.projects
  add constraint projects_proposal_fk foreign key (organization_id, proposal_id) references public.proposals(organization_id, id) on delete set null (proposal_id),
  add constraint projects_contract_fk foreign key (organization_id, contract_id) references public.contracts(organization_id, id) on delete set null (contract_id);

-- ---------------------------------------------------------------------------
-- Links seguros do portal
-- O token bruto (32 bytes aleatórios) é mostrado uma única vez; aqui fica só o
-- SHA-256. A validação é feita pela Edge Function `portal`, com service role.
-- ---------------------------------------------------------------------------
create table public.share_links (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id      uuid not null,
  token_hash      bytea not null unique,
  label           text,
  scopes          text[] not null default array['progress','tasks','files','approvals']::text[]
                  check (scopes <@ array['progress','tasks','files','approvals','moodboards','proposals','contracts','calendar','social']::text[]),
  allow_approvals boolean not null default true,
  expires_at      timestamptz,
  revoked_at      timestamptz,
  last_used_at    timestamptz,
  use_count       int not null default 0,
  created_by      uuid not null references auth.users(id),
  created_at      timestamptz not null default now(),
  foreign key (organization_id, project_id) references public.projects(organization_id, id) on delete cascade
);
create index idx_share_links_project on public.share_links(project_id);

alter table public.approval_events
  add constraint approval_events_share_link_fk foreign key (actor_share_link_id) references public.share_links(id) on delete set null;

-- Cria link: retorna o token bruto apenas uma vez.
create or replace function public.create_share_link(p_project uuid, p_label text, p_scopes text[], p_expires_at timestamptz, p_allow_approvals boolean default true)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare v_org uuid; v_token text;
begin
  select organization_id into v_org from public.projects where id = p_project;
  if v_org is null or not public.has_perm(v_org, 'portal.share') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_token := encode(gen_random_bytes(32), 'hex');
  insert into public.share_links (organization_id, project_id, token_hash, label, scopes, expires_at, allow_approvals, created_by)
  values (v_org, p_project, digest(v_token, 'sha256'), p_label, coalesce(p_scopes, array['progress','tasks','files','approvals']), p_expires_at, p_allow_approvals, auth.uid());
  return v_token;
end $$;

-- ---------------------------------------------------------------------------
-- Views do portal (cliente autenticado). Expõem apenas colunas seguras:
-- nada de valores contratados, custos, comentários internos ou outros clientes.
-- São security_invoker = false de propósito: filtram por is_client_user().
-- ---------------------------------------------------------------------------
create view public.portal_projects as
  select p.id, p.organization_id, p.client_id, p.name, p.category, p.description, p.objectives,
         p.start_date, p.due_date, p.status,
         (select round(100.0 * count(*) filter (where t.status = 'done') / nullif(count(*), 0))
            from public.tasks t where t.project_id = p.id and t.parent_id is null) as progress
  from public.projects p
  where public.client_can_see_project(p.id);

create view public.portal_tasks as
  select t.id, t.project_id, t.title, t.status, t.start_date, t.due_date, t.completed_at, t.position
  from public.tasks t
  where t.client_visible and t.parent_id is null and public.client_can_see_project(t.project_id);

create view public.portal_files as
  select f.id, f.project_id, f.name, f.mime_type, f.size_bytes, f.storage_path, f.version, f.created_at
  from public.files f
  where f.client_visible and f.project_id is not null and public.client_can_see_project(f.project_id);

create view public.portal_comments as
  select c.id, c.project_id, c.author_id, c.body, c.created_at
  from public.project_comments c
  where not c.is_internal and public.client_can_see_project(c.project_id);

create view public.portal_contracts as
  select c.id, c.client_id, c.number, c.title, c.status, c.signed_at, c.created_at
  from public.contracts c
  where c.client_visible and public.is_client_user(c.client_id);

create view public.portal_proposals as
  select pr.id, pr.client_id, pr.number, pr.title, pr.status, pr.intro, pr.scope, pr.deliverables,
         pr.terms, pr.revisions, pr.total, pr.installments, pr.valid_until, pr.sent_at
  from public.proposals pr
  where pr.status <> 'draft' and public.is_client_user(pr.client_id);

grant select on public.portal_projects, public.portal_tasks, public.portal_files,
  public.portal_comments, public.portal_contracts, public.portal_proposals to authenticated;

-- Comentário do cliente no projeto (sempre público, nunca interno).
create or replace function public.portal_add_comment(p_project uuid, p_body text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_org uuid;
begin
  if not public.client_can_see_project(p_project) then raise exception 'forbidden' using errcode = '42501'; end if;
  if length(trim(coalesce(p_body, ''))) = 0 or length(p_body) > 5000 then raise exception 'invalid_body'; end if;
  select organization_id into v_org from public.projects where id = p_project;
  insert into public.project_comments (organization_id, project_id, author_id, body, is_internal)
  values (v_org, p_project, auth.uid(), p_body, false) returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.services           enable row level security;
alter table public.proposals          enable row level security;
alter table public.proposal_items     enable row level security;
alter table public.contract_templates enable row level security;
alter table public.contracts          enable row level security;
alter table public.contract_versions  enable row level security;
alter table public.share_links        enable row level security;

create policy services_select on public.services for select using (public.is_org_member(organization_id));
create policy services_write on public.services for all
  using (public.has_perm(organization_id, 'settings.manage')) with check (public.has_perm(organization_id, 'settings.manage'));

create policy proposals_select on public.proposals for select using (public.has_perm(organization_id, 'proposals.read'));
create policy proposals_write on public.proposals for all
  using (public.has_perm(organization_id, 'proposals.write')) with check (public.has_perm(organization_id, 'proposals.write'));
create policy proposal_items_select on public.proposal_items for select using (
  public.has_perm(organization_id, 'proposals.read')
  or exists (select 1 from public.proposals p where p.id = proposal_id and p.status <> 'draft' and public.is_client_user(p.client_id)));
create policy proposal_items_write on public.proposal_items for all
  using (public.has_perm(organization_id, 'proposals.write')) with check (public.has_perm(organization_id, 'proposals.write'));

create policy ctpl_select on public.contract_templates for select using (public.has_perm(organization_id, 'contracts.read'));
create policy ctpl_write on public.contract_templates for all
  using (public.has_perm(organization_id, 'contracts.write')) with check (public.has_perm(organization_id, 'contracts.write'));
create policy contracts_select on public.contracts for select using (public.has_perm(organization_id, 'contracts.read'));
create policy contracts_write on public.contracts for all
  using (public.has_perm(organization_id, 'contracts.write')) with check (public.has_perm(organization_id, 'contracts.write'));
create policy cversions_select on public.contract_versions for select using (
  public.has_perm(organization_id, 'contracts.read')
  or exists (select 1 from public.contracts c where c.id = contract_id and c.client_visible and public.is_client_user(c.client_id)));
create policy cversions_insert on public.contract_versions for insert with check (public.has_perm(organization_id, 'contracts.write'));

-- Links: só a equipe com portal.share vê; o hash nunca sai para o cliente.
create policy share_select on public.share_links for select using (public.has_perm(organization_id, 'portal.share'));
create policy share_update on public.share_links for update
  using (public.has_perm(organization_id, 'portal.share')) with check (public.has_perm(organization_id, 'portal.share'));
create policy share_delete on public.share_links for delete using (public.has_perm(organization_id, 'portal.share'));
