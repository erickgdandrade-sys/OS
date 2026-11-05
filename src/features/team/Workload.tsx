import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Avatar, Badge, Card, ErrorState, Select, Spinner, cn } from "@/components/ui";
import { useOrg } from "@/features/auth/AuthProvider";
import { addDaysISO, todayISO } from "@/lib/format";
import { supabase } from "@/lib/supabase";

type Row = { user_id: string; full_name: string; job_title: string | null; capacity_hours: number; open_tasks: number; overdue_tasks: number; estimated_hours: number; logged_hours: number };

/** Distribuição de trabalho: horas estimadas das tarefas com prazo no período × capacidade. */
export function Workload() {
  const { orgId } = useOrg();
  const [days, setDays] = useState("7");
  const from = todayISO(), to = addDaysISO(from, Number(days) - 1);
  const logged = { from: addDaysISO(from, -Number(days)), to: from };
  const { data, isLoading, error } = useQuery({
    queryKey: ["workload", orgId, days],
    queryFn: async () => {
      const [ahead, past] = await Promise.all([
        supabase.rpc("team_workload", { p_org: orgId, p_from: from, p_to: to }),
        supabase.rpc("team_workload", { p_org: orgId, p_from: logged.from, p_to: logged.to }),
      ]);
      if (ahead.error) throw ahead.error;
      const pastMap = Object.fromEntries(((past.data ?? []) as Row[]).map((r) => [r.user_id, r.logged_hours]));
      return (ahead.data as Row[]).map((r) => ({ ...r, past_logged: Number(pastMap[r.user_id] ?? 0) }));
    },
  });
  if (error) return <ErrorState error={error} />;
  if (isLoading) return <Spinner />;
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select aria-label="Período" value={days} onChange={(e) => setDays(e.target.value)} className="w-48"><option value="7">Próximos 7 dias</option><option value="14">Próximos 14 dias</option><option value="30">Próximos 30 dias</option></Select>
        <p className="text-xs text-fg-3">Carga = horas estimadas das tarefas abertas com prazo no período. Tarefas sem estimativa não entram na barra.</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {(data ?? []).map((r) => {
          const pct = r.capacity_hours ? (100 * Number(r.estimated_hours)) / Number(r.capacity_hours) : 0;
          const tone = pct > 100 ? "danger" : pct > 80 ? "warning" : "success";
          return (
            <Card key={r.user_id}>
              <div className="flex items-center gap-3"><Avatar name={r.full_name} size={32} />
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{r.full_name || "Sem nome"}</p><p className="truncate text-xs text-fg-3">{r.job_title ?? "—"}</p></div>
                <Badge tone={tone}>{pct > 100 ? "Sobrecarga" : pct > 80 ? "No limite" : "Disponível"}</Badge></div>
              <div className="mt-4">
                <div className="flex justify-between text-xs text-fg-3"><span>{Number(r.estimated_hours)}h previstas</span><span>capacidade {Number(r.capacity_hours)}h</span></div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-3"><div className={cn("h-full rounded-full", tone === "danger" ? "bg-danger" : tone === "warning" ? "bg-warning" : "bg-brand")} style={{ width: `${Math.min(100, pct)}%` }} /></div>
              </div>
              <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
                <div><dt className="text-[11px] text-fg-3">Abertas</dt><dd className="text-sm font-medium tabular">{r.open_tasks}</dd></div>
                <div><dt className="text-[11px] text-fg-3">Atrasadas</dt><dd className={cn("text-sm font-medium tabular", Number(r.overdue_tasks) > 0 && "text-danger")}>{r.overdue_tasks}</dd></div>
                <div><dt className="text-[11px] text-fg-3">Lançadas ({days}d)</dt><dd className="text-sm font-medium tabular">{r.past_logged}h</dd></div>
              </dl>
            </Card>);
        })}
      </div>
    </div>
  );
}
