-- =============================================================================
-- NEXO Studio OS — 0001 Fundação
-- Organizações (multi-tenant), perfis, membros, papéis (RBAC), permissões
-- configuráveis, convites, log de atividades e funções de autorização usadas
-- por todas as políticas RLS.
-- =============================================================================

create extension if not exists pgcrypto;
create extension if not exists citext;

-- ---------------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------------
create type public.org_role as enum ('admin', 'manager', 'member', 'finance', 'external');
create type public.member_status as enum ('invited', 'active', 'disabled');
create type public.priority_level as enum ('low', 'medium', 'high', 'urgent');

-- ---------------------------------------------------------------------------
-- Utilitários
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Organizações (estúdios)
-- ---------------------------------------------------------------------------
create table public.organizations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (length(trim(name)) between 2 and 120),
  slug          citext not null unique check (slug ~ '^[a-z0-9-]{2,60}$'),
  legal_name    text,
  document      text,                      -- CNPJ/CPF do estúdio
  email         citext,
  phone         text,
  address       jsonb not null default '{}'::jsonb,
  bank_details  jsonb not null default '{}'::jsonb,  -- visível só para quem tem settings.manage
  branding      jsonb not null default '{}'::jsonb,  -- tokens de cor, logo (path no storage)
  locale        text not null default 'pt-BR',
  currency      char(3) not null default 'BRL',
  timezone      text not null default 'America/Sao_Paulo',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger trg_organizations_updated before update on public.organizations
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Perfis (1:1 com auth.users). Nunca guarda senha.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  full_name     text not null default '',
  avatar_path   text,
  phone         text,
  theme         text not null default 'system' check (theme in ('light', 'dark', 'system')),
  last_seen_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger trg_profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();

-- Cria o perfil automaticamente quando um usuário é criado no Supabase Auth.
create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ---------------------------------------------------------------------------
-- Membros da organização (equipe interna)
-- ---------------------------------------------------------------------------
create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  role            public.org_role not null default 'member',
  job_title       text,                    -- Designer, Fotógrafo, Videomaker, Social media...
  status          public.member_status not null default 'active',
  weekly_capacity_hours numeric(5,1) not null default 40 check (weekly_capacity_hours between 0 and 168),
  hourly_cost     numeric(12,2) check (hourly_cost >= 0),  -- custo interno/hora (financeiro)
  invited_by      uuid references auth.users(id),
  joined_at       timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index idx_org_members_user on public.organization_members(user_id);
create trigger trg_org_members_updated before update on public.organization_members
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Permissões configuráveis
--   role_permissions: padrão por papel e organização (editável pelo admin)
--   member_permissions: exceções por pessoa (concede ou revoga)
-- O papel 'admin' sempre tem todas as permissões.
-- ---------------------------------------------------------------------------
create table public.permissions (
  key          text primary key,
  module       text not null,
  description  text not null
);

insert into public.permissions (key, module, description) values
  ('dashboard.view',      'dashboard',  'Ver dashboard operacional'),
  ('clients.read',        'crm',        'Ver clientes'),
  ('clients.write',       'crm',        'Criar e editar clientes'),
  ('crm.read',            'crm',        'Ver pipeline comercial e leads'),
  ('crm.write',           'crm',        'Gerenciar leads e oportunidades'),
  ('projects.read_all',   'projects',   'Ver todos os projetos (não só os que participa)'),
  ('projects.write',      'projects',   'Criar e editar projetos'),
  ('tasks.assign',        'projects',   'Atribuir tarefas a outras pessoas'),
  ('templates.manage',    'projects',   'Gerenciar modelos de projeto'),
  ('proposals.read',      'commercial', 'Ver propostas'),
  ('proposals.write',     'commercial', 'Criar e editar propostas'),
  ('contracts.read',      'commercial', 'Ver contratos'),
  ('contracts.write',     'commercial', 'Criar e editar contratos'),
  ('finance.read',        'finance',    'Ver financeiro'),
  ('finance.write',       'finance',    'Lançar e editar financeiro'),
  ('reports.read',        'reports',    'Ver relatórios'),
  ('team.read',           'team',       'Ver equipe e carga de trabalho'),
  ('users.manage',        'settings',   'Convidar, editar e desativar usuários'),
  ('settings.manage',     'settings',   'Configurações do estúdio, integrações e permissões'),
  ('portal.share',        'portal',     'Compartilhar conteúdos com clientes'),
  ('creative.write',      'creative',   'Branding, naming, moodboards, social e audiovisual'),
  ('ai.use',              'ai',         'Usar o assistente de IA');

create table public.role_permissions (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  role            public.org_role not null,
  permission      text not null references public.permissions(key) on delete cascade,
  primary key (organization_id, role, permission)
);

create table public.member_permissions (
  organization_id uuid not null,
  user_id         uuid not null,
  permission      text not null references public.permissions(key) on delete cascade,
  granted         boolean not null,
  primary key (organization_id, user_id, permission),
  foreign key (organization_id, user_id)
    references public.organization_members(organization_id, user_id) on delete cascade
);

-- Padrões ao criar uma organização.
create or replace function public.seed_default_role_permissions(p_org uuid)
returns void language sql security definer set search_path = public as $$
  insert into public.role_permissions (organization_id, role, permission)
  select p_org, r.role::public.org_role, r.permission
  from (values
    ('manager','dashboard.view'),('manager','clients.read'),('manager','clients.write'),
    ('manager','crm.read'),('manager','crm.write'),('manager','projects.read_all'),
    ('manager','projects.write'),('manager','tasks.assign'),('manager','templates.manage'),
    ('manager','proposals.read'),('manager','proposals.write'),('manager','contracts.read'),
    ('manager','reports.read'),('manager','team.read'),('manager','portal.share'),
    ('manager','creative.write'),('manager','ai.use'),
    ('member','dashboard.view'),('member','clients.read'),('member','creative.write'),('member','ai.use'),
    ('finance','dashboard.view'),('finance','clients.read'),('finance','finance.read'),
    ('finance','finance.write'),('finance','reports.read'),('finance','proposals.read'),
    ('finance','contracts.read'),
    ('external','dashboard.view')
  ) as r(role, permission)
  on conflict do nothing;
$$;

-- ---------------------------------------------------------------------------
-- Funções de autorização (SECURITY DEFINER para não recursar em RLS)
-- ---------------------------------------------------------------------------
create or replace function public.current_member_role(p_org uuid)
returns public.org_role language sql stable security definer set search_path = public as $$
  select m.role from public.organization_members m
  where m.organization_id = p_org and m.user_id = auth.uid() and m.status = 'active';
$$;

create or replace function public.is_org_member(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = p_org and m.user_id = auth.uid() and m.status = 'active');
$$;

create or replace function public.has_perm(p_org uuid, p_perm text)
returns boolean language sql stable security definer set search_path = public as $$
  with me as (
    select m.role from public.organization_members m
    where m.organization_id = p_org and m.user_id = auth.uid() and m.status = 'active'
  )
  select case
    when not exists (select 1 from me) then false
    when (select role from me) = 'admin' then true
    when exists (select 1 from public.member_permissions mp
                 where mp.organization_id = p_org and mp.user_id = auth.uid()
                   and mp.permission = p_perm) then
      (select mp.granted from public.member_permissions mp
       where mp.organization_id = p_org and mp.user_id = auth.uid() and mp.permission = p_perm)
    else exists (select 1 from public.role_permissions rp, me
                 where rp.organization_id = p_org and rp.role = me.role and rp.permission = p_perm)
  end;
$$;

-- Lista de permissões efetivas do usuário logado (usada pelo frontend para montar o menu).
create or replace function public.my_permissions(p_org uuid)
returns setof text language sql stable security definer set search_path = public as $$
  select p.key from public.permissions p where public.has_perm(p_org, p.key);
$$;

-- ---------------------------------------------------------------------------
-- Convites (o cadastro de colaboradores é sempre por convite)
-- O envio do e-mail e a criação do usuário acontecem na Edge Function
-- `invite-member`, que usa a service role no servidor.
-- ---------------------------------------------------------------------------
create table public.invitations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email           citext not null,
  role            public.org_role not null default 'member',
  job_title       text,
  invited_by      uuid not null references auth.users(id),
  accepted_at     timestamptz,
  revoked_at      timestamptz,
  expires_at      timestamptz not null default now() + interval '7 days',
  created_at      timestamptz not null default now()
);
create unique index uq_invitation_pending on public.invitations(organization_id, email)
  where accepted_at is null and revoked_at is null;

-- ---------------------------------------------------------------------------
-- Log de atividades (auditoria). Só é escrito por triggers/funções.
-- ---------------------------------------------------------------------------
create table public.activity_logs (
  id              bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id        uuid references auth.users(id) on delete set null,
  entity_type     text not null,
  entity_id       uuid,
  action          text not null,           -- insert | update | delete | login | status_change ...
  changes         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);
create index idx_activity_org_entity on public.activity_logs(organization_id, entity_type, entity_id, created_at desc);

-- Trigger genérico de auditoria: registra campos alterados.
create or replace function public.log_activity()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_id uuid;
  v_changes jsonb := '{}'::jsonb;
  k text;
begin
  if tg_op = 'DELETE' then
    v_org := old.organization_id; v_id := old.id;
  else
    v_org := new.organization_id; v_id := new.id;
  end if;
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(to_jsonb(new)) loop
      if k not in ('updated_at') and (to_jsonb(new) -> k) is distinct from (to_jsonb(old) -> k) then
        v_changes := v_changes || jsonb_build_object(k, jsonb_build_object('from', to_jsonb(old) -> k, 'to', to_jsonb(new) -> k));
      end if;
    end loop;
    if v_changes = '{}'::jsonb then return new; end if;
  end if;
  insert into public.activity_logs (organization_id, actor_id, entity_type, entity_id, action, changes)
  values (v_org, auth.uid(), tg_table_name, v_id, lower(tg_op), v_changes);
  return coalesce(new, old);
end $$;

-- ---------------------------------------------------------------------------
-- Criação de organização: quem cria vira admin (usado no primeiro acesso).
-- Só é permitido se o usuário ainda não pertence a nenhuma organização, para
-- impedir que qualquer conta crie estúdios livremente após o bootstrap.
-- ---------------------------------------------------------------------------
create or replace function public.create_organization(p_name text, p_slug text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if exists (select 1 from public.organization_members where user_id = auth.uid()) then
    raise exception 'already_member' using errcode = '42501';
  end if;
  if exists (select 1 from public.client_users where user_id = auth.uid()) then
    raise exception 'client_account' using errcode = '42501';
  end if;
  insert into public.organizations (name, slug) values (p_name, lower(p_slug)) returning id into v_org;
  insert into public.organization_members (organization_id, user_id, role, status, joined_at)
  values (v_org, auth.uid(), 'admin', 'active', now());
  perform public.seed_default_role_permissions(v_org);
  return v_org;
end $$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.organizations        enable row level security;
alter table public.profiles             enable row level security;
alter table public.organization_members enable row level security;
alter table public.permissions          enable row level security;
alter table public.role_permissions     enable row level security;
alter table public.member_permissions   enable row level security;
alter table public.invitations          enable row level security;
alter table public.activity_logs        enable row level security;

create policy org_select on public.organizations for select using (public.is_org_member(id));
create policy org_update on public.organizations for update
  using (public.has_perm(id, 'settings.manage')) with check (public.has_perm(id, 'settings.manage'));

-- Perfis: o próprio usuário e colegas da mesma organização.
create policy profiles_select on public.profiles for select using (
  id = auth.uid() or exists (
    select 1 from public.organization_members a
    join public.organization_members b on b.organization_id = a.organization_id
    where a.user_id = auth.uid() and a.status = 'active' and b.user_id = profiles.id));
create policy profiles_update_self on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

create policy members_select on public.organization_members for select
  using (public.is_org_member(organization_id));
create policy members_write on public.organization_members for update
  using (public.has_perm(organization_id, 'users.manage'))
  with check (public.has_perm(organization_id, 'users.manage'));
create policy members_delete on public.organization_members for delete
  using (public.has_perm(organization_id, 'users.manage') and user_id <> auth.uid());

-- Um admin não pode rebaixar/desativar a si mesmo nem deixar a organização sem admin.
create or replace function public.guard_last_admin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'DELETE' and old.role = 'admin')
     or (tg_op = 'UPDATE' and old.role = 'admin' and (new.role <> 'admin' or new.status <> 'active')) then
    if not exists (select 1 from public.organization_members
                   where organization_id = old.organization_id and role = 'admin' and status = 'active'
                     and user_id <> old.user_id) then
      raise exception 'last_admin' using errcode = '42501';
    end if;
  end if;
  return coalesce(new, old);
end $$;
create trigger trg_guard_last_admin before update or delete on public.organization_members
  for each row execute function public.guard_last_admin();

create policy permissions_read on public.permissions for select using (auth.uid() is not null);
create policy role_perms_select on public.role_permissions for select using (public.is_org_member(organization_id));
create policy role_perms_write on public.role_permissions for all
  using (public.has_perm(organization_id, 'settings.manage'))
  with check (public.has_perm(organization_id, 'settings.manage'));
create policy member_perms_select on public.member_permissions for select using (public.is_org_member(organization_id));
create policy member_perms_write on public.member_permissions for all
  using (public.has_perm(organization_id, 'users.manage'))
  with check (public.has_perm(organization_id, 'users.manage'));

create policy invitations_select on public.invitations for select using (public.has_perm(organization_id, 'users.manage'));
create policy invitations_update on public.invitations for update
  using (public.has_perm(organization_id, 'users.manage')) with check (public.has_perm(organization_id, 'users.manage'));

create policy activity_select on public.activity_logs for select using (
  public.has_perm(organization_id, 'users.manage')
  or (public.is_org_member(organization_id) and actor_id = auth.uid()));
