import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { AlertTriangle, Building2, FileSignature, UserPlus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useBreadcrumbs } from "@/components/layout/AppShell";
import { Badge, Button, Card, CardHeader, Field, Input, PageHeader, Select, Spinner, Textarea, useToast, cn } from "@/components/ui";
import { useOrg } from "@/features/auth/AuthProvider";
import { clientName } from "@/features/clients/ClientsPages";
import { errorMessage } from "@/lib/domain";
import { date, fillTemplate, formatDocument, isValidDocument, money, onlyDigits, todayISO } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { sanitizeHtml } from "./ContractsPages";

type Party = { name: string; document: string; street: string; city: string; state: string; zip: string; rep: string; rep_document: string; email: string; phone: string };
const emptyParty: Party = { name: "", document: "", street: "", city: "", state: "", zip: "", rep: "", rep_document: "", email: "", phone: "" };
const NEW = "__novo__";

const addr = (p: Party) => [p.street, p.city && p.state ? `${p.city}/${p.state}` : p.city || p.state, p.zip && `CEP ${p.zip}`].filter(Boolean).join(", ");

/** Tela de geração de contrato: dados do estúdio, do cliente (cadastrado ou novo) e do serviço. */
export function ContractWizardPage({ proposalId }: { proposalId?: string }) {
  useBreadcrumbs([{ label: "Contratos", to: "/contratos" }, { label: "Gerar contrato" }]);
  const { orgId, can } = useOrg();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();

  const base = useQuery({
    queryKey: ["contract-wizard", orgId],
    queryFn: async () => {
      const [o, c, t] = await Promise.all([
        supabase.from("organizations").select("name, legal_name, document, email, phone, address, legal_representative").eq("id", orgId).single(),
        supabase.from("clients").select("*").eq("organization_id", orgId).neq("status", "inactive").order("legal_name"),
        supabase.from("contract_templates").select("id, name, category, body_html").eq("organization_id", orgId).eq("is_archived", false).order("name"),
      ]);
      return { org: o.data, clients: c.data ?? [], templates: (t.data ?? []).sort((a, b) => Number(b.name.startsWith("Contrato completo")) - Number(a.name.startsWith("Contrato completo"))) };
    },
  });

  const [studio, setStudio] = useState<Party>(emptyParty);
  const [saveStudio, setSaveStudio] = useState(true);
  const [clientId, setClientId] = useState("");
  const [client, setClient] = useState<Party>(emptyParty);
  const [saveClient, setSaveClient] = useState(true);
  const [templateId, setTemplateId] = useState("");
  const [proposal, setProposal] = useState(proposalId ?? "");
  const [svc, setSvc] = useState({ title: "", servico: "", escopo: "", entregaveis: "", valor: "", condicoes: "", inicio: todayISO(), entrega: "", revisoes: "2", aprovacao: "5", multa: "2", juros: "1", foro: "", cidade: "" });
  const [busy, setBusy] = useState(false);

  // Vindo de uma proposta: seleciona o cliente dela.
  useEffect(() => {
    if (!proposalId || clientId) return;
    supabase.from("proposals").select("client_id").eq("id", proposalId).single().then(({ data }) => { if (data) setClientId(data.client_id); });
  }, [proposalId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Preenche os dados do estúdio a partir do cadastro.
  useEffect(() => {
    const o = base.data?.org; if (!o) return;
    setStudio({ name: o.legal_name || o.name, document: o.document ? formatDocument(o.document) : "", street: o.address?.street ?? "", city: o.address?.city ?? "", state: o.address?.state ?? "",
      zip: o.address?.zip ?? "", rep: o.legal_representative?.name ?? "", rep_document: o.legal_representative?.document ? formatDocument(o.legal_representative.document) : "", email: o.email ?? "", phone: o.phone ?? "" });
    setSvc((s) => ({ ...s, foro: s.foro || (o.address?.city ?? ""), cidade: s.cidade || (o.address?.city ?? "") }));
    if (!templateId && base.data?.templates[0]) setTemplateId(base.data.templates[0].id);
  }, [base.data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ao escolher um cliente cadastrado, carrega os dados (editáveis).
  useEffect(() => {
    if (!clientId || clientId === NEW) { if (clientId === NEW) setClient(emptyParty); return; }
    const c = base.data?.clients.find((x) => x.id === clientId); if (!c) return;
    setClient({ name: c.legal_name, document: c.document ? formatDocument(c.document) : "", street: c.address?.street ?? "", city: c.address?.city ?? "", state: c.address?.state ?? "", zip: c.address?.zip ?? "",
      rep: c.address?.contact_name ?? "", rep_document: c.address?.contact_document ? formatDocument(c.address.contact_document) : "", email: c.email ?? "", phone: c.phone ?? c.whatsapp ?? "" });
  }, [clientId, base.data]);

  const proposals = useQuery({
    queryKey: ["wizard-proposals", clientId], enabled: !!clientId && clientId !== NEW && can("proposals.read"),
    queryFn: async () => (await supabase.from("proposals").select("id, number, title, scope, deliverables, total, installments, first_due_date, terms, revisions, status").eq("client_id", clientId).neq("status", "draft").order("number", { ascending: false })).data ?? [],
  });
  useEffect(() => {
    const p = proposals.data?.find((x) => x.id === proposal); if (!p) return;
    setSvc((s) => ({ ...s, title: s.title || `Contrato — ${p.title}`, servico: p.title, escopo: p.scope ?? s.escopo, entregaveis: p.deliverables ?? s.entregaveis,
      valor: money(p.total), revisoes: String(p.revisions ?? 2),
      condicoes: `${p.installments}x de ${money(Number(p.total) / p.installments)}${p.first_due_date ? `, primeira parcela em ${date(p.first_due_date)}` : ""}${p.terms ? `. ${p.terms}` : ""}` }));
  }, [proposal, proposals.data]);

  const template = base.data?.templates.find((t) => t.id === templateId);
  const vars = useMemo(() => ({
    nome_estudio: studio.name, documento_estudio: studio.document, endereco_estudio: addr(studio), representante_estudio: studio.rep, cpf_representante_estudio: studio.rep_document, email_estudio: studio.email,
    nome_cliente: client.name, cpf_cnpj: client.document, endereco_cliente: addr(client), representante_cliente: client.rep, cpf_representante_cliente: client.rep_document, email_cliente: client.email,
    servico_contratado: svc.servico, escopo: svc.escopo, entregaveis: svc.entregaveis, valor_total: svc.valor, condicoes_pagamento: svc.condicoes,
    data_inicio: svc.inicio ? date(svc.inicio) : "", data_entrega: svc.entrega ? date(svc.entrega) : "", numero_revisoes: svc.revisoes, prazo_aprovacao: svc.aprovacao,
    multa_atraso: svc.multa, juros_atraso: svc.juros, cidade_foro: svc.foro, cidade_assinatura: svc.cidade, data_hoje: date(todayISO()),
  }), [studio, client, svc]);
  const filled = useMemo(() => fillTemplate(template?.body_html ?? "", vars), [template, vars]);

  const docErr = (d: string) => (d && !isValidDocument(d) ? "CPF ou CNPJ inválido." : undefined);
  const errors = [
    !template && "Escolha o modelo de contrato.",
    !clientId && "Selecione o cliente ou escolha “Cliente não cadastrado”.",
    client.name.trim().length < 2 && "Informe o nome ou a razão social do cliente.",
    docErr(client.document) && "CPF/CNPJ do cliente inválido.", docErr(studio.document) && "CPF/CNPJ do estúdio inválido.",
    docErr(client.rep_document) && "CPF do representante do cliente inválido.", docErr(studio.rep_document) && "CPF do representante do estúdio inválido.",
  ].filter(Boolean) as string[];

  const generate = async () => {
    if (errors.length) return toast({ tone: "error", message: errors[0] });
    setBusy(true);
    try {
      const address = (p: Party) => Object.fromEntries(Object.entries({ street: p.street, city: p.city, state: p.state.toUpperCase(), zip: p.zip, contact_name: p.rep, contact_document: onlyDigits(p.rep_document) || undefined }).filter(([, v]) => v));
      let cid = clientId;
      if (clientId === NEW) {
        const { data, error } = await supabase.from("clients").insert({ organization_id: orgId, legal_name: client.name.trim(), document: onlyDigits(client.document) || null,
          email: client.email || null, phone: client.phone || null, address: address(client), status: "active" }).select("id").single();
        if (error) throw error;
        cid = data.id;
      } else if (saveClient && can("clients.write")) {
        const { error } = await supabase.from("clients").update({ legal_name: client.name.trim(), document: onlyDigits(client.document) || null, email: client.email || null,
          phone: client.phone || null, address: address(client) }).eq("id", clientId);
        if (error) throw error;
      }
      if (saveStudio && can("settings.manage")) {
        const { error } = await supabase.from("organizations").update({ legal_name: studio.name || null, document: onlyDigits(studio.document) || null, email: studio.email || null,
          address: { street: studio.street, city: studio.city, state: studio.state.toUpperCase(), zip: studio.zip },
          legal_representative: { name: studio.rep, document: onlyDigits(studio.rep_document) } }).eq("id", orgId);
        if (error) throw error;
      }
      const { data: id, error } = await supabase.rpc("generate_contract", { p_client: cid, p_template: template!.id, p_title: svc.title || `Contrato — ${svc.servico || client.name}`,
        p_body_html: sanitizeHtml(filled.html), p_variables: vars, p_proposal: proposal || null });
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["contracts"] }); qc.invalidateQueries({ queryKey: ["clients"] });
      toast({ tone: "success", message: filled.missing.length ? `Contrato gerado. ${filled.missing.length} campo(s) ficaram para completar na revisão.` : "Contrato gerado." });
      nav({ to: `/contratos/${id}` });
    } catch (e) { toast({ tone: "error", message: errorMessage(e) }); } finally { setBusy(false); }
  };

  if (base.isLoading) return <Spinner />;
  const PartyFields = ({ p, set, prefix, kind }: { p: Party; set: (p: Party) => void; prefix: string; kind: "studio" | "client" }) => {
    const b = (k: keyof Party) => ({ id: `${prefix}-${k}`, value: p[k], onChange: (e: { target: { value: string } }) => set({ ...p, [k]: e.target.value }) });
    return (
      <div className="grid gap-3 sm:grid-cols-6">
        <Field label={kind === "studio" ? "Razão social ou nome" : "Nome ou razão social"} required={kind === "client"} htmlFor={`${prefix}-name`} className="sm:col-span-4"><Input {...b("name")} /></Field>
        <Field label="CPF/CNPJ" htmlFor={`${prefix}-document`} error={docErr(p.document)} className="sm:col-span-2"><Input inputMode="numeric" {...b("document")} /></Field>
        <Field label="Endereço (rua, número, bairro)" htmlFor={`${prefix}-street`} className="sm:col-span-6"><Input {...b("street")} /></Field>
        <Field label="Cidade" htmlFor={`${prefix}-city`} className="sm:col-span-3"><Input {...b("city")} /></Field>
        <Field label="UF" htmlFor={`${prefix}-state`} className="sm:col-span-1"><Input maxLength={2} {...b("state")} /></Field>
        <Field label="CEP" htmlFor={`${prefix}-zip`} className="sm:col-span-2"><Input inputMode="numeric" {...b("zip")} /></Field>
        <Field label="Representante legal" htmlFor={`${prefix}-rep`} className="sm:col-span-3"><Input {...b("rep")} /></Field>
        <Field label="CPF do representante" htmlFor={`${prefix}-rep_document`} error={docErr(p.rep_document)} className="sm:col-span-3"><Input inputMode="numeric" {...b("rep_document")} /></Field>
        <Field label="E-mail" htmlFor={`${prefix}-email`} className="sm:col-span-3"><Input type="email" {...b("email")} /></Field>
        <Field label="Telefone" htmlFor={`${prefix}-phone`} className="sm:col-span-3"><Input type="tel" {...b("phone")} /></Field>
      </div>
    );
  };
  const s = (k: keyof typeof svc) => ({ id: `sv-${k}`, value: svc[k], onChange: (e: { target: { value: string } }) => setSvc((x) => ({ ...x, [k]: e.target.value })) });

  return (
    <>
      <PageHeader title="Gerar contrato" description="Preencha os dados das partes e do serviço. A prévia ao lado mostra o contrato pronto; depois de gerado, você ainda pode revisar as cláusulas."
        actions={<><Button variant="ghost" onClick={() => nav({ to: "/contratos" })}>Cancelar</Button>
          <Button variant="primary" icon={<FileSignature className="size-4" />} loading={busy} disabled={errors.length > 0} title={errors[0]} onClick={generate}>Gerar contrato</Button></>} />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="grid content-start gap-5">
          <Card>
            <CardHeader title="1. Cliente (contratante)" description="Selecione um cliente cadastrado ou preencha os dados de um cliente novo." />
            <div className="grid gap-4">
              <Field label="Cliente" required htmlFor="wz-client">
                <Select id="wz-client" value={clientId} onChange={(e) => { setClientId(e.target.value); if (!proposalId) setProposal(""); }}>
                  <option value="">Selecione…</option>
                  <option value={NEW}>+ Cliente não cadastrado (preencher abaixo)</option>
                  {base.data?.clients.map((c) => <option key={c.id} value={c.id}>{clientName(c)}{c.document ? ` · ${formatDocument(c.document)}` : ""}</option>)}
                </Select>
              </Field>
              {clientId && (
                <div className={cn("rounded-lg border p-4", clientId === NEW ? "border-accent/40 bg-accent-soft/30" : "border-border")}>
                  <p className="mb-3 flex items-center gap-2 text-xs font-medium text-fg-2">{clientId === NEW ? <><UserPlus className="size-3.5" />Novo cliente — será cadastrado ao gerar o contrato</> : <><Building2 className="size-3.5" />Dados do cliente (editáveis)</>}</p>
                  {PartyFields({ p: client, set: setClient, prefix: "cl", kind: "client" })}
                  {clientId !== NEW && can("clients.write") && <label className="mt-3 flex items-center gap-2 text-sm text-fg-2"><input type="checkbox" className="accent-[var(--accent)]" checked={saveClient} onChange={(e) => setSaveClient(e.target.checked)} />Atualizar o cadastro do cliente com estes dados</label>}
                </div>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="2. Seus dados (contratada)" description="Vêm do cadastro do estúdio. Ajuste se precisar." />
            {PartyFields({ p: studio, set: setStudio, prefix: "st", kind: "studio" })}
            {can("settings.manage") && <label className="mt-3 flex items-center gap-2 text-sm text-fg-2"><input type="checkbox" className="accent-[var(--accent)]" checked={saveStudio} onChange={(e) => setSaveStudio(e.target.checked)} />Salvar estes dados no cadastro do estúdio</label>}
          </Card>

          <Card>
            <CardHeader title="3. Contrato e serviço" />
            <div className="grid gap-3 sm:grid-cols-6">
              <Field label="Modelo de contrato" required htmlFor="wz-tpl" className="sm:col-span-6"><Select id="wz-tpl" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                {base.data?.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
              {!!proposals.data?.length && <Field label="Preencher a partir de uma proposta" htmlFor="wz-prop" className="sm:col-span-6"><Select id="wz-prop" value={proposal} onChange={(e) => setProposal(e.target.value)}>
                <option value="">Não usar proposta</option>{proposals.data.map((p) => <option key={p.id} value={p.id}>Nº {String(p.number).padStart(4, "0")} · {p.title} · {money(p.total)}</option>)}</Select></Field>}
              <Field label="Título do contrato" htmlFor="sv-title" className="sm:col-span-6"><Input placeholder="Ex.: Contrato — Identidade visual Arara" {...s("title")} /></Field>
              <Field label="Serviço contratado" htmlFor="sv-servico" className="sm:col-span-6"><Input {...s("servico")} /></Field>
              <Field label="Escopo" htmlFor="sv-escopo" className="sm:col-span-6"><Textarea rows={3} {...s("escopo")} /></Field>
              <Field label="Entregáveis" htmlFor="sv-entregaveis" className="sm:col-span-6"><Textarea rows={2} {...s("entregaveis")} /></Field>
              <Field label="Valor total" htmlFor="sv-valor" className="sm:col-span-2"><Input placeholder="R$ 0,00" {...s("valor")} /></Field>
              <Field label="Condições de pagamento" htmlFor="sv-condicoes" className="sm:col-span-4"><Input placeholder="Ex.: 50% na assinatura e 50% na entrega, via PIX" {...s("condicoes")} /></Field>
              <Field label="Início" htmlFor="sv-inicio" className="sm:col-span-2"><Input type="date" {...s("inicio")} /></Field>
              <Field label="Entrega final" htmlFor="sv-entrega" className="sm:col-span-2"><Input type="date" {...s("entrega")} /></Field>
              <Field label="Revisões por etapa" htmlFor="sv-revisoes" className="sm:col-span-2"><Input type="number" min={0} {...s("revisoes")} /></Field>
              <Field label="Prazo de aprovação (dias úteis)" htmlFor="sv-aprovacao" className="sm:col-span-2"><Input type="number" min={1} {...s("aprovacao")} /></Field>
              <Field label="Multa por atraso (%)" htmlFor="sv-multa" className="sm:col-span-2"><Input type="number" min={0} step="0.5" {...s("multa")} /></Field>
              <Field label="Juros ao mês (%)" htmlFor="sv-juros" className="sm:col-span-2"><Input type="number" min={0} step="0.5" {...s("juros")} /></Field>
              <Field label="Foro (comarca)" htmlFor="sv-foro" className="sm:col-span-3"><Input {...s("foro")} /></Field>
              <Field label="Cidade da assinatura" htmlFor="sv-cidade" className="sm:col-span-3"><Input {...s("cidade")} /></Field>
            </div>
          </Card>
        </div>

        <div className="xl:sticky xl:top-4 xl:self-start">
          <Card className="min-w-0">
            <CardHeader title="Prévia do contrato" description={template?.name}
              actions={filled.missing.length ? <Badge tone="warning">{filled.missing.length} campo(s) em branco</Badge> : <Badge tone="success">Tudo preenchido</Badge>} />
            {filled.missing.length > 0 && <p className="mb-3 flex gap-2 rounded-md bg-warning-soft p-2.5 text-xs text-fg-2"><AlertTriangle className="size-4 shrink-0 text-warning" />
              Campos destacados ficam em branco no contrato: {filled.missing.join(", ")}. Você pode gerar assim e completar na revisão.</p>}
            <article className="max-h-[70vh] overflow-y-auto pr-2 text-[13px] leading-relaxed [&_h1]:mb-3 [&_h1]:text-center [&_h1]:text-base [&_h1]:font-semibold [&_h2]:mt-4 [&_h2]:mb-1 [&_h2]:font-semibold [&_mark]:rounded [&_mark]:bg-warning-soft [&_mark]:px-1 [&_mark]:text-warning [&_p]:mb-2 scrollbar-thin"
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(filled.html) }} />
            <p className="mt-3 border-t border-border pt-3 text-[11px] text-fg-3">Modelo de referência. Para contratos de valor alto ou com condições especiais, peça uma revisão jurídica.</p>
          </Card>
        </div>
      </div>
    </>
  );
}
