-- =============================================================================
-- NEXO Studio OS — 0006 Criação: branding, naming, moodboards, social, audiovisual
-- Tabelas criadas na fundação para que as Fases 4–5 só adicionem telas.
-- =============================================================================

create table public.brand_briefings (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id      uuid not null unique,
  answers         jsonb not null default '{}'::jsonb,  -- história, propósito, missão, visão, valores, público, personas...
  status          text not null default 'draft' check (status in ('draft', 'sent_to_client', 'answered', 'validated')),
  client_form_enabled boolean not null default false,
  submitted_at    timestamptz,
  updated_by      uuid references auth.users(id) on delete set null,
  updated_at      timestamptz not null default now(),
  foreign key (organization_id, project_id) references public.projects(organization_id, id) on delete cascade
);

create table public.brand_competitors (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id      uuid not null,
  name            text not null,
  website         text,
  social_links    jsonb not null default '{}'::jsonb,
  description     text,
  differentials   text,
  positioning     text,
  notes           text,
  created_at      timestamptz not null default now(),
  foreign key (organization_id, project_id) references public.projects(organization_id, id) on delete cascade
);

create table public.naming_territories (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id      uuid not null,
  name            text not null,
  description     text,
  unique (organization_id, id),
  foreign key (organization_id, project_id) references public.projects(organization_id, id) on delete cascade
);

-- Critérios configuráveis por projeto (peso 0–10).
create table public.naming_criteria (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id      uuid not null,
  name            text not null,     -- sonoridade, memorabilidade, originalidade, adequação estratégica...
  weight          numeric(4,1) not null default 1 check (weight between 0 and 10),
  unique (organization_id, id),
  foreign key (organization_id, project_id) references public.projects(organization_id, id) on delete cascade
);

-- availability_status registra a ETAPA de validação; o sistema nunca afirma
-- disponibilidade jurídica sem pesquisa registrada (INPI, domínio, redes).
create table public.naming_candidates (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id      uuid not null,
  territory_id    uuid,
  name            text not null,
  category        text,
  meaning         text,
  etymology       text,
  rationale       text,
  is_finalist     boolean not null default false,
  availability_status text not null default 'not_checked'
    check (availability_status in ('not_checked', 'preliminary_search_done', 'conflict_found', 'sent_to_legal_review', 'cleared_by_legal')),
  availability_notes text,
  availability_checked_by uuid references auth.users(id) on delete set null,
  availability_checked_at timestamptz,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, project_id) references public.projects(organization_id, id) on delete cascade,
  foreign key (organization_id, territory_id) references public.naming_territories(organization_id, id) on delete set null (territory_id),
  check (availability_status <> 'cleared_by_legal' or availability_notes is not null)
);

create table public.naming_scores (
  organization_id uuid not null,
  candidate_id    uuid not null,
  criterion_id    uuid not null,
  scorer_id       uuid not null references auth.users(id) on delete cascade,
  score           int not null check (score between 0 and 10),
  primary key (candidate_id, criterion_id, scorer_id),
  foreign key (organization_id, candidate_id) references public.naming_candidates(organization_id, id) on delete cascade,
  foreign key (organization_id, criterion_id) references public.naming_criteria(organization_id, id) on delete cascade
);

-- Moodboards / painéis semânticos (canvas livre).
create table public.moodboards (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id      uuid not null,
  title           text not null,
  kind            text not null default 'moodboard' check (kind in ('visual_references', 'semantic_universe', 'art_direction', 'moodboard', 'creative_concept', 'color_palette', 'typography', 'brand_applications')),
  viewport        jsonb not null default '{"x":0,"y":0,"zoom":1}'::jsonb,
  client_visible  boolean not null default false,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, project_id) references public.projects(organization_id, id) on delete cascade
);

create table public.moodboard_elements (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  moodboard_id    uuid not null,
  type            text not null check (type in ('image', 'file', 'link', 'text', 'palette', 'font', 'shape', 'section', 'note')),
  x               double precision not null default 0,
  y               double precision not null default 0,
  width           double precision not null default 200 check (width > 0),
  height          double precision not null default 200 check (height > 0),
  rotation        double precision not null default 0,
  z_index         int not null default 0,
  data            jsonb not null default '{}'::jsonb,  -- texto, cores, url, file_id, fonte...
  file_id         uuid,
  updated_at      timestamptz not null default now(),
  foreign key (organization_id, moodboard_id) references public.moodboards(organization_id, id) on delete cascade,
  foreign key (organization_id, file_id) references public.files(organization_id, id) on delete set null (file_id)
);
create index idx_mb_elements on public.moodboard_elements(moodboard_id, z_index);

-- Social media
create table public.social_accounts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  client_id       uuid not null,
  network         text not null check (network in ('instagram', 'facebook', 'linkedin', 'tiktok', 'youtube', 'x', 'pinterest', 'other')),
  handle          text not null,
  integration_id  uuid,      -- preenchido somente quando há conexão OAuth real
  created_at      timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, client_id) references public.clients(organization_id, id) on delete cascade
);

create table public.social_calendars (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  client_id       uuid not null,
  project_id      uuid,
  month           date not null check (extract(day from month) = 1),
  pillars         text[] not null default '{}',
  notes           text,
  unique (organization_id, id),
  unique (client_id, month),
  foreign key (organization_id, client_id) references public.clients(organization_id, id) on delete cascade,
  foreign key (organization_id, project_id) references public.projects(organization_id, id) on delete set null (project_id)
);

create type public.post_status as enum ('idea', 'planning', 'script', 'creating', 'internal_review', 'awaiting_client', 'approved', 'scheduled', 'published');

create table public.social_posts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  client_id       uuid not null,
  calendar_id     uuid,
  account_id      uuid,
  project_id      uuid,
  campaign        text,
  scheduled_for   timestamptz,
  format          text not null default 'static' check (format in ('static', 'carousel', 'reels', 'stories', 'video', 'campaign', 'institutional')),
  theme           text,
  objective       text,
  pillar          text,
  caption         text,
  hashtags        text[] not null default '{}',
  cta             text,
  script          text,
  assignee_id     uuid references auth.users(id) on delete set null,
  status          public.post_status not null default 'idea',
  approval_id     uuid,
  published_url   text,     -- registro manual; publicação automática só com integração conectada
  published_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  foreign key (organization_id, client_id) references public.clients(organization_id, id) on delete cascade,
  foreign key (organization_id, calendar_id) references public.social_calendars(organization_id, id) on delete set null (calendar_id),
  foreign key (organization_id, account_id) references public.social_accounts(organization_id, id) on delete set null (account_id),
  foreign key (organization_id, project_id) references public.projects(organization_id, id) on delete set null (project_id),
  foreign key (organization_id, approval_id) references public.approvals(organization_id, id) on delete set null (approval_id)
);
create index idx_posts_client_date on public.social_posts(client_id, scheduled_for);
create trigger trg_posts_updated before update on public.social_posts for each row execute function public.set_updated_at();
create trigger trg_posts_log after insert or update or delete on public.social_posts for each row execute function public.log_activity();

create table public.content_snippets (     -- banco de ideias, legendas e hashtags
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id       uuid,
  kind            text not null check (kind in ('idea', 'caption', 'hashtags', 'script')),
  title           text,
  body            text not null,
  tags            text[] not null default '{}',
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  foreign key (organization_id, client_id) references public.clients(organization_id, id) on delete cascade
);

-- Fotografia e audiovisual
create table public.media_productions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id      uuid not null,
  kind            text not null check (kind in ('photo_project', 'photoshoot', 'event', 'commercial', 'institutional_video', 'reels', 'campaign')),
  title           text not null,
  briefing        text,
  starts_at       timestamptz,
  ends_at         timestamptz,
  location        text,
  crew            uuid[] not null default '{}',
  equipment       text[] not null default '{}',
  shot_list       jsonb not null default '[]'::jsonb,
  script          text,
  schedule        jsonb not null default '[]'::jsonb,
  edit_stage      text not null default 'pre_production' check (edit_stage in ('pre_production', 'shooting', 'selection', 'editing', 'color', 'review', 'delivered')),
  gallery_selection_enabled boolean not null default false,
  created_at      timestamptz not null default now(),
  unique (organization_id, id),
  check (ends_at is null or starts_at is null or ends_at >= starts_at),
  foreign key (organization_id, project_id) references public.projects(organization_id, id) on delete cascade
);

create table public.media_assets (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  production_id   uuid not null,
  file_id         uuid not null,
  version         int not null default 1,
  client_selected boolean not null default false,
  selected_at     timestamptz,
  position        int not null default 0,
  foreign key (organization_id, production_id) references public.media_productions(organization_id, id) on delete cascade,
  foreign key (organization_id, file_id) references public.files(organization_id, id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- RLS: tabelas com project_id seguem o acesso ao projeto; edição exige
-- creative.write + acesso ao projeto.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['brand_briefings', 'brand_competitors', 'naming_territories', 'naming_criteria',
                           'naming_candidates', 'moodboards', 'media_productions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %1$s_select on public.%1$s for select using (public.can_access_project(project_id))', t);
    execute format('create policy %1$s_write on public.%1$s for all using (public.can_access_project(project_id) and public.has_perm(organization_id, ''creative.write'')) with check (public.can_access_project(project_id) and public.has_perm(organization_id, ''creative.write''))', t);
  end loop;
end $$;

create policy moodboards_client_select on public.moodboards for select using (client_visible and public.client_can_see_project(project_id));

alter table public.naming_scores enable row level security;
create policy naming_scores_select on public.naming_scores for select using (
  exists (select 1 from public.naming_candidates c where c.id = candidate_id and public.can_access_project(c.project_id)));
create policy naming_scores_write on public.naming_scores for all
  using (scorer_id = auth.uid()) with check (scorer_id = auth.uid() and exists (
    select 1 from public.naming_candidates c where c.id = candidate_id and public.can_access_project(c.project_id)));

alter table public.moodboard_elements enable row level security;
create policy mb_el_select on public.moodboard_elements for select using (exists (
  select 1 from public.moodboards m where m.id = moodboard_id
  and (public.can_access_project(m.project_id) or (m.client_visible and public.client_can_see_project(m.project_id)))));
create policy mb_el_write on public.moodboard_elements for all
  using (exists (select 1 from public.moodboards m where m.id = moodboard_id and public.can_access_project(m.project_id) and public.has_perm(m.organization_id, 'creative.write')))
  with check (exists (select 1 from public.moodboards m where m.id = moodboard_id and public.can_access_project(m.project_id) and public.has_perm(m.organization_id, 'creative.write')));

alter table public.media_assets enable row level security;
create policy media_assets_select on public.media_assets for select using (exists (
  select 1 from public.media_productions mp where mp.id = production_id
  and (public.can_access_project(mp.project_id) or (mp.gallery_selection_enabled and public.client_can_see_project(mp.project_id)))));
create policy media_assets_write on public.media_assets for all
  using (exists (select 1 from public.media_productions mp where mp.id = production_id and public.can_access_project(mp.project_id)))
  with check (exists (select 1 from public.media_productions mp where mp.id = production_id and public.can_access_project(mp.project_id)));

-- Social: por cliente.
do $$
declare t text;
begin
  foreach t in array array['social_accounts', 'social_calendars', 'social_posts', 'content_snippets'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %1$s_select on public.%1$s for select using (public.has_perm(organization_id, ''creative.write'') or public.has_perm(organization_id, ''projects.read_all''))', t);
    execute format('create policy %1$s_write on public.%1$s for all using (public.has_perm(organization_id, ''creative.write'')) with check (public.has_perm(organization_id, ''creative.write''))', t);
  end loop;
end $$;

create view public.portal_social_posts as
  select sp.id, sp.client_id, sp.scheduled_for, sp.format, sp.theme, sp.caption, sp.hashtags, sp.cta, sp.status, sp.approval_id
  from public.social_posts sp
  where sp.status in ('awaiting_client', 'approved', 'scheduled', 'published') and public.is_client_user(sp.client_id);
grant select on public.portal_social_posts to authenticated;
