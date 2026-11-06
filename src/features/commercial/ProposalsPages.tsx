import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Check, FileDown, FileText, Plus, Send, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useBreadcrumbs } from "@/components/layout/AppShell";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, Field, Input, Modal, PageHeader, Select, Spinner, Textarea, useToast } from "@/components/ui";
import { useOrg } from "@/features/auth/AuthProvider";
import { clientName } from "@/features/clients/ClientsPages";
import { errorMessage, type Tone } from "@/lib/domain";
import { addDaysISO, date, money, todayISO } from "@/lib/format";
import { appUrl, supabase } from "@/lib/supabase";
import { ProposalLinksButton, ServerPdfButton } from "./DocumentActions";

export type ProposalStatus = "draft" | "sent" | "viewed" | "negotiation" | "approved" | "rejected" | "expired";
export const proposalStatusLabel: Record<ProposalStatus, string> = { draft: "Rascunho", sent: "Enviada", viewed: "Visualizada", negotiation: "Em negociação", approved: "Aprovada", rejected: "Recusada", expired: "Expirada" };
export const proposalStatusTone: Record<ProposalStatus, Tone> = { draft: "neutral", sent: "info", viewed: "accent", negotiation: "warning", approved: "success", rejected: "danger", expired: "neutral" };

export interface Proposal {
  id: string; organization_id: string; number: number; client_id: string; opportunity_id: string | null; title: string; status: ProposalStatus;
  intro: string | null; scope: string | null; deliverables: string | null; terms: string | null; notes: string | null; revisions: number;
  discount_type: "none" | "percent" | "amount"; discount_value: number; installments: number; first_due_date: string | null; valid_until: string | null;
  template_id: string | null; subtotal: number; total: number; sent_at: string | null; viewed_at: string | null; decided_at: string | null; created_at: string;
  client_accepted_at?: string | null; client_accepted_name?: string | null; client_accept_note?: string | null;
  clients?: { legal_name: string; trade_name: string | null } | null;
}
export interface ProposalItem { id: string; proposal_id: string; service_id: string | null; position: number; description: string; details: string | null; quantity: number; unit_price: number; is_package: boolean; line_total: number }

/* ------------------------------------------------------------- Lista */
export function ProposalsPage({ newFor, opportunity }: { newFor?: string; opportunity?: string }) {
  useBreadcrumbs([{ label: "Propostas" }]);
  const { orgId, can } = useOrg();
  const nav = useNavigate();
  const toast = useToast();
  const [status, setStatus] = useState<ProposalStatus | "">("");
  const [creating, setCreating] = useState(!!newFor);
  const [client, setClient] = useState(newFor ?? "");
  const [title, setTitle] = useState("");
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["proposals", orgId],
    queryFn: async () => { const { data, error } = await supabase.from("proposals").select("*, clients(legal_name, trade_name)").eq("organization_id", orgId).order("number", { ascending: false }); if (error) throw error; return data as Proposal[]; },
  });
  const clients = useQuery({ queryKey: ["clients", orgId], enabled: creating, queryFn: async () => (await supabase.from("clients").select("id, legal_name, trade_name, status").eq("organization_id", orgId).order("legal_name")).data ?? [] });
  const create = async () => {
    const { data, error } = await supabase.from("proposals").insert({ organization_id: orgId, client_id: client, title: title.trim(), number: 0, opportunity_id: opportunity ?? null,
      valid_until: addDaysISO(todayISO(), 15), revisions: 2, installments: 1 }).select("id").single();
    if (error) return toast({ tone: "error", message: errorMessage(error) });
    nav({ to: `/propostas/${data.id}` });
  };
  const list = (data ?? []).filter((p) => !status || p.status === status);
  const sum = (s: ProposalStatus[]) => (data ?? []).filter((p) => s.includes(p.status)).reduce((a, p) => a + Number(p.total), 0);

  return (
    <>
      <PageHeader title="Propostas" description="Orçamentos comerciais com itens, condições e aprovação."
        actions={can("proposals.write") && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>Nova proposta</Button>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[["Em aberto", sum(["sent", "viewed", "negotiation"])], ["Aprovadas", sum(["approved"])], ["Rascunhos", sum(["draft"])], ["Recusadas/expiradas", sum(["rejected", "expired"])]].map(([l, v]) => (
          <Card key={l as string}><p className="text-xs text-fg-3">{l}</p><p className="mt-1 text-lg font-semibold tabular">{money(v as number)}</p></Card>))}
      </div>
      <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as ProposalStatus | "")} className="mb-4 w-48">
        <option value="">Todos os status</option>{Object.entries(proposalStatusLabel).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </Select>
      {error ? <ErrorState error={error} onRetry={refetch} /> : isLoading ? <Spinner /> : !list.length ? (
        <EmptyState icon={<FileText className="size-5" />} title="Nenhuma proposta" description="Monte propostas a partir dos serviços cadastrados em Configurações." />
      ) : (
        <Card padded={false} className="overflow-hidden"><div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-left text-xs text-fg-3"><tr><th className="px-4 py-2.5 font-medium">Nº</th><th className="px-4 py-2.5 font-medium">Proposta</th>
              <th className="px-4 py-2.5 font-medium">Status</th><th className="hidden px-4 py-2.5 font-medium md:table-cell">Validade</th><th className="px-4 py-2.5 text-right font-medium">Total</th></tr></thead>
            <tbody>{list.map((p) => (
              <tr key={p.id} className="border-t border-border hover:bg-surface-2/60">
                <td className="px-4 py-3 text-fg-3 tabular">{String(p.number).padStart(4, "0")}</td>
                <td className="px-4 py-3"><Link to={`/propostas/${p.id}`} className="font-medium hover:text-accent">{p.title}</Link><p className="text-xs text-fg-3">{clientName(p.clients)}</p></td>
                <td className="px-4 py-3"><Badge tone={proposalStatusTone[p.status]} dot>{proposalStatusLabel[p.status]}</Badge></td>
                <td className="hidden px-4 py-3 text-fg-2 md:table-cell">{date(p.valid_until)}</td>
                <td className="px-4 py-3 text-right font-medium tabular">{money(p.total)}</td>
              </tr>))}</tbody>
          </table></div></Card>
      )}
      <Modal open={creating} onClose={() => setCreating(false)} title="Nova proposta" size="sm"
        footer={<><Button variant="ghost" onClick={() => setCreating(false)}>Cancelar</Button><Button variant="primary" disabled={!client || title.trim().length < 2} onClick={create}>Criar e editar</Button></>}>
        <div className="grid gap-4">
          <Field label="Cliente" required htmlFor="np-client"><Select id="np-client" value={client} onChange={(e) => setClient(e.target.value)}>
            <option value="">Selecione…</option>{clients.data?.filter((c) => c.status !== "inactive").map((c) => <option key={c.id} value={c.id}>{clientName(c)}</option>)}</Select></Field>
          <Field label="Título" required htmlFor="np-title"><Input id="np-title" placeholder="Ex.: Identidade visual completa" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        </div>
      </Modal>
    </>
  );
}

/* ------------------------------------------------------------ Editor */
export function ProposalEditorPage({ proposalId }: { proposalId: string }) {
  const { orgId, can } = useOrg();
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const key = ["proposal", proposalId];
  const { data, isLoading, error } = useQuery({
    queryKey: key,
    queryFn: async () => {
      const [p, items] = await Promise.all([
        supabase.from("proposals").select("*, clients(legal_name, trade_name)").eq("id", proposalId).single(),
        supabase.from("proposal_items").select("*").eq("proposal_id", proposalId).order("position"),
      ]);
      if (p.error) throw p.error;
      return { p: p.data as Proposal, items: (items.data ?? []) as ProposalItem[] };
    },
  });
  const services = useQuery({ queryKey: ["services", orgId], queryFn: async () => (await supabase.from("services").select("*").eq("organization_id", orgId).eq("is_active", true).order("name")).data ?? [] });
  const templates = useQuery({ queryKey: ["templates", orgId], queryFn: async () => (await supabase.from("project_templates").select("id, name").eq("organization_id", orgId).eq("is_archived", false).order("name")).data ?? [] });
  const [draft, setDraft] = useState<Partial<Proposal>>({});
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  useEffect(() => { setDraft({}); }, [data?.p.id]);
  useBreadcrumbs([{ label: "Propostas", to: "/propostas" }, { label: data ? `Nº ${String(data.p.number).padStart(4, "0")}` : "…" }]);

  const refresh = () => { qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: ["proposals"] }); };
  const saveHeader = useMutation({
    mutationFn: async (patch: Partial<Proposal>) => { const { error } = await supabase.from("proposals").update(patch).eq("id", proposalId); if (error) throw error; },
    onSuccess: () => { setDraft({}); refresh(); toast({ tone: "success", message: "Proposta salva." }); },
    onError: (e) => toast({ tone: "error", message: errorMessage(e) }),
  });
  const rpc = async (fn: string, args: Record<string, unknown>, ok: string) => {
    const { data: r, error } = await supabase.rpc(fn, args);
    if (error) { toast({ tone: "error", message: errorMessage(error) }); return null; }
    refresh(); toast({ tone: "success", message: ok }); return r;
  };

  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorState error={error ?? "Proposta não encontrada."} />;
  const p = { ...data.p, ...draft };
  const editable = can("proposals.write") && ["draft", "negotiation"].includes(data.p.status);
  const dirty = Object.keys(draft).length > 0;
  const set = (k: keyof Proposal) => (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  const num = (k: keyof Proposal) => (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [k]: Number(e.target.value) }));

  return (
    <>
      <PageHeader title={data.p.title} description={<>Proposta Nº {String(data.p.number).padStart(4, "0")} · <Link to={`/clientes/${data.p.client_id}`} className="hover:text-accent">{clientName(data.p.clients)}</Link></>}
        meta={<><Badge tone={proposalStatusTone[data.p.status]} dot>{proposalStatusLabel[data.p.status]}</Badge>
          {data.p.sent_at && <span className="text-xs text-fg-3">Enviada em {date(data.p.sent_at)}</span>}{data.p.viewed_at && <span className="text-xs text-fg-3">· Vista em {date(data.p.viewed_at)}</span>}</>}
        actions={<>
          <a href={appUrl(`/propostas/${proposalId}/imprimir`)} target="_blank" rel="noopener"><Button variant="ghost" icon={<FileDown className="size-4" />}>Imprimir</Button></a>
          <ServerPdfButton kind="proposal" id={proposalId} />
          {can("contracts.write") && data.p.status === "approved" && <Button onClick={() => nav({ to: "/contratos/novo", search: { proposta: proposalId } })}>Gerar contrato</Button>}
          {can("proposals.write") && <ProposalLinksButton proposalId={proposalId} disabled={["draft", "rejected", "expired"].includes(data.p.status)} />}
          {can("proposals.write") && data.p.status === "draft" && <Button variant="primary" icon={<Send className="size-4" />} disabled={dirty} title={dirty ? "Salve as alterações antes" : undefined}
            onClick={() => rpc("send_proposal", { p_proposal: proposalId }, "Proposta marcada como enviada. O cliente a vê no portal.")}>Enviar</Button>}
          {can("proposals.write") && ["sent", "viewed"].includes(data.p.status) && <Button onClick={() => saveHeader.mutate({ status: "negotiation" })}>Em negociação</Button>}
          {can("proposals.write") && ["sent", "viewed", "negotiation"].includes(data.p.status) && <>
            <Button variant="ghost" icon={<X className="size-4" />} onClick={() => setRejecting(true)}>Recusada</Button>
            <Button variant="primary" icon={<Check className="size-4" />} disabled={dirty} onClick={() => setApproving(true)}>Aprovar</Button></>}
        </>} />

      {data.p.client_accepted_at && (
        <div role="status" className="mb-5 rounded-lg border border-success/30 bg-success-soft p-4 text-sm">
          <p className="font-medium text-success">Aceita pelo cliente: {data.p.client_accepted_name} em {date(data.p.client_accepted_at)}</p>
          {data.p.client_accept_note && <p className="mt-1 text-fg-2">“{data.p.client_accept_note}”</p>}
          {data.p.status !== "approved" && <p className="mt-1 text-fg-3">Clique em Aprovar para gerar o projeto, o contrato e as parcelas.</p>}
        </div>
      )}
      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="grid content-start gap-5">
          <Items proposal={data.p} items={data.items} services={services.data ?? []} editable={editable} onChange={refresh} />
          <Card>
            <CardHeader title="Conteúdo da proposta" description="Textos que aparecem no PDF e no portal do cliente." />
            <div className="grid gap-4">
              {([["intro", "Apresentação"], ["scope", "Escopo"], ["deliverables", "Entregáveis"], ["terms", "Condições comerciais"]] as const).map(([k, l]) => (
                <Field key={k} label={l} htmlFor={`pp-${k}`}><Textarea id={`pp-${k}`} rows={k === "scope" ? 5 : 3} disabled={!editable} value={(p[k] as string) ?? ""} onChange={set(k)} /></Field>))}
              <Field label="Observações internas" htmlFor="pp-notes" hint="Não aparecem para o cliente."><Textarea id="pp-notes" rows={2} disabled={!can("proposals.write")} value={p.notes ?? ""} onChange={set("notes")} /></Field>
            </div>
          </Card>
        </div>
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader title="Valores" />
            <dl className="grid gap-2 text-sm">
              <div className="flex justify-between"><dt className="text-fg-3">Subtotal</dt><dd className="tabular">{money(data.p.subtotal)}</dd></div>
              {data.p.discount_type !== "none" && <div className="flex justify-between"><dt className="text-fg-3">Desconto</dt><dd className="tabular">− {money(Number(data.p.subtotal) - Number(data.p.total))}</dd></div>}
              <div className="flex justify-between border-t border-border pt-2 text-base font-semibold"><dt>Total</dt><dd className="tabular">{money(data.p.total)}</dd></div>
              {data.p.installments > 1 && <p className="text-xs text-fg-3">{data.p.installments}x de {money(Number(data.p.total) / data.p.installments)}</p>}
            </dl>
          </Card>
          <Card>
            <CardHeader title="Condições" />
            <div className="grid gap-3">
              <div className="grid grid-cols-[1fr_110px] gap-2">
                <Field label="Desconto" htmlFor="pp-dt"><Select id="pp-dt" disabled={!editable} value={p.discount_type} onChange={set("discount_type")}><option value="none">Sem desconto</option><option value="percent">Percentual (%)</option><option value="amount">Valor (R$)</option></Select></Field>
                <Field label="Valor" htmlFor="pp-dv"><Input id="pp-dv" type="number" min={0} step="0.01" disabled={!editable || p.discount_type === "none"} value={p.discount_value ?? 0} onChange={num("discount_value")} /></Field>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Parcelas" htmlFor="pp-inst"><Input id="pp-inst" type="number" min={1} max={48} disabled={!editable} value={p.installments} onChange={num("installments")} /></Field>
                <Field label="1º vencimento" htmlFor="pp-first"><Input id="pp-first" type="date" disabled={!editable} value={p.first_due_date ?? ""} onChange={set("first_due_date")} /></Field>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Válida até" htmlFor="pp-valid"><Input id="pp-valid" type="date" disabled={!editable} value={p.valid_until ?? ""} onChange={set("valid_until")} /></Field>
                <Field label="Revisões incluídas" htmlFor="pp-rev"><Input id="pp-rev" type="number" min={0} disabled={!editable} value={p.revisions} onChange={num("revisions")} /></Field>
              </div>
              <Field label="Modelo de projeto na aprovação" htmlFor="pp-tpl" hint="Gera as etapas do projeto automaticamente.">
                <Select id="pp-tpl" disabled={!editable} value={p.template_id ?? ""} onChange={(e) => setDraft((d) => ({ ...d, template_id: e.target.value || null }))}>
                  <option value="">Sem modelo</option>{templates.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
              <Button variant="primary" disabled={!dirty} loading={saveHeader.isPending} onClick={() => saveHeader.mutate(Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, v === "" ? null : v])) as Partial<Proposal>)}>Salvar alterações</Button>
            </div>
          </Card>
        </div>
      </div>

      {approving && <ApproveModal proposal={data.p} onClose={() => setApproving(false)} onDone={(projectId) => { setApproving(false); refresh(); nav({ to: `/projetos/${projectId}` }); }} />}
      <Modal open={rejecting} onClose={() => setRejecting(false)} title="Registrar recusa" size="sm"
        footer={<><Button variant="ghost" onClick={() => setRejecting(false)}>Cancelar</Button><Button variant="danger" onClick={async () => { await rpc("reject_proposal", { p_proposal: proposalId, p_reason: reason || null }, "Recusa registrada."); setRejecting(false); }}>Registrar</Button></>}>
        <Field label="Motivo (opcional)" htmlFor="rej"><Textarea id="rej" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </Modal>
    </>
  );
}

function Items({ proposal, items, services, editable, onChange }: { proposal: Proposal; items: ProposalItem[]; services: { id: string; name: string; description: string | null; unit_price: number; unit: string }[]; editable: boolean; onChange: () => void }) {
  const toast = useToast();
  const [svc, setSvc] = useState("");
  const add = async (fromService?: string) => {
    const s = services.find((x) => x.id === fromService);
    const { error } = await supabase.from("proposal_items").insert({ organization_id: proposal.organization_id, proposal_id: proposal.id, service_id: s?.id ?? null,
      position: (items.at(-1)?.position ?? 0) + 1, description: s?.name ?? "Novo item", details: s?.description ?? null, quantity: 1, unit_price: s?.unit_price ?? 0 });
    if (error) return toast({ tone: "error", message: errorMessage(error) });
    setSvc(""); onChange();
  };
  const update = async (id: string, patch: Partial<ProposalItem>) => {
    const { error } = await supabase.from("proposal_items").update(patch).eq("id", id);
    if (error) return toast({ tone: "error", message: errorMessage(error) });
    onChange();
  };
  const remove = async (id: string) => { const { error } = await supabase.from("proposal_items").delete().eq("id", id); if (error) return toast({ tone: "error", message: errorMessage(error) }); onChange(); };
  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-4">
        <p className="text-sm font-semibold">Itens</p>
        {editable && <div className="flex gap-2">
          <Select aria-label="Adicionar serviço" value={svc} onChange={(e) => setSvc(e.target.value)} className="w-56"><option value="">Escolher serviço do catálogo…</option>{services.map((s) => <option key={s.id} value={s.id}>{s.name} · {money(s.unit_price)}</option>)}</Select>
          <Button disabled={!svc} onClick={() => add(svc)}>Adicionar</Button>
          <Button variant="ghost" icon={<Plus className="size-4" />} onClick={() => add()}>Item livre</Button>
        </div>}
      </div>
      {!items.length ? <p className="p-6 text-center text-sm text-fg-3">Nenhum item. Adicione serviços do catálogo ou itens livres.</p> : (
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead className="text-left text-xs text-fg-3"><tr><th className="px-4 py-2 font-medium">Descrição</th><th className="w-20 px-2 py-2 font-medium">Qtd.</th><th className="w-32 px-2 py-2 font-medium">Valor unit.</th><th className="w-28 px-2 py-2 text-right font-medium">Total</th>{editable && <th className="w-10" />}</tr></thead>
          <tbody>{items.map((it) => (
            <tr key={it.id} className="border-t border-border align-top">
              <td className="px-4 py-2">
                <Input aria-label="Descrição" disabled={!editable} defaultValue={it.description} onBlur={(e) => e.target.value.trim() && e.target.value !== it.description && update(it.id, { description: e.target.value.trim() })} />
                <Textarea aria-label="Detalhes" rows={1} disabled={!editable} placeholder="Detalhes (opcional)" defaultValue={it.details ?? ""} className="mt-1.5 text-xs" onBlur={(e) => e.target.value !== (it.details ?? "") && update(it.id, { details: e.target.value || null })} />
                <label className="mt-1.5 flex items-center gap-1.5 text-xs text-fg-3"><input type="checkbox" className="accent-[var(--accent)]" disabled={!editable} checked={it.is_package} onChange={(e) => update(it.id, { is_package: e.target.checked })} />Pacote</label>
              </td>
              <td className="px-2 py-2"><Input aria-label="Quantidade" type="number" min={0.01} step="0.01" disabled={!editable} defaultValue={it.quantity} onBlur={(e) => Number(e.target.value) > 0 && Number(e.target.value) !== Number(it.quantity) && update(it.id, { quantity: Number(e.target.value) })} /></td>
              <td className="px-2 py-2"><Input aria-label="Valor unitário" type="number" min={0} step="0.01" disabled={!editable} defaultValue={it.unit_price} onBlur={(e) => Number(e.target.value) >= 0 && Number(e.target.value) !== Number(it.unit_price) && update(it.id, { unit_price: Number(e.target.value) })} /></td>
              <td className="px-2 py-3 text-right tabular">{money(it.line_total)}</td>
              {editable && <td className="py-2 pr-2"><button aria-label="Remover item" onClick={() => remove(it.id)} className="rounded p-1.5 text-fg-3 hover:bg-surface-2 hover:text-danger"><Trash2 className="size-4" /></button></td>}
            </tr>))}</tbody>
        </table></div>
      )}
    </Card>
  );
}

function ApproveModal({ proposal, onClose, onDone }: { proposal: Proposal; onClose: () => void; onDone: (projectId: string) => void }) {
  const { orgId, can } = useOrg();
  const toast = useToast();
  const [tpl, setTpl] = useState("");
  const [start, setStart] = useState(todayISO());
  const [busy, setBusy] = useState(false);
  const ctpls = useQuery({ queryKey: ["contract-templates", orgId], enabled: can("contracts.write"), queryFn: async () => (await supabase.from("contract_templates").select("id, name").eq("organization_id", orgId).eq("is_archived", false).order("name")).data ?? [] });
  const steps = useMemo(() => [
    "Marcar a proposta como aprovada",
    "Criar o projeto com valor, escopo e responsável",
    proposal.template_id ? "Gerar as tarefas do modelo de projeto" : "Projeto sem modelo (tarefas manuais)",
    tpl ? "Gerar o contrato em rascunho para revisão" : "Sem contrato agora (pode criar depois)",
    `Criar ${proposal.installments} parcela(s) previstas no financeiro`,
  ], [proposal, tpl]);
  const go = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc("approve_proposal", { p_proposal: proposal.id, p_contract_template: tpl || null, p_start_date: start });
    setBusy(false);
    if (error) return toast({ tone: "error", message: errorMessage(error) });
    toast({ tone: "success", message: "Proposta aprovada. Projeto criado." });
    onDone((data as { project_id: string }).project_id);
  };
  return (
    <Modal open onClose={onClose} title="Aprovar proposta" description={`${proposal.title} · ${money(proposal.total)}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={busy} onClick={go}>Aprovar e gerar</Button></>}>
      <div className="grid gap-4">
        <Field label="Início do projeto" htmlFor="ap-start"><Input id="ap-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        {can("contracts.write") && <Field label="Modelo de contrato" htmlFor="ap-ctpl"><Select id="ap-ctpl" value={tpl} onChange={(e) => setTpl(e.target.value)}>
          <option value="">Não gerar contrato agora</option>{ctpls.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>}
        <div className="rounded-lg bg-surface-2 p-3">
          <p className="mb-2 text-xs font-medium text-fg-2">O que vai acontecer, numa única operação:</p>
          <ol className="grid list-decimal gap-1 pl-5 text-sm text-fg-2">{steps.map((s) => <li key={s}>{s}</li>)}</ol>
        </div>
      </div>
    </Modal>
  );
}

/* ---------------------------------------------- Versão para impressão/PDF */
export function ProposalPrintPage({ proposalId }: { proposalId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["proposal-print", proposalId],
    queryFn: async () => {
      const [p, items] = await Promise.all([
        supabase.from("proposals").select("*, clients(legal_name, trade_name, document), organizations(name, legal_name, document, email, phone, branding)").eq("id", proposalId).single(),
        supabase.from("proposal_items").select("*").eq("proposal_id", proposalId).order("position"),
      ]);
      if (p.error) throw p.error;
      const org = p.data.organizations as { name: string; legal_name: string | null; email: string | null; phone: string | null; branding: { primary_color?: string; logo_path?: string } | null };
      const logo = org.branding?.logo_path ? (await supabase.storage.from("org-files").createSignedUrl(org.branding.logo_path, 600)).data?.signedUrl ?? null : null;
      return { p: p.data as Proposal & { organizations: typeof org }, items: (items.data ?? []) as ProposalItem[], logo, accent: org.branding?.primary_color ?? "#0B0C12" };
    },
  });
  useEffect(() => { if (data) { document.title = `Proposta ${String(data.p.number).padStart(4, "0")} — ${data.p.title}`; setTimeout(() => window.print(), 400); } }, [data]);
  if (isLoading || !data) return <Spinner />;
  const { p, items, logo, accent } = data;
  const Section = ({ t, v }: { t: string; v: string | null }) => v ? <section className="mt-6"><h2 className="mb-1.5 text-xs font-semibold uppercase tracking-wider" style={{ color: accent }}>{t}</h2><p className="whitespace-pre-wrap text-[13px] leading-relaxed">{v}</p></section> : null;
  return (
    <div className="min-h-dvh bg-white text-[#0E1726] print:min-h-0">
      <div className="mx-auto max-w-[780px] px-10 py-12 print:p-0">
        <header className="flex items-start justify-between border-b-2 pb-5" style={{ borderColor: accent }}>
          <div>{logo ? <img src={logo} alt={p.organizations.name} className="mb-1 max-h-10 max-w-[180px] object-contain" /> : <p className="text-lg font-semibold">{p.organizations.name}</p>}<p className="text-xs text-[#4A5565]">{[p.organizations.email, p.organizations.phone].filter(Boolean).join(" · ")}</p></div>
          <div className="text-right"><p className="text-xs uppercase tracking-wider text-[#4A5565]">Proposta comercial</p><p className="text-lg font-semibold tabular">Nº {String(p.number).padStart(4, "0")}</p></div>
        </header>
        <h1 className="mt-8 text-2xl font-semibold">{p.title}</h1>
        <p className="mt-1 text-sm text-[#4A5565]">Para {p.clients?.legal_name} · emitida em {date(p.sent_at ?? p.created_at)} · válida até {date(p.valid_until)}</p>
        <Section t="Apresentação" v={p.intro} />
        <Section t="Escopo" v={p.scope} />
        <Section t="Entregáveis" v={p.deliverables} />
        <section className="mt-6">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#0B0C12]">Investimento</h2>
          <table className="w-full text-[13px]">
            <thead><tr className="border-b border-[#CDD4DE] text-left text-[11px] uppercase text-[#4A5565]"><th className="py-1.5">Item</th><th className="w-14 py-1.5 text-right">Qtd.</th><th className="w-28 py-1.5 text-right">Unitário</th><th className="w-28 py-1.5 text-right">Total</th></tr></thead>
            <tbody>{items.map((i) => <tr key={i.id} className="border-b border-[#E3E7ED] align-top"><td className="py-2"><p className="font-medium">{i.description}{i.is_package && " (pacote)"}</p>{i.details && <p className="text-[12px] text-[#4A5565]">{i.details}</p>}</td>
              <td className="py-2 text-right tabular">{Number(i.quantity)}</td><td className="py-2 text-right tabular">{money(i.unit_price)}</td><td className="py-2 text-right tabular">{money(i.line_total)}</td></tr>)}</tbody>
          </table>
          <div className="mt-3 ml-auto w-64 text-[13px]">
            <div className="flex justify-between py-0.5"><span>Subtotal</span><span className="tabular">{money(p.subtotal)}</span></div>
            {p.discount_type !== "none" && <div className="flex justify-between py-0.5"><span>Desconto</span><span className="tabular">− {money(Number(p.subtotal) - Number(p.total))}</span></div>}
            <div className="mt-1 flex justify-between border-t-2 border-[#0B0C12] pt-1.5 text-base font-semibold"><span>Total</span><span className="tabular">{money(p.total)}</span></div>
            {p.installments > 1 && <p className="mt-1 text-right text-[12px] text-[#4A5565]">em {p.installments}x de {money(Number(p.total) / p.installments)}{p.first_due_date && `, a partir de ${date(p.first_due_date)}`}</p>}
          </div>
        </section>
        <Section t="Condições" v={[p.terms, `Revisões incluídas: ${p.revisions} rodada(s) por etapa.`].filter(Boolean).join("\n")} />
        <footer className="mt-12 border-t border-[#E3E7ED] pt-3 text-[11px] text-[#7A8596]">Proposta válida até {date(p.valid_until)}. Valores em reais (BRL).</footer>
        <div className="mt-8 flex justify-center print:hidden"><Button variant="primary" onClick={() => window.print()}>Imprimir ou salvar em PDF</Button></div>
      </div>
    </div>
  );
}
