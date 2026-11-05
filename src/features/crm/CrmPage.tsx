import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { BriefcaseBusiness, CalendarClock, CheckCircle2, Plus, UserCheck } from "lucide-react";
import { useState } from "react";
import { useBreadcrumbs } from "@/components/layout/AppShell";
import { Badge, Button, EmptyState, ErrorState, Field, Input, Modal, PageHeader, Select, Skeleton, Textarea, useToast, cn } from "@/components/ui";
import { useOrg } from "@/features/auth/AuthProvider";
import { clientName } from "@/features/clients/ClientsPages";
import { errorMessage } from "@/lib/domain";
import { date, dateTime, money } from "@/lib/format";
import { supabase } from "@/lib/supabase";

type Stage = { id: string; name: string; position: number; kind: "open" | "won" | "lost" };
type Opp = { id: string; title: string; stage_id: string; estimated_value: number | null; expected_close: string | null; position: number; lead_id: string | null; client_id: string | null;
  lost_reason: string | null; leads: { name: string; company: string | null; converted_client_id: string | null } | null; clients: { legal_name: string; trade_name: string | null } | null };

export function CrmPage() {
  useBreadcrumbs([{ label: "CRM" }]);
  const { orgId, can } = useOrg();
  const qc = useQueryClient();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [openOpp, setOpenOpp] = useState<Opp | null>(null);
  const [lost, setLost] = useState<{ opp: string; stage: string } | null>(null);
  const [reason, setReason] = useState("");
  const write = can("crm.write");

  const stages = useQuery({ queryKey: ["stages", orgId], queryFn: async () => (await supabase.from("pipeline_stages").select("*").eq("organization_id", orgId).order("position")).data as Stage[] });
  const opps = useQuery({
    queryKey: ["opps", orgId],
    queryFn: async () => {
      const { data, error } = await supabase.from("opportunities").select("*, leads(name, company, converted_client_id), clients(legal_name, trade_name)").eq("organization_id", orgId).order("position");
      if (error) throw error;
      return data as Opp[];
    },
  });
  const move = useMutation({
    mutationFn: async ({ id, stage, lostReason }: { id: string; stage: string; lostReason?: string }) => {
      const { error } = await supabase.rpc("move_opportunity", { p_opportunity: id, p_stage: stage, p_position: Date.now() / 1000, p_lost_reason: lostReason ?? null });
      if (error) throw error;
    },
    onMutate: async ({ id, stage }) => {
      await qc.cancelQueries({ queryKey: ["opps", orgId] });
      const prev = qc.getQueryData<Opp[]>(["opps", orgId]);
      qc.setQueryData<Opp[]>(["opps", orgId], (o) => o?.map((x) => (x.id === id ? { ...x, stage_id: stage } : x)));
      return { prev };
    },
    onError: (e, _v, ctx) => { qc.setQueryData(["opps", orgId], ctx?.prev); toast({ tone: "error", message: errorMessage(e) }); },
    onSettled: () => qc.invalidateQueries({ queryKey: ["opps", orgId] }),
  });
  const drop = (oppId: string, stage: Stage) => {
    if (stage.kind === "lost") { setLost({ opp: oppId, stage: stage.id }); setReason(""); return; }
    move.mutate({ id: oppId, stage: stage.id });
  };

  const err = stages.error || opps.error;
  return (
    <>
      <PageHeader title="Pipeline comercial" description="Leads e negociações por etapa. Arraste os cards para avançar."
        actions={write && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>Nova oportunidade</Button>} />
      {err ? <ErrorState error={err} /> : stages.isLoading || opps.isLoading ? (
        <div className="flex gap-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-72 w-64" />)}</div>
      ) : !opps.data?.length ? (
        <EmptyState icon={<BriefcaseBusiness className="size-5" />} title="Nenhuma oportunidade" description="Cadastre um lead ou uma nova venda para um cliente existente."
          action={write ? <Button variant="primary" onClick={() => setCreating(true)}>Nova oportunidade</Button> : undefined} />
      ) : (
        <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-3 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 scrollbar-thin">
          {stages.data!.map((s) => {
            const items = opps.data!.filter((o) => o.stage_id === s.id);
            const total = items.reduce((a, o) => a + Number(o.estimated_value ?? 0), 0);
            return (
              <div key={s.id} className="flex w-64 shrink-0 flex-col rounded-lg bg-surface-2/70 p-2"
                onDragOver={(e) => { if (write) e.preventDefault(); }} onDrop={(e) => { const id = e.dataTransfer.getData("text/opp"); if (id) drop(id, s); }}>
                <div className="px-1.5 pb-2 pt-1">
                  <div className="flex items-center justify-between"><Badge tone={s.kind === "won" ? "success" : s.kind === "lost" ? "danger" : "neutral"} dot>{s.name}</Badge><span className="text-xs text-fg-3">{items.length}</span></div>
                  <p className="mt-1 text-[11px] text-fg-3 tabular">{money(total)}</p>
                </div>
                <div className="grid gap-2">
                  {items.map((o) => (
                    <button key={o.id} draggable={write} onDragStart={(e) => e.dataTransfer.setData("text/opp", o.id)} onClick={() => setOpenOpp(o)}
                      className="rounded-md border border-border bg-surface p-3 text-left shadow-sm transition-colors hover:border-border-strong">
                      <p className="text-sm font-medium leading-snug">{o.title}</p>
                      <p className="mt-0.5 truncate text-xs text-fg-3">{o.clients ? clientName(o.clients) : o.leads ? `${o.leads.name}${o.leads.company ? ` · ${o.leads.company}` : ""}` : "—"}</p>
                      <div className="mt-2 flex items-center justify-between text-xs">
                        <span className="tabular">{o.estimated_value ? money(o.estimated_value) : "—"}</span>
                        {o.expected_close && <span className="flex items-center gap-1 text-fg-3"><CalendarClock className="size-3" />{date(o.expected_close)}</span>}
                      </div>
                      {!o.client_id && <Badge tone="info" className="mt-2">Lead</Badge>}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {creating && <NewOpportunityModal stages={stages.data ?? []} onClose={() => setCreating(false)} />}
      {openOpp && <OpportunityModal opp={openOpp} canWrite={write} onClose={() => setOpenOpp(null)} />}
      <Modal open={!!lost} onClose={() => setLost(null)} title="Marcar como perdida" size="sm"
        footer={<><Button variant="ghost" onClick={() => setLost(null)}>Cancelar</Button>
          <Button variant="danger" disabled={reason.trim().length < 3} onClick={() => { move.mutate({ id: lost!.opp, stage: lost!.stage, lostReason: reason }); setLost(null); }}>Confirmar</Button></>}>
        <Field label="Motivo da perda" htmlFor="lost-reason" hint="Ajuda a entender o que melhorar nas próximas propostas."><Textarea id="lost-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </Modal>
    </>
  );
}

function NewOpportunityModal({ stages, onClose }: { stages: Stage[]; onClose: () => void }) {
  const { orgId } = useOrg();
  const qc = useQueryClient();
  const toast = useToast();
  const [mode, setMode] = useState<"lead" | "client">("lead");
  const [f, setF] = useState({ title: "", name: "", company: "", email: "", phone: "", source: "", client_id: "", value: "", close: "", stage_id: stages[0]?.id ?? "" });
  const [busy, setBusy] = useState(false);
  const clients = useQuery({ queryKey: ["clients", orgId], enabled: mode === "client", queryFn: async () => (await supabase.from("clients").select("id, legal_name, trade_name").eq("organization_id", orgId).order("legal_name")).data ?? [] });
  const valid = f.title.trim().length >= 2 && (mode === "lead" ? f.name.trim().length >= 2 : !!f.client_id) && !!f.stage_id;
  const save = async () => {
    setBusy(true);
    try {
      let leadId: string | null = null;
      if (mode === "lead") {
        const { data, error } = await supabase.from("leads").insert({ organization_id: orgId, name: f.name.trim(), company: f.company || null, email: f.email || null, phone: f.phone || null, source: f.source || null }).select("id").single();
        if (error) throw error;
        leadId = data.id;
      }
      const { error } = await supabase.from("opportunities").insert({ organization_id: orgId, title: f.title.trim(), lead_id: leadId, client_id: mode === "client" ? f.client_id : null,
        stage_id: f.stage_id, estimated_value: f.value ? Number(f.value.replace(/\./g, "").replace(",", ".")) : null, expected_close: f.close || null, position: Date.now() / 1000 });
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["opps", orgId] });
      toast({ tone: "success", message: "Oportunidade criada." });
      onClose();
    } catch (e) { toast({ tone: "error", message: errorMessage(e) }); } finally { setBusy(false); }
  };
  const bind = (k: keyof typeof f) => ({ value: f[k], onChange: (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value })) });
  return (
    <Modal open onClose={onClose} title="Nova oportunidade" size="lg"
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={busy} disabled={!valid} onClick={save}>Criar</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex gap-2 sm:col-span-2">
          {(["lead", "client"] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)} className={cn("flex-1 rounded-md border px-3 py-2 text-left text-sm", mode === m ? "border-accent bg-accent-soft/50" : "border-border")}>
              <span className="font-medium">{m === "lead" ? "Novo lead" : "Cliente existente"}</span>
              <span className="block text-xs text-fg-3">{m === "lead" ? "Pessoa ou empresa ainda não cliente" : "Nova venda para quem já é cliente"}</span>
            </button>
          ))}
        </div>
        <Field label="Título da oportunidade" required htmlFor="o-title" className="sm:col-span-2"><Input id="o-title" placeholder="Ex.: Identidade visual da nova loja" {...bind("title")} /></Field>
        {mode === "lead" ? (<>
          <Field label="Nome do contato" required htmlFor="o-name"><Input id="o-name" {...bind("name")} /></Field>
          <Field label="Empresa" htmlFor="o-company"><Input id="o-company" {...bind("company")} /></Field>
          <Field label="E-mail" htmlFor="o-email"><Input id="o-email" type="email" {...bind("email")} /></Field>
          <Field label="Telefone/WhatsApp" htmlFor="o-phone"><Input id="o-phone" {...bind("phone")} /></Field>
          <Field label="Origem" htmlFor="o-source"><Select id="o-source" {...bind("source")}><option value="">Não informada</option>{["Indicação", "Instagram", "Site", "Google", "Evento", "Prospecção ativa", "Outro"].map((s) => <option key={s}>{s}</option>)}</Select></Field>
        </>) : (
          <Field label="Cliente" required htmlFor="o-client"><Select id="o-client" {...bind("client_id")}><option value="">Selecione…</option>{clients.data?.map((c) => <option key={c.id} value={c.id}>{clientName(c)}</option>)}</Select></Field>
        )}
        <Field label="Etapa" htmlFor="o-stage"><Select id="o-stage" {...bind("stage_id")}>{stages.filter((s) => s.kind === "open").map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
        <Field label="Valor estimado (R$)" htmlFor="o-value"><Input id="o-value" inputMode="decimal" placeholder="0,00" {...bind("value")} /></Field>
        <Field label="Previsão de fechamento" htmlFor="o-close"><Input id="o-close" type="date" {...bind("close")} /></Field>
      </div>
    </Modal>
  );
}

function OpportunityModal({ opp, canWrite, onClose }: { opp: Opp; canWrite: boolean; onClose: () => void }) {
  const { orgId, can } = useOrg();
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const [act, setAct] = useState({ kind: "follow_up", subject: "", due: "" });
  const acts = useQuery({
    queryKey: ["opp-acts", opp.id],
    queryFn: async () => (await supabase.from("crm_activities").select("*").eq("opportunity_id", opp.id).order("created_at", { ascending: false })).data ?? [],
  });
  const addAct = async () => {
    if (act.subject.trim().length < 2) return;
    const { error } = await supabase.from("crm_activities").insert({ organization_id: orgId, kind: act.kind, subject: act.subject.trim(), opportunity_id: opp.id, lead_id: opp.lead_id, client_id: opp.client_id,
      due_at: act.due ? new Date(act.due + "T12:00:00-03:00").toISOString() : null, done_at: act.kind === "note" ? new Date().toISOString() : null });
    if (error) return toast({ tone: "error", message: errorMessage(error) });
    setAct({ kind: "follow_up", subject: "", due: "" }); acts.refetch();
  };
  const done = async (id: string) => { await supabase.from("crm_activities").update({ done_at: new Date().toISOString() }).eq("id", id); acts.refetch(); };
  const convert = async () => {
    if (!opp.lead_id) return;
    const { data, error } = await supabase.rpc("convert_lead_to_client", { p_lead: opp.lead_id });
    if (error) return toast({ tone: "error", message: errorMessage(error) });
    qc.invalidateQueries({ queryKey: ["opps", orgId] }); qc.invalidateQueries({ queryKey: ["clients"] });
    toast({ tone: "success", message: "Lead convertido em cliente. O histórico foi mantido." });
    onClose(); nav({ to: `/clientes/${data}` });
  };
  const kinds: Record<string, string> = { call: "Ligação", email: "E-mail", whatsapp: "WhatsApp", note: "Nota", follow_up: "Follow-up", meeting: "Reunião" };
  return (
    <Modal open onClose={onClose} size="lg" title={opp.title} description={opp.clients ? clientName(opp.clients) : opp.leads ? `Lead: ${opp.leads.name}${opp.leads.company ? ` · ${opp.leads.company}` : ""}` : undefined}
      footer={<>
        {canWrite && opp.lead_id && !opp.client_id && can("clients.write") && <Button icon={<UserCheck className="size-4" />} onClick={convert} className="mr-auto">Converter em cliente</Button>}
        {can("proposals.write") && (opp.client_id
          ? <Button variant="primary" onClick={() => { onClose(); nav({ to: "/propostas", search: { nova: opp.client_id, oportunidade: opp.id } }); }}>Criar proposta</Button>
          : <span className="mr-2 self-center text-xs text-fg-3">Converta o lead em cliente para criar a proposta.</span>)}
        <Button onClick={onClose}>Fechar</Button></>}>
      <div className="grid gap-5">
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <div><dt className="text-xs text-fg-3">Valor estimado</dt><dd className="tabular">{opp.estimated_value ? money(opp.estimated_value) : "—"}</dd></div>
          <div><dt className="text-xs text-fg-3">Previsão</dt><dd>{date(opp.expected_close)}</dd></div>
          {opp.lost_reason && <div className="col-span-2"><dt className="text-xs text-fg-3">Motivo da perda</dt><dd>{opp.lost_reason}</dd></div>}
        </dl>
        {canWrite && (
          <div className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[130px_1fr_150px_auto]">
            <Select aria-label="Tipo" value={act.kind} onChange={(e) => setAct((s) => ({ ...s, kind: e.target.value }))}>{Object.entries(kinds).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
            <Input aria-label="Descrição" placeholder="Ex.: ligar para apresentar a proposta" value={act.subject} onChange={(e) => setAct((s) => ({ ...s, subject: e.target.value }))} />
            <Input aria-label="Data" type="date" value={act.due} onChange={(e) => setAct((s) => ({ ...s, due: e.target.value }))} />
            <Button onClick={addAct} disabled={act.subject.trim().length < 2}>Registrar</Button>
          </div>
        )}
        <ol className="grid gap-2">
          {(acts.data ?? []).map((a) => (
            <li key={a.id} className="flex items-start gap-3 text-sm">
              <button aria-label="Concluir" disabled={!!a.done_at || !canWrite} onClick={() => done(a.id)} className={a.done_at ? "text-success" : "text-fg-3 hover:text-accent"}><CheckCircle2 className="mt-0.5 size-4" /></button>
              <div className="min-w-0 flex-1"><p className={a.done_at && a.kind !== "note" ? "text-fg-3 line-through" : ""}><Badge className="mr-1.5">{kinds[a.kind]}</Badge>{a.subject}</p>
                <p className="text-xs text-fg-3">{a.due_at ? `Para ${dateTime(a.due_at)}` : dateTime(a.created_at)}</p></div>
            </li>
          ))}
          {!acts.data?.length && <li className="text-sm text-fg-3">Nenhuma atividade registrada.</li>}
        </ol>
      </div>
    </Modal>
  );
}
