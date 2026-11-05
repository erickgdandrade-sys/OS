import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Circle, Clock, Eye, EyeOff, KanbanSquare, List, MessageSquare, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Avatar, Badge, Button, ConfirmDialog, EmptyState, Field, Input, Modal, Segmented, Select, Spinner, Textarea, useToast, cn } from "@/components/ui";
import { useOrg } from "@/features/auth/AuthProvider";
import { DueLabel } from "@/features/projects/ProjectsPages";
import { errorMessage, priorityLabel, taskStatusLabel, taskStatusOrder, taskStatusTone, type Profile, type Task, type TaskStatus } from "@/lib/domain";
import { dateTime, hours, todayISO } from "@/lib/format";
import { supabase } from "@/lib/supabase";

export type Member = { user_id: string; profiles: Profile | null };

/** Perfis não são embutíveis via PostgREST (FK aponta para auth.users); busca em lote. */
export async function fetchProfiles(ids: string[]): Promise<Record<string, Profile>> {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return {};
  const { data } = await supabase.from("profiles").select("id, full_name, avatar_path").in("id", uniq);
  return Object.fromEntries((data ?? []).map((p) => [p.id, p as Profile]));
}

export function useTaskMutations(projectId: string) {
  const qc = useQueryClient();
  const toast = useToast();
  const key = ["tasks", projectId];
  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Task> }) => {
      const { error } = await supabase.from("tasks").update(patch).eq("id", id);
      if (error) throw error;
    },
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<Task[]>(key);
      qc.setQueryData<Task[]>(key, (old) => old?.map((t) => (t.id === id ? { ...t, ...patch } : t)));
      return { prev };
    },
    onError: (e, _v, ctx) => { qc.setQueryData(key, ctx?.prev); toast({ tone: "error", message: errorMessage(e) }); },
    onSettled: () => { qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: ["projects"] }); qc.invalidateQueries({ queryKey: ["my-tasks"] }); },
  });
  return { update };
}

/* -------------------------------------------- Tarefas de um projeto */
export function ProjectTasks({ projectId, members, canEdit }: { projectId: string; members: Member[]; canEdit: boolean }) {
  const { orgId, userId } = useOrg();
  const qc = useQueryClient();
  const toast = useToast();
  const [view, setView] = useState<"list" | "kanban">("list");
  const [title, setTitle] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const { update } = useTaskMutations(projectId);
  const { data: tasks, isLoading } = useQuery({
    queryKey: ["tasks", projectId],
    queryFn: async () => {
      const { data, error } = await supabase.from("tasks").select("*").eq("project_id", projectId).order("position").order("created_at");
      if (error) throw error;
      return data as Task[];
    },
  });
  const roots = useMemo(() => (tasks ?? []).filter((t) => !t.parent_id), [tasks]);
  const subsOf = (id: string) => (tasks ?? []).filter((t) => t.parent_id === id);
  const memberName = (id: string | null) => members.find((m) => m.user_id === id)?.profiles?.full_name || null;

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    const { error } = await supabase.from("tasks").insert({ organization_id: orgId, project_id: projectId, title: t, created_by: userId,
      position: (roots.at(-1)?.position ?? 0) + 1 });
    if (error) { toast({ tone: "error", message: errorMessage(error) }); return; }
    setTitle("");
    qc.invalidateQueries({ queryKey: ["tasks", projectId] }); qc.invalidateQueries({ queryKey: ["projects"] });
  };

  if (isLoading) return <Spinner />;
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <form onSubmit={add} className="flex min-w-0 flex-1 gap-2">
          <Input aria-label="Nova tarefa" placeholder="Adicionar tarefa e pressionar Enter" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Button type="submit" icon={<Plus className="size-4" />} disabled={!title.trim()}>Adicionar</Button>
        </form>
        <Segmented value={view} onChange={setView} items={[{ value: "list", label: "Lista", icon: <List className="size-3.5" /> }, { value: "kanban", label: "Kanban", icon: <KanbanSquare className="size-3.5" /> }]} />
      </div>

      {roots.length === 0 ? <EmptyState title="Nenhuma tarefa" description="Adicione tarefas acima ou aplique um modelo ao projeto." /> : view === "list" ? (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
          {roots.map((t) => {
            const subs = subsOf(t.id);
            return (
              <li key={t.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-surface-2/50">
                <button aria-label={t.status === "done" ? "Reabrir tarefa" : "Concluir tarefa"}
                  onClick={() => update.mutate({ id: t.id, patch: { status: t.status === "done" ? "todo" : "done" } })}
                  className={cn("shrink-0", t.status === "done" ? "text-success" : "text-fg-3 hover:text-accent")}>
                  {t.status === "done" ? <CheckCircle2 className="size-[18px]" /> : <Circle className="size-[18px]" />}
                </button>
                <button onClick={() => setOpenId(t.id)} className="min-w-0 flex-1 text-left">
                  <span className={cn("block truncate text-sm", t.status === "done" && "text-fg-3 line-through")}>{t.title}</span>
                  {subs.length > 0 && <span className="text-[11px] text-fg-3">{subs.filter((s) => s.status === "done").length}/{subs.length} subtarefas</span>}
                </button>
                {t.client_visible && <Eye className="size-3.5 shrink-0 text-fg-3" aria-label="Visível ao cliente" />}
                <Badge tone={taskStatusTone[t.status]} className="hidden sm:inline-flex">{taskStatusLabel[t.status]}</Badge>
                <span className="hidden w-28 md:block"><DueLabel due={t.due_date} done={t.status === "done"} /></span>
                {t.assignee_id ? <Avatar name={memberName(t.assignee_id)} size={22} /> : <span className="size-[22px] rounded-full border border-dashed border-border-strong" aria-hidden />}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2 scrollbar-thin">
          {taskStatusOrder.map((s) => {
            const items = roots.filter((t) => t.status === s);
            return (
              <div key={s} className="flex w-64 shrink-0 flex-col rounded-lg bg-surface-2/70 p-2"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { const id = e.dataTransfer.getData("text/task"); if (id) update.mutate({ id, patch: { status: s } }); }}>
                <div className="flex items-center justify-between px-1.5 pb-2 pt-1"><Badge tone={taskStatusTone[s]} dot>{taskStatusLabel[s]}</Badge><span className="text-xs text-fg-3">{items.length}</span></div>
                <div className="grid gap-2">
                  {items.map((t) => (
                    <button key={t.id} draggable onDragStart={(e) => e.dataTransfer.setData("text/task", t.id)} onClick={() => setOpenId(t.id)}
                      className="rounded-md border border-border bg-surface p-2.5 text-left shadow-sm hover:border-border-strong">
                      <p className="text-sm leading-snug">{t.title}</p>
                      <div className="mt-2 flex items-center justify-between"><DueLabel due={t.due_date} done={t.status === "done"} />{t.assignee_id && <Avatar name={memberName(t.assignee_id)} size={20} />}</div>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {openId && <TaskModal taskId={openId} projectId={projectId} members={members} canEdit={canEdit} onClose={() => setOpenId(null)} />}
    </div>
  );
}

/* ----------------------------------------------- Detalhe da tarefa */
export function TaskModal({ taskId, projectId, members, canEdit, onClose }: { taskId: string; projectId: string; members: Member[]; canEdit: boolean; onClose: () => void }) {
  const { orgId, userId, can } = useOrg();
  const qc = useQueryClient();
  const toast = useToast();
  const { update } = useTaskMutations(projectId);
  const [comment, setComment] = useState("");
  const [sub, setSub] = useState("");
  const [minutes, setMinutes] = useState("");
  const [confirmDel, setConfirmDel] = useState(false);
  const all = qc.getQueryData<Task[]>(["tasks", projectId]) ?? [];
  const task = all.find((t) => t.id === taskId);
  const subs = all.filter((t) => t.parent_id === taskId);
  const comments = useQuery({
    queryKey: ["task-comments", taskId],
    queryFn: async () => {
      const rows = ((await supabase.from("task_comments").select("id, body, created_at, author_id").eq("task_id", taskId).order("created_at")).data ?? []) as { id: string; body: string; created_at: string; author_id: string }[];
      const names = await fetchProfiles(rows.map((r) => r.author_id));
      return rows.map((r) => ({ ...r, profiles: names[r.author_id] ?? null }));
    },
  });
  const time = useQuery({
    queryKey: ["task-time", taskId],
    queryFn: async () => (await supabase.from("time_entries").select("minutes").eq("task_id", taskId)).data ?? [],
  });
  if (!task) return null;
  const canChange = canEdit || task.assignee_id === userId || task.created_by === userId;
  const set = (patch: Partial<Task>) => update.mutate({ id: task.id, patch });
  const spent = (time.data ?? []).reduce((s, r: { minutes: number }) => s + r.minutes, 0);

  const addComment = async () => {
    const body = comment.trim(); if (!body) return;
    const { error } = await supabase.from("task_comments").insert({ organization_id: orgId, task_id: task.id, author_id: userId, body, is_internal: true });
    if (error) return toast({ tone: "error", message: errorMessage(error) });
    setComment(""); comments.refetch();
  };
  const addSub = async () => {
    const t = sub.trim(); if (!t) return;
    const { error } = await supabase.from("tasks").insert({ organization_id: orgId, project_id: projectId, parent_id: task.id, title: t, created_by: userId });
    if (error) return toast({ tone: "error", message: errorMessage(error) });
    setSub(""); qc.invalidateQueries({ queryKey: ["tasks", projectId] });
  };
  const logTime = async () => {
    const m = Math.round(Number(minutes.replace(",", ".")) * 60);
    if (!m || m < 1 || m > 1440) return toast({ tone: "error", message: "Informe as horas (ex.: 1,5)." });
    const { error } = await supabase.from("time_entries").insert({ organization_id: orgId, project_id: projectId, task_id: task.id, user_id: userId, minutes: m, work_date: todayISO() });
    if (error) return toast({ tone: "error", message: errorMessage(error) });
    setMinutes(""); time.refetch(); toast({ tone: "success", message: `${hours(m)} registradas.` });
  };
  const remove = async () => {
    const { error } = await supabase.from("tasks").delete().eq("id", task.id);
    if (error) { setConfirmDel(false); return toast({ tone: "error", message: errorMessage(error) }); }
    qc.invalidateQueries({ queryKey: ["tasks", projectId] }); qc.invalidateQueries({ queryKey: ["projects"] });
    toast({ tone: "success", message: "Tarefa excluída." }); onClose();
  };

  return (
    <Modal open onClose={onClose} size="lg" title="Tarefa"
      footer={<>{(canEdit || task.created_by === userId) && <Button variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => setConfirmDel(true)} className="mr-auto">Excluir</Button>}<Button onClick={onClose}>Fechar</Button></>}>
      <div className="grid gap-5">
        <Input aria-label="Título" defaultValue={task.title} disabled={!canChange} className="h-10 border-transparent px-1 text-base font-semibold shadow-none hover:border-border"
          onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== task.title) set({ title: v }); }} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Status" htmlFor="t-status"><Select id="t-status" disabled={!canChange} value={task.status} onChange={(e) => set({ status: e.target.value as TaskStatus })}>
            {taskStatusOrder.map((s) => <option key={s} value={s}>{taskStatusLabel[s]}</option>)}</Select></Field>
          <Field label="Responsável" htmlFor="t-assignee"><Select id="t-assignee" disabled={!canEdit && !can("tasks.assign")} value={task.assignee_id ?? ""} onChange={(e) => set({ assignee_id: e.target.value || null })}>
            <option value="">Sem responsável</option>{members.map((m) => <option key={m.user_id} value={m.user_id}>{m.profiles?.full_name || "Sem nome"}</option>)}</Select></Field>
          <Field label="Prioridade" htmlFor="t-priority"><Select id="t-priority" disabled={!canChange} value={task.priority} onChange={(e) => set({ priority: e.target.value as Task["priority"] })}>
            {Object.entries(priorityLabel).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
          <Field label="Prazo" htmlFor="t-due"><Input id="t-due" type="date" disabled={!canChange} value={task.due_date ?? ""} onChange={(e) => set({ due_date: e.target.value || null })} /></Field>
          <Field label="Tempo estimado (h)" htmlFor="t-est"><Input id="t-est" type="number" min={0} step={0.5} disabled={!canChange} defaultValue={task.estimated_hours ?? ""} onBlur={(e) => set({ estimated_hours: e.target.value ? Number(e.target.value) : null })} /></Field>
          <div className="grid gap-1.5"><span className="text-xs font-medium text-fg-2">Tempo realizado</span>
            <div className="flex h-9 items-center gap-2 text-sm"><Clock className="size-4 text-fg-3" /><span className="tabular">{hours(spent)}</span>
              {task.estimated_hours ? <Badge tone={spent / 60 > Number(task.estimated_hours) ? "danger" : "neutral"}>de {task.estimated_hours}h</Badge> : null}</div></div>
        </div>
        <Field label="Descrição" htmlFor="t-desc"><Textarea id="t-desc" rows={4} disabled={!canChange} defaultValue={task.description ?? ""} onBlur={(e) => { if (e.target.value !== (task.description ?? "")) set({ description: e.target.value || null }); }} /></Field>
        <label className="flex items-center gap-2 text-sm text-fg-2">
          <input type="checkbox" className="size-4 accent-[var(--accent)]" disabled={!canEdit} checked={task.client_visible} onChange={(e) => set({ client_visible: e.target.checked })} />
          {task.client_visible ? <Eye className="size-4" /> : <EyeOff className="size-4" />}Mostrar esta etapa no portal do cliente
        </label>

        <section>
          <h3 className="mb-2 text-xs font-medium text-fg-2">Subtarefas</h3>
          <ul className="mb-2 grid gap-1">
            {subs.map((s) => (
              <li key={s.id} className="flex items-center gap-2 text-sm">
                <button aria-label="Alternar conclusão" onClick={() => update.mutate({ id: s.id, patch: { status: s.status === "done" ? "todo" : "done" } })} className={s.status === "done" ? "text-success" : "text-fg-3"}>
                  {s.status === "done" ? <CheckCircle2 className="size-4" /> : <Circle className="size-4" />}</button>
                <span className={cn(s.status === "done" && "text-fg-3 line-through")}>{s.title}</span>
              </li>
            ))}
          </ul>
          <form onSubmit={(e) => { e.preventDefault(); addSub(); }} className="flex gap-2"><Input aria-label="Nova subtarefa" placeholder="Nova subtarefa" value={sub} onChange={(e) => setSub(e.target.value)} /><Button type="submit" disabled={!sub.trim()}>Adicionar</Button></form>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-medium text-fg-2">Registrar horas</h3>
          <form onSubmit={(e) => { e.preventDefault(); logTime(); }} className="flex gap-2"><Input aria-label="Horas trabalhadas" inputMode="decimal" placeholder="Ex.: 1,5" value={minutes} onChange={(e) => setMinutes(e.target.value)} className="w-32" /><Button type="submit" icon={<Clock className="size-4" />} disabled={!minutes}>Registrar</Button></form>
        </section>

        <section>
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium text-fg-2"><MessageSquare className="size-3.5" />Comentários internos <span className="font-normal text-fg-3">(nunca aparecem para o cliente)</span></h3>
          <ul className="mb-3 grid gap-3">
            {comments.data?.map((c) => (
              <li key={c.id} className="flex gap-2.5"><Avatar name={c.profiles?.full_name} size={24} />
                <div className="min-w-0"><p className="text-xs"><span className="font-medium">{c.profiles?.full_name || "—"}</span> <span className="text-fg-3">{dateTime(c.created_at)}</span></p>
                  <p className="whitespace-pre-wrap text-sm text-fg-2">{c.body}</p></div></li>
            ))}
            {!comments.data?.length && <li className="text-xs text-fg-3">Nenhum comentário ainda.</li>}
          </ul>
          <div className="grid gap-2"><Textarea aria-label="Novo comentário" rows={2} placeholder="Escreva um comentário" value={comment} onChange={(e) => setComment(e.target.value)} />
            <div className="flex justify-end"><Button size="sm" variant="primary" onClick={addComment} disabled={!comment.trim()}>Comentar</Button></div></div>
        </section>
      </div>
      <ConfirmDialog open={confirmDel} onClose={() => setConfirmDel(false)} onConfirm={remove} title="Excluir tarefa?" description="A tarefa, suas subtarefas e comentários serão removidos. As horas registradas permanecem no projeto." />
    </Modal>
  );
}
