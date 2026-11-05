import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useBreadcrumbs } from "@/components/layout/AppShell";
import { Button, Card, CardHeader, ErrorState, Field, Input, PageHeader, Spinner, Tabs, Textarea, useToast } from "@/components/ui";
import { useAuth, useOrg } from "@/features/auth/AuthProvider";
import { errorMessage, roleLabel, type OrgRole } from "@/lib/domain";
import { onlyDigits, isValidDocument } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { ServicesPanel } from "./ServicesPanel";
import { BrandingPanel, IntegrationsPanel } from "./BrandingPanels";

export function SettingsPage() {
  useBreadcrumbs([{ label: "Configurações" }]);
  const [tab, setTab] = useState<"studio" | "branding" | "services" | "integrations" | "permissions">("studio");
  return (
    <>
      <PageHeader title="Configurações" description="Dados do estúdio, serviços e permissões por nível de acesso." />
      <Tabs value={tab} onChange={setTab} items={[{ value: "studio", label: "Estúdio" }, { value: "branding", label: "Identidade" }, { value: "services", label: "Serviços e preços" }, { value: "integrations", label: "Integrações" }, { value: "permissions", label: "Permissões" }]} />
      <div className="pt-5">{tab === "studio" ? <StudioForm /> : tab === "branding" ? <BrandingPanel /> : tab === "services" ? <ServicesPanel /> : tab === "integrations" ? <IntegrationsPanel /> : <PermissionsMatrix />}</div>
    </>
  );
}

function StudioForm() {
  const { orgId } = useOrg();
  const { refresh } = useAuth();
  const toast = useToast();
  const { data, isLoading, error } = useQuery({
    queryKey: ["org", orgId],
    queryFn: async () => { const { data, error } = await supabase.from("organizations").select("*").eq("id", orgId).single(); if (error) throw error; return data; },
  });
  const [f, setF] = useState<Record<string, string>>({});
  useEffect(() => {
    if (data) setF({ name: data.name, legal_name: data.legal_name ?? "", document: data.document ?? "", email: data.email ?? "", phone: data.phone ?? "",
      street: data.address?.street ?? "", city: data.address?.city ?? "", state: data.address?.state ?? "", zip: data.address?.zip ?? "",
      bank: data.bank_details?.text ?? "" });
  }, [data]);
  const [saving, setSaving] = useState(false);
  if (isLoading) return <Spinner />;
  if (error) return <ErrorState error={error} />;
  const docErr = f.document && !isValidDocument(f.document) ? "CNPJ/CPF inválido." : undefined;
  const save = async () => {
    setSaving(true);
    const { error } = await supabase.from("organizations").update({
      name: f.name.trim(), legal_name: f.legal_name || null, document: f.document ? onlyDigits(f.document) : null, email: f.email || null, phone: f.phone || null,
      address: { street: f.street, city: f.city, state: f.state, zip: f.zip }, bank_details: f.bank ? { text: f.bank } : {},
    }).eq("id", orgId);
    setSaving(false);
    if (error) return toast({ tone: "error", message: errorMessage(error) });
    toast({ tone: "success", message: "Dados do estúdio salvos." }); refresh();
  };
  const bind = (k: string) => ({ id: `o-${k}`, value: f[k] ?? "", onChange: (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value })) });
  return (
    <Card className="max-w-3xl">
      <CardHeader title="Dados do estúdio" description="Usados nas propostas e contratos (variáveis {{nome_estudio}}, {{documento_estudio}})." />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome do estúdio" required htmlFor="o-name"><Input {...bind("name")} /></Field>
        <Field label="Razão social" htmlFor="o-legal_name"><Input {...bind("legal_name")} /></Field>
        <Field label="CNPJ/CPF" htmlFor="o-document" error={docErr}><Input inputMode="numeric" {...bind("document")} /></Field>
        <Field label="E-mail" htmlFor="o-email"><Input type="email" {...bind("email")} /></Field>
        <Field label="Telefone" htmlFor="o-phone"><Input {...bind("phone")} /></Field>
        <Field label="Endereço" htmlFor="o-street"><Input {...bind("street")} /></Field>
        <div className="grid grid-cols-[1fr_80px_120px] gap-3 sm:col-span-2">
          <Field label="Cidade" htmlFor="o-city"><Input {...bind("city")} /></Field><Field label="UF" htmlFor="o-state"><Input maxLength={2} {...bind("state")} /></Field><Field label="CEP" htmlFor="o-zip"><Input {...bind("zip")} /></Field>
        </div>
        <Field label="Dados bancários / PIX" htmlFor="o-bank" className="sm:col-span-2" hint="Visível apenas para quem gerencia as configurações."><Textarea {...bind("bank")} /></Field>
      </div>
      <div className="mt-5 flex justify-end"><Button variant="primary" loading={saving} disabled={!f.name?.trim() || !!docErr} onClick={save}>Salvar</Button></div>
    </Card>
  );
}

const editableRoles: OrgRole[] = ["manager", "member", "finance", "external"];

function PermissionsMatrix() {
  const { orgId } = useOrg();
  const qc = useQueryClient();
  const toast = useToast();
  const perms = useQuery({ queryKey: ["permissions"], queryFn: async () => (await supabase.from("permissions").select("*").order("module")).data ?? [] });
  const grants = useQuery({ queryKey: ["role-perms", orgId], queryFn: async () => (await supabase.from("role_permissions").select("role, permission").eq("organization_id", orgId)).data ?? [] });
  if (perms.isLoading || grants.isLoading) return <Spinner />;
  const has = (role: OrgRole, key: string) => grants.data!.some((g) => g.role === role && g.permission === key);
  const toggle = async (role: OrgRole, key: string, on: boolean) => {
    const res = on
      ? await supabase.from("role_permissions").insert({ organization_id: orgId, role, permission: key })
      : await supabase.from("role_permissions").delete().eq("organization_id", orgId).eq("role", role).eq("permission", key);
    if (res.error) return toast({ tone: "error", message: errorMessage(res.error) });
    qc.invalidateQueries({ queryKey: ["role-perms", orgId] });
  };
  return (
    <Card padded={false} className="overflow-hidden">
      <div className="border-b border-border p-4"><p className="text-sm font-medium">Permissões por nível de acesso</p>
        <p className="mt-0.5 text-xs text-fg-3">Administradores têm acesso total. As regras são aplicadas no banco de dados (RLS), não só na interface. Clientes usam apenas o portal.</p></div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-xs text-fg-3"><tr><th className="px-4 py-2.5 text-left font-medium">Permissão</th>
            {editableRoles.map((r) => <th key={r} className="px-3 py-2.5 font-medium">{roleLabel[r]}</th>)}</tr></thead>
          <tbody>
            {perms.data!.map((p) => (
              <tr key={p.key} className="border-t border-border">
                <td className="px-4 py-2.5"><p>{p.description}</p><p className="font-mono text-[11px] text-fg-3">{p.key}</p></td>
                {editableRoles.map((r) => (
                  <td key={r} className="px-3 py-2.5 text-center">
                    <input type="checkbox" aria-label={`${roleLabel[r]}: ${p.description}`} className="size-4 accent-[var(--accent)]" checked={has(r, p.key)} onChange={(e) => toggle(r, p.key, e.target.checked)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
