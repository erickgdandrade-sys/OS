// Briefing por link avulso (sem conta). Token no header x-briefing-token.
// POST { action: 'view' }                              → perguntas e respostas salvas
// POST { action: 'save', answers, final?, name? }      → salva rascunho ou envia
import { adminClient, handler, HttpError, json, sha256 } from "../_shared/http.ts";

Deno.serve(handler(async (req) => {
  const token = req.headers.get("x-briefing-token") ?? "";
  if (!/^[0-9a-f]{64}$/.test(token)) throw new HttpError(401, "invalid_token");
  const admin = adminClient();
  const { data: b } = await admin.from("briefings")
    .select("id, title, category, intro_message, sections, answers, status, token_expires_at, respondent_name, organizations(name, branding)")
    .eq("token_hash", await sha256(token)).maybeSingle();
  if (!b || !b.token_expires_at || new Date(b.token_expires_at) < new Date() || !["sent", "in_progress"].includes(b.status)) {
    throw new HttpError(401, "link_expired_or_revoked");
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (body.action === "view") {
    const { token_expires_at: _, ...out } = b;
    return json(req, 200, { briefing: out });
  }
  if (body.action === "save") {
    const answers = body.answers;
    if (!answers || typeof answers !== "object" || Array.isArray(answers)) throw new HttpError(400, "invalid_answers");
    const final = body.final === true;
    const name = typeof body.name === "string" ? body.name.slice(0, 120) : null;
    const { error } = await admin.rpc("submit_briefing_answers", { p_briefing: b.id, p_answers: answers, p_final: final, p_name: name });
    if (error) throw new HttpError(400, /name_required|invalid_answers|link_expired_or_revoked/.exec(error.message)?.[0] ?? "save_failed");
    return json(req, 200, { ok: true });
  }
  throw new HttpError(400, "invalid_action");
}));
