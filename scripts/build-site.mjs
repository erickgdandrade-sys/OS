// Copia o site institucional para dist/site e aponta o site para o Supabase.
// A URL e a anon key são públicas por definição; nunca use a service role aqui.
import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const out = join(root, "dist", "site");

const fromFile = {};
const envFile = join(root, ".env.production");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^(VITE_SUPABASE_[A-Z_]+)=(.*)$/);
    if (m) fromFile[m[1]] = m[2].trim();
  }
}
const url = process.env.VITE_SUPABASE_URL || fromFile.VITE_SUPABASE_URL || "";
const key = process.env.VITE_SUPABASE_ANON_KEY || fromFile.VITE_SUPABASE_ANON_KEY || "";

cpSync(join(root, "site"), out, { recursive: true });
const index = join(out, "index.html");
writeFileSync(index, readFileSync(index, "utf8").replaceAll("__SUPABASE_URL__", url).replaceAll("__SUPABASE_ANON_KEY__", key));
console.log(`Site copiado para dist/site (${url ? "conectado ao Supabase" : "sem Supabase, usa site-config.json"}).`);
