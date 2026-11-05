// Proposta por link público (sem conta). Token no header x-portal-token.
// POST { action: 'view' }                 → dados da proposta (somente campos para o cliente)
// POST { action: 'pdf' }                  → PDF gerado na hora (base64)
// POST { action: 'accept', name, note? }  → registra o aceite (nome, data) e avisa a equipe
import { adminClient, handler, HttpError, json, sha256 } from "../_shared/http.ts";
import { proposalPdf, toBase64 } from "../_shared/documents.ts";

Deno.serve(handler(async (req) => {
  const token = req.headers.get("x-portal-token") ?? "";
  if (!/^[0-9a-f]{64}$/.test(token)) throw new HttpError(401, "invalid_token");
  const admin = adminClient();
  const { data: link } = await admin.from("proposal_links").select("id, proposal_id, expires_at, revoked_at, use_count")
    .eq("token_hash", await sha256(token)).maybeSingle();
  if (!link || link.revoked_at || (link.expires_at && new Date(link.expires_at) < new Date())) throw new HttpError(401, "link_expired_or_revoked");
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  if (body.action === "accept") {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const note = typeof body.note === "string" ? body.note.slice(0, 2000) : null;
    if (name.length < 3 || name.length > 120) throw new HttpError(400, "name_required");
    const { error } = await admin.rpc("record_proposal_acceptance", { p_link: link.id, p_name: name, p_note: note });
    if (error) throw new HttpError(409, error.message.includes("already_accepted") ? "already_accepted" : error.message.includes("proposal_not_open") ? "proposal_not_open" : "accept_failed");
    return json(req, 200, { ok: true });
  }
  if (body.action === "pdf") {
    const doc = await proposalPdf(admin, link.proposal_id);
    return json(req, 200, { file_name: doc.fileName, base64: toBase64(doc.bytes) });
  }
  if (body.action !== "view") throw new HttpError(400, "invalid_action");

  await admin.from("proposal_links").update({ last_used_at: new Date().toISOString(), use_count: link.use_count + 1 }).eq("id", link.id);
  const { data: p } = await admin.from("proposals")
    .select("id, number, title, status, intro, scope, deliverables, terms, revisions, discount_type, subtotal, total, installments, first_due_date, valid_until, sent_at, created_by, organization_id, client_accepted_at, client_accepted_name, clients(legal_name), organizations(name, email, phone, branding)")
    .eq("id", link.proposal_id).single();
  if (!p) throw new HttpError(404, "proposal_not_found");
  const { data: items } = await admin.from("proposal_items").select("id, description, details, quantity, unit_price, line_total, is_package").eq("proposal_id", p.id).order("position");
  if (p.status === "sent") {
    await admin.from("proposals").update({ status: "viewed", viewed_at: new Date().toISOString() }).eq("id", p.id);
    await admin.from("notifications").insert({ organization_id: p.organization_id, user_id: p.created_by, kind: "proposal_viewed", title: `Proposta visualizada: ${p.title}`, link: `/propostas/${p.id}` });
  }
  let logo: string | null = null;
  const logoPath = (p.organizations as { branding?: { logo_path?: string } } | null)?.branding?.logo_path;
  if (logoPath) logo = (await admin.storage.from("org-files").createSignedUrl(logoPath, 3600)).data?.signedUrl ?? null;
  const { created_by: _c, organization_id: _o, ...safe } = p;
  return json(req, 200, { proposal: safe, items: items ?? [], logo });
}));
