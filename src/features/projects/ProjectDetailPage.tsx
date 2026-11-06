import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Download, FileUp, Link2, Pencil, Trash2, UserMinus, UserPlus } from "lucide-react";
import { useRef, useState } from "react";
import { useBreadcrumbs } from "@/components/layout/AppShell";
import { Avatar, Badge, Button, Card, CardHeader, ConfirmDialog, EmptyState, ErrorState, Field, Input, Modal, PageHeader, Progress, Select, Spinner, Tabs, Textarea, useToast } from "@/components/ui";
import { useOrg } from "@/features/auth/AuthProvider";
import { MoodboardsPanel } from "@/features/creative/Moodboards";
import { NamingPanel } from "@/features/creative/NamingPanel";
import { ProductionsPanel } from "@/features/creative/ProductionsPanel";
import { ClientRequestsPanel, useOpenClientRequests } from "./ClientRequestsPanel";
import { clientName } from "@/features/clients/ClientsPages";
import { fetchProfiles, ProjectTasks, type Member } from "@/features/tasks/TaskViews";
import { categoryLabel, errorMessage, priorityLabel, projectStatusLabel, projectStatusTone, type Priority, type Project, type ProjectStatus } from "@/lib/domain";
import { date, dateTime, hours, money } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { DueLabel, progressOf } from "./ProjectsPages";
import { PortalSharing } from "./PortalSharing";

type Tab = "naming" | "moodboards" | "productions" | "requests" | "tasks" | "overview" | "team" | "files" | "comments" | "time" | "portal" | "history";

export function ProjectDetailPage({ projectId }: { projectId: string }) {
  const { orgId, userId, can } = useOrg();
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const [tab, setTab] = useState<Tab>(() => (new URLSearchParams(window.location.search).get("aba") as Tab) || "tasks");
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const { data: project, isLoading, error } = useQuery({
    queryKey: ["project", projectId],
    queryFn: async () => {
      const { data, error } = await supabase.from("projects").select("*, clients(legal_name, trade_name), tasks(status, parent_id)").eq("id", projectId).single();
      if (error) throw error;
      return data as Project & { tasks: { status: string; parent_id: string | null }[] };
    },
  });
  const members = useQuery({
    queryKey: ["project-members", projectId],
    queryFn: async () => {
      const rows = (await supabase.from("project_members").select("user_id, role").eq("project_id", projectId)).data ?? [];
      const names = await fetchProfiles(rows.map((r) => r.user_id));
      return rows.map((r) => ({ ...r, profiles: names[r.user_id] ?? null })) as (Member & { role: string })[];
    },
  });
  const openReqs = useOpenClientRequests(projectId);
  const canEdit = !!project && (can("projects.write") || project.owner_id === userId || members.data?.some((m) => m.user_id === userId && m.role === "lead"));

  const patch = useMutation({
    mutationFn: async (p: Partial<Project> & { completed_at?: string | null }) => { const { error } = await supabase.from("projects").update(p).eq("id", projectId); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["project", projectId] }); qc.invalidateQueries({ queryKey: ["projects"] }); },
    onError: (e) => toast({ tone: "error", message: errorMessage(e) }),
  });

  useBreadcrumbs([{ label: "Projetos", to: "/projetos" }, { label: project?.name ?? "…" }]);
  if (isLoading) return <Spinner />;
  if (error || !project) return <ErrorState error={error ?? "Projeto não encontrado ou sem acesso."} />;
  const prog = progressOf(project.tasks.filter((t) => !t.parent_id));

  return (
    <>
      <PageHeader title={project.name}
        description={<Link to={`/clientes/${project.client_id}`} className="hover:text-accent">{clientName(project.clients)}</Link>}
        meta={<>
          <Badge tone={projectStatusTone[project.status]} dot>{projectStatusLabel[project.status]}</Badge>
          <Badge>{categoryLabel[project.category]}</Badge>
          <DueLabel due={project.due_date} done={project.status === "completed"} />
        </>}
        actions={canEdit && <>
          <Select aria-label="Status do projeto" value={project.status} className="w-40"
            onChange={(e) => { const s = e.target.value as ProjectStatus; patch.mutate({ status: s, completed_at: s === "completed" ? new Date().toISOString() : null }); }}>
            {Object.entries(projectStatusLabel).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
          <Button icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>Editar</Button>
          {can("projects.write") && <Button variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => setDeleting(true)} aria-label="Excluir projeto" />}
        </>} />

      <div className="mb-5 grid gap-3 sm:grid-cols-4">
        <Card className="sm:col-span-2"><p className="mb-2 text-xs text-fg-3">Progresso</p><div className="flex items-center gap-3"><Progress value={prog} /><span className="text-sm font-medium tabular">{prog}%</span></div></Card>
        <Card><p className="text-xs text-fg-3">Período</p><p className="mt-1 text-sm tabular">{date(project.start_date)} → {date(project.due_date)}</p></Card>
        <Card><p className="text-xs text-fg-3">Prioridade</p><p className="mt-1 text-sm">{priorityLabel[project.priority]}</p></Card>
      </div>

      <Tabs value={tab} onChange={setTab} items={[
        { value: "tasks", label: "Tarefas", count: project.tasks.filter((t) => !t.parent_id).length },
        { value: "requests" as const, label: "Pedidos ao cliente", count: openReqs.data || undefined },
        ...(["branding", "naming"].includes(project.category) ? [{ value: "naming" as const, label: "Naming e pesquisa" }] : []),
        { value: "moodboards" as const, label: "Moodboards" },
        ...(["photography", "audiovisual", "campaign", "institutional", "social_media"].includes(project.category) ? [{ value: "productions" as const, label: "Produções" }] : []),
        { value: "overview", label: "Visão geral" }, { value: "team", label: "Equipe", count: members.data?.length },
        { value: "files", label: "Arquivos" }, { value: "comments", label: "Comentários" }, { value: "time", label: "Horas" },
        ...(can("portal.share") ? [{ value: "portal" as const, label: "Portal do cliente" }] : []), { value: "history", label: "Histórico" },
      ]} />
      <div className="pt-4">
        {tab === "tasks" && <ProjectTasks projectId={projectId} members={members.data ?? []} canEdit={!!canEdit} />}
        {tab === "requests" && <ClientRequestsPanel projectId={projectId} orgId={orgId} clientId={project.client_id} category={project.category} canEdit={!!canEdit} />}
        {tab === "naming" && <NamingPanel projectId={projectId} orgId={orgId} canEdit={!!canEdit && can("creative.write")} />}
        {tab === "moodboards" && <MoodboardsPanel projectId={projectId} orgId={orgId} canEdit={!!canEdit && can("creative.write")} />}
        {tab === "productions" && <ProductionsPanel projectId={projectId} orgId={orgId} canEdit={!!canEdit} members={(members.data ?? []).map((m) => ({ user_id: m.user_id, full_name: m.profiles?.full_name }))} />}
        {tab === "overview" && <Overview project={project} />}
        {tab === "team" && <Team projectId={projectId} orgId={orgId} members={members.data ?? []} canEdit={!!canEdit} ownerId={project.owner_id} onChange={() => members.refetch()} />}
        {tab === "files" && <Files projectId={projectId} orgId={orgId} />}
        {tab === "comments" && <Comments projectId={projectId} orgId={orgId} />}
        {tab === "time" && <TimeLog projectId={projectId} />}
        {tab === "portal" && <PortalSharing projectId={projectId} clientId={project.client_id} />}
        {tab === "history" && <History projectId={projectId} />}
      </div>

      {editing && <EditProjectModal project={project} onClose={() => setEditing(false)} onSave={(p) => patch.mutateAsync(p).then(() => { setEditing(false); toast({ tone: "success", message: "Projeto atualizado." }); })} showMoney={can("finance.read") || can("projects.write")} />}
      <ConfirmDialog open={deleting} onClose={() => setDeleting(false)} title="Excluir projeto?"
        description="Tarefas, comentários, arquivos e horas do projeto serão removidos. Projetos com lançamentos financeiros não podem ser excluídos; nesse caso, cancele o projeto."
        onConfirm={async () => {
          const { error } = await supabase.from("projects").delete().eq("id", projectId);
          if (error) { setDeleting(false); return toast({ tone: "error", message: /violates|foreign/i.test(error.message) ? "Há lançamentos financeiros vinculados. Altere o status para Cancelado." : errorMessage(error) }); }
          qc.invalidateQueries({ queryKey: ["projects"] }); toast({ tone: "success", message: "Projeto excluído." }); nav({ to: "/projetos" });
        }} />
    </>
  );
}

function Overview({ project }: { project: Project }) {
  const { can } = useOrg();
  const blocks = [["Descrição", project.description], ["Objetivos", project.objectives], ["Escopo", project.scope]] as const;
  const profit = useQuery({
    queryKey: ["profitability", project.id], enabled: can("finance.read"),
    queryFn: async () => (await supabase.from("project_profitability").select("*").eq("project_id", project.id).maybeSingle()).data,
  });
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div className="grid gap-4">{blocks.map(([t, v]) => (
        <Card key={t}><CardHeader title={t} />{v ? <p className="whitespace-pre-wrap text-sm text-fg-2">{v}</p> : <p className="text-sm text-fg-3">Não informado.</p>}</Card>
      ))}</div>
      {can("finance.read") && (
        <Card>
          <CardHeader title="Rentabilidade" description="Contratado − custos internos (horas) − terceirizados − adicionais." />
          {profit.isLoading ? <Spinner /> : profit.data ? (
            <dl className="grid gap-2 text-sm">
              {[["Valor contratado", money(profit.data.contracted_amount)], ["Faturado", money(profit.data.billed_amount)], ["Recebido", money(profit.data.received_amount)],
                ["Horas trabalhadas", hours(profit.data.minutes_worked)], ["Custos internos", money(profit.data.internal_cost)], ["Terceirizados", money(profit.data.outsourced_cost)],
                ["Despesas adicionais", money(profit.data.additional_cost)]].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3"><dt className="text-fg-3">{k}</dt><dd className="tabular">{v}</dd></div>))}
              <div className="mt-1 flex justify-between gap-3 border-t border-border pt-2 font-medium"><dt>Resultado previsto</dt>
                <dd className={Number(profit.data.projected_result) < 0 ? "text-danger tabular" : "tabular"}>{money(profit.data.projected_result)}{profit.data.margin_pct != null && ` · ${profit.data.margin_pct}%`}</dd></div>
            </dl>
          ) : <p className="text-sm text-fg-3">Sem dados.</p>}
        </Card>
      )}
    </div>
  );
}

function EditProjectModal({ project, onClose, onSave, showMoney }: { project: Project; onClose: () => void; onSave: (p: Partial<Project>) => Promise<void>; showMoney: boolean }) {
  const [f, setF] = useState({ name: project.name, description: project.description ?? "", objectives: project.objectives ?? "", scope: project.scope ?? "",
    start_date: project.start_date ?? "", due_date: project.due_date ?? "", priority: project.priority, contracted_amount: String(project.contracted_amount ?? 0) });
  const [saving, setSaving] = useState(false);
  const invalid = f.name.trim().length < 2 || (!!f.start_date && !!f.due_date && f.due_date < f.start_date);
  const save = async () => {
    setSaving(true);
    try {
      await onSave({ name: f.name.trim(), description: f.description || null, objectives: f.objectives || null, scope: f.scope || null,
        start_date: f.start_date || null, due_date: f.due_date || null, priority: f.priority as Priority,
        ...(showMoney ? { contracted_amount: Number(f.contracted_amount.replace(",", ".")) || 0 } : {}) });
    } finally { setSaving(false); }
  };
  const bind = (k: keyof typeof f) => ({ value: f[k], onChange: (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value })) });
  return (
    <Modal open onClose={onClose} size="lg" title="Editar projeto"
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={saving} disabled={invalid} onClick={save}>Salvar</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome" required htmlFor="p-name" className="sm:col-span-2" error={f.name.trim().length < 2 ? "Informe o nome." : undefined}><Input id="p-name" {...bind("name")} /></Field>
        <Field label="Início" htmlFor="p-start"><Input id="p-start" type="date" {...bind("start_date")} /></Field>
        <Field label="Prazo final" htmlFor="p-due" error={f.start_date && f.due_date && f.due_date < f.start_date ? "O prazo deve ser depois do início." : undefined}><Input id="p-due" type="date" {...bind("due_date")} /></Field>
        <Field label="Prioridade" htmlFor="p-pri"><Select id="p-pri" {...bind("priority")}>{Object.entries(priorityLabel).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        {showMoney && <Field label="Orçamento contratado (R$)" htmlFor="p-amount"><Input id="p-amount" inputMode="decimal" {...bind("contracted_amount")} /></Field>}
        <Field label="Descrição" htmlFor="p-desc" className="sm:col-span-2"><Textarea id="p-desc" {...bind("description")} /></Field>
        <Field label="Objetivos" htmlFor="p-obj" className="sm:col-span-2"><Textarea id="p-obj" {...bind("objectives")} /></Field>
        <Field label="Escopo" htmlFor="p-scope" className="sm:col-span-2"><Textarea id="p-scope" rows={4} {...bind("scope")} /></Field>
      </div>
    </Modal>
  );
}

function Team({ projectId, orgId, members, canEdit, ownerId, onChange }: { projectId: string; orgId: string; members: (Member & { role: string })[]; canEdit: boolean; ownerId: string | null; onChange: () => void }) {
  const toast = useToast();
  const [adding, setAdding] = useState("");
  const org = useQuery({
    queryKey: ["org-members", orgId], enabled: canEdit,
    queryFn: async () => {
      const rows = (await supabase.from("organization_members").select("user_id, job_title").eq("organization_id", orgId).eq("status", "active")).data ?? [];
      const names = await fetchProfiles(rows.map((r) => r.user_id));
      return rows.map((r) => ({ ...r, full_name: names[r.user_id]?.full_name || "Sem nome" }));
    },
  });
  const available = (org.data ?? []).filter((o) => !members.some((m) => m.user_id === o.user_id));
  const add = async () => {
    if (!adding) return;
    const { error } = await supabase.from("project_members").insert({ organization_id: orgId, project_id: projectId, user_id: adding });
    if (error) return toast({ tone: "error", message: errorMessage(error) });
    setAdding(""); onChange();
  };
  const remove = async (uid: string) => {
    const { error } = await supabase.from("project_members").delete().eq("project_id", projectId).eq("user_id", uid);
    if (error) return toast({ tone: "error", message: errorMessage(error) });
    onChange();
  };
  return (
    <div className="grid max-w-2xl gap-3">
      {canEdit && (
        <div className="flex gap-2">
          <Select aria-label="Adicionar pessoa" value={adding} onChange={(e) => setAdding(e.target.value)}>
            <option value="">Adicionar pessoa ao projeto…</option>{available.map((o) => <option key={o.user_id} value={o.user_id}>{o.full_name}{o.job_title ? ` · ${o.job_title}` : ""}</option>)}
          </Select>
          <Button icon={<UserPlus className="size-4" />} disabled={!adding} onClick={add}>Adicionar</Button>
        </div>
      )}
      <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
        {members.map((m) => (
          <li key={m.user_id} className="flex items-center gap-3 px-3 py-2.5">
            <Avatar name={m.profiles?.full_name} size={28} />
            <span className="flex-1 text-sm">{m.profiles?.full_name || "Sem nome"}</span>
            {(m.role === "lead" || m.user_id === ownerId) && <Badge tone="accent">Responsável</Badge>}
            {canEdit && m.user_id !== ownerId && <Button size="sm" variant="ghost" icon={<UserMinus className="size-3.5" />} onClick={() => remove(m.user_id)}>Remover</Button>}
          </li>
        ))}
        {members.length === 0 && <li className="px-3 py-6 text-center text-sm text-fg-3">Ninguém na equipe deste projeto.</li>}
      </ul>
    </div>
  );
}

function Files({ projectId, orgId }: { projectId: string; orgId: string }) {
  const { userId } = useOrg();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState({ name: "", url: "" });
  const { data, refetch, isLoading } = useQuery({
    queryKey: ["files", projectId],
    queryFn: async () => (await supabase.from("files").select("*").eq("project_id", projectId).order("created_at", { ascending: false })).data ?? [],
  });
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    for (const f of Array.from(files)) {
      if (f.size > 500 * 1024 * 1024) { toast({ tone: "error", message: `${f.name}: limite de 500 MB.` }); continue; }
      const path = `${orgId}/${crypto.randomUUID()}/${f.name.replace(/[^\w.\- ]+/g, "_")}`;
      const up = await supabase.storage.from("org-files").upload(path, f, { contentType: f.type || undefined, upsert: false });
      if (up.error) { toast({ tone: "error", message: `${f.name}: ${errorMessage(up.error)}` }); continue; }
      const { error } = await supabase.from("files").insert({ organization_id: orgId, project_id: projectId, storage_path: path, name: f.name, mime_type: f.type || null, size_bytes: f.size, uploaded_by: userId });
      if (error) { await supabase.storage.from("org-files").remove([path]); toast({ tone: "error", message: errorMessage(error) }); }
    }
    setBusy(false); refetch();
  };
  const open = async (path: string) => {
    const { data, error } = await supabase.storage.from("org-files").createSignedUrl(path, 300);
    if (error || !data) return toast({ tone: "error", message: errorMessage(error) });
    window.open(data.signedUrl, "_blank", "noopener");
  };
  const toggleClient = async (id: string, v: boolean) => { await supabase.from("files").update({ client_visible: v }).eq("id", id); refetch(); };
  const saveLink = async () => {
    const url = link.url.trim();
    if (!/^https?:\/\//.test(url)) return toast({ tone: "error", message: "Informe um link começando com http(s)://" });
    const { error } = await supabase.from("files").insert({ organization_id: orgId, project_id: projectId, kind: "link", external_url: url, name: link.name.trim() || url,
      storage_path: `${orgId}/links/${crypto.randomUUID()}`, uploaded_by: userId });
    if (error) return toast({ tone: "error", message: errorMessage(error) });
    setLinkOpen(false); setLink({ name: "", url: "" }); refetch();
  };
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        <input ref={input} type="file" multiple hidden onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
        <Button variant="primary" icon={<FileUp className="size-4" />} loading={busy} onClick={() => input.current?.click()}>Enviar arquivos</Button>
        <Button icon={<Link2 className="size-4" />} onClick={() => setLinkOpen(true)}>Adicionar link de referência</Button>
      </div>
      {isLoading ? <Spinner /> : !data?.length ? <EmptyState title="Nenhum arquivo" description="Os arquivos ficam num armazenamento privado; o acesso é por link temporário." /> : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {data.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1"><p className="truncate text-sm">{f.name}</p>
                <p className="text-xs text-fg-3">{f.kind === "link" ? "Link externo" : `${(Number(f.size_bytes) / 1024 / 1024).toFixed(1)} MB`} · {dateTime(f.created_at)}</p></div>
              <label className="flex items-center gap-1.5 text-xs text-fg-2"><input type="checkbox" className="accent-[var(--accent)]" checked={f.client_visible} onChange={(e) => toggleClient(f.id, e.target.checked)} />Visível ao cliente</label>
              {f.kind === "link"
                ? <a href={f.external_url} target="_blank" rel="noreferrer noopener"><Button size="sm" icon={<Link2 className="size-3.5" />}>Abrir</Button></a>
                : <Button size="sm" icon={<Download className="size-3.5" />} onClick={() => open(f.storage_path)}>Baixar</Button>}
            </li>
          ))}
        </ul>
      )}
      <Modal open={linkOpen} onClose={() => setLinkOpen(false)} title="Link de referência" size="sm"
        footer={<><Button variant="ghost" onClick={() => setLinkOpen(false)}>Cancelar</Button><Button variant="primary" onClick={saveLink}>Salvar</Button></>}>
        <div className="grid gap-3">
          <Field label="Nome" htmlFor="l-name"><Input id="l-name" value={link.name} onChange={(e) => setLink((s) => ({ ...s, name: e.target.value }))} /></Field>
          <Field label="URL" htmlFor="l-url" required><Input id="l-url" type="url" placeholder="https://" value={link.url} onChange={(e) => setLink((s) => ({ ...s, url: e.target.value }))} /></Field>
        </div>
      </Modal>
    </div>
  );
}

function Comments({ projectId, orgId }: { projectId: string; orgId: string }) {
  const { userId } = useOrg();
  const toast = useToast();
  const [body, setBody] = useState("");
  const [shared, setShared] = useState(false);
  const { data, refetch } = useQuery({
    queryKey: ["project-comments", projectId],
    queryFn: async () => {
      const rows = (await supabase.from("project_comments").select("*").eq("project_id", projectId).order("created_at")).data ?? [];
      const names = await fetchProfiles(rows.map((r) => r.author_id));
      return rows.map((r) => ({ ...r, name: names[r.author_id]?.full_name ?? "Cliente" }));
    },
  });
  const send = async () => {
    const b = body.trim(); if (!b) return;
    const { error } = await supabase.from("project_comments").insert({ organization_id: orgId, project_id: projectId, author_id: userId, body: b, is_internal: !shared });
    if (error) return toast({ tone: "error", message: errorMessage(error) });
    setBody(""); setShared(false); refetch();
  };
  return (
    <div className="grid max-w-3xl gap-4">
      <ul className="grid gap-4">
        {data?.map((c) => (
          <li key={c.id} className="flex gap-3"><Avatar name={c.name} size={28} />
            <div className="min-w-0 flex-1"><p className="text-xs"><span className="font-medium">{c.name}</span> <span className="text-fg-3">{dateTime(c.created_at)}</span> {c.is_internal ? <Badge>Interno</Badge> : <Badge tone="info">Visível ao cliente</Badge>}</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-fg-2">{c.body}</p></div></li>
        ))}
        {!data?.length && <li className="text-sm text-fg-3">Nenhum comentário.</li>}
      </ul>
      <Card>
        <Textarea aria-label="Comentário" rows={3} placeholder="Escreva um comentário" value={body} onChange={(e) => setBody(e.target.value)} />
        <div className="mt-2 flex items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-xs text-fg-2"><input type="checkbox" className="accent-[var(--accent)]" checked={shared} onChange={(e) => setShared(e.target.checked)} />Mostrar no portal do cliente</label>
          <Button variant="primary" size="sm" onClick={send} disabled={!body.trim()}>Comentar</Button>
        </div>
      </Card>
    </div>
  );
}

function TimeLog({ projectId }: { projectId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["project-time", projectId],
    queryFn: async () => {
      const rows = (await supabase.from("time_entries").select("id, user_id, minutes, work_date, note, task_id").eq("project_id", projectId).order("work_date", { ascending: false })).data ?? [];
      const names = await fetchProfiles(rows.map((r) => r.user_id));
      return rows.map((r) => ({ ...r, name: names[r.user_id]?.full_name || "—" }));
    },
  });
  if (isLoading) return <Spinner />;
  const total = (data ?? []).reduce((s, r) => s + r.minutes, 0);
  return (
    <div className="grid max-w-3xl gap-3">
      <p className="text-sm text-fg-2">Total registrado: <strong className="tabular">{hours(total)}</strong> <span className="text-xs text-fg-3">(você vê as suas horas; gestores e financeiro veem as de todos)</span></p>
      {!data?.length ? <EmptyState title="Nenhuma hora registrada" description="Registre horas pelo detalhe de cada tarefa." /> : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {data.map((r) => <li key={r.id} className="flex items-center gap-3 px-3 py-2 text-sm"><span className="w-24 text-fg-3 tabular">{date(r.work_date)}</span><span className="flex-1">{r.name}</span><span className="tabular">{hours(r.minutes)}</span></li>)}
        </ul>
      )}
    </div>
  );
}

function History({ projectId }: { projectId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["project-history", projectId],
    queryFn: async () => (await supabase.from("activity_logs").select("*").eq("entity_id", projectId).order("created_at", { ascending: false }).limit(100)).data ?? [],
  });
  const labels: Record<string, string> = { status: "status", due_date: "prazo", start_date: "início", name: "nome", contracted_amount: "valor contratado", priority: "prioridade", description: "descrição", scope: "escopo" };
  if (isLoading) return <Spinner />;
  return (
    <ol className="relative ml-2 max-w-3xl border-l border-border">
      {(data ?? []).map((h) => (
        <li key={h.id} className="mb-4 ml-4"><span className="absolute -left-1 mt-1.5 size-2 rounded-full bg-border-strong" />
          <p className="text-sm">{h.action === "insert" ? "Projeto criado" : h.action === "update" ? `Alterado: ${Object.keys(h.changes).map((k) => labels[k] ?? k).join(", ")}` : h.action}</p>
          {h.changes?.status && <p className="text-xs text-fg-3">{projectStatusLabel[h.changes.status.from as ProjectStatus]} → {projectStatusLabel[h.changes.status.to as ProjectStatus]}</p>}
          <p className="text-xs text-fg-3">{dateTime(h.created_at)}</p></li>
      ))}
      {!data?.length && <li className="ml-4 text-sm text-fg-3">Sem registros visíveis para você.</li>}
    </ol>
  );
}
