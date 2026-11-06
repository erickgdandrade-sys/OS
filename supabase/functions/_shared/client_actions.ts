// "O que precisamos de você": tudo que depende do cliente num projeto, montado
// no servidor (service role) depois que o link foi validado. Nada interno sai
// daqui: só pedidos, briefings enviados, aprovações pendentes e galerias com
// seleção liberada, sempre filtrados pelo project_id do link.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import { HttpError, isUuid } from "./http.ts";

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const ALLOWED_MIME = /^(image\/|video\/|audio\/|application\/pdf$|application\/zip$|application\/x-zip|application\/postscript$|application\/illustrator$|application\/vnd\.(openxmlformats|ms-|oasis)|text\/plain$|text\/csv$)/;
const ALLOWED_EXT = /\.(jpe?g|png|gif|webp|heic|svg|ai|eps|pdf|psd|zip|mp4|mov|m4a|mp3|wav|docx?|xlsx?|pptx?|odt|txt|csv)$/i;

export type LinkCtx = { id: string; organization_id: string; project_id: string };

function safeName(n: string) {
  return n.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").slice(-120) || "arquivo";
}

export async function buildClientActions(admin: SupabaseClient, link: LinkCtx, opts: { approvals: boolean }) {
  const pid = link.project_id;
  const [{ data: reqs }, { data: briefings }, { data: prods }] = await Promise.all([
    admin.from("client_requests").select("id, kind, title, description, due_date, is_required, status, response_text, response_links, responded_label, responded_at, position")
      .eq("project_id", pid).neq("status", "cancelled").order("position").order("created_at"),
    admin.from("briefings").select("id, title, category, intro_message, sections, answers, status, submitted_at, respondent_name")
      .eq("project_id", pid).in("status", ["sent", "in_progress", "answered", "reviewed"]).order("created_at"),
    admin.from("media_productions").select("id, title, kind, starts_at").eq("project_id", pid).eq("gallery_selection_enabled", true).order("starts_at", { ascending: false }),
  ]);
  const reqIds = (reqs ?? []).map((r) => r.id);
  const { data: files } = reqIds.length
    ? await admin.from("files").select("id, name, size_bytes, created_at, client_request_id").in("client_request_id", reqIds).order("created_at")
    : { data: [] as { id: string; name: string; size_bytes: number; created_at: string; client_request_id: string }[] };

  const galleries = await Promise.all((prods ?? []).map(async (p) => {
    const { data: assets } = await admin.from("media_assets").select("id, client_selected, position, files(name, storage_path)")
      .eq("production_id", p.id).order("position").limit(400);
    const items = await Promise.all((assets ?? []).map(async (a) => {
      const f = a.files as unknown as { name: string; storage_path: string } | null;
      const { data } = f ? await admin.storage.from("org-files").createSignedUrl(f.storage_path, 1800, { transform: { width: 480, quality: 70 } }) : { data: null };
      const { data: full } = f ? await admin.storage.from("org-files").createSignedUrl(f.storage_path, 1800) : { data: null };
      return { id: a.id, name: f?.name ?? "", selected: a.client_selected, thumb: data?.signedUrl ?? full?.signedUrl ?? null, url: full?.signedUrl ?? null };
    }));
    return { ...p, items, selected: items.filter((i) => i.selected).length };
  }));

  let approvals: unknown[] = [];
  if (opts.approvals) {
    const { data } = await admin.from("approvals").select("id, title, description, version, due_date, created_at, entity_type")
      .eq("project_id", pid).eq("status", "pending").order("created_at");
    approvals = data ?? [];
  }

  const requests = (reqs ?? []).map((r) => ({ ...r, files: (files ?? []).filter((f) => f.client_request_id === r.id).map(({ client_request_id: _, ...f }) => f) }));
  const pending = requests.filter((r) => r.status === "open").length
    + (briefings ?? []).filter((b) => b.status === "sent" || b.status === "in_progress").length
    + approvals.length + galleries.filter((g) => g.items.length > 0 && g.selected === 0).length;
  return { pending, requests, briefings: briefings ?? [], approvals, galleries };
}

async function openRequest(admin: SupabaseClient, link: LinkCtx, id: unknown) {
  if (!isUuid(id)) throw new HttpError(400, "invalid_input");
  const { data } = await admin.from("client_requests").select("id, status, organization_id, project_id").eq("id", id).eq("project_id", link.project_id).maybeSingle();
  if (!data) throw new HttpError(404, "request_not_found");
  if (data.status === "done" || data.status === "cancelled") throw new HttpError(409, "request_closed");
  return data;
}

function requireName(name: unknown) {
  if (typeof name !== "string" || name.trim().length < 2 || name.length > 120) throw new HttpError(400, "name_required");
  return name.trim();
}

/** Ações do cliente. Retorna null se a ação não for desta área. */
export async function handleClientAction(admin: SupabaseClient, link: LinkCtx, body: Record<string, unknown>): Promise<unknown | null> {
  switch (body.action) {
    case "request_answer": {
      const r = await openRequest(admin, link, body.request_id);
      const text = typeof body.text === "string" ? body.text.slice(0, 10000) : "";
      const links = Array.isArray(body.links) ? body.links.filter((l): l is string => typeof l === "string" && l.trim() !== "").map((l) => l.trim()).slice(0, 20) : [];
      const { error } = await admin.rpc("answer_client_request", { p_request: r.id, p_text: text, p_links: links, p_name: requireName(body.name) });
      if (error) throw new HttpError(400, /response_empty|invalid_link|name_required/.exec(error.message)?.[0] ?? "answer_failed");
      return { ok: true };
    }
    case "request_upload_url": {
      const r = await openRequest(admin, link, body.request_id);
      const name = typeof body.file_name === "string" ? body.file_name : "";
      const size = Number(body.size);
      const mime = typeof body.mime_type === "string" ? body.mime_type : "";
      if (!name || !Number.isFinite(size) || size <= 0) throw new HttpError(400, "invalid_input");
      if (size > MAX_UPLOAD_BYTES) throw new HttpError(413, "file_too_large");
      if (!(ALLOWED_MIME.test(mime) || ALLOWED_EXT.test(name))) throw new HttpError(415, "file_type_not_allowed");
      const path = `${r.organization_id}/${r.project_id}/enviado-pelo-cliente/${r.id}/${crypto.randomUUID()}-${safeName(name)}`;
      const { data, error } = await admin.storage.from("org-files").createSignedUploadUrl(path);
      if (error || !data) throw new HttpError(500, "upload_url_failed");
      return { path, token: data.token };
    }
    case "request_upload_done": {
      const r = await openRequest(admin, link, body.request_id);
      const path = typeof body.path === "string" ? body.path : "";
      const prefix = `${r.organization_id}/${r.project_id}/enviado-pelo-cliente/${r.id}/`;
      if (!path.startsWith(prefix) || path.includes("..")) throw new HttpError(400, "invalid_path");
      const file = path.slice(prefix.length);
      const { data: listed } = await admin.storage.from("org-files").list(prefix.slice(0, -1), { search: file, limit: 1 });
      const obj = listed?.find((o) => o.name === file);
      if (!obj) throw new HttpError(400, "upload_not_found");
      const size = Number((obj.metadata as Record<string, unknown> | null)?.size ?? body.size ?? 0);
      if (size > MAX_UPLOAD_BYTES) { await admin.storage.from("org-files").remove([path]); throw new HttpError(413, "file_too_large"); }
      const original = typeof body.file_name === "string" && body.file_name.trim() ? body.file_name.trim().slice(0, 200) : file.replace(/^[0-9a-f-]{36}-/, "");
      const { data: row, error } = await admin.from("files").insert({
        organization_id: r.organization_id, project_id: r.project_id, storage_path: path, name: original,
        mime_type: (obj.metadata as Record<string, unknown> | null)?.mimetype ?? null, size_bytes: size,
        folder: "Enviado pelo cliente", tags: ["enviado-pelo-cliente"], client_visible: true,
        client_request_id: r.id, uploaded_via_share_link: link.id,
      }).select("id, name, size_bytes, created_at").single();
      if (error) throw new HttpError(400, "register_failed");
      return { ok: true, file: row };
    }
    case "briefing_save": {
      if (!isUuid(body.briefing_id)) throw new HttpError(400, "invalid_input");
      const { data: b } = await admin.from("briefings").select("id, status").eq("id", body.briefing_id).eq("project_id", link.project_id).maybeSingle();
      if (!b) throw new HttpError(404, "briefing_not_found");
      if (b.status !== "sent" && b.status !== "in_progress") throw new HttpError(409, "briefing_not_open");
      const answers = body.answers;
      if (!answers || typeof answers !== "object" || Array.isArray(answers)) throw new HttpError(400, "invalid_answers");
      const final = body.final === true;
      const { error } = await admin.rpc("save_briefing_answers", { p_briefing: b.id, p_answers: answers, p_final: final, p_name: final ? requireName(body.name) : (typeof body.name === "string" ? body.name : null) });
      if (error) throw new HttpError(400, /name_required|invalid_answers|briefing_not_open/.exec(error.message)?.[0] ?? "save_failed");
      return { ok: true };
    }
    case "gallery_select": {
      if (!isUuid(body.asset_id) || typeof body.selected !== "boolean") throw new HttpError(400, "invalid_input");
      const { data: a } = await admin.from("media_assets").select("id, media_productions!inner(project_id, gallery_selection_enabled)")
        .eq("id", body.asset_id).maybeSingle();
      const mp = a?.media_productions as unknown as { project_id: string; gallery_selection_enabled: boolean } | undefined;
      if (!a || !mp || mp.project_id !== link.project_id || !mp.gallery_selection_enabled) throw new HttpError(404, "asset_not_found");
      const { error } = await admin.from("media_assets").update({ client_selected: body.selected, selected_at: body.selected ? new Date().toISOString() : null }).eq("id", a.id);
      if (error) throw new HttpError(400, "select_failed");
      return { ok: true };
    }
  }
  return null;
}
