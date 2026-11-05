-- =============================================================================
-- NEXO Studio OS — 0013 Operação (Fase 3)
-- Faturamento e baixa, recorrência, alertas diários, relatórios financeiros,
-- previsão de caixa e carga de trabalho da equipe.
-- =============================================================================

-- Faturar uma parcela prevista (contratado → faturado).
create or replace function public.invoice_receivable(p_id uuid, p_due_date date default null)
returns void language plpgsql security invoker set search_path = public as $$
declare r public.accounts_receivable;
begin
  select * into r from public.accounts_receivable where id = p_id for update;
  if not found or not public.has_perm(r.organization_id, 'finance.write') then raise exception 'forbidden' using errcode = '42501'; end if;
  if r.status <> 'scheduled' then raise exception 'not_scheduled'; end if;
  update public.accounts_receivable set status = 'open', due_date = coalesce(p_due_date, due_date) where id = p_id;
end $$;

-- Baixa de recebível ou pagável (gera a transação via trigger existente).
create or replace function public.settle(p_kind text, p_id uuid, p_paid_at date, p_amount numeric, p_method text default null)
returns void language plpgsql security invoker set search_path = public as $$
declare v_org uuid; v_status public.fin_status;
begin
  if p_kind = 'receivable' then
    select organization_id, status into v_org, v_status from public.accounts_receivable where id = p_id for update;
  elsif p_kind = 'payable' then
    select organization_id, status into v_org, v_status from public.accounts_payable where id = p_id for update;
  else raise exception 'invalid_kind'; end if;
  if v_org is null or not public.has_perm(v_org, 'finance.write') then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_status in ('paid', 'cancelled') then raise exception 'already_closed'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'invalid_amount'; end if;
  if p_paid_at is null or p_paid_at > (now() at time zone 'America/Sao_Paulo')::date then raise exception 'invalid_paid_at'; end if;
  if p_kind = 'receivable' then
    update public.accounts_receivable set status = 'paid', paid_at = p_paid_at, paid_amount = p_amount, payment_method = coalesce(p_method, payment_method) where id = p_id;
  else
    update public.accounts_payable set status = 'paid', paid_at = p_paid_at, paid_amount = p_amount where id = p_id;
  end if;
end $$;

-- Estorno de baixa (volta a "em aberto"; a transação é removida pelo trigger).
create or replace function public.reopen(p_kind text, p_id uuid)
returns void language plpgsql security invoker set search_path = public as $$
declare v_org uuid;
begin
  if p_kind = 'receivable' then select organization_id into v_org from public.accounts_receivable where id = p_id;
  else select organization_id into v_org from public.accounts_payable where id = p_id; end if;
  if v_org is null or not public.has_perm(v_org, 'finance.write') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_kind = 'receivable' then
    update public.accounts_receivable set status = 'open', paid_at = null, paid_amount = null where id = p_id and status = 'paid';
  else
    update public.accounts_payable set status = 'open', paid_at = null, paid_amount = null where id = p_id and status = 'paid';
  end if;
end $$;

-- Recorrência: ao pagar uma conta recorrente, cria a próxima (uma só vez).
create or replace function public.payable_recurrence()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_next date;
begin
  if new.status = 'paid' and old.status <> 'paid' and new.recurrence <> 'none'
     and not exists (select 1 from public.accounts_payable where recurrence_parent_id = new.id) then
    v_next := (new.due_date + case new.recurrence when 'monthly' then interval '1 month' when 'quarterly' then interval '3 months' else interval '1 year' end)::date;
    insert into public.accounts_payable (organization_id, supplier_id, project_id, category_id, description, amount, due_date, recurrence,
                                         recurrence_parent_id, cost_type, status, notes, created_by)
    values (new.organization_id, new.supplier_id, new.project_id, new.category_id, new.description, new.amount, v_next, new.recurrence,
            new.id, new.cost_type, 'open', new.notes, new.created_by);
  end if;
  return new;
end $$;
create trigger trg_ap_recurrence after update of status on public.accounts_payable for each row execute function public.payable_recurrence();

-- Pagamento recebido → avisa o responsável pelo projeto.
create or replace function public.notify_payment_received()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_owner uuid; v_name text;
begin
  if new.status = 'paid' and old.status <> 'paid' and new.project_id is not null then
    select owner_id, name into v_owner, v_name from public.projects where id = new.project_id;
    perform public.notify(new.organization_id, v_owner, 'payment_received', 'Pagamento recebido: ' || v_name, new.description, '/projetos/' || new.project_id);
  end if;
  return new;
end $$;
create trigger trg_ar_paid_notify after update of status on public.accounts_receivable for each row execute function public.notify_payment_received();

-- Rotina diária: vencidos, propostas expiradas e alertas (sem duplicar no mesmo dia).
create or replace function public.run_daily_alerts()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_today date := (now() at time zone 'America/Sao_Paulo')::date; n_over int; n_exp int; n_notif int := 0; k int;
begin
  n_over := public.mark_overdue();
  n_exp := public.expire_proposals();

  insert into public.notifications (organization_id, user_id, kind, title, body, link)
  select t.organization_id, t.assignee_id, 'deadline_soon', 'Prazo amanhã: ' || t.title, p.name, '/projetos/' || t.project_id
  from public.tasks t join public.projects p on p.id = t.project_id
  where t.status <> 'done' and t.assignee_id is not null and t.due_date = v_today + 1
    and not exists (select 1 from public.notifications n where n.user_id = t.assignee_id and n.kind = 'deadline_soon'
                    and n.link = '/projetos/' || t.project_id and n.title = 'Prazo amanhã: ' || t.title and n.created_at::date = v_today);
  get diagnostics k = row_count; n_notif := n_notif + k;

  insert into public.notifications (organization_id, user_id, kind, title, link)
  select p.organization_id, p.owner_id, 'project_late', 'Projeto atrasado: ' || p.name, '/projetos/' || p.id
  from public.projects p
  where p.status not in ('completed', 'cancelled') and p.owner_id is not null and p.due_date = v_today - 1;
  get diagnostics k = row_count; n_notif := n_notif + k;

  insert into public.notifications (organization_id, user_id, kind, title, body, link)
  select r.organization_id, m.user_id, 'bill_overdue', 'Conta a receber vencida: ' || r.description, to_char(r.due_date, 'DD/MM/YYYY'), '/financeiro'
  from public.accounts_receivable r
  join public.organization_members m on m.organization_id = r.organization_id and m.status = 'active' and m.role in ('admin', 'finance')
  where r.status = 'overdue' and r.due_date = v_today - 1;
  get diagnostics k = row_count; n_notif := n_notif + k;

  return jsonb_build_object('overdue', n_over, 'expired_proposals', n_exp, 'notifications', n_notif);
end $$;

-- Relatório financeiro do período (regime de caixa) + previsão.
create or replace function public.finance_report(p_org uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare v_today date := (now() at time zone 'America/Sao_Paulo')::date; r jsonb;
begin
  if not public.has_perm(p_org, 'finance.read') then raise exception 'forbidden' using errcode = '42501'; end if;
  select jsonb_build_object(
    'income',  (select coalesce(sum(amount), 0) from public.transactions where organization_id = p_org and direction = 'in'  and occurred_on between p_from and p_to),
    'expense', (select coalesce(sum(amount), 0) from public.transactions where organization_id = p_org and direction = 'out' and occurred_on between p_from and p_to),
    'contracted_not_billed', (select coalesce(sum(amount), 0) from public.accounts_receivable where organization_id = p_org and status = 'scheduled'),
    'billed_open', (select coalesce(sum(amount), 0) from public.accounts_receivable where organization_id = p_org and status in ('open', 'overdue')),
    'payable_open', (select coalesce(sum(amount), 0) from public.accounts_payable where organization_id = p_org and status in ('open', 'overdue')),
    'by_client', (select coalesce(jsonb_agg(x order by x.total desc), '[]') from (
        select c.id, coalesce(c.trade_name, c.legal_name) as name, sum(t.amount) total
        from public.transactions t join public.clients c on c.id = t.client_id
        where t.organization_id = p_org and t.direction = 'in' and t.occurred_on between p_from and p_to group by c.id, 2) x),
    'by_project', (select coalesce(jsonb_agg(x order by x.total desc), '[]') from (
        select p.id, p.name, sum(t.amount) total
        from public.transactions t join public.projects p on p.id = t.project_id
        where t.organization_id = p_org and t.direction = 'in' and t.occurred_on between p_from and p_to group by p.id, p.name) x),
    'by_service', (select coalesce(jsonb_agg(x order by x.total desc), '[]') from (
        select p.category::text as category, sum(t.amount) total
        from public.transactions t join public.projects p on p.id = t.project_id
        where t.organization_id = p_org and t.direction = 'in' and t.occurred_on between p_from and p_to group by 1) x),
    'expenses_by_group', (select coalesce(jsonb_agg(x order by x.total desc), '[]') from (
        select coalesce(fc.group_name, fc.name) as name, bool_or(fc.is_fixed) as fixed, sum(t.amount) total
        from public.transactions t join public.financial_categories fc on fc.id = t.category_id
        where t.organization_id = p_org and t.direction = 'out' and t.occurred_on between p_from and p_to group by 1) x),
    'recurring_income', (select coalesce(sum(t.amount), 0) from public.transactions t join public.financial_categories fc on fc.id = t.category_id
        where t.organization_id = p_org and t.direction = 'in' and fc.name ilike 'Recorr%' and t.occurred_on between p_from and p_to),
    'monthly', (select coalesce(jsonb_agg(m order by m.month), '[]') from (
        select to_char(date_trunc('month', occurred_on), 'YYYY-MM') as month,
               coalesce(sum(amount) filter (where direction = 'in'), 0) as income,
               coalesce(sum(amount) filter (where direction = 'out'), 0) as expense
        from public.transactions where organization_id = p_org and occurred_on between p_from and p_to group by 1) m),
    -- Previsão: só o que tem vencimento; previsto (scheduled) separado de faturado.
    'forecast', (select coalesce(jsonb_agg(f order by f.month), '[]') from (
        select to_char(g.m, 'YYYY-MM') as month,
          (select coalesce(sum(amount), 0) from public.accounts_receivable where organization_id = p_org and status in ('open', 'overdue') and date_trunc('month', due_date) = g.m) as billed,
          (select coalesce(sum(amount), 0) from public.accounts_receivable where organization_id = p_org and status = 'scheduled' and date_trunc('month', due_date) = g.m) as scheduled,
          (select coalesce(sum(amount), 0) from public.accounts_payable where organization_id = p_org and status in ('open', 'overdue') and date_trunc('month', due_date) = g.m) as payable
        from generate_series(date_trunc('month', v_today), date_trunc('month', v_today) + interval '5 months', interval '1 month') g(m)) f),
    'overdue_receivables', (select coalesce(sum(amount), 0) from public.accounts_receivable where organization_id = p_org and status = 'overdue'),
    'overdue_payables', (select coalesce(sum(amount), 0) from public.accounts_payable where organization_id = p_org and status = 'overdue')
  ) into r;
  return r;
end $$;

-- Carga de trabalho: tarefas abertas, horas estimadas no período e horas lançadas.
create or replace function public.team_workload(p_org uuid, p_from date, p_to date)
returns table (user_id uuid, full_name text, job_title text, capacity_hours numeric, open_tasks bigint, overdue_tasks bigint,
               estimated_hours numeric, logged_hours numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_perm(p_org, 'team.read') then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
  select m.user_id, p.full_name, m.job_title,
    round(m.weekly_capacity_hours * greatest(1, (p_to - p_from + 1)) / 7.0, 1),
    (select count(*) from public.tasks t where t.organization_id = p_org and t.assignee_id = m.user_id and t.status <> 'done'),
    (select count(*) from public.tasks t where t.organization_id = p_org and t.assignee_id = m.user_id and t.status <> 'done' and t.due_date < (now() at time zone 'America/Sao_Paulo')::date),
    (select coalesce(sum(t.estimated_hours), 0) from public.tasks t where t.organization_id = p_org and t.assignee_id = m.user_id and t.status <> 'done' and t.due_date between p_from and p_to),
    (select round(coalesce(sum(e.minutes), 0) / 60.0, 1) from public.time_entries e where e.organization_id = p_org and e.user_id = m.user_id and e.work_date between p_from and p_to)
  from public.organization_members m join public.profiles p on p.id = m.user_id
  where m.organization_id = p_org and m.status = 'active'
  order by p.full_name;
end $$;

grant execute on function public.invoice_receivable(uuid, date), public.settle(text, uuid, date, numeric, text), public.reopen(text, uuid),
  public.finance_report(uuid, date, date), public.team_workload(uuid, date, date) to authenticated;
revoke execute on function public.invoice_receivable(uuid, date), public.settle(text, uuid, date, numeric, text), public.reopen(text, uuid),
  public.finance_report(uuid, date, date), public.team_workload(uuid, date, date), public.run_daily_alerts() from public, anon;
revoke execute on function public.run_daily_alerts() from authenticated;
grant execute on function public.run_daily_alerts() to service_role;
