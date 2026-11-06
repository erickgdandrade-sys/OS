import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowUp, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, Card, PageHeader, Textarea, cn } from "@/components/ui";
import { useOrg } from "@/features/auth/AuthProvider";
import { dateTime } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { assistantName, useAssistants } from "./AssistantContext";
import { AssistantAvatar, AssistantFace, type Who } from "./AssistantFace";

/* Assistentes do ANDRA&GO OS: Andrade cuida das tarefas, Gomes da plataforma.
   A conversa é a mesma do mini chat que acompanha a pessoa pelas outras telas. */
const persona: Record<Who, { role: string; intro: string; suggestions: string[] }> = {
  andrade: { role: "tarefas", intro: "Organizo seu dia, priorizo, divido trabalho em etapas e crio ou atualizo tarefas para você.",
    suggestions: ["O que eu tenho para hoje?", "Quais tarefas minhas estão atrasadas?", "Crie uma tarefa de revisão do manual da marca para sexta", "Me ajude a priorizar a semana"] },
  gomes: { role: "plataforma", intro: "Explico onde fica cada coisa e respondo sobre clientes, projetos, propostas, pendências, agenda e financeiro.",
    suggestions: ["Como gero um contrato para um cliente novo?", "O que os clientes ainda precisam enviar?", "Quais propostas estão em negociação?", "Resuma como está o estúdio este mês"] },
};

export function AssistantPage() {
  const { orgId } = useOrg();
  const { active, activate, threads, send, openConversation, notConfigured, setMinimized } = useAssistants();
  const [who, setWho] = useState<Who>(active ?? "andrade");
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const t = threads[who];
  const convs = useQuery({ queryKey: ["ai-conversations", orgId, who, t.conv], queryFn: async () =>
    (await supabase.from("ai_conversations").select("id, title, updated_at").eq("organization_id", orgId).eq("assistant", who).order("updated_at", { ascending: false }).limit(30)).data ?? [] });
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [t.msgs.length, t.busy]);
  const pick = (w: Who) => { setWho(w); activate(w); setMinimized(true); };
  const submit = async (raw?: string) => { const m = raw ?? text; setText(""); if (!(await send(who, m))) setText(m); };
  const p = persona[who];
  const name = assistantName[who];
  return (
    <div>
      <PageHeader title="Assistentes" description={<>Dois assistentes, <span className="voice text-[1.05em]">duas perspectivas</span>: o Andrade cuida das tarefas e o Gomes, da plataforma. Depois de conversar, eles acompanham você num mini chat no canto da tela.</>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        {(["andrade", "gomes"] as Who[]).map((k) => (
          <button key={k} type="button" onClick={() => pick(k)} aria-pressed={who === k}
            className={cn("flex items-center gap-4 rounded-lg border p-4 text-left transition-colors", who === k ? "border-accent bg-accent-soft" : "border-border bg-surface hover:bg-surface-2")}>
            <AssistantAvatar who={k} state={threads[k].face} size={64} />
            <span><span className="block text-lg font-semibold tracking-tight">{assistantName[k]} <span className="voice text-base font-normal text-fg-3">· {persona[k].role}</span></span>
              <span className="mt-1 block text-sm text-fg-2">{persona[k].intro}</span></span>
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
          <div className="p-3"><Button className="w-full" icon={<Plus className="size-4" />} onClick={() => openConversation(who, null)}>Nova conversa</Button></div>
          <ul className="max-h-[60vh] overflow-y-auto border-t border-border">
            {(convs.data ?? []).map((c) => (
              <li key={c.id}><button type="button" onClick={() => { openConversation(who, c.id); activate(who); }} className={cn("block w-full truncate px-3 py-2 text-left text-sm hover:bg-surface-2", t.conv === c.id && "bg-surface-2 font-medium")}>
                {c.title || "Conversa"}<span className="block text-[11px] font-normal text-fg-3">{dateTime(c.updated_at)}</span></button></li>))}
            {!convs.data?.length && <li className="px-3 py-3 text-xs text-fg-3">Nenhuma conversa ainda.</li>}
          </ul>
        </Card>
        <Card className="flex min-h-[60vh] flex-col" padded={false}>
          <div className="flex-1 space-y-4 overflow-y-auto p-5" aria-live="polite">
            {!t.msgs.length ? (
              <div className="grid justify-items-center gap-4 py-8 text-center">
                <AssistantAvatar who={who} state={t.face} size={96} />
                <div><p className="text-base font-semibold">Fale com o {name}</p><p className="mt-1 max-w-md text-sm text-fg-3">{p.intro}</p></div>
                <div className="flex flex-wrap justify-center gap-2">{p.suggestions.map((s) => <button key={s} type="button" onClick={() => submit(s)} className="rounded-full border border-border px-3 py-1.5 text-sm hover:border-accent hover:text-accent">{s}</button>)}</div>
              </div>
            ) : t.msgs.map((m) => (
              <div key={m.id} className={cn("flex gap-2", m.role === "user" ? "justify-end" : "justify-start")}>
                {m.role === "assistant" && <AssistantAvatar who={who} size={32} animate={false} className="mt-1" />}
                <div className={cn("max-w-[80%] rounded-lg px-4 py-2.5 text-sm", m.role === "user" ? "bg-ink text-paper dark:bg-surface-3 dark:text-fg" : "bg-surface-2")}>
                  <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>
                  {!!m.actions?.length && <ul className="mt-2 grid gap-1 border-t border-border pt-2">{m.actions.map((a, i) => (
                    <li key={i} className="text-xs">✓ {a.link ? <Link to={a.link} className="text-accent hover:underline">{a.summary}</Link> : a.summary}</li>))}</ul>}
                </div>
              </div>))}
            {t.busy && <div className="flex items-center gap-2 text-fg-3"><AssistantFace who={who} state="working" className="text-base" /><span className="voice text-sm">{name} está trabalhando…</span></div>}
            <div ref={endRef} />
          </div>
          <form className="flex items-end gap-2 border-t border-border p-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <Textarea aria-label={`Mensagem para o ${name}`} rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder={`Pergunte ao ${name}…`}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }} className="flex-1 resize-none" />
            <Button type="submit" variant="primary" aria-label="Enviar" loading={t.busy} icon={<ArrowUp className="size-4" />} />
          </form>
        </Card>
      </div>
      <p className="mt-3 text-xs text-fg-3">Os assistentes veem apenas o que você pode ver no sistema e podem errar. Confira antes de enviar algo ao cliente.</p>
    </div>
  );
}
