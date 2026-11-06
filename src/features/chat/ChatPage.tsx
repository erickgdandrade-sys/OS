import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowUp, CheckSquare, FolderKanban, MessageSquarePlus, Pencil, Search, Trash2, Users, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Avatar, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Segmented, Textarea, cn, useToast } from "@/components/ui";
import { useAuth } from "@/features/auth/AuthProvider";
import { errorMessage } from "@/lib/domain";
import { supabase } from "@/lib/supabase";

/* Chat interno da equipe: conversas diretas e grupos, com compartilhamento
   de projetos e tarefas. Só participa quem é membro ativo do estúdio (RLS);
   mensagens chegam em tempo real pelo Supabase Realtime. */
export type Person = { id: string; full_name: string; username: string | null; avatar_path: string | null; job_title?: string | null };
type Thread = { id: string; kind: "direct" | "group"; title: string | null; last_message_at: string; unread: number; last_body: string | null; last_author: string | null; members: Person[] };
type Msg = { id: string; thread_id: string; author_id: string | null; body: string; shared: { type: "project" | "task"; id: string; title: string; subtitle?: string | null; project_id?: string } | null; created_at: string; edited_at: string | null; deleted_at: string | null };

export const threadName = (t: Thread, me?: string) => t.kind === "group" ? t.title ?? "Grupo" : (t.members.find((m) => m.id !== me)?.full_name || "@" + (t.members.find((m) => m.id !== me)?.username ?? "pessoa"));

export function useChatOverview() {
  const { session } = useAuth();
  return useQuery({ queryKey: ["chat-overview"], enabled: !!session, refetchInterval: 60_000, queryFn: async () => {
    const { data, error } = await supabase.rpc("chat_overview"); if (error) throw error; return (data ?? []) as Thread[];
  } });
}

/* Mantém a lista atualizada quando chega mensagem (qualquer tela do app). */
export function useChatRealtime() {
  const qc = useQueryClient();
  const { session } = useAuth();
  useEffect(() => {
    if (!session) return;
    const ch = supabase.channel("chat-messages").on("postgres_changes", { event: "*", schema: "public", table: "chat_messages" }, (payload) => {
      const row = (payload.new ?? payload.old) as { thread_id?: string };
      qc.invalidateQueries({ queryKey: ["chat-overview"] });
      if (row?.thread_id) qc.invalidateQueries({ queryKey: ["chat-messages", row.thread_id] });
    }).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc, session]);
}

export function ChatPage() {
  const { session } = useAuth();
  const me = session?.user.id;
  const qc = useQueryClient();
  const overview = useChatOverview();
  const [active, setActive] = useState<string | null>(() => new URLSearchParams(window.location.search).get("c"));
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState("");
  const threads = overview.data ?? [];
  const thread = threads.find((t) => t.id === active) ?? null;
  useEffect(() => { if (!active && threads.length && window.innerWidth >= 1024) setActive(threads[0].id); }, [threads, active]);
  const shown = threads.filter((t) => !filter || threadName(t, me).toLowerCase().includes(filter.toLowerCase()) || t.members.some((m) => m.username?.includes(filter.toLowerCase().replace(/^@/, ""))));

  return (
    <div>
      <PageHeader title="Chat" description="Converse com a equipe e compartilhe projetos e tarefas." actions={<Button variant="primary" icon={<MessageSquarePlus className="size-4" />} onClick={() => setCreating(true)}>Nova conversa</Button>} />
      <div className="grid h-[calc(100dvh-12rem)] min-h-[480px] gap-4 lg:grid-cols-[300px_1fr]">
        <Card padded={false} className={cn("flex min-h-0 flex-col", thread && "hidden lg:flex")}>
          <div className="border-b border-border p-2"><div className="relative"><Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-fg-3" /><Input aria-label="Filtrar conversas" placeholder="Buscar conversa ou @usuario" className="pl-8" value={filter} onChange={(e) => setFilter(e.target.value)} /></div></div>
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {!shown.length && <li className="p-4 text-sm text-fg-3">{threads.length ? "Nada encontrado." : "Nenhuma conversa ainda. Comece uma em “Nova conversa”."}</li>}
            {shown.map((t) => {
              const other = t.kind === "direct" ? t.members.find((m) => m.id !== me) : null;
              return (
                <li key={t.id}><button type="button" onClick={() => setActive(t.id)} className={cn("flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-surface-2", active === t.id && "bg-surface-2")}>
                  {other ? <Avatar name={other.full_name || other.username} path={other.avatar_path} size={36} /> : <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent"><Users className="size-4" /></span>}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2"><span className={cn("truncate text-sm", t.unread ? "font-semibold" : "font-medium")}>{threadName(t, me)}</span><span className="ml-auto shrink-0 text-[11px] text-fg-3">{new Date(t.last_message_at).toLocaleDateString("pt-BR") === new Date().toLocaleDateString("pt-BR") ? new Date(t.last_message_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : new Date(t.last_message_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</span></span>
                    <span className="flex items-center gap-2"><span className="truncate text-xs text-fg-3">{t.last_author === me && t.last_body ? "Você: " : ""}{t.last_body || (t.kind === "group" ? `${t.members.length} pessoas` : other ? `@${other.username}` : "")}</span>
                      {t.unread > 0 && <span className="ml-auto rounded-full bg-accent px-1.5 text-[10px] font-semibold text-white">{t.unread}</span>}</span>
                  </span>
                </button></li>);
            })}
          </ul>
        </Card>
        {thread ? <ThreadView key={thread.id} thread={thread} me={me!} onBack={() => setActive(null)} onChanged={() => qc.invalidateQueries({ queryKey: ["chat-overview"] })} />
          : <Card className="hidden items-center justify-center lg:flex"><EmptyState title="Escolha uma conversa" description="Ou comece uma nova procurando a pessoa pelo @usuario." /></Card>}
      </div>
      {creating && <NewChatModal onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); overview.refetch().then(() => setActive(id)); }} />}
    </div>
  );
}

function ThreadView({ thread, me, onBack, onChanged }: { thread: Thread; me: string; onBack: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [sharing, setSharing] = useState(false);
  const [editing, setEditing] = useState<Msg | null>(null);
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const msgs = useQuery({ queryKey: ["chat-messages", thread.id], queryFn: async () => {
    const { data, error } = await supabase.from("chat_messages").select("*").eq("thread_id", thread.id).order("created_at", { ascending: false }).limit(200);
    if (error) throw error; return ((data ?? []) as Msg[]).reverse();
  } });
  const byId = useMemo(() => Object.fromEntries(thread.members.map((m) => [m.id, m])), [thread.members]);
  // Abrir a conversa marca como lida.
  useEffect(() => {
    if (!thread.unread && msgs.data === undefined) return;
    supabase.from("chat_members").update({ last_read_at: new Date().toISOString() }).eq("thread_id", thread.id).eq("user_id", me).then(() => onChanged());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread.id, msgs.data?.length]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [msgs.data?.length]);

  const send = async (shared?: Msg["shared"]) => {
    const body = shared ? "" : text.trim();
    if (!body && !shared) return;
    setBusy(true);
    const { error } = await supabase.from("chat_messages").insert({ thread_id: thread.id, author_id: me, body, shared: shared ?? null });
    setBusy(false);
    if (error) { toast({ tone: "error", message: /share_forbidden/.test(error.message) ? "Você não tem acesso a esse item para compartilhar." : errorMessage(error) }); return; }
    if (!shared) setText("");
    msgs.refetch(); onChanged();
  };
  const saveEdit = async (m: Msg, body: string) => {
    const { error } = await supabase.from("chat_messages").update({ body }).eq("id", m.id);
    if (error) toast({ tone: "error", message: errorMessage(error) }); else { setEditing(null); msgs.refetch(); }
  };
  const remove = async (m: Msg) => {
    const { error } = await supabase.from("chat_messages").update({ deleted_at: new Date().toISOString() }).eq("id", m.id);
    if (error) toast({ tone: "error", message: errorMessage(error) }); else { msgs.refetch(); onChanged(); }
  };
  const other = thread.kind === "direct" ? thread.members.find((m) => m.id !== me) : null;
  let lastDay = "";
  return (
    <Card padded={false} className="flex min-h-0 flex-col">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <Button size="sm" variant="ghost" className="lg:hidden" onClick={onBack}>←</Button>
        {other ? <Avatar name={other.full_name || other.username} path={other.avatar_path} size={36} /> : <span className="flex size-9 items-center justify-center rounded-full bg-accent-soft text-accent"><Users className="size-4" /></span>}
        <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{threadName(thread, me)}</p>
          <p className="truncate text-xs text-fg-3">{other ? `@${other.username}` : thread.members.map((m) => m.id === me ? "você" : m.full_name || `@${m.username}`).join(", ")}</p></div>
      </header>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-4 py-3" aria-live="polite">
        {msgs.data?.map((m, i) => {
          const day = new Date(m.created_at).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
          const showDay = day !== lastDay; lastDay = day;
          const mine = m.author_id === me;
          const prev = msgs.data![i - 1];
          const grouped = prev && prev.author_id === m.author_id && !showDay && new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < 5 * 60_000;
          const author = m.author_id ? byId[m.author_id] : null;
          return (
            <div key={m.id}>
              {showDay && <p className="my-3 text-center text-[11px] font-medium uppercase tracking-wider text-fg-3">{day}</p>}
              <div className={cn("group flex gap-2", mine ? "justify-end" : "justify-start", !grouped && "mt-2")}>
                {!mine && <span className="w-7 shrink-0">{!grouped && <Avatar name={author?.full_name || author?.username} path={author?.avatar_path} size={28} />}</span>}
                <div className={cn("max-w-[75%]", mine && "items-end")}>
                  {!mine && !grouped && thread.kind === "group" && <p className="mb-0.5 text-[11px] font-medium text-fg-3">{author?.full_name || `@${author?.username ?? "pessoa"}`}</p>}
                  {m.deleted_at ? <p className="rounded-lg border border-dashed border-border px-3 py-1.5 text-xs italic text-fg-3">Mensagem apagada</p>
                    : editing?.id === m.id ? <EditBox m={m} onCancel={() => setEditing(null)} onSave={(b) => saveEdit(m, b)} />
                    : <div className={cn("rounded-lg px-3 py-2 text-sm", mine ? "bg-ink text-paper dark:bg-surface-3 dark:text-fg" : "bg-surface-2")}>
                      {m.shared && <SharedCard s={m.shared} mine={mine} />}
                      {m.body && <p className={cn("whitespace-pre-wrap break-words leading-relaxed", m.shared && "mt-1.5")}>{m.body}</p>}
                    </div>}
                  <p className={cn("mt-0.5 text-[10px] text-fg-3", mine && "text-right")}>{new Date(m.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}{m.edited_at && " · editada"}
                    {mine && !m.deleted_at && editing?.id !== m.id && <span className="ml-2 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                      {m.body && <button type="button" className="mr-1 hover:text-fg" aria-label="Editar mensagem" onClick={() => setEditing(m)}><Pencil className="inline size-3" /></button>}
                      <button type="button" className="hover:text-danger" aria-label="Apagar mensagem" onClick={() => remove(m)}><Trash2 className="inline size-3" /></button></span>}</p>
                </div>
              </div>
            </div>);
        })}
        {msgs.data && !msgs.data.length && <p className="py-10 text-center text-sm text-fg-3">Nenhuma mensagem ainda. Diga oi!</p>}
        <div ref={endRef} />
      </div>
      <form className="flex items-end gap-2 border-t border-border p-3" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <Button size="sm" variant="ghost" aria-label="Compartilhar projeto ou tarefa" icon={<FolderKanban className="size-4" />} onClick={() => setSharing(true)} className="h-10" />
        <Textarea aria-label="Mensagem" rows={1} value={text} onChange={(e) => setText(e.target.value)} placeholder="Escreva uma mensagem…" className="max-h-32 flex-1 resize-none"
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
        <Button type="submit" variant="primary" aria-label="Enviar" loading={busy} icon={<ArrowUp className="size-4" />} className="h-10" />
      </form>
      {sharing && <SharePicker onClose={() => setSharing(false)} onPick={(s) => { setSharing(false); send(s); }} />}
    </Card>
  );
}

function EditBox({ m, onCancel, onSave }: { m: Msg; onCancel: () => void; onSave: (b: string) => void }) {
  const [b, setB] = useState(m.body);
  return (
    <div className="grid gap-1.5"><Textarea aria-label="Editar mensagem" rows={2} value={b} onChange={(e) => setB(e.target.value)} autoFocus />
      <div className="flex justify-end gap-1"><Button size="sm" variant="ghost" onClick={onCancel}>Cancelar</Button><Button size="sm" variant="primary" disabled={!b.trim()} onClick={() => onSave(b.trim())}>Salvar</Button></div></div>
  );
}

function SharedCard({ s, mine }: { s: NonNullable<Msg["shared"]>; mine: boolean }) {
  const to = s.type === "project" ? `/projetos/${s.id}` : `/projetos/${s.project_id}`;
  return (
    <Link to={to} className={cn("flex items-center gap-2.5 rounded-md border px-2.5 py-2", mine ? "border-white/15 bg-white/5 hover:bg-white/10" : "border-border bg-surface hover:border-accent")}>
      {s.type === "project" ? <FolderKanban className="size-4 shrink-0" /> : <CheckSquare className="size-4 shrink-0" />}
      <span className="min-w-0"><span className="block truncate text-sm font-medium">{s.title}</span><span className={cn("block truncate text-xs", mine ? "text-white/60" : "text-fg-3")}>{s.type === "project" ? "Projeto" : "Tarefa"}{s.subtitle ? ` · ${s.subtitle}` : ""}</span></span>
    </Link>
  );
}

function SharePicker({ onClose, onPick }: { onClose: () => void; onPick: (s: NonNullable<Msg["shared"]>) => void }) {
  const { membership } = useAuth();
  const [kind, setKind] = useState<"project" | "task">("project");
  const [q, setQ] = useState("");
  const items = useQuery({ queryKey: ["share-picker", kind, q, membership?.organization_id], queryFn: async () => {
    const t = q.trim().replace(/[%,()]/g, " ");
    if (kind === "project") {
      let r = supabase.from("projects").select("id, name, clients(legal_name, trade_name)").eq("organization_id", membership!.organization_id).neq("status", "cancelled").order("created_at", { ascending: false }).limit(20);
      if (t) r = r.ilike("name", `%${t}%`);
      return ((await r).data ?? []).map((p) => ({ id: p.id as string, title: p.name as string, subtitle: ((p.clients as unknown as { trade_name: string | null; legal_name: string } | null)?.trade_name ?? (p.clients as unknown as { legal_name: string } | null)?.legal_name) ?? null }));
    }
    let r = supabase.from("tasks").select("id, title, project_id, projects(name)").eq("organization_id", membership!.organization_id).neq("status", "done").order("due_date", { nullsFirst: false }).limit(20);
    if (t) r = r.ilike("title", `%${t}%`);
    return ((await r).data ?? []).map((x) => ({ id: x.id as string, title: x.title as string, subtitle: (x.projects as unknown as { name: string } | null)?.name ?? null }));
  } });
  return (
    <Modal open onClose={onClose} title="Compartilhar na conversa">
      <div className="grid gap-3">
        <Segmented value={kind} onChange={setKind} items={[{ value: "project", label: "Projeto" }, { value: "task", label: "Tarefa" }]} />
        <Input aria-label="Buscar" placeholder={kind === "project" ? "Nome do projeto" : "Nome da tarefa"} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        <ul className="max-h-80 divide-y divide-border overflow-y-auto rounded-md border border-border">
          {!items.data?.length && <li className="p-3 text-sm text-fg-3">Nada encontrado.</li>}
          {items.data?.map((i) => (
            <li key={i.id}><button type="button" onClick={() => onPick({ type: kind, id: i.id, title: i.title })} className="block w-full px-3 py-2 text-left hover:bg-surface-2">
              <span className="block truncate text-sm font-medium">{i.title}</span>{i.subtitle && <span className="block truncate text-xs text-fg-3">{i.subtitle}</span>}</button></li>))}
        </ul>
      </div>
    </Modal>
  );
}

export function PeoplePicker({ selected, onToggle, multi }: { selected: string[]; onToggle: (p: Person) => void; multi?: boolean }) {
  const [q, setQ] = useState("");
  const people = useQuery({ queryKey: ["search-people", q], queryFn: async () => ((await supabase.rpc("search_people", { p_query: q })).data ?? []) as Person[] });
  return (
    <div className="grid gap-2">
      <div className="relative"><Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-fg-3" /><Input aria-label="Procurar pessoa" placeholder="Procure por @usuario ou nome" className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} autoFocus /></div>
      <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-md border border-border">
        {!people.data?.length && <li className="p-3 text-sm text-fg-3">{people.isLoading ? "Procurando…" : "Ninguém encontrado na sua equipe."}</li>}
        {people.data?.map((p) => {
          const on = selected.includes(p.id);
          return (
            <li key={p.id}><button type="button" onClick={() => onToggle(p)} aria-pressed={multi ? on : undefined} className={cn("flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface-2", on && "bg-accent-soft")}>
              <Avatar name={p.full_name || p.username} path={p.avatar_path} size={32} />
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{p.full_name || "Sem nome"}</span><span className="block truncate text-xs text-fg-3">@{p.username}{p.job_title ? ` · ${p.job_title}` : ""}</span></span>
              {multi && on && <X className="size-4 text-fg-3" />}
            </button></li>);
        })}
      </ul>
    </div>
  );
}

function NewChatModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const toast = useToast();
  const [mode, setMode] = useState<"direct" | "group">("direct");
  const [sel, setSel] = useState<Person[]>([]);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const start = async (p?: Person) => {
    setBusy(true);
    const r = mode === "direct" || p ? await supabase.rpc("start_direct_chat", { p_user: (p ?? sel[0]).id }) : await supabase.rpc("create_group_chat", { p_title: title.trim(), p_users: sel.map((x) => x.id) });
    setBusy(false);
    if (r.error) toast({ tone: "error", message: /not_same_team/.test(r.error.message) ? "Essa pessoa não faz parte da sua equipe." : errorMessage(r.error) });
    else onCreated(r.data as string);
  };
  return (
    <Modal open onClose={onClose} title="Nova conversa"
      footer={mode === "group" ? <><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={busy} disabled={!sel.length || !title.trim()} onClick={() => start()}>Criar grupo</Button></> : undefined}>
      <div className="grid gap-3">
        <Segmented value={mode} onChange={(v) => { setMode(v); setSel([]); }} items={[{ value: "direct", label: "Com uma pessoa" }, { value: "group", label: "Grupo" }]} />
        {mode === "group" && <Field label="Nome do grupo" required htmlFor="cg-title"><Input id="cg-title" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Rebranding Arara" /></Field>}
        {mode === "group" && sel.length > 0 && <p className="text-xs text-fg-3">{sel.length} pessoa(s): {sel.map((p) => `@${p.username}`).join(", ")}</p>}
        <PeoplePicker multi={mode === "group"} selected={sel.map((p) => p.id)} onToggle={(p) => mode === "direct" ? start(p) : setSel((s) => s.some((x) => x.id === p.id) ? s.filter((x) => x.id !== p.id) : [...s, p])} />
        {mode === "direct" && <p className="text-xs text-fg-3">Clique na pessoa para abrir a conversa. Dica: o seu @usuario fica em Meu perfil.</p>}
      </div>
    </Modal>
  );
}

export function chatTotalUnread(threads?: Thread[]) { return (threads ?? []).reduce((n, t) => n + Number(t.unread || 0), 0); }
