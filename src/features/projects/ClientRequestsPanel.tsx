import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CheckCircle2, ClipboardList, Download, Link2, Pencil, Plus, RotateCcw, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Card, CardHeader, ConfirmDialog, EmptyState, ErrorState, Field, Input, Modal, Select, Skeleton, Textarea, useToast } from "@/components/ui";
import { useOrg } from "@/features/auth/AuthProvider";
import { briefingStatusLabel, briefingStatusTone } from "@/features/briefings/BriefingForm";
import { requestKindIcon, requestKindLabel, requestStatusLabel, type ClientRequestKind } from "@/features/portal/ClientActions";
import { categoryLabel, errorMessage, type ProjectCategory } from "@/lib/domain";
import { date, dateTime } from "@/lib/format";
import { supabase } from "@/lib/supabase";

/* Pedidos ao cliente: o que o projeto precisa receber dele. Aparece no link
   do projeto em "O que precisamos de você" (escopo "requests"). */
type Req = { id: string; kind: ClientRequestKind; title: string; description: string | null; due_date: string | null; is_required: boolean; status: "open" | "answered" | "done" | "cancelled";
  response_text: string | null; response_links: string[]; responded_label: string | null; responded_at: string | null; position: number };
type ReqFile = { id: string; name: string; storage_path: string; size_bytes: number | null; client_request_id: string };
const statusTone = { open: "warning", answered: "info", done: "success", cancelled: "neutral" } as const;

export function useOpenClientRequests(projectId: string) {
  return useQuery({ queryKey: ["client-requests-open", projectId], queryFn: async () => {
    const { count } = await supabase.from("client_requests").select("id", { count: "exact", head: true }).eq("project_id", projectId).in("status", ["open", "answered"]);
    return count ?? 0;
  } });
}

export function ClientRequestsPanel({ projectId, orgId, clientId, category, canEdit }: { projectId: string; orgId: string; clientId: string; category: ProjectCategory; canEdit: boolean }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Partial<Req> | null>(null);
  const [removing, setRemoving] = useState<Req | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [newBriefing, setNewBriefing] = useState(false);
  const reqs = useQuery({ queryKey: ["client-requests", projectId], queryFn: async () => {
    const { data, error } = await supabase.from("client_requests").select("*").eq("project_id", projectId).neq("status", "cancelled").order("position").order("created_at");
    if (error) throw error; return data as Req[];
  } });
  const files = useQuery({ queryKey: ["client-request-files", projectId], queryFn: async () =>
    ((await supabase.from("files").select("id, name, storage_path, size_bytes, client_request_id").eq("project_id", projectId).not("client_request_id", "is", null).order("created_at")).data ?? []) as ReqFile[] });
  const briefings = useQuery({ queryKey: ["project-briefings", projectId], queryFn: async () =>
    (await supabase.from("briefings").select("id, title, status, sent_at, submitted_at, respondent_name").eq("project_id", projectId).order("created_at")).data ?? [] });
  const links = useQuery({ queryKey: ["share-links-requests", projectId], queryFn: async () =>
    (await supabase.from("share_links").select("id").eq("project_id", projectId).contains("scopes", ["requests"]).is("revoked_at", null)).data ?? [] });
  const refresh = () => { reqs.refetch(); files.refetch(); briefings.refetch(); qc.invalidateQueries({ queryKey: ["client-requests-open", projectId] }); };

  const setStatus = async (r: Req, status: Req["status"]) => {
    const { error } = await supabase.from("client_requests").update({ status }).eq("id", r.id);
    if (error) toast({ tone: "error", message: errorMessage(error) }); else { toast({ tone: "success", message: status === "done" ? "Pedido concluído." : "Pedido reaberto para o cliente." }); refresh(); }
  };
  const suggest = async () => {
    setSuggesting(true);
    const { data, error } = await supabase.rpc("suggest_client_requests", { p_project: projectId });
    setSuggesting(false);
    if (error) toast({ tone: "error", message: errorMessage(error) });
    else { toast({ tone: data ? "success" : "info", message: data ? `${data} pedido(s) adicionados. Revise e ajuste o que precisar.` : "Os pedidos sugeridos já estão na lista." }); refresh(); }
  };
  const download = async (f: ReqFile) => {
    const { data, error } = await supabase.storage.from("org-files").createSignedUrl(f.storage_path, 300, { download: f.name });
    if (error || !data) toast({ tone: "error", message: errorMessage(error) }); else window.open(data.signedUrl, "_blank", "noopener");
  };

  if (reqs.error) return <ErrorState error={reqs.error} onRetry={() => reqs.refetch()} />;
  const list = reqs.data ?? [];
  const open = list.filter((r) => r.status === "open").length;
  const answered = list.filter((r) => r.status === "answered").length;

  return (
    <div className="grid gap-4">
      {links.data && links.data.length === 0 && (
        <p className="rounded-lg bg-info-soft px-3 py-2 text-sm text-info">O cliente vê esta lista no link do projeto. Crie um link na aba <strong>Portal do cliente</strong> com a opção "O que precisamos do cliente" marcada.</p>
      )}
      <Card>
        <CardHeader title="Pedidos ao cliente" description={list.length ? `${open} pendente(s) com o cliente · ${answered} para a equipe revisar` : "Referências, conteúdos, documentos, acessos e informações que o projeto precisa."}
          actions={canEdit && <div className="flex flex-wrap gap-2">
            <Button size="sm" icon={<Sparkles className="size-3.5" />} loading={suggesting} onClick={suggest}>Sugerir para {categoryLabel[category]}</Button>
            <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEditing({ kind: "reference", is_required: true })}>Novo pedido</Button>
          </div>} />
        {reqs.isLoading ? <Skeleton className="h-24" /> : !list.length ? (
          <EmptyState title="Nenhum pedido ainda" description="Use a sugestão para criar a lista padrão deste tipo de projeto, ou crie pedidos um a um." />
        ) : (
          <ul className="grid gap-3">
            {list.map((r) => {
              const fs = (files.data ?? []).filter((f) => f.client_request_id === r.id);
              return (
                <li key={r.id} className="rounded-lg border border-border p-4">
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 text-fg-3">{requestKindIcon[r.kind]}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium">{r.title}</p>
                        <Badge tone={statusTone[r.status]}>{r.status === "answered" ? "Cliente respondeu" : requestStatusLabel[r.status]}</Badge>
                        {r.is_required && <Badge>Obrigatório</Badge>}
                      </div>
                      <p className="text-xs text-fg-3">{requestKindLabel[r.kind]}{r.due_date && <> · até {date(r.due_date)}</>}</p>
                      {r.description && <p className="mt-1 whitespace-pre-wrap text-sm text-fg-2">{r.description}</p>}
                      {(r.responded_at || fs.length > 0) && (
                        <div className="mt-3 grid gap-1.5 rounded-md bg-surface-2 p-3">
                          {r.responded_at && <p className="text-xs text-fg-3">Resposta de {r.responded_label} em {dateTime(r.responded_at)}</p>}
                          {r.response_text && <p className="whitespace-pre-wrap text-sm">{r.response_text}</p>}
                          {r.response_links.map((l) => <a key={l} href={l} target="_blank" rel="noreferrer noopener" className="flex items-center gap-1.5 truncate text-sm text-accent hover:underline"><Link2 className="size-3.5 shrink-0" />{l}</a>)}
                          {fs.map((f) => <button key={f.id} type="button" onClick={() => download(f)} className="flex items-center gap-1.5 text-left text-sm text-accent hover:underline"><Download className="size-3.5 shrink-0" />{f.name}</button>)}
                        </div>
                      )}
                    </div>
                    {canEdit && (
                      <div className="flex shrink-0 flex-wrap justify-end gap-1">
                        {r.status !== "done" ? <Button size="sm" icon={<CheckCircle2 className="size-3.5" />} onClick={() => setStatus(r, "done")}>Concluir</Button>
                          : <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={() => setStatus(r, "open")}>Reabrir</Button>}
                        {r.status === "answered" && <Button size="sm" variant="ghost" onClick={() => setStatus(r, "open")}>Pedir de novo</Button>}
                        <Button size="sm" variant="ghost" aria-label="Editar pedido" icon={<Pencil className="size-3.5" />} onClick={() => setEditing(r)} />
                        <Button size="sm" variant="ghost" aria-label="Excluir pedido" icon={<Trash2 className="size-3.5" />} onClick={() => setRemoving(r)} />
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title="Briefings do projeto" description="Briefings vinculados aparecem para o cliente responder no link do projeto."
          actions={canEdit && <Button size="sm" icon={<ClipboardList className="size-3.5" />} onClick={() => setNewBriefing(true)}>Novo briefing</Button>} />
        {briefings.data?.length ? (
          <ul className="divide-y divide-border">
            {briefings.data.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-2 py-2.5 text-sm">
                <Link to="/briefings/$briefingId" params={{ briefingId: b.id }} className="flex-1 truncate font-medium hover:underline">{b.title}</Link>
                <Badge tone={briefingStatusTone[b.status]}>{briefingStatusLabel[b.status]}</Badge>
                {b.status === "draft" && canEdit && <Button size="sm" onClick={async () => {
                  const { error } = await supabase.rpc("share_briefing_in_portal", { p_briefing: b.id });
                  if (error) toast({ tone: "error", message: errorMessage(error) }); else { toast({ tone: "success", message: "Briefing disponível no link do projeto." }); briefings.refetch(); }
                }}>Mostrar no link</Button>}
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-fg-3">Nenhum briefing vinculado a este projeto.</p>}
      </Card>

      {editing && <RequestModal req={editing} projectId={projectId} orgId={orgId} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />}
      <ConfirmDialog open={!!removing} onClose={() => setRemoving(null)} title="Excluir pedido?" description="O pedido sai do link do cliente. Arquivos já enviados continuam na aba Arquivos."
        onConfirm={async () => {
          const { error } = await supabase.from("client_requests").delete().eq("id", removing!.id);
          if (error) toast({ tone: "error", message: errorMessage(error) }); else { setRemoving(null); refresh(); }
        }} />
      {newBriefing && <NewProjectBriefing projectId={projectId} orgId={orgId} clientId={clientId} category={category} onClose={() => setNewBriefing(false)} onDone={() => { setNewBriefing(false); briefings.refetch(); }} />}
    </div>
  );
}

function RequestModal({ req, projectId, orgId, onClose, onSaved }: { req: Partial<Req>; projectId: string; orgId: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ kind: req.kind ?? "reference", title: req.title ?? "", description: req.description ?? "", due_date: req.due_date ?? "", is_required: req.is_required ?? true });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (f.title.trim().length < 2) { toast({ tone: "error", message: "Dê um título ao pedido." }); return; }
    setBusy(true);
    const row = { kind: f.kind, title: f.title.trim(), description: f.description.trim() || null, due_date: f.due_date || null, is_required: f.is_required };
    const { error } = req.id ? await supabase.from("client_requests").update(row).eq("id", req.id)
      : await supabase.from("client_requests").insert({ ...row, organization_id: orgId, project_id: projectId, position: 1000 });
    setBusy(false);
    if (error) toast({ tone: "error", message: errorMessage(error) }); else { toast({ tone: "success", message: req.id ? "Pedido atualizado." : "Pedido criado." }); onSaved(); }
  };
  return (
    <Modal open onClose={onClose} title={req.id ? "Editar pedido" : "Novo pedido ao cliente"} description="O cliente vê o título e a descrição no link do projeto."
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={busy} onClick={save}>Salvar</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Tipo" htmlFor="rq-kind"><Select id="rq-kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as ClientRequestKind })}>
          {Object.entries(requestKindLabel).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        <Field label="Prazo para o cliente" htmlFor="rq-due"><Input id="rq-due" type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></Field>
        <Field label="Título" required htmlFor="rq-title" className="sm:col-span-2"><Input id="rq-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Ex.: Fotos da fachada da loja" /></Field>
        <Field label="O que exatamente você precisa" htmlFor="rq-desc" className="sm:col-span-2" hint={f.kind === "access" ? "O cliente é orientado a não enviar senhas pelo link." : undefined}>
          <Textarea id="rq-desc" rows={4} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" className="size-4 accent-[var(--accent)]" checked={f.is_required} onChange={(e) => setF({ ...f, is_required: e.target.checked })} />Obrigatório para o projeto andar</label>
      </div>
    </Modal>
  );
}

function NewProjectBriefing({ projectId, orgId, clientId, category, onClose, onDone }: { projectId: string; orgId: string; clientId: string; category: ProjectCategory; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { userId } = useOrg();
  const tpls = useQuery({ queryKey: ["briefing-templates", orgId], queryFn: async () =>
    (await supabase.from("briefing_templates").select("id, name, category, sections").eq("organization_id", orgId).eq("is_archived", false).order("name")).data ?? [] });
  const [tpl, setTpl] = useState("");
  const [intro, setIntro] = useState("");
  const [busy, setBusy] = useState(false);
  const chosen = tpl || tpls.data?.find((t) => t.category === category)?.id || "";
  const create = async () => {
    const t = tpls.data?.find((x) => x.id === chosen);
    if (!t) { toast({ tone: "error", message: "Escolha um modelo." }); return; }
    setBusy(true);
    const { data, error } = await supabase.from("briefings").insert({ organization_id: orgId, client_id: clientId, project_id: projectId, template_id: t.id, title: t.name,
      category: t.category, sections: t.sections, intro_message: intro.trim() || null, created_by: userId }).select("id").single();
    if (!error) {
      const r = await supabase.rpc("share_briefing_in_portal", { p_briefing: data.id });
      if (r.error) toast({ tone: "error", message: errorMessage(r.error) });
    }
    setBusy(false);
    if (error) toast({ tone: "error", message: errorMessage(error) }); else { toast({ tone: "success", message: "Briefing criado e disponível no link do projeto." }); onDone(); }
  };
  return (
    <Modal open onClose={onClose} title="Novo briefing do projeto" description="O cliente responde no link do projeto, em “O que precisamos de você”."
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={busy} onClick={create}>Criar e mostrar no link</Button></>}>
      <div className="grid gap-4">
        <Field label="Modelo" htmlFor="nb-tpl"><Select id="nb-tpl" value={chosen} onChange={(e) => setTpl(e.target.value)}>
          <option value="">Selecione…</option>{tpls.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
        <Field label="Mensagem para o cliente (opcional)" htmlFor="nb-intro"><Textarea id="nb-intro" value={intro} onChange={(e) => setIntro(e.target.value)} placeholder="Ex.: Responda com calma, leva uns 20 minutos. Pode salvar e continuar depois." /></Field>
      </div>
    </Modal>
  );
}
