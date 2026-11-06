import { useQuery } from "@tanstack/react-query";
import { Copy, Link2, MailPlus, ShieldOff } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Card, CardHeader, Field, Input, Modal, Select, useToast } from "@/components/ui";
import { useOrg } from "@/features/auth/AuthProvider";
import { errorMessage } from "@/lib/domain";
import { addDaysISO, dateTime, todayISO } from "@/lib/format";
import { appUrl, invokeFunction, supabase } from "@/lib/supabase";

const scopeLabel: Record<string, string> = { progress: "Andamento", tasks: "Etapas", files: "Arquivos", approvals: "Aprovações" };

/** Compartilhamento do projeto com o cliente: links seguros e contas do portal. */
export function PortalSharing({ projectId, clientId }: { projectId: string; clientId: string }) {
  const { can } = useOrg();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [newUrl, setNewUrl] = useState<string | null>(null);
  const [f, setF] = useState({ label: "", days: "30", scopes: ["progress", "tasks", "files", "approvals"], approvals: true });
  const [email, setEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const links = useQuery({
    queryKey: ["share-links", projectId], enabled: can("portal.share"),
    queryFn: async () => (await supabase.from("share_links").select("id, label, scopes, allow_approvals, expires_at, revoked_at, last_used_at, use_count, created_at").eq("project_id", projectId).order("created_at", { ascending: false })).data ?? [],
  });
  const accounts = useQuery({
    queryKey: ["client-users", clientId],
    queryFn: async () => (await supabase.from("client_users").select("user_id, status, created_at").eq("client_id", clientId)).data ?? [],
  });
  if (!can("portal.share")) return <p className="text-sm text-fg-3">Você não tem permissão para compartilhar com o cliente.</p>;

  const create = async () => {
    const expires = f.days === "never" ? null : new Date(addDaysISO(todayISO(), Number(f.days)) + "T23:59:59-03:00").toISOString();
    const { data, error } = await supabase.rpc("create_share_link", { p_project: projectId, p_label: f.label || null, p_scopes: f.scopes, p_expires_at: expires, p_allow_approvals: f.approvals });
    if (error) return toast({ tone: "error", message: errorMessage(error) });
    setCreating(false); setNewUrl(appUrl(`/p#${data}`)); links.refetch();
  };
  const revoke = async (id: string) => {
    const { error } = await supabase.from("share_links").update({ revoked_at: new Date().toISOString() }).eq("id", id);
    if (error) return toast({ tone: "error", message: errorMessage(error) });
    toast({ tone: "success", message: "Link revogado. Ele deixa de funcionar imediatamente." }); links.refetch();
  };
  const invite = async () => {
    setInviting(true);
    try { await invokeFunction("invite-client", { client_id: clientId, email: email.trim() }); toast({ tone: "success", message: `Acesso ao portal enviado para ${email.trim()}.` }); setEmail(""); accounts.refetch(); }
    catch (e) { toast({ tone: "error", message: errorMessage(e) }); } finally { setInviting(false); }
  };
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); toast({ tone: "success", message: "Link copiado." }); } catch { toast({ tone: "info", message: "Selecione o link e copie manualmente." }); } };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Links seguros" description="Acesso sem conta, com escopo, validade e revogação. O link completo só aparece uma vez."
          actions={<Button size="sm" variant="primary" icon={<Link2 className="size-3.5" />} onClick={() => setCreating(true)}>Criar link</Button>} />
        <ul className="grid gap-2">
          {(links.data ?? []).map((l) => {
            const expired = l.expires_at && new Date(l.expires_at) < new Date();
            return (
              <li key={l.id} className="rounded-md border border-border p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div><p className="font-medium">{l.label || "Link sem nome"}</p>
                    <p className="text-xs text-fg-3">{l.scopes.map((s: string) => scopeLabel[s] ?? s).join(" · ")}{l.allow_approvals ? "" : " · sem aprovar"}</p>
                    <p className="text-xs text-fg-3">{l.expires_at ? `Expira em ${dateTime(l.expires_at)}` : "Sem expiração"} · {l.use_count} acesso(s){l.last_used_at ? `, último em ${dateTime(l.last_used_at)}` : ""}</p></div>
                  {l.revoked_at ? <Badge>Revogado</Badge> : expired ? <Badge>Expirado</Badge> : <Button size="sm" variant="ghost" icon={<ShieldOff className="size-3.5" />} onClick={() => revoke(l.id)}>Revogar</Button>}
                </div>
              </li>);
          })}
          {!links.data?.length && <li className="text-sm text-fg-3">Nenhum link criado.</li>}
        </ul>
      </Card>
      <Card>
        <CardHeader title="Contas do cliente" description="Contatos com e-mail e senha veem todos os projetos deste cliente no portal." />
        {!can("users.manage") ? <p className="text-sm text-fg-3">Somente o administrador cadastra contas de cliente.</p> : <div className="flex gap-2"><Input aria-label="E-mail do contato" type="email" placeholder="contato@cliente.com.br" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Button icon={<MailPlus className="size-4" />} loading={inviting} disabled={!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())} onClick={invite}>Convidar</Button></div>}
        <p className="mt-3 text-xs text-fg-3">{accounts.data?.length ? `${accounts.data.length} conta(s) com acesso.` : "Nenhuma conta com acesso ainda."}</p>
      </Card>

      <Modal open={creating} onClose={() => setCreating(false)} title="Criar link seguro" size="sm"
        footer={<><Button variant="ghost" onClick={() => setCreating(false)}>Cancelar</Button><Button variant="primary" disabled={!f.scopes.length} onClick={create}>Criar</Button></>}>
        <div className="grid gap-4">
          <Field label="Nome (para identificar)" htmlFor="sl-label"><Input id="sl-label" placeholder="Ex.: Diretoria do cliente" value={f.label} onChange={(e) => setF((s) => ({ ...s, label: e.target.value }))} /></Field>
          <Field label="Validade" htmlFor="sl-days"><Select id="sl-days" value={f.days} onChange={(e) => setF((s) => ({ ...s, days: e.target.value }))}>
            <option value="7">7 dias</option><option value="30">30 dias</option><option value="90">90 dias</option><option value="never">Sem expiração (não recomendado)</option></Select></Field>
          <fieldset className="grid gap-1.5"><legend className="mb-1 text-xs font-medium text-fg-2">O que o link mostra</legend>
            {Object.entries(scopeLabel).map(([k, l]) => (
              <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-[var(--accent)]" checked={f.scopes.includes(k)}
                onChange={(e) => setF((s) => ({ ...s, scopes: e.target.checked ? [...s.scopes, k] : s.scopes.filter((x) => x !== k) }))} />{l}</label>))}
          </fieldset>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-[var(--accent)]" checked={f.approvals} onChange={(e) => setF((s) => ({ ...s, approvals: e.target.checked }))} />Permitir aprovar e pedir alterações</label>
        </div>
      </Modal>
      <Modal open={!!newUrl} onClose={() => setNewUrl(null)} title="Link criado" description="Copie agora: por segurança, o endereço completo não fica salvo e não aparece de novo." size="sm"
        footer={<Button variant="primary" onClick={() => setNewUrl(null)}>Concluir</Button>}>
        <div className="flex gap-2"><Input readOnly value={newUrl ?? ""} onFocus={(e) => e.target.select()} className="font-mono text-xs" /><Button icon={<Copy className="size-4" />} onClick={() => copy(newUrl!)}>Copiar</Button></div>
      </Modal>
    </div>
  );
}
