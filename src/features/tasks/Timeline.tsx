import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Link2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Button, Select, cn, useToast } from "@/components/ui";
import { useOrg } from "@/features/auth/AuthProvider";
import { errorMessage, taskStatusLabel, type Task } from "@/lib/domain";
import { addDaysISO, daysUntil, todayISO } from "@/lib/format";
import { supabase } from "@/lib/supabase";

const statusColor: Record<string, string> = { todo: "#94A3B8", in_progress: "#1F4FE0", review: "#2E8CDC", blocked: "#C2283A", done: "#15803D" };

/** Linha do tempo (Gantt simples) das tarefas com datas. Dependências mostradas como alerta. */
export function Timeline({ tasks, deps, onOpen }: { tasks: Task[]; deps: { task_id: string; depends_on_id: string }[]; onOpen: (id: string) => void }) {
  const dated = tasks.filter((t) => !t.parent_id && (t.start_date || t.due_date));
  const undated = tasks.filter((t) => !t.parent_id && !t.start_date && !t.due_date);
  const range = useMemo(() => {
    const ds = dated.flatMap((t) => [t.start_date ?? t.due_date!, t.due_date ?? t.start_date!]).sort();
    const start = addDaysISO(ds[0] ?? todayISO(), -2), end = addDaysISO(ds.at(-1) ?? todayISO(), 3);
    return { start, days: Math.max(14, (daysUntil(end, start) ?? 14) + 1) };
  }, [dated]);
  const col = 28;
  const off = (iso: string) => (daysUntil(iso, range.start) ?? 0);
  const today = off(todayISO());
  const byId = Object.fromEntries(tasks.map((t) => [t.id, t]));
  if (!dated.length) return <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-fg-3">Defina início ou prazo nas tarefas para vê-las na linha do tempo.</p>;
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface scrollbar-thin">
      <div style={{ width: 260 + range.days * col }} className="relative">
        <div className="sticky top-0 z-10 flex border-b border-border bg-surface-2 text-[10px] text-fg-3">
          <div className="sticky left-0 w-[260px] shrink-0 bg-surface-2 px-3 py-2 font-medium uppercase tracking-wider">Tarefa</div>
          {Array.from({ length: range.days }, (_, i) => { const d = addDaysISO(range.start, i); const wd = new Date(d + "T12:00:00Z").getUTCDay();
            return <div key={d} style={{ width: col }} className={cn("shrink-0 py-2 text-center tabular", (wd === 0 || wd === 6) && "bg-surface-3/60")}>{d.slice(8)}{d.endsWith("-01") && <span className="block">{d.slice(5, 7)}</span>}</div>; })}
        </div>
        {today >= 0 && today < range.days && <div className="pointer-events-none absolute top-0 bottom-0 z-0 w-px bg-danger/60" style={{ left: 260 + today * col + col / 2 }} />}
        {dated.map((t) => {
          const s = off(t.start_date ?? t.due_date!), e = off(t.due_date ?? t.start_date!);
          const blockers = deps.filter((d) => d.task_id === t.id).map((d) => byId[d.depends_on_id]).filter((b) => b && b.status !== "done");
          return (
            <div key={t.id} className="relative flex items-center border-b border-border last:border-0 hover:bg-surface-2/40">
              <button onClick={() => onOpen(t.id)} className="sticky left-0 z-10 flex w-[260px] shrink-0 items-center gap-1.5 truncate bg-surface px-3 py-2 text-left text-sm hover:text-accent">
                {blockers.length > 0 && <AlertTriangle className="size-3.5 shrink-0 text-warning" aria-label="Depende de tarefas não concluídas" />}<span className="truncate">{t.title}</span></button>
              <button onClick={() => onOpen(t.id)} title={`${t.title} · ${taskStatusLabel[t.status]}`}
                className="absolute h-5 rounded-md text-left text-[10px] font-medium text-white shadow-sm" style={{ left: 260 + s * col + 2, width: Math.max(1, e - s + 1) * col - 4, background: statusColor[t.status] }}>
                <span className="block truncate px-1.5 leading-5">{t.status === "done" ? "✓" : ""}</span></button>
              <div className="h-9" />
            </div>);
        })}
      </div>
      {undated.length > 0 && <p className="border-t border-border px-3 py-2 text-xs text-fg-3">{undated.length} tarefa(s) sem datas não aparecem aqui.</p>}
    </div>
  );
}

/** Dependências de uma tarefa (exibido no detalhe da tarefa). */
export function TaskDependencies({ task, tasks, canEdit }: { task: Task; tasks: Task[]; canEdit: boolean }) {
  const { orgId } = useOrg();
  const toast = useToast();
  const [pick, setPick] = useState("");
  const { data, refetch } = useQuery({ queryKey: ["deps", task.id], queryFn: async () => (await supabase.from("task_dependencies").select("depends_on_id").eq("task_id", task.id)).data ?? [] });
  const ids = (data ?? []).map((d) => d.depends_on_id);
  const options = tasks.filter((t) => t.id !== task.id && !t.parent_id && !ids.includes(t.id));
  const add = async () => {
    const { error } = await supabase.from("task_dependencies").insert({ organization_id: orgId, task_id: task.id, depends_on_id: pick });
    if (error) return toast({ tone: "error", message: errorMessage(error) });
    setPick(""); refetch();
  };
  const remove = async (id: string) => { await supabase.from("task_dependencies").delete().eq("task_id", task.id).eq("depends_on_id", id); refetch(); };
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium text-fg-2"><Link2 className="size-3.5" />Depende de</h3>
      <ul className="mb-2 grid gap-1">{ids.map((id) => { const d = tasks.find((t) => t.id === id); return (
        <li key={id} className="flex items-center gap-2 text-sm"><span className={cn("size-2 rounded-full", d?.status === "done" ? "bg-success" : "bg-warning")} />
          <span className="flex-1">{d?.title ?? "Tarefa removida"}</span><span className="text-xs text-fg-3">{d ? taskStatusLabel[d.status] : ""}</span>
          {canEdit && <button aria-label="Remover dependência" onClick={() => remove(id)} className="text-fg-3 hover:text-danger"><X className="size-3.5" /></button>}</li>); })}
        {!ids.length && <li className="text-xs text-fg-3">Sem dependências.</li>}</ul>
      {canEdit && <div className="flex gap-2"><Select aria-label="Adicionar dependência" value={pick} onChange={(e) => setPick(e.target.value)}><option value="">Escolher tarefa…</option>{options.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</Select><Button disabled={!pick} onClick={add}>Adicionar</Button></div>}
    </section>
  );
}
