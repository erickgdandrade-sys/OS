import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Copy, ExternalLink, Plus, Send, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge, Button, Card, CardHeader, ConfirmDialog, EmptyState, Field, Input, Modal, PageHeader, Segmented, Select, Skeleton, Tabs, Textarea, cn, useToast } from "@/components/ui";
import { useOrg } from "@/features/auth/AuthProvider";
import { clientName } from "@/features/clients/ClientsPages";
import { errorMessage } from "@/lib/domain";
import { date, dateTime } from "@/lib/format";
import { supabase } from "@/lib/supabase";

/* Social media: calendário editorial por cliente e mês, kanban de produção,
   aprovação do cliente (vira uma aprovação no projeto, respondida no link)
   e bancos de ideias, legendas e hashtags. A publicação é registrada à mão
   com o link do post — não há publicação automática sem integração conectada. */
type Status = "idea" | "planning" | "script" | "creating" | "internal_review" | "awaiting_client" | "approved" | "scheduled" | "published";
export const postStatusLabel: Record<Status, string> = { idea: "Ideia", planning: "Planejamento", script: "Roteiro", creating: "Criação", internal_review: "Revisão interna", awaiting_client: "Com o cliente", approved: "Aprovado", scheduled: "Agendado", published: "Publicado" };
const statusTone: Record<Status, "neutral" | "info" | "warning" | "success" | "accent"> = { idea: "neutral", planning: "neutral", script: "info", creating: "info", internal_review: "warning", awaiting_client: "warning", approved: "success", scheduled: "accent", published: "success" };
const formatLabel: Record<string, string> = { static: "Estático", carousel: "Carrossel", reels: "Reels", stories: "Stories", video: "Vídeo", campaign: "Campanha", institutional: "Institucional" };
type Post = { id: string; client_id: string; project_id: string | null; account_id: string | null; scheduled_for: string | null; format: string; theme: string | null; objective: string | null; pillar: string | null;
  caption: string | null; hashtags: string[]; cta: string | null; script: string | null; assignee_id: string | null; status: Status; approval_id: string | null; published_url: string | null; published_at: string | null; campaign: string | null };
const monthStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const toLocal = (s: string | null) => (s ? new Date(new Date(s).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "");

export function SocialPage() {
  const { orgId } = useOrg();
  const toast = useToast();
  const [clientId, setClientId] = useState("");
  const [month, setMonth] = useState(() => monthStart(new Date()));
  const [view, setView] = useState<"calendar" | "kanban" | "list">("calendar");
  const [tab, setTab] = useState<"posts" | "bank" | "accounts">("posts");
  const [edit, setEdit] = useState<Partial<Post> | null>(null);
  const clients = useQuery({ queryKey: ["clients", orgId], queryFn: async () => (await supabase.from("clients").select("id, legal_name, trade_name, status").eq("organization_id", orgId).order("legal_name")).data ?? [] });
  const cid = clientId || clients.data?.find((c) => c.status === "active")?.id || clients.data?.[0]?.id || "";
  const next = new Date(month.getFullYear(), month.getMonth() + 1, 1);
  const posts = useQuery({ queryKey: ["social-posts", cid, iso(month)], enabled: !!cid, queryFn: async () => {
    const { data, error } = await supabase.from("social_posts").select("*").eq("client_id", cid)
      .or(`and(scheduled_for.gte.${month.toISOString()},scheduled_for.lt.${next.toISOString()}),scheduled_for.is.null`).order("scheduled_for", { nullsFirst: true });
    if (error) throw error; return data as Post[];
  } });
  const cal = useQuery({ queryKey: ["social-calendar", cid, iso(month)], enabled: !!cid, queryFn: async () => (await supabase.from("social_calendars").select("id, pillars, notes").eq("client_id", cid).eq("month", iso(month)).maybeSingle()).data });
  const list = posts.data ?? [];
  const monthLabel = ((m) => m.charAt(0).toUpperCase() + m.slice(1))(month.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }));
  return (
    <div>
      <PageHeader title="Social media" description="Calendário editorial, produção, aprovação do cliente e registro das publicações."
        actions={tab === "posts" && cid && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEdit({ client_id: cid, status: "idea", format: "static", hashtags: [] })}>Novo post</Button>} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select aria-label="Cliente" className="w-64" value={cid} onChange={(e) => setClientId(e.target.value)}>
          {!clients.data?.length && <option value="">Nenhum cliente cadastrado</option>}
          {clients.data?.filter((c) => c.status !== "inactive").map((c) => <option key={c.id} value={c.id}>{clientName(c)}</option>)}
        </Select>
        {tab === "posts" && <>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" aria-label="Mês anterior" icon={<ChevronLeft className="size-4" />} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} />
            <span className="w-40 text-center text-sm font-medium">{monthLabel}</span>
            <Button size="sm" variant="ghost" aria-label="Próximo mês" icon={<ChevronRight className="size-4" />} onClick={() => setMonth(next)} />
          </div>
          <Segmented value={view} onChange={setView} items={[{ value: "calendar", label: "Calendário" }, { value: "kanban", label: "Kanban" }, { value: "list", label: "Lista" }]} />
        </>}
      </div>
      <Tabs value={tab} onChange={setTab} items={[{ value: "posts", label: "Posts", count: list.length }, { value: "bank", label: "Banco de conteúdo" }, { value: "accounts", label: "Contas e pilares" }]} />
      <div className="mt-4">
        {!cid ? <EmptyState title="Cadastre um cliente" description="O calendário editorial é organizado por cliente." /> :
          tab === "bank" ? <ContentBank clientId={cid} /> :
          tab === "accounts" ? <AccountsPanel clientId={cid} month={iso(month)} monthLabel={monthLabel} calendar={cal.data ?? null} onChanged={() => cal.refetch()} /> :
          posts.isLoading ? <Skeleton className="h-64" /> : view === "calendar" ? <MonthGrid month={month} posts={list} onOpen={setEdit} onNew={(d) => setEdit({ client_id: cid, status: "planning", format: "static", hashtags: [], scheduled_for: new Date(`${d}T12:00:00`).toISOString() })} />
          : view === "kanban" ? <Kanban posts={list} onOpen={setEdit} onMove={async (p, s) => {
              const { error } = await supabase.from("social_posts").update({ status: s }).eq("id", p.id); if (error) toast({ tone: "error", message: errorMessage(error) }); posts.refetch(); }} />
          : <PostList posts={list} onOpen={setEdit} />}
        {tab === "posts" && cal.data?.pillars?.length ? <p className="mt-3 text-xs text-fg-3">Pilares do mês: {cal.data.pillars.join(" · ")}</p> : null}
      </div>
      {edit && <PostModal post={edit} pillars={cal.data?.pillars ?? []} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); posts.refetch(); }} />}
    </div>
  );
}

function PostChip({ p, onOpen }: { p: Post; onOpen: (p: Post) => void }) {
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(p); }} className="w-full truncate rounded bg-surface px-1.5 py-1 text-left text-[11px] shadow-sm ring-1 ring-border hover:ring-accent">
      <span className={cn("mr-1 inline-block size-1.5 rounded-full", { neutral: "bg-fg-3", info: "bg-info", warning: "bg-warning", success: "bg-success", accent: "bg-accent" }[statusTone[p.status]])} />
      {p.scheduled_for && new Date(p.scheduled_for).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} {p.theme || formatLabel[p.format]}
    </button>
  );
}

function MonthGrid({ month, posts, onOpen, onNew }: { month: Date; posts: Post[]; onOpen: (p: Post) => void; onNew: (d: string) => void }) {
  const start = new Date(month); start.setDate(1 - start.getDay());
  const days = Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  const byDay = useMemo(() => { const m: Record<string, Post[]> = {}; posts.forEach((p) => { if (p.scheduled_for) { const k = iso(new Date(p.scheduled_for)); (m[k] ??= []).push(p); } }); return m; }, [posts]);
  const unscheduled = posts.filter((p) => !p.scheduled_for);
  const today = iso(new Date());
  return (
    <div className="grid gap-3">
      <div className="overflow-x-auto"><div className="grid min-w-[720px] grid-cols-7 overflow-hidden rounded-lg border border-border bg-border gap-px">
        {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((d) => <div key={d} className="bg-surface-2 px-2 py-1 text-xs font-medium text-fg-3">{d}</div>)}
        {days.map((d) => {
          const k = iso(d); const out = d.getMonth() !== month.getMonth();
          return (
            <div key={k} role="button" tabIndex={0} aria-label={`Novo post em ${d.toLocaleDateString("pt-BR")}`} onClick={() => onNew(k)} onKeyDown={(e) => { if (e.key === "Enter") onNew(k); }}
              className={cn("min-h-24 cursor-pointer bg-surface p-1.5 hover:bg-surface-2", out && "bg-surface-2/60 text-fg-3")}>
              <p className={cn("mb-1 text-xs tabular", k === today && "inline-flex size-5 items-center justify-center rounded-full bg-accent text-white")}>{d.getDate()}</p>
              <div className="grid gap-1">{byDay[k]?.map((p) => <PostChip key={p.id} p={p} onOpen={onOpen} />)}</div>
            </div>);
        })}
      </div></div>
      {unscheduled.length > 0 && <Card><CardHeader title="Sem data" description="Ideias e posts ainda sem dia definido." /><div className="grid gap-1.5 sm:grid-cols-3">{unscheduled.map((p) => <PostChip key={p.id} p={p} onOpen={onOpen} />)}</div></Card>}
    </div>
  );
}

const flow: Status[] = ["idea", "planning", "script", "creating", "internal_review", "awaiting_client", "approved", "scheduled", "published"];
function Kanban({ posts, onOpen, onMove }: { posts: Post[]; onOpen: (p: Post) => void; onMove: (p: Post, s: Status) => void }) {
  const [drag, setDrag] = useState<Post | null>(null);
  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {flow.map((s) => (
        <div key={s} className="w-56 shrink-0 rounded-lg bg-surface-2 p-2" onDragOver={(e) => e.preventDefault()}
          onDrop={() => { if (drag && drag.status !== s && s !== "awaiting_client" && s !== "published") onMove(drag, s); setDrag(null); }}>
          <p className="mb-2 flex items-center justify-between px-1 text-xs font-medium">{postStatusLabel[s]}<span className="text-fg-3">{posts.filter((p) => p.status === s).length}</span></p>
          <div className="grid gap-2">
            {posts.filter((p) => p.status === s).map((p) => (
              <button key={p.id} type="button" draggable onDragStart={() => setDrag(p)} onClick={() => onOpen(p)} className="rounded-md bg-surface p-2 text-left text-sm shadow-sm ring-1 ring-border hover:ring-accent">
                <p className="truncate font-medium">{p.theme || "Sem tema"}</p>
                <p className="text-xs text-fg-3">{formatLabel[p.format]}{p.scheduled_for && <> · {dateTime(p.scheduled_for)}</>}</p>
              </button>))}
          </div>
          {(s === "awaiting_client" || s === "published") && <p className="mt-2 px-1 text-[10px] text-fg-3">{s === "awaiting_client" ? "Use “Enviar para aprovação” no post." : "Use “Registrar publicação” no post."}</p>}
        </div>))}
    </div>
  );
}

function PostList({ posts, onOpen }: { posts: Post[]; onOpen: (p: Post) => void }) {
  if (!posts.length) return <EmptyState title="Nenhum post neste mês" description="Crie posts pelo botão “Novo post” ou clicando num dia do calendário." />;
  return (
    <Card padded={false}><ul className="divide-y divide-border">{posts.map((p) => (
      <li key={p.id}><button type="button" onClick={() => onOpen(p)} className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-surface-2">
        <span className="w-36 text-xs tabular text-fg-3">{p.scheduled_for ? dateTime(p.scheduled_for) : "Sem data"}</span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.theme || "Sem tema"}</span>
        <Badge>{formatLabel[p.format]}</Badge><Badge tone={statusTone[p.status]}>{postStatusLabel[p.status]}</Badge>
      </button></li>))}</ul></Card>
  );
}

function PostModal({ post, pillars, onClose, onSaved }: { post: Partial<Post>; pillars: string[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { orgId } = useOrg();
  const [f, setF] = useState({ scheduled_for: toLocal(post.scheduled_for ?? null), format: post.format ?? "static", theme: post.theme ?? "", objective: post.objective ?? "", pillar: post.pillar ?? "",
    caption: post.caption ?? "", hashtags: (post.hashtags ?? []).join(" "), cta: post.cta ?? "", script: post.script ?? "", status: (post.status ?? "idea") as Status, project_id: post.project_id ?? "", assignee_id: post.assignee_id ?? "", campaign: post.campaign ?? "" });
  const [busy, setBusy] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [pubUrl, setPubUrl] = useState("");
  const [del, setDel] = useState(false);
  const [bank, setBank] = useState(false);
  const projects = useQuery({ queryKey: ["client-projects", post.client_id], queryFn: async () => (await supabase.from("projects").select("id, name").eq("client_id", post.client_id!).not("status", "in", "(completed,cancelled)").order("created_at", { ascending: false })).data ?? [] });
  const team = useQuery({ queryKey: ["team-directory", orgId], queryFn: async () => ((await supabase.rpc("team_directory", { p_org: orgId })).data ?? []) as { user_id: string; full_name: string; status: string }[] });
  const tags = f.hashtags.split(/[\s,]+/).map((t) => t.trim()).filter(Boolean).map((t) => (t.startsWith("#") ? t : `#${t}`));
  const row = () => ({ scheduled_for: f.scheduled_for ? new Date(f.scheduled_for).toISOString() : null, format: f.format, theme: f.theme || null, objective: f.objective || null, pillar: f.pillar || null,
    caption: f.caption || null, hashtags: tags, cta: f.cta || null, script: f.script || null, status: f.status, project_id: f.project_id || null, assignee_id: f.assignee_id || null, campaign: f.campaign || null });
  const save = async (): Promise<string | null> => {
    setBusy(true);
    const r = post.id ? await supabase.from("social_posts").update(row()).eq("id", post.id).select("id").single()
      : await supabase.from("social_posts").insert({ ...row(), organization_id: orgId, client_id: post.client_id }).select("id").single();
    setBusy(false);
    if (r.error) { toast({ tone: "error", message: errorMessage(r.error) }); return null; }
    return r.data.id;
  };
  const requestApproval = async () => {
    if (!f.project_id) { toast({ tone: "error", message: "Vincule o post a um projeto do cliente: a aprovação aparece no link desse projeto." }); return; }
    if (!f.caption.trim()) { toast({ tone: "error", message: "Escreva a legenda antes de enviar para aprovação." }); return; }
    const id = await save(); if (!id) return;
    const { error } = await supabase.rpc("request_post_approval", { p_post: id, p_due: null });
    if (error) toast({ tone: "error", message: errorMessage(error) }); else { toast({ tone: "success", message: "Enviado para aprovação: o cliente responde no link do projeto." }); onSaved(); }
  };
  const publish = async () => {
    if (!/^https?:\/\//.test(pubUrl.trim())) { toast({ tone: "error", message: "Cole o link do post publicado." }); return; }
    const { error } = await supabase.from("social_posts").update({ status: "published", published_url: pubUrl.trim() }).eq("id", post.id!);
    if (error) toast({ tone: "error", message: errorMessage(error) }); else { toast({ tone: "success", message: "Publicação registrada." }); onSaved(); }
  };
  const copyCaption = async () => { try { await navigator.clipboard.writeText([f.caption, f.cta, tags.join(" ")].filter(Boolean).join("\n\n")); toast({ tone: "success", message: "Legenda, CTA e hashtags copiados." }); } catch { toast({ tone: "error", message: "Não foi possível copiar." }); } };
  return (
    <Modal open onClose={onClose} size="lg" title={post.id ? "Editar post" : "Novo post"}
      footer={<div className="flex w-full flex-wrap items-center gap-2">
        {post.id && <Button variant="ghost" aria-label="Excluir post" icon={<Trash2 className="size-4" />} onClick={() => setDel(true)} />}
        {post.id && (post.status === "approved" || post.status === "scheduled") && <Button icon={<ExternalLink className="size-4" />} onClick={() => setPublishing(true)}>Registrar publicação</Button>}
        {post.status !== "published" && post.status !== "awaiting_client" && <Button icon={<Send className="size-4" />} loading={busy} onClick={requestApproval}>Enviar para aprovação</Button>}
        <span className="flex-1" />
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button variant="primary" loading={busy} onClick={async () => { if (await save()) { toast({ tone: "success", message: "Post salvo." }); onSaved(); } }}>Salvar</Button>
      </div>}>
      {post.status === "awaiting_client" && <p className="mb-3 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">Aguardando a resposta do cliente no link do projeto.</p>}
      {post.published_url && <p className="mb-3 text-sm">Publicado em {date(post.published_at)}: <a href={post.published_url} target="_blank" rel="noreferrer noopener" className="text-accent hover:underline">{post.published_url}</a></p>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Data e hora" htmlFor="sp-date"><Input id="sp-date" type="datetime-local" value={f.scheduled_for} onChange={(e) => setF({ ...f, scheduled_for: e.target.value })} /></Field>
        <Field label="Formato" htmlFor="sp-format"><Select id="sp-format" value={f.format} onChange={(e) => setF({ ...f, format: e.target.value })}>{Object.entries(formatLabel).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        <Field label="Status" htmlFor="sp-status"><Select id="sp-status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as Status })}>
          {flow.filter((s) => s !== "published" && (s !== "awaiting_client" || post.status === "awaiting_client")).map((s) => <option key={s} value={s}>{postStatusLabel[s]}</option>)}
          {post.status === "published" && <option value="published">Publicado</option>}</Select></Field>
        <Field label="Tema" htmlFor="sp-theme" className="sm:col-span-2"><Input id="sp-theme" value={f.theme} onChange={(e) => setF({ ...f, theme: e.target.value })} /></Field>
        <Field label="Pilar" htmlFor="sp-pillar">{pillars.length ? <Select id="sp-pillar" value={f.pillar} onChange={(e) => setF({ ...f, pillar: e.target.value })}><option value="">—</option>{pillars.map((p) => <option key={p}>{p}</option>)}</Select>
          : <Input id="sp-pillar" value={f.pillar} onChange={(e) => setF({ ...f, pillar: e.target.value })} />}</Field>
        <Field label="Objetivo" htmlFor="sp-obj"><Input id="sp-obj" value={f.objective} onChange={(e) => setF({ ...f, objective: e.target.value })} placeholder="Alcance, engajamento, venda…" /></Field>
        <Field label="Projeto (para aprovação)" htmlFor="sp-proj"><Select id="sp-proj" value={f.project_id} onChange={(e) => setF({ ...f, project_id: e.target.value })}><option value="">Sem projeto</option>{projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
        <Field label="Responsável" htmlFor="sp-assignee"><Select id="sp-assignee" value={f.assignee_id} onChange={(e) => setF({ ...f, assignee_id: e.target.value })}><option value="">—</option>{team.data?.filter((m) => m.status === "active").map((m) => <option key={m.user_id} value={m.user_id}>{m.full_name || "Sem nome"}</option>)}</Select></Field>
        <Field label="Legenda" htmlFor="sp-caption" className="sm:col-span-3" hint={`${f.caption.length} caracteres`}><Textarea id="sp-caption" rows={5} value={f.caption} onChange={(e) => setF({ ...f, caption: e.target.value })} /></Field>
        <Field label="Hashtags" htmlFor="sp-tags" className="sm:col-span-2" hint={tags.length ? `${tags.length} hashtags` : undefined}><Input id="sp-tags" value={f.hashtags} onChange={(e) => setF({ ...f, hashtags: e.target.value })} placeholder="#cafe #recife" /></Field>
        <Field label="CTA" htmlFor="sp-cta"><Input id="sp-cta" value={f.cta} onChange={(e) => setF({ ...f, cta: e.target.value })} placeholder="Link na bio" /></Field>
        {(f.format === "reels" || f.format === "video" || f.format === "stories") && <Field label="Roteiro" htmlFor="sp-script" className="sm:col-span-3"><Textarea id="sp-script" rows={4} value={f.script} onChange={(e) => setF({ ...f, script: e.target.value })} /></Field>}
        <div className="flex gap-2 sm:col-span-3"><Button size="sm" variant="ghost" onClick={() => setBank(true)}>Usar do banco de conteúdo</Button><Button size="sm" variant="ghost" icon={<Copy className="size-3.5" />} onClick={copyCaption}>Copiar para publicar</Button></div>
      </div>
      <Modal open={publishing} onClose={() => setPublishing(false)} title="Registrar publicação" description="Cole o link do post já publicado na rede social."
        footer={<><Button variant="ghost" onClick={() => setPublishing(false)}>Cancelar</Button><Button variant="primary" onClick={publish}>Registrar</Button></>}>
        <Field label="Link do post" htmlFor="sp-url"><Input id="sp-url" type="url" placeholder="https://instagram.com/p/…" value={pubUrl} onChange={(e) => setPubUrl(e.target.value)} /></Field>
      </Modal>
      {bank && <BankPicker clientId={post.client_id!} onClose={() => setBank(false)} onPick={(s) => {
        if (s.kind === "hashtags") setF((x) => ({ ...x, hashtags: [x.hashtags, s.body].filter(Boolean).join(" ") }));
        else if (s.kind === "script") setF((x) => ({ ...x, script: s.body }));
        else if (s.kind === "idea") setF((x) => ({ ...x, theme: x.theme || s.title || s.body.slice(0, 80) }));
        else setF((x) => ({ ...x, caption: s.body }));
        setBank(false);
      }} />}
      <ConfirmDialog open={del} onClose={() => setDel(false)} title="Excluir post?" description="A aprovação ligada a este post continua no histórico do projeto." onConfirm={async () => { const { error } = await supabase.from("social_posts").delete().eq("id", post.id!); if (error) toast({ tone: "error", message: errorMessage(error) }); else onSaved(); }} />
    </Modal>
  );
}

type Snippet = { id: string; kind: "idea" | "caption" | "hashtags" | "script"; title: string | null; body: string; tags: string[]; client_id: string | null };
const snippetLabel: Record<Snippet["kind"], string> = { idea: "Ideias", caption: "Legendas", hashtags: "Hashtags", script: "Roteiros" };
function useSnippets(clientId: string) {
  const { orgId } = useOrg();
  return useQuery({ queryKey: ["snippets", orgId, clientId], queryFn: async () =>
    ((await supabase.from("content_snippets").select("id, kind, title, body, tags, client_id").eq("organization_id", orgId).or(`client_id.eq.${clientId},client_id.is.null`).order("created_at", { ascending: false })).data ?? []) as Snippet[] });
}

function ContentBank({ clientId }: { clientId: string }) {
  const toast = useToast();
  const { orgId, userId } = useOrg();
  const q = useSnippets(clientId);
  const [kind, setKind] = useState<Snippet["kind"]>("idea");
  const [f, setF] = useState({ title: "", body: "", global: false });
  const add = async () => {
    if (!f.body.trim()) { toast({ tone: "error", message: "Escreva o conteúdo." }); return; }
    const { error } = await supabase.from("content_snippets").insert({ organization_id: orgId, client_id: f.global ? null : clientId, kind, title: f.title || null, body: f.body.trim(), created_by: userId });
    if (error) toast({ tone: "error", message: errorMessage(error) }); else { setF({ title: "", body: "", global: false }); q.refetch(); }
  };
  const rows = (q.data ?? []).filter((s) => s.kind === kind);
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <Card>
        <Segmented value={kind} onChange={setKind} items={Object.entries(snippetLabel).map(([value, label]) => ({ value: value as Snippet["kind"], label }))} />
        <ul className="mt-3 grid gap-2">{!rows.length ? <p className="text-sm text-fg-3">Nada aqui ainda.</p> : rows.map((s) => (
          <li key={s.id} className="rounded-lg border border-border p-3">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">{s.title && <p className="text-sm font-medium">{s.title}</p>}<p className="whitespace-pre-wrap text-sm text-fg-2">{s.body}</p>{!s.client_id && <Badge className="mt-1">Todos os clientes</Badge>}</div>
              <Button size="sm" variant="ghost" aria-label="Copiar" icon={<Copy className="size-3.5" />} onClick={() => navigator.clipboard.writeText(s.body).then(() => toast({ tone: "success", message: "Copiado." }))} />
              <Button size="sm" variant="ghost" aria-label="Excluir" icon={<Trash2 className="size-3.5" />} onClick={async () => { await supabase.from("content_snippets").delete().eq("id", s.id); q.refetch(); }} />
            </div>
          </li>))}</ul>
      </Card>
      <Card className="h-fit">
        <CardHeader title={`Adicionar em ${snippetLabel[kind]}`} />
        <div className="grid gap-3">
          <Field label="Título (opcional)" htmlFor="cb-title"><Input id="cb-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
          <Field label={kind === "hashtags" ? "Hashtags" : "Conteúdo"} htmlFor="cb-body"><Textarea id="cb-body" rows={5} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-[var(--accent)]" checked={f.global} onChange={(e) => setF({ ...f, global: e.target.checked })} />Disponível para todos os clientes</label>
          <Button variant="primary" onClick={add}>Adicionar</Button>
        </div>
      </Card>
    </div>
  );
}

function BankPicker({ clientId, onClose, onPick }: { clientId: string; onClose: () => void; onPick: (s: Snippet) => void }) {
  const q = useSnippets(clientId);
  const [kind, setKind] = useState<Snippet["kind"]>("caption");
  const rows = (q.data ?? []).filter((s) => s.kind === kind);
  return (
    <Modal open onClose={onClose} title="Banco de conteúdo">
      <Segmented value={kind} onChange={setKind} items={Object.entries(snippetLabel).map(([value, label]) => ({ value: value as Snippet["kind"], label }))} />
      <ul className="mt-3 grid max-h-96 gap-2 overflow-y-auto">{!rows.length ? <p className="text-sm text-fg-3">Nada salvo nesta categoria.</p> : rows.map((s) => (
        <li key={s.id}><button type="button" onClick={() => onPick(s)} className="w-full rounded-lg border border-border p-3 text-left hover:bg-surface-2">{s.title && <p className="text-sm font-medium">{s.title}</p>}<p className="line-clamp-3 text-sm text-fg-2">{s.body}</p></button></li>))}</ul>
    </Modal>
  );
}

const networks: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", linkedin: "LinkedIn", tiktok: "TikTok", youtube: "YouTube", x: "X", pinterest: "Pinterest", other: "Outra" };
function AccountsPanel({ clientId, month, monthLabel, calendar, onChanged }: { clientId: string; month: string; monthLabel: string; calendar: { id: string; pillars: string[]; notes: string | null } | null; onChanged: () => void }) {
  const toast = useToast();
  const { orgId } = useOrg();
  const acc = useQuery({ queryKey: ["social-accounts", clientId], queryFn: async () => (await supabase.from("social_accounts").select("id, network, handle, integration_id").eq("client_id", clientId).order("network")).data ?? [] });
  const [a, setA] = useState({ network: "instagram", handle: "" });
  const [pillars, setPillars] = useState((calendar?.pillars ?? []).join(", "));
  const [notes, setNotes] = useState(calendar?.notes ?? "");
  const saveCal = async () => {
    const row = { pillars: pillars.split(",").map((p) => p.trim()).filter(Boolean), notes: notes || null };
    const { error } = calendar ? await supabase.from("social_calendars").update(row).eq("id", calendar.id) : await supabase.from("social_calendars").insert({ ...row, organization_id: orgId, client_id: clientId, month });
    if (error) toast({ tone: "error", message: errorMessage(error) }); else { toast({ tone: "success", message: "Planejamento do mês salvo." }); onChanged(); }
  };
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Contas do cliente" description="Para organizar os posts. A publicação automática só funciona com integração conectada; por enquanto o post publicado é registrado com o link." />
        <ul className="grid gap-2">{acc.data?.map((x) => (
          <li key={x.id} className="flex items-center gap-2 text-sm"><Badge>{networks[x.network]}</Badge><span className="flex-1">{x.handle}</span><span className="text-xs text-fg-3">{x.integration_id ? "Conectada" : "Sem integração"}</span>
            <Button size="sm" variant="ghost" aria-label="Remover conta" icon={<Trash2 className="size-3.5" />} onClick={async () => { await supabase.from("social_accounts").delete().eq("id", x.id); acc.refetch(); }} /></li>))}</ul>
        <form className="mt-3 flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (!a.handle.trim()) return;
          const { error } = await supabase.from("social_accounts").insert({ organization_id: orgId, client_id: clientId, network: a.network, handle: a.handle.trim() });
          if (error) toast({ tone: "error", message: errorMessage(error) }); else { setA({ ...a, handle: "" }); acc.refetch(); } }}>
          <Select aria-label="Rede" className="w-36" value={a.network} onChange={(e) => setA({ ...a, network: e.target.value })}>{Object.entries(networks).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
          <Input aria-label="Perfil" placeholder="@perfil" value={a.handle} onChange={(e) => setA({ ...a, handle: e.target.value })} />
          <Button type="submit" size="sm" aria-label="Adicionar conta" icon={<Plus className="size-3.5" />} />
        </form>
      </Card>
      <Card>
        <CardHeader title={`Planejamento de ${monthLabel}`} />
        <div className="grid gap-3">
          <Field label="Pilares de conteúdo (separados por vírgula)" htmlFor="ac-pillars"><Input id="ac-pillars" value={pillars} onChange={(e) => setPillars(e.target.value)} placeholder="Produto, Bastidores, Educação, Comunidade" /></Field>
          <Field label="Observações do mês" htmlFor="ac-notes"><Textarea id="ac-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Datas, campanhas, lançamentos…" /></Field>
          <div><Button variant="primary" onClick={saveCal}>Salvar planejamento</Button></div>
        </div>
      </Card>
    </div>
  );
}
