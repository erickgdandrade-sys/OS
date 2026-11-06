import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Download, Plus, RotateCcw, Wallet } from "lucide-react";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useBreadcrumbs } from "@/components/layout/AppShell";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, Field, Input, Modal, PageHeader, Select, Spinner, Tabs, Textarea, useToast, cn } from "@/components/ui";
import { useOrg } from "@/features/auth/AuthProvider";
import { clientName } from "@/features/clients/ClientsPages";
import { downloadCsv, toCsv } from "@/lib/csv";
import { categoryLabel, errorMessage, type ProjectCategory, type Tone } from "@/lib/domain";
import { addDaysISO, date, money, moneyCompact, todayISO } from "@/lib/format";
import { supabase } from "@/lib/supabase";

type FinStatus = "scheduled" | "open" | "paid" | "overdue" | "cancelled";
const statusLabel: Record<FinStatus, string> = { scheduled: "Previsto", open: "Em aberto", paid: "Pago", overdue: "Vencido", cancelled: "Cancelado" };
const statusTone: Record<FinStatus, Tone> = { scheduled: "neutral", open: "info", paid: "success", overdue: "danger", cancelled: "neutral" };
const methods: Record<string, string> = { pix: "PIX", boleto: "Boleto", transfer: "Transferência", credit_card: "Cartão", cash: "Dinheiro", other: "Outro" };
const tip = { contentStyle: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)" }, cursor: { fill: "var(--surface-2)" } };
const parseMoney = (v: string) => Number(v.replace(/\s|R\$/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));

type Receivable = { id: string; client_id: string; project_id: string | null; description: string; amount: number; installment_no: number; installments: number; due_date: string;
  paid_at: string | null; paid_amount: number | null; payment_method: string | null; status: FinStatus; clients: { legal_name: string; trade_name: string | null } | null; projects: { name: string } | null };
type Payable = { id: string; supplier_id: string | null; project_id: string | null; category_id: string; description: string; amount: number; due_date: string; paid_at: string | null;
  paid_amount: number | null; recurrence: string; cost_type: string; status: FinStatus; notes: string | null; suppliers: { name: string } | null; projects: { name: string } | null;
  financial_categories: { name: string; group_name: string | null } | null };

export function FinancePage() {
  useBreadcrumbs([{ label: "Financeiro" }]);
  const [tab, setTab] = useState<"overview" | "receivable" | "payable" | "suppliers">("overview");
  return (
    <>
      <PageHeader title="Financeiro" description="Contratado, faturado e recebido, separados. Só o que entrou ou saiu de fato conta como caixa." />
      <Tabs value={tab} onChange={setTab} items={[{ value: "overview", label: "Visão geral" }, { value: "receivable", label: "A receber" }, { value: "payable", label: "A pagar" }, { value: "suppliers", label: "Fornecedores" }]} />
      <div className="pt-5">{tab === "overview" ? <Overview /> : tab === "receivable" ? <Receivables /> : tab === "payable" ? <Payables /> : <Suppliers />}</div>
    </>
  );
}

/* ------------------------------------------------------------ Visão geral */
function Overview() {
  const { orgId } = useOrg();
  const [period, setPeriod] = useState("90");
  const to = todayISO(), from = addDaysISO(to, -Number(period));
  const { data: r, isLoading, error } = useQuery({
    queryKey: ["finance-report", orgId, period],
    queryFn: async () => { const { data, error } = await supabase.rpc("finance_report", { p_org: orgId, p_from: from, p_to: to }); if (error) throw error; return data; },
  });
  if (error) return <ErrorState error={error} />;
  if (isLoading || !r) return <Spinner />;
  const label = (m: string) => `${m.slice(5)}/${m.slice(2, 4)}`;
  const forecast = (r.forecast as { month: string; billed: number; scheduled: number; payable: number }[]).map((f) => ({ ...f, label: label(f.month), billed: Number(f.billed), scheduled: Number(f.scheduled), payable: Number(f.payable) }));
  const monthly = (r.monthly as { month: string; income: number; expense: number }[]).map((m) => ({ ...m, label: label(m.month), income: Number(m.income), expense: Number(m.expense) }));
  const exportCsv = () => downloadCsv(`financeiro-${from}-a-${to}`, toCsv(
    [...(r.by_client as { name: string; total: number }[]).map((x) => ({ k: "Receita por cliente", n: x.name, v: Number(x.total) })),
     ...(r.by_project as { name: string; total: number }[]).map((x) => ({ k: "Receita por projeto", n: x.name, v: Number(x.total) })),
     ...(r.expenses_by_group as { name: string; total: number }[]).map((x) => ({ k: "Despesa por grupo", n: x.name, v: Number(x.total) })),
     ...monthly.map((m) => ({ k: "Caixa mensal (entradas)", n: m.month, v: m.income })), ...monthly.map((m) => ({ k: "Caixa mensal (saídas)", n: m.month, v: m.expense }))],
    [{ header: "Indicador", value: (x) => x.k }, { header: "Referência", value: (x) => x.n }, { header: "Valor (R$)", value: (x) => x.v }]));
  const Rank = ({ title, rows, render }: { title: string; rows: { name: string; total: number; category?: string }[]; render?: (x: { name: string; category?: string }) => string }) => {
    const max = Math.max(1, ...rows.map((x) => Number(x.total)));
    return (
      <Card className="min-w-0"><CardHeader title={title} />{rows.length === 0 ? <p className="text-sm text-fg-3">Sem movimentação no período.</p> : (
        <ul className="grid gap-2.5">{rows.slice(0, 8).map((x, i) => (
          <li key={i}><div className="flex justify-between gap-3 text-sm"><span className="min-w-0 truncate">{render ? render(x) : x.name}</span><span className="shrink-0 tabular">{money(x.total)}</span></div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full bg-brand" style={{ width: `${(100 * Number(x.total)) / max}%` }} /></div></li>))}</ul>)}</Card>
    );
  };
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Select aria-label="Período" value={period} onChange={(e) => setPeriod(e.target.value)} className="w-48">
          <option value="30">Últimos 30 dias</option><option value="90">Últimos 90 dias</option><option value="180">Últimos 6 meses</option><option value="365">Últimos 12 meses</option></Select>
        <Button icon={<Download className="size-4" />} onClick={exportCsv}>Exportar CSV</Button>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[["Recebido no período", r.income, "Entradas efetivas"], ["Pago no período", r.expense, "Saídas efetivas"], ["Resultado operacional", Number(r.income) - Number(r.expense), "Recebido − pago"],
          ["Receita recorrente", r.recurring_income, "Fees mensais recebidos"], ["Faturado a receber", r.billed_open, "Parcelas emitidas"], ["Contratado, não faturado", r.contracted_not_billed, "Não é caixa disponível"],
          ["Contas a pagar", r.payable_open, "Em aberto e vencidas"], ["Vencidos (a receber)", r.overdue_receivables, `A pagar vencido: ${money(r.overdue_payables)}`]].map(([l, v, h], i) => (
          <Card key={i}><p className="text-xs text-fg-3">{l as string}</p><p className={cn("mt-1.5 text-xl font-semibold tabular", i === 7 && Number(v) > 0 && "text-danger", i === 2 && Number(v) < 0 && "text-danger")}>{money(v as number)}</p><p className="mt-0.5 text-xs text-fg-3">{h as string}</p></Card>))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader title="Previsão de caixa — próximos 6 meses" description="Faturado e previsto separados; previsto ainda depende de faturamento." />
          <div className="h-64"><ResponsiveContainer><BarChart data={forecast} margin={{ left: 0, right: 8, top: 8 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" /><XAxis dataKey="label" tick={{ fill: "var(--text-3)", fontSize: 12 }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={(v) => moneyCompact(v)} tick={{ fill: "var(--text-3)", fontSize: 12 }} axisLine={false} tickLine={false} width={72} />
            <Tooltip formatter={(v) => money(Number(v))} {...tip} /><Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="billed" stackId="in" name="A receber (faturado)" fill="#1F4FE0" /><Bar dataKey="scheduled" stackId="in" name="Previsto" fill="#9DB4F5" radius={[4, 4, 0, 0]} />
            <Bar dataKey="payable" name="A pagar" fill="var(--text-3)" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div></Card>
        <Card><CardHeader title="Caixa realizado por mês" />
          {monthly.length === 0 ? <EmptyState title="Sem movimentação no período" /> : <div className="h-64"><ResponsiveContainer><BarChart data={monthly} margin={{ left: 0, right: 8, top: 8 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" /><XAxis dataKey="label" tick={{ fill: "var(--text-3)", fontSize: 12 }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={(v) => moneyCompact(v)} tick={{ fill: "var(--text-3)", fontSize: 12 }} axisLine={false} tickLine={false} width={72} />
            <Tooltip formatter={(v) => money(Number(v))} {...tip} /><Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="income" name="Entradas" fill="#1F4FE0" radius={[4, 4, 0, 0]} /><Bar dataKey="expense" name="Saídas" fill="var(--text-3)" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>}</Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
        <Rank title="Receita por cliente" rows={r.by_client} />
        <Rank title="Receita por projeto" rows={r.by_project} />
        <Rank title="Receita por serviço" rows={(r.by_service as { category: string; total: number }[]).map((x) => ({ name: x.category, total: x.total }))} render={(x) => categoryLabel[x.name as ProjectCategory] ?? x.name} />
        <Rank title="Despesas por grupo" rows={r.expenses_by_group} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- A receber */
function Receivables() {
  const { orgId, can } = useOrg();
  const qc = useQueryClient();
  const toast = useToast();
  const write = can("finance.write");
  const [status, setStatus] = useState<FinStatus | "pending" | "">("pending");
  const [settling, setSettling] = useState<{ kind: "receivable" | "payable"; id: string; amount: number; description: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["receivables", orgId],
    queryFn: async () => { const { data, error } = await supabase.from("accounts_receivable").select("*, clients(legal_name, trade_name), projects(name)").eq("organization_id", orgId).order("due_date"); if (error) throw error; return data as Receivable[]; },
  });
  const list = useMemo(() => (data ?? []).filter((r) => !status || (status === "pending" ? ["scheduled", "open", "overdue"].includes(r.status) : r.status === status)), [data, status]);
  const rpc = async (fn: string, args: Record<string, unknown>, ok: string) => {
    const { error } = await supabase.rpc(fn, args);
    if (error) return toast({ tone: "error", message: errorMessage(error) });
    toast({ tone: "success", message: ok }); refetch(); qc.invalidateQueries({ queryKey: ["finance-report"] }); qc.invalidateQueries({ queryKey: ["dashboard"] });
  };
  const cancel = async (id: string) => { const { error } = await supabase.from("accounts_receivable").update({ status: "cancelled" }).eq("id", id); if (error) return toast({ tone: "error", message: errorMessage(error) }); refetch(); };
  const exportCsv = () => downloadCsv(`contas-a-receber-${todayISO()}`, toCsv(list, [
    { header: "Vencimento", value: (r) => date(r.due_date) }, { header: "Cliente", value: (r) => clientName(r.clients) }, { header: "Projeto", value: (r) => r.projects?.name },
    { header: "Descrição", value: (r) => r.description }, { header: "Parcela", value: (r) => `${r.installment_no}/${r.installments}` }, { header: "Valor", value: (r) => Number(r.amount) },
    { header: "Status", value: (r) => statusLabel[r.status] }, { header: "Pago em", value: (r) => (r.paid_at ? date(r.paid_at) : "") }, { header: "Valor pago", value: (r) => (r.paid_amount != null ? Number(r.paid_amount) : null) },
    { header: "Forma", value: (r) => (r.payment_method ? methods[r.payment_method] : "") }]));
  const sum = (s: FinStatus[]) => (data ?? []).filter((r) => s.includes(r.status)).reduce((a, r) => a + Number(r.amount), 0);

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {([["Previsto (não faturado)", ["scheduled"]], ["Em aberto", ["open"]], ["Vencido", ["overdue"]], ["Recebido", ["paid"]]] as [string, FinStatus[]][]).map(([l, s]) => (
          <Card key={l}><p className="text-xs text-fg-3">{l}</p><p className={cn("mt-1 text-lg font-semibold tabular", s[0] === "overdue" && sum(s) > 0 && "text-danger")}>{money(sum(s))}</p></Card>))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as FinStatus | "pending" | "")} className="w-48">
          <option value="pending">Pendentes</option><option value="">Todos</option>{Object.entries(statusLabel).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
        <div className="ml-auto flex gap-2"><Button icon={<Download className="size-4" />} onClick={exportCsv}>CSV</Button>
          {write && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>Nova conta a receber</Button>}</div>
      </div>
      {error ? <ErrorState error={error} /> : isLoading ? <Spinner /> : !list.length ? <EmptyState icon={<Wallet className="size-5" />} title="Nada por aqui" description="Parcelas de propostas aprovadas aparecem automaticamente como previstas." /> : (
        <Card padded={false} className="overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-sm">
          <thead className="bg-surface-2 text-left text-xs text-fg-3"><tr><th className="px-4 py-2.5 font-medium">Vencimento</th><th className="px-4 py-2.5 font-medium">Descrição</th>
            <th className="px-4 py-2.5 text-right font-medium">Valor</th><th className="px-4 py-2.5 font-medium">Status</th>{write && <th className="px-4 py-2.5" />}</tr></thead>
          <tbody>{list.map((r) => (
            <tr key={r.id} className="border-t border-border">
              <td className="px-4 py-3 tabular">{date(r.due_date)}</td>
              <td className="px-4 py-3"><p>{r.description}</p><p className="text-xs text-fg-3">{clientName(r.clients)}{r.projects && <> · <Link to={`/projetos/${r.project_id}`} className="hover:text-accent">{r.projects.name}</Link></>}</p></td>
              <td className="px-4 py-3 text-right tabular">{money(r.amount)}{r.paid_at && <p className="text-xs text-fg-3">pago {date(r.paid_at)}{r.payment_method ? ` · ${methods[r.payment_method]}` : ""}</p>}</td>
              <td className="px-4 py-3"><Badge tone={statusTone[r.status]} dot>{statusLabel[r.status]}</Badge></td>
              {write && <td className="px-4 py-3"><div className="flex justify-end gap-1.5">
                {r.status === "scheduled" && <Button size="sm" onClick={() => rpc("invoice_receivable", { p_id: r.id }, "Parcela faturada.")}>Faturar</Button>}
                {["open", "overdue"].includes(r.status) && <Button size="sm" variant="primary" onClick={() => setSettling({ kind: "receivable", id: r.id, amount: Number(r.amount), description: r.description })}>Dar baixa</Button>}
                {r.status === "paid" && <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={() => rpc("reopen", { p_kind: "receivable", p_id: r.id }, "Baixa estornada.")}>Estornar</Button>}
                {["scheduled", "open"].includes(r.status) && <Button size="sm" variant="ghost" onClick={() => cancel(r.id)}>Cancelar</Button>}
              </div></td>}
            </tr>))}</tbody></table></div></Card>
      )}
      {settling && <SettleModal {...settling} onClose={() => setSettling(null)} onDone={() => { setSettling(null); refetch(); qc.invalidateQueries({ queryKey: ["finance-report"] }); }} />}
      {creating && <ReceivableModal onClose={() => setCreating(false)} onDone={() => { setCreating(false); refetch(); }} />}
    </div>
  );
}

function SettleModal({ kind, id, amount, description, onClose, onDone }: { kind: "receivable" | "payable"; id: string; amount: number; description: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ paid_at: todayISO(), amount: amount.toFixed(2).replace(".", ","), method: "pix" });
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    const { error } = await supabase.rpc("settle", { p_kind: kind, p_id: id, p_paid_at: f.paid_at, p_amount: parseMoney(f.amount), p_method: kind === "receivable" ? f.method : null });
    setBusy(false);
    if (error) return toast({ tone: "error", message: errorMessage(error).includes("invalid_paid_at") ? "A data do pagamento não pode ser futura." : errorMessage(error) });
    toast({ tone: "success", message: kind === "receivable" ? "Recebimento registrado no caixa." : "Pagamento registrado no caixa." }); onDone();
  };
  return (
    <Modal open onClose={onClose} title={kind === "receivable" ? "Registrar recebimento" : "Registrar pagamento"} description={description} size="sm"
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={busy} disabled={!(parseMoney(f.amount) > 0)} onClick={go}>Confirmar</Button></>}>
      <div className="grid gap-4">
        <Field label="Data" htmlFor="st-date"><Input id="st-date" type="date" max={todayISO()} value={f.paid_at} onChange={(e) => setF((s) => ({ ...s, paid_at: e.target.value }))} /></Field>
        <Field label="Valor (R$)" htmlFor="st-amount"><Input id="st-amount" inputMode="decimal" value={f.amount} onChange={(e) => setF((s) => ({ ...s, amount: e.target.value }))} /></Field>
        {kind === "receivable" && <Field label="Forma de pagamento" htmlFor="st-method"><Select id="st-method" value={f.method} onChange={(e) => setF((s) => ({ ...s, method: e.target.value }))}>{Object.entries(methods).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>}
      </div>
    </Modal>
  );
}

function useLookups(enabled = true) {
  const { orgId } = useOrg();
  return useQuery({
    queryKey: ["fin-lookups", orgId], enabled,
    queryFn: async () => {
      const [c, p, cat, sup] = await Promise.all([
        supabase.from("clients").select("id, legal_name, trade_name").eq("organization_id", orgId).order("legal_name"),
        supabase.from("projects").select("id, name, client_id").eq("organization_id", orgId).order("name"),
        supabase.from("financial_categories").select("id, name, kind, group_name").eq("organization_id", orgId).order("name"),
        supabase.from("suppliers").select("id, name").eq("organization_id", orgId).order("name"),
      ]);
      return { clients: c.data ?? [], projects: p.data ?? [], categories: cat.data ?? [], suppliers: sup.data ?? [] };
    },
  });
}

function ReceivableModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { orgId } = useOrg();
  const toast = useToast();
  const lk = useLookups();
  const [f, setF] = useState({ client_id: "", project_id: "", category_id: "", description: "", amount: "", installments: "1", due_date: todayISO(), notes: "" });
  const valid = f.client_id && f.description.trim().length >= 2 && parseMoney(f.amount) > 0 && f.due_date;
  const save = async () => {
    const n = Math.max(1, Math.min(48, Number(f.installments) || 1)), total = parseMoney(f.amount);
    const each = Math.round((total / n) * 100) / 100;
    const rows = Array.from({ length: n }, (_, i) => {
      const [y, m, d] = f.due_date.split("-").map(Number);
      const due = new Date(Date.UTC(y, m - 1 + i, d)).toISOString().slice(0, 10);
      return { organization_id: orgId, client_id: f.client_id, project_id: f.project_id || null, category_id: f.category_id || null,
        description: n > 1 ? `${f.description.trim()} — parcela ${i + 1}/${n}` : f.description.trim(), amount: i === n - 1 ? Math.round((total - each * (n - 1)) * 100) / 100 : each,
        installment_no: i + 1, installments: n, due_date: due, status: "open", notes: f.notes || null };
    });
    const { error } = await supabase.from("accounts_receivable").insert(rows);
    if (error) return toast({ tone: "error", message: errorMessage(error) });
    toast({ tone: "success", message: n > 1 ? `${n} parcelas criadas.` : "Conta criada." }); onDone();
  };
  const bind = (k: keyof typeof f) => ({ value: f[k], onChange: (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value })) });
  return (
    <Modal open onClose={onClose} title="Nova conta a receber" footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!valid} onClick={save}>Criar</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Cliente" required htmlFor="ar-client"><Select id="ar-client" {...bind("client_id")}><option value="">Selecione…</option>{lk.data?.clients.map((c) => <option key={c.id} value={c.id}>{clientName(c)}</option>)}</Select></Field>
        <Field label="Projeto" htmlFor="ar-project"><Select id="ar-project" {...bind("project_id")}><option value="">Sem projeto</option>{lk.data?.projects.filter((p) => !f.client_id || p.client_id === f.client_id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
        <Field label="Descrição" required htmlFor="ar-desc" className="sm:col-span-2"><Input id="ar-desc" {...bind("description")} /></Field>
        <Field label="Valor total (R$)" required htmlFor="ar-amount"><Input id="ar-amount" inputMode="decimal" {...bind("amount")} /></Field>
        <Field label="Parcelas" htmlFor="ar-inst"><Input id="ar-inst" type="number" min={1} max={48} {...bind("installments")} /></Field>
        <Field label="1º vencimento" required htmlFor="ar-due"><Input id="ar-due" type="date" {...bind("due_date")} /></Field>
        <Field label="Categoria" htmlFor="ar-cat"><Select id="ar-cat" {...bind("category_id")}><option value="">Sem categoria</option>{lk.data?.categories.filter((c) => c.kind === "income").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        <Field label="Observações" htmlFor="ar-notes" className="sm:col-span-2"><Textarea id="ar-notes" rows={2} {...bind("notes")} /></Field>
      </div>
    </Modal>
  );
}

/* --------------------------------------------------------------- A pagar */
function Payables() {
  const { orgId, can } = useOrg();
  const qc = useQueryClient();
  const toast = useToast();
  const write = can("finance.write");
  const [status, setStatus] = useState<FinStatus | "pending" | "">("pending");
  const [edit, setEdit] = useState<Partial<Payable> | null>(null);
  const [settling, setSettling] = useState<{ id: string; amount: number; description: string } | null>(null);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["payables", orgId],
    queryFn: async () => { const { data, error } = await supabase.from("accounts_payable").select("*, suppliers(name), projects(name), financial_categories(name, group_name)").eq("organization_id", orgId).order("due_date"); if (error) throw error; return data as Payable[]; },
  });
  const list = useMemo(() => (data ?? []).filter((r) => !status || (status === "pending" ? ["open", "overdue"].includes(r.status) : r.status === status)), [data, status]);
  const reopen = async (id: string) => { const { error } = await supabase.rpc("reopen", { p_kind: "payable", p_id: id }); if (error) return toast({ tone: "error", message: errorMessage(error) }); refetch(); qc.invalidateQueries({ queryKey: ["finance-report"] }); };
  const exportCsv = () => downloadCsv(`contas-a-pagar-${todayISO()}`, toCsv(list, [
    { header: "Vencimento", value: (r) => date(r.due_date) }, { header: "Descrição", value: (r) => r.description }, { header: "Fornecedor", value: (r) => r.suppliers?.name },
    { header: "Categoria", value: (r) => r.financial_categories?.name }, { header: "Projeto", value: (r) => r.projects?.name }, { header: "Valor", value: (r) => Number(r.amount) },
    { header: "Status", value: (r) => statusLabel[r.status] }, { header: "Pago em", value: (r) => (r.paid_at ? date(r.paid_at) : "") }]));
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as FinStatus | "pending" | "")} className="w-48">
          <option value="pending">Pendentes</option><option value="">Todos</option>{(["open", "overdue", "paid", "cancelled"] as FinStatus[]).map((k) => <option key={k} value={k}>{statusLabel[k]}</option>)}</Select>
        <div className="ml-auto flex gap-2"><Button icon={<Download className="size-4" />} onClick={exportCsv}>CSV</Button>
          {write && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEdit({ recurrence: "none", cost_type: "operational", due_date: todayISO() })}>Nova conta a pagar</Button>}</div>
      </div>
      {error ? <ErrorState error={error} /> : isLoading ? <Spinner /> : !list.length ? <EmptyState title="Nenhuma conta a pagar" description="Cadastre despesas fixas, fornecedores, terceirizados e impostos." /> : (
        <Card padded={false} className="overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-sm">
          <thead className="bg-surface-2 text-left text-xs text-fg-3"><tr><th className="px-4 py-2.5 font-medium">Vencimento</th><th className="px-4 py-2.5 font-medium">Descrição</th>
            <th className="px-4 py-2.5 text-right font-medium">Valor</th><th className="px-4 py-2.5 font-medium">Status</th>{write && <th className="px-4 py-2.5" />}</tr></thead>
          <tbody>{list.map((r) => (
            <tr key={r.id} className="border-t border-border">
              <td className="px-4 py-3 tabular">{date(r.due_date)}</td>
              <td className="px-4 py-3"><button className="text-left hover:text-accent" disabled={!write} onClick={() => setEdit(r)}>{r.description}</button>
                <p className="text-xs text-fg-3">{[r.financial_categories?.name, r.suppliers?.name, r.projects?.name, r.recurrence !== "none" && { monthly: "mensal", quarterly: "trimestral", yearly: "anual" }[r.recurrence]].filter(Boolean).join(" · ")}</p></td>
              <td className="px-4 py-3 text-right tabular">{money(r.amount)}</td>
              <td className="px-4 py-3"><Badge tone={statusTone[r.status]} dot>{statusLabel[r.status]}</Badge></td>
              {write && <td className="px-4 py-3"><div className="flex justify-end gap-1.5">
                {["open", "overdue"].includes(r.status) && <Button size="sm" variant="primary" onClick={() => setSettling({ id: r.id, amount: Number(r.amount), description: r.description })}>Pagar</Button>}
                {r.status === "paid" && <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={() => reopen(r.id)}>Estornar</Button>}
              </div></td>}
            </tr>))}</tbody></table></div></Card>
      )}
      {settling && <SettleModal kind="payable" {...settling} onClose={() => setSettling(null)} onDone={() => { setSettling(null); refetch(); qc.invalidateQueries({ queryKey: ["finance-report"] }); }} />}
      {edit && <PayableModal initial={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); refetch(); }} />}
    </div>
  );
}

function PayableModal({ initial, onClose, onDone }: { initial: Partial<Payable>; onClose: () => void; onDone: () => void }) {
  const { orgId } = useOrg();
  const toast = useToast();
  const lk = useLookups();
  const [f, setF] = useState({ description: initial.description ?? "", amount: initial.amount ? String(initial.amount).replace(".", ",") : "", due_date: initial.due_date ?? todayISO(),
    category_id: initial.category_id ?? "", supplier_id: initial.supplier_id ?? "", project_id: initial.project_id ?? "", recurrence: initial.recurrence ?? "none", cost_type: initial.cost_type ?? "operational", notes: initial.notes ?? "" });
  const locked = initial.status === "paid";
  const valid = f.description.trim().length >= 2 && parseMoney(f.amount) > 0 && f.category_id && f.due_date;
  const save = async () => {
    const row = { description: f.description.trim(), amount: parseMoney(f.amount), due_date: f.due_date, category_id: f.category_id, supplier_id: f.supplier_id || null,
      project_id: f.project_id || null, recurrence: f.recurrence, cost_type: f.project_id ? f.cost_type : "operational", notes: f.notes || null };
    const res = initial.id ? await supabase.from("accounts_payable").update(row).eq("id", initial.id) : await supabase.from("accounts_payable").insert({ ...row, organization_id: orgId, status: "open" });
    if (res.error) return toast({ tone: "error", message: errorMessage(res.error) });
    toast({ tone: "success", message: "Conta salva." }); onDone();
  };
  const bind = (k: keyof typeof f) => ({ value: f[k], disabled: locked, onChange: (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value })) });
  return (
    <Modal open onClose={onClose} title={initial.id ? "Conta a pagar" : "Nova conta a pagar"} description={locked ? "Conta paga: estorne a baixa para editar." : undefined}
      footer={<><Button variant="ghost" onClick={onClose}>Fechar</Button>{!locked && <Button variant="primary" disabled={!valid} onClick={save}>Salvar</Button>}</>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Descrição" required htmlFor="ap-desc" className="sm:col-span-2"><Input id="ap-desc" {...bind("description")} /></Field>
        <Field label="Valor (R$)" required htmlFor="ap-amount"><Input id="ap-amount" inputMode="decimal" {...bind("amount")} /></Field>
        <Field label="Vencimento" required htmlFor="ap-due"><Input id="ap-due" type="date" {...bind("due_date")} /></Field>
        <Field label="Categoria" required htmlFor="ap-cat"><Select id="ap-cat" {...bind("category_id")}><option value="">Selecione…</option>{lk.data?.categories.filter((c) => c.kind === "expense").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        <Field label="Fornecedor" htmlFor="ap-sup"><Select id="ap-sup" {...bind("supplier_id")}><option value="">Sem fornecedor</option>{lk.data?.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
        <Field label="Projeto vinculado" htmlFor="ap-proj" hint="Despesas de projeto entram na rentabilidade dele."><Select id="ap-proj" {...bind("project_id")}><option value="">Despesa do estúdio</option>{lk.data?.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
        {f.project_id && <Field label="Tipo de custo" htmlFor="ap-cost"><Select id="ap-cost" {...bind("cost_type")}><option value="outsourced">Terceirizado</option><option value="additional">Despesa adicional</option><option value="operational">Operacional</option></Select></Field>}
        <Field label="Recorrência" htmlFor="ap-rec" hint="Ao pagar, a próxima é criada automaticamente."><Select id="ap-rec" {...bind("recurrence")}><option value="none">Não se repete</option><option value="monthly">Mensal</option><option value="quarterly">Trimestral</option><option value="yearly">Anual</option></Select></Field>
        <Field label="Observações" htmlFor="ap-notes" className="sm:col-span-2"><Textarea id="ap-notes" rows={2} {...bind("notes")} /></Field>
      </div>
    </Modal>
  );
}

/* ----------------------------------------------------------- Fornecedores */
function Suppliers() {
  const { orgId, can } = useOrg();
  const toast = useToast();
  const [f, setF] = useState({ name: "", document: "", email: "", phone: "" });
  const { data, refetch, isLoading } = useQuery({ queryKey: ["suppliers", orgId], queryFn: async () => (await supabase.from("suppliers").select("*").eq("organization_id", orgId).order("name")).data ?? [] });
  const add = async () => {
    const { error } = await supabase.from("suppliers").insert({ organization_id: orgId, name: f.name.trim(), document: f.document || null, email: f.email || null, phone: f.phone || null });
    if (error) return toast({ tone: "error", message: errorMessage(error) });
    setF({ name: "", document: "", email: "", phone: "" }); refetch();
  };
  if (isLoading) return <Spinner />;
  return (
    <div className="grid max-w-3xl gap-4">
      {can("finance.write") && <Card><div className="grid gap-2 sm:grid-cols-[1.4fr_1fr_1.2fr_1fr_auto]">
        <Input aria-label="Nome" placeholder="Nome do fornecedor" value={f.name} onChange={(e) => setF((s) => ({ ...s, name: e.target.value }))} />
        <Input aria-label="CNPJ/CPF" placeholder="CNPJ/CPF" value={f.document} onChange={(e) => setF((s) => ({ ...s, document: e.target.value }))} />
        <Input aria-label="E-mail" placeholder="E-mail" value={f.email} onChange={(e) => setF((s) => ({ ...s, email: e.target.value }))} />
        <Input aria-label="Telefone" placeholder="Telefone" value={f.phone} onChange={(e) => setF((s) => ({ ...s, phone: e.target.value }))} />
        <Button disabled={f.name.trim().length < 2} onClick={add}>Adicionar</Button></div></Card>}
      {!data?.length ? <EmptyState title="Nenhum fornecedor" description="Gráficas, freelancers, softwares e prestadores." /> : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">{data.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm"><span className="flex-1 font-medium">{s.name}</span><span className="text-xs text-fg-3">{[s.document, s.email, s.phone].filter(Boolean).join(" · ")}</span></li>))}</ul>
      )}
    </div>
  );
}
