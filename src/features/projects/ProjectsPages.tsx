import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { CalendarClock, FolderKanban, KanbanSquare, List, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useBreadcrumbs } from "@/components/layout/AppShell";
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, Modal, PageHeader, Progress, Segmented, Select, Skeleton, Textarea, useToast, cn } from "@/components/ui";
import { useOrg } from "@/features/auth/AuthProvider";
import { clientName } from "@/features/clients/ClientsPages";
import {
  categoryLabel, errorMessage, priorityLabel, priorityTone, projectStatusLabel, projectStatusTone,
  type Project, type ProjectCategory, type ProjectStatus,
} from "@/lib/domain";
import { date, daysUntil, money, todayISO } from "@/lib/format";
import { supabase } from "@/lib/supabase";

type ProjectRow = Project & { tasks: { status: string }[] };
export function progressOf(tasks: { status: string }[] | undefined) {
  const t = tasks ?? [];
  return t.length ? Math.round((100 * t.filter((x) => x.status === "done").length) / t.length) : 0;
}

/* ------------------------------------------------------------ Criação */
const projectSchema = z.object({
  name: z.string().trim().min(2, "Dê um nome ao projeto.").max(200),
  client_id: z.string().uuid("Escolha o cliente."),
  category: z.string(),
  template_id: z.string().optional(),
  include_naming: z.boolean().optional(),
  start_date: z.string().optional(),
  due_date: z.string().optional(),
  contracted_amount: z.string().optional().refine((v) => !v || !Number.isNaN(Number(v.replace(/\./g, "").replace(",", "."))), "Valor inválido."),
  priority: z.enum(["low", "medium", "high", "urgent"]),
  description: z.string().optional(),
}).refine((v) => !v.start_date || !v.due_date || v.due_date >= v.start_date, { path: ["due_date"], message: "O prazo deve ser depois do início." });

export function ProjectFormModal({ open, onClose, defaultClientId }: { open: boolean; onClose: () => void; defaultClientId?: string }) {
  const { orgId, userId, can } = useOrg();
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const clients = useQuery({ queryKey: ["clients", orgId], enabled: open, queryFn: async () => (await supabase.from("clients").select("id, legal_name, trade_name, status").eq("organization_id", orgId).order("legal_name")).data ?? [] });
  const templates = useQuery({ queryKey: ["templates", orgId], enabled: open, queryFn: async () => (await supabase.from("project_templates").select("id, name, category").eq("organization_id", orgId).eq("is_archived", false).order("name")).data ?? [] });
  const { register, handleSubmit, watch, setValue, reset, formState: { errors, isSubmitting } } = useForm<z.infer<typeof projectSchema>>({
    resolver: zodResolver(projectSchema),
    defaultValues: { priority: "medium", category: "branding", client_id: defaultClientId ?? "", start_date: todayISO() },
  });
  const tpl = watch("template_id");
  const tplCat = templates.data?.find((t) => t.id === tpl)?.category;

  const onSubmit = handleSubmit(async (v) => {
    const amount = v.contracted_amount ? Number(v.contracted_amount.replace(/\./g, "").replace(",", ".")) : 0;
    const { data, error } = await supabase.from("projects").insert({
      organization_id: orgId, client_id: v.client_id, name: v.name, category: v.category as ProjectCategory,
      description: v.description || null, start_date: v.start_date || null, due_date: v.due_date || null,
      contracted_amount: can("finance.read") || can("projects.write") ? amount : 0, priority: v.priority, owner_id: userId, created_by: userId, status: "planning",
    }).select("id").single();
    if (error) { toast({ tone: "error", message: errorMessage(error) }); return; }
    await supabase.from("project_members").insert({ organization_id: orgId, project_id: data.id, user_id: userId, role: "lead" });
    if (v.template_id) {
      const r = await supabase.rpc("apply_project_template", { p_project: data.id, p_template: v.template_id, p_include_optional: v.include_naming ? ["naming"] : [] });
      if (r.error) toast({ tone: "error", message: `Projeto criado, mas o modelo não foi aplicado: ${errorMessage(r.error)}` });
    }
    qc.invalidateQueries({ queryKey: ["projects"] });
    toast({ tone: "success", message: "Projeto criado." });
    reset(); onClose();
    nav({ to: `/projetos/${data.id}` });
  });

  return (
    <Modal open={open} onClose={onClose} size="lg" title="Novo projeto" description="Escolha um modelo para gerar as etapas automaticamente."
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={isSubmitting} onClick={onSubmit}>Criar projeto</Button></>}>
      <form onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome do projeto" required htmlFor="name" error={errors.name?.message} className="sm:col-span-2"><Input id="name" aria-invalid={!!errors.name} {...register("name")} /></Field>
        <Field label="Cliente" required htmlFor="client_id" error={errors.client_id?.message}>
          <Select id="client_id" aria-invalid={!!errors.client_id} {...register("client_id")}>
            <option value="">Selecione…</option>
            {clients.data?.filter((c) => c.status !== "inactive").map((c) => <option key={c.id} value={c.id}>{clientName(c)}</option>)}
          </Select>
        </Field>
        <Field label="Modelo de projeto" htmlFor="template_id" hint="Opcional. Gera tarefas com prazos a partir do início.">
          <Select id="template_id" {...register("template_id", { onChange: (e) => { const t = templates.data?.find((x) => x.id === e.target.value); if (t) setValue("category", t.category); } })}>
            <option value="">Sem modelo</option>{templates.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        </Field>
        {tplCat === "branding" && (
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" className="size-4 accent-[var(--accent)]" {...register("include_naming")} />Incluir etapa de naming (contratada)</label>
        )}
        <Field label="Categoria" htmlFor="category">
          <Select id="category" {...register("category")}>{Object.entries(categoryLabel).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
        </Field>
        <Field label="Prioridade" htmlFor="priority">
          <Select id="priority" {...register("priority")}>{Object.entries(priorityLabel).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
        </Field>
        <Field label="Início" htmlFor="start_date"><Input id="start_date" type="date" {...register("start_date")} /></Field>
        <Field label="Prazo final" htmlFor="due_date" error={errors.due_date?.message} hint={tpl ? "Se vazio, usa a última etapa do modelo." : undefined}><Input id="due_date" type="date" {...register("due_date")} /></Field>
        <Field label="Orçamento contratado (R$)" htmlFor="contracted_amount" error={errors.contracted_amount?.message}><Input id="contracted_amount" inputMode="decimal" placeholder="0,00" {...register("contracted_amount")} /></Field>
        <Field label="Descrição" htmlFor="description" className="sm:col-span-2"><Textarea id="description" {...register("description")} /></Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

/* --------------------------------------------------------------- Lista */
const kanbanColumns: ProjectStatus[] = ["planning", "active", "review", "on_hold", "completed"];

export function ProjectsPage() {
  useBreadcrumbs([{ label: "Projetos" }]);
  const { orgId, can } = useOrg();
  const qc = useQueryClient();
  const toast = useToast();
  const [view, setView] = useState<"list" | "kanban">(() => (localStorage.getItem("nexo-projects-view") as "list" | "kanban") || "kanban");
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<ProjectCategory | "">("");
  const [creating, setCreating] = useState(false);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["projects", orgId],
    queryFn: async () => {
      const { data, error } = await supabase.from("projects").select("*, clients(legal_name, trade_name), tasks(status)")
        .eq("organization_id", orgId).is("tasks.parent_id", null).order("due_date", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return data as ProjectRow[];
    },
  });
  const move = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: ProjectStatus }) => {
      const { error } = await supabase.from("projects").update({ status, completed_at: status === "completed" ? new Date().toISOString() : null }).eq("id", id);
      if (error) throw error;
    },
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: ["projects", orgId] });
      const prev = qc.getQueryData<ProjectRow[]>(["projects", orgId]);
      qc.setQueryData<ProjectRow[]>(["projects", orgId], (old) => old?.map((p) => (p.id === id ? { ...p, status } : p)));
      return { prev };
    },
    onError: (e, _v, ctx) => { qc.setQueryData(["projects", orgId], ctx?.prev); toast({ tone: "error", message: errorMessage(e) }); },
    onSettled: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });

  const list = useMemo(() => (data ?? []).filter((p) => (!cat || p.category === cat) && (!q || `${p.name} ${clientName(p.clients)}`.toLowerCase().includes(q.toLowerCase()))), [data, q, cat]);
  const setV = (v: "list" | "kanban") => { setView(v); try { localStorage.setItem("nexo-projects-view", v); } catch { /* */ } };

  return (
    <>
      <PageHeader title="Projetos" description="Tudo o que está em produção no estúdio."
        actions={<>
          <Segmented value={view} onChange={setV} items={[{ value: "kanban", label: "Kanban", icon: <KanbanSquare className="size-3.5" /> }, { value: "list", label: "Lista", icon: <List className="size-3.5" /> }]} />
          {can("projects.write") && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>Novo projeto</Button>}
        </>} />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-fg-3" />
          <Input aria-label="Buscar projetos" placeholder="Buscar projeto ou cliente" value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" />
        </div>
        <Select aria-label="Categoria" value={cat} onChange={(e) => setCat(e.target.value as ProjectCategory | "")} className="sm:w-52">
          <option value="">Todas as categorias</option>{Object.entries(categoryLabel).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </Select>
      </div>

      {error ? <ErrorState error={error} onRetry={refetch} /> : isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-40" />)}</div>
      ) : !data?.length ? (
        <EmptyState icon={<FolderKanban className="size-5" />} title="Nenhum projeto ainda"
          description={can("projects.write") ? "Crie um projeto a partir de um modelo para gerar as etapas automaticamente." : "Quando você for adicionado a um projeto, ele aparece aqui."}
          action={can("projects.write") ? <Button variant="primary" onClick={() => setCreating(true)}>Criar projeto</Button> : undefined} />
      ) : view === "kanban" ? (
        <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-3 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 scrollbar-thin">
          {kanbanColumns.map((col) => {
            const items = list.filter((p) => p.status === col);
            return (
              <div key={col} className="flex w-72 shrink-0 flex-col rounded-lg bg-surface-2/70 p-2"
                onDragOver={(e) => { if (can("projects.write")) e.preventDefault(); }}
                onDrop={(e) => { const id = e.dataTransfer.getData("text/project"); if (id) move.mutate({ id, status: col }); }}>
                <div className="flex items-center justify-between px-1.5 pb-2 pt-1">
                  <Badge tone={projectStatusTone[col]} dot>{projectStatusLabel[col]}</Badge><span className="text-xs text-fg-3 tabular">{items.length}</span>
                </div>
                <div className="grid gap-2">
                  {items.map((p) => <ProjectCard key={p.id} p={p} draggable={can("projects.write")} />)}
                  {items.length === 0 && <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-fg-3">Arraste projetos para cá</p>}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <Card padded={false} className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-left text-xs text-fg-3"><tr>
                <th className="px-4 py-2.5 font-medium">Projeto</th><th className="hidden px-4 py-2.5 font-medium md:table-cell">Categoria</th>
                <th className="px-4 py-2.5 font-medium">Status</th><th className="hidden px-4 py-2.5 font-medium sm:table-cell">Progresso</th>
                <th className="px-4 py-2.5 font-medium">Prazo</th>{can("finance.read") && <th className="hidden px-4 py-2.5 text-right font-medium lg:table-cell">Contratado</th>}
              </tr></thead>
              <tbody>
                {list.map((p) => (
                  <tr key={p.id} className="border-t border-border hover:bg-surface-2/60">
                    <td className="px-4 py-3"><Link to={`/projetos/${p.id}`} className="font-medium hover:text-accent">{p.name}</Link><p className="text-xs text-fg-3">{clientName(p.clients)}</p></td>
                    <td className="hidden px-4 py-3 text-fg-2 md:table-cell">{categoryLabel[p.category]}</td>
                    <td className="px-4 py-3"><Badge tone={projectStatusTone[p.status]} dot>{projectStatusLabel[p.status]}</Badge></td>
                    <td className="hidden w-40 px-4 py-3 sm:table-cell"><div className="flex items-center gap-2"><Progress value={progressOf(p.tasks)} /><span className="w-8 text-xs text-fg-3 tabular">{progressOf(p.tasks)}%</span></div></td>
                    <td className="px-4 py-3"><DueLabel due={p.due_date} done={p.status === "completed"} /></td>
                    {can("finance.read") && <td className="hidden px-4 py-3 text-right tabular lg:table-cell">{money(p.contracted_amount)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <ProjectFormModal open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

export function DueLabel({ due, done }: { due: string | null; done?: boolean }) {
  const d = daysUntil(due);
  if (!due) return <span className="text-xs text-fg-3">Sem prazo</span>;
  const late = !done && d !== null && d < 0;
  const soon = !done && d !== null && d >= 0 && d <= 3;
  return <span className={cn("inline-flex items-center gap-1 text-xs tabular", late ? "font-medium text-danger" : soon ? "text-warning" : "text-fg-2")}>
    <CalendarClock className="size-3.5" />{date(due)}{late && " · atrasado"}</span>;
}

function ProjectCard({ p, draggable }: { p: ProjectRow; draggable: boolean }) {
  const prog = progressOf(p.tasks);
  return (
    <Link to={`/projetos/${p.id}`} draggable={draggable}
      onDragStart={(e) => { e.dataTransfer.setData("text/project", p.id); e.dataTransfer.effectAllowed = "move"; }}
      className="group block rounded-md border border-border bg-surface p-3 shadow-sm transition-[border-color,box-shadow,transform] hover:-translate-y-px hover:border-border-strong hover:shadow-md">
      <div className="mb-2 flex items-start justify-between gap-2">
        <p className="text-sm font-medium leading-snug group-hover:text-accent">{p.name}</p>
        {(p.priority === "high" || p.priority === "urgent") && <Badge tone={priorityTone[p.priority]}>{priorityLabel[p.priority]}</Badge>}
      </div>
      <p className="mb-3 truncate text-xs text-fg-3">{clientName(p.clients)} · {categoryLabel[p.category]}</p>
      <div className="flex items-center gap-2"><Progress value={prog} /><span className="text-[11px] text-fg-3 tabular">{prog}%</span></div>
      <div className="mt-2.5"><DueLabel due={p.due_date} done={p.status === "completed"} /></div>
    </Link>
  );
}
