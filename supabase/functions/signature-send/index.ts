// Envia a versão atual do contrato para assinatura eletrônica na ZapSign.
// Requer os segredos ZAPSIGN_API_TOKEN (e opcionalmente ZAPSIGN_API_URL, para o sandbox).
// POST { action: 'status' }                                  → integração configurada?
// POST { action: 'send', contract_id, signers: [{name,email}] } → cria o documento e os signatários
import { env, handler, HttpError, isEmail, isUuid, json, requirePerm, userClient } from "../_shared/http.ts";
import { contractPdf, toBase64 } from "../_shared/documents.ts";

const API = Deno.env.get("ZAPSIGN_API_URL") ?? "https://api.zapsign.com.br/api/v1";

Deno.serve(handler(async (req) => {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const caller = userClient(req);
  const { data: me } = await caller.auth.getUser();
  if (!me.user) throw new HttpError(401, "not_authenticated");
  const configured = !!Deno.env.get("ZAPSIGN_API_TOKEN");

  if (body.action === "status") return json(req, 200, { provider: "zapsign", configured });
  if (body.action !== "send") throw new HttpError(400, "invalid_action");
  if (!configured) throw new HttpError(412, "signature_not_configured");
  const { contract_id, signers } = body;
  if (!isUuid(contract_id) || !Array.isArray(signers) || signers.length < 1 || signers.length > 10) throw new HttpError(400, "invalid_input");
  for (const s of signers as { name?: unknown; email?: unknown }[]) {
    if (typeof s.name !== "string" || s.name.trim().length < 3 || !isEmail(s.email)) throw new HttpError(400, "invalid_signer");
  }

  const doc = await contractPdf(caller, contract_id);
  await requirePerm(caller, doc.organizationId, "contracts.write");
  if (doc.contract.status !== "in_review") throw new HttpError(409, "contract_not_reviewed");
  if (doc.missing.length) throw new HttpError(409, "contract_has_missing_fields", doc.missing.join(", "));

  const res = await fetch(`${API}/docs/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env("ZAPSIGN_API_TOKEN")}` },
    body: JSON.stringify({
      name: doc.fileName.replace(/\.pdf$/, ""), base64_pdf: toBase64(doc.bytes), lang: "pt-br", external_id: contract_id,
      signers: (signers as { name: string; email: string }[]).map((s) => ({ name: s.name.trim(), email: s.email.trim().toLowerCase(), auth_mode: "assinaturaTela", send_automatic_email: true })),
    }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || !out?.token) throw new HttpError(502, "provider_error", typeof out?.detail === "string" ? out.detail : `HTTP ${res.status}`);

  const { error } = await caller.rpc("mark_contract_sent_for_signature", { p_contract: contract_id, p_provider: "zapsign", p_envelope: out.token });
  if (error) throw new HttpError(400, "status_update_failed", error.message);
  return json(req, 200, { ok: true, envelope: out.token, signers: (out.signers ?? []).map((s: { name: string; email: string; sign_url: string }) => ({ name: s.name, email: s.email, sign_url: s.sign_url })) });
}));
