-- =============================================================================
-- ANDRA&GO OS — 0022 Nomes de usuário (@usuario) e chat interno
-- • profiles.username: único, minúsculo, 3–30 caracteres [a-z0-9._]. Gerado
--   automaticamente (pode ser trocado em Meu perfil).
-- • search_people: encontra pessoas da MESMA equipe (estúdio) por @usuario ou
--   nome — clientes do portal não aparecem e ninguém de fora é listado.
-- • Chat: conversas diretas (1:1) e em grupo, só entre membros ativos do mesmo
--   estúdio; mensagens podem compartilhar projeto ou tarefa (com um resumo
--   gravado na hora, validado contra o acesso de quem compartilha).
-- =============================================================================

-- ------------------------------------------------------------ Usernames
alter table public.profiles add column username text;
alter table public.profiles add constraint profiles_username_format
  check (username is null or username ~ '^[a-z0-9]([a-z0-9._]{1,28})[a-z0-9]$');
create unique index uq_profiles_username on public.profiles (username);

-- Base "nome.sobrenome" sem acentos, com sufixo numérico se já existir.
create or replace function public.make_username(p_base text, p_self uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare b text; u text; n int := 1;
begin
  b := lower(translate(coalesce(p_base, ''), 'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ', 'aaaaaeeeeiiiiooooouuuucnaaaaaeeeeiiiiooooouuuucn'));
  b := regexp_replace(b, '[^a-z0-9]+', '.', 'g');
  b := regexp_replace(b, '^\.+|\.+$', '', 'g');
  b := left(b, 24);
  b := regexp_replace(b, '\.+$', '', 'g');
  if length(b) < 3 then b := 'usuario'; end if;
  u := b;
  while exists (select 1 from public.profiles where username = u and id <> coalesce(p_self, '00000000-0000-0000-0000-000000000000')) loop
    n := n + 1; u := b || n;
  end loop;
  return u;
end $$;
revoke execute on function public.make_username(text, uuid) from public, anon, authenticated;

create or replace function public.profiles_username_default()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_email text;
begin
  if new.username is null then
    select email into v_email from auth.users where id = new.id;
    new.username := public.make_username(coalesce(nullif(trim(new.full_name), ''), split_part(coalesce(v_email, ''), '@', 1)), new.id);
  else
    new.username := lower(trim(new.username));
  end if;
  return new;
end $$;
create trigger trg_profiles_username before insert or update of username on public.profiles
  for each row execute function public.profiles_username_default();

-- Preenche quem já existe.
update public.profiles set username = null where username is null;

create or replace function public.username_available(p_username text)
returns boolean language sql stable security definer set search_path = public as $$
  select lower(trim(p_username)) ~ '^[a-z0-9]([a-z0-9._]{1,28})[a-z0-9]$'
     and not exists (select 1 from public.profiles where username = lower(trim(p_username)) and id <> auth.uid());
$$;

-- Pessoas da(s) mesma(s) equipe(s) do usuário logado.
create or replace function public.search_people(p_query text default '')
returns table (id uuid, username text, full_name text, avatar_path text, job_title text)
language sql stable security definer set search_path = public as $$
  select distinct on (p.id) p.id, p.username, p.full_name, p.avatar_path, m.job_title
  from public.profiles p
  join public.organization_members m on m.user_id = p.id and m.status = 'active'
  where m.organization_id in (select organization_id from public.organization_members where user_id = auth.uid() and status = 'active')
    and p.id <> auth.uid()
    and (coalesce(trim(p_query), '') = ''
         or p.username like lower(ltrim(trim(p_query), '@')) || '%'
         or p.full_name ilike '%' || trim(p_query) || '%')
  order by p.id
  limit 30;
$$;

-- ----------------------------------------------------------------- Chat
create table public.chat_threads (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind            text not null check (kind in ('direct', 'group')),
  title           text check (title is null or length(trim(title)) between 1 and 80),
  direct_key      text unique,        -- "<menor uuid>:<maior uuid>" para conversas diretas
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  check ((kind = 'direct') = (direct_key is not null))
);
create table public.chat_members (
  thread_id    uuid not null references public.chat_threads(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  joined_at    timestamptz not null default now(),
  last_read_at timestamptz not null default now(),
  primary key (thread_id, user_id)
);
create index idx_chat_members_user on public.chat_members(user_id);
create table public.chat_messages (
  id         uuid primary key default gen_random_uuid(),
  thread_id  uuid not null references public.chat_threads(id) on delete cascade,
  author_id  uuid references auth.users(id) on delete set null,
  body       text not null default '' check (length(body) <= 8000),
  shared     jsonb check (shared is null or (jsonb_typeof(shared) = 'object' and shared ->> 'type' in ('project', 'task'))),
  created_at timestamptz not null default now(),
  edited_at  timestamptz,
  deleted_at timestamptz,
  check (length(trim(body)) > 0 or shared is not null or deleted_at is not null)
);
create index idx_chat_messages_thread on public.chat_messages(thread_id, created_at desc);

create or replace function public.is_chat_member(p_thread uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.chat_members where thread_id = p_thread and user_id = auth.uid());
$$;

-- Duas pessoas ativas no mesmo estúdio? Devolve o estúdio em comum.
create or replace function public.shared_org(p_a uuid, p_b uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select a.organization_id from public.organization_members a
  join public.organization_members b on b.organization_id = a.organization_id and b.user_id = p_b and b.status = 'active'
  where a.user_id = p_a and a.status = 'active' limit 1;
$$;
revoke execute on function public.shared_org(uuid, uuid) from public, anon, authenticated;

alter table public.chat_threads enable row level security;
alter table public.chat_members enable row level security;
alter table public.chat_messages enable row level security;
create policy chat_threads_select on public.chat_threads for select using (public.is_chat_member(id));
create policy chat_threads_update on public.chat_threads for update using (public.is_chat_member(id) and kind = 'group') with check (kind = 'group');
create policy chat_members_select on public.chat_members for select using (public.is_chat_member(thread_id));
create policy chat_members_read on public.chat_members for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy chat_members_leave on public.chat_members for delete using (user_id = auth.uid());
create policy chat_messages_select on public.chat_messages for select using (public.is_chat_member(thread_id));
create policy chat_messages_insert on public.chat_messages for insert with check (author_id = auth.uid() and public.is_chat_member(thread_id));
create policy chat_messages_update on public.chat_messages for update using (author_id = auth.uid()) with check (author_id = auth.uid());

-- Compartilhar exige acesso de quem envia; o resumo (nome, cliente) é gravado
-- aqui para quem recebe ver o cartão mesmo sem acesso ao projeto.
create or replace function public.chat_message_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_org uuid; r record;
begin
  if tg_op = 'UPDATE' then
    if new.thread_id <> old.thread_id or new.author_id is distinct from old.author_id or new.shared is distinct from old.shared or new.created_at <> old.created_at then
      raise exception 'chat_message_immutable';
    end if;
    if new.body <> old.body then new.edited_at := now(); end if;
    if new.deleted_at is not null and old.deleted_at is null then new.body := ''; end if;
    return new;
  end if;
  select organization_id into v_org from public.chat_threads where id = new.thread_id;
  if new.shared is not null then
    if new.shared ->> 'type' = 'project' then
      select p.id, p.name, p.organization_id, coalesce(c.trade_name, c.legal_name) as client into r
      from public.projects p left join public.clients c on c.id = p.client_id where p.id = (new.shared ->> 'id')::uuid;
      if not found or r.organization_id <> v_org or not public.can_access_project(r.id) then raise exception 'share_forbidden' using errcode = '42501'; end if;
      new.shared := jsonb_build_object('type', 'project', 'id', r.id, 'title', r.name, 'subtitle', r.client);
    else
      select t.id, t.title, t.project_id, p.name as project, p.organization_id into r
      from public.tasks t join public.projects p on p.id = t.project_id where t.id = (new.shared ->> 'id')::uuid;
      if not found or r.organization_id <> v_org or not public.can_access_project(r.project_id) then raise exception 'share_forbidden' using errcode = '42501'; end if;
      new.shared := jsonb_build_object('type', 'task', 'id', r.id, 'title', r.title, 'subtitle', r.project, 'project_id', r.project_id);
    end if;
  end if;
  new.created_at := now(); new.edited_at := null; new.deleted_at := null;
  return new;
end $$;
create trigger trg_chat_message_guard before insert or update on public.chat_messages for each row execute function public.chat_message_guard();

create or replace function public.chat_message_after()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.chat_threads set last_message_at = new.created_at where id = new.thread_id;
  update public.chat_members set last_read_at = new.created_at where thread_id = new.thread_id and user_id = new.author_id;
  return new;
end $$;
create trigger trg_chat_message_after after insert on public.chat_messages for each row execute function public.chat_message_after();

-- Abre (ou reaproveita) a conversa direta com outra pessoa da equipe.
create or replace function public.start_direct_chat(p_user uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_key text; v_id uuid;
begin
  if auth.uid() is null or p_user is null or p_user = auth.uid() then raise exception 'invalid_input'; end if;
  v_org := public.shared_org(auth.uid(), p_user);
  if v_org is null then raise exception 'not_same_team' using errcode = '42501'; end if;
  v_key := least(auth.uid()::text, p_user::text) || ':' || greatest(auth.uid()::text, p_user::text);
  select id into v_id from public.chat_threads where direct_key = v_key;
  if v_id is null then
    insert into public.chat_threads (organization_id, kind, direct_key, created_by) values (v_org, 'direct', v_key, auth.uid()) returning id into v_id;
  end if;
  insert into public.chat_members (thread_id, user_id) values (v_id, auth.uid()), (v_id, p_user) on conflict do nothing;
  return v_id;
end $$;

-- Grupo: todos precisam estar no mesmo estúdio de quem cria.
create or replace function public.create_group_chat(p_title text, p_users uuid[])
returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_id uuid; u uuid;
begin
  if auth.uid() is null or length(trim(coalesce(p_title, ''))) < 1 or coalesce(cardinality(p_users), 0) = 0 or cardinality(p_users) > 50 then raise exception 'invalid_input'; end if;
  select organization_id into v_org from public.organization_members where user_id = auth.uid() and status = 'active' limit 1;
  if v_org is null then raise exception 'forbidden' using errcode = '42501'; end if;
  foreach u in array p_users loop
    if not exists (select 1 from public.organization_members where organization_id = v_org and user_id = u and status = 'active') then
      raise exception 'not_same_team' using errcode = '42501';
    end if;
  end loop;
  insert into public.chat_threads (organization_id, kind, title, created_by) values (v_org, 'group', left(trim(p_title), 80), auth.uid()) returning id into v_id;
  insert into public.chat_members (thread_id, user_id) select v_id, x from unnest(array_append(p_users, auth.uid())) x on conflict do nothing;
  return v_id;
end $$;

create or replace function public.add_chat_members(p_thread uuid, p_users uuid[])
returns int language plpgsql security definer set search_path = public as $$
declare t public.chat_threads; u uuid; n int;
begin
  select * into t from public.chat_threads where id = p_thread;
  if not found or t.kind <> 'group' or not public.is_chat_member(p_thread) then raise exception 'forbidden' using errcode = '42501'; end if;
  foreach u in array coalesce(p_users, '{}') loop
    if not exists (select 1 from public.organization_members where organization_id = t.organization_id and user_id = u and status = 'active') then
      raise exception 'not_same_team' using errcode = '42501';
    end if;
  end loop;
  insert into public.chat_members (thread_id, user_id) select p_thread, x from unnest(p_users) x on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- Lista das conversas com prévia, participantes e não lidas.
create or replace function public.chat_overview()
returns table (id uuid, kind text, title text, last_message_at timestamptz, unread bigint, last_body text, last_author uuid, members jsonb)
language sql stable security definer set search_path = public as $$
  select t.id, t.kind, t.title, t.last_message_at,
    (select count(*) from public.chat_messages x where x.thread_id = t.id and x.created_at > me.last_read_at and x.author_id is distinct from auth.uid() and x.deleted_at is null),
    (select case when x.deleted_at is not null then '' when x.shared is not null and x.body = '' then '[' || (x.shared ->> 'title') || ']' else left(x.body, 140) end
       from public.chat_messages x where x.thread_id = t.id order by x.created_at desc limit 1),
    (select x.author_id from public.chat_messages x where x.thread_id = t.id order by x.created_at desc limit 1),
    (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name, 'username', p.username, 'avatar_path', p.avatar_path) order by p.full_name), '[]'::jsonb)
       from public.chat_members cm join public.profiles p on p.id = cm.user_id where cm.thread_id = t.id)
  from public.chat_threads t
  join public.chat_members me on me.thread_id = t.id and me.user_id = auth.uid()
  order by t.last_message_at desc
  limit 200;
$$;

grant execute on function public.username_available(text), public.search_people(text), public.start_direct_chat(uuid),
  public.create_group_chat(text, uuid[]), public.add_chat_members(uuid, uuid[]), public.chat_overview(), public.is_chat_member(uuid) to authenticated;
revoke execute on function public.username_available(text), public.search_people(text), public.start_direct_chat(uuid),
  public.create_group_chat(text, uuid[]), public.add_chat_members(uuid, uuid[]), public.chat_overview() from anon;

-- Tempo real (Supabase Realtime respeita o RLS acima).
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    execute 'alter publication supabase_realtime add table public.chat_messages';
  end if;
end $$;
