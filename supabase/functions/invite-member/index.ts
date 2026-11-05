// Convida um colaborador para a organização.
// POST { organization_id, email, role, job_title? }  (Authorization: Bearer <jwt do admin>)
import { adminClient, handler, HttpError, isEmail, isUuid, json, requirePerm, userClient, env } from "../_shared/http.ts";

const ROLES = ["admin", "manager", "member", "finance", "external"] as const;

Deno.serve(handler(async (req) => {
  const body = await req.json().catch(() => ({}));
  const { organization_id, email, role, job_title } = body as Record<string, unknown>;
  if (!isUuid(organization_id) || !isEmail(email) || !ROLES.includes(role as typeof ROLES[number])) {
    throw new HttpError(400, "invalid_input");
  }
  if (job_title != null && (typeof job_title !== "string" || job_title.length > 80)) throw new HttpError(400, "invalid_job_title");

  const caller = userClient(req);
  const { data: me } = await caller.auth.getUser();
  if (!me.user) throw new HttpError(401, "not_authenticated");
  // Cadastro de usuários é exclusivo do administrador.
  await requirePerm(caller, organization_id, "users.manage");
  const { data: r } = await caller.rpc("current_member_role", { p_org: organization_id });
  if (r !== "admin") throw new HttpError(403, "only_admin_creates_users");

  const admin = adminClient();
  const normalized = (email as string).trim().toLowerCase();
  const redirectTo = `${env("APP_URL")}/convite`;

  // Usuário pode já existir (ex.: colaborador de outro estúdio).
  let userId: string | undefined;
  const invited = await admin.auth.admin.inviteUserByEmail(normalized, { redirectTo, data: { invited_org: organization_id } });
  if (invited.error) {
    if (!/already|registered|exists/i.test(invited.error.message)) throw new HttpError(400, "invite_failed", invited.error.message);
    const { data: existing } = await admin.rpc("find_user_id_by_email", { p_email: normalized });
    userId = existing ?? undefined;
    if (!userId) throw new HttpError(400, "invite_failed", invited.error.message);
    await admin.auth.signInWithOtp({ email: normalized, options: { emailRedirectTo: redirectTo, shouldCreateUser: false } });
  } else {
    userId = invited.data.user?.id;
  }

  const { error: invErr } = await admin.from("invitations").insert({
    organization_id, email: normalized, role, job_title: job_title ?? null, invited_by: me.user.id,
  });
  if (invErr && invErr.code !== "23505") throw new HttpError(400, "invitation_record_failed", invErr.message);

  const { error: memErr } = await admin.from("organization_members").upsert({
    organization_id, user_id: userId, role, job_title: job_title ?? null, status: "invited", invited_by: me.user.id,
  }, { onConflict: "organization_id,user_id", ignoreDuplicates: true });
  if (memErr) throw new HttpError(400, "member_record_failed", memErr.message);

  await admin.from("activity_logs").insert({
    organization_id, actor_id: me.user.id, entity_type: "invitations", entity_id: userId, action: "invite", changes: { email: normalized, role },
  });
  return json(req, 200, { ok: true });
}));
