# Plano de implementação por fases

Legenda: ✅ feito e testado · 🟡 banco pronto, telas pendentes · ⏳ pendente · 🔌 depende de serviço externo

## Fase 1 — Fundação (atual)

| Item | Estado | Observação |
|---|---|---|
| Banco completo (todas as entidades, RLS, índices, constraints) | ✅ | 10 migrations; 77 asserções de RLS e fluxo |
| Autenticação: login, mostrar/ocultar senha, recuperar, redefinir, convite (criar senha), primeiro acesso, encerramento de sessão, sessão persistente com renovação | ✅ | Telas prontas; validar com o Supabase real |
| Organização, papéis, permissões configuráveis | ✅ | Matriz editável em Configurações |
| Usuários: convidar, alterar acesso, desativar/reativar, último acesso | ✅ | Edge Function `invite-member` 🔌 (e-mail do Supabase) |
| Clientes: CRUD, busca, filtros, detalhe, contatos, histórico | ✅ | |
| Projetos: CRUD, modelos (7 padrão), Kanban (arrastar), lista, equipe, arquivos (Storage privado), comentários internos/compartilhados, horas, histórico, rentabilidade | ✅ | |
| Tarefas e subtarefas: responsável, prazo, prioridade, status, estimado × realizado, comentários, visibilidade no portal, "Minhas tarefas" | ✅ | Dependências: tabela pronta, interface na Fase 3 (Gantt) |
| Dashboard com filtros de período, indicadores e gráficos (financeiro só para quem tem acesso) | ✅ | Filtros por cliente/projeto/responsável e widgets personalizáveis: Fase 3 |
| Busca global (Ctrl/⌘ K), breadcrumbs, tema claro/escuro, notificações | ✅ | |
| Portal do cliente (conta autenticada e link seguro) | ✅ | Antecipado da Fase 2 porque o redirecionamento de login depende dele |

## Fase 2 — Comercial

* CRM: pipeline Kanban com etapas configuráveis 🟡, leads, conversão em cliente (`convert_lead_to_client` ✅ no banco), atividades e follow-ups, reuniões.
* Serviços e precificação 🟡.
* Construtor de propostas (itens, pacotes, desconto, parcelas, validade, revisões) 🟡 — totais já calculados no servidor; PDF e link de compartilhamento.
* Contratos: modelos com variáveis (3 modelos padrão ✅, `fillTemplate` ✅), revisão antes do envio, versões imutáveis ✅, PDF, assinatura 🔌 (Clicksign/ZapSign/DocuSign — webhook `signature-webhook` define `nexo.signature_webhook` antes de marcar como assinado).
* Aprovar proposta → contrato + projeto + tarefas + parcelas: `approve_proposal` ✅ (botão na tela de propostas).
* Gestão de links do portal (criar, escopos, expiração, revogar) na tela do projeto.

## Fase 3 — Operação

* Financeiro: contas a receber/pagar, baixas, recorrências, categorias, fornecedores, relatórios, exportação CSV/PDF, previsão de caixa (contratado × faturado × recebido) 🟡.
* Calendário geral (view `calendar_feed` ✅) com filtros; Google Calendar 🔌 (OAuth, token no Vault).
* Equipe: painel de distribuição de trabalho e disponibilidade; Gantt/timeline com dependências.
* Notificações: prazos próximos, projetos atrasados e contas vencidas por rotina diária (`mark_overdue` + Edge Function agendada); e-mail transacional 🔌 (Resend).
* Divisão do bundle por rota (`React.lazy`) — hoje o JS tem ~350 kB gzip.

## Fase 4 — Criatividade

Branding (briefing interno e formulário público para o cliente), pesquisa competitiva, naming com matriz de pontuação configurável e etapa de validação de disponibilidade (o sistema nunca declara disponibilidade jurídica sem registro de pesquisa — reforçado por constraint), moodboards em canvas (Konva), social media (calendário editorial, banco de legendas/hashtags, aprovação do cliente; publicação automática só com API conectada 🔌), biblioteca de ativos com tags/pastas e pré-visualização, audiovisual (shot list, cronograma, galeria de seleção de fotos). Todas as tabelas e políticas já existem 🟡.

## Fase 5 — Inteligência

Assistente de IA com contexto autorizado (Edge Function usa o JWT do usuário; nunca a service role para ler dados), automações configuráveis (tabela `automations` 🟡), integrações Meta/LinkedIn 🔌, relatórios avançados.

## O que precisa vir de fora para avançar

| Dependência | Para quê | Quem providencia |
|---|---|---|
| Projeto Supabase (URL, anon key, service role) | Rodar o sistema | Você cria em supabase.com (plano gratuito serve para começar) |
| SMTP próprio no Supabase Auth | Convites e recuperação com o domínio do estúdio (o SMTP padrão tem limite baixo) | Resend, Postmark ou similar |
| Hospedagem do frontend | Publicar | Vercel ou Cloudflare Pages |
| Provedor de assinatura eletrônica | Contratos com validade jurídica | Fase 2 |
| Chave de API de modelo de linguagem | Assistente de IA | Fase 5 |
| Apps Meta/LinkedIn/Google aprovados | Integrações de redes e calendário | Fases 3–5 |
