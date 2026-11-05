#!/usr/bin/env node
// Cria o PRIMEIRO administrador do NEXO Studio OS.
// Roda no seu computador (nunca no navegador). Usa a service role, que deve
// ficar só no terminal desta execução.
//
//   SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
//   APP_URL=https://app.seudominio.com.br node scripts/bootstrap-admin.mjs voce@estudio.com.br
//
// A pessoa recebe um e-mail de convite, cria a senha em /convite e, no primeiro
// acesso, cria o estúdio (vira administradora). Depois disso, todos os demais
// usuários entram por convite feito dentro da plataforma.
import { createClient } from "@supabase/supabase-js";

const [email] = process.argv.slice(2);
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, APP_URL = "http://localhost:5173" } = process.env;
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
  console.error("Uso: node scripts/bootstrap-admin.mjs email@dominio.com");
  process.exit(1);
}
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente.");
  process.exit(1);
}
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { count } = await admin.from("organizations").select("id", { count: "exact", head: true });
if ((count ?? 0) > 0) {
  console.error("Já existe um estúdio cadastrado. Convide novas pessoas pela tela Equipe.");
  process.exit(1);
}
const { error } = await admin.auth.admin.inviteUserByEmail(email.toLowerCase(), { redirectTo: `${APP_URL}/convite` });
if (error) { console.error("Falha ao convidar:", error.message); process.exit(1); }
console.log(`Convite enviado para ${email}. Abra o e-mail, crie a senha e configure o estúdio no primeiro acesso.`);
