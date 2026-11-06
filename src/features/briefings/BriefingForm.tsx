import { useMemo, useState } from "react";
import { Button, Field, Input, Select, Textarea, cn, useToast } from "@/components/ui";
import { errorMessage } from "@/lib/domain";

/* Formulário de briefing usado pelo cliente (link do projeto e link avulso)
   e em modo leitura pela equipe. As perguntas vêm do JSON salvo no briefing. */
export type BriefingQuestion = { id: string; label: string; type: "text" | "textarea" | "choice" | "multi" | "date" | "number" | "url"; required?: boolean; help?: string; options?: string[] };
export type BriefingSection = { title: string; description?: string; questions: BriefingQuestion[] };
export type Answers = Record<string, string | string[]>;

export const briefingStatusLabel: Record<string, string> = { draft: "Rascunho", sent: "Enviado", in_progress: "Em preenchimento", answered: "Respondido", reviewed: "Revisado" };
export const briefingStatusTone: Record<string, "neutral" | "info" | "warning" | "success" | "accent"> = { draft: "neutral", sent: "info", in_progress: "warning", answered: "success", reviewed: "accent" };

const isEmpty = (v: unknown) => v == null || (Array.isArray(v) ? v.length === 0 : String(v).trim() === "");

export function missingRequired(sections: BriefingSection[], answers: Answers) {
  return sections.flatMap((s) => s.questions.filter((q) => q.required && isEmpty(answers[q.id])));
}

export function BriefingAnswersView({ sections, answers }: { sections: BriefingSection[]; answers: Answers }) {
  return (
    <div className="grid gap-6">
      {sections.map((s, i) => (
        <section key={i}>
          <h3 className="mb-2 text-sm font-semibold">{s.title}</h3>
          <dl className="grid gap-3">
            {s.questions.map((q) => {
              const v = answers[q.id];
              return (
                <div key={q.id}>
                  <dt className="text-xs text-fg-3">{q.label}</dt>
                  <dd className={cn("whitespace-pre-wrap text-sm", isEmpty(v) && "text-fg-3")}>{isEmpty(v) ? "Sem resposta" : Array.isArray(v) ? v.join(", ") : v}</dd>
                </div>
              );
            })}
          </dl>
        </section>
      ))}
    </div>
  );
}

export function BriefingFill({ sections, initial, initialName, intro, onSave }: {
  sections: BriefingSection[]; initial: Answers; initialName?: string | null; intro?: string | null;
  onSave: (answers: Answers, final: boolean, name: string) => Promise<void>;
}) {
  const toast = useToast();
  const [answers, setAnswers] = useState<Answers>(initial ?? {});
  const [name, setName] = useState(initialName ?? "");
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState<"draft" | "final" | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const missing = useMemo(() => new Set(missingRequired(sections, answers).map((q) => q.id)), [sections, answers]);
  const set = (id: string, v: string | string[]) => setAnswers((a) => ({ ...a, [id]: v }));
  const s = sections[step];
  const answered = sections.flatMap((x) => x.questions).filter((q) => !isEmpty(answers[q.id])).length;
  const total = sections.reduce((n, x) => n + x.questions.length, 0);

  const save = async (final: boolean) => {
    if (final) {
      if (missing.size) {
        setShowErrors(true);
        const first = sections.findIndex((x) => x.questions.some((q) => missing.has(q.id)));
        if (first >= 0) setStep(first);
        toast({ tone: "error", message: `Faltam ${missing.size} resposta(s) obrigatória(s).` }); return;
      }
      if (name.trim().length < 3) { toast({ tone: "error", message: "Informe seu nome completo para enviar." }); return; }
    }
    setBusy(final ? "final" : "draft");
    try { await onSave(answers, final, name.trim()); toast({ tone: "success", message: final ? "Briefing enviado. Obrigado!" : "Respostas salvas. Você pode continuar depois." }); }
    catch (e) { toast({ tone: "error", message: errorMessage(e) }); }
    finally { setBusy(null); }
  };

  return (
    <div className="grid gap-5">
      {intro && step === 0 && <p className="whitespace-pre-wrap rounded-lg bg-surface-2 p-3 text-sm">{intro}</p>}
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Seções do briefing">
        {sections.map((x, i) => {
          const bad = showErrors && x.questions.some((q) => missing.has(q.id));
          return <button key={i} type="button" role="tab" aria-selected={i === step} onClick={() => setStep(i)}
            className={cn("rounded-full px-3 py-1 text-xs ring-1 ring-inset", i === step ? "bg-accent text-white ring-accent" : "ring-border hover:bg-surface-2", bad && i !== step && "ring-danger text-danger")}>{i + 1}. {x.title}</button>;
        })}
      </div>
      <p className="text-xs text-fg-3">{answered} de {total} perguntas respondidas</p>
      {s && (
        <div className="grid gap-4">
          {s.description && <p className="text-sm text-fg-3">{s.description}</p>}
          {s.questions.map((q) => {
            const id = `bq-${q.id}`; const v = answers[q.id];
            const err = showErrors && missing.has(q.id) ? "Resposta obrigatória." : undefined;
            return (
              <Field key={q.id} label={q.label} required={q.required} htmlFor={id} hint={q.help} error={err}>
                {q.type === "textarea" ? <Textarea id={id} rows={4} value={(v as string) ?? ""} onChange={(e) => set(q.id, e.target.value)} />
                  : q.type === "choice" ? (
                    <Select id={id} value={(v as string) ?? ""} onChange={(e) => set(q.id, e.target.value)}>
                      <option value="">Selecione…</option>{q.options?.map((o) => <option key={o} value={o}>{o}</option>)}
                    </Select>)
                  : q.type === "multi" ? (
                    <div id={id} className="flex flex-wrap gap-2" role="group">
                      {q.options?.map((o) => {
                        const arr = Array.isArray(v) ? v : []; const on = arr.includes(o);
                        return <button key={o} type="button" aria-pressed={on} onClick={() => set(q.id, on ? arr.filter((x) => x !== o) : [...arr, o])}
                          className={cn("rounded-full px-3 py-1 text-xs ring-1 ring-inset", on ? "bg-accent/10 text-accent ring-accent" : "ring-border hover:bg-surface-2")}>{o}</button>;
                      })}
                    </div>)
                  : <Input id={id} type={q.type === "date" ? "date" : q.type === "number" ? "number" : q.type === "url" ? "url" : "text"} value={(v as string) ?? ""} onChange={(e) => set(q.id, e.target.value)} />}
              </Field>
            );
          })}
        </div>
      )}
      <div className="grid gap-3 border-t border-border pt-4 sm:grid-cols-[1fr_auto] sm:items-end">
        <Field label="Seu nome completo" htmlFor="bq-name" hint="Fica registrado junto com as respostas."><Input id="bq-name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <div className="flex flex-wrap gap-2">
          {step > 0 && <Button variant="ghost" onClick={() => setStep(step - 1)}>Voltar</Button>}
          <Button loading={busy === "draft"} onClick={() => save(false)}>Salvar e continuar depois</Button>
          {step < sections.length - 1 ? <Button variant="primary" onClick={() => setStep(step + 1)}>Próxima seção</Button>
            : <Button variant="primary" loading={busy === "final"} onClick={() => save(true)}>Enviar briefing</Button>}
        </div>
      </div>
    </div>
  );
}
