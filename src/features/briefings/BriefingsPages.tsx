import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, Copy, Link2, Plus, Printer, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Badge, Button, Card, CardHeader, ConfirmDialog, EmptyState, ErrorState, Field, Input, Modal, PageHeader, Select, Skeleton, Spinner, Tabs, Textarea, useToast } from "@/components/ui";
import { useOrg } from "@/features/auth/AuthProvider";
import { clientName } from "@/features/clients/ClientsPages";
import { categoryLabel, errorMessage, type ProjectCategory } from "@/lib/domain";
import { date, dateTime } from "@/lib/format";
import { appUrl, supabase } from "@/lib/supabase";
import { BriefingAnswersView, BriefingFill, briefingStatusLabel, briefingStatusTone, type Answers, type BriefingQuestion, type BriefingSection } from "./BriefingForm";

type BriefingRow = { id: string; title: string; status: string; category: ProjectCategory; sent_at: string | null; submitted_at: string | null; created_at: string; respondent_name: string | null;
  client_id: string; project_id: string | null; clients: { legal_name: string; trade_name: string | null } | null; projects: { name: string } | null };
type Template = { id: string; name: string; category: ProjectCategory; description: string | null; sections: BriefingSection[]; is_default: boolean; is_archived: boolean };

/* ------------------------------------------------------------------ Lista */
export function BriefingsPage() {
  const { orgId, can } = useOrg();
  const [tab, setTab] = useState<"briefings" | "templates">("briefings");
  const [creating, setCreating] = useState(false);
  const [status, setStatus] = useState("");
  const list = useQuery({ queryKey: ["briefings", orgId], queryFn: async () => {
    const { data, error } = await supabase.from("briefings").select("id, title, status, category, sent_at, submitted_at, created_at, respondent_name, client_id, project_id, clients(legal_name, trade_name), projects(name)")
      .eq("organization_id", orgId).order("created_at", { ascending: false });
    if (error) throw error; return data as unknown as BriefingRow[];
  } });
  const canWrite = can("creative.write") || can("crm.write");
  const rows = (list.data ?? []).filter((b) => !status || b.status === status);
  return (
    <div>
      <PageHeader title="Briefings" description="Questionários para os clientes responderem por link: um modelo para cada serviço do estúdio."
        actions={canWrite && tab === "briefings" && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>Novo briefing</Button>} />
      <Tabs value={tab} onChange={setTab} items={[{ value: "briefings", label: "Briefings", count: list.data?.length }, { value: "templates", label: "Modelos" }]} />
      <div className="mt-4">
        {tab === "templates" ? <TemplatesPanel /> : list.error ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : (
          <Card padded={false}>
            <div className="flex items-center gap-2 border-b border-border p-3">
              <Select aria-label="Filtrar por status" className="w-48" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">Todos os status</option>{Object.entries(briefingStatusLabel).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </Select>
            </div>
            {list.isLoading ? <div className="p-4"><Skeleton className="h-24" /></div> : !rows.length ? (
              <div className="p-4"><EmptyState title="Nenhum briefing" description="Crie um briefing a partir de um modelo e envie o link para o cliente responder." /></div>
            ) : (
              <ul className="divide-y divide-border">
                {rows.map((b) => (
                  <li key={b.id}>
                    <Link to="/briefings/$briefingId" params={{ briefingId: b.id }} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-surface-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{b.title}</p>
                        <p className="truncate text-xs text-fg-3">{b.clients ? clientName(b.clients) : "—"}{b.projects && <> · {b.projects.name}</>} · {categoryLabel[b.category]}</p>
                      </div>
                      <span className="text-xs text-fg-3">{b.submitted_at ? `Respondido em ${date(b.submitted_at)}` : b.sent_at ? `Enviado em ${date(b.sent_at)}` : `Criado em ${date(b.created_at)}`}</span>
                      <Badge tone={briefingStatusTone[b.status]}>{briefingStatusLabel[b.status]}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>
      {creating && <NewBriefingModal onClose={() => setCreating(false)} />}
    </div>
  );
}

function NewBriefingModal({ onClose }: { onClose: () => void }) {
  const { orgId, userId } = useOrg();
  const toast = useToast();
  const nav = useNavigate();
  const [f, setF] = useState({ template_id: "", client_id: "", project_id: "", intro: "" });
  const [busy, setBusy] = useState(false);
  const tpls = useQuery({ queryKey: ["briefing-templates", orgId], queryFn: async () =>
    ((await supabase.from("briefing_templates").select("id, name, category, sections").eq("organization_id", orgId).eq("is_archived", false).order("name")).data ?? []) as Template[] });
  const clients = useQuery({ queryKey: ["clients", orgId], queryFn: async () => (await supabase.from("clients").select("id, legal_name, trade_name, status").eq("organization_id", orgId).order("legal_name")).data ?? [] });
  const projects = useQuery({ queryKey: ["client-projects", f.client_id], enabled: !!f.client_id, queryFn: async () =>
    (await supabase.from("projects").select("id, name, category").eq("client_id", f.client_id).neq("status", "cancelled").order("created_at", { ascending: false })).data ?? [] });
  const create = async () => {
    const t = tpls.data?.find((x) => x.id === f.template_id);
    if (!t || !f.client_id) { toast({ tone: "error", message: "Escolha o modelo e o cliente." }); return; }
    setBusy(true);
    const { data, error } = await supabase.from("briefings").insert({ organization_id: orgId, client_id: f.client_id, project_id: f.project_id || null, template_id: t.id, title: t.name,
      category: t.category, sections: t.sections, intro_message: f.intro.trim() || null, created_by: userId }).select("id").single();
    setBusy(false);
    if (error) { toast({ tone: "error", message: errorMessage(error) }); return; }
    onClose(); nav({ to: "/briefings/$briefingId", params: { briefingId: data.id } });
  };
  return (
    <Modal open onClose={onClose} title="Novo briefing" description="Depois de criar, gere o link para o cliente ou mostre no link do projeto."
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={busy} onClick={create}>Criar briefing</Button></>}>
      <div className="grid gap-4">
        <Field label="Modelo" required htmlFor="nb-t"><Select id="nb-t" value={f.template_id} onChange={(e) => setF({ ...f, template_id: e.target.value })}>
          <option value="">Selecione…</option>{tpls.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
        <Field label="Cliente" required htmlFor="nb-c" hint={clients.data && !clients.data.length ? "Nenhum cliente cadastrado ainda. Cadastre o cliente em Clientes." : undefined}>
          <Select id="nb-c" value={f.client_id} onChange={(e) => setF({ ...f, client_id: e.target.value, project_id: "" })}>
            <option value="">Selecione…</option>{clients.data?.filter((c) => c.status !== "inactive").map((c) => <option key={c.id} value={c.id}>{clientName(c)}</option>)}</Select></Field>
        <Field label="Projeto (opcional)" htmlFor="nb-p" hint="Vinculado a um projeto, o briefing também aparece no link do projeto.">
          <Select id="nb-p" value={f.project_id} disabled={!f.client_id} onChange={(e) => setF({ ...f, project_id: e.target.value })}>
            <option value="">Sem projeto</option>{projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
        <Field label="Mensagem para o cliente (opcional)" htmlFor="nb-i"><Textarea id="nb-i" value={f.intro} onChange={(e) => setF({ ...f, intro: e.target.value })} placeholder="Ex.: Responda com calma. Pode salvar e continuar depois." /></Field>
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------- Detalhe */
export function BriefingDetailPage() {
  const { briefingId } = useParams({ strict: false }) as { briefingId: string };
  const { can } = useOrg();
  const toast = useToast();
  const nav = useNavigate();
  const [link, setLink] = useState<string | null>(null);
  const [days, setDays] = useState("14");
  const [linkOpen, setLinkOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const q = useQuery({ queryKey: ["briefing", briefingId], queryFn: async () => {
    const { data, error } = await supabase.from("briefings").select("*, clients(legal_name, trade_name), projects(name)").eq("id", briefingId).single();
    if (error) throw error; return data as BriefingRow & { sections: BriefingSection[]; answers: Answers; intro_message: string | null; token_expires_at: string | null };
  } });
  const canWrite = can("creative.write") || can("crm.write");
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const b = q.data;
  const closed = b.status === "answered" || b.status === "reviewed";
  const genLink = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc("create_briefing_link", { p_briefing: b.id, p_days: Number(days) });
    setBusy(false);
    if (error) { toast({ tone: "error", message: errorMessage(error) }); return; }
    setLink(appUrl(`/briefing#${data}`)); q.refetch();
  };
  const copy = async (t: string) => { try { await navigator.clipboard.writeText(t); toast({ tone: "success", message: "Link copiado." }); } catch { toast({ tone: "error", message: "Não foi possível copiar. Selecione e copie o link." }); } };
  const update = async (patch: Record<string, unknown>, msg: string) => {
    const { error } = await supabase.from("briefings").update(patch).eq("id", b.id);
    if (error) toast({ tone: "error", message: errorMessage(error) }); else { toast({ tone: "success", message: msg }); q.refetch(); }
  };
  return (
    <div>
      <PageHeader title={b.title} description={<>{b.clients ? clientName(b.clients) : ""}{b.projects && <> · <Link to="/projetos/$projectId" params={{ projectId: b.project_id! }} className="hover:underline">{b.projects.name}</Link></>}</>}
        meta={<Badge tone={briefingStatusTone[b.status]}>{briefingStatusLabel[b.status]}</Badge>}
        actions={<div className="flex flex-wrap gap-2 print:hidden">
          {canWrite && !closed && <Button variant="primary" icon={<Link2 className="size-4" />} onClick={() => { setLink(null); setLinkOpen(true); }}>Link para o cliente</Button>}
          {canWrite && !closed && b.project_id && b.status === "draft" && <Button onClick={async () => {
            const { error } = await supabase.rpc("share_briefing_in_portal", { p_briefing: b.id });
            if (error) toast({ tone: "error", message: errorMessage(error) }); else { toast({ tone: "success", message: "Briefing disponível no link do projeto." }); q.refetch(); }
          }}>Mostrar no link do projeto</Button>}
          {canWrite && b.status === "answered" && <Button onClick={() => update({ status: "reviewed" }, "Briefing marcado como revisado.")}>Marcar como revisado</Button>}
          {canWrite && closed && <Button variant="ghost" onClick={() => update({ status: "in_progress" }, "Briefing reaberto: o cliente pode completar as respostas.")}>Reabrir para o cliente</Button>}
          <Button variant="ghost" icon={<Printer className="size-4" />} onClick={() => window.print()}>Imprimir / PDF</Button>
          {canWrite && <Button variant="ghost" aria-label="Excluir briefing" icon={<Trash2 className="size-4" />} onClick={() => setDeleting(true)} />}
        </div>} />
      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <Card>
          {b.status === "draft" || b.status === "sent" ? (
            <div className="mb-4 rounded-lg bg-surface-2 p-3 text-sm text-fg-2">{b.status === "draft" ? "Ainda não enviado. Gere o link para o cliente responder." : "Aguardando o cliente começar a responder."}</div>
          ) : b.status === "in_progress" ? <div className="mb-4 rounded-lg bg-warning-soft p-3 text-sm text-warning">O cliente salvou respostas parciais e ainda não enviou.</div> : null}
          <BriefingAnswersView sections={b.sections} answers={b.answers} />
        </Card>
        <Card className="h-fit print:hidden">
          <dl className="grid gap-3 text-sm">
            <div><dt className="text-xs text-fg-3">Serviço</dt><dd>{categoryLabel[b.category]}</dd></div>
            <div><dt className="text-xs text-fg-3">Enviado</dt><dd>{b.sent_at ? dateTime(b.sent_at) : "—"}</dd></div>
            {b.token_expires_at && !closed && <div><dt className="text-xs text-fg-3">Link avulso válido até</dt><dd>{dateTime(b.token_expires_at)}</dd></div>}
            <div><dt className="text-xs text-fg-3">Respondido por</dt><dd>{b.respondent_name ?? "—"}{b.submitted_at && <span className="block text-xs text-fg-3">{dateTime(b.submitted_at)}</span>}</dd></div>
          </dl>
          {canWrite && !closed && (
            <Field label="Mensagem para o cliente" htmlFor="bd-intro" className="mt-4">
              <Textarea id="bd-intro" defaultValue={b.intro_message ?? ""} onBlur={(e) => { if (e.target.value !== (b.intro_message ?? "")) update({ intro_message: e.target.value.trim() || null }, "Mensagem salva."); }} />
            </Field>
          )}
        </Card>
      </div>
      <Modal open={linkOpen} onClose={() => setLinkOpen(false)} title="Link para o cliente responder"
        description="Qualquer pessoa com o link pode responder. Gerar um novo link invalida o anterior."
        footer={<Button variant="ghost" onClick={() => setLinkOpen(false)}>Fechar</Button>}>
        {link ? (
          <div className="grid gap-3">
            <p className="text-sm">Copie e envie por WhatsApp ou e-mail. Por segurança, ele só aparece agora.</p>
            <div className="flex gap-2"><Input readOnly value={link} onFocus={(e) => e.target.select()} className="font-mono text-xs" /><Button icon={<Copy className="size-4" />} onClick={() => copy(link)}>Copiar</Button></div>
            <a href={`https://wa.me/?text=${encodeURIComponent(`Olá! Segue o briefing do seu projeto: ${link}`)}`} target="_blank" rel="noreferrer noopener" className="text-sm text-accent hover:underline">Enviar pelo WhatsApp</a>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <Field label="Validade" htmlFor="bl-days"><Select id="bl-days" value={days} onChange={(e) => setDays(e.target.value)}>
              {[7, 14, 30, 60].map((d) => <option key={d} value={d}>{d} dias</option>)}</Select></Field>
            <Button variant="primary" loading={busy} onClick={genLink}>Gerar link</Button>
          </div>
        )}
      </Modal>
      <ConfirmDialog open={deleting} onClose={() => setDeleting(false)} title="Excluir briefing?" description="As respostas do cliente serão apagadas."
        onConfirm={async () => { const { error } = await supabase.from("briefings").delete().eq("id", b.id); if (error) toast({ tone: "error", message: errorMessage(error) }); else nav({ to: "/briefings" }); }} />
    </div>
  );
}

/* ----------------------------------------------------------------- Modelos */
function TemplatesPanel() {
  const { orgId, can } = useOrg();
  const [editing, setEditing] = useState<Template | null>(null);
  const q = useQuery({ queryKey: ["briefing-templates-all", orgId], queryFn: async () =>
    ((await supabase.from("briefing_templates").select("*").eq("organization_id", orgId).order("is_archived").order("name")).data ?? []) as Template[] });
  const canEdit = can("templates.manage") || can("creative.write");
  if (q.isLoading) return <Skeleton className="h-40" />;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {(q.data ?? []).map((t) => (
        <Card key={t.id} className={t.is_archived ? "opacity-60" : undefined}>
          <p className="text-sm font-medium">{t.name}</p>
          <p className="mt-0.5 text-xs text-fg-3">{categoryLabel[t.category]} · {t.sections.length} seções · {t.sections.reduce((n, s) => n + s.questions.length, 0)} perguntas{t.is_archived && " · arquivado"}</p>
          {t.description && <p className="mt-2 text-sm text-fg-2">{t.description}</p>}
          {canEdit && <Button size="sm" className="mt-3" onClick={() => setEditing(t)}>Editar modelo</Button>}
        </Card>
      ))}
      {editing && <TemplateEditor tpl={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); q.refetch(); }} />}
    </div>
  );
}

const qTypes: Record<BriefingQuestion["type"], string> = { text: "Resposta curta", textarea: "Resposta longa", choice: "Escolha uma opção", multi: "Várias opções", date: "Data", number: "Número", url: "Link" };

function TemplateEditor({ tpl, onClose, onSaved }: { tpl: Template; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { orgId } = useOrg();
  const [t, setT] = useState<Template>(structuredClone(tpl));
  const [busy, setBusy] = useState(false);
  const setSec = (i: number, s: Partial<BriefingSection>) => setT({ ...t, sections: t.sections.map((x, j) => j === i ? { ...x, ...s } : x) });
  const setQ = (i: number, k: number, qq: Partial<BriefingQuestion>) => setSec(i, { questions: t.sections[i].questions.map((x, j) => j === k ? { ...x, ...qq } : x) });
  const moveQ = (i: number, k: number, d: -1 | 1) => { const qs = [...t.sections[i].questions]; const n = k + d; if (n < 0 || n >= qs.length) return; [qs[k], qs[n]] = [qs[n], qs[k]]; setSec(i, { questions: qs }); };
  const save = async (asCopy: boolean) => {
    if (t.name.trim().length < 3 || t.sections.some((s) => !s.title.trim() || s.questions.some((x) => !x.label.trim()))) { toast({ tone: "error", message: "Preencha o nome do modelo, os títulos das seções e todas as perguntas." }); return; }
    if (t.sections.some((s) => s.questions.some((x) => (x.type === "choice" || x.type === "multi") && !(x.options?.length)))) { toast({ tone: "error", message: "Perguntas de escolha precisam de opções." }); return; }
    setBusy(true);
    const row = { name: asCopy ? `${t.name} (cópia)` : t.name.trim(), category: t.category, description: t.description, sections: t.sections, is_archived: t.is_archived };
    const { error } = asCopy ? await supabase.from("briefing_templates").insert({ ...row, organization_id: orgId, is_default: false }) : await supabase.from("briefing_templates").update(row).eq("id", t.id);
    setBusy(false);
    if (error) toast({ tone: "error", message: errorMessage(error) }); else { toast({ tone: "success", message: asCopy ? "Cópia criada." : "Modelo salvo. Briefings já criados não mudam." }); onSaved(); }
  };
  return (
    <Modal open onClose={onClose} size="lg" title="Editar modelo de briefing" description="Mudanças valem para os próximos briefings criados com este modelo."
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button loading={busy} onClick={() => save(true)}>Salvar como cópia</Button><Button variant="primary" loading={busy} onClick={() => save(false)}>Salvar</Button></>}>
      <div className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nome" htmlFor="te-name"><Input id="te-name" value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} /></Field>
          <Field label="Serviço" htmlFor="te-cat"><Select id="te-cat" value={t.category} onChange={(e) => setT({ ...t, category: e.target.value as ProjectCategory })}>
            {Object.entries(categoryLabel).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[var(--accent)]" checked={t.is_archived} onChange={(e) => setT({ ...t, is_archived: e.target.checked })} />Arquivar (não aparece ao criar briefings)</label>
        {t.sections.map((s, i) => (
          <fieldset key={i} className="grid gap-3 rounded-lg border border-border p-3">
            <div className="flex gap-2"><Input aria-label={`Título da seção ${i + 1}`} value={s.title} onChange={(e) => setSec(i, { title: e.target.value })} className="font-medium" />
              <Button variant="ghost" aria-label="Remover seção" icon={<Trash2 className="size-4" />} onClick={() => setT({ ...t, sections: t.sections.filter((_, j) => j !== i) })} /></div>
            {s.questions.map((x, k) => (
              <div key={x.id} className="grid gap-2 rounded-md bg-surface-2 p-2 sm:grid-cols-[1fr_160px_auto]">
                <Input aria-label="Pergunta" value={x.label} onChange={(e) => setQ(i, k, { label: e.target.value })} />
                <Select aria-label="Tipo de resposta" value={x.type} onChange={(e) => setQ(i, k, { type: e.target.value as BriefingQuestion["type"] })}>
                  {Object.entries(qTypes).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
                <div className="flex items-center gap-1">
                  <label className="flex items-center gap-1 text-xs"><input type="checkbox" className="accent-[var(--accent)]" checked={!!x.required} onChange={(e) => setQ(i, k, { required: e.target.checked })} />Obrig.</label>
                  <Button size="sm" variant="ghost" aria-label="Subir" icon={<ArrowUp className="size-3.5" />} onClick={() => moveQ(i, k, -1)} />
                  <Button size="sm" variant="ghost" aria-label="Descer" icon={<ArrowDown className="size-3.5" />} onClick={() => moveQ(i, k, 1)} />
                  <Button size="sm" variant="ghost" aria-label="Remover pergunta" icon={<Trash2 className="size-3.5" />} onClick={() => setSec(i, { questions: s.questions.filter((_, j) => j !== k) })} />
                </div>
                {(x.type === "choice" || x.type === "multi") && (
                  <Input aria-label="Opções separadas por ponto e vírgula" className="sm:col-span-3" placeholder="Opções separadas por ;" value={(x.options ?? []).join("; ")}
                    onChange={(e) => setQ(i, k, { options: e.target.value.split(";").map((o) => o.trim()).filter(Boolean) })} />)}
              </div>
            ))}
            <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setSec(i, { questions: [...s.questions, { id: `q_${crypto.randomUUID().slice(0, 8)}`, label: "", type: "textarea" }] })}>Adicionar pergunta</Button>
          </fieldset>
        ))}
        <Button variant="ghost" icon={<Plus className="size-4" />} onClick={() => setT({ ...t, sections: [...t.sections, { title: "Nova seção", questions: [] }] })}>Adicionar seção</Button>
      </div>
    </Modal>
  );
}

/* ---------------------------------------------- Link avulso (sem conta) */
type PublicBriefing = { id: string; title: string; intro_message: string | null; sections: BriefingSection[]; answers: Answers; status: string; respondent_name: string | null; organizations: { name: string } | null };

export function PublicBriefingPage() {
  const token = typeof window !== "undefined" ? window.location.hash.replace(/^#/, "") : "";
  const [sent, setSent] = useState(false);
  const call = async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("briefing-public", { body, headers: { "x-briefing-token": token } });
    if (error) {
      let code = error.message;
      try { code = (await (error as { context?: Response }).context?.json())?.error ?? code; } catch { /* */ }
      throw new Error(code === "link_expired_or_revoked" || code === "invalid_token" ? "Este link expirou ou o briefing já foi enviado. Fale com o estúdio se precisar de um novo link." : code);
    }
    return data;
  };
  const valid = /^[0-9a-f]{64}$/.test(token);
  const q = useQuery({ queryKey: ["public-briefing", token], enabled: valid && !sent, retry: false, queryFn: async () => ((await call({ action: "view" })) as { briefing: PublicBriefing }).briefing });
  const shell = (children: ReactNode, studio?: string) => (
    <div className="min-h-dvh bg-bg">
      <header className="border-b border-border bg-surface"><div className="mx-auto flex h-14 max-w-3xl items-center px-4"><p className="text-sm font-semibold">{studio ?? "Briefing"} <span className="font-normal text-fg-3">· Briefing</span></p></div></header>
      <main className="mx-auto max-w-3xl px-4 py-8">{children}</main>
    </div>
  );
  if (!valid) return shell(<ErrorState error="Link inválido. Confira o endereço recebido do estúdio." />);
  if (sent) return shell(<EmptyState title="Briefing enviado!" description="Recebemos suas respostas. O estúdio vai analisar e entrar em contato." />);
  if (q.isLoading) return shell(<Spinner />);
  if (q.error || !q.data) return shell(<ErrorState error={q.error} />);
  const b = q.data;
  return shell(
    <Card>
      <CardHeader title={b.title} description="Responda no seu tempo: dá para salvar e continuar depois pelo mesmo link." />
      <BriefingFill sections={b.sections} initial={b.answers} initialName={b.respondent_name} intro={b.intro_message}
        onSave={async (answers, final, name) => { await call({ action: "save", answers, final, name }); if (final) setSent(true); }} />
    </Card>, b.organizations?.name);
}
