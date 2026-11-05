-- =============================================================================
-- NEXO Studio OS — 0005 Financeiro
-- Diferencia três estados de receita:
--   contratada  = projects.contracted_amount / proposals.total aprovada
--   faturada    = accounts_receivable com status 'open'/'overdue'/'paid' (parcela emitida)
--   recebida    = transactions de entrada com paid_at (dinheiro em caixa)
-- Nenhum relatório soma valor futuro como caixa disponível.
-- =============================================================================

create type public.fin_status as enum ('scheduled', 'open', 'paid', 'overdue', 'cancelled');

create table public.financial_categories (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  kind            text not null check (kind in ('income', 'expense')),
  group_name      text,     -- fixas, variáveis, softwares, equipamentos, terceirizados, impostos, marketing, operacionais
  is_fixed        boolean not null default false,
  unique (organization_id, id),
  unique (organization_id, kind, name)
);

create or replace function public.seed_default_fin_categories(p_org uuid)
returns void language sql security definer set search_path = public as $$
  insert into public.financial_categories (organization_id, name, kind, group_name, is_fixed) values
    (p_org, 'Projetos', 'income', 'Serviços', false),
    (p_org, 'Recorrência (fee mensal)', 'income', 'Serviços', false),
    (p_org, 'Outras receitas', 'income', 'Outros', false),
    (p_org, 'Aluguel e estrutura', 'expense', 'Despesas fixas', true),
    (p_org, 'Salários e pró-labore', 'expense', 'Despesas fixas', true),
    (p_org, 'Softwares e assinaturas', 'expense', 'Softwares', true),
    (p_org, 'Equipamentos', 'expense', 'Equipamentos', false),
    (p_org, 'Fornecedores', 'expense', 'Fornecedores', false),
    (p_org, 'Terceirizados / freelancers', 'expense', 'Terceirizados', false),
    (p_org, 'Impostos', 'expense', 'Impostos', false),
    (p_org, 'Marketing', 'expense', 'Marketing', false),
    (p_org, 'Despesas operacionais', 'expense', 'Operacionais', false)
  on conflict do nothing;
$$;

create table public.suppliers (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  document        text,
  email           citext,
  phone           text,
  notes           text,
  created_at      timestamptz not null default now(),
  unique (organization_id, id)
);

-- Fatura = documento de cobrança (agrupa parcelas). Opcional.
create table public.invoices (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id       uuid not null,
  project_id      uuid,
  proposal_id     uuid,
  number          text,
  description     text not null,
  total           numeric(14,2) not null check (total >= 0),
  issued_at       date not null default (now() at time zone 'America/Sao_Paulo')::date,
  created_at      timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, client_id) references public.clients(organization_id, id) on delete restrict,
  foreign key (organization_id, project_id) references public.projects(organization_id, id) on delete restrict,
  foreign key (organization_id, proposal_id) references public.proposals(organization_id, id) on delete set null (proposal_id)
);

create table public.accounts_receivable (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id       uuid not null,
  project_id      uuid,
  invoice_id      uuid,
  category_id     uuid,
  description     text not null,
  amount          numeric(14,2) not null check (amount > 0),
  installment_no  int not null default 1 check (installment_no >= 1),
  installments    int not null default 1 check (installments >= 1),
  due_date        date not null,
  paid_at         date,
  paid_amount     numeric(14,2) check (paid_amount >= 0),
  payment_method  text check (payment_method in ('pix', 'boleto', 'transfer', 'credit_card', 'cash', 'other')),
  status          public.fin_status not null default 'open',
  notes           text,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, id),
  check (installment_no <= installments),
  check ((status = 'paid') = (paid_at is not null)),
  foreign key (organization_id, client_id) references public.clients(organization_id, id) on delete restrict,
  foreign key (organization_id, project_id) references public.projects(organization_id, id) on delete restrict,
  foreign key (organization_id, invoice_id) references public.invoices(organization_id, id) on delete set null (invoice_id),
  foreign key (organization_id, category_id) references public.financial_categories(organization_id, id)
);
create index idx_ar_due on public.accounts_receivable(organization_id, status, due_date);
create index idx_ar_project on public.accounts_receivable(project_id);
create trigger trg_ar_updated before update on public.accounts_receivable for each row execute function public.set_updated_at();
create trigger trg_ar_log after insert or update or delete on public.accounts_receivable for each row execute function public.log_activity();

create table public.accounts_payable (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  supplier_id     uuid,
  project_id      uuid,                    -- despesa ligada a projeto impacta a rentabilidade
  category_id     uuid not null,
  description     text not null,
  amount          numeric(14,2) not null check (amount > 0),
  due_date        date not null,
  paid_at         date,
  paid_amount     numeric(14,2) check (paid_amount >= 0),
  recurrence      text not null default 'none' check (recurrence in ('none', 'monthly', 'quarterly', 'yearly')),
  recurrence_parent_id uuid references public.accounts_payable(id) on delete set null,
  cost_type       text not null default 'operational' check (cost_type in ('operational', 'outsourced', 'additional')),
  status          public.fin_status not null default 'open',
  notes           text,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, id),
  check ((status = 'paid') = (paid_at is not null)),
  foreign key (organization_id, supplier_id) references public.suppliers(organization_id, id) on delete set null (supplier_id),
  foreign key (organization_id, project_id) references public.projects(organization_id, id) on delete restrict,
  foreign key (organization_id, category_id) references public.financial_categories(organization_id, id)
);
create index idx_ap_due on public.accounts_payable(organization_id, status, due_date);
create index idx_ap_project on public.accounts_payable(project_id);
create trigger trg_ap_updated before update on public.accounts_payable for each row execute function public.set_updated_at();
create trigger trg_ap_log after insert or update or delete on public.accounts_payable for each row execute function public.log_activity();

-- Movimentação efetiva de caixa (gerada ao dar baixa em AR/AP ou lançada avulsa).
create table public.transactions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  direction       text not null check (direction in ('in', 'out')),
  amount          numeric(14,2) not null check (amount > 0),
  occurred_on     date not null,
  description     text not null,
  category_id     uuid,
  project_id      uuid,
  client_id       uuid,
  receivable_id   uuid unique,
  payable_id      uuid unique,
  payment_method  text,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  foreign key (organization_id, category_id) references public.financial_categories(organization_id, id),
  foreign key (organization_id, project_id) references public.projects(organization_id, id) on delete restrict,
  foreign key (organization_id, client_id) references public.clients(organization_id, id) on delete restrict,
  foreign key (organization_id, receivable_id) references public.accounts_receivable(organization_id, id) on delete cascade,
  foreign key (organization_id, payable_id) references public.accounts_payable(organization_id, id) on delete cascade
);
create index idx_tx_org_date on public.transactions(organization_id, occurred_on);
create index idx_tx_project on public.transactions(project_id);

-- Baixa de recebível/pagável → gera/remove a transação correspondente.
create or replace function public.sync_receivable_tx()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'paid' then
    insert into public.transactions (organization_id, direction, amount, occurred_on, description, category_id, project_id, client_id, receivable_id, payment_method, created_by)
    values (new.organization_id, 'in', coalesce(new.paid_amount, new.amount), new.paid_at, new.description, new.category_id, new.project_id, new.client_id, new.id, new.payment_method, auth.uid())
    on conflict (receivable_id) do update set amount = excluded.amount, occurred_on = excluded.occurred_on;
  else
    delete from public.transactions where receivable_id = new.id;
  end if;
  return new;
end $$;
create trigger trg_ar_tx after insert or update of status, paid_at, paid_amount on public.accounts_receivable
  for each row execute function public.sync_receivable_tx();

create or replace function public.sync_payable_tx()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'paid' then
    insert into public.transactions (organization_id, direction, amount, occurred_on, description, category_id, project_id, payable_id, created_by)
    values (new.organization_id, 'out', coalesce(new.paid_amount, new.amount), new.paid_at, new.description, new.category_id, new.project_id, new.id, auth.uid())
    on conflict (payable_id) do update set amount = excluded.amount, occurred_on = excluded.occurred_on;
  else
    delete from public.transactions where payable_id = new.id;
  end if;
  return new;
end $$;
create trigger trg_ap_tx after insert or update of status, paid_at, paid_amount on public.accounts_payable
  for each row execute function public.sync_payable_tx();

-- Marca vencidos (rodar diariamente via pg_cron ou Edge Function agendada).
create or replace function public.mark_overdue()
returns int language plpgsql security definer set search_path = public as $$
declare n int; m int;
begin
  update public.accounts_receivable set status = 'overdue'
  where status = 'open' and due_date < (now() at time zone 'America/Sao_Paulo')::date;
  get diagnostics n = row_count;
  update public.accounts_payable set status = 'overdue'
  where status = 'open' and due_date < (now() at time zone 'America/Sao_Paulo')::date;
  get diagnostics m = row_count;
  return n + m;
end $$;

-- "Despesas" (expenses) é uma visão das contas a pagar classificadas, para não
-- duplicar dados.
create view public.expenses with (security_invoker = true) as
  select ap.*, fc.name as category_name, fc.group_name, fc.is_fixed
  from public.accounts_payable ap join public.financial_categories fc on fc.id = ap.category_id;

-- Rentabilidade por projeto (custos internos = horas × custo/hora congelado).
create view public.project_profitability with (security_invoker = true) as
  select p.id as project_id, p.organization_id, p.client_id, p.name, p.contracted_amount,
    coalesce(ar.billed, 0)    as billed_amount,
    coalesce(tx_in.received, 0) as received_amount,
    coalesce(te.minutes, 0)   as minutes_worked,
    coalesce(te.internal_cost, 0) as internal_cost,
    coalesce(ap.outsourced, 0) as outsourced_cost,
    coalesce(ap.additional, 0) as additional_cost,
    p.contracted_amount - coalesce(te.internal_cost, 0) - coalesce(ap.outsourced, 0) - coalesce(ap.additional, 0) as projected_result,
    case when p.contracted_amount > 0 then round(100 * (p.contracted_amount - coalesce(te.internal_cost, 0) - coalesce(ap.outsourced, 0) - coalesce(ap.additional, 0)) / p.contracted_amount, 1) end as margin_pct
  from public.projects p
  left join lateral (select sum(amount) billed from public.accounts_receivable r where r.project_id = p.id and r.status <> 'cancelled') ar on true
  left join lateral (select sum(amount) received from public.transactions t where t.project_id = p.id and t.direction = 'in') tx_in on true
  left join lateral (select sum(minutes) minutes, sum(minutes / 60.0 * coalesce(hourly_cost, 0)) internal_cost from public.time_entries e where e.project_id = p.id) te on true
  left join lateral (select sum(amount) filter (where cost_type = 'outsourced') outsourced,
                            sum(amount) filter (where cost_type <> 'outsourced') additional
                     from public.accounts_payable a where a.project_id = p.id and a.status <> 'cancelled') ap on true;

-- ---------------------------------------------------------------------------
-- Automação: proposta aprovada → contrato (rascunho) + projeto + tarefas do
-- modelo + parcelas no contas a receber. Tudo numa transação.
-- ---------------------------------------------------------------------------
create or replace function public.approve_proposal(p_proposal uuid, p_contract_template uuid default null, p_start_date date default null)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  pr public.proposals;
  v_project uuid; v_contract uuid := null; v_start date; v_cat public.project_category;
  v_income_cat uuid; v_body text; i int; v_amount numeric(14,2); v_first date;
begin
  select * into pr from public.proposals where id = p_proposal for update;
  if not found then raise exception 'proposal_not_found'; end if;
  if not public.has_perm(pr.organization_id, 'proposals.write') then raise exception 'forbidden' using errcode = '42501'; end if;
  if pr.status = 'approved' then raise exception 'already_approved'; end if;
  if pr.status in ('rejected', 'expired') then raise exception 'proposal_closed'; end if;
  if pr.total <= 0 then raise exception 'proposal_without_value'; end if;

  v_start := coalesce(p_start_date, (now() at time zone 'America/Sao_Paulo')::date);
  select coalesce((select category from public.project_templates where id = pr.template_id), 'other') into v_cat;

  update public.proposals set status = 'approved', decided_at = now() where id = pr.id;

  insert into public.projects (organization_id, client_id, name, category, description, scope, owner_id, start_date,
                               contracted_amount, status, template_id, proposal_id, created_by)
  values (pr.organization_id, pr.client_id, pr.title, v_cat, pr.intro, pr.scope, auth.uid(), v_start,
          pr.total, 'planning', pr.template_id, pr.id, auth.uid())
  returning id into v_project;

  insert into public.project_members (organization_id, project_id, user_id, role)
  values (pr.organization_id, v_project, auth.uid(), 'lead') on conflict do nothing;

  if pr.template_id is not null then
    insert into public.tasks (organization_id, project_id, title, description, start_date, due_date, estimated_hours, position, client_visible, created_by)
    select pr.organization_id, v_project, tt.title, tt.description, v_start + tt.offset_days, v_start + tt.offset_days + tt.duration_days - 1,
           tt.estimated_hours, tt.position, tt.client_visible, auth.uid()
    from public.project_template_tasks tt
    where tt.template_id = pr.template_id
      and (tt.optional_key is null or exists (
            select 1 from public.proposal_items pi join public.services s on s.id = pi.service_id
            where pi.proposal_id = pr.id and lower(s.category::text) = tt.optional_key));
    update public.projects p set due_date = (select max(due_date) from public.tasks where project_id = v_project) where p.id = v_project;
  end if;

  if p_contract_template is not null and public.has_perm(pr.organization_id, 'contracts.write') then
    select body_html into v_body from public.contract_templates where id = p_contract_template and organization_id = pr.organization_id;
    if v_body is null then raise exception 'contract_template_not_found'; end if;
    insert into public.contracts (organization_id, client_id, proposal_id, template_id, title, status, created_by, number)
    values (pr.organization_id, pr.client_id, pr.id, p_contract_template, 'Contrato — ' || pr.title, 'draft', auth.uid(), 0)
    returning id into v_contract;
    insert into public.contract_versions (organization_id, contract_id, version, body_html, note, created_by)
    values (pr.organization_id, v_contract, 1, v_body, 'Gerado da proposta aprovada; variáveis resolvidas na revisão', auth.uid());
    update public.projects set contract_id = v_contract where id = v_project;
  end if;

  -- Parcelas: ficam como 'scheduled' (contratadas, ainda não faturadas).
  select id into v_income_cat from public.financial_categories
  where organization_id = pr.organization_id and kind = 'income' order by name limit 1;
  v_first := coalesce(pr.first_due_date, v_start);
  for i in 1..pr.installments loop
    v_amount := case when i < pr.installments then round(pr.total / pr.installments, 2)
                     else pr.total - round(pr.total / pr.installments, 2) * (pr.installments - 1) end;
    insert into public.accounts_receivable (organization_id, client_id, project_id, category_id, description, amount,
                                            installment_no, installments, due_date, status, created_by)
    values (pr.organization_id, pr.client_id, v_project, v_income_cat, pr.title || ' — parcela ' || i || '/' || pr.installments,
            v_amount, i, pr.installments, (v_first + make_interval(months => i - 1))::date, 'scheduled', auth.uid());
  end loop;

  return jsonb_build_object('project_id', v_project, 'contract_id', v_contract);
end $$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.financial_categories enable row level security;
alter table public.suppliers            enable row level security;
alter table public.invoices             enable row level security;
alter table public.accounts_receivable  enable row level security;
alter table public.accounts_payable     enable row level security;
alter table public.transactions         enable row level security;

create policy fincat_select on public.financial_categories for select using (public.has_perm(organization_id, 'finance.read'));
create policy fincat_write on public.financial_categories for all
  using (public.has_perm(organization_id, 'settings.manage')) with check (public.has_perm(organization_id, 'settings.manage'));

do $$
declare t text;
begin
  foreach t in array array['suppliers', 'invoices', 'accounts_receivable', 'accounts_payable', 'transactions'] loop
    execute format('create policy %1$s_select on public.%1$s for select using (public.has_perm(organization_id, ''finance.read''))', t);
    execute format('create policy %1$s_write on public.%1$s for all using (public.has_perm(organization_id, ''finance.write'')) with check (public.has_perm(organization_id, ''finance.write''))', t);
  end loop;
end $$;

-- approve_proposal cria parcelas com a permissão de quem aprova a proposta.
create policy ar_insert_from_proposal on public.accounts_receivable for insert
  with check (status = 'scheduled' and public.has_perm(organization_id, 'proposals.write'));

create or replace function public.after_org_created_finance()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.seed_default_fin_categories(new.id);
  return new;
end $$;
create trigger trg_org_seed_finance after insert on public.organizations
  for each row execute function public.after_org_created_finance();
