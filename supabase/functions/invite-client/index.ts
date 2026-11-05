// Dá acesso ao portal para um contato do cliente (conta com e-mail e senha).
// POST { client_id, email }  — exige portal.share na organização do cliente.
import { adminClient, env, handler, HttpError, isEmail, isUuid, json, requirePerm, userClient } from "../_shared/http.ts";

Deno.serve(handler(async (req) => {
  const { client_id, email } = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (!isUuid(client_id) || !isEmail(email)) throw new HttpError(400, "invalid_input");

  const caller = userClient(req);
  const { data: me } = await caller.auth.getUser();
  if (!me.user) throw new HttpError(401, "not_authenticated");
  const { data: client, error } = await caller.from("clients").select("id, organization_id").eq("id", client_id).single();
  if (error || !client) throw new HttpError(404, "client_not_found");
  // Contas de cliente também só são criadas pelo administrador.
  await requirePerm(caller, client.organization_id, "users.manage");

  const admin = adminClient();
  const normalized = (email as string).trim().toLowerCase();
  // Não permite transformar membro da equipe em cliente (separação de papéis).
  const { data: existingId } = await admin.rpc("find_user_id_by_email", { p_email: normalized });
  if (existingId) {
    const { count } = await admin.from("organization_members").select("user_id", { count: "exact", head: true }).eq("user_id", existingId);
    if ((count ?? 0) > 0) throw new HttpError(409, "email_belongs_to_team_member");
  }
  let userId = existingId as string | null;
  if (!userId) {
    const r = await admin.auth.admin.inviteUserByEmail(normalized, { redirectTo: `${env("APP_URL")}/convite`, data: { portal: true } });
    if (r.error) throw new HttpError(400, "invite_failed", r.error.message);
    userId = r.data.user!.id;
  }
  const { error: cuErr } = await admin.from("client_users").upsert(
    { organization_id: client.organization_id, client_id, user_id: userId, status: existingId ? "active" : "invited", invited_by: me.user.id },
    { onConflict: "client_id,user_id" });
  if (cuErr) throw new HttpError(400, "client_user_failed", cuErr.message);
  return json(req, 200, { ok: true });
}));
