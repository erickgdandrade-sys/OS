import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowUp, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, Card, EmptyState, PageHeader, Textarea, cn, useToast } from "@/components/ui";
import { useOrg } from "@/features/auth/AuthProvider";
import { errorMessage } from "@/lib/domain";
import { dateTime } from "@/lib/format";
import { supabase } from "@/lib/supabase";

/* Assistentes do ANDRA&GO OS: Andrade cuida das tarefas, Gomes da plataforma.
   As respostas vêm da Edge Function `assistant`, que consulta os dados com as
   permissões da própria pessoa. A chave da IA fica só no servidor. */
type Who = "andrade" | "gomes";
type Msg = { id: string; role: "user" | "assistant"; content: string; created_at: string; actions?: { summary: string; link?: string }[] };
const persona: Record<Who, { name: string; role: string; intro: string; suggestions: string[] }> = {
  andrade: { name: "Andrade", role: "Tarefas", intro: "Organizo seu dia, priorizo, divido trabalho em etapas e crio ou atualizo tarefas para você.",
    suggestions: ["O que eu tenho para hoje?", "Quais tarefas minhas estão atrasadas?", "Crie uma tarefa de revisão do manual da marca para sexta", "Me ajude a priorizar a semana"] },
  gomes: { name: "Gomes", role: "Plataforma", intro: "Explico onde fica cada coisa e respondo sobre clientes, projetos, propostas, pendências, agenda e financeiro.",
    suggestions: ["Como gero um contrato para um cliente novo?", "O que os clientes ainda precisam enviar?", "Quais propostas estão em negociação?", "Resuma como está o estúdio este mês"] },
};

export function AssistantPage() {
  const { orgId } = useOrg();
  const toast = useToast();
  const [who, setWho] = useState<Who>("andrade");
  const [conv, setConv] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [notConfigured, setNotConfigured] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const justCreated = useRef<string | null>(null);
  const convs = useQuery({ queryKey: ["ai-conversations", orgId, who], queryFn: async () =>
    (await supabase.from("ai_conversations").select("id, title, updated_at").eq("organization_id", orgId).eq("assistant", who).order("updated_at", { ascending: false }).limit(30)).data ?? [] });
  useEffect(() => { setConv(null); setMsgs([]); }, [who]);
  useEffect(() => {
    if (!conv || justCreated.current === conv) return;
    supabase.from("ai_messages").select("id, role, content, created_at, actions").eq("conversation_id", conv).order("created_at").then(({ data }) => setMsgs((data ?? []) as Msg[]));
  }, [conv]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs, busy]);

  const send = async (raw?: string) => {
    const m = (raw ?? text).trim();
    if (!m || busy) return;
    setText(""); setBusy(true);
    setMsgs((x) => [...x, { id: `tmp-${Date.now()}`, role: "user", content: m, created_at: new Date().toISOString() }]);
    const { data, error } = await supabase.functions.invoke("assistant", { body: { assistant: who, organization_id: orgId, conversation_id: conv, message: m } });
    setBusy(false);
    if (error) {
      let code = error.message;
      try { code = (await (error as { context?: Response }).context?.json())?.error ?? code; } catch { /* */ }
      if (code === "ai_not_configured") { setNotConfigured(true); setMsgs((x) => x.slice(0, -1)); setText(m); return; }
      toast({ tone: "error", message: code === "forbidden" ? "Seu perfil não tem acesso aos assistentes." : errorMessage(code) });
      setMsgs((x) => x.slice(0, -1)); setText(m); return;
    }
    const r = data as { conversation_id: string; reply: string; actions: Msg["actions"] };
    if (!conv) { justCreated.current = r.conversation_id; setConv(r.conversation_id); convs.refetch(); }
    setMsgs((x) => [...x, { id: `a-${Date.now()}`, role: "assistant", content: r.reply, created_at: new Date().toISOString(), actions: r.actions }]);
  };
  const p = persona[who];
  return (
    <div>
      <PageHeader title="Assistentes" description={<>Dois assistentes, <span className="voice text-[1.05em]">duas perspectivas</span>: o Andrade cuida das tarefas e o Gomes, da plataforma.</>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        {(Object.keys(persona) as Who[]).map((k) => (
          <button key={k} type="button" onClick={() => setWho(k)} aria-pressed={who === k}
            className={cn("rounded-lg border p-4 text-left transition-colors", who === k ? "border-accent bg-accent-soft" : "border-border bg-surface hover:bg-surface-2")}>
            <p className="text-lg font-semibold tracking-tight">{persona[k].name} <span className="voice text-base font-normal text-fg-3">· {persona[k].role}</span></p>
            <p className="mt-1 text-sm text-fg-2">{persona[k].intro}</p>
          </button>))}
      </div>
      {notConfigured && (
        <Card className="mb-4 border-warning/40">
          <p className="text-sm font-medium">Os assistentes ainda não estão ligados.</p>
          <p className="mt-1 text-sm text-fg-2">O administrador precisa cadastrar a chave da IA no Supabase (Edge Functions → Secrets → <code>LLM_API_KEY</code>, com uma chave da Anthropic). A chave fica só no servidor e nunca aparece no navegador.</p>
        </Card>
      )}
      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        <Card className="h-fit" padded={false}>
          <div className="p-3"><Button className="w-full" icon={<Plus className="size-4" />} onClick={() => { setConv(null); setMsgs([]); }}>Nova conversa</Button></div>
          <ul className="max-h-[60vh] overflow-y-auto border-t border-border">
            {(convs.data ?? []).map((c) => (
              <li key={c.id}><button type="button" onClick={() => setConv(c.id)} className={cn("block w-full truncate px-3 py-2 text-left text-sm hover:bg-surface-2", conv === c.id && "bg-surface-2 font-medium")}>
                {c.title || "Conversa"}<span className="block text-[11px] font-normal text-fg-3">{dateTime(c.updated_at)}</span></button></li>))}
            {!convs.data?.length && <li className="px-3 py-3 text-xs text-fg-3">Nenhuma conversa ainda.</li>}
          </ul>
        </Card>
        <Card className="flex min-h-[60vh] flex-col" padded={false}>
          <div className="flex-1 space-y-4 overflow-y-auto p-5" aria-live="polite">
            {!msgs.length ? (
              <div className="grid gap-4">
                <EmptyState title={`Fale com o ${p.name}`} description={p.intro} />
                <div className="flex flex-wrap justify-center gap-2">{p.suggestions.map((s) => <button key={s} type="button" onClick={() => send(s)} className="rounded-full border border-border px-3 py-1.5 text-sm hover:border-accent hover:text-accent">{s}</button>)}</div>
              </div>
            ) : msgs.map((m) => (
              <div key={m.id} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                <div className={cn("max-w-[80%] rounded-lg px-4 py-2.5 text-sm", m.role === "user" ? "bg-ink text-paper dark:bg-surface-3 dark:text-fg" : "bg-surface-2")}>
                  {m.role === "assistant" && <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-fg-3">{p.name}</p>}
                  <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>
                  {!!m.actions?.length && <ul className="mt-2 grid gap-1 border-t border-border pt-2">{m.actions.map((a, i) => (
                    <li key={i} className="text-xs">✓ {a.link ? <Link to={a.link} className="text-accent hover:underline">{a.summary}</Link> : a.summary}</li>))}</ul>}
                </div>
              </div>))}
            {busy && <p className="text-sm text-fg-3"><span className="voice">{p.name} está pensando…</span></p>}
            <div ref={endRef} />
          </div>
          <form className="flex items-end gap-2 border-t border-border p-3" onSubmit={(e) => { e.preventDefault(); send(); }}>
            <Textarea aria-label={`Mensagem para o ${p.name}`} rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder={`Pergunte ao ${p.name}…`}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} className="flex-1 resize-none" />
            <Button type="submit" variant="primary" aria-label="Enviar" loading={busy} icon={<ArrowUp className="size-4" />} />
          </form>
        </Card>
      </div>
      <p className="mt-3 text-xs text-fg-3">Os assistentes veem apenas o que você pode ver no sistema e podem errar. Confira antes de enviar algo ao cliente.</p>
    </div>
  );
}
