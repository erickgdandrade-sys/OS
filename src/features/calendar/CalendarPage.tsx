import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useBreadcrumbs } from "@/components/layout/AppShell";
import { Button, Card, EmptyState, ErrorState, Field, Input, Modal, PageHeader, Segmented, Select, Spinner, Textarea, useToast, cn } from "@/components/ui";
import { useOrg } from "@/features/auth/AuthProvider";
import { errorMessage } from "@/lib/domain";
import { TZ, todayISO } from "@/lib/format";
import { supabase } from "@/lib/supabase";

type Ev = { uid: string; source: string; title: string; starts_at: string; ends_at: string | null; all_day: boolean; project_id: string | null; owner_id: string | null };
const sources: Record<string, { label: string; color: string }> = {
  task: { label: "Tarefas", color: "#64748B" }, delivery: { label: "Entregas", color: "#0B2239" }, meeting: { label: "Reuniões", color: "#0EA5E9" },
  shoot: { label: "Sessões de foto", color: "#E06C4C" }, recording: { label: "Gravações", color: "#B45309" }, publication: { label: "Publicações", color: "#7C3AED" },
  approval: { label: "Aprovações", color: "#15803D" }, internal: { label: "Internos", color: "#1E9BF0" }, other: { label: "Outros", color: "#94A3B8" },
};
const dayKey = (iso: string, allDay: boolean) => allDay ? iso.slice(0, 10) : new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(iso));
const timeOf = (iso: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const monthName = (y: number, m: number) => { const s = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m, 1))); return s[0].toUpperCase() + s.slice(1); };

export function CalendarPage() {
  useBreadcrumbs([{ label: "Calendário" }]);
  const { orgId, userId } = useOrg();
  const t = todayISO();
  const [cursor, setCursor] = useState({ y: Number(t.slice(0, 4)), m: Number(t.slice(5, 7)) - 1 });
  const [view, setView] = useState<"month" | "agenda">(() => (typeof window !== "undefined" && window.innerWidth < 768 ? "agenda" : "month"));
  const [filter, setFilter] = useState({ source: "", project: "", mine: false });
  const [creating, setCreating] = useState<string | null>(null);
  const first = new Date(Date.UTC(cursor.y, cursor.m, 1));
  const gridStart = new Date(first); gridStart.setUTCDate(1 - ((first.getUTCDay() + 6) % 7)); // semana começa na segunda
  const days = Array.from({ length: 42 }, (_, i) => { const d = new Date(gridStart); d.setUTCDate(gridStart.getUTCDate() + i); return d.toISOString().slice(0, 10); });
  const from = days[0], to = days[41];

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["calendar", orgId, from],
    queryFn: async () => {
      const { data, error } = await supabase.from("calendar_feed").select("*").eq("organization_id", orgId)
        .gte("starts_at", `${from}T00:00:00-03:00`).lte("starts_at", `${to}T23:59:59-03:00`).order("starts_at");
      if (error) throw error;
      return data as Ev[];
    },
  });
  const projects = useQuery({ queryKey: ["cal-projects", orgId], queryFn: async () => (await supabase.from("projects").select("id, name").eq("organization_id", orgId).not("status", "in", "(completed,cancelled)").order("name")).data ?? [] });
  const events = useMemo(() => (data ?? []).filter((e) => (!filter.source || e.source === filter.source) && (!filter.project || e.project_id === filter.project) && (!filter.mine || e.owner_id === userId)), [data, filter, userId]);
  const byDay = useMemo(() => { const m: Record<string, Ev[]> = {}; events.forEach((e) => { (m[dayKey(e.starts_at, e.all_day)] ??= []).push(e); }); return m; }, [events]);
  const move = (n: number) => setCursor((c) => { const d = new Date(Date.UTC(c.y, c.m + n, 1)); return { y: d.getUTCFullYear(), m: d.getUTCMonth() }; });
  const linkOf = (e: Ev) => (e.project_id ? `/projetos/${e.project_id}` : undefined);

  return (
    <>
      <PageHeader title="Calendário" description="Entregas, tarefas, reuniões, sessões, gravações, publicações e aprovações num só lugar."
        actions={<><Segmented value={view} onChange={setView} items={[{ value: "month", label: "Mês" }, { value: "agenda", label: "Agenda" }]} />
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(todayISO())}>Novo compromisso</Button></>} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" aria-label="Mês anterior" onClick={() => move(-1)}><ChevronLeft className="size-4" /></Button>
          <p className="w-44 text-center text-sm font-medium">{monthName(cursor.y, cursor.m)}</p>
          <Button size="sm" variant="ghost" aria-label="Próximo mês" onClick={() => move(1)}><ChevronRight className="size-4" /></Button>
          <Button size="sm" onClick={() => setCursor({ y: Number(t.slice(0, 4)), m: Number(t.slice(5, 7)) - 1 })}>Hoje</Button>
        </div>
        <Select aria-label="Tipo" value={filter.source} onChange={(e) => setFilter((f) => ({ ...f, source: e.target.value }))} className="w-44"><option value="">Todos os tipos</option>{Object.entries(sources).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}</Select>
        <Select aria-label="Projeto" value={filter.project} onChange={(e) => setFilter((f) => ({ ...f, project: e.target.value }))} className="w-52"><option value="">Todos os projetos</option>{projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
        <label className="flex items-center gap-2 text-sm text-fg-2"><input type="checkbox" className="accent-[var(--accent)]" checked={filter.mine} onChange={(e) => setFilter((f) => ({ ...f, mine: e.target.checked }))} />Só os meus</label>
      </div>
      {error ? <ErrorState error={error} onRetry={refetch} /> : isLoading ? <Spinner /> : view === "month" ? (
        <Card padded={false} className="overflow-hidden">
          <div className="grid grid-cols-7 border-b border-border bg-surface-2 text-center text-[11px] font-medium uppercase tracking-wider text-fg-3">{["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].map((d) => <div key={d} className="py-2">{d}</div>)}</div>
          <div className="grid grid-cols-7">{days.map((d) => {
            const inMonth = Number(d.slice(5, 7)) - 1 === cursor.m, items = byDay[d] ?? [];
            return (
              <div key={d} onDoubleClick={() => setCreating(d)} className={cn("min-h-28 min-w-0 overflow-hidden border-b border-r border-border p-1.5 [&:nth-child(7n)]:border-r-0", !inMonth && "bg-surface-2/50")}>
                <p className={cn("mb-1 flex size-6 items-center justify-center rounded-full text-xs tabular", d === t ? "bg-accent font-semibold text-accent-fg" : inMonth ? "text-fg-2" : "text-fg-3")}>{Number(d.slice(8))}</p>
                <ul className="grid min-w-0 gap-0.5">{items.slice(0, 4).map((e) => {
                  const body = <span className="flex items-center gap-1 truncate rounded px-1 py-0.5 text-[11px] hover:bg-surface-2"><span className="size-1.5 shrink-0 rounded-full" style={{ background: sources[e.source]?.color }} />{!e.all_day && <span className="text-fg-3 tabular">{timeOf(e.starts_at)}</span>}<span className="truncate">{e.title}</span></span>;
                  const to = linkOf(e);
                  return <li key={e.uid} title={e.title} className="min-w-0">{to ? <Link to={to}>{body}</Link> : body}</li>;
                })}{items.length > 4 && <li className="px-1 text-[11px] text-fg-3">+{items.length - 4} mais</li>}</ul>
              </div>);
          })}</div>
        </Card>
      ) : (
        !events.length ? <EmptyState title="Nada neste período" description="Prazos de tarefas e projetos, reuniões e produções aparecem aqui automaticamente." /> : (
          <div className="grid gap-4">{Object.keys(byDay).sort().filter((d) => d >= from && d <= to).map((d) => (
            <section key={d}>
              <h2 className={cn("mb-1.5 text-xs font-medium uppercase tracking-wider", d === t ? "text-accent" : "text-fg-3")}>
                {new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", timeZone: "UTC" }).format(new Date(d + "T12:00:00Z"))}</h2>
              <ul className="divide-y divide-border rounded-lg border border-border bg-surface">{byDay[d].map((e) => {
                const to = linkOf(e);
                const row = <div className="flex items-center gap-3 px-3 py-2.5 text-sm"><span className="size-2 shrink-0 rounded-full" style={{ background: sources[e.source]?.color }} />
                  <span className="w-12 shrink-0 text-xs text-fg-3 tabular">{e.all_day ? "Dia" : timeOf(e.starts_at)}</span><span className="min-w-0 flex-1 truncate">{e.title}</span>
                  <span className="hidden text-xs text-fg-3 sm:inline">{sources[e.source]?.label}</span></div>;
                return <li key={e.uid}>{to ? <Link to={to} className="block hover:bg-surface-2/60">{row}</Link> : row}</li>;
              })}</ul>
            </section>))}</div>)
      )}
      <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-3">{Object.entries(sources).map(([k, s]) => <li key={k} className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: s.color }} />{s.label}</li>)}</ul>
      <p className="mt-2 text-xs text-fg-3">Sincronização com o Google Calendar: prevista na Fase 5 (Configurações → Integrações).</p>
      {creating && <NewEventModal day={creating} projects={projects.data ?? []} onClose={() => setCreating(null)} onDone={() => { setCreating(null); refetch(); }} />}
    </>
  );
}

function NewEventModal({ day, projects, onClose, onDone }: { day: string; projects: { id: string; name: string }[]; onClose: () => void; onDone: () => void }) {
  const { orgId, userId } = useOrg();
  const toast = useToast();
  const [f, setF] = useState({ kind: "meeting", title: "", day, start: "10:00", end: "11:00", all_day: false, project_id: "", location: "", notes: "" });
  const valid = f.title.trim().length >= 2 && f.day && (f.all_day || f.end > f.start);
  const save = async () => {
    const starts = new Date(`${f.day}T${f.all_day ? "00:00" : f.start}:00-03:00`).toISOString();
    const ends = f.all_day ? null : new Date(`${f.day}T${f.end}:00-03:00`).toISOString();
    const res = f.kind === "meeting"
      ? await supabase.from("meetings").insert({ organization_id: orgId, title: f.title.trim(), starts_at: starts, ends_at: ends, location: f.location || null, project_id: f.project_id || null, notes: f.notes || null, attendees: [userId] })
      : await supabase.from("calendar_events").insert({ organization_id: orgId, title: f.title.trim(), category: f.kind, starts_at: starts, ends_at: ends, all_day: f.all_day, project_id: f.project_id || null, owner_id: userId });
    if (res.error) return toast({ tone: "error", message: errorMessage(res.error) });
    toast({ tone: "success", message: "Compromisso criado." }); onDone();
  };
  const bind = (k: keyof typeof f) => ({ value: f[k] as string, onChange: (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value })) });
  return (
    <Modal open onClose={onClose} title="Novo compromisso" footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!valid} onClick={save}>Criar</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Tipo" htmlFor="ev-kind"><Select id="ev-kind" {...bind("kind")}><option value="meeting">Reunião</option><option value="internal">Compromisso interno</option><option value="delivery">Entrega</option><option value="shoot">Sessão fotográfica</option><option value="recording">Gravação</option></Select></Field>
        <Field label="Projeto" htmlFor="ev-proj"><Select id="ev-proj" {...bind("project_id")}><option value="">Sem projeto</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
        <Field label="Título" required htmlFor="ev-title" className="sm:col-span-2"><Input id="ev-title" {...bind("title")} /></Field>
        <Field label="Data" htmlFor="ev-day"><Input id="ev-day" type="date" {...bind("day")} /></Field>
        <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" className="accent-[var(--accent)]" disabled={f.kind === "meeting"} checked={f.all_day && f.kind !== "meeting"} onChange={(e) => setF((s) => ({ ...s, all_day: e.target.checked }))} />Dia inteiro</label>
        {!(f.all_day && f.kind !== "meeting") && <><Field label="Início" htmlFor="ev-start"><Input id="ev-start" type="time" {...bind("start")} /></Field>
          <Field label="Fim" htmlFor="ev-end" error={f.end <= f.start ? "Termina antes de começar." : undefined}><Input id="ev-end" type="time" {...bind("end")} /></Field></>}
        {f.kind === "meeting" && <><Field label="Local ou link" htmlFor="ev-loc" className="sm:col-span-2"><Input id="ev-loc" {...bind("location")} /></Field>
          <Field label="Pauta" htmlFor="ev-notes" className="sm:col-span-2"><Textarea id="ev-notes" rows={2} {...bind("notes")} /></Field></>}
      </div>
    </Modal>
  );
}
