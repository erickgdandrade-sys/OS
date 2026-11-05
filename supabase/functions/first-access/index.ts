// Primeiro acesso do administrador inicial.
// POST { email }. Resposta SEMPRE neutra (não revela quais e-mails existem).
// Só age se: o e-mail é o configurado em platform_settings.bootstrap_admin_email
// E ainda não existe nenhum estúdio. Nesse caso envia o link para criar a senha.
// Qualquer outro e-mail: nada acontece. Não há cadastro público.
import { adminClient, env, handler, isEmail, json } from "../_shared/http.ts";

const NEUTRAL = { ok: true, message: "Se este e-mail estiver autorizado, você vai receber um link para criar a senha." };

Deno.serve(handler(async (req) => {
  const { email } = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (!isEmail(email)) return json(req, 200, NEUTRAL);
  const normalized = email.trim().toLowerCase();
  const admin = adminClient();

  const { data: setting } = await admin.from("platform_settings").select("value").eq("key", "bootstrap_admin_email").maybeSingle();
  if (!setting || setting.value.trim().toLowerCase() !== normalized) return json(req, 200, NEUTRAL);
  const { count } = await admin.from("organizations").select("id", { count: "exact", head: true });
  if ((count ?? 0) > 0) return json(req, 200, NEUTRAL); // já configurado: use "Esqueci minha senha"

  const { data: existing } = await admin.rpc("find_user_id_by_email", { p_email: normalized });
  if (existing) {
    // Conta já criada mas o estúdio ainda não: reenvia o link para (re)definir a senha.
    await admin.auth.resetPasswordForEmail(normalized, { redirectTo: `${env("APP_URL")}/redefinir-senha` });
  } else {
    const r = await admin.auth.admin.inviteUserByEmail(normalized, { redirectTo: `${env("APP_URL")}/convite`, data: { bootstrap: true } });
    if (r.error) console.error("first-access invite:", r.error.message);
  }
  return json(req, 200, NEUTRAL);
}));
