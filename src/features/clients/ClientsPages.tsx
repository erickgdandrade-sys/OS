import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Building2, Globe, Mail, MessageCircle, Pencil, Phone, Plus, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useBreadcrumbs } from "@/components/layout/AppShell";
import {
  Badge, Button, Card, CardHeader, ConfirmDialog, EmptyState, ErrorState, Field, Input, Modal, PageHeader, Select, Skeleton, Spinner, Tabs, Textarea, useToast,
} from "@/components/ui";
import { useOrg } from "@/features/auth/AuthProvider";
import {
  categoryLabel, clientStatusLabel, errorMessage, projectStatusLabel, projectStatusTone, type Client, type ClientStatus, type Project,
} from "@/lib/domain";
import { date, dateTime, formatDocument, isValidDocument, money, onlyDigits } from "@/lib/format";
import { supabase } from "@/lib/supabase";

/* --------------------------------------------------------------- Dados */
export const clientName = (c?: { legal_name: string; trade_name?: string | null } | null) => (c ? c.trade_name || c.legal_name : "—");

function useClients(orgId: string) {
  return useQuery({
    queryKey: ["clients", orgId],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("*").eq("organization_id", orgId).order("legal_name");
      if (error) throw error;
      return data as Client[];
    },
  });
}

/* ------------------------------------------------------------ Formulário */
const optional = z.string().trim().optional().transform((v) => (v ? v : null));
const clientSchema = z.object({
  legal_name: z.string().trim().min(2, "Informe o nome ou a razão social.").max(200),
  trade_name: optional,
  document: z.string().trim().optional().refine((v) => !v || isValidDocument(v), "CPF ou CNPJ inválido.").transform((v) => (v ? onlyDigits(v) : null)),
  email: z.string().trim().optional().refine((v) => !v || z.email().safeParse(v).success, "E-mail inválido.").transform((v) => v || null),
  phone: optional, whatsapp: optional, website: optional, segment: optional, notes: optional,
  status: z.enum(["lead", "active", "inactive"]),
  contact_name: optional, instagram: optional, linkedin: optional,
  street: optional, city: optional, state: optional, zip: optional,
});
type ClientForm = z.input<typeof clientSchema>;

export function ClientFormModal({ open, onClose, client }: { open: boolean; onClose: () => void; client?: Client }) {
  const { orgId, userId } = useOrg();
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<ClientForm, unknown, z.output<typeof clientSchema>>({
    resolver: zodResolver(clientSchema),
    values: client ? {
      legal_name: client.legal_name, trade_name: client.trade_name ?? "", document: client.document ? formatDocument(client.document) : "",
      email: client.email ?? "", phone: client.phone ?? "", whatsapp: client.whatsapp ?? "", website: client.website ?? "",
      segment: client.segment ?? "", notes: client.notes ?? "", status: client.status, contact_name: client.address?.contact_name ?? "",
      instagram: client.social_links?.instagram ?? "", linkedin: client.social_links?.linkedin ?? "",
      street: client.address?.street ?? "", city: client.address?.city ?? "", state: client.address?.state ?? "", zip: client.address?.zip ?? "",
    } : { legal_name: "", status: "active" },
  });
  const onSubmit = handleSubmit(async (v) => {
    const row = {
      legal_name: v.legal_name, trade_name: v.trade_name, document: v.document, email: v.email, phone: v.phone, whatsapp: v.whatsapp,
      website: v.website, segment: v.segment, notes: v.notes, status: v.status as ClientStatus,
      address: Object.fromEntries(Object.entries({ street: v.street, city: v.city, state: v.state, zip: v.zip, contact_name: v.contact_name }).filter(([, x]) => x)),
      social_links: Object.fromEntries(Object.entries({ instagram: v.instagram, linkedin: v.linkedin }).filter(([, x]) => x)),
    };
    const res = client
      ? await supabase.from("clients").update(row).eq("id", client.id).select().single()
      : await supabase.from("clients").insert({ ...row, organization_id: orgId, created_by: userId, owner_id: userId }).select().single();
    if (res.error) { toast({ tone: "error", message: errorMessage(res.error) }); return; }
    qc.invalidateQueries({ queryKey: ["clients"] });
    qc.invalidateQueries({ queryKey: ["client", res.data.id] });
    toast({ tone: "success", message: client ? "Cliente atualizado." : "Cliente criado." });
    reset(); onClose();
    if (!client) nav({ to: `/clientes/${res.data.id}` });
  });
  return (
    <Modal open={open} onClose={onClose} size="lg" title={client ? "Editar cliente" : "Novo cliente"}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={isSubmitting} onClick={onSubmit}>{client ? "Salvar" : "Criar cliente"}</Button></>}>
      <form onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome ou razão social" required htmlFor="legal_name" error={errors.legal_name?.message} className="sm:col-span-2">
          <Input id="legal_name" aria-invalid={!!errors.legal_name} {...register("legal_name")} />
        </Field>
        <Field label="Nome fantasia" htmlFor="trade_name"><Input id="trade_name" {...register("trade_name")} /></Field>
        <Field label="CPF/CNPJ" htmlFor="document" error={errors.document?.message}><Input id="document" inputMode="numeric" aria-invalid={!!errors.document} {...register("document")} /></Field>
        <Field label="E-mail" htmlFor="email" error={errors.email?.message}><Input id="email" type="email" aria-invalid={!!errors.email} {...register("email")} /></Field>
        <Field label="Responsável pelo contato" htmlFor="contact_name"><Input id="contact_name" {...register("contact_name")} /></Field>
        <Field label="Telefone" htmlFor="phone"><Input id="phone" type="tel" {...register("phone")} /></Field>
        <Field label="WhatsApp" htmlFor="whatsapp"><Input id="whatsapp" type="tel" {...register("whatsapp")} /></Field>
        <Field label="Segmento" htmlFor="segment"><Input id="segment" placeholder="Ex.: alimentação, moda" {...register("segment")} /></Field>
        <Field label="Status" htmlFor="status">
          <Select id="status" {...register("status")}>{Object.entries(clientStatusLabel).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
        </Field>
        <Field label="Site" htmlFor="website"><Input id="website" placeholder="https://" {...register("website")} /></Field>
        <Field label="Instagram" htmlFor="instagram"><Input id="instagram" placeholder="@perfil" {...register("instagram")} /></Field>
        <Field label="Endereço" htmlFor="street" className="sm:col-span-2"><Input id="street" {...register("street")} /></Field>
        <div className="grid grid-cols-[1fr_80px_120px] gap-3 sm:col-span-2">
          <Field label="Cidade" htmlFor="city"><Input id="city" {...register("city")} /></Field>
          <Field label="UF" htmlFor="state"><Input id="state" maxLength={2} {...register("state")} /></Field>
          <Field label="CEP" htmlFor="zip"><Input id="zip" inputMode="numeric" {...register("zip")} /></Field>
        </div>
        <Field label="Observações" htmlFor="notes" className="sm:col-span-2"><Textarea id="notes" {...register("notes")} /></Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

/* --------------------------------------------------------------- Lista */
export function ClientsPage() {
  useBreadcrumbs([{ label: "Clientes" }]);
  const { orgId, can } = useOrg();
  const { data, isLoading, error, refetch } = useClients(orgId);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<ClientStatus | "all">("active");
  const [creating, setCreating] = useState(false);
  const list = useMemo(() => (data ?? []).filter((c) =>
    (status === "all" || c.status === status) &&
    (!q || `${c.legal_name} ${c.trade_name ?? ""} ${c.email ?? ""} ${c.document ?? ""}`.toLowerCase().includes(q.toLowerCase()))), [data, q, status]);

  return (
    <>
      <PageHeader title="Clientes" description="Cadastro, contatos e histórico de relacionamento."
        actions={can("clients.write") && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>Novo cliente</Button>} />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-fg-3" />
          <Input aria-label="Buscar clientes" placeholder="Buscar por nome, e-mail ou documento" value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" />
        </div>
        <Select aria-label="Filtrar por status" value={status} onChange={(e) => setStatus(e.target.value as ClientStatus | "all")} className="sm:w-40">
          <option value="all">Todos</option>{Object.entries(clientStatusLabel).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </Select>
      </div>
      {error ? <ErrorState error={error} onRetry={refetch} /> : isLoading ? (
        <Card padded={false}>{[0, 1, 2, 3].map((i) => <div key={i} className="flex gap-3 border-b border-border p-4 last:border-0"><Skeleton className="h-4 w-48" /><Skeleton className="ml-auto h-4 w-24" /></div>)}</Card>
      ) : list.length === 0 ? (
        <EmptyState icon={<Building2 className="size-5" />} title={data?.length ? "Nenhum cliente com esses filtros" : "Nenhum cliente cadastrado"}
          description={data?.length ? "Ajuste a busca ou o filtro de status." : "Cadastre o primeiro cliente para começar a criar projetos."}
          action={!data?.length && can("clients.write") ? <Button variant="primary" onClick={() => setCreating(true)}>Cadastrar cliente</Button> : undefined} />
      ) : (
        <Card padded={false} className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-left text-xs text-fg-3">
                <tr><th className="px-4 py-2.5 font-medium">Cliente</th><th className="hidden px-4 py-2.5 font-medium md:table-cell">Contato</th>
                  <th className="hidden px-4 py-2.5 font-medium lg:table-cell">Segmento</th><th className="px-4 py-2.5 font-medium">Status</th></tr>
              </thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.id} className="border-t border-border transition-colors hover:bg-surface-2/60">
                    <td className="px-4 py-3">
                      <Link to={`/clientes/${c.id}`} className="font-medium hover:text-accent">{clientName(c)}</Link>
                      {c.trade_name && <p className="text-xs text-fg-3">{c.legal_name}</p>}
                    </td>
                    <td className="hidden px-4 py-3 text-fg-2 md:table-cell">{c.email ?? c.phone ?? "—"}</td>
                    <td className="hidden px-4 py-3 text-fg-2 lg:table-cell">{c.segment ?? "—"}</td>
                    <td className="px-4 py-3"><Badge tone={c.status === "active" ? "success" : c.status === "lead" ? "info" : "neutral"} dot>{clientStatusLabel[c.status]}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <ClientFormModal open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

/* ------------------------------------------------------------- Detalhe */
export function ClientDetailPage({ clientId }: { clientId: string }) {
  const { can } = useOrg();
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const [tab, setTab] = useState<"projects" | "history" | "contacts">("projects");
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const { data: client, isLoading, error } = useQuery({
    queryKey: ["client", clientId],
    queryFn: async () => { const { data, error } = await supabase.from("clients").select("*").eq("id", clientId).single(); if (error) throw error; return data as Client; },
  });
  const projects = useQuery({
    queryKey: ["client-projects", clientId],
    queryFn: async () => (await supabase.from("projects").select("*").eq("client_id", clientId).order("created_at", { ascending: false })).data as Project[],
  });
  const history = useQuery({
    queryKey: ["client-history", clientId],
    enabled: tab === "history",
    queryFn: async () => (await supabase.from("activity_logs").select("*").eq("entity_id", clientId).order("created_at", { ascending: false }).limit(50)).data ?? [],
  });
  const contacts = useQuery({
    queryKey: ["client-contacts", clientId],
    enabled: tab === "contacts",
    queryFn: async () => (await supabase.from("client_contacts").select("*").eq("client_id", clientId).order("is_primary", { ascending: false })).data ?? [],
  });
  const del = useMutation({
    mutationFn: async () => { const { error } = await supabase.from("clients").delete().eq("id", clientId); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["clients"] }); toast({ tone: "success", message: "Cliente excluído." }); nav({ to: "/clientes" }); },
    onError: (e) => { setDeleting(false); toast({ tone: "error", message: /foreign key|violates/i.test(String((e as Error).message)) ? "Este cliente tem projetos ou lançamentos vinculados. Marque-o como inativo." : errorMessage(e) }); },
  });

  useBreadcrumbs([{ label: "Clientes", to: "/clientes" }, { label: client ? clientName(client) : "…" }]);
  if (isLoading) return <Spinner />;
  if (error || !client) return <ErrorState error={error ?? "Cliente não encontrado ou sem permissão."} />;

  const contactLine = [
    client.email && { icon: Mail, text: client.email, href: `mailto:${client.email}` },
    client.phone && { icon: Phone, text: client.phone },
    client.whatsapp && { icon: MessageCircle, text: client.whatsapp },
    client.website && { icon: Globe, text: client.website.replace(/^https?:\/\//, ""), href: client.website.startsWith("http") ? client.website : `https://${client.website}` },
  ].filter(Boolean) as { icon: typeof Mail; text: string; href?: string }[];

  return (
    <>
      <PageHeader title={clientName(client)} description={client.trade_name ? client.legal_name : undefined}
        meta={<><Badge tone={client.status === "active" ? "success" : "neutral"} dot>{clientStatusLabel[client.status]}</Badge>
          {client.document && <span className="text-xs text-fg-3 tabular">{formatDocument(client.document)}</span>}
          {client.segment && <span className="text-xs text-fg-3">· {client.segment}</span>}</>}
        actions={can("clients.write") && <>
          <Button icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>Editar</Button>
          <Button variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => setDeleting(true)}>Excluir</Button></>} />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0">
          <Tabs value={tab} onChange={setTab} items={[
            { value: "projects", label: "Projetos", count: projects.data?.length },
            { value: "contacts", label: "Contatos" },
            { value: "history", label: "Histórico" },
          ]} />
          <div className="pt-4">
            {tab === "projects" && (projects.isLoading ? <Spinner /> : !projects.data?.length ? (
              <EmptyState title="Nenhum projeto com este cliente" description="Projetos criados para este cliente aparecem aqui." />
            ) : (
              <ul className="grid gap-2">
                {projects.data.map((p) => (
                  <li key={p.id}><Link to={`/projetos/${p.id}`} className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3 hover:border-border-strong">
                    <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{p.name}</p><p className="text-xs text-fg-3">{categoryLabel[p.category]} · prazo {date(p.due_date)}</p></div>
                    <Badge tone={projectStatusTone[p.status]}>{projectStatusLabel[p.status]}</Badge>
                  </Link></li>
                ))}
              </ul>
            ))}
            {tab === "contacts" && (contacts.isLoading ? <Spinner /> : !contacts.data?.length ? (
              <EmptyState title="Nenhum contato adicional" description="Contatos convertidos de leads e cadastrados no CRM (Fase 2) aparecem aqui." />
            ) : (
              <ul className="grid gap-2">{contacts.data.map((c: { id: string; name: string; role: string | null; email: string | null; phone: string | null }) => (
                <li key={c.id} className="rounded-lg border border-border bg-surface p-3 text-sm"><p className="font-medium">{c.name}</p><p className="text-xs text-fg-3">{[c.role, c.email, c.phone].filter(Boolean).join(" · ")}</p></li>
              ))}</ul>
            ))}
            {tab === "history" && (history.isLoading ? <Spinner /> : (
              <ol className="relative ml-2 border-l border-border">
                {(history.data ?? []).map((h: { id: number; action: string; changes: Record<string, unknown>; created_at: string }) => (
                  <li key={h.id} className="mb-4 ml-4">
                    <span className="absolute -left-1 mt-1.5 size-2 rounded-full bg-border-strong" />
                    <p className="text-sm">{h.action === "insert" ? "Cliente cadastrado" : h.action === "update" ? `Atualizado: ${Object.keys(h.changes).join(", ")}` : h.action}</p>
                    <p className="text-xs text-fg-3">{dateTime(h.created_at)}</p>
                  </li>
                ))}
                {!history.data?.length && <li className="ml-4 text-sm text-fg-3">Sem registros.</li>}
              </ol>
            ))}
          </div>
        </div>
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader title="Contato" />
            <ul className="grid gap-2.5 text-sm">
              {contactLine.length === 0 && <li className="text-fg-3">Nenhum contato informado.</li>}
              {contactLine.map((c, i) => (
                <li key={i} className="flex items-center gap-2.5 text-fg-2"><c.icon className="size-4 text-fg-3" />
                  {c.href ? <a href={c.href} target="_blank" rel="noreferrer" className="truncate hover:text-accent">{c.text}</a> : <span className="truncate">{c.text}</span>}</li>
              ))}
            </ul>
            {(client.address?.street || client.address?.city) && <p className="mt-3 border-t border-border pt-3 text-xs text-fg-3">{[client.address.street, client.address.city, client.address.state].filter(Boolean).join(", ")}</p>}
          </Card>
          <Card>
            <CardHeader title="Resumo" />
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-xs text-fg-3">Projetos</dt><dd className="font-medium tabular">{projects.data?.length ?? "—"}</dd></div>
              <div><dt className="text-xs text-fg-3">Ativos</dt><dd className="font-medium tabular">{projects.data?.filter((p) => !["completed", "cancelled"].includes(p.status)).length ?? "—"}</dd></div>
              {can("finance.read") && <div className="col-span-2"><dt className="text-xs text-fg-3">Valor contratado (total)</dt><dd className="font-medium tabular">{money(projects.data?.reduce((s, p) => s + Number(p.contracted_amount), 0))}</dd></div>}
            </dl>
          </Card>
          {client.notes && <Card><CardHeader title="Observações" /><p className="whitespace-pre-wrap text-sm text-fg-2">{client.notes}</p></Card>}
        </div>
      </div>
      <ClientFormModal open={editing} onClose={() => setEditing(false)} client={client} />
      <ConfirmDialog open={deleting} onClose={() => setDeleting(false)} loading={del.isPending} onConfirm={() => del.mutate()}
        title="Excluir cliente?" description="Esta ação não pode ser desfeita. Clientes com projetos ou lançamentos financeiros não podem ser excluídos; nesse caso, marque como inativo." />
    </>
  );
}
