import { CheckCircle2, ClipboardList, FileText, Image as ImageIcon, KeyRound, Link2, MessageSquareText, Paperclip, Shapes, ThumbsUp, Upload } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { Badge, Button, Card, Field, Input, Modal, Progress, Textarea, cn, useToast } from "@/components/ui";
import { BriefingAnswersView, BriefingFill, type Answers, type BriefingSection } from "@/features/briefings/BriefingForm";
import { errorMessage } from "@/lib/domain";
import { date, dateTime } from "@/lib/format";
import { supabase } from "@/lib/supabase";

/* "O que precisamos de você" — tudo que depende do cliente no projeto:
   pedidos (referências, conteúdos, documentos, acessos, informações),
   briefings, aprovações e seleção de fotos. Dados e ações passam pela
   Edge Function `portal`, que valida o link a cada chamada. */

export type ClientRequestKind = "reference" | "content" | "document" | "access" | "information" | "other";
export const requestKindLabel: Record<ClientRequestKind, string> = {
  reference: "Referências", content: "Conteúdo", document: "Documento ou arquivo", access: "Acesso", information: "Informação", other: "Outro",
};
export const requestStatusLabel: Record<string, string> = { open: "Pendente", answered: "Enviado", done: "Concluído", cancelled: "Cancelado" };
export const requestKindIcon: Record<ClientRequestKind, ReactNode> = {
  reference: <Shapes className="size-4" />, content: <FileText className="size-4" />, document: <Paperclip className="size-4" />,
  access: <KeyRound className="size-4" />, information: <MessageSquareText className="size-4" />, other: <ClipboardList className="size-4" />,
};

export type PortalRequest = { id: string; kind: ClientRequestKind; title: string; description: string | null; due_date: string | null; is_required: boolean; status: string;
  response_text: string | null; response_links: string[]; responded_label: string | null; responded_at: string | null; files: { id: string; name: string; size_bytes: number; created_at: string }[] };
export type PortalBriefing = { id: string; title: string; intro_message: string | null; sections: BriefingSection[]; answers: Answers; status: string; submitted_at: string | null; respondent_name: string | null };
export type PortalGallery = { id: string; title: string; kind: string; starts_at: string | null; selected: number; items: { id: string; name: string; selected: boolean; thumb: string | null; url: string | null }[] };
export type ClientActionsData = { pending: number; requests: PortalRequest[]; briefings: PortalBriefing[]; approvals: { id: string; title: string; description: string | null; version: number; due_date: string | null }[]; galleries: PortalGallery[] };

type Call = (body: Record<string, unknown>) => Promise<unknown>;

const fmtSize = (n: number) => n > 1048576 ? `${(n / 1048576).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

function Row({ icon, title, meta, status, children, done }: { icon: ReactNode; title: string; meta?: ReactNode; status: ReactNode; children?: ReactNode; done?: boolean }) {
  return (
    <li className={cn("rounded-lg border border-border bg-surface p-4", done && "bg-surface-2/50")}>
      <div className="flex items-start gap-3">
        <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full", done ? "bg-success-soft text-success" : "bg-accent-soft text-accent")}>{done ? <CheckCircle2 className="size-4" /> : icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium">{title}</p>{status}</div>
          {meta && <div className="mt-0.5 text-xs text-fg-3">{meta}</div>}
          {children && <div className="mt-3">{children}</div>}
        </div>
      </div>
    </li>
  );
}

function RequestItem({ r, call, name, onChanged }: { r: PortalRequest; call: Call; name: string; onChanged: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(r.status === "open" && r.files.length === 0 && !r.response_text);
  const [text, setText] = useState(r.response_text ?? "");
  const [links, setLinks] = useState((r.response_links ?? []).join("\n"));
  const [uploading, setUploading] = useState<{ name: string; done: number; total: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const closed = r.status === "done";
  const needsName = () => { if (name.trim().length < 2) { toast({ tone: "error", message: "Informe seu nome no topo desta seção antes de responder." }); return true; } return false; };

  const upload = async (files: FileList | null) => {
    if (!files?.length || needsName()) return;
    const list = [...files];
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      setUploading({ name: f.name, done: i, total: list.length });
      try {
        const u = await call({ action: "request_upload_url", request_id: r.id, file_name: f.name, size: f.size, mime_type: f.type }) as { path: string; token: string };
        const up = await supabase.storage.from("org-files").uploadToSignedUrl(u.path, u.token, f, { contentType: f.type || undefined });
        if (up.error) throw up.error;
        await call({ action: "request_upload_done", request_id: r.id, path: u.path, file_name: f.name, size: f.size });
      } catch (e) { toast({ tone: "error", message: `${f.name}: ${errorMessage(e)}` }); }
    }
    setUploading(null);
    if (fileRef.current) fileRef.current.value = "";
    toast({ tone: "success", message: list.length > 1 ? "Arquivos enviados. Clique em Enviar resposta para concluir." : "Arquivo enviado. Clique em Enviar resposta para concluir." });
    onChanged();
  };
  const send = async () => {
    if (needsName()) return;
    setBusy(true);
    try {
      await call({ action: "request_answer", request_id: r.id, text, links: links.split(/\s+/).filter(Boolean), name });
      toast({ tone: "success", message: "Resposta enviada ao estúdio. Obrigado!" }); setOpen(false); onChanged();
    } catch (e) { toast({ tone: "error", message: errorMessage(e) }); }
    finally { setBusy(false); }
  };
  const done = r.status !== "open";
  return (
    <Row icon={requestKindIcon[r.kind]} title={r.title} done={done}
      status={<><Badge tone={r.status === "open" ? "warning" : r.status === "done" ? "success" : "info"}>{requestStatusLabel[r.status]}</Badge>{r.is_required && r.status === "open" && <Badge tone="danger">Obrigatório</Badge>}</>}
      meta={<>{requestKindLabel[r.kind]}{r.due_date && <> · até {date(r.due_date)}</>}{r.responded_at && <> · respondido por {r.responded_label} em {dateTime(r.responded_at)}</>}</>}>
      {r.description && <p className="whitespace-pre-wrap text-sm text-fg-2">{r.description}</p>}
      {r.kind === "access" && <p className="mt-2 rounded-md bg-warning-soft px-3 py-2 text-xs text-warning">Por segurança, não escreva senhas aqui. Conte só quando o convite de acesso foi enviado, e o estúdio combina o resto com você.</p>}
      {(r.files.length > 0 || (done && (r.response_text || r.response_links.length > 0))) && (
        <div className="mt-3 grid gap-2 rounded-md border border-border p-3">
          {done && r.response_text && <p className="whitespace-pre-wrap text-sm">{r.response_text}</p>}
          {done && r.response_links.map((l) => <a key={l} href={l} target="_blank" rel="noreferrer noopener" className="flex items-center gap-1.5 truncate text-sm text-accent hover:underline"><Link2 className="size-3.5 shrink-0" />{l}</a>)}
          {r.files.map((f) => <p key={f.id} className="flex items-center gap-1.5 text-sm"><Paperclip className="size-3.5 shrink-0 text-fg-3" /><span className="truncate">{f.name}</span><span className="text-xs text-fg-3">{fmtSize(f.size_bytes)}</span></p>)}
        </div>
      )}
      {!closed && !open && <Button size="sm" className="mt-3" onClick={() => setOpen(true)}>{done ? "Complementar resposta" : "Responder"}</Button>}
      {!closed && open && (
        <div className="mt-3 grid gap-3">
          <Field label="Sua resposta" htmlFor={`rq-t-${r.id}`}><Textarea id={`rq-t-${r.id}`} rows={3} value={text} onChange={(e) => setText(e.target.value)} /></Field>
          <Field label="Links (um por linha)" htmlFor={`rq-l-${r.id}`} hint="Pinterest, Drive, Instagram, sites de referência…"><Textarea id={`rq-l-${r.id}`} rows={2} value={links} onChange={(e) => setLinks(e.target.value)} placeholder="https://" /></Field>
          <div className="flex flex-wrap items-center gap-2">
            <input ref={fileRef} type="file" multiple hidden onChange={(e) => upload(e.target.files)} aria-label="Escolher arquivos" />
            <Button size="sm" icon={<Upload className="size-3.5" />} loading={!!uploading} onClick={() => fileRef.current?.click()}>Anexar arquivos</Button>
            <span className="text-xs text-fg-3">Até 50 MB por arquivo: imagens, PDF, vídeos, AI/EPS/SVG, ZIP e documentos.</span>
          </div>
          {uploading && <div className="grid gap-1"><p className="text-xs text-fg-3">Enviando {uploading.name} ({uploading.done + 1} de {uploading.total})…</p><Progress value={(100 * uploading.done) / uploading.total} /></div>}
          <div className="flex gap-2"><Button variant="primary" size="sm" loading={busy} disabled={!!uploading} onClick={send}>Enviar resposta</Button>{done && <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>}</div>
        </div>
      )}
    </Row>
  );
}

function GalleryItem({ g, call }: { g: PortalGallery; call: Call }) {
  const toast = useToast();
  const [sel, setSel] = useState<Record<string, boolean>>(Object.fromEntries(g.items.map((i) => [i.id, i.selected])));
  const count = Object.values(sel).filter(Boolean).length;
  const toggle = async (id: string) => {
    const v = !sel[id]; setSel((s) => ({ ...s, [id]: v }));
    try { await call({ action: "gallery_select", asset_id: id, selected: v }); }
    catch (e) { setSel((s) => ({ ...s, [id]: !v })); toast({ tone: "error", message: errorMessage(e) }); }
  };
  return (
    <Row icon={<ImageIcon className="size-4" />} title={`Escolha as fotos: ${g.title}`} done={count > 0}
      status={<Badge tone={count ? "success" : "warning"}>{count} de {g.items.length} selecionadas</Badge>}
      meta="Toque nas fotos que você quer receber tratadas. A seleção é salva na hora.">
      {g.items.length === 0 ? <p className="text-sm text-fg-3">As fotos ainda estão sendo preparadas.</p> : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {g.items.map((i) => (
            <button key={i.id} type="button" aria-pressed={!!sel[i.id]} aria-label={`${sel[i.id] ? "Desmarcar" : "Selecionar"} ${i.name}`} onClick={() => toggle(i.id)}
              className={cn("group relative aspect-square overflow-hidden rounded-md ring-2 ring-offset-2 ring-offset-surface", sel[i.id] ? "ring-accent" : "ring-transparent")}>
              {i.thumb ? <img src={i.thumb} alt={i.name} loading="lazy" className="size-full object-cover" /> : <span className="flex size-full items-center justify-center bg-surface-2 text-xs text-fg-3">{i.name}</span>}
              {sel[i.id] && <span className="absolute right-1 top-1 rounded-full bg-accent p-0.5 text-white"><CheckCircle2 className="size-4" /></span>}
            </button>
          ))}
        </div>)}
    </Row>
  );
}

export function ClientActionsSection({ data, call, onChanged, approvalsArea }: { data: ClientActionsData; call: Call; onChanged: () => void; approvalsArea?: string }) {
  const [name, setName] = useState("");
  const [briefing, setBriefing] = useState<PortalBriefing | null>(null);
  const openReqs = data.requests.filter((r) => r.status === "open");
  const doneReqs = data.requests.filter((r) => r.status !== "open");
  const openBriefs = data.briefings.filter((b) => b.status === "sent" || b.status === "in_progress");
  const doneBriefs = data.briefings.filter((b) => b.status === "answered" || b.status === "reviewed");
  const total = data.requests.length + data.briefings.length + data.approvals.length + data.galleries.length;
  const [showDone, setShowDone] = useState(false);

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">O que precisamos de você</h2>
          <p className="text-sm text-fg-3">{data.pending ? `${data.pending} ${data.pending === 1 ? "item depende" : "itens dependem"} de você para o projeto andar.` : total ? "Tudo em dia. Obrigado!" : "Nada pendente por enquanto."}</p>
        </div>
        {data.pending > 0 && <Badge tone="warning">{data.pending} pendente{data.pending > 1 ? "s" : ""}</Badge>}
      </div>
      {total > 0 && (
        <Field label="Seu nome (registrado junto com cada resposta)" htmlFor="ca-name" className="mb-4 max-w-sm"><Input id="ca-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></Field>
      )}
      <ul className="grid gap-3">
        {openBriefs.map((b) => (
          <Row key={b.id} icon={<ClipboardList className="size-4" />} title={b.title}
            status={<Badge tone="warning">{b.status === "in_progress" ? "Em preenchimento" : "Para responder"}</Badge>}
            meta="Questionário para entendermos o projeto. Você pode salvar e continuar depois.">
            <Button size="sm" variant="primary" onClick={() => setBriefing(b)}>{b.status === "in_progress" ? "Continuar briefing" : "Responder briefing"}</Button>
          </Row>
        ))}
        {data.approvals.length > 0 && (
          <Row icon={<ThumbsUp className="size-4" />} title={`${data.approvals.length} ${data.approvals.length === 1 ? "item aguardando" : "itens aguardando"} sua aprovação`} status={<Badge tone="warning">Aprovar</Badge>}
            meta={data.approvals.map((a) => a.title).join(" · ")}>
            {approvalsArea && <a href={`#${approvalsArea}`} onClick={(e) => { e.preventDefault(); document.getElementById(approvalsArea)?.scrollIntoView({ behavior: "smooth" }); }}><Button size="sm">Ver e responder</Button></a>}
          </Row>
        )}
        {data.galleries.map((g) => <GalleryItem key={g.id} g={g} call={call} />)}
        {openReqs.map((r) => <RequestItem key={r.id} r={r} call={call} name={name} onChanged={onChanged} />)}
      </ul>
      {(doneReqs.length > 0 || doneBriefs.length > 0) && (
        <div className="mt-4">
          <button type="button" className="text-sm text-accent hover:underline" onClick={() => setShowDone(!showDone)} aria-expanded={showDone}>
            {showDone ? "Ocultar" : "Ver"} o que você já enviou ({doneReqs.length + doneBriefs.length})
          </button>
          {showDone && (
            <ul className="mt-3 grid gap-3">
              {doneBriefs.map((b) => (
                <Row key={b.id} done icon={<ClipboardList className="size-4" />} title={b.title} status={<Badge tone="success">Respondido</Badge>}
                  meta={b.submitted_at ? `Enviado por ${b.respondent_name ?? "—"} em ${dateTime(b.submitted_at)}` : undefined}>
                  <Button size="sm" variant="ghost" onClick={() => setBriefing(b)}>Ver respostas</Button>
                </Row>
              ))}
              {doneReqs.map((r) => <RequestItem key={r.id} r={r} call={call} name={name} onChanged={onChanged} />)}
            </ul>
          )}
        </div>
      )}
      <Modal open={!!briefing} onClose={() => setBriefing(null)} size="lg" title={briefing?.title ?? ""}>
        {briefing && (briefing.status === "sent" || briefing.status === "in_progress"
          ? <BriefingFill sections={briefing.sections} initial={briefing.answers} initialName={briefing.respondent_name || name} intro={briefing.intro_message}
              onSave={async (answers, final, n) => {
                await call({ action: "briefing_save", briefing_id: briefing.id, answers, final, name: n });
                if (final) { setBriefing(null); onChanged(); }
              }} />
          : <BriefingAnswersView sections={briefing.sections} answers={briefing.answers} />)}
      </Modal>
    </Card>
  );
}
