import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** URL absoluta dentro do app, respeitando o caminho base (ex.: /SISTEMA-TESTE/ no GitHub Pages). */
export const appUrl = (path: string) => `${location.origin}${import.meta.env.BASE_URL.replace(/\/$/, "")}${path}`;

/** true quando as variáveis do Supabase não foram configuradas. */
export const supabaseConfigMissing = !url || !anonKey;

// A anon key é pública por definição; quem protege os dados é o RLS.
// A service role NUNCA entra no frontend.
export const supabase = createClient(url || "http://localhost:54321", anonKey || "missing-anon-key", {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true},
});

/** Chama uma Edge Function com o JWT do usuário logado. */
export async function invokeFunction<T = unknown>(name: string, body: unknown, headers?: Record<string, string>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(name, { body: body as Record<string, unknown>, headers });
  if (error) {
    let message = error.message;
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx) message = (await ctx.json())?.error ?? message;
    } catch { /* corpo não era JSON */ }
    throw new Error(message);
  }
  return data as T;
}
