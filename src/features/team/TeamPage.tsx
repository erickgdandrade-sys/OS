import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MailPlus, UserCheck, UserX } from "lucide-react";
import { useState } from "react";
import { useBreadcrumbs } from "@/components/layout/AppShell";
import { Avatar, Badge, Button, Card, ConfirmDialog, ErrorState, Field, Input, Modal, PageHeader, Select, Spinner, useToast } from "@/components/ui";
import { useOrg } from "@/features/auth/AuthProvider";
import { errorMessage, jobTitles, roleLabel, type OrgRole } from "@/lib/domain";
import { dateTime } from "@/lib/format";
import { invokeFunction, supabase } from "@/lib/supabase";
import { Tabs } from "@/components/ui";
import { Workload } from "./Workload";

type Person = { user_id: string; full_name: string; email: string; role: OrgRole; job_title: string | null; status: "invited" | "active" | "disabled";
  weekly_capacity_hours: number; last_seen_at: string | null; joined_at: string | null };

export function TeamPage() {
  useBreadcrumbs([{ label: "Equipe" }]);
  const { orgId, can, userId, membership } = useOrg();
  const qc = useQueryClient();
  const toast = useToast();
  const [inviting, setInviting] = useState(false);
  const [tab, setTab] = useState<"people" | "load">("people");
  const [confirm, setConfirm] = useState<Person | null>(null);
  const manage = can("users.manage");
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["team", orgId],
    queryFn: async () => { const { data, error } = await supabase.rpc("team_directory", { p_org: orgId }); if (error) throw error; return data as Person[]; },
  });
  const load = useQuery({
    queryKey: ["team-load", orgId],
    queryFn: async () => {
      const { data } = await supabase.from("tasks").select("assignee_id").eq("organization_id", orgId).neq("status", "done").not("assignee_id", "is", null);
      const map: Record<string, number> = {};
      (data ?? []).forEach((t) => { map[t.assignee_id!] = (map[t.assignee_id!] ?? 0) + 1; });
      return map;
    },
  });
  const update = useMutation({
    mutationFn: async ({ uid, patch }: { uid: string; patch: Partial<Pick<Person, "role" | "job_title" | "status">> }) => {
      const { error } = await supabase.from("organization_members").update(patch).eq("organization_id", orgId).eq("user_id", uid);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["team", orgId] }); toast({ tone: "success", message: "Alteração salva." }); },
    onError: (e) => toast({ tone: "error", message: errorMessage(e) }),
  });

  return (
    <>
      <PageHeader title="Equipe" description="Pessoas do estúdio, funções, acesso e carga de trabalho."
        actions={manage && <Button variant="primary" icon={<MailPlus className="size-4" />} onClick={() => setInviting(true)}>Convidar pessoa</Button>} />
      <div className="mb-4"><Tabs value={tab} onChange={setTab} items={[{ value: "people", label: "Pessoas" }, { value: "load", label: "Distribuição de trabalho" }]} /></div>
      {tab === "load" ? <Workload /> : error ? <ErrorState error={error} onRetry={refetch} /> : isLoading ? <Spinner /> : (
        <Card padded={false} className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-left text-xs text-fg-3"><tr>
                <th className="px-4 py-2.5 font-medium">Pessoa</th><th className="px-4 py-2.5 font-medium">Acesso</th><th className="hidden px-4 py-2.5 font-medium md:table-cell">Função</th>
                <th className="hidden px-4 py-2.5 font-medium lg:table-cell">Tarefas abertas</th><th className="hidden px-4 py-2.5 font-medium lg:table-cell">Último acesso</th>{manage && <th className="px-4 py-2.5" />}
              </tr></thead>
              <tbody>
                {(data ?? []).map((p) => (
                  <tr key={p.user_id} className="border-t border-border">
                    <td className="px-4 py-3"><div className="flex items-center gap-2.5"><Avatar name={p.full_name || p.email} size={28} />
                      <div className="min-w-0"><p className="truncate font-medium">{p.full_name || "Convite enviado"}</p><p className="truncate text-xs text-fg-3">{p.email}</p></div></div></td>
                    <td className="px-4 py-3">
                      {manage && p.user_id !== userId && (p.role !== "admin" || membership.role === "admin") ? (
                        <Select aria-label={`Acesso de ${p.email}`} value={p.role} className="h-8 w-44 text-xs" onChange={(e) => update.mutate({ uid: p.user_id, patch: { role: e.target.value as OrgRole } })}>
                          {Object.entries(roleLabel).filter(([k]) => k !== "admin" || membership.role === "admin").map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                        </Select>
                      ) : <span>{roleLabel[p.role]}</span>}
                      {p.status !== "active" && <Badge tone={p.status === "invited" ? "info" : "neutral"} className="ml-2">{p.status === "invited" ? "Convite pendente" : "Desativado"}</Badge>}
                    </td>
                    <td className="hidden px-4 py-3 text-fg-2 md:table-cell">{p.job_title ?? "—"}</td>
                    <td className="hidden px-4 py-3 tabular lg:table-cell">{load.data?.[p.user_id] ?? 0}</td>
                    <td className="hidden px-4 py-3 text-fg-3 lg:table-cell">{p.last_seen_at ? dateTime(p.last_seen_at) : "Nunca"}</td>
                    {manage && <td className="px-4 py-3 text-right">{p.user_id !== userId && (
                      p.status === "disabled"
                        ? <Button size="sm" icon={<UserCheck className="size-3.5" />} onClick={() => update.mutate({ uid: p.user_id, patch: { status: "active" } })}>Reativar</Button>
                        : <Button size="sm" variant="ghost" icon={<UserX className="size-3.5" />} onClick={() => setConfirm(p)}>Desativar</Button>
                    )}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <InviteModal open={inviting} onClose={() => setInviting(false)} orgId={orgId} isAdmin={membership.role === "admin"} onDone={() => refetch()} />
      <ConfirmDialog open={!!confirm} onClose={() => setConfirm(null)} confirmLabel="Desativar" loading={update.isPending}
        title={`Desativar ${confirm?.full_name || confirm?.email}?`} description="A pessoa perde o acesso imediatamente. Tarefas e históricos são mantidos, e você pode reativar depois."
        onConfirm={() => confirm && update.mutate({ uid: confirm.user_id, patch: { status: "disabled" } }, { onSettled: () => setConfirm(null) })} />
    </>
  );
}

function InviteModal({ open, onClose, orgId, isAdmin, onDone }: { open: boolean; onClose: () => void; orgId: string; isAdmin: boolean; onDone: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ email: "", role: "member" as OrgRole, job_title: "" });
  const [busy, setBusy] = useState(false);
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.trim());
  const send = async () => {
    setBusy(true);
    try {
      await invokeFunction("invite-member", { organization_id: orgId, email: f.email.trim(), role: f.role, job_title: f.job_title || null });
      toast({ tone: "success", message: `Convite enviado para ${f.email.trim()}.` });
      setF({ email: "", role: "member", job_title: "" }); onDone(); onClose();
    } catch (e) { toast({ tone: "error", message: errorMessage(e) }); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Convidar pessoa" description="A pessoa recebe um e-mail para criar a senha. O acesso só vale depois do aceite."
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={busy} disabled={!validEmail} onClick={send}>Enviar convite</Button></>}>
      <div className="grid gap-4">
        <Field label="E-mail" required htmlFor="i-email" error={f.email && !validEmail ? "E-mail inválido." : undefined}><Input id="i-email" type="email" value={f.email} onChange={(e) => setF((s) => ({ ...s, email: e.target.value }))} /></Field>
        <Field label="Nível de acesso" htmlFor="i-role" hint="Define o que a pessoa vê. Ajuste as permissões de cada nível em Configurações.">
          <Select id="i-role" value={f.role} onChange={(e) => setF((s) => ({ ...s, role: e.target.value as OrgRole }))}>
            {Object.entries(roleLabel).filter(([k]) => k !== "admin" || isAdmin).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </Field>
        <Field label="Função" htmlFor="i-job"><Select id="i-job" value={f.job_title} onChange={(e) => setF((s) => ({ ...s, job_title: e.target.value }))}>
          <option value="">Não definir</option>{jobTitles.map((j) => <option key={j} value={j}>{j}</option>)}</Select></Field>
      </div>
    </Modal>
  );
}
