-- =============================================================================
-- NEXO Studio OS — 0002 Clientes e CRM
-- =============================================================================

create type public.client_status as enum ('lead', 'active', 'inactive');

create table public.clients (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  status          public.client_status not null default 'active',
  legal_name      text not null check (length(trim(legal_name)) between 2 and 200),  -- nome ou razão social
  trade_name      text,                      -- nome fantasia
  document        text,                      -- CPF/CNPJ (somente dígitos)
  email           citext,
  phone           text,
  whatsapp        text,
  website         text,
  segment         text,
  address         jsonb not null default '{}'::jsonb,
  social_links    jsonb not null default '{}'::jsonb,
  notes           text,
  owner_id        uuid references auth.users(id) on delete set null,  -- responsável interno
  converted_from_lead_id uuid,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, id),
  constraint clients_document_digits check (document is null or document ~ '^[0-9]{11}$|^[0-9]{14}$')
);
create index idx_clients_org on public.clients(organization_id, status);
create unique index uq_clients_document on public.clients(organization_id, document) where document is not null;
create index idx_clients_search on public.clients using gin (to_tsvector('portuguese', coalesce(legal_name,'') || ' ' || coalesce(trade_name,'')));
create trigger trg_clients_updated before update on public.clients for each row execute function public.set_updated_at();
create trigger trg_clients_log after insert or update or delete on public.clients for each row execute function public.log_activity();

create table public.client_contacts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  client_id       uuid not null,
  name            text not null,
  role            text,
  email           citext,
  phone           text,
  is_primary      boolean not null default false,
  created_at      timestamptz not null default now(),
  foreign key (organization_id, client_id) references public.clients(organization_id, id) on delete cascade
);
create index idx_client_contacts_client on public.client_contacts(client_id);

-- Contas de cliente para o portal (um auth.user pode ser contato de um cliente).
create table public.client_users (
  organization_id uuid not null,
  client_id       uuid not null,
  user_id         uuid not null references auth.users(id) on delete cascade,
  status          public.member_status not null default 'active',
  invited_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  primary key (client_id, user_id),
  foreign key (organization_id, client_id) references public.clients(organization_id, id) on delete cascade
);
create index idx_client_users_user on public.client_users(user_id);

create or replace function public.is_client_user(p_client uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.client_users cu
                 where cu.client_id = p_client and cu.user_id = auth.uid() and cu.status = 'active');
$$;

-- ---------------------------------------------------------------------------
-- Pipeline comercial (etapas configuráveis por organização)
-- ---------------------------------------------------------------------------
create table public.pipeline_stages (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  position        int not null,
  kind            text not null default 'open' check (kind in ('open', 'won', 'lost')),
  unique (organization_id, id),
  unique (organization_id, position) deferrable initially deferred
);

create or replace function public.seed_default_pipeline(p_org uuid)
returns void language sql security definer set search_path = public as $$
  insert into public.pipeline_stages (organization_id, name, position, kind) values
    (p_org, 'Novo lead', 1, 'open'), (p_org, 'Primeiro contato', 2, 'open'),
    (p_org, 'Reunião agendada', 3, 'open'), (p_org, 'Diagnóstico', 4, 'open'),
    (p_org, 'Proposta enviada', 5, 'open'), (p_org, 'Negociação', 6, 'open'),
    (p_org, 'Fechado', 7, 'won'), (p_org, 'Perdido', 8, 'lost');
$$;

-- Lead = pessoa/empresa ainda não cliente. Ao converter, o cliente é criado e o
-- lead guarda converted_client_id; atividades e reuniões continuam ligadas.
create table public.leads (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  company         text,
  email           citext,
  phone           text,
  source          text,
  notes           text,
  owner_id        uuid references auth.users(id) on delete set null,
  converted_client_id uuid,
  converted_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, converted_client_id) references public.clients(organization_id, id) on delete set null (converted_client_id)
);
create trigger trg_leads_updated before update on public.leads for each row execute function public.set_updated_at();

-- Oportunidade = um negócio no pipeline (de um lead ou de um cliente existente).
create table public.opportunities (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title           text not null,
  lead_id         uuid,
  client_id       uuid,
  stage_id        uuid not null,
  estimated_value numeric(14,2) check (estimated_value >= 0),
  expected_close  date,
  position        double precision not null default 0,
  lost_reason     text,
  owner_id        uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, id),
  check (lead_id is not null or client_id is not null),
  foreign key (organization_id, lead_id) references public.leads(organization_id, id) on delete cascade,
  foreign key (organization_id, client_id) references public.clients(organization_id, id) on delete cascade,
  foreign key (organization_id, stage_id) references public.pipeline_stages(organization_id, id)
);
create index idx_opps_stage on public.opportunities(organization_id, stage_id, position);
create trigger trg_opps_updated before update on public.opportunities for each row execute function public.set_updated_at();
create trigger trg_opps_log after insert or update or delete on public.opportunities for each row execute function public.log_activity();

-- Atividades comerciais: ligação, e-mail, nota, follow-up.
create table public.crm_activities (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind            text not null check (kind in ('call', 'email', 'whatsapp', 'note', 'follow_up', 'meeting')),
  subject         text not null,
  body            text,
  lead_id         uuid,
  client_id       uuid,
  opportunity_id  uuid,
  due_at          timestamptz,
  done_at         timestamptz,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  check (lead_id is not null or client_id is not null or opportunity_id is not null),
  foreign key (organization_id, lead_id) references public.leads(organization_id, id) on delete cascade,
  foreign key (organization_id, client_id) references public.clients(organization_id, id) on delete cascade,
  foreign key (organization_id, opportunity_id) references public.opportunities(organization_id, id) on delete cascade
);
create index idx_crm_act_client on public.crm_activities(client_id, created_at desc);
create index idx_crm_act_lead on public.crm_activities(lead_id, created_at desc);

-- Converte um lead em cliente mantendo o histórico.
create or replace function public.convert_lead_to_client(p_lead uuid)
returns uuid language plpgsql security invoker set search_path = public as $$
declare l public.leads; v_client uuid;
begin
  select * into l from public.leads where id = p_lead for update;
  if not found then raise exception 'lead_not_found'; end if;
  if l.converted_client_id is not null then return l.converted_client_id; end if;
  insert into public.clients (organization_id, legal_name, email, phone, notes, owner_id, converted_from_lead_id, created_by)
  values (l.organization_id, coalesce(nullif(l.company, ''), l.name), l.email, l.phone, l.notes, l.owner_id, l.id, auth.uid())
  returning id into v_client;
  insert into public.client_contacts (organization_id, client_id, name, email, phone, is_primary)
  values (l.organization_id, v_client, l.name, l.email, l.phone, true);
  update public.leads set converted_client_id = v_client, converted_at = now() where id = p_lead;
  update public.crm_activities set client_id = v_client where lead_id = p_lead and client_id is null;
  update public.opportunities set client_id = v_client where lead_id = p_lead and client_id is null;
  return v_client;
end $$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.clients          enable row level security;
alter table public.client_contacts  enable row level security;
alter table public.client_users     enable row level security;
alter table public.pipeline_stages  enable row level security;
alter table public.leads            enable row level security;
alter table public.opportunities    enable row level security;
alter table public.crm_activities   enable row level security;

create policy clients_select on public.clients for select using (
  public.has_perm(organization_id, 'clients.read') or public.is_client_user(id));
create policy clients_insert on public.clients for insert with check (public.has_perm(organization_id, 'clients.write'));
create policy clients_update on public.clients for update
  using (public.has_perm(organization_id, 'clients.write')) with check (public.has_perm(organization_id, 'clients.write'));
create policy clients_delete on public.clients for delete using (public.has_perm(organization_id, 'clients.write'));

create policy contacts_select on public.client_contacts for select using (public.has_perm(organization_id, 'clients.read'));
create policy contacts_write on public.client_contacts for all
  using (public.has_perm(organization_id, 'clients.write')) with check (public.has_perm(organization_id, 'clients.write'));

create policy client_users_select on public.client_users for select using (
  public.has_perm(organization_id, 'clients.read') or user_id = auth.uid());
create policy client_users_write on public.client_users for all
  using (public.has_perm(organization_id, 'portal.share')) with check (public.has_perm(organization_id, 'portal.share'));

create policy stages_select on public.pipeline_stages for select using (public.has_perm(organization_id, 'crm.read'));
create policy stages_write on public.pipeline_stages for all
  using (public.has_perm(organization_id, 'settings.manage')) with check (public.has_perm(organization_id, 'settings.manage'));

create policy leads_select on public.leads for select using (public.has_perm(organization_id, 'crm.read'));
create policy leads_write on public.leads for all
  using (public.has_perm(organization_id, 'crm.write')) with check (public.has_perm(organization_id, 'crm.write'));

create policy opps_select on public.opportunities for select using (public.has_perm(organization_id, 'crm.read'));
create policy opps_write on public.opportunities for all
  using (public.has_perm(organization_id, 'crm.write')) with check (public.has_perm(organization_id, 'crm.write'));

create policy crm_act_select on public.crm_activities for select using (
  public.has_perm(organization_id, 'crm.read') or public.has_perm(organization_id, 'clients.read'));
create policy crm_act_write on public.crm_activities for all
  using (public.has_perm(organization_id, 'crm.write')) with check (public.has_perm(organization_id, 'crm.write'));

-- Ao criar uma organização, também cria o pipeline padrão.
create or replace function public.after_org_created()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.seed_default_pipeline(new.id);
  return new;
end $$;
create trigger trg_org_seed_pipeline after insert on public.organizations
  for each row execute function public.after_org_created();
