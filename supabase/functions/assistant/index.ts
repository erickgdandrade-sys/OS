// Assistentes de IA do ANDRA&GO OS.
//   Andrade — tarefas: o que fazer hoje, criar e atualizar tarefas, prazos.
//   Gomes   — plataforma: clientes, projetos, propostas, pendências, agenda,
//             financeiro (se a pessoa tiver acesso) e como usar o sistema.
// Toda leitura e escrita usa o JWT do próprio usuário (mesmas regras de RLS das
// telas): a IA nunca vê nada que a pessoa não veria. A chave da IA fica só no
// servidor (secret GEMINI_API_KEY ou LLM_API_KEY) e nunca vai para o navegador.
// POST { assistant, organization_id, conversation_id?, message }
import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import { adminClient, handler, HttpError, isUuid, json, requirePerm, userClient } from "../_shared/http.ts";

const MODEL = "claude-opus-5-5";
type Who = "andrade" | "gomes";
type Ctx = { db: SupabaseClient; org: string; uid: string; actions: { tool: string; summary: string; link?: string }[] };
type Tool = { def: Anthropic.Beta.BetaTool; run: (c: Ctx, input: Record<string, unknown>) => Promise<unknown> };

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const addDays = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const str = (v: unknown, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const schema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object" as const, properties, required, additionalProperties: false });
const must = <T>(r: { data: T | null; error: { message: string } | null }) => { if (r.error) throw new Error(r.error.message); return r.data as T; };

const searchProjects: Tool = {
  def: { name: "buscar_projetos", description: "Busca projetos pelo nome ou cliente. Use para descobrir o id de um projeto antes de agir nele.", strict: true,
    input_schema: schema({ texto: { type: "string", description: "Parte do nome do projeto ou do cliente; vazio lista os ativos." } }, ["texto"]) },
  run: async ({ db, org }, i) => {
    const t = str(i.texto, 80).replace(/[%,()]/g, " ");
    let q = db.from("projects").select("id, name, category, status, due_date, clients(legal_name, trade_name)").eq("organization_id", org).not("status", "in", "(completed,cancelled)").order("due_date", { nullsFirst: false }).limit(15);
    if (t) q = q.ilike("name", `%${t}%`);
    return must(await q);
  },
};

const andradeTools: Tool[] = [
  {
    def: { name: "minhas_tarefas", description: "Lista as tarefas atribuídas à pessoa que está conversando.", strict: true,
      input_schema: schema({ filtro: { type: "string", enum: ["abertas", "atrasadas", "hoje", "semana", "concluidas_recentes"] } }, ["filtro"]) },
    run: async ({ db, org, uid }, i) => {
      const d = today();
      let q = db.from("tasks").select("id, title, status, priority, start_date, due_date, project_id, projects(name)").eq("organization_id", org).eq("assignee_id", uid).limit(40);
      switch (i.filtro) {
        case "atrasadas": q = q.neq("status", "done").lt("due_date", d); break;
        case "hoje": q = q.neq("status", "done").lte("due_date", d); break;
        case "semana": q = q.neq("status", "done").lte("due_date", addDays(d, 7)); break;
        case "concluidas_recentes": q = q.eq("status", "done").gte("completed_at", addDays(d, -7)); break;
        default: q = q.neq("status", "done");
      }
      return { hoje: d, tarefas: must(await q.order("due_date", { nullsFirst: false })) };
    },
  },
  searchProjects,
  {
    def: { name: "tarefas_do_projeto", description: "Lista as tarefas de um projeto (com responsável e prazo).", strict: true,
      input_schema: schema({ project_id: { type: "string" } }, ["project_id"]) },
    run: async ({ db }, i) => {
      if (!isUuid(i.project_id)) throw new Error("project_id inválido");
      return must(await db.from("tasks").select("id, title, status, priority, due_date, assignee_id, parent_id").eq("project_id", i.project_id).order("position").limit(80));
    },
  },
  {
    def: { name: "equipe", description: "Lista as pessoas ativas da equipe (id e nome), para atribuir tarefas.", strict: true, input_schema: schema({}) },
    run: async ({ db, org }) => ((must(await db.rpc("team_directory", { p_org: org })) ?? []) as { user_id: string; full_name: string; job_title: string | null; status: string }[])
      .filter((p) => p.status === "active").map((p) => ({ id: p.user_id, nome: p.full_name, cargo: p.job_title })),
  },
  {
    def: { name: "criar_tarefa", description: "Cria uma tarefa num projeto. Confirme com a pessoa antes se o pedido for ambíguo.", strict: true,
      input_schema: schema({ project_id: { type: "string" }, titulo: { type: "string" }, descricao: { type: ["string", "null"] }, prazo: { type: ["string", "null"], description: "AAAA-MM-DD" },
        responsavel_id: { type: ["string", "null"], description: "id de `equipe`; vazio = quem está conversando" }, prioridade: { type: "string", enum: ["low", "medium", "high", "urgent"] } },
        ["project_id", "titulo", "descricao", "prazo", "responsavel_id", "prioridade"]) },
    run: async (c, i) => {
      const title = str(i.titulo, 200);
      if (!isUuid(i.project_id) || title.length < 2) throw new Error("Informe projeto e título.");
      if (i.prazo != null && !isDate(i.prazo)) throw new Error("Prazo no formato AAAA-MM-DD.");
      const assignee = isUuid(i.responsavel_id) ? i.responsavel_id : c.uid;
      const row = must(await c.db.from("tasks").insert({ organization_id: c.org, project_id: i.project_id, title, description: str(i.descricao, 4000) || null, due_date: i.prazo ?? null,
        assignee_id: assignee, priority: i.prioridade, created_by: c.uid }).select("id, title, due_date").single()) as { id: string; title: string };
      c.actions.push({ tool: "criar_tarefa", summary: `Tarefa criada: ${row.title}`, link: `/projetos/${i.project_id}` });
      return row;
    },
  },
  {
    def: { name: "atualizar_tarefa", description: "Muda status, prazo, prioridade ou responsável de uma tarefa existente.", strict: true,
      input_schema: schema({ task_id: { type: "string" }, status: { type: ["string", "null"], enum: ["todo", "in_progress", "review", "blocked", "done", null] },
        prazo: { type: ["string", "null"] }, prioridade: { type: ["string", "null"], enum: ["low", "medium", "high", "urgent", null] }, responsavel_id: { type: ["string", "null"] } },
        ["task_id", "status", "prazo", "prioridade", "responsavel_id"]) },
    run: async (c, i) => {
      if (!isUuid(i.task_id)) throw new Error("task_id inválido");
      const patch: Record<string, unknown> = {};
      if (i.status) patch.status = i.status;
      if (i.prazo) { if (!isDate(i.prazo)) throw new Error("Prazo no formato AAAA-MM-DD."); patch.due_date = i.prazo; }
      if (i.prioridade) patch.priority = i.prioridade;
      if (isUuid(i.responsavel_id)) patch.assignee_id = i.responsavel_id;
      if (!Object.keys(patch).length) throw new Error("Nada para alterar.");
      const row = must(await c.db.from("tasks").update(patch).eq("id", i.task_id).select("id, title, status, due_date, project_id").maybeSingle()) as { title: string; project_id: string } | null;
      if (!row) throw new Error("Tarefa não encontrada ou sem permissão para editar.");
      c.actions.push({ tool: "atualizar_tarefa", summary: `Tarefa atualizada: ${row.title}`, link: `/projetos/${row.project_id}` });
      return row;
    },
  },
];

const gomesTools: Tool[] = [
  {
    def: { name: "resumo_do_estudio", description: "Indicadores do estúdio nos últimos 30 dias: projetos, tarefas, clientes, aprovações e (se a pessoa tiver acesso) financeiro.", strict: true, input_schema: schema({}) },
    run: async ({ db, org }) => must(await db.rpc("dashboard_summary", { p_org: org, p_from: addDays(today(), -30), p_to: today() })),
  },
  {
    def: { name: "buscar_clientes", description: "Busca clientes pelo nome.", strict: true, input_schema: schema({ texto: { type: "string" } }, ["texto"]) },
    run: async ({ db, org }, i) => {
      const t = str(i.texto, 80).replace(/[%,()]/g, " ");
      let q = db.from("clients").select("id, legal_name, trade_name, status, segment, email, phone").eq("organization_id", org).order("legal_name").limit(15);
      if (t) q = q.or(`legal_name.ilike.%${t}%,trade_name.ilike.%${t}%`);
      return must(await q);
    },
  },
  searchProjects,
  {
    def: { name: "pendencias_dos_clientes", description: "O que os clientes ainda precisam enviar (pedidos abertos) e o que já responderam e a equipe precisa revisar.", strict: true, input_schema: schema({}) },
    run: async ({ db, org }) => must(await db.from("client_requests").select("id, title, kind, status, due_date, responded_at, projects(name)").eq("organization_id", org).in("status", ["open", "answered"]).order("due_date", { nullsFirst: false }).limit(40)),
  },
  {
    def: { name: "agenda", description: "Compromissos, entregas, gravações e publicações dos próximos dias.", strict: true, input_schema: schema({ dias: { type: "integer", description: "1 a 60" } }, ["dias"]) },
    run: async ({ db, org }, i) => {
      const d = today();
      return must(await db.from("calendar_feed").select("source, title, starts_at, all_day, project_id").eq("organization_id", org)
        .gte("starts_at", `${d}T00:00:00-03:00`).lte("starts_at", `${addDays(d, Number(i.dias) || 7)}T23:59:59-03:00`).order("starts_at").limit(60));
    },
  },
  {
    def: { name: "propostas", description: "Propostas comerciais por status.", strict: true,
      input_schema: schema({ status: { type: ["string", "null"], enum: ["draft", "sent", "viewed", "negotiation", "approved", "rejected", "expired", null] } }, ["status"]) },
    run: async ({ db, org }, i) => {
      let q = db.from("proposals").select("number, title, status, total, valid_until, clients(legal_name, trade_name)").eq("organization_id", org).order("created_at", { ascending: false }).limit(25);
      if (i.status) q = q.eq("status", i.status);
      return must(await q);
    },
  },
  {
    def: { name: "financeiro", description: "Relatório financeiro do período (entradas, saídas, a receber, vencidos). Só funciona para quem tem acesso ao financeiro.", strict: true,
      input_schema: schema({ de: { type: "string", description: "AAAA-MM-DD" }, ate: { type: "string", description: "AAAA-MM-DD" } }, ["de", "ate"]) },
    run: async ({ db, org }, i) => {
      if (!isDate(i.de) || !isDate(i.ate)) throw new Error("Datas no formato AAAA-MM-DD.");
      const r = await db.rpc("finance_report", { p_org: org, p_from: i.de, p_to: i.ate });
      if (r.error) throw new Error(/forbidden|permission/i.test(r.error.message) ? "Esta pessoa não tem acesso ao financeiro." : r.error.message);
      return r.data;
    },
  },
];

const guide = `Mapa do ANDRA&GO OS (para orientar a pessoa):
- Dashboard: indicadores. Minhas tarefas: tarefas atribuídas a você. Calendário: entregas, reuniões, gravações e publicações (assinável no Google Agenda quando disponível).
- Clientes: cadastro e histórico. Projetos: tarefas (lista, kanban, linha do tempo), pedidos ao cliente, naming e pesquisa (branding), moodboards, produções (foto/vídeo e galeria de seleção), arquivos, comentários, horas e portal do cliente (link seguro com “O que precisamos de você”).
- CRM: funil de oportunidades. Propostas: itens, descontos, link público e PDF. Contratos: modelos completos, “Gerar contrato” com dados do estúdio e do cliente, versões e assinatura eletrônica (ZapSign, se configurada). Financeiro: contas a receber/pagar, recorrências e relatórios.
- Briefings: 13 modelos (um por serviço), link para o cliente responder. Branding e naming, Social media (calendário, kanban, aprovação, banco de legendas/hashtags), Biblioteca de arquivos.
- Equipe: convites e carga de trabalho (só o administrador cadastra pessoas). Configurações: dados do estúdio, serviços, modelos e identidade.`;

function system(who: Who, name: string, studio: string) {
  const base = `Você é ${who === "andrade" ? "o Andrade" : "o Gomes"}, assistente do ${studio} dentro do ANDRA&GO OS. Fale em português do Brasil, com clareza e poucas palavras; datas em DD/MM/AAAA e valores em R$. Hoje é ${today().split("-").reverse().join("/")} (fuso de São Paulo). Você está conversando com ${name || "uma pessoa da equipe"}.
Use as ferramentas para consultar dados reais; nunca invente números, nomes, prazos ou links. Se uma ferramenta falhar ou a pessoa não tiver permissão, diga isso com honestidade. Não peça nem repita senhas, tokens ou chaves.`;
  return who === "andrade"
    ? `${base}
Sua especialidade são as TAREFAS: organizar o dia, priorizar, dividir trabalho em etapas, criar e atualizar tarefas e prazos. Antes de criar ou alterar algo, garanta que entendeu o projeto e a tarefa certos (busque o id). Depois de agir, diga exatamente o que mudou. Para assuntos gerais da plataforma, sugira falar com o Gomes.`
    : `${base}
Sua especialidade é a PLATAFORMA como um todo: explicar onde fica cada coisa e como fazer, e responder perguntas sobre clientes, projetos, propostas, pendências dos clientes, agenda e financeiro (se a pessoa tiver acesso). Você só consulta; para criar ou mudar tarefas, indique o Andrade.
${guide}`;
}

type RunResult = { reply: string; tokensIn: number; tokensOut: number; model: string };
const TOO_MANY_STEPS = "Precisei parar aqui: o pedido exigiu passos demais. Pode detalhar um pouco mais?";

async function runTool(tools: Tool[], ctx: Ctx, name: string, input: unknown): Promise<{ ok: boolean; content: string }> {
  const tool = tools.find((t) => t.def.name === name);
  try {
    if (!tool) throw new Error("Ferramenta desconhecida.");
    const out = await tool.run(ctx, (input ?? {}) as Record<string, unknown>);
    return { ok: true, content: JSON.stringify(out ?? null).slice(0, 60000) };
  } catch (e) {
    return { ok: false, content: e instanceof Error ? e.message : "Erro ao executar." };
  }
}

/* ---------------------------------------------------------- Anthropic */
async function runAnthropic(apiKey: string, who: Who, sys: string, messages: Anthropic.Beta.BetaMessageParam[], tools: Tool[], ctx: Ctx): Promise<RunResult> {
  const client = new Anthropic({ apiKey });
  let tokensIn = 0, tokensOut = 0;
  for (let step = 0; step < 8; step++) {
    const res = await client.beta.messages.create({
      model: MODEL, max_tokens: 4096,
      // Se o modelo recusar por engano, o servidor tenta outro modelo automaticamente.
      betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
      output_config: { effort: who === "andrade" ? "medium" : "low" },
      system: sys, tools: tools.map((t) => t.def), messages,
    });
    tokensIn += res.usage.input_tokens; tokensOut += res.usage.output_tokens;
    if (res.stop_reason === "refusal") return { reply: "Não consigo ajudar com esse pedido.", tokensIn, tokensOut, model: MODEL };
    const text = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
    const uses = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (res.stop_reason !== "tool_use" || !uses.length) return { reply: text || "Pronto.", tokensIn, tokensOut, model: MODEL };
    messages.push({ role: "assistant", content: res.content });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = await Promise.all(uses.map(async (b) => {
      const r = await runTool(tools, ctx, b.name, b.input);
      return { type: "tool_result" as const, tool_use_id: b.id, content: r.content, ...(r.ok ? {} : { is_error: true }) };
    }));
    messages.push({ role: "user", content: results });
  }
  return { reply: TOO_MANY_STEPS, tokensIn, tokensOut, model: MODEL };
}

/* ------------------------------------------------------------- Gemini */
// API REST do Gemini (generateContent com function calling). O modelo pode ser
// trocado pelo secret GEMINI_MODEL sem mexer no código.
// O Gemini aceita um subconjunto do JSON Schema: sem additionalProperties e sem
// tipos em lista (["string","null"] vira type + nullable).
function toGeminiSchema(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(toGeminiSchema);
  if (!s || typeof s !== "object") return s;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s as Record<string, unknown>)) {
    if (k === "additionalProperties") continue;
    if (k === "type" && Array.isArray(v)) {
      const t = v.filter((x) => x !== "null");
      out.type = t[0] ?? "string";
      if (v.includes("null")) out.nullable = true;
      continue;
    }
    if (k === "enum" && Array.isArray(v)) { out.enum = v.filter((x) => x !== null); continue; }
    out[k] = toGeminiSchema(v);
  }
  return out;
}
type GPart = { text?: string; functionCall?: { name: string; args?: Record<string, unknown> }; functionResponse?: { name: string; response: Record<string, unknown> }; thought?: boolean };
type GContent = { role: "user" | "model"; parts: GPart[] };

async function runGemini(apiKey: string, sys: string, history: { role: "user" | "assistant"; content: string }[], tools: Tool[], ctx: Ctx): Promise<RunResult> {
  const model = Deno.env.get("GEMINI_MODEL") ?? "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const contents: GContent[] = history.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
  const decl = tools.map((t) => {
    const params = toGeminiSchema(t.def.input_schema) as { properties?: Record<string, unknown> };
    return { name: t.def.name, description: t.def.description, ...(params.properties && Object.keys(params.properties).length ? { parameters: params } : {}) };
  });
  let tokensIn = 0, tokensOut = 0;
  for (let step = 0; step < 8; step++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: sys }] }, contents, tools: [{ functionDeclarations: decl }], generationConfig: { maxOutputTokens: 4096 } }),
    });
    const data = await res.json().catch(() => ({})) as { candidates?: { content?: GContent; finishReason?: string }[]; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }; error?: { code?: number; message?: string; status?: string } };
    if (!res.ok) {
      console.error("gemini", res.status, data.error?.message);
      if (res.status === 429) throw new HttpError(429, "ai_rate_limited", "Limite gratuito do Gemini atingido. Tente de novo em alguns minutos.");
      if (res.status === 400 || res.status === 403) throw new HttpError(502, "ai_provider_error", data.error?.message ?? "Erro no Gemini");
      throw new HttpError(502, "ai_provider_error", data.error?.message ?? `Gemini respondeu ${res.status}`);
    }
    tokensIn += data.usageMetadata?.promptTokenCount ?? 0; tokensOut += data.usageMetadata?.candidatesTokenCount ?? 0;
    const cand = data.candidates?.[0];
    const parts = cand?.content?.parts ?? [];
    if (cand?.finishReason === "SAFETY" || cand?.finishReason === "PROHIBITED_CONTENT") return { reply: "Não consigo ajudar com esse pedido.", tokensIn, tokensOut, model };
    const text = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join("\n").trim();
    const calls = parts.filter((p) => p.functionCall).map((p) => p.functionCall!);
    if (!calls.length) return { reply: text || "Pronto.", tokensIn, tokensOut, model };
    contents.push({ role: "model", parts });
    const results = await Promise.all(calls.map(async (c) => {
      const r = await runTool(tools, ctx, c.name, c.args);
      let payload: unknown; try { payload = JSON.parse(r.content); } catch { payload = r.content; }
      return { functionResponse: { name: c.name, response: r.ok ? { result: payload } : { error: r.content } } };
    }));
    contents.push({ role: "user", parts: results });
  }
  return { reply: TOO_MANY_STEPS, tokensIn, tokensOut, model };
}

Deno.serve(handler(async (req) => {
  const db = userClient(req);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const who = body.assistant === "andrade" ? "andrade" : body.assistant === "gomes" ? "gomes" : null;
  if (!who || !isUuid(body.organization_id)) throw new HttpError(400, "invalid_input");
  const message = str(body.message, 4000);
  if (!message) throw new HttpError(400, "empty_message");
  const org = body.organization_id;
  await requirePerm(db, org, "ai.use");
  const { data: u } = await db.auth.getUser();
  if (!u.user) throw new HttpError(401, "not_authenticated");
  // Provedor de IA: Gemini (plano gratuito do Google) ou Anthropic. Escolha por
  // LLM_PROVIDER ou, se não definido, pela chave que estiver cadastrada.
  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  const anthropicKey = Deno.env.get("LLM_API_KEY") ?? Deno.env.get("ANTHROPIC_API_KEY");
  const provider = Deno.env.get("LLM_PROVIDER") ?? (geminiKey ? "gemini" : "anthropic");
  const apiKey = provider === "gemini" ? geminiKey : anthropicKey;
  if (!apiKey) throw new HttpError(503, "ai_not_configured");

  // Conversa: cria ou confere que é da pessoa (RLS da tabela).
  let convId = body.conversation_id;
  if (convId != null) {
    if (!isUuid(convId)) throw new HttpError(400, "invalid_input");
    const { data: c } = await db.from("ai_conversations").select("id, assistant").eq("id", convId).maybeSingle();
    if (!c || c.assistant !== who) throw new HttpError(404, "conversation_not_found");
  } else {
    const { data: c, error } = await db.from("ai_conversations").insert({ organization_id: org, user_id: u.user.id, assistant: who, title: message.slice(0, 80) }).select("id").single();
    if (error || !c) throw new HttpError(400, "conversation_failed", error?.message);
    convId = c.id;
  }
  const { data: history } = await db.from("ai_messages").select("role, content").eq("conversation_id", convId).order("created_at", { ascending: false }).limit(20);
  const [{ data: profile }, { data: orgRow }] = await Promise.all([
    db.from("profiles").select("full_name").eq("id", u.user.id).maybeSingle(),
    db.from("organizations").select("name").eq("id", org).maybeSingle(),
  ]);

  const tools = who === "andrade" ? andradeTools : gomesTools;
  const ctx: Ctx = { db, org, uid: u.user.id, actions: [] };
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...((history ?? []).reverse().filter((m) => m.role === "user" || m.role === "assistant") as { role: "user" | "assistant"; content: string }[]),
    { role: "user", content: message },
  ];
  // A primeira mensagem do histórico precisa ser da pessoa.
  while (messages.length && messages[0].role !== "user") messages.shift();

  const sys = system(who, profile?.full_name ?? "", orgRow?.name ?? "estúdio");
  const out = provider === "gemini"
    ? await runGemini(apiKey, sys, messages as { role: "user" | "assistant"; content: string }[], tools, ctx)
    : await runAnthropic(apiKey, who, sys, messages, tools, ctx);
  const { reply, tokensIn, tokensOut, model } = out;

  // Grava a troca (a tabela não aceita escrita direta do navegador).
  const admin = adminClient();
  await admin.from("ai_messages").insert([
    { organization_id: org, conversation_id: convId, role: "user", content: message },
    { organization_id: org, conversation_id: convId, role: "assistant", content: reply, model, tokens_in: tokensIn, tokens_out: tokensOut, actions: ctx.actions },
  ]);
  await admin.from("ai_conversations").update({ updated_at: new Date().toISOString() }).eq("id", convId);
  return json(req, 200, { conversation_id: convId, reply, actions: ctx.actions });
}));
