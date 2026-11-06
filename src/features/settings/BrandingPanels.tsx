import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CircleSlash, ImageUp, PlugZap } from "lucide-react";
import { useRef, useState } from "react";
import { Badge, Button, Card, CardHeader, Field, Input, Spinner, useToast } from "@/components/ui";
import { useOrg } from "@/features/auth/AuthProvider";
import { errorMessage } from "@/lib/domain";
import { invokeFunction, supabase } from "@/lib/supabase";

export type Branding = { primary_color?: string; logo_path?: string };

/** Logo e cor do estúdio: usados nos PDFs e na página pública da proposta. */
export function BrandingPanel() {
  const { orgId, userId } = useOrg();
  const qc = useQueryClient();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const org = useQuery({ queryKey: ["org-branding", orgId], queryFn: async () => (await supabase.from("organizations").select("branding").eq("id", orgId).single()).data?.branding as Branding ?? {} });
  const logo = useQuery({ queryKey: ["org-logo", org.data?.logo_path], enabled: !!org.data?.logo_path,
    queryFn: async () => (await supabase.storage.from("org-files").createSignedUrl(org.data!.logo_path!, 3600)).data?.signedUrl ?? null });
  const [color, setColor] = useState<string | null>(null);
  const current = color ?? org.data?.primary_color ?? "#0B0C12";
  const save = async (patch: Branding) => {
    const { error } = await supabase.from("organizations").update({ branding: { ...org.data, ...patch } }).eq("id", orgId);
    if (error) { toast({ tone: "error", message: errorMessage(error) }); return false; }
    qc.invalidateQueries({ queryKey: ["org-branding", orgId] }); return true;
  };
  const upload = async (f: File | undefined) => {
    if (!f) return;
    if (!/^image\/(png|jpeg|svg\+xml|webp)$/.test(f.type) || f.size > 2 * 1024 * 1024) return toast({ tone: "error", message: "Use PNG, JPG, SVG ou WebP de até 2 MB." });
    setBusy(true);
    const path = `${orgId}/branding/${crypto.randomUUID()}-${f.name.replace(/[^\w.-]+/g, "_")}`;
    const up = await supabase.storage.from("org-files").upload(path, f, { contentType: f.type });
    if (!up.error) {
      const { error } = await supabase.from("files").insert({ organization_id: orgId, storage_path: path, name: f.name, mime_type: f.type, size_bytes: f.size, folder: "Identidade", tags: ["logo"], uploaded_by: userId });
      if (error) toast({ tone: "error", message: errorMessage(error) });
      else if (await save({ logo_path: path })) toast({ tone: "success", message: "Logo atualizado." });
    } else toast({ tone: "error", message: errorMessage(up.error) });
    setBusy(false);
  };
  if (org.isLoading) return <Spinner />;
  return (
    <Card className="max-w-3xl">
      <CardHeader title="Identidade do estúdio" description="Aparece no cabeçalho das propostas, contratos em PDF e na página pública da proposta." />
      <div className="grid gap-6 sm:grid-cols-[220px_1fr]">
        <div className="grid gap-2">
          <div className="flex h-28 items-center justify-center rounded-lg border border-dashed border-border bg-surface-2 p-3">
            {logo.data ? <img src={logo.data} alt="Logo do estúdio" className="max-h-full max-w-full object-contain" /> : <span className="text-xs text-fg-3">Sem logo</span>}
          </div>
          <input ref={input} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" hidden onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }} />
          <Button icon={<ImageUp className="size-4" />} loading={busy} onClick={() => input.current?.click()}>Enviar logo</Button>
        </div>
        <div className="grid content-start gap-4">
          <Field label="Cor principal" htmlFor="b-color" hint="Usada em títulos e linhas dos documentos. Prefira uma cor escura para boa leitura.">
            <div className="flex items-center gap-2">
              <input id="b-color" type="color" value={current} onChange={(e) => setColor(e.target.value)} className="h-9 w-12 cursor-pointer rounded border border-border bg-surface" />
              <Input aria-label="Código da cor" value={current} onChange={(e) => setColor(e.target.value)} className="w-32 font-mono" />
            </div>
          </Field>
          <div className="rounded-lg border border-border p-4">
            <p className="text-[11px] uppercase tracking-wider text-fg-3">Prévia</p>
            <p className="mt-2 text-sm font-semibold" style={{ color: current }}>ESCOPO</p>
            <div className="mt-1 h-0.5 w-full" style={{ background: current }} />
          </div>
          <div><Button variant="primary" disabled={!/^#[0-9a-f]{6}$/i.test(current) || current === org.data?.primary_color} onClick={async () => { if (await save({ primary_color: current })) toast({ tone: "success", message: "Cor salva." }); }}>Salvar cor</Button></div>
        </div>
      </div>
    </Card>
  );
}

/** Integrações externas. Só aparecem como conectadas quando há configuração real. */
export function IntegrationsPanel() {
  const sig = useQuery({ queryKey: ["sig-status"], retry: false, queryFn: () => invokeFunction<{ configured: boolean }>("signature-send", { action: "status" }) });
  const rows = [
    { name: "ZapSign — assinatura eletrônica", state: sig.isLoading ? "loading" : sig.error ? "error" : sig.data?.configured ? "on" : "off",
      how: "Crie uma conta na ZapSign, gere o token de API e rode: npx supabase secrets set ZAPSIGN_API_TOKEN=… ZAPSIGN_WEBHOOK_SECRET=…; depois cadastre o webhook apontando para a função signature-webhook com o header x-webhook-secret." },
    { name: "Google Calendar", state: "planned", how: "Sincronização de entregas, reuniões e gravações. Prevista para a Fase 5 (exige app OAuth aprovado no Google)." },
    { name: "Meta (Instagram e Facebook) e LinkedIn", state: "planned", how: "Agendamento e métricas de publicações. Prevista para a Fase 5; nada é publicado sem essa conexão." },
    { name: "Assistente de IA", state: "planned", how: "Fase 5. A chave da API fica só nas Edge Functions (LLM_API_KEY)." },
  ];
  return (
    <Card padded={false} className="max-w-3xl overflow-hidden">
      <div className="border-b border-border p-4"><p className="text-sm font-medium">Integrações</p><p className="text-xs text-fg-3">Chaves e tokens ficam como segredos do Supabase, nunca no navegador nem no banco.</p></div>
      <ul className="divide-y divide-border">{rows.map((r) => (
        <li key={r.name} className="flex gap-3 p-4">
          {r.state === "on" ? <CheckCircle2 className="mt-0.5 size-5 text-success" /> : r.state === "planned" ? <CircleSlash className="mt-0.5 size-5 text-fg-3" /> : <PlugZap className="mt-0.5 size-5 text-warning" />}
          <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium">{r.name}</p>
            <Badge tone={r.state === "on" ? "success" : r.state === "planned" ? "neutral" : "warning"}>{r.state === "on" ? "Conectada" : r.state === "planned" ? "Planejada" : r.state === "loading" ? "Verificando…" : r.state === "error" ? "Função não publicada" : "Não configurada"}</Badge></div>
            <p className="mt-1 text-xs text-fg-3">{r.how}</p></div>
        </li>))}</ul>
    </Card>
  );
}
