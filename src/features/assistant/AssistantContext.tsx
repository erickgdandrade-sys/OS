import { Link, useRouterState } from "@tanstack/react-router";
import { ArrowUp, Maximize2, Minus, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, Textarea, cn, useToast } from "@/components/ui";
import { useAuth } from "@/features/auth/AuthProvider";
import { errorMessage } from "@/lib/domain";
import { supabase } from "@/lib/supabase";
import { AssistantAvatar, AssistantFace, type FaceState, type Who } from "./AssistantFace";

/* Estado dos assistentes compartilhado pelo app inteiro: a página
   /assistentes e o mini chat que acompanha a pessoa pelas outras telas
   usam a mesma conversa. As mensagens vivem no banco (ai_messages); aqui
   só guardamos qual assistente e qual conversa estão abertos nesta aba. */
export type Msg = { id: string; role: "user" | "assistant"; content: string; created_at: string; actions?: { summary: string; link?: string }[] };
type Thread = { conv: string | null; msgs: Msg[]; busy: boolean; face: FaceState };
type Ctx = {
  active: Who | null; threads: Record<Who, Thread>; notConfigured: boolean; minimized: boolean;
  send: (who: Who, text: string) => Promise<boolean>; openConversation: (who: Who, conv: string | null) => void;
  activate: (who: Who) => void; dismiss: () => void; setMinimized: (v: boolean) => void;
};
const AssistantCtx = createContext<Ctx | null>(null);
export const useAssistants = () => { const c = useContext(AssistantCtx); if (!c) throw new Error("AssistantProvider ausente"); return c; };
export const assistantName: Record<Who, string> = { andrade: "Andrade", gomes: "Gomes" };

const KEY = "ag-assistant";
const empty = (): Thread => ({ conv: null, msgs: [], busy: false, face: "idle" });
const readSaved = (): { active: Who | null; conv: Partial<Record<Who, string | null>> } => {
  try { const v = JSON.parse(sessionStorage.getItem(KEY) ?? "null"); if (v && (v.active === null || v.active === "andrade" || v.active === "gomes")) return v; } catch { /* sem storage */ }
  return { active: null, conv: {} };
};

export function AssistantProvider({ children }: { children: ReactNode }) {
  const { membership, can } = useAuth();
  const orgId = membership?.organization_id;
  const toast = useToast();
  const saved = useRef(readSaved());
  const [active, setActive] = useState<Who | null>(saved.current.active);
  const [minimized, setMinimized] = useState(true);
  const [notConfigured, setNotConfigured] = useState(false);
  const [threads, setThreads] = useState<Record<Who, Thread>>({ andrade: { ...empty(), conv: saved.current.conv.andrade ?? null }, gomes: { ...empty(), conv: saved.current.conv.gomes ?? null } });
  const patch = useCallback((who: Who, p: Partial<Thread> | ((t: Thread) => Partial<Thread>)) =>
    setThreads((s) => ({ ...s, [who]: { ...s[who], ...(typeof p === "function" ? p(s[who]) : p) } })), []);

  useEffect(() => {
    try { sessionStorage.setItem(KEY, JSON.stringify({ active, conv: { andrade: threads.andrade.conv, gomes: threads.gomes.conv } })); } catch { /* sem storage */ }
  }, [active, threads.andrade.conv, threads.gomes.conv]);

  const load = useCallback(async (who: Who, conv: string) => {
    const { data } = await supabase.from("ai_messages").select("id, role, content, created_at, actions").eq("conversation_id", conv).order("created_at");
    patch(who, { msgs: (data ?? []) as Msg[] });
  }, [patch]);
  // Ao recarregar a página, recupera as conversas que estavam abertas.
  useEffect(() => {
    (["andrade", "gomes"] as Who[]).forEach((w) => { const c = saved.current.conv[w]; if (c) load(w, c); });
  }, [load]);

  const openConversation = useCallback((who: Who, conv: string | null) => {
    patch(who, { conv, msgs: [], face: "idle" });
    if (conv) load(who, conv);
  }, [load, patch]);

  const doneTimer = useRef<Record<Who, number | undefined>>({ andrade: undefined, gomes: undefined });
  const send = useCallback(async (who: Who, raw: string) => {
    const m = raw.trim();
    if (!m || !orgId || threads[who].busy) return false;
    setActive(who);
    patch(who, (t) => ({ busy: true, face: "working", msgs: [...t.msgs, { id: `tmp-${Date.now()}`, role: "user", content: m, created_at: new Date().toISOString() }] }));
    const { data, error } = await supabase.functions.invoke("assistant", { body: { assistant: who, organization_id: orgId, conversation_id: threads[who].conv, message: m } });
    if (error) {
      let code = error.message;
      try { code = (await (error as { context?: Response }).context?.json())?.error ?? code; } catch { /* */ }
      patch(who, (t) => ({ busy: false, face: "idle", msgs: t.msgs.slice(0, -1) }));
      if (code === "ai_not_configured") setNotConfigured(true);
      else toast({ tone: "error", message: code === "forbidden" ? "Seu perfil não tem acesso aos assistentes." : errorMessage(code) });
      return false;
    }
    const r = data as { conversation_id: string; reply: string; actions: Msg["actions"] };
    patch(who, (t) => ({ conv: r.conversation_id, busy: false, face: "done",
      msgs: [...t.msgs, { id: `a-${Date.now()}`, role: "assistant", content: r.reply, created_at: new Date().toISOString(), actions: r.actions }] }));
    window.clearTimeout(doneTimer.current[who]);
    doneTimer.current[who] = window.setTimeout(() => patch(who, { face: "idle" }), 2600);
    return true;
  }, [orgId, patch, threads, toast]);

  const value = useMemo<Ctx>(() => ({
    active, threads, notConfigured, minimized, send, openConversation,
    activate: (w) => setActive(w), dismiss: () => { setActive(null); setMinimized(true); }, setMinimized,
  }), [active, threads, notConfigured, minimized, send, openConversation]);

  return (
    <AssistantCtx.Provider value={value}>
      {children}
      {can("ai.use") && <MiniChat />}
    </AssistantCtx.Provider>
  );
}

/* ------------------------------------------------------------ Mini chat */
function MiniChat() {
  const { active, threads, minimized, setMinimized, send, dismiss, notConfigured } = useAssistants();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const t = active ? threads[active] : null;
  useEffect(() => { if (!minimized) endRef.current?.scrollIntoView({ block: "end" }); }, [t?.msgs.length, t?.busy, minimized]);
  // Na própria página dos assistentes o chat já está na tela.
  if (!active || !t || path.endsWith("/assistentes")) return null;
  const name = assistantName[active];
  const submit = async () => { const m = text; setText(""); if (!(await send(active, m))) setText(m); };

  if (minimized) {
    return (
      <button type="button" onClick={() => setMinimized(false)} aria-label={`Abrir conversa com o ${name}`}
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full border border-border bg-surface py-1.5 pl-1.5 pr-4 shadow-lg animate-pop hover:border-accent print:hidden">
        <AssistantAvatar who={active} state={t.face} size={44} />
        <span className="text-left leading-tight"><span className="block text-sm font-semibold">{name}</span>
          <span className="block text-[11px] text-fg-3">{t.busy ? "trabalhando…" : t.face === "done" ? "respondeu" : "por aqui"}</span></span>
      </button>
    );
  }
  return (
    <section aria-label={`Conversa com o ${name}`} className="fixed bottom-5 right-5 z-40 flex h-[min(560px,calc(100dvh-6rem))] w-[min(380px,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-lg animate-pop print:hidden">
      <header className="flex items-center gap-3 border-b border-border bg-ink px-3 py-2.5 text-paper">
        <AssistantAvatar who={active} state={t.face} size={36} className={active === "andrade" ? "bg-white/10" : undefined} />
        <div className="min-w-0 flex-1 leading-tight"><p className="text-sm font-semibold">{name}</p><p className="voice text-[13px] text-white/60">{active === "andrade" ? "tarefas" : "plataforma"}{t.busy && " · trabalhando…"}</p></div>
        <Link to="/assistentes" aria-label="Abrir em tela cheia" className="rounded p-1.5 text-white/70 hover:bg-white/10 hover:text-white"><Maximize2 className="size-4" /></Link>
        <button type="button" aria-label="Minimizar" onClick={() => setMinimized(true)} className="rounded p-1.5 text-white/70 hover:bg-white/10 hover:text-white"><Minus className="size-4" /></button>
        <button type="button" aria-label="Fechar assistente" onClick={dismiss} className="rounded p-1.5 text-white/70 hover:bg-white/10 hover:text-white"><X className="size-4" /></button>
      </header>
      <div className="flex-1 space-y-3 overflow-y-auto p-3" aria-live="polite">
        {notConfigured && <p className="rounded-md bg-warning-soft p-2 text-xs text-warning">Os assistentes ainda não estão ligados: o administrador precisa cadastrar a chave da IA (LLM_API_KEY) no Supabase.</p>}
        {!t.msgs.length && <p className="pt-6 text-center text-sm text-fg-3">Pergunte algo ao {name}. Ele acompanha você enquanto navega.</p>}
        {t.msgs.map((m) => (
          <div key={m.id} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div className={cn("max-w-[85%] rounded-lg px-3 py-2 text-[13px]", m.role === "user" ? "bg-ink text-paper dark:bg-surface-3 dark:text-fg" : "bg-surface-2")}>
              <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>
              {!!m.actions?.length && <ul className="mt-1.5 grid gap-0.5 border-t border-border pt-1.5">{m.actions.map((a, i) => (
                <li key={i} className="text-[11px]">✓ {a.link ? <Link to={a.link} className="text-accent hover:underline">{a.summary}</Link> : a.summary}</li>))}</ul>}
            </div>
          </div>))}
        {t.busy && <div className="flex items-center gap-2 text-fg-3"><AssistantFace who={active} state="working" className="text-sm" /><span className="voice text-sm">pensando…</span></div>}
        <div ref={endRef} />
      </div>
      <form className="flex items-end gap-2 border-t border-border p-2" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Textarea aria-label={`Mensagem para o ${name}`} rows={1} value={text} onChange={(e) => setText(e.target.value)} placeholder={`Pergunte ao ${name}…`} className="max-h-28 flex-1 resize-none text-sm"
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }} />
        <Button type="submit" size="sm" variant="primary" aria-label="Enviar" loading={t.busy} icon={<ArrowUp className="size-4" />} className="h-9 w-9 px-0" />
      </form>
    </section>
  );
}
