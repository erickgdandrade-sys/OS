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

## Fase 2 — Comercial ✅

| Item | Estado | Observação |
|---|---|---|
| CRM: pipeline Kanban com etapas, valores por etapa, arrastar, motivo obrigatório ao perder, histórico automático de mudança de etapa | ✅ | `move_opportunity` |
| Leads, oportunidades para cliente existente, atividades e follow-ups | ✅ | |
| Converter lead em cliente mantendo histórico, contato e oportunidades | ✅ | `convert_lead_to_client` |
| Serviços e preços (Configurações → Serviços e preços) | ✅ | |
| Construtor de propostas: itens do catálogo ou livres, pacotes, quantidades, desconto (% ou R$), parcelas, validade, revisões, escopo, entregáveis, condições, observações internas | ✅ | Totais calculados no servidor |
| Status: rascunho → enviada → visualizada (pelo portal) → negociação → aprovada/recusada/expirada | ✅ | `send_proposal`, `portal_view_proposal`, `reject_proposal`, `expire_proposals` (rotina diária) |
| PDF da proposta (versão de impressão com a identidade do estúdio) | ✅ | Impressão do navegador → "Salvar como PDF" |
| Aprovar proposta → contrato + projeto + tarefas + parcelas | ✅ | Tela mostra o que será gerado antes de confirmar |
| Contratos: criar de modelo, variáveis preenchidas pelo servidor, aviso de campos sem dado, revisão de cláusulas, versões imutáveis, PDF, disponibilizar no portal, cancelar | ✅ | `contract_variables`, `save_contract_version`, `create_contract` |
| Assinatura eletrônica (ZapSign): envio do PDF com signatários e webhook que marca como assinado | ✅ 🔌 | Edge Functions `signature-send` e `signature-webhook`; precisa do token ZapSign. Sem ele, o botão fica desabilitado com a instrução |
| Portal: propostas e contratos do cliente; links seguros com escopo, validade, revogação e contador de acessos; convite de contas do cliente | ✅ | Edge Functions `portal` e `invite-client` 🔌 a publicar |
| Identidade do estúdio (logo e cor) nos PDFs, na impressão e na página pública | ✅ | Configurações → Identidade |
| PDF gerado no servidor (salvo nos arquivos do estúdio) | ✅ | Edge Function `document-pdf` (pdf-lib), testada com Vitest |
| Link público de proposta com validade, revogação, download do PDF e aceite registrado (nome e data) | ✅ | Edge Function `proposal-public`; o aceite avisa a equipe, que aprova formalmente |

## Ajustes solicitados (pós-Fase 3) ✅

| Item | Estado |
|---|---|
| Acesso inicial do administrador (erickgdandrade@gmail.com) com criação de senha por link; sem cadastro público | ✅ |
| Cadastro de usuários e contas de clientes exclusivo do administrador (garantido no banco e nas Edge Functions) | ✅ |
| Modelos completos de contrato (8 categorias): partes, objeto, escopo, prazos, obrigações, pagamento, mora e reajuste, revisões, propriedade intelectual, naming/INPI, portfólio, confidencialidade, LGPD, responsabilidade, rescisão, força maior, comunicações, assinatura eletrônica, foro, assinaturas e testemunhas | ✅ |
| Tela "Gerar contrato": dados do estúdio, cliente cadastrado ou novo (cadastrado ao gerar), dados do serviço, prévia ao vivo com campos em branco destacados | ✅ |

## Fase 3 — Operação ✅

| Item | Estado | Observação |
|---|---|---|
| Contas a receber: previstas (das propostas), faturar, baixa com data/valor/forma, estorno, cancelamento, parcelamento manual | ✅ | `invoice_receivable`, `settle`, `reopen` |
| Contas a pagar: categorias, fornecedores, projeto vinculado (terceirizado/adicional), recorrência que gera a próxima ao pagar | ✅ | Impacta a rentabilidade do projeto |
| Fornecedores | ✅ | |
| Relatórios: receita por cliente, projeto e serviço; despesas por grupo; receita recorrente; caixa mensal; previsão de 6 meses (faturado × previsto × a pagar) | ✅ | `finance_report` |
| Exportação CSV (relatório, a receber, a pagar) | ✅ | Formato Excel pt-BR (`;`, vírgula decimal) |
| Calendário geral (mês e agenda) com filtros por tipo, projeto e "só os meus"; criação de reuniões e compromissos | ✅ | View `calendar_feed` |
| Google Calendar | 🔌 | Fase 5 (OAuth) |
| Distribuição de trabalho: horas previstas × capacidade, abertas, atrasadas, horas lançadas | ✅ | `team_workload` |
| Linha do tempo (Gantt) do projeto e dependências entre tarefas | ✅ | Alerta quando a tarefa depende de outra não concluída |
| Alertas diários: prazo amanhã, projeto atrasado, conta vencida, além de vencidos e propostas expiradas | ✅ | `run_daily_alerts()` via pg_cron |
| Notificações de pagamento recebido, proposta aceita e contrato assinado | ✅ | |
| Divisão do bundle por rota | ✅ | JS inicial de ~350 kB para ~217 kB (gzip) |
| Exportação de dados do cliente (LGPD) e campo do encarregado | ⏳ | Próxima etapa |

## Fase 4 — Criatividade

Branding (briefing interno e formulário público para o cliente), pesquisa competitiva, naming com matriz de pontuação configurável e etapa de validação de disponibilidade (o sistema nunca declara disponibilidade jurídica sem registro de pesquisa — reforçado por constraint), moodboards em canvas (Konva), social media (calendário editorial, banco de legendas/hashtags, aprovação do cliente; publicação automática só com API conectada 🔌), biblioteca de ativos com tags/pastas e pré-visualização, audiovisual (shot list, cronograma, galeria de seleção de fotos). Todas as tabelas e políticas já existem 🟡.

**Entregue na Fase 4 até agora ✅**
- **Briefings** (`/briefings`): 13 modelos padrão (um por serviço), editor de modelos, briefing por cliente/projeto, link avulso com validade (`/briefing#token`, Edge Function `briefing-public`) ou resposta dentro do link do projeto. O cliente salva rascunho e envia; a equipe é avisada e marca como revisado.
- **O que precisamos de você** (link do projeto, escopo `requests`): reúne tudo que depende do cliente — pedidos (referências, conteúdo, documentos, acessos, informações) com resposta em texto, links e upload de arquivos (até 50 MB, URL assinada; arquivo fica ligado ao pedido e ao link usado), briefings abertos, aprovações pendentes e seleção de fotos da galeria. Pedidos de acesso orientam o cliente a não enviar senhas.
- **Pedidos ao cliente** (aba do projeto): sugestão automática por tipo de projeto (`suggest_client_requests`), criação/edição, concluir, pedir de novo, download do que o cliente enviou.
- **Naming e pesquisa** (aba do projeto de branding/naming): territórios, critérios com peso, nota 0–10 de cada pessoa, ranking ponderado, finalistas enviados ao cliente como aprovação, validação de disponibilidade com registro obrigatório, pesquisa competitiva.
- **Moodboards** (aba do projeto): canvas com zoom e navegação; imagens, textos, notas, paletas, links e seções; arrastar/redimensionar/camadas; salvo no banco; quadros marcados aparecem no link do cliente (somente leitura).
- **Produções** (fotografia/audiovisual): planejamento, equipe, equipamentos, shot list, roteiro, cronograma do dia, etapa de edição e galeria de seleção (envio de fotos, abertura ao cliente, exportar seleção em CSV/nomes).
- **Social media** (`/social`): calendário mensal, kanban e lista por cliente; post com legenda, hashtags, CTA, roteiro, pilar e responsável; envio para aprovação do cliente; registro manual da publicação com link (sem publicação automática sem integração); banco de ideias, legendas, hashtags e roteiros; contas e pilares do mês.
- **Biblioteca** (`/biblioteca`): todos os arquivos visíveis ao usuário, com busca, filtros por tipo/projeto/pasta/tag, grade com miniaturas, edição de pasta/tags/visibilidade, envio geral ou por projeto.
- Banco: naming com nota ponderada e registro obrigatório da pesquisa de disponibilidade; aprovação de posts sincronizada com o status; publicação só com link do post; galeria de seleção no portal.

## Fase 5 — Inteligência

**Assistentes ✅ (código pronto; ligar com a chave)** — `/assistentes`: **Andrade** (tarefas: o que fazer hoje, atrasadas, priorizar, criar e atualizar tarefas) e **Gomes** (plataforma: onde fica cada coisa, clientes, projetos, propostas, pendências dos clientes, agenda e financeiro para quem tem acesso; só consulta). Edge Function `assistant` com o modelo `claude-opus-5-5`, ferramentas executadas com o JWT do usuário (mesmas regras de RLS), conversas privadas por pessoa, ações registradas na mensagem. Para ligar: Supabase → Edge Functions → Secrets → `LLM_API_KEY` com uma chave da Anthropic.

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
