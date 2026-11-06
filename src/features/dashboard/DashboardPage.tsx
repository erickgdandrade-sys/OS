import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, Clock, FolderKanban, Hourglass, ListTodo, Plus, Users, Wallet } from "lucide-react";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useBreadcrumbs } from "@/components/layout/AppShell";
import { Button, Card, CardHeader, EmptyState, ErrorState, Select, Skeleton, cn } from "@/components/ui";
import { useOrg } from "@/features/auth/AuthProvider";
import { ProjectFormModal, DueLabel } from "@/features/projects/ProjectsPages";
import { fetchProfiles } from "@/features/tasks/TaskViews";
import { categoryLabel, type ProjectCategory } from "@/lib/domain";
import { addDaysISO, hours, money, moneyCompact, todayISO } from "@/lib/format";
import { supabase } from "@/lib/supabase";

interface Summary {
  projects_active: number; projects_completed: number; projects_late: number; tasks_open: number; tasks_done: number; my_tasks_open: number;
  clients_active: number; leads_open: number; approvals_pending: number; minutes_worked: number;
  upcoming: { id: string; title: string; due_date: string; project_id: string; project_name: string }[];
  by_category: { category: ProjectCategory; count: number }[];
  productivity: { user_id: string; done: number }[];
  finance: null | {
    received: number; paid: number; billed_open: number; overdue: number; overdue_count: number; scheduled: number;
    monthly: { month: string; income: number | null; expense: number | null }[];
    profitability: { project_id: string; name: string; contracted_amount: number; received_amount: number; projected_result: number; margin_pct: number | null }[];
  };
}

const periods = { "30": "Últimos 30 dias", "90": "Últimos 90 dias", "180": "Últimos 6 meses", "365": "Últimos 12 meses" } as const;
// Paleta de séries: tons de azul da identidade + neutros (legíveis nos dois temas).
const series = ["#1F4FE0", "#0B0C12", "#2E8CDC", "#0C1A82", "#8A8D96", "#9DB4F5", "#C9A97A", "#F2562B"];

function Stat({ label, value, icon: Icon, tone, to, hint }: { label: string; value: string | number; icon: typeof Clock; tone?: "danger" | "warning"; to?: string; hint?: string }) {
  const body = (
    <Card className={cn("h-full transition-colors", to && "hover:border-border-strong")}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-fg-3">{label}</p>
        <Icon className={cn("size-4", tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : "text-fg-3")} />
      </div>
      <p className={cn("mt-2 text-2xl font-semibold tabular", tone === "danger" && Number(value) > 0 && "text-danger")}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-fg-3">{hint}</p>}
    </Card>
  );
  return to ? <Link to={to} className="block">{body}</Link> : body;
}

export function DashboardPage() {
  useBreadcrumbs([{ label: "Dashboard" }]);
  const { orgId, can, membership } = useOrg();
  const [period, setPeriod] = useState<keyof typeof periods>("90");
  const [creating, setCreating] = useState(false);
  const to = todayISO(), from = addDaysISO(to, -Number(period));
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["dashboard", orgId, period],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("dashboard_summary", { p_org: orgId, p_from: from, p_to: to });
      if (error) throw error;
      return data as Summary;
    },
  });
  const names = useQuery({
    queryKey: ["dash-names", data?.productivity.map((p) => p.user_id).join()],
    enabled: !!data?.productivity.length,
    queryFn: () => fetchProfiles(data!.productivity.map((p) => p.user_id)),
  });
  const productivity = useMemo(() => (data?.productivity ?? []).map((p) => ({ name: names.data?.[p.user_id]?.full_name?.split(" ")[0] ?? "—", done: p.done })).sort((a, b) => b.done - a.done), [data, names.data]);
  const fin = data?.finance;
  const monthly = (fin?.monthly ?? []).map((m) => ({ ...m, label: `${m.month.slice(5)}/${m.month.slice(2, 4)}`, income: Number(m.income ?? 0), expense: Number(m.expense ?? 0) }));

  return (
    <>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between animate-in">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">Visão geral</h1>
          <p className="mt-1 text-sm text-fg-3">{membership.organization_name} · números do período selecionado, conforme seu acesso.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select aria-label="Período" value={period} onChange={(e) => setPeriod(e.target.value as keyof typeof periods)} className="w-44">
            {Object.entries(periods).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
          {can("projects.write") && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>Novo projeto</Button>}
        </div>
      </div>

      {error ? <ErrorState error={error} onRetry={refetch} /> : isLoading || !data ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
      ) : (
        <div className="grid gap-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Projetos ativos" value={data.projects_active} icon={FolderKanban} to="/projetos" />
            <Stat label="Projetos atrasados" value={data.projects_late} icon={AlertTriangle} tone="danger" to="/projetos" />
            <Stat label="Tarefas pendentes" value={data.tasks_open} icon={ListTodo} hint={`${data.my_tasks_open} atribuídas a você`} to="/tarefas" />
            <Stat label="Tarefas concluídas" value={data.tasks_done} icon={CheckCircle2} hint="no período" />
            <Stat label="Projetos concluídos" value={data.projects_completed} icon={CheckCircle2} hint="no período" />
            {can("clients.read") && <Stat label="Clientes ativos" value={data.clients_active} icon={Users} to="/clientes" />}
            {can("crm.read") && <Stat label="Leads em negociação" value={data.leads_open} icon={Hourglass} />}
            <Stat label="Aprovações pendentes" value={data.approvals_pending} icon={Clock} tone="warning" />
            <Stat label="Horas trabalhadas" value={hours(data.minutes_worked)} icon={Clock} hint="no período" />
          </div>

          {fin && (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                <Stat label="Recebido (caixa)" value={money(fin.received)} icon={Wallet} hint="entradas efetivas" />
                <Stat label="Despesas pagas" value={money(fin.paid)} icon={Wallet} />
                <Stat label="Resultado do período" value={money(Number(fin.received) - Number(fin.paid))} icon={Wallet} hint="recebido − pago" />
                <Stat label="A receber (faturado)" value={money(fin.billed_open)} icon={Hourglass} hint={`${money(fin.scheduled)} previstos, ainda não faturados`} />
                <Stat label="Contas vencidas" value={money(fin.overdue)} icon={AlertTriangle} tone={fin.overdue_count ? "danger" : undefined} hint={`${fin.overdue_count} lançamento(s)`} />
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader title="Receitas e despesas por mês" description="Somente valores efetivamente recebidos e pagos." />
                  {monthly.length === 0 ? <EmptyState title="Sem movimentação no período" description="Dê baixa em recebimentos e pagamentos para ver a evolução." /> : (
                    <div className="h-64">
                      <ResponsiveContainer>
                        <BarChart data={monthly} margin={{ left: 0, right: 8, top: 8 }}>
                          <CartesianGrid vertical={false} stroke="var(--border)" />
                          <XAxis dataKey="label" tick={{ fill: "var(--text-3)", fontSize: 12 }} axisLine={false} tickLine={false} />
                          <YAxis tickFormatter={(v) => moneyCompact(v)} tick={{ fill: "var(--text-3)", fontSize: 12 }} axisLine={false} tickLine={false} width={72} />
                          <Tooltip formatter={(v) => money(Number(v))} contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)" }} cursor={{ fill: "var(--surface-2)" }} />
                          <Bar dataKey="income" name="Receitas" fill="#1F4FE0" radius={[4, 4, 0, 0]} />
                          <Bar dataKey="expense" name="Despesas" fill="var(--text-3)" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </Card>
                <Card>
                  <CardHeader title="Rentabilidade por projeto" description="Resultado previsto = contratado − custos lançados." />
                  {fin.profitability.length === 0 ? <EmptyState title="Nenhum projeto com valor contratado" /> : (
                    <ul className="grid gap-2.5">
                      {fin.profitability.map((p) => {
                        const pct = Math.max(0, Math.min(100, Number(p.margin_pct ?? 0)));
                        return (
                          <li key={p.project_id}>
                            <div className="flex justify-between gap-2 text-sm"><Link to={`/projetos/${p.project_id}`} className="truncate hover:text-accent">{p.name}</Link>
                              <span className={cn("shrink-0 tabular", Number(p.projected_result) < 0 && "text-danger")}>{money(p.projected_result)} · {p.margin_pct ?? 0}%</span></div>
                            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} /></div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </Card>
              </div>
            </>
          )}

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-1">
              <CardHeader title="Próximos prazos" description="Tarefas dos próximos 14 dias." />
              {data.upcoming.length === 0 ? <p className="py-6 text-center text-sm text-fg-3">Nenhum prazo próximo.</p> : (
                <ul className="grid gap-2">{data.upcoming.map((t) => (
                  <li key={t.id}><Link to={`/projetos/${t.project_id}`} className="block rounded-md px-2 py-1.5 hover:bg-surface-2">
                    <p className="truncate text-sm">{t.title}</p><div className="flex items-center justify-between gap-2"><span className="truncate text-xs text-fg-3">{t.project_name}</span><DueLabel due={t.due_date} /></div>
                  </Link></li>))}</ul>
              )}
            </Card>
            <Card>
              <CardHeader title="Projetos por categoria" />
              {data.by_category.length === 0 ? <p className="py-6 text-center text-sm text-fg-3">Sem projetos.</p> : (
                <div className="flex items-center gap-4">
                  <div className="size-36 shrink-0">
                    <ResponsiveContainer><PieChart><Pie data={data.by_category} dataKey="count" nameKey="category" innerRadius={40} outerRadius={64} paddingAngle={2} stroke="var(--surface)">
                      {data.by_category.map((_, i) => <Cell key={i} fill={series[i % series.length]} />)}</Pie>
                      <Tooltip formatter={(v, _n, p) => [v, categoryLabel[(p.payload as { category: ProjectCategory }).category]]} contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8 }} /></PieChart></ResponsiveContainer>
                  </div>
                  <ul className="grid gap-1 text-xs">{data.by_category.map((c, i) => (
                    <li key={c.category} className="flex items-center gap-2"><span className="size-2 rounded-full" style={{ background: series[i % series.length] }} />{categoryLabel[c.category]}<span className="text-fg-3 tabular">{c.count}</span></li>))}</ul>
                </div>
              )}
            </Card>
            <Card>
              <CardHeader title="Produtividade da equipe" description="Tarefas concluídas no período." />
              {productivity.length === 0 ? <p className="py-6 text-center text-sm text-fg-3">Nenhuma tarefa concluída no período.</p> : (
                <div className="h-40"><ResponsiveContainer><BarChart data={productivity} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <XAxis type="number" hide allowDecimals={false} /><YAxis type="category" dataKey="name" width={80} tick={{ fill: "var(--text-2)", fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ fill: "var(--surface-2)" }} contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8 }} />
                  <Bar dataKey="done" name="Concluídas" fill="#1F4FE0" radius={[0, 4, 4, 0]} barSize={14} /></BarChart></ResponsiveContainer></div>
              )}
            </Card>
          </div>
        </div>
      )}
      <ProjectFormModal open={creating} onClose={() => setCreating(false)} />
    </>
  );
}
