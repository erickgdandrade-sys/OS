import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";

const state: { row: unknown; error: unknown; upserts: unknown[] } = { row: null, error: null, upserts: [] };
vi.mock("@/lib/supabase", () => ({
  appUrl: (p: string) => `http://x${p}`,
  supabase: { from: () => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.row, error: state.error }) }) }),
    upsert: async (r: unknown) => { state.upserts.push(r); return { error: null }; },
  }) },
}));
vi.mock("@/features/auth/AuthProvider", () => ({ useOrg: () => ({ orgId: "org", userId: "u" }) }));
vi.mock("@/components/layout/AppShell", () => ({ useBreadcrumbs: () => {} }));
vi.mock("@/components/ui", async (orig) => ({ ...(await orig<object>()), useToast: () => () => {} }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });
const btn = (t: string) => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim().startsWith(t)) as HTMLButtonElement;
const tab = (t: string) => [...document.querySelectorAll("[role=tab], button")].find((b) => b.textContent?.trim().startsWith(t)) as HTMLElement;
const type = (el: HTMLInputElement, v: string) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v);
  el.dispatchEvent(new Event("input", { bubbles: true }));
});
async function mount() {
  const { SitePage } = await import("./SitePage");
  document.body.innerHTML = '<div id="r"></div>';
  await act(async () => { createRoot(document.getElementById("r")!).render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><SitePage /></QueryClientProvider>); });
  await tick();
}
beforeEach(() => { state.row = null; state.error = null; state.upserts = []; });

it("avisa quando falta a tabela", async () => {
  state.error = { code: "PGRST205", message: "Could not find the table public.site_settings" };
  await mount();
  expect(document.body.textContent).toContain("ainda não tem a tabela");
});

it("carrega padrão, troca abas, cria projeto e publica", async () => {
  await mount();
  expect((document.getElementById("st-email") as HTMLInputElement).value).toBe("contato@example.com");
  expect(btn("Salvar e publicar").disabled).toBe(true);
  for (const t of ["Redes", "Frases", "Políticas", "Portfólio"]) { await act(async () => tab(t).click()); }
  expect(document.body.textContent).toContain("Projeto de exemplo 1");
  await act(async () => btn("Novo projeto").click());
  await type(document.getElementById("st-p-titulo") as HTMLInputElement, "Marca Ação");
  await act(async () => btn("Aplicar").click());
  expect(document.body.textContent).toContain("Marca Ação");
  await act(async () => btn("Salvar e publicar").click());
  await tick();
  const saved = state.upserts[0] as { content: { portfolio: { slug: string }[] } };
  expect(saved.content.portfolio.at(-1)!.slug).toBe("marca-acao");
});

it("bloqueia publicar com link inválido", async () => {
  await mount();
  await act(async () => tab("Redes").click());
  await type(document.getElementById("st-ru-0") as HTMLInputElement, "instagram.com/x");
  expect(document.body.textContent).toContain("precisa começar com https://");
  expect(btn("Salvar e publicar").disabled).toBe(true);
});

it("preserva o conteúdo salvo", async () => {
  state.row = { content: { contato: { email: "oi@andraego.com" } } };
  await mount();
  expect((document.getElementById("st-email") as HTMLInputElement).value).toBe("oi@andraego.com");
});
