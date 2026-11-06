// Portal por link seguro (sem conta). O token vem no header x-portal-token,
// nunca na query string do servidor. Valida hash, expiração e revogação, e
// devolve SOMENTE os escopos liberados no link.
// POST { action: 'view' }                          → dados do projeto
// POST { action: 'decide', approval_id, decision, comment?, name } → resposta de aprovação
// Escopo "requests" (O que precisamos de você): request_answer, request_upload_url,
// request_upload_done, briefing_save, gallery_select — ver _shared/client_actions.ts.
import { buildClientActions, handleClientAction } from "../_shared/client_actions.ts";
import { adminClient, handler, HttpError, isUuid, json, sha256 } from "../_shared/http.ts";

Deno.serve(handler(async (req) => {
  const token = req.headers.get("x-portal-token") ?? "";
  if (!/^[0-9a-f]{64}$/.test(token)) throw new HttpError(401, "invalid_token");
  const admin = adminClient();
  const { data: link } = await admin.from("share_links")
    .select("id, organization_id, project_id, scopes, allow_approvals, expires_at, revoked_at, use_count")
    .eq("token_hash", await sha256(token)).maybeSingle();
  if (!link || link.revoked_at || (link.expires_at && new Date(link.expires_at) < new Date())) {
    throw new HttpError(401, "link_expired_or_revoked");
  }
  const scopes = new Set<string>(link.scopes);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  if (body.action === "decide") {
    if (!scopes.has("approvals") || !link.allow_approvals) throw new HttpError(403, "approvals_not_allowed");
    const { approval_id, decision, comment, name } = body;
    if (!isUuid(approval_id) || !["approved", "changes_requested"].includes(decision as string)) throw new HttpError(400, "invalid_input");
    if (typeof name !== "string" || name.trim().length < 2 || name.length > 120) throw new HttpError(400, "name_required");
    if (comment != null && (typeof comment !== "string" || comment.length > 5000)) throw new HttpError(400, "invalid_comment");
    const { data: appr } = await admin.from("approvals").select("id, status").eq("id", approval_id).eq("project_id", link.project_id).maybeSingle();
    if (!appr) throw new HttpError(404, "approval_not_found");
    if (appr.status !== "pending") throw new HttpError(409, "approval_already_answered");
    const { error } = await admin.from("approval_events").insert({
      organization_id: link.organization_id, approval_id, decision, comment: comment ?? null,
      actor_share_link_id: link.id, actor_label: name.trim(),
    });
    if (error) throw new HttpError(400, "decision_failed", error.message);
    return json(req, 200, { ok: true });
  }

  if (typeof body.action === "string" && body.action !== "view" && body.action !== "decide") {
    if (!scopes.has("requests")) throw new HttpError(403, "requests_not_allowed");
    const result = await handleClientAction(admin, link, body);
    if (result === null) throw new HttpError(400, "invalid_action");
    return json(req, 200, result);
  }

  if (body.action !== "view") throw new HttpError(400, "invalid_action");
  await admin.from("share_links").update({ last_used_at: new Date().toISOString(), use_count: link.use_count + 1 }).eq("id", link.id);

  const { data: project } = await admin.from("projects")
    .select("id, name, category, description, start_date, due_date, status, organizations(name)")
    .eq("id", link.project_id).single();
  const out: Record<string, unknown> = { project, scopes: [...scopes] };

  const { data: tasks } = await admin.from("tasks").select("id, title, status, start_date, due_date, client_visible")
    .eq("project_id", link.project_id).is("parent_id", null).order("position");
  const all = tasks ?? [];
  if (scopes.has("progress")) {
    out.progress = all.length ? Math.round((100 * all.filter((t) => t.status === "done").length) / all.length) : 0;
  }
  if (scopes.has("tasks")) out.tasks = all.filter((t) => t.client_visible).map(({ client_visible: _, ...t }) => t);
  if (scopes.has("files")) {
    const { data: files } = await admin.from("files").select("id, name, mime_type, size_bytes, storage_path, created_at")
      .eq("project_id", link.project_id).eq("client_visible", true).order("created_at", { ascending: false });
    out.files = await Promise.all((files ?? []).map(async (f) => {
      const { data } = await admin.storage.from("org-files").createSignedUrl(f.storage_path, 600);
      return { id: f.id, name: f.name, mime_type: f.mime_type, size_bytes: f.size_bytes, created_at: f.created_at, url: data?.signedUrl ?? null };
    }));
  }
  if (scopes.has("approvals")) {
    const { data: approvals } = await admin.from("approvals").select("id, title, description, status, version, due_date, created_at")
      .eq("project_id", link.project_id).neq("status", "cancelled").order("created_at", { ascending: false });
    out.approvals = approvals ?? [];
    out.allow_approvals = link.allow_approvals;
  }
  if (scopes.has("requests")) {
    out.client_actions = await buildClientActions(admin, link, { approvals: scopes.has("approvals") && link.allow_approvals });
  }
  return json(req, 200, out);
}));
