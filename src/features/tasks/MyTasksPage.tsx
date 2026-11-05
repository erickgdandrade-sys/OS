import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CheckCircle2, Circle, ListChecks } from "lucide-react";
import { useBreadcrumbs } from "@/components/layout/AppShell";
import { Badge, EmptyState, ErrorState, PageHeader, Segmented, Spinner, useToast, cn } from "@/components/ui";
import { useOrg } from "@/features/auth/AuthProvider";
import { DueLabel } from "@/features/projects/ProjectsPages";
import { errorMessage, priorityLabel, priorityTone, taskStatusLabel, taskStatusTone, type Task } from "@/lib/domain";
import { daysUntil } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { useState } from "react";

type Row = Task & { projects: { name: string } | null };

export function MyTasksPage() {
  useBreadcrumbs([{ label: "Minhas tarefas" }]);
  const { orgId, userId } = useOrg();
  const qc = useQueryClient();
  const toast = useToast();
  const [filter, setFilter] = useState<"open" | "done">("open");
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["my-tasks", orgId, filter],
    queryFn: async () => {
      let q = supabase.from("tasks").select("*, projects(name)").eq("organization_id", orgId).eq("assignee_id", userId);
      q = filter === "open" ? q.neq("status", "done").order("due_date", { ascending: true, nullsFirst: false }) : q.eq("status", "done").order("completed_at", { ascending: false }).limit(50);
      const { data, error } = await q;
      if (error) throw error;
      return data as Row[];
    },
  });
  const toggle = useMutation({
    mutationFn: async (t: Row) => { const { error } = await supabase.from("tasks").update({ status: t.status === "done" ? "todo" : "done" }).eq("id", t.id); if (error) throw error; },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-tasks"] }),
    onError: (e) => toast({ tone: "error", message: errorMessage(e) }),
  });
  const groups = filter === "done" ? [["Concluídas", data ?? []] as const] : ([
    ["Atrasadas", (data ?? []).filter((t) => (daysUntil(t.due_date) ?? 1) < 0)],
    ["Hoje e próximos 7 dias", (data ?? []).filter((t) => { const d = daysUntil(t.due_date); return d !== null && d >= 0 && d <= 7; })],
    ["Mais adiante", (data ?? []).filter((t) => (daysUntil(t.due_date) ?? -1) > 7)],
    ["Sem prazo", (data ?? []).filter((t) => !t.due_date)],
  ] as const);

  return (
    <>
      <PageHeader title="Minhas tarefas" description="Tudo o que está atribuído a você, em todos os projetos."
        actions={<Segmented value={filter} onChange={setFilter} items={[{ value: "open", label: "Pendentes" }, { value: "done", label: "Concluídas" }]} />} />
      {error ? <ErrorState error={error} onRetry={refetch} /> : isLoading ? <Spinner /> : !data?.length ? (
        <EmptyState icon={<ListChecks className="size-5" />} title={filter === "open" ? "Nada pendente" : "Nenhuma tarefa concluída ainda"} description={filter === "open" ? "Quando alguém atribuir uma tarefa a você, ela aparece aqui." : undefined} />
      ) : (
        <div className="grid gap-6">
          {groups.filter(([, items]) => items.length).map(([label, items]) => (
            <section key={label}>
              <h2 className={cn("mb-2 text-xs font-medium uppercase tracking-wider", label === "Atrasadas" ? "text-danger" : "text-fg-3")}>{label} · {items.length}</h2>
              <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
                {items.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 px-3 py-2.5">
                    <button aria-label={t.status === "done" ? "Reabrir" : "Concluir"} onClick={() => toggle.mutate(t)} className={t.status === "done" ? "text-success" : "text-fg-3 hover:text-accent"}>
                      {t.status === "done" ? <CheckCircle2 className="size-[18px]" /> : <Circle className="size-[18px]" />}</button>
                    <Link to={`/projetos/${t.project_id}`} className="min-w-0 flex-1">
                      <p className={cn("truncate text-sm", t.status === "done" && "text-fg-3 line-through")}>{t.title}</p>
                      <p className="truncate text-xs text-fg-3">{t.projects?.name}</p>
                    </Link>
                    {t.priority !== "medium" && <Badge tone={priorityTone[t.priority]} className="hidden sm:inline-flex">{priorityLabel[t.priority]}</Badge>}
                    <Badge tone={taskStatusTone[t.status]} className="hidden md:inline-flex">{taskStatusLabel[t.status]}</Badge>
                    <DueLabel due={t.due_date} done={t.status === "done"} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
