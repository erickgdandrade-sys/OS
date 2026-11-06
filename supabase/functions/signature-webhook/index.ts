// Recebe os eventos da ZapSign. Único caminho que marca um contrato como assinado.
// Configure na ZapSign o webhook para esta URL com o header
//   x-webhook-secret: <ZAPSIGN_WEBHOOK_SECRET>
// (comparação em tempo constante). Sem segredo configurado, tudo é recusado.
import { adminClient, env, HttpError, isUuid, json } from "../_shared/http.ts";

function safeEqual(a: string, b: string) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let r = 0;
  for (let i = 0; i < x.length; i++) r |= x[i] ^ y[i];
  return r === 0;
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") return json(req, 405, { error: "method_not_allowed" });
    const secret = env("ZAPSIGN_WEBHOOK_SECRET");
    if (!safeEqual(req.headers.get("x-webhook-secret") ?? "", secret)) return json(req, 401, { error: "unauthorized" });
    const ev = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const contractId = ev.external_id;
    const type = String(ev.event_type ?? "");
    if (!isUuid(contractId)) return json(req, 200, { ignored: "no_external_id" }); // documento não criado pelo ANDRA&GO OS

    const admin = adminClient();
    const { data: c } = await admin.from("contracts").select("id, signature_envelope_id").eq("id", contractId).maybeSingle();
    if (!c || (c.signature_envelope_id && ev.token && c.signature_envelope_id !== ev.token)) return json(req, 200, { ignored: "unknown_document" });

    const status = String(ev.status ?? "");
    const event = type === "doc_signed" || status === "signed" ? "signed"
      : type === "doc_refused" || status === "refused" ? "refused"
      : type === "signer_signed" ? "progress" : null;
    if (!event) return json(req, 200, { ignored: type || "unknown_event" });
    const detail = event === "progress" ? `Assinatura parcial (${(ev.signer_who_signed as { name?: string })?.name ?? "signatário"})` : event === "signed" ? "Assinado por todas as partes" : "Assinatura recusada";
    const { error } = await admin.rpc("mark_contract_signature", { p_contract: contractId, p_event: event, p_detail: detail, p_signed_at: event === "signed" ? new Date().toISOString() : null });
    if (error) throw new HttpError(500, "update_failed", error.message);
    return json(req, 200, { ok: true });
  } catch (e) {
    console.error(e);
    return json(req, e instanceof HttpError ? e.status : 500, { error: e instanceof HttpError ? e.code : "internal_error" });
  }
});
