// Assistente do site público (o Gomes): responde perguntas rápidas sobre o
// estúdio usando só o conteúdo publicado no site (site_settings) e a descrição
// dos serviços. Sem acesso a dados internos. Limite por visitante e por dia
// para não esgotar a cota gratuita do Gemini.
// POST { messages: [{ role: "user" | "assistant", content }] }
import { adminClient, handler, HttpError, json, sha256 } from "../_shared/http.ts";

const API = "https://generativelanguage.googleapis.com/v1beta";
const PER_HOUR = 20, PER_DAY = 400;
let models: string[] | null = null;
let good: string | null = null;

const ABOUT = `ANDRA & GO é um estúdio criativo e estratégico em Criciúma (SC) e região, que conecta ideias, marcas e negócios por meio de branding, design e estratégia. Lema: "Ideias com intenção. Marcas com identidade." O nome vem de ANDRAde e GOmes (pronuncia-se "andraego").
Serviços:
• Branding: estratégia de marca, posicionamento, identidade visual, sistemas de identidade, personalidade e comunicação de marca, rebranding e evolução de marcas.
• Design: design gráfico, direção de arte, comunicação visual, materiais institucionais e comerciais, design para ambientes digitais, sistemas gráficos e peças de comunicação.
• Estratégia: estratégia de comunicação, marketing, planejamento estratégico, estratégia de conteúdo, posicionamento e diferenciação, planejamento de presença digital.
Processo: 1) entendemos o problema; 2) questionamos o caminho; 3) identificamos oportunidades; 4) desenvolvemos a solução.
Diferenciais: pensamento estratégico, experimentação, visão multidisciplinar, proximidade com o cliente, criatividade com intenção.`;

async function listModels(key: string) {
  if (models) return models;
  const r = await fetch(`${API}/models?pageSize=200`, { headers: { "x-goog-api-key": key }, signal: AbortSignal.timeout(8000) });
  const d = await r.json().catch(() => ({})) as { models?: { name: string; supportedGenerationMethods?: string[] }[] };
  const names = (d.models ?? []).filter((m) => m.supportedGenerationMethods?.includes("generateContent")).map((m) => m.name.replace(/^models\//, ""))
    .filter((n) => /^gemini-.*flash/.test(n) && !/(image|tts|audio|live|embedding|vision|thinking|robotics|computer|native|preview|exp)/.test(n));
  const ver = (n: string) => Number(/gemini-(\d+(?:\.\d+)?)/.exec(n)?.[1] ?? 0);
  models = names.sort((a, b) => (/lite/.test(b) ? 1000 : 0) - (/lite/.test(a) ? 1000 : 0) + (ver(b) - ver(a)) * 10).slice(0, 4);
  return models;
}

Deno.serve(handler(async (req) => {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) throw new HttpError(503, "ai_not_configured");
  const body = (await req.json().catch(() => ({}))) as { messages?: { role?: string; content?: unknown }[] };
  const msgs = (Array.isArray(body.messages) ? body.messages : []).slice(-10)
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: (m.content as string).slice(0, 1000) }] }));
  while (msgs.length && msgs[0].role !== "user") msgs.shift();
  if (!msgs.length || msgs[msgs.length - 1].role !== "user") throw new HttpError(400, "empty_message");

  const admin = adminClient();
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "anon";
  const visitor = await sha256(`${ip}:${Deno.env.get("SUPABASE_URL")}`);
  const { data: hit } = await admin.rpc("site_assistant_hit", { p_visitor: visitor });
  const usage = (hit ?? { mine: 0, day: 0 }) as { mine: number; day: number };
  if (usage.mine > PER_HOUR || usage.day > PER_DAY) throw new HttpError(429, "ai_rate_limited", "Muitas perguntas por agora. Fale com a gente pelo WhatsApp!");

  const { data: site } = await admin.from("site_settings").select("content").limit(1).maybeSingle();
  const c = (site?.content ?? {}) as { empresa?: { nome?: string; cidade?: string }; contato?: { email?: string; whatsapp?: string }; redes?: { nome: string; url: string }[]; portfolio?: { titulo: string; cliente: string; ano: string; categorias: string[]; resumo: string; exemplo?: boolean }[] };
  const wa = c.contato?.whatsapp ? `https://wa.me/${c.contato.whatsapp.replace(/\D/g, "")}` : null;
  const portfolio = (c.portfolio ?? []).filter((p) => !p.exemplo).map((p) => `- ${p.titulo} (${p.cliente}, ${p.ano}; ${p.categorias.join(", ")}): ${p.resumo}`).join("\n");
  const sys = `Você é o Gomes, assistente do site da ANDRA & GO. Responda em português do Brasil, de forma curta (até 4 frases), simpática e direta, só sobre o estúdio, seus serviços, processo, portfólio e contato.
${ABOUT}
Cidade: ${c.empresa?.cidade ?? "Criciúma, SC"}. Contato: ${[c.contato?.email && `e-mail ${c.contato.email}`, wa && `WhatsApp ${wa}`].filter(Boolean).join(" · ") || "pelo formulário do site"}.
${(c.redes ?? []).length ? `Redes: ${(c.redes ?? []).map((r) => `${r.nome} ${r.url}`).join(" · ")}.` : ""}
${portfolio ? `Portfólio publicado:\n${portfolio}` : "O portfólio completo fica na página Portfólio do site."}
Regras: não invente preços, prazos, clientes ou dados que não estão aqui; para orçamento, prazo ou conversa sobre um projeto, convide a pessoa a chamar no WhatsApp${wa ? ` (${wa})` : ""} ou usar o formulário "Tem uma ideia?". Não peça dados pessoais. Se perguntarem algo fora do assunto, diga com gentileza que só ajuda com dúvidas sobre o estúdio.`;

  const list = await listModels(key);
  const order = [...new Set([...(good ? [good] : []), ...list])];
  let last = "";
  for (const model of order.slice(0, 3)) {
    try {
      const r = await fetch(`${API}/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, signal: AbortSignal.timeout(15000),
        body: JSON.stringify({ systemInstruction: { parts: [{ text: sys }] }, contents: msgs, generationConfig: { maxOutputTokens: 400 } }),
      });
      const d = await r.json().catch(() => ({})) as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[]; error?: { message?: string } };
      if (!r.ok) { last = `${model} ${r.status}: ${d.error?.message ?? ""}`; console.error("site-assistant", last); continue; }
      const text = (d.candidates?.[0]?.content?.parts ?? []).filter((p) => p.text && !p.thought).map((p) => p.text).join("").trim();
      if (!text) { last = `${model}: resposta vazia`; continue; }
      good = model;
      return json(req, 200, { reply: text });
    } catch (e) { last = `${model}: ${e instanceof Error ? e.message : e}`; }
  }
  throw new HttpError(503, "ai_busy", last);
}));
