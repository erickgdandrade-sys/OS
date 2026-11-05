# NEXO Studio OS — Arquitetura e planejamento técnico

Documento vivo. Cada decisão aqui tem o motivo ao lado; quando uma decisão mudar, atualize este arquivo no mesmo commit.

## 1. Arquitetura geral

```
┌────────────────────────────┐        ┌──────────────────────────────────────────────┐
│ SPA React + TypeScript     │  HTTPS │ Supabase                                     │
│ (Vite, Tailwind, TanStack) │───────▶│  • Auth (e-mail/senha, convites, recuperação)│
│                            │  JWT   │  • PostgREST → Postgres com RLS              │
│  • painel interno (/)      │        │  • Storage (bucket privado org-files)        │
│  • portal do cliente       │        │  • Edge Functions (Deno)                     │
│    (/portal, /p#token)     │        │      invite-member, invite-client, portal    │
└────────────────────────────┘        │      (Fase 2+: pdf, signature-webhook,       │
         anon key (pública)           │       ai-assistant, google-calendar, social) │
                                      └──────────────────────────────────────────────┘
```

* **O banco é a fonte da verdade da segurança.** Toda regra de acesso está em políticas RLS e funções `SECURITY DEFINER` no Postgres. A interface só esconde o que a pessoa não pode usar; mesmo que alguém chame a API diretamente, o banco recusa.
* **Frontend sem segredos.** Só a anon key vai para o navegador (ela é pública por design). A service role existe apenas nas Edge Functions e no script de bootstrap executado no terminal.
* **Regras de negócio que precisam ser atômicas ficam em SQL** (ex.: `approve_proposal`, `convert_lead_to_client`, `apply_project_template`, baixa financeira gerando transação). Isso evita estados pela metade quando a rede cai no meio de um fluxo.
* **Multi-organização desde o início.** Toda tabela de negócio tem `organization_id`, e as relações entre tabelas usam chaves estrangeiras compostas `(organization_id, id)`. É impossível, no nível do banco, ligar um projeto a um cliente de outro estúdio ou uma despesa a um projeto de outra organização.

### Decisões de stack

| Tema | Escolha | Motivo |
|---|---|---|
| Build | Vite 8 + React 19 + TypeScript 5.9 (strict) | Rápido, padrão de mercado. TS 7 (nativo) ainda é recente; ficamos no 5.x estável. |
| Estilo | Tailwind CSS 4 com tokens em CSS variables (`src/styles.css`) | Trocar a identidade = editar um bloco de variáveis; tema escuro por classe `.dark`. |
| Rotas | TanStack Router (rotas em código) | Tipado, leve, com guards por layout. |
| Dados | TanStack Query + supabase-js | Cache, revalidação e atualizações otimistas (Kanban). |
| Formulários | React Hook Form + Zod 4 | Validação idêntica no cliente; o banco repete as regras com `check`/constraints. |
| Gráficos | Recharts 3 | Suficiente para barras/pizza; cores vindas dos tokens. |
| Ícones | lucide-react | Traço consistente. |
| Canvas (Fase 4) | **Konva (react-konva)** | Moodboard livre precisa de arrastar, redimensionar, rotacionar e exportar PNG; React Flow é feito para grafos e nós conectados, não para composição livre. |
| PDF (Fase 2) | HTML → PDF numa Edge Function (Chromium headless via serviço) ou `@react-pdf/renderer` no cliente para propostas | Contrato precisa de PDF fiel ao HTML revisado; decisão final na Fase 2 após teste de fidelidade. |
| Assinatura (Fase 2) | Provedor externo (Clicksign, ZapSign ou DocuSign) | Validade jurídica exige provedor; o banco bloqueia `status = signed` fora do webhook (`contracts_guard`). |
| IA (Fase 5) | Edge Function `ai-assistant` chamando a API configurada em `LLM_API_KEY`/`LLM_MODEL` | Chave nunca no frontend; a função monta o contexto só com dados que o usuário pode ler (usa o JWT dele). |

## 2. Estrutura de pastas

```
.
├── docs/                      ARQUITETURA.md, PLANO.md, IMPLANTACAO.md, SEGURANCA-LGPD.md
├── scripts/
│   ├── bootstrap-admin.mjs    cria o primeiro administrador (terminal, service role)
│   └── test-db.sh             aplica migrations num Postgres descartável e roda os testes de RLS
├── supabase/
│   ├── config.toml            Auth sem cadastro público, senha mínima, rotação de tokens
│   ├── migrations/            0001 fundação → 0010 (ordem = dependência)
│   ├── functions/             Edge Functions (Deno) + _shared/http.ts
│   └── tests/                 stub local do Supabase + rls_test.sql (77 asserções)
└── src/
    ├── app/router.tsx         rotas, guards (sessão, papel, portal, primeiro acesso)
    ├── components/ui/         design system: Button, Input, Field, Select, Badge, Card, Modal,
    │                          ConfirmDialog, Toast, Tabs, Segmented, EmptyState, ErrorState, Progress…
    ├── components/layout/     AppShell (sidebar, breadcrumbs, tema, notificações), CommandPalette
    ├── features/<módulo>/     telas e hooks por módulo (auth, dashboard, clients, projects, tasks,
    │                          team, settings, portal; Fases 2–5 entram aqui)
    ├── lib/                   supabase.ts, format.ts (BRL, DD/MM/AAAA, fuso SP, CPF/CNPJ), domain.ts
    └── styles.css             tokens de cor, tipografia, raios e sombras (claro/escuro)
```

## 3. Modelo de dados

61 tabelas e 11 views em `public`, em 10 migrations. Convenções:

* `id uuid` (gen_random_uuid), `created_at/updated_at timestamptz`, trigger `set_updated_at`.
* `organization_id` em todas as tabelas de negócio + `unique (organization_id, id)` nas tabelas referenciadas.
* Valores em `numeric(14,2)`; datas de negócio em `date` (sem fuso); instantes em `timestamptz`; o servidor calcula "hoje" em `America/Sao_Paulo`.
* Enums em inglês no banco, rótulos em português no frontend (`src/lib/domain.ts`).
* Tabelas sensíveis têm trigger de auditoria `log_activity` → `activity_logs` (campos alterados, autor e data).

| Domínio | Tabelas |
|---|---|
| Identidade e acesso | `organizations`, `profiles` (1:1 `auth.users`), `organization_members` (papel, função, status, custo/hora), `permissions`, `role_permissions`, `member_permissions`, `invitations`, `activity_logs` |
| Clientes e CRM | `clients`, `client_contacts`, `client_users` (contas do portal), `pipeline_stages`, `leads`, `opportunities`, `crm_activities`, `meetings` |
| Projetos | `project_templates`, `project_template_tasks`, `projects`, `project_members`, `tasks` (subtarefas por `parent_id`; view `subtasks`), `task_dependencies`, `task_comments`, `project_comments`, `time_entries`, `files`, `approvals`, `approval_events` |
| Comercial | `services`, `proposals`, `proposal_items`, `contract_templates`, `contracts`, `contract_versions` (imutáveis), `share_links` |
| Financeiro | `financial_categories`, `suppliers`, `invoices`, `accounts_receivable`, `accounts_payable`, `transactions`; views `expenses`, `project_profitability` |
| Criação | `brand_briefings`, `brand_competitors`, `naming_territories`, `naming_criteria`, `naming_candidates`, `naming_scores`, `moodboards`, `moodboard_elements`, `social_accounts`, `social_calendars`, `social_posts`, `content_snippets`, `media_productions`, `media_assets` |
| Operação | `calendar_events` (+ view `calendar_feed` que agrega prazos, reuniões, gravações, posts e aprovações), `notifications`, `automations`, `integrations`, `ai_conversations`, `ai_messages` |
| Portal | views `portal_projects`, `portal_tasks`, `portal_files`, `portal_comments`, `portal_proposals`, `portal_contracts`, `portal_social_posts` |

Desvios conscientes da lista original, para não duplicar dados:

* **`users`** é o `auth.users` do Supabase; dados de perfil ficam em `profiles`. Nunca guardamos senha.
* **`subtasks`** é uma view sobre `tasks` (`parent_id is not null`): mesma estrutura, uma tabela só.
* **`expenses`** é uma view sobre `accounts_payable` + categoria: a despesa é uma conta a pagar classificada.
* **`social_calendars`** representa o planejamento mensal por cliente; posts podem existir sem calendário.

## 4. Relacionamentos principais

```
organizations ─┬─< organization_members >── auth.users ──1:1── profiles
               ├─< clients ─┬─< client_contacts
               │            ├─< client_users >── auth.users        (portal)
               │            ├─< projects ─┬─< tasks ─┬─< tasks (subtarefas)
               │            │             │          ├─< task_comments / task_dependencies
               │            │             │          └─< time_entries (custo/hora congelado)
               │            │             ├─< project_members, project_comments, files, approvals ─< approval_events
               │            │             ├─< share_links (token só em hash)
               │            │             ├─< brand_*, naming_*, moodboards ─< moodboard_elements, media_productions ─< media_assets
               │            │             └── proposal_id / contract_id
               │            ├─< proposals ─< proposal_items >── services
               │            ├─< contracts ─< contract_versions
               │            ├─< accounts_receivable ──1:1── transactions (entrada, quando paga)
               │            └─< social_accounts / social_calendars / social_posts
               ├─< accounts_payable (projeto opcional → rentabilidade) ──1:1── transactions (saída)
               ├─< leads ─< opportunities >── pipeline_stages, crm_activities, meetings
               └─< notifications, automations, integrations, ai_conversations ─< ai_messages
```

## 5. Fluxos principais

1. **Proposta aprovada** (`approve_proposal`, uma transação): proposta → `approved`; projeto criado com valor contratado, cliente, escopo e responsável; tarefas geradas do modelo (etapas opcionais como *Naming* só entram se o serviço foi contratado); contrato em rascunho com versão 1 (quando há permissão e modelo); parcelas em `accounts_receivable` com status `scheduled` (previstas, não faturadas) somando exatamente o total.
2. **Receita contratada → faturada → recebida.** `scheduled` (contratado) → `open`/`overdue` (faturado) → `paid` (recebido). Só a baixa (`paid`) cria `transactions`; dashboard e caixa usam apenas `transactions`.
3. **Despesa de projeto.** `accounts_payable.project_id` + `cost_type` (terceirizado/adicional) entram em `project_profitability`; horas entram como custo interno (minutos × custo/hora congelado no lançamento).
4. **Convite de colaborador.** Admin → Edge Function `invite-member` (checa `users.manage`, só admin convida admin) → e-mail do Supabase Auth → `/convite` (nome + senha) → `accept_invitation()` ativa a associação. Antes do aceite, o convidado não lê nada.
5. **Login.** `session_context()` devolve organizações, papel e permissões efetivas. Membro → painel; conta de cliente → `/portal`; conta sem vínculo → `/primeiro-acesso` (só o administrador inicial chega aqui).
6. **Portal do cliente.** Conta autenticada lê só as views `portal_*` (colunas seguras, filtradas por `is_client_user`). Link seguro: token de 256 bits mostrado uma vez, guardado como SHA-256, com escopos, expiração e revogação; validado pela Edge Function `portal`. O token vai no fragmento `#` da URL e no header `x-portal-token`, nunca em query string.
7. **Aprovação.** Equipe cria `approvals` (versão, arquivo); cliente responde (conta ou link) → `approval_events` (data, usuário ou nome informado) → status atualizado e notificação para quem pediu e para o responsável.

## 6. Autenticação e permissões

* **Supabase Auth**, cadastro público desligado (`enable_signup = false`), senha mínima de 10 caracteres com letras e números, JWT de 1 h com refresh token rotativo, recuperação de senha por e-mail com resposta neutra (não revela se o e-mail existe).
* **Papéis (RBAC):** `admin`, `manager` (Gestor), `member` (Colaborador), `finance` (Financeiro), `external` (Colaborador externo). **Cliente** não é papel da equipe: é uma conta em `client_users`, isolada no portal.
* **Função** (Designer, Fotógrafo, Videomaker, Social media…) é um atributo descritivo (`job_title`), separado do nível de acesso.
* **Permissões configuráveis:** 22 chaves em `permissions`. `role_permissions` define o padrão de cada papel por organização (editável em Configurações → Permissões); `member_permissions` concede ou revoga por pessoa. `has_perm(org, chave)` resolve: admin → sempre; exceção individual → vale; senão → padrão do papel.
* **Escopo:** além da permissão, projetos exigem `projects.read_all` **ou** ser responsável/membro do projeto (`can_access_project`). Tarefas, horas, arquivos, comentários e itens criativos herdam esse escopo.
* **Proteções estruturais testadas:** organização nunca fica sem admin; colaborador não se promove; usuário comum não executa rotinas internas (`mark_overdue`, `find_user_id_by_email`); anônimo não executa RPCs nem lê tabelas; contrato não vira "assinado" sem webhook do provedor; versão de contrato é imutável.

## 7. Plano de testes

| Camada | Como | Estado |
|---|---|---|
| Banco (RLS, constraints, fluxos) | `scripts/test-db.sh` aplica as 10 migrations num Postgres 16 descartável (com stub de `auth`/`storage`) e roda `supabase/tests/rls_test.sql`: isolamento entre estúdios, permissões por papel, portal, financeiro, automação de proposta, convites, links seguros, anônimo | **77 asserções passando** |
| Regras puras do frontend | Vitest (`npm test`): BRL, datas DD/MM/AAAA, fuso SP, CPF/CNPJ, modelos `{{variáveis}}` com escape, mensagens de erro | **9 testes passando** |
| Tipos e build | `npm run typecheck` e `npm run build` | Passando |
| Edge Functions | Testes de integração com `supabase start` + `supabase functions serve` (convite, portal por token: expirado, revogado, escopo) | A fazer com um projeto Supabase de desenvolvimento |
| Ponta a ponta | Playwright: login → criar cliente → projeto por modelo → tarefa → horas → portal aprova | A fazer após conectar o Supabase |
| Acessibilidade | Foco visível, labels em todos os campos, `aria-*` em diálogos, contraste AA dos tokens; revisão com axe na Fase 3 | Parcial |

Ao fim de cada fase: rodar as três suítes, revisar políticas novas com casos negativos (outro estúdio, outro cliente, papel sem permissão, anônimo) e atualizar este documento e o `PLANO.md`.
