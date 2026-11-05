-- =============================================================================
-- NEXO Studio OS — 0010 Aplicar modelo a um projeto existente
-- Cria as tarefas do modelo com datas relativas ao início do projeto.
-- =============================================================================
create or replace function public.apply_project_template(p_project uuid, p_template uuid, p_include_optional text[] default '{}')
returns int language plpgsql security invoker set search_path = public as $$
declare p public.projects; v_start date; n int;
begin
  select * into p from public.projects where id = p_project;
  if not found then raise exception 'project_not_found'; end if;
  if not public.can_edit_project(p_project) then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from public.project_templates where id = p_template and organization_id = p.organization_id) then
    raise exception 'template_not_found';
  end if;
  v_start := coalesce(p.start_date, (now() at time zone 'America/Sao_Paulo')::date);
  insert into public.tasks (organization_id, project_id, title, description, start_date, due_date, estimated_hours, position, client_visible, created_by)
  select p.organization_id, p.id, tt.title, tt.description, v_start + tt.offset_days, v_start + tt.offset_days + tt.duration_days - 1,
         tt.estimated_hours, coalesce((select max(position) from public.tasks where project_id = p.id), 0) + tt.position, tt.client_visible, auth.uid()
  from public.project_template_tasks tt
  where tt.template_id = p_template and (tt.optional_key is null or tt.optional_key = any(p_include_optional));
  get diagnostics n = row_count;
  update public.projects set template_id = p_template,
    due_date = coalesce(due_date, (select max(due_date) from public.tasks where project_id = p.id))
  where id = p.id;
  return n;
end $$;
grant execute on function public.apply_project_template(uuid, uuid, text[]) to authenticated;
revoke execute on function public.apply_project_template(uuid, uuid, text[]) from public, anon;
