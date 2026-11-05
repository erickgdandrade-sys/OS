import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CheckCircle2, Circle, Download, LogOut, MessageSquareWarning, ThumbsUp } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, Field, Input, Progress, Spinner, Textarea, useToast } from "@/components/ui";
import { useAuth } from "@/features/auth/AuthProvider";
import { categoryLabel, errorMessage, projectStatusLabel, projectStatusTone, taskStatusLabel, type ProjectCategory, type ProjectStatus, type TaskStatus } from "@/lib/domain";
import { date, dateTime } from "@/lib/format";
import { supabase } from "@/lib/supabase";

/* Portal externo: layout próprio, sem nada do painel interno.
   Dados vêm só das views portal_* (RLS + colunas seguras) ou da Edge Function `portal`. */
function PortalLayout({ studio, children, onSignOut }: { studio?: string; children: ReactNode; onSignOut?: () => void }) {
  return (
    <div className="min-h-dvh bg-bg">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
          <p className="text-sm font-semibold">{studio ?? "Portal do cliente"} <span className="font-normal text-fg-3">· Portal do cliente</span></p>
          {onSignOut && <Button size="sm" variant="ghost" icon={<LogOut className="size-3.5" />} onClick={onSignOut}>Sair</Button>}
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}

type PortalApproval = { id: string; title: string; description: string | null; status: string; version: number; due_date: string | null; created_at: string };

function ApprovalCard({ a, onDecide }: { a: PortalApproval; onDecide?: (decision: "approved" | "changes_requested", comment: string) => Promise<void> }) {
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const pending = a.status === "pending";
  const go = async (d: "approved" | "changes_requested") => {
    if (d === "changes_requested" && !comment.trim()) return;
    setBusy(d); try { await onDecide?.(d, comment.trim()); setComment(""); } finally { setBusy(null); }
  };
  return (
    <li className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div><p className="text-sm font-medium">{a.title} <span className="text-xs font-normal text-fg-3">v{a.version}</span></p>
          {a.description && <p className="mt-1 text-sm text-fg-2">{a.description}</p>}
          <p className="mt-1 text-xs text-fg-3">Enviado em {dateTime(a.created_at)}{a.due_date && ` · responder até ${date(a.due_date)}`}</p></div>
        <Badge tone={a.status === "approved" ? "success" : a.status === "changes_requested" ? "warning" : "info"}>
          {a.status === "approved" ? "Aprovado" : a.status === "changes_requested" ? "Alteração solicitada" : "Aguardando você"}</Badge>
      </div>
      {pending && onDecide && (
        <div className="mt-3 grid gap-2 border-t border-border pt-3">
          <Textarea aria-label="Comentário" rows={2} placeholder="Comentário (obrigatório para pedir alteração)" value={comment} onChange={(e) => setComment(e.target.value)} />
          <div className="flex flex-wrap justify-end gap-2">
            <Button icon={<MessageSquareWarning className="size-4" />} loading={busy === "changes_requested"} disabled={!comment.trim()} onClick={() => go("changes_requested")}>Solicitar alteração</Button>
            <Button variant="primary" icon={<ThumbsUp className="size-4" />} loading={busy === "approved"} onClick={() => go("approved")}>Aprovar</Button>
          </div>
        </div>
      )}
    </li>
  );
}

function Steps({ tasks }: { tasks: { id: string; title: string; status: string; due_date: string | null }[] }) {
  if (!tasks.length) return <p className="text-sm text-fg-3">O estúdio ainda não compartilhou etapas.</p>;
  return (
    <ol className="grid gap-2">{tasks.map((t) => (
      <li key={t.id} className="flex items-center gap-3 text-sm">
        {t.status === "done" ? <CheckCircle2 className="size-4 text-success" /> : <Circle className="size-4 text-fg-3" />}
        <span className={t.status === "done" ? "text-fg-3" : ""}>{t.title}</span>
        <span className="ml-auto text-xs text-fg-3">{t.status === "done" ? "Concluída" : taskStatusLabel[t.status as TaskStatus]}{t.due_date && ` · ${date(t.due_date)}`}</span>
      </li>))}</ol>
  );
}

/* ---------------------------------------------- Cliente autenticado */
export function PortalHome() {
  const { context, signOut, session } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [selected, setSelected] = useState<string | null>(null);
  const account = context?.client_accounts[0];
  const projects = useQuery({
    queryKey: ["portal-projects"],
    queryFn: async () => { const { data, error } = await supabase.from("portal_projects").select("*").order("due_date"); if (error) throw error; return data as { id: string; name: string; category: ProjectCategory; status: ProjectStatus; start_date: string | null; due_date: string | null; progress: number | null; description: string | null }[]; },
  });
  const pid = selected ?? projects.data?.[0]?.id;
  const detail = useQuery({
    queryKey: ["portal-detail", pid], enabled: !!pid,
    queryFn: async () => {
      const [tasks, files, approvals] = await Promise.all([
        supabase.from("portal_tasks").select("*").eq("project_id", pid!).order("position"),
        supabase.from("portal_files").select("*").eq("project_id", pid!).order("created_at", { ascending: false }),
        supabase.from("approvals").select("id, title, description, status, version, due_date, created_at").eq("project_id", pid!).neq("status", "cancelled").order("created_at", { ascending: false }),
      ]);
      return { tasks: tasks.data ?? [], files: files.data ?? [], approvals: (approvals.data ?? []) as PortalApproval[] };
    },
  });
  const decide = async (approvalId: string, decision: "approved" | "changes_requested", comment: string) => {
    const a = detail.data?.approvals.find((x) => x.id === approvalId);
    const org = context?.client_accounts[0]?.organization_id;
    const { error } = await supabase.from("approval_events").insert({ organization_id: org, approval_id: approvalId, decision, comment: comment || null, actor_user_id: session!.user.id });
    if (error) { toast({ tone: "error", message: errorMessage(error) }); return; }
    toast({ tone: "success", message: decision === "approved" ? `“${a?.title}” aprovado.` : "Pedido de alteração enviado." });
    qc.invalidateQueries({ queryKey: ["portal-detail", pid] });
  };
  const download = async (path: string) => {
    const { data, error } = await supabase.storage.from("org-files").createSignedUrl(path, 300);
    if (error || !data) return toast({ tone: "error", message: errorMessage(error) });
    window.open(data.signedUrl, "_blank", "noopener");
  };
  const p = projects.data?.find((x) => x.id === pid);

  return (
    <PortalLayout studio={account?.studio_name} onSignOut={signOut}>
      <h1 className="text-2xl font-semibold">Olá{account ? `, ${account.client_name}` : ""}</h1>
      <p className="mt-1 text-sm text-fg-3">Acompanhe seus projetos, baixe arquivos e aprove entregas.</p>
      {projects.error ? <div className="mt-6"><ErrorState error={projects.error} /></div> : projects.isLoading ? <Spinner /> : !projects.data?.length ? (
        <div className="mt-6"><EmptyState title="Nenhum projeto compartilhado ainda" description="Quando o estúdio liberar um projeto, ele aparece aqui." /></div>
      ) : (
        <div className="mt-6 grid gap-5 lg:grid-cols-[260px_1fr]">
          <nav className="grid content-start gap-2" aria-label="Projetos">{projects.data.map((x) => (
            <button key={x.id} onClick={() => setSelected(x.id)} className={`rounded-lg border p-3 text-left ${x.id === pid ? "border-accent bg-accent-soft/40" : "border-border bg-surface hover:border-border-strong"}`}>
              <p className="text-sm font-medium">{x.name}</p><p className="text-xs text-fg-3">{categoryLabel[x.category]}</p>
              <div className="mt-2 flex items-center gap-2"><Progress value={x.progress ?? 0} /><span className="text-[11px] text-fg-3 tabular">{x.progress ?? 0}%</span></div>
            </button>))}</nav>
          {p && (
            <div className="grid content-start gap-4">
              <Card><div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-semibold">{p.name}</h2><Badge tone={projectStatusTone[p.status]} dot>{projectStatusLabel[p.status]}</Badge></div>
                <p className="mt-1 text-sm text-fg-3">{date(p.start_date)} → {date(p.due_date)}</p>{p.description && <p className="mt-3 text-sm text-fg-2">{p.description}</p>}</Card>
              {detail.isLoading ? <Spinner /> : detail.data && (<>
                <Card><CardHeader title="Aprovações" />{detail.data.approvals.length ? <ul className="grid gap-3">{detail.data.approvals.map((a) => <ApprovalCard key={a.id} a={a} onDecide={(d, c) => decide(a.id, d, c)} />)}</ul> : <p className="text-sm text-fg-3">Nada para aprovar no momento.</p>}</Card>
                <Card><CardHeader title="Etapas" /><Steps tasks={detail.data.tasks} /></Card>
                <Card><CardHeader title="Arquivos" />{detail.data.files.length ? <ul className="grid gap-2">{detail.data.files.map((f: { id: string; name: string; storage_path: string; created_at: string }) => (
                  <li key={f.id} className="flex items-center gap-3 text-sm"><span className="flex-1 truncate">{f.name}</span><span className="text-xs text-fg-3">{date(f.created_at)}</span><Button size="sm" icon={<Download className="size-3.5" />} onClick={() => download(f.storage_path)}>Baixar</Button></li>))}</ul> : <p className="text-sm text-fg-3">Nenhum arquivo compartilhado.</p>}</Card>
              </>)}
            </div>
          )}
        </div>
      )}
    </PortalLayout>
  );
}

/* --------------------------------------- Acesso por link seguro (sem conta) */
type LinkData = { project: { name: string; category: ProjectCategory; status: ProjectStatus; start_date: string | null; due_date: string | null; description: string | null; organizations: { name: string } | null };
  scopes: string[]; progress?: number; tasks?: { id: string; title: string; status: string; due_date: string | null }[];
  files?: { id: string; name: string; url: string | null; created_at: string }[]; approvals?: PortalApproval[]; allow_approvals?: boolean };

export function PortalLinkPage() {
  const toast = useToast();
  // O token fica no fragmento (#) da URL: não vai para servidores nem logs de acesso.
  const token = typeof window !== "undefined" ? window.location.hash.replace(/^#/, "") : "";
  const [name, setName] = useState("");
  const call = async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("portal", { body, headers: { "x-portal-token": token } });
    if (error) {
      let code = error.message;
      try { code = (await (error as { context?: Response }).context?.json())?.error ?? code; } catch { /* */ }
      throw new Error(code === "link_expired_or_revoked" || code === "invalid_token" ? "Este link expirou ou foi revogado. Peça um novo link ao estúdio." : code);
    }
    return data;
  };
  const q = useQuery({ queryKey: ["portal-link", token], enabled: /^[0-9a-f]{64}$/.test(token), retry: false, queryFn: () => call({ action: "view" }) as Promise<LinkData> });
  if (!/^[0-9a-f]{64}$/.test(token)) return <PortalLayout><ErrorState error="Link inválido. Confira o endereço recebido do estúdio." /></PortalLayout>;
  if (q.isLoading) return <PortalLayout><Spinner /></PortalLayout>;
  if (q.error || !q.data) return <PortalLayout><ErrorState error={q.error} /></PortalLayout>;
  const d = q.data;
  return (
    <PortalLayout studio={d.project.organizations?.name}>
      <div className="grid gap-4">
        <Card><div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold">{d.project.name}</h1><Badge tone={projectStatusTone[d.project.status]} dot>{projectStatusLabel[d.project.status]}</Badge></div>
          <p className="mt-1 text-sm text-fg-3">{categoryLabel[d.project.category]} · {date(d.project.start_date)} → {date(d.project.due_date)}</p>
          {d.progress != null && <div className="mt-3 flex items-center gap-3"><Progress value={d.progress} /><span className="text-sm tabular">{d.progress}%</span></div>}</Card>
        {d.approvals && (
          <Card><CardHeader title="Aprovações" />
            {d.allow_approvals && d.approvals.some((a) => a.status === "pending") && (
              <Field label="Seu nome (registrado junto com a resposta)" htmlFor="pl-name" className="mb-3"><Input id="pl-name" value={name} onChange={(e) => setName(e.target.value)} /></Field>)}
            {d.approvals.length ? <ul className="grid gap-3">{d.approvals.map((a) => <ApprovalCard key={a.id} a={a} onDecide={d.allow_approvals ? async (decision, comment) => {
              if (name.trim().length < 2) { toast({ tone: "error", message: "Informe seu nome antes de responder." }); return; }
              try { await call({ action: "decide", approval_id: a.id, decision, comment, name }); toast({ tone: "success", message: "Resposta registrada." }); q.refetch(); }
              catch (e) { toast({ tone: "error", message: errorMessage(e) }); }
            } : undefined} />)}</ul> : <p className="text-sm text-fg-3">Nada para aprovar.</p>}
          </Card>)}
        {d.tasks && <Card><CardHeader title="Etapas" /><Steps tasks={d.tasks} /></Card>}
        {d.files && <Card><CardHeader title="Arquivos" description="Links de download válidos por 10 minutos." />{d.files.length ? <ul className="grid gap-2">{d.files.map((f) => (
          <li key={f.id} className="flex items-center gap-3 text-sm"><span className="flex-1 truncate">{f.name}</span>{f.url && <a href={f.url} target="_blank" rel="noreferrer noopener"><Button size="sm" icon={<Download className="size-3.5" />}>Baixar</Button></a>}</li>))}</ul> : <p className="text-sm text-fg-3">Nenhum arquivo.</p>}</Card>}
        <p className="text-center text-xs text-fg-3">Tem uma conta? <Link to="/login" className="text-accent hover:underline">Entrar no portal</Link></p>
      </div>
    </PortalLayout>
  );
}
