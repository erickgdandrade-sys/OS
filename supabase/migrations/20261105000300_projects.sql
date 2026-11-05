-- =============================================================================
-- NEXO Studio OS — 0003 Projetos, tarefas, horas, arquivos e aprovações
-- =============================================================================

create type public.project_status as enum ('planning', 'active', 'on_hold', 'review', 'completed', 'cancelled');
create type public.task_status as enum ('todo', 'in_progress', 'review', 'blocked', 'done');
create type public.project_category as enum (
  'branding', 'naming', 'graphic_design', 'art_direction', 'photography', 'audiovisual',
  'social_media', 'digital_marketing', 'campaign', 'website', 'landing_page',
  'institutional', 'consulting', 'other');

-- ---------------------------------------------------------------------------
-- Modelos de projeto (por tipo de serviço) e suas tarefas-modelo
-- ---------------------------------------------------------------------------
create table public.project_templates (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  category        public.project_category not null,
  description     text,
  is_archived     boolean not null default false,
  created_at      timestamptz not null default now(),
  unique (organization_id, id)
);

create table public.project_template_tasks (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  template_id     uuid not null,
  position        int not null,
  title           text not null,
  description     text,
  offset_days     int not null default 0 check (offset_days >= 0),   -- início relativo ao projeto
  duration_days   int not null default 1 check (duration_days >= 1),
  estimated_hours numeric(7,2) check (estimated_hours >= 0),
  optional_key    text,               -- ex.: 'naming' — só criada se o serviço foi contratado
  client_visible  boolean not null default true,
  foreign key (organization_id, template_id) references public.project_templates(organization_id, id) on delete cascade
);
create index idx_tpl_tasks on public.project_template_tasks(template_id, position);

-- ---------------------------------------------------------------------------
-- Projetos
-- ---------------------------------------------------------------------------
create table public.projects (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id       uuid not null,
  name            text not null check (length(trim(name)) between 2 and 200),
  code            text,                         -- ex.: NX-2026-014
  category        public.project_category not null default 'other',
  description     text,
  objectives      text,
  scope           text,
  owner_id        uuid references auth.users(id) on delete set null,
  start_date      date,
  due_date        date,
  contracted_amount numeric(14,2) not null default 0 check (contracted_amount >= 0),
  status          public.project_status not null default 'planning',
  priority        public.priority_level not null default 'medium',
  template_id     uuid,
  proposal_id     uuid,     -- FK adicionada em 0004
  contract_id     uuid,     -- FK adicionada em 0004
  completed_at    timestamptz,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, id),
  check (due_date is null or start_date is null or due_date >= start_date),
  foreign key (organization_id, client_id) references public.clients(organization_id, id) on delete restrict,
  foreign key (organization_id, template_id) references public.project_templates(organization_id, id) on delete set null (template_id)
);
create index idx_projects_org_status on public.projects(organization_id, status);
create index idx_projects_client on public.projects(client_id);
create index idx_projects_due on public.projects(organization_id, due_date) where status not in ('completed', 'cancelled');
create trigger trg_projects_updated before update on public.projects for each row execute function public.set_updated_at();
create trigger trg_projects_log after insert or update or delete on public.projects for each row execute function public.log_activity();

create table public.project_members (
  organization_id uuid not null,
  project_id      uuid not null,
  user_id         uuid not null references auth.users(id) on delete cascade,
  role            text not null default 'member' check (role in ('lead', 'member', 'viewer')),
  created_at      timestamptz not null default now(),
  primary key (project_id, user_id),
  foreign key (organization_id, project_id) references public.projects(organization_id, id) on delete cascade
);
create index idx_project_members_user on public.project_members(user_id);

-- Acesso a um projeto: permissão global ou participação.
create or replace function public.can_access_project(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.projects p
    where p.id = p_project
      and public.is_org_member(p.organization_id)
      and (public.has_perm(p.organization_id, 'projects.read_all')
           or p.owner_id = auth.uid()
           or exists (select 1 from public.project_members pm where pm.project_id = p.id and pm.user_id = auth.uid())));
$$;

create or replace function public.can_edit_project(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.projects p
    where p.id = p_project
      and (public.has_perm(p.organization_id, 'projects.write')
           or p.owner_id = auth.uid()
           or exists (select 1 from public.project_members pm
                      where pm.project_id = p.id and pm.user_id = auth.uid() and pm.role = 'lead')));
$$;

-- ---------------------------------------------------------------------------
-- Tarefas e subtarefas (subtarefa = tarefa com parent_id; evita duas tabelas
-- com o mesmo formato). A view public.subtasks expõe só as subtarefas.
-- ---------------------------------------------------------------------------
create table public.tasks (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id      uuid not null,
  parent_id       uuid references public.tasks(id) on delete cascade,
  title           text not null check (length(trim(title)) between 1 and 300),
  description     text,
  status          public.task_status not null default 'todo',
  priority        public.priority_level not null default 'medium',
  assignee_id     uuid references auth.users(id) on delete set null,
  start_date      date,
  due_date        date,
  estimated_hours numeric(7,2) check (estimated_hours >= 0),
  position        double precision not null default 0,
  client_visible  boolean not null default false,   -- aparece no portal do cliente
  completed_at    timestamptz,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, id),
  check (parent_id is null or parent_id <> id),
  foreign key (organization_id, project_id) references public.projects(organization_id, id) on delete cascade
);
create index idx_tasks_project on public.tasks(project_id, status, position);
create index idx_tasks_assignee on public.tasks(assignee_id, status) where status <> 'done';
create index idx_tasks_parent on public.tasks(parent_id);
create trigger trg_tasks_updated before update on public.tasks for each row execute function public.set_updated_at();
create trigger trg_tasks_log after insert or update or delete on public.tasks for each row execute function public.log_activity();

-- Subtarefa precisa pertencer ao mesmo projeto da tarefa-mãe.
create or replace function public.tasks_guard()
returns trigger language plpgsql as $$
begin
  if new.parent_id is not null and not exists (
       select 1 from public.tasks t where t.id = new.parent_id and t.project_id = new.project_id) then
    raise exception 'parent_task_other_project';
  end if;
  if new.status = 'done' and (tg_op = 'INSERT' or old.status <> 'done') then
    new.completed_at := now();
  elsif new.status <> 'done' then
    new.completed_at := null;
  end if;
  return new;
end $$;
create trigger trg_tasks_guard before insert or update on public.tasks for each row execute function public.tasks_guard();

create view public.subtasks with (security_invoker = true) as
  select * from public.tasks where parent_id is not null;

create table public.task_dependencies (
  organization_id uuid not null,
  task_id         uuid not null,
  depends_on_id   uuid not null,
  primary key (task_id, depends_on_id),
  check (task_id <> depends_on_id),
  foreign key (organization_id, task_id) references public.tasks(organization_id, id) on delete cascade,
  foreign key (organization_id, depends_on_id) references public.tasks(organization_id, id) on delete cascade
);

create table public.task_comments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  task_id         uuid not null,
  author_id       uuid not null references auth.users(id) on delete cascade,
  body            text not null check (length(trim(body)) between 1 and 10000),
  is_internal     boolean not null default true,   -- comentário interno nunca vai ao portal
  created_at      timestamptz not null default now(),
  edited_at       timestamptz,
  foreign key (organization_id, task_id) references public.tasks(organization_id, id) on delete cascade
);
create index idx_task_comments_task on public.task_comments(task_id, created_at);

create table public.project_comments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id      uuid not null,
  author_id       uuid not null references auth.users(id) on delete cascade,
  body            text not null check (length(trim(body)) between 1 and 10000),
  is_internal     boolean not null default true,
  created_at      timestamptz not null default now(),
  foreign key (organization_id, project_id) references public.projects(organization_id, id) on delete cascade
);
create index idx_project_comments on public.project_comments(project_id, created_at);

create table public.time_entries (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id      uuid not null,
  task_id         uuid,
  user_id         uuid not null references auth.users(id) on delete cascade,
  work_date       date not null default (now() at time zone 'America/Sao_Paulo')::date,
  minutes         int not null check (minutes between 1 and 1440),
  note            text,
  hourly_cost     numeric(12,2),    -- custo/hora congelado no lançamento (rentabilidade)
  created_at      timestamptz not null default now(),
  foreign key (organization_id, project_id) references public.projects(organization_id, id) on delete cascade,
  foreign key (organization_id, task_id) references public.tasks(organization_id, id) on delete set null (task_id)
);
create index idx_time_project on public.time_entries(project_id, work_date);
create index idx_time_user on public.time_entries(user_id, work_date);

create or replace function public.time_entry_cost()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.hourly_cost is null then
    select m.hourly_cost into new.hourly_cost from public.organization_members m
    where m.organization_id = new.organization_id and m.user_id = new.user_id;
  end if;
  return new;
end $$;
create trigger trg_time_cost before insert on public.time_entries for each row execute function public.time_entry_cost();

-- ---------------------------------------------------------------------------
-- Arquivos (metadados; o binário fica no Supabase Storage, bucket privado
-- 'org-files', caminho {organization_id}/{uuid}/{nome}).
-- ---------------------------------------------------------------------------
create table public.files (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  storage_path    text not null unique,
  name            text not null,
  mime_type       text,
  size_bytes      bigint check (size_bytes >= 0),
  kind            text not null default 'file' check (kind in ('file', 'link')),
  external_url    text,
  folder          text,
  tags            text[] not null default '{}',
  client_id       uuid,
  project_id      uuid,
  task_id         uuid,
  version_of      uuid references public.files(id) on delete set null,
  version         int not null default 1,
  client_visible  boolean not null default false,
  uploaded_by     uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (organization_id, id),
  check (storage_path like organization_id::text || '/%'),
  foreign key (organization_id, client_id) references public.clients(organization_id, id) on delete cascade,
  foreign key (organization_id, project_id) references public.projects(organization_id, id) on delete cascade,
  foreign key (organization_id, task_id) references public.tasks(organization_id, id) on delete set null (task_id)
);
create index idx_files_project on public.files(project_id, created_at desc);
create index idx_files_client on public.files(client_id);
create index idx_files_tags on public.files using gin (tags);

-- ---------------------------------------------------------------------------
-- Aprovações (entregáveis, posts, propostas...). Histórico por versão.
-- ---------------------------------------------------------------------------
create type public.approval_status as enum ('pending', 'approved', 'changes_requested', 'cancelled');

create table public.approvals (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id      uuid not null,
  title           text not null,
  description     text,
  entity_type     text not null default 'deliverable' check (entity_type in ('deliverable', 'social_post', 'moodboard', 'naming', 'photo_selection', 'other')),
  entity_id       uuid,
  file_id         uuid,
  version         int not null default 1,
  status          public.approval_status not null default 'pending',
  requested_by    uuid references auth.users(id) on delete set null,
  due_date        date,
  created_at      timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, project_id) references public.projects(organization_id, id) on delete cascade,
  foreign key (organization_id, file_id) references public.files(organization_id, id) on delete set null (file_id)
);
create index idx_approvals_project on public.approvals(project_id, status);

-- Cada resposta (do cliente ou interna) fica registrada com data e usuário.
create table public.approval_events (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  approval_id     uuid not null,
  decision        public.approval_status not null check (decision in ('approved', 'changes_requested', 'pending')),
  comment         text,
  reference_file_id uuid,
  actor_user_id   uuid references auth.users(id) on delete set null,
  actor_share_link_id uuid,            -- quando a resposta vem por link seguro (ver 0004)
  actor_label     text,                -- nome informado no link
  created_at      timestamptz not null default now(),
  foreign key (organization_id, approval_id) references public.approvals(organization_id, id) on delete cascade,
  check (actor_user_id is not null or actor_share_link_id is not null)
);

create or replace function public.apply_approval_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.approvals set status = new.decision where id = new.approval_id;
  return new;
end $$;
create trigger trg_approval_event after insert on public.approval_events
  for each row execute function public.apply_approval_event();

-- Projeto de um cliente: o usuário do portal vê só os do seu cliente.
create or replace function public.client_can_see_project(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.projects p
                 where p.id = p_project and public.is_client_user(p.client_id)
                   and p.status <> 'cancelled');
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.project_templates      enable row level security;
alter table public.project_template_tasks enable row level security;
alter table public.projects               enable row level security;
alter table public.project_members        enable row level security;
alter table public.tasks                  enable row level security;
alter table public.task_dependencies      enable row level security;
alter table public.task_comments          enable row level security;
alter table public.project_comments       enable row level security;
alter table public.time_entries           enable row level security;
alter table public.files                  enable row level security;
alter table public.approvals              enable row level security;
alter table public.approval_events        enable row level security;

create policy tpl_select on public.project_templates for select using (public.is_org_member(organization_id));
create policy tpl_write on public.project_templates for all
  using (public.has_perm(organization_id, 'templates.manage')) with check (public.has_perm(organization_id, 'templates.manage'));
create policy tpl_tasks_select on public.project_template_tasks for select using (public.is_org_member(organization_id));
create policy tpl_tasks_write on public.project_template_tasks for all
  using (public.has_perm(organization_id, 'templates.manage')) with check (public.has_perm(organization_id, 'templates.manage'));

-- Projetos: equipe com acesso; cliente vê os seus (colunas sensíveis são
-- filtradas pela view portal_projects — ver 0004 — e o frontend do portal
-- nunca consulta a tabela diretamente).
-- Avaliada sobre as colunas da própria linha (não relê a tabela), para que
-- INSERT ... RETURNING funcione no mesmo comando.
create or replace function public.is_project_member(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.project_members pm where pm.project_id = p_project and pm.user_id = auth.uid());
$$;
create policy projects_select on public.projects for select using (
  public.is_org_member(organization_id)
  and (public.has_perm(organization_id, 'projects.read_all') or owner_id = auth.uid() or public.is_project_member(id)));
create policy projects_insert on public.projects for insert with check (public.has_perm(organization_id, 'projects.write'));
create policy projects_update on public.projects for update using (public.can_edit_project(id)) with check (public.can_edit_project(id));
create policy projects_delete on public.projects for delete using (public.has_perm(organization_id, 'projects.write'));

create policy pm_select on public.project_members for select using (public.can_access_project(project_id));
create policy pm_write on public.project_members for all using (public.can_edit_project(project_id)) with check (public.can_edit_project(project_id));

create policy tasks_select on public.tasks for select using (public.can_access_project(project_id));
create policy tasks_insert on public.tasks for insert with check (public.can_access_project(project_id)
  and (assignee_id is null or assignee_id = auth.uid() or public.has_perm(organization_id, 'tasks.assign') or public.can_edit_project(project_id)));
create policy tasks_update on public.tasks for update using (
  public.can_edit_project(project_id) or assignee_id = auth.uid() or created_by = auth.uid())
  with check (public.can_access_project(project_id));
create policy tasks_delete on public.tasks for delete using (public.can_edit_project(project_id) or created_by = auth.uid());

create policy deps_select on public.task_dependencies for select using (exists (select 1 from public.tasks t where t.id = task_id and public.can_access_project(t.project_id)));
create policy deps_write on public.task_dependencies for all
  using (exists (select 1 from public.tasks t where t.id = task_id and public.can_edit_project(t.project_id)))
  with check (exists (select 1 from public.tasks t where t.id = task_id and public.can_edit_project(t.project_id)));

create policy tcomments_select on public.task_comments for select using (exists (select 1 from public.tasks t where t.id = task_id and public.can_access_project(t.project_id)));
create policy tcomments_insert on public.task_comments for insert with check (author_id = auth.uid() and exists (select 1 from public.tasks t where t.id = task_id and public.can_access_project(t.project_id)));
create policy tcomments_update on public.task_comments for update using (author_id = auth.uid()) with check (author_id = auth.uid());
create policy tcomments_delete on public.task_comments for delete using (author_id = auth.uid());

create policy pcomments_select on public.project_comments for select using (public.can_access_project(project_id));
create policy pcomments_insert on public.project_comments for insert with check (author_id = auth.uid() and public.can_access_project(project_id));
create policy pcomments_delete on public.project_comments for delete using (author_id = auth.uid());

create policy time_select on public.time_entries for select using (
  user_id = auth.uid() or public.has_perm(organization_id, 'team.read') or public.has_perm(organization_id, 'finance.read'));
create policy time_insert on public.time_entries for insert with check (user_id = auth.uid() and public.can_access_project(project_id));
create policy time_update on public.time_entries for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy time_delete on public.time_entries for delete using (user_id = auth.uid() or public.has_perm(organization_id, 'projects.write'));

create policy files_select on public.files for select using (
  (project_id is not null and public.can_access_project(project_id))
  or (project_id is null and public.is_org_member(organization_id))
  or (client_visible and project_id is not null and public.client_can_see_project(project_id)));
create policy files_insert on public.files for insert with check (
  uploaded_by = auth.uid() and public.is_org_member(organization_id)
  and (project_id is null or public.can_access_project(project_id)));
create policy files_update on public.files for update using (uploaded_by = auth.uid() or (project_id is not null and public.can_edit_project(project_id)))
  with check (public.is_org_member(organization_id));
create policy files_delete on public.files for delete using (uploaded_by = auth.uid() or (project_id is not null and public.can_edit_project(project_id)));

create policy approvals_select on public.approvals for select using (public.can_access_project(project_id) or public.client_can_see_project(project_id));
create policy approvals_write on public.approvals for all using (public.can_edit_project(project_id) or public.has_perm(organization_id, 'portal.share'))
  with check (public.can_access_project(project_id));

create policy approval_events_select on public.approval_events for select using (
  exists (select 1 from public.approvals a where a.id = approval_id
          and (public.can_access_project(a.project_id) or public.client_can_see_project(a.project_id))));
-- Cliente autenticado responde às aprovações dos seus projetos; equipe também pode registrar.
create policy approval_events_insert on public.approval_events for insert with check (
  actor_user_id = auth.uid() and exists (select 1 from public.approvals a where a.id = approval_id and a.status = 'pending'
          and (public.can_access_project(a.project_id) or public.client_can_see_project(a.project_id))));
