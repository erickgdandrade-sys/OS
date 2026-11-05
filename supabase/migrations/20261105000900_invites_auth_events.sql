-- =============================================================================
-- NEXO Studio OS — 0009 Aceite de convite e eventos de autenticação
-- =============================================================================

-- Chamado pelo frontend logo após o usuário convidado definir a senha.
-- Ativa as associações pendentes cujo e-mail é o do usuário logado.
create or replace function public.accept_invitation()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_email citext; n_members int := 0; n_clients int := 0;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select email into v_email from auth.users where id = auth.uid();

  update public.organization_members m set status = 'active', joined_at = coalesce(m.joined_at, now())
  where m.user_id = auth.uid() and m.status = 'invited'
    and exists (select 1 from public.invitations i where i.organization_id = m.organization_id and i.email = v_email
                and i.accepted_at is null and i.revoked_at is null and i.expires_at > now());
  get diagnostics n_members = row_count;

  update public.invitations set accepted_at = now()
  where email = v_email and accepted_at is null and revoked_at is null and expires_at > now();

  update public.client_users set status = 'active' where user_id = auth.uid() and status = 'invited';
  get diagnostics n_clients = row_count;

  return jsonb_build_object('members', n_members, 'clients', n_clients);
end $$;

-- Registro de eventos de autenticação (login, logout, troca de senha).
create or replace function public.log_auth_event(p_action text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or p_action not in ('login', 'logout', 'password_changed', 'password_reset_requested') then
    return;
  end if;
  insert into public.activity_logs (organization_id, actor_id, entity_type, entity_id, action)
  select m.organization_id, auth.uid(), 'auth', auth.uid(), p_action
  from public.organization_members m where m.user_id = auth.uid() and m.status = 'active';
  update public.profiles set last_seen_at = now() where id = auth.uid() and p_action = 'login';
end $$;

-- Contexto da sessão: organização, papel, permissões e se é conta de cliente.
create or replace function public.session_context()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'user_id', auth.uid(),
    'memberships', coalesce((
      select jsonb_agg(jsonb_build_object(
        'organization_id', o.id, 'organization_name', o.name, 'slug', o.slug,
        'role', m.role, 'job_title', m.job_title,
        'permissions', (select coalesce(jsonb_agg(k), '[]'::jsonb) from public.my_permissions(o.id) k)))
      from public.organization_members m join public.organizations o on o.id = m.organization_id
      where m.user_id = auth.uid() and m.status = 'active'), '[]'::jsonb),
    'client_accounts', coalesce((
      select jsonb_agg(jsonb_build_object('client_id', c.id, 'organization_id', c.organization_id,
                                          'client_name', coalesce(c.trade_name, c.legal_name),
                                          'studio_name', o.name))
      from public.client_users cu join public.clients c on c.id = cu.client_id
      join public.organizations o on o.id = c.organization_id
      where cu.user_id = auth.uid() and cu.status = 'active'), '[]'::jsonb),
    'pending_invites', exists (select 1 from public.organization_members where user_id = auth.uid() and status = 'invited')
      or exists (select 1 from public.client_users where user_id = auth.uid() and status = 'invited')
  );
$$;

-- Lista da equipe com e-mail e último acesso (só para quem gerencia usuários).
create or replace function public.team_directory(p_org uuid)
returns table (user_id uuid, full_name text, email text, role public.org_role, job_title text, status public.member_status,
               weekly_capacity_hours numeric, last_seen_at timestamptz, joined_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m.user_id, p.full_name, u.email::text, m.role, m.job_title, m.status, m.weekly_capacity_hours, p.last_seen_at, m.joined_at
  from public.organization_members m
  join public.profiles p on p.id = m.user_id
  join auth.users u on u.id = m.user_id
  where m.organization_id = p_org and (public.has_perm(p_org, 'users.manage') or public.has_perm(p_org, 'team.read'))
  order by p.full_name;
$$;

-- Usada só pelas Edge Functions (service role) para localizar contas existentes.
create or replace function public.find_user_id_by_email(p_email text)
returns uuid language sql stable security definer set search_path = public as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1;
$$;

revoke execute on function public.find_user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.find_user_id_by_email(text) to service_role;
grant execute on function public.accept_invitation(), public.log_auth_event(text), public.session_context(),
  public.team_directory(uuid) to authenticated;
revoke execute on function public.accept_invitation(), public.log_auth_event(text), public.session_context(),
  public.team_directory(uuid) from public, anon;
