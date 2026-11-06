import { useQuery } from "@tanstack/react-query";
import { Copy, FileDown, Globe, PenTool, ShieldOff, Trash2, UserPlus } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Field, Input, Modal, Select, useToast } from "@/components/ui";
import { errorMessage } from "@/lib/domain";
import { dateTime } from "@/lib/format";
import { appUrl, invokeFunction, supabase } from "@/lib/supabase";

/** Gera o PDF no servidor (fica salvo nos arquivos do estúdio) e abre o download. */
export function ServerPdfButton({ kind, id, version }: { kind: "proposal" | "contract"; id: string; version?: number }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const r = await invokeFunction<{ url: string; missing: string[] }>("document-pdf", { kind, id, version });
      if (r.missing?.length) toast({ tone: "info", message: `Campos sem dados no PDF: ${r.missing.join(", ")}` });
      window.open(r.url, "_blank", "noopener");
    } catch (e) { toast({ tone: "error", message: errorMessage(e) }); } finally { setBusy(false); }
  };
  return <Button icon={<FileDown className="size-4" />} loading={busy} onClick={go}>PDF</Button>;
}

/** Links públicos da proposta: criar (mostra o endereço uma vez), listar e revogar. */
export function ProposalLinksButton({ proposalId, disabled }: { proposalId: string; disabled?: boolean }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState("30");
  const [url, setUrl] = useState<string | null>(null);
  const links = useQuery({ queryKey: ["proposal-links", proposalId], enabled: open,
    queryFn: async () => (await supabase.from("proposal_links").select("*").eq("proposal_id", proposalId).order("created_at", { ascending: false })).data ?? [] });
  const create = async () => {
    const { data, error } = await supabase.rpc("create_proposal_link", { p_proposal: proposalId, p_days: Number(days) });
    if (error) return toast({ tone: "error", message: errorMessage(error).includes("proposal_not_shareable") ? "Envie a proposta antes de gerar o link." : errorMessage(error) });
    setUrl(appUrl(`/proposta#${data}`)); links.refetch();
  };
  const revoke = async (id: string) => { await supabase.from("proposal_links").update({ revoked_at: new Date().toISOString() }).eq("id", id); links.refetch(); };
  const copy = async () => { try { await navigator.clipboard.writeText(url!); toast({ tone: "success", message: "Link copiado." }); } catch { toast({ tone: "info", message: "Selecione o link e copie." }); } };
  return (
    <>
      <Button icon={<Globe className="size-4" />} disabled={disabled} title={disabled ? "Envie a proposta para gerar o link" : undefined} onClick={() => { setUrl(null); setOpen(true); }}>Link público</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Link público da proposta" description="O cliente vê a proposta, baixa o PDF e registra o aceite. O endereço completo aparece uma única vez."
        footer={<Button onClick={() => setOpen(false)}>Fechar</Button>}>
        <div className="grid gap-4">
          {url ? (
            <div className="flex gap-2"><Input readOnly value={url} onFocus={(e) => e.target.select()} className="font-mono text-xs" /><Button variant="primary" icon={<Copy className="size-4" />} onClick={copy}>Copiar</Button></div>
          ) : (
            <div className="flex items-end gap-2">
              <Field label="Validade" htmlFor="pl-days" className="flex-1"><Select id="pl-days" value={days} onChange={(e) => setDays(e.target.value)}><option value="7">7 dias</option><option value="30">30 dias</option><option value="90">90 dias</option></Select></Field>
              <Button variant="primary" onClick={create}>Gerar link</Button>
            </div>
          )}
          <p className="text-xs text-fg-3">O link nunca dura além da validade da proposta.</p>
          <ul className="grid gap-2">{(links.data ?? []).map((l) => {
            const dead = l.revoked_at || (l.expires_at && new Date(l.expires_at) < new Date());
            return (
              <li key={l.id} className="flex items-center justify-between gap-2 rounded-md border border-border p-2.5 text-sm">
                <span className="text-xs text-fg-3">Criado {dateTime(l.created_at)} · {l.use_count} acesso(s){l.expires_at ? ` · expira ${dateTime(l.expires_at)}` : ""}</span>
                {dead ? <Badge>{l.revoked_at ? "Revogado" : "Expirado"}</Badge> : <Button size="sm" variant="ghost" icon={<ShieldOff className="size-3.5" />} onClick={() => revoke(l.id)}>Revogar</Button>}
              </li>);
          })}</ul>
        </div>
      </Modal>
    </>
  );
}

/** Envio para assinatura (ZapSign). Desabilitado sem integração configurada. */
export function SignatureButton({ contractId, ready, defaultSigner }: { contractId: string; ready: boolean; defaultSigner?: { name: string; email: string } }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [signers, setSigners] = useState([defaultSigner ?? { name: "", email: "" }]);
  const status = useQuery({ queryKey: ["sig-status"], retry: false, queryFn: () => invokeFunction<{ configured: boolean }>("signature-send", { action: "status" }) });
  const configured = !!status.data?.configured;
  const valid = signers.every((s) => s.name.trim().length >= 3 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.email.trim()));
  const send = async () => {
    setBusy(true);
    try {
      const r = await invokeFunction<{ signers: { name: string; sign_url: string }[] }>("signature-send", { action: "send", contract_id: contractId, signers });
      toast({ tone: "success", message: `Enviado para ${r.signers.length} signatário(s). Eles recebem o link por e-mail.` });
      setOpen(false); location.reload();
    } catch (e) { toast({ tone: "error", message: errorMessage(e) }); } finally { setBusy(false); }
  };
  const reason = !ready ? "Marque o contrato como revisado antes." : !configured ? "Configure a ZapSign em Configurações → Integrações." : undefined;
  return (
    <>
      <Button variant="primary" icon={<PenTool className="size-4" />} disabled={!!reason} title={reason} onClick={() => setOpen(true)}>Enviar para assinatura</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Enviar para assinatura" description="A ZapSign envia o contrato por e-mail. O status muda para Assinado só quando todos assinarem."
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button><Button variant="primary" loading={busy} disabled={!valid} onClick={send}>Enviar</Button></>}>
        <div className="grid gap-3">
          {signers.map((s, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
              <Input aria-label="Nome" placeholder="Nome completo" value={s.name} onChange={(e) => setSigners((x) => x.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} />
              <Input aria-label="E-mail" type="email" placeholder="email@empresa.com.br" value={s.email} onChange={(e) => setSigners((x) => x.map((y, j) => (j === i ? { ...y, email: e.target.value } : y)))} />
              <button aria-label="Remover signatário" disabled={signers.length === 1} onClick={() => setSigners((x) => x.filter((_, j) => j !== i))} className="rounded p-2 text-fg-3 hover:text-danger disabled:opacity-30"><Trash2 className="size-4" /></button>
            </div>))}
          <Button variant="ghost" size="sm" icon={<UserPlus className="size-3.5" />} onClick={() => setSigners((x) => [...x, { name: "", email: "" }])} className="justify-self-start">Adicionar signatário</Button>
          <p className="text-xs text-fg-3">Inclua quem assina pelo estúdio e pelo cliente.</p>
        </div>
      </Modal>
    </>
  );
}
