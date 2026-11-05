import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Eye, FileDown, FileSignature, History, PenLine, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useBreadcrumbs } from "@/components/layout/AppShell";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, Input, Modal, PageHeader, Spinner, Textarea, useToast } from "@/components/ui";
import { useOrg } from "@/features/auth/AuthProvider";
import { clientName } from "@/features/clients/ClientsPages";
import { errorMessage, type Tone } from "@/lib/domain";
import { date, dateTime, fillTemplate } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { ServerPdfButton, SignatureButton } from "./DocumentActions";

type CStatus = "draft" | "in_review" | "sent_for_signature" | "signed" | "cancelled" | "expired";
const statusLabel: Record<CStatus, string> = { draft: "Rascunho", in_review: "Revisado", sent_for_signature: "Aguardando assinatura", signed: "Assinado", cancelled: "Cancelado", expired: "Expirado" };
const statusTone: Record<CStatus, Tone> = { draft: "neutral", in_review: "info", sent_for_signature: "warning", signed: "success", cancelled: "neutral", expired: "neutral" };
type Contract = { id: string; organization_id: string; number: number; client_id: string; proposal_id: string | null; title: string; status: CStatus; current_version: number; client_visible: boolean;
  signed_at: string | null; created_at: string; clients: { legal_name: string; trade_name: string | null; email?: string | null } | null; signature_status_detail?: string | null };
type Version = { id: string; version: number; body_html: string; note: string | null; created_at: string; variables: Record<string, string> };

/** HTML do contrato é sanitizado por lista de tags permitidas antes de ser exibido. */
export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const allowed = new Set(["DIV", "P", "H1", "H2", "H3", "STRONG", "B", "EM", "I", "U", "UL", "OL", "LI", "BR", "TABLE", "THEAD", "TBODY", "TR", "TD", "TH", "MARK", "SPAN"]);
  const walk = (el: Element) => {
    for (const child of [...el.children]) {
      if (!allowed.has(child.tagName)) { child.replaceWith(...child.childNodes); continue; }
      for (const a of [...child.attributes]) if (a.name !== "data-missing") child.removeAttribute(a.name);
      walk(child);
    }
  };
  walk(doc.body);
  return doc.body.firstElementChild?.innerHTML ?? "";
}

export function ContractsPage() {
  useBreadcrumbs([{ label: "Contratos" }]);
  const { orgId, can } = useOrg();
  const nav = useNavigate();

  const { data, isLoading, error } = useQuery({
    queryKey: ["contracts", orgId],
    queryFn: async () => { const { data, error } = await supabase.from("contracts").select("*, clients(legal_name, trade_name)").eq("organization_id", orgId).order("number", { ascending: false }); if (error) throw error; return data as Contract[]; },
  });
  return (
    <>
      <PageHeader title="Contratos" description="Gerados a partir de modelos, com variáveis preenchidas e histórico de versões."
        actions={can("contracts.write") && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => nav({ to: "/contratos/novo" })}>Gerar contrato</Button>} />
      {error ? <ErrorState error={error} /> : isLoading ? <Spinner /> : !data?.length ? (
        <EmptyState icon={<FileSignature className="size-5" />} title="Nenhum contrato" description="Use “Gerar contrato” para preencher seus dados e os do cliente. Contratos também são gerados ao aprovar uma proposta." />
      ) : (
        <Card padded={false} className="overflow-hidden"><table className="w-full text-sm">
          <thead className="bg-surface-2 text-left text-xs text-fg-3"><tr><th className="px-4 py-2.5 font-medium">Nº</th><th className="px-4 py-2.5 font-medium">Contrato</th><th className="px-4 py-2.5 font-medium">Status</th><th className="hidden px-4 py-2.5 font-medium sm:table-cell">Versão</th></tr></thead>
          <tbody>{data.map((c) => (
            <tr key={c.id} className="border-t border-border hover:bg-surface-2/60">
              <td className="px-4 py-3 text-fg-3 tabular">{String(c.number).padStart(4, "0")}</td>
              <td className="px-4 py-3"><Link to={`/contratos/${c.id}`} className="font-medium hover:text-accent">{c.title}</Link><p className="text-xs text-fg-3">{clientName(c.clients)}</p></td>
              <td className="px-4 py-3"><Badge tone={statusTone[c.status]} dot>{statusLabel[c.status]}</Badge></td>
              <td className="hidden px-4 py-3 tabular sm:table-cell">v{c.current_version}</td>
            </tr>))}</tbody></table></Card>
      )}
    </>
  );
}

export function ContractDetailPage({ contractId }: { contractId: string }) {
  const { can } = useOrg();
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [viewVersion, setViewVersion] = useState<number | null>(null);
  const q = useQuery({
    queryKey: ["contract", contractId],
    queryFn: async () => {
      const [c, v, vars] = await Promise.all([
        supabase.from("contracts").select("*, clients(legal_name, trade_name, email)").eq("id", contractId).single(),
        supabase.from("contract_versions").select("*").eq("contract_id", contractId).order("version", { ascending: false }),
        supabase.rpc("contract_variables", { p_contract: contractId }),
      ]);
      if (c.error) throw c.error;
      return { c: c.data as Contract, versions: (v.data ?? []) as Version[], vars: (vars.data ?? {}) as Record<string, string> };
    },
  });
  useBreadcrumbs([{ label: "Contratos", to: "/contratos" }, { label: q.data ? `Nº ${String(q.data.c.number).padStart(4, "0")}` : "…" }]);
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <ErrorState error={q.error ?? "Contrato não encontrado."} />;
  const { c, versions, vars } = q.data;
  const current = versions.find((v) => v.version === (viewVersion ?? c.current_version)) ?? versions[0];
  const filled = fillTemplate(current?.body_html ?? "", vars);
  const locked = ["signed", "sent_for_signature", "cancelled"].includes(c.status);
  const write = can("contracts.write");
  const patch = async (p: Partial<Contract>, ok: string) => {
    const { error } = await supabase.from("contracts").update(p).eq("id", c.id);
    if (error) return toast({ tone: "error", message: errorMessage(error) });
    qc.invalidateQueries({ queryKey: ["contract", contractId] }); qc.invalidateQueries({ queryKey: ["contracts"] }); toast({ tone: "success", message: ok });
  };

  return (
    <>
      <PageHeader title={c.title} description={<>Contrato Nº {String(c.number).padStart(4, "0")} · <Link to={`/clientes/${c.client_id}`} className="hover:text-accent">{clientName(c.clients)}</Link></>}
        meta={<><Badge tone={statusTone[c.status]} dot>{statusLabel[c.status]}</Badge>{c.client_visible && <Badge tone="info">Visível no portal</Badge>}{c.proposal_id && <Link to={`/propostas/${c.proposal_id}`} className="text-xs text-accent hover:underline">Ver proposta</Link>}</>}
        actions={<>
          <a href={`/contratos/${c.id}/imprimir${viewVersion ? `?v=${viewVersion}` : ""}`} target="_blank" rel="noopener"><Button variant="ghost" icon={<FileDown className="size-4" />}>Imprimir</Button></a>
          <ServerPdfButton kind="contract" id={c.id} version={viewVersion ?? undefined} />
          {write && !locked && <Button icon={<PenLine className="size-4" />} onClick={() => setEditing(true)}>Revisar cláusulas</Button>}
          {write && c.status === "draft" && <Button variant="primary" disabled={filled.missing.length > 0} title={filled.missing.length ? "Preencha os campos pendentes" : undefined} onClick={() => patch({ status: "in_review" }, "Contrato marcado como revisado.")}>Marcar como revisado</Button>}
          {write && c.status === "in_review" && <SignatureButton contractId={c.id} ready={filled.missing.length === 0} defaultSigner={c.clients?.email ? { name: c.clients.legal_name, email: c.clients.email } : undefined} />}
        </>} />
      <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
        <Card className="min-w-0">
          {filled.missing.length > 0 && (
            <p role="alert" className="mb-4 rounded-md border border-warning/30 bg-warning-soft p-3 text-xs text-fg-2">
              Campos sem dados no cadastro: <strong>{filled.missing.join(", ")}</strong>. Complete o cliente, a proposta ou o projeto, ou edite as cláusulas.
            </p>)}
          <article className="contract-body max-w-none text-sm leading-relaxed [&_h1]:mb-4 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:mt-5 [&_h2]:mb-1.5 [&_h2]:font-semibold [&_mark]:rounded [&_mark]:bg-warning-soft [&_mark]:px-1 [&_mark]:text-warning [&_p]:mb-2"
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(filled.html) }} />
        </Card>
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader title="Versões" description="Cada revisão gera uma versão nova; as anteriores não mudam." />
            <ul className="grid gap-1.5">{versions.map((v) => (
              <li key={v.id}><button onClick={() => setViewVersion(v.version)} className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-2 ${current?.version === v.version ? "bg-surface-2" : ""}`}>
                <History className="mt-0.5 size-3.5 shrink-0 text-fg-3" /><span className="min-w-0"><span className="font-medium">v{v.version}</span>{v.version === c.current_version && <Badge tone="accent" className="ml-1.5">Atual</Badge>}
                  <span className="block text-xs text-fg-3">{dateTime(v.created_at)}{v.note ? ` · ${v.note}` : ""}</span></span></button></li>))}</ul>
          </Card>
          {write && (
            <Card>
              <CardHeader title="Portal do cliente" />
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[var(--accent)]" checked={c.client_visible}
                onChange={(e) => patch({ client_visible: e.target.checked }, e.target.checked ? "Contrato disponível no portal." : "Contrato oculto do portal.")} />
                <Eye className="size-4 text-fg-3" />Disponibilizar para o cliente</label>
              {c.status !== "cancelled" && c.status !== "signed" && <Button variant="ghost" size="sm" className="mt-4" onClick={() => patch({ status: "cancelled" }, "Contrato cancelado.")}>Cancelar contrato</Button>}
            </Card>
          )}
          <Card><CardHeader title="Assinatura" /><p className="text-xs text-fg-3">A assinatura com validade jurídica será feita por um provedor especializado. O status “Assinado” só é registrado pelo retorno do provedor, nunca por um botão de aceite.{c.signed_at && ` Assinado em ${date(c.signed_at)}.`}</p>{c.signature_status_detail && <p className="mt-2 text-xs font-medium text-fg-2">{c.signature_status_detail}</p>}</Card>
        </div>
      </div>
      {editing && current && <EditClauses contractId={c.id} base={current.body_html} vars={vars} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); setViewVersion(null); qc.invalidateQueries({ queryKey: ["contract", contractId] }); }} />}
    </>
  );
}

function EditClauses({ contractId, base, vars, onClose, onSaved }: { contractId: string; base: string; vars: Record<string, string>; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [html, setHtml] = useState(base);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const preview = useMemo(() => fillTemplate(html, vars), [html, vars]);
  useEffect(() => setHtml(base), [base]);
  const save = async () => {
    setBusy(true);
    const { error } = await supabase.rpc("save_contract_version", { p_contract: contractId, p_body_html: sanitizeHtml(html), p_note: note || null });
    setBusy(false);
    if (error) return toast({ tone: "error", message: errorMessage(error) });
    toast({ tone: "success", message: "Nova versão salva." }); onSaved();
  };
  return (
    <Modal open onClose={onClose} size="lg" title="Revisar cláusulas" description="Edite o texto (HTML simples). Variáveis como {{nome_cliente}} são preenchidas com os dados cadastrados."
      footer={<><Input aria-label="Nota da versão" placeholder="O que mudou nesta versão?" value={note} onChange={(e) => setNote(e.target.value)} className="mr-auto max-w-xs" />
        <Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={busy} onClick={save}>Salvar nova versão</Button></>}>
      <div className="grid gap-3">
        <Textarea aria-label="Cláusulas" rows={14} className="font-mono text-xs" value={html} onChange={(e) => setHtml(e.target.value)} />
        <p className="text-xs text-fg-3">Variáveis disponíveis: {Object.keys(vars).map((k) => `{{${k}}}`).join(" ")}</p>
        {preview.missing.length > 0 && <p className="text-xs text-warning">Sem valor: {preview.missing.join(", ")}</p>}
      </div>
    </Modal>
  );
}

export function ContractPrintPage({ contractId, version }: { contractId: string; version?: number }) {
  const { data } = useQuery({
    queryKey: ["contract-print", contractId, version],
    queryFn: async () => {
      const [c, v, vars] = await Promise.all([
        supabase.from("contracts").select("number, title, current_version").eq("id", contractId).single(),
        supabase.from("contract_versions").select("version, body_html").eq("contract_id", contractId).order("version", { ascending: false }),
        supabase.rpc("contract_variables", { p_contract: contractId }),
      ]);
      const want = version ?? c.data?.current_version;
      return { c: c.data, v: (v.data ?? []).find((x) => x.version === want), vars: (vars.data ?? {}) as Record<string, string> };
    },
  });
  useEffect(() => { if (data?.v) { document.title = `Contrato ${String(data.c?.number).padStart(4, "0")} v${data.v.version}`; setTimeout(() => window.print(), 400); } }, [data]);
  if (!data?.v) return <Spinner />;
  return (
    <div className="min-h-dvh bg-white text-[#0E1726]">
      <article className="mx-auto max-w-[760px] px-10 py-12 text-[13px] leading-relaxed print:p-0 [&_h1]:mb-5 [&_h1]:text-center [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mt-5 [&_h2]:mb-1 [&_h2]:font-semibold [&_p]:mb-2 [&_p]:text-justify"
        dangerouslySetInnerHTML={{ __html: sanitizeHtml(fillTemplate(data.v.body_html, data.vars).html) }} />
      <p className="mx-auto max-w-[760px] px-10 pb-10 text-[11px] text-[#7A8596] print:px-0">Versão {data.v.version} · gerado pelo NEXO Studio OS</p>
      <div className="flex justify-center pb-10 print:hidden"><Button variant="primary" onClick={() => window.print()}>Imprimir ou salvar em PDF</Button></div>
    </div>
  );
}
