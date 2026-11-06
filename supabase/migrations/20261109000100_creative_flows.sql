-- =============================================================================
-- NEXO Studio OS — 0015 Fluxos da Fase 4 (criatividade)
-- Briefings de todos os serviços (link para o cliente), ranking de naming, aprovação de
-- posts, seleção de fotos pelo cliente e moodboards no portal.
-- =============================================================================

-- --------------------------------------------------------------- Briefings
-- Modelos por serviço (perguntas em JSON: seções → perguntas) e briefings
-- enviados aos clientes por link seguro. Os modelos padrão são criados por
-- organização e podem ser editados ou duplicados.
create table public.briefing_templates (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  category        public.project_category not null default 'other',
  description     text,
  sections        jsonb not null default '[]'::jsonb check (jsonb_typeof(sections) = 'array'),
  is_default      boolean not null default false,
  is_archived     boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, id)
);
create trigger trg_briefing_tpl_updated before update on public.briefing_templates for each row execute function public.set_updated_at();

create type public.briefing_status as enum ('draft', 'sent', 'in_progress', 'answered', 'reviewed');

create table public.briefings (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id       uuid not null,
  project_id      uuid,
  template_id     uuid,
  title           text not null,
  category        public.project_category not null default 'other',
  sections        jsonb not null check (jsonb_typeof(sections) = 'array'),   -- cópia das perguntas no envio
  answers         jsonb not null default '{}'::jsonb check (jsonb_typeof(answers) = 'object'),
  status          public.briefing_status not null default 'draft',
  intro_message   text,
  token_hash      bytea unique,
  token_expires_at timestamptz,
  sent_at         timestamptz,
  submitted_at    timestamptz,
  respondent_name text,
  created_by      uuid default auth.uid() references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, client_id) references public.clients(organization_id, id) on delete cascade,
  foreign key (organization_id, project_id) references public.projects(organization_id, id) on delete set null (project_id),
  foreign key (organization_id, template_id) references public.briefing_templates(organization_id, id) on delete set null (template_id)
);
create index idx_briefings_org on public.briefings(organization_id, status, created_at desc);
create index idx_briefings_client on public.briefings(client_id);
create trigger trg_briefings_updated before update on public.briefings for each row execute function public.set_updated_at();
create trigger trg_briefings_log after insert or update or delete on public.briefings for each row execute function public.log_activity();

alter table public.briefing_templates enable row level security;
alter table public.briefings enable row level security;
create policy btpl_select on public.briefing_templates for select using (public.is_org_member(organization_id));
create policy btpl_write on public.briefing_templates for all
  using (public.has_perm(organization_id, 'templates.manage') or public.has_perm(organization_id, 'creative.write'))
  with check (public.has_perm(organization_id, 'templates.manage') or public.has_perm(organization_id, 'creative.write'));
create policy briefings_select on public.briefings for select using (
  public.has_perm(organization_id, 'clients.read') and (project_id is null or public.can_access_project(project_id)));
create policy briefings_write on public.briefings for all
  using (public.has_perm(organization_id, 'creative.write') or public.has_perm(organization_id, 'crm.write'))
  with check (public.has_perm(organization_id, 'creative.write') or public.has_perm(organization_id, 'crm.write'));

-- Gera (ou renova) o link para o cliente responder. Token exibido uma única vez.
create or replace function public.create_briefing_link(p_briefing uuid, p_days int default 14)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare b public.briefings; v_token text;
begin
  select * into b from public.briefings where id = p_briefing;
  if not found or not (public.has_perm(b.organization_id, 'creative.write') or public.has_perm(b.organization_id, 'crm.write')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_days < 1 or p_days > 60 then raise exception 'invalid_days'; end if;
  if b.status in ('answered', 'reviewed') then raise exception 'briefing_already_answered'; end if;
  v_token := encode(gen_random_bytes(32), 'hex');
  update public.briefings set token_hash = digest(v_token, 'sha256'), token_expires_at = now() + make_interval(days => p_days),
    status = case when status = 'draft' then 'sent'::public.briefing_status else status end, sent_at = coalesce(sent_at, now())
  where id = b.id;
  return v_token;
end $$;

-- Respostas do cliente (Edge Function `briefing-public`, service role).
create or replace function public.submit_briefing_answers(p_briefing uuid, p_answers jsonb, p_final boolean, p_name text default null)
returns void language plpgsql security definer set search_path = public as $$
declare b public.briefings;
begin
  select * into b from public.briefings where id = p_briefing for update;
  if not found or b.token_hash is null or b.token_expires_at < now() or b.status in ('answered', 'reviewed') then raise exception 'link_expired_or_revoked'; end if;
  if jsonb_typeof(p_answers) <> 'object' or length(p_answers::text) > 100000 then raise exception 'invalid_answers'; end if;
  if p_final and length(trim(coalesce(p_name, ''))) < 3 then raise exception 'name_required'; end if;
  update public.briefings set answers = answers || p_answers,
    status = case when p_final then 'answered'::public.briefing_status else 'in_progress'::public.briefing_status end,
    submitted_at = case when p_final then now() else submitted_at end,
    respondent_name = coalesce(nullif(trim(p_name), ''), respondent_name),
    token_hash = case when p_final then null else token_hash end
  where id = b.id;
  if p_final then
    perform public.notify(b.organization_id, b.created_by, 'briefing_answered', 'Briefing respondido: ' || b.title, trim(p_name), '/briefings/' || b.id);
  end if;
end $$;

-- ------------------------------------------------------------------ Naming
-- Nota ponderada de cada candidato (média dos avaliadores × peso dos critérios).
create view public.naming_ranking with (security_invoker = true) as
  select c.id as candidate_id, c.project_id, c.name, c.is_finalist, c.availability_status,
    round(sum(s.score * cr.weight) / nullif(sum(cr.weight), 0), 2) as weighted_score,
    count(distinct s.scorer_id) as scorers
  from public.naming_candidates c
  left join public.naming_scores s on s.candidate_id = c.id
  left join public.naming_criteria cr on cr.id = s.criterion_id
  group by c.id;

-- Critérios padrão ao começar o naming de um projeto.
create or replace function public.seed_naming_criteria(p_project uuid)
returns int language plpgsql security invoker set search_path = public as $$
declare v_org uuid; n int;
begin
  select organization_id into v_org from public.projects where id = p_project;
  if v_org is null or not public.can_access_project(p_project) or not public.has_perm(v_org, 'creative.write') then raise exception 'forbidden' using errcode = '42501'; end if;
  if exists (select 1 from public.naming_criteria where project_id = p_project) then return 0; end if;
  insert into public.naming_criteria (organization_id, project_id, name, weight) values
    (v_org, p_project, 'Sonoridade', 2), (v_org, p_project, 'Memorabilidade', 2), (v_org, p_project, 'Originalidade', 2),
    (v_org, p_project, 'Adequação estratégica', 3), (v_org, p_project, 'Facilidade de escrita', 1);
  get diagnostics n = row_count;
  return n;
end $$;

-- Mudança de etapa de validação exige registro (quem, quando, o quê).
create or replace function public.naming_availability_guard()
returns trigger language plpgsql as $$
begin
  if new.availability_status is distinct from old.availability_status then
    if new.availability_status <> 'not_checked' and coalesce(trim(new.availability_notes), '') = '' then
      raise exception 'availability_notes_required';
    end if;
    new.availability_checked_by := auth.uid();
    new.availability_checked_at := now();
  end if;
  return new;
end $$;
create trigger trg_naming_availability before update on public.naming_candidates for each row execute function public.naming_availability_guard();

-- ------------------------------------------------------------ Social media
-- Envia o post para aprovação do cliente (cria a aprovação no projeto do post).
create or replace function public.request_post_approval(p_post uuid, p_due date default null)
returns uuid language plpgsql security invoker set search_path = public as $$
declare sp public.social_posts; v_appr uuid;
begin
  select * into sp from public.social_posts where id = p_post for update;
  if not found or not public.has_perm(sp.organization_id, 'creative.write') then raise exception 'forbidden' using errcode = '42501'; end if;
  if sp.project_id is null then raise exception 'post_without_project'; end if;
  if sp.approval_id is not null and exists (select 1 from public.approvals where id = sp.approval_id and status = 'pending') then
    raise exception 'approval_already_pending';
  end if;
  insert into public.approvals (organization_id, project_id, title, description, entity_type, entity_id, version, requested_by, due_date)
  values (sp.organization_id, sp.project_id, 'Post: ' || coalesce(sp.theme, 'sem tema') || coalesce(' — ' || to_char(sp.scheduled_for at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI'), ''),
          left(coalesce(sp.caption, ''), 2000), 'social_post', sp.id,
          coalesce((select max(version) from public.approvals where entity_type = 'social_post' and entity_id = sp.id), 0) + 1, auth.uid(), p_due)
  returning id into v_appr;
  update public.social_posts set approval_id = v_appr, status = 'awaiting_client' where id = sp.id;
  return v_appr;
end $$;

-- Resposta do cliente atualiza o status do post.
create or replace function public.sync_post_from_approval()
returns trigger language plpgsql security definer set search_path = public as $$
declare a public.approvals;
begin
  select * into a from public.approvals where id = new.approval_id;
  if a.entity_type = 'social_post' and a.entity_id is not null then
    update public.social_posts set status = case new.decision when 'approved' then 'approved'::public.post_status else 'creating'::public.post_status end
    where id = a.entity_id and approval_id = a.id;
  end if;
  return new;
end $$;
create trigger trg_post_from_approval after insert on public.approval_events for each row execute function public.sync_post_from_approval();

-- Publicação só é registrada manualmente (com link) enquanto não há API conectada.
create or replace function public.social_posts_guard()
returns trigger language plpgsql as $$
begin
  if new.status = 'published' and (tg_op = 'INSERT' or old.status <> 'published') then
    if coalesce(trim(new.published_url), '') = '' then raise exception 'published_url_required'; end if;
    new.published_at := coalesce(new.published_at, now());
  end if;
  return new;
end $$;
create trigger trg_social_posts_guard before insert or update on public.social_posts for each row execute function public.social_posts_guard();

-- --------------------------------------------------------------- Galeria
-- Fotos da produção que o cliente pode ver (quando a seleção está habilitada).
create or replace function public.portal_gallery(p_production uuid)
returns table (asset_id uuid, file_id uuid, name text, storage_path text, client_selected boolean, sort_order int)
language sql stable security definer set search_path = public as $$
  select a.id, f.id, f.name, f.storage_path, a.client_selected, a.position
  from public.media_assets a
  join public.media_productions mp on mp.id = a.production_id
  join public.files f on f.id = a.file_id
  where a.production_id = p_production and mp.gallery_selection_enabled and public.client_can_see_project(mp.project_id)
  order by a.position, f.created_at;
$$;

create or replace function public.portal_select_asset(p_asset uuid, p_selected boolean)
returns void language plpgsql security definer set search_path = public as $$
declare mp public.media_productions;
begin
  select m.* into mp from public.media_assets a join public.media_productions m on m.id = a.production_id where a.id = p_asset;
  if not found or not mp.gallery_selection_enabled or not public.client_can_see_project(mp.project_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.media_assets set client_selected = p_selected, selected_at = case when p_selected then now() end where id = p_asset;
end $$;

create or replace function public.portal_productions()
returns table (id uuid, project_id uuid, title text, kind text, starts_at timestamptz, edit_stage text, selected bigint, total bigint)
language sql stable security definer set search_path = public as $$
  select mp.id, mp.project_id, mp.title, mp.kind, mp.starts_at, mp.edit_stage,
    (select count(*) from public.media_assets a where a.production_id = mp.id and a.client_selected),
    (select count(*) from public.media_assets a where a.production_id = mp.id)
  from public.media_productions mp
  where mp.gallery_selection_enabled and public.client_can_see_project(mp.project_id)
  order by mp.starts_at desc nulls last;
$$;

-- Moodboards compartilhados com o cliente.
create view public.portal_moodboards as
  select m.id, m.project_id, m.title, m.kind, m.viewport, m.updated_at
  from public.moodboards m
  where m.client_visible and public.client_can_see_project(m.project_id);
grant select on public.portal_moodboards to authenticated;

grant execute on function public.create_briefing_link(uuid, int), public.seed_naming_criteria(uuid),
  public.request_post_approval(uuid, date), public.portal_gallery(uuid), public.portal_select_asset(uuid, boolean), public.portal_productions() to authenticated;
revoke execute on function public.create_briefing_link(uuid, int), public.seed_naming_criteria(uuid),
  public.request_post_approval(uuid, date), public.portal_gallery(uuid), public.portal_select_asset(uuid, boolean), public.portal_productions(),
  public.submit_briefing_answers(uuid, jsonb, boolean, text) from public, anon;
revoke execute on function public.submit_briefing_answers(uuid, jsonb, boolean, text) from authenticated;
grant execute on function public.submit_briefing_answers(uuid, jsonb, boolean, text) to service_role;
