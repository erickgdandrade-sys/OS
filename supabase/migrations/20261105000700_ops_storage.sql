-- =============================================================================
-- NEXO Studio OS — 0007 Calendário, reuniões, notificações, automações,
-- integrações, IA e Storage
-- =============================================================================

create table public.meetings (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title           text not null,
  starts_at       timestamptz not null,
  ends_at         timestamptz,
  location        text,
  client_id       uuid,
  lead_id         uuid,
  project_id      uuid,
  attendees       uuid[] not null default '{}',
  notes           text,
  summary         text,           -- resumo (pode ser gerado pela IA)
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  check (ends_at is null or ends_at >= starts_at),
  foreign key (organization_id, client_id) references public.clients(organization_id, id) on delete cascade,
  foreign key (organization_id, lead_id) references public.leads(organization_id, id) on delete cascade,
  foreign key (organization_id, project_id) references public.projects(organization_id, id) on delete cascade
);
create index idx_meetings_org_time on public.meetings(organization_id, starts_at);

-- Compromissos internos avulsos (o calendário geral agrega tudo pela view abaixo).
create table public.calendar_events (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title           text not null,
  category        text not null default 'internal' check (category in ('internal', 'delivery', 'shoot', 'recording', 'other')),
  starts_at       timestamptz not null,
  ends_at         timestamptz,
  all_day         boolean not null default false,
  project_id      uuid,
  owner_id        uuid references auth.users(id) on delete set null,
  external_ref    text,           -- id do evento no Google Calendar quando sincronizado
  created_at      timestamptz not null default now(),
  foreign key (organization_id, project_id) references public.projects(organization_id, id) on delete cascade
);

create view public.calendar_feed with (security_invoker = true) as
  select 'task:' || t.id as uid, t.organization_id, 'task' as source, t.title, t.due_date::timestamptz as starts_at, null::timestamptz as ends_at, true as all_day, t.project_id, t.assignee_id as owner_id
    from public.tasks t where t.due_date is not null and t.status <> 'done'
  union all
  select 'project:' || p.id, p.organization_id, 'delivery', 'Entrega: ' || p.name, p.due_date::timestamptz, null, true, p.id, p.owner_id
    from public.projects p where p.due_date is not null and p.status not in ('completed', 'cancelled')
  union all
  select 'meeting:' || m.id, m.organization_id, 'meeting', m.title, m.starts_at, m.ends_at, false, m.project_id, m.created_by
    from public.meetings m
  union all
  select 'production:' || mp.id, mp.organization_id, case when mp.kind like 'photo%' then 'shoot' else 'recording' end, mp.title, mp.starts_at, mp.ends_at, false, mp.project_id, null
    from public.media_productions mp where mp.starts_at is not null
  union all
  select 'post:' || sp.id, sp.organization_id, 'publication', coalesce(sp.theme, 'Publicação'), sp.scheduled_for, null, false, sp.project_id, sp.assignee_id
    from public.social_posts sp where sp.scheduled_for is not null
  union all
  select 'approval:' || a.id, a.organization_id, 'approval', 'Aprovação: ' || a.title, a.due_date::timestamptz, null, true, a.project_id, a.requested_by
    from public.approvals a where a.due_date is not null and a.status = 'pending'
  union all
  select 'event:' || e.id, e.organization_id, e.category, e.title, e.starts_at, e.ends_at, e.all_day, e.project_id, e.owner_id
    from public.calendar_events e;

-- Notificações internas
create table public.notifications (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  kind            text not null,   -- task_assigned, deadline_soon, project_late, approval_approved, approval_changes, proposal_viewed, contract_signed, payment_received, bill_overdue
  title           text not null,
  body            text,
  link            text,            -- rota interna, sem dados sensíveis
  read_at         timestamptz,
  created_at      timestamptz not null default now()
);
create index idx_notifications_user on public.notifications(user_id, read_at, created_at desc);

create or replace function public.notify(p_org uuid, p_user uuid, p_kind text, p_title text, p_body text, p_link text)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (organization_id, user_id, kind, title, body, link)
  select p_org, p_user, p_kind, p_title, p_body, p_link
  where p_user is not null and p_user is distinct from auth.uid();
$$;

-- Nova tarefa atribuída
create or replace function public.notify_task_assigned()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.assignee_id is not null and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id) then
    perform public.notify(new.organization_id, new.assignee_id, 'task_assigned', 'Nova tarefa: ' || new.title, null, '/projetos/' || new.project_id);
  end if;
  return new;
end $$;
create trigger trg_notify_task after insert or update of assignee_id on public.tasks for each row execute function public.notify_task_assigned();

-- Cliente respondeu aprovação → avisa quem pediu e o responsável do projeto
create or replace function public.notify_approval_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare a public.approvals; p public.projects;
begin
  select * into a from public.approvals where id = new.approval_id;
  select * into p from public.projects where id = a.project_id;
  if new.decision in ('approved', 'changes_requested') then
    perform public.notify(a.organization_id, a.requested_by,
      case new.decision when 'approved' then 'approval_approved' else 'approval_changes' end,
      case new.decision when 'approved' then 'Material aprovado: ' else 'Alteração solicitada: ' end || a.title,
      new.comment, '/projetos/' || a.project_id);
    if p.owner_id is distinct from a.requested_by then
      perform public.notify(a.organization_id, p.owner_id,
        case new.decision when 'approved' then 'approval_approved' else 'approval_changes' end,
        case new.decision when 'approved' then 'Material aprovado: ' else 'Alteração solicitada: ' end || a.title,
        new.comment, '/projetos/' || a.project_id);
    end if;
  end if;
  return new;
end $$;
create trigger trg_notify_approval after insert on public.approval_events for each row execute function public.notify_approval_event();

-- Automações configuráveis (gatilho → lista de ações executadas pela Edge
-- Function `automations` ou por funções SQL como approve_proposal).
create table public.automations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  trigger_event   text not null check (trigger_event in ('proposal_approved', 'task_overdue', 'project_created', 'approval_answered', 'payment_received', 'receivable_overdue')),
  conditions      jsonb not null default '{}'::jsonb,
  actions         jsonb not null default '[]'::jsonb,
  is_active       boolean not null default true,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now()
);

-- Integrações: configuração sem segredos. Tokens OAuth ficam no Supabase Vault
-- (secret_id) e só são lidos por Edge Functions com service role.
create table public.integrations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider        text not null check (provider in ('google_calendar', 'meta', 'instagram', 'facebook', 'linkedin', 'clicksign', 'docusign', 'zapsign', 'resend', 'llm')),
  status          text not null default 'disconnected' check (status in ('disconnected', 'connected', 'error')),
  config          jsonb not null default '{}'::jsonb,
  vault_secret_id uuid,
  connected_by    uuid references auth.users(id) on delete set null,
  connected_at    timestamptz,
  last_error      text,
  unique (organization_id, provider)
);

-- IA
create table public.ai_conversations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  project_id      uuid,
  client_id       uuid,
  title           text,
  created_at      timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, project_id) references public.projects(organization_id, id) on delete cascade,
  foreign key (organization_id, client_id) references public.clients(organization_id, id) on delete cascade
);
create table public.ai_messages (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  conversation_id uuid not null,
  role            text not null check (role in ('user', 'assistant', 'system')),
  content         text not null,
  model           text,
  tokens_in       int,
  tokens_out      int,
  created_at      timestamptz not null default now(),
  foreign key (organization_id, conversation_id) references public.ai_conversations(organization_id, id) on delete cascade
);

-- RLS
alter table public.meetings          enable row level security;
alter table public.calendar_events   enable row level security;
alter table public.notifications     enable row level security;
alter table public.automations       enable row level security;
alter table public.integrations      enable row level security;
alter table public.ai_conversations  enable row level security;
alter table public.ai_messages       enable row level security;

create policy meetings_select on public.meetings for select using (
  public.has_perm(organization_id, 'crm.read') or auth.uid() = any(attendees)
  or (project_id is not null and public.can_access_project(project_id)));
create policy meetings_write on public.meetings for all
  using (public.is_org_member(organization_id) and (created_by = auth.uid() or public.has_perm(organization_id, 'crm.write')))
  with check (public.is_org_member(organization_id));

create policy cal_select on public.calendar_events for select using (
  public.is_org_member(organization_id) and (project_id is null or public.can_access_project(project_id)));
create policy cal_write on public.calendar_events for all
  using (public.is_org_member(organization_id) and (owner_id = auth.uid() or public.has_perm(organization_id, 'projects.write')))
  with check (public.is_org_member(organization_id));

create policy notif_select on public.notifications for select using (user_id = auth.uid());
create policy notif_update on public.notifications for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notif_delete on public.notifications for delete using (user_id = auth.uid());

create policy automations_select on public.automations for select using (public.is_org_member(organization_id));
create policy automations_write on public.automations for all
  using (public.has_perm(organization_id, 'settings.manage')) with check (public.has_perm(organization_id, 'settings.manage'));

create policy integrations_select on public.integrations for select using (public.has_perm(organization_id, 'settings.manage'));
create policy integrations_write on public.integrations for all
  using (public.has_perm(organization_id, 'settings.manage')) with check (public.has_perm(organization_id, 'settings.manage'));

create policy ai_conv_all on public.ai_conversations for all
  using (user_id = auth.uid() and public.has_perm(organization_id, 'ai.use'))
  with check (user_id = auth.uid() and public.has_perm(organization_id, 'ai.use')
              and (project_id is null or public.can_access_project(project_id)));
create policy ai_msg_select on public.ai_messages for select using (
  exists (select 1 from public.ai_conversations c where c.id = conversation_id and c.user_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- Storage: bucket privado. Caminho {organization_id}/{...}. O acesso ao objeto
-- exige registro em public.files visível para o usuário (mesma regra da tabela).
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('org-files', 'org-files', false, 524288000)
on conflict (id) do nothing;

create policy "org-files read" on storage.objects for select to authenticated using (
  bucket_id = 'org-files' and exists (select 1 from public.files f where f.storage_path = storage.objects.name));
create policy "org-files upload" on storage.objects for insert to authenticated with check (
  bucket_id = 'org-files' and public.is_org_member(((storage.foldername(name))[1])::uuid));
create policy "org-files delete" on storage.objects for delete to authenticated using (
  bucket_id = 'org-files' and exists (select 1 from public.files f where f.storage_path = storage.objects.name
    and (f.uploaded_by = auth.uid() or (f.project_id is not null and public.can_edit_project(f.project_id)))));

-- ---------------------------------------------------------------------------
-- Dashboard: indicadores calculados no servidor, respeitando permissões.
-- Valores financeiros só retornam para quem tem finance.read.
-- ---------------------------------------------------------------------------
create or replace function public.dashboard_summary(p_org uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  r jsonb;
  fin jsonb := null;
begin
  if not public.has_perm(p_org, 'dashboard.view') then raise exception 'forbidden' using errcode = '42501'; end if;
  select jsonb_build_object(
    'projects_active',    (select count(*) from public.projects where organization_id = p_org and status in ('planning','active','review','on_hold')),
    'projects_completed', (select count(*) from public.projects where organization_id = p_org and status = 'completed' and completed_at::date between p_from and p_to),
    'projects_late',      (select count(*) from public.projects where organization_id = p_org and status not in ('completed','cancelled') and due_date < v_today),
    'tasks_open',         (select count(*) from public.tasks where organization_id = p_org and status <> 'done'),
    'tasks_done',         (select count(*) from public.tasks where organization_id = p_org and status = 'done' and completed_at::date between p_from and p_to),
    'my_tasks_open',      (select count(*) from public.tasks where organization_id = p_org and status <> 'done' and assignee_id = auth.uid()),
    'clients_active',     (select count(*) from public.clients where organization_id = p_org and status = 'active'),
    'leads_open',         (select count(*) from public.opportunities o join public.pipeline_stages s on s.id = o.stage_id where o.organization_id = p_org and s.kind = 'open'),
    'approvals_pending',  (select count(*) from public.approvals where organization_id = p_org and status = 'pending'),
    'minutes_worked',     (select coalesce(sum(minutes), 0) from public.time_entries where organization_id = p_org and work_date between p_from and p_to),
    'upcoming',           (select coalesce(jsonb_agg(x order by x.due_date), '[]'::jsonb) from (
                             select t.id, t.title, t.due_date, t.project_id, pr.name as project_name, t.assignee_id
                             from public.tasks t join public.projects pr on pr.id = t.project_id
                             where t.organization_id = p_org and t.status <> 'done' and t.due_date between v_today and v_today + 14
                             order by t.due_date limit 8) x),
    'by_category',        (select coalesce(jsonb_agg(jsonb_build_object('category', category, 'count', n)), '[]'::jsonb) from (
                             select category, count(*) n from public.projects where organization_id = p_org and status not in ('cancelled') group by category) c),
    'productivity',       (select coalesce(jsonb_agg(jsonb_build_object('user_id', assignee_id, 'done', n)), '[]'::jsonb) from (
                             select assignee_id, count(*) n from public.tasks where organization_id = p_org and status = 'done'
                               and completed_at::date between p_from and p_to and assignee_id is not null group by assignee_id) pdt)
  ) into r;

  if public.has_perm(p_org, 'finance.read') then
    select jsonb_build_object(
      'received',       (select coalesce(sum(amount), 0) from public.transactions where organization_id = p_org and direction = 'in' and occurred_on between p_from and p_to),
      'paid',           (select coalesce(sum(amount), 0) from public.transactions where organization_id = p_org and direction = 'out' and occurred_on between p_from and p_to),
      'billed_open',    (select coalesce(sum(amount), 0) from public.accounts_receivable where organization_id = p_org and status in ('open','overdue')),
      'overdue',        (select coalesce(sum(amount), 0) from public.accounts_receivable where organization_id = p_org and status = 'overdue'),
      'overdue_count',  (select count(*) from public.accounts_receivable where organization_id = p_org and status = 'overdue'),
      'scheduled',      (select coalesce(sum(amount), 0) from public.accounts_receivable where organization_id = p_org and status = 'scheduled'),
      'monthly',        (select coalesce(jsonb_agg(m order by m.month), '[]'::jsonb) from (
                           select to_char(date_trunc('month', occurred_on), 'YYYY-MM') as month,
                                  sum(amount) filter (where direction = 'in') as income,
                                  sum(amount) filter (where direction = 'out') as expense
                           from public.transactions where organization_id = p_org and occurred_on between p_from and p_to
                           group by 1) m),
      'profitability',  (select coalesce(jsonb_agg(pp order by pp.contracted_amount desc), '[]'::jsonb) from (
                           select project_id, name, contracted_amount, received_amount, projected_result, margin_pct
                           from public.project_profitability where organization_id = p_org and contracted_amount > 0
                           order by contracted_amount desc limit 8) pp)
    ) into fin;
  end if;
  return r || jsonb_build_object('finance', fin);
end $$;
