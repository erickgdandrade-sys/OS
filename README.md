# NEXO Studio OS

Plataforma de gestão para estúdios criativos: clientes, projetos, tarefas, equipe, propostas, contratos, financeiro, portal do cliente e módulos criativos (branding, naming, moodboards, social media, audiovisual). Nome e identidade visual provisórios.

**Stack:** React 19 · TypeScript · Vite · Tailwind CSS 4 · TanStack Router/Query · React Hook Form + Zod · Recharts · Supabase (Postgres + RLS, Auth, Storage, Edge Functions).

## Estado atual — Fases 1, 2 e 3

* Banco de dados completo para todas as fases, com isolamento por estúdio e permissões no próprio banco (RLS), coberto por 125 asserções.
* Autenticação real com Supabase Auth: login, recuperação e redefinição de senha, convite com criação de senha, primeiro acesso e encerramento de sessão.
* Dashboard, clientes, projetos (Kanban e lista, a partir de modelos), tarefas e subtarefas, horas, arquivos, comentários, equipe com convites, permissões configuráveis, busca global, notificações, tema claro e escuro.
* Comercial: CRM com pipeline, serviços e preços, construtor de propostas, PDF gerado no servidor com a identidade do estúdio, link público com aceite, aprovação que gera projeto, contrato e parcelas, contratos com variáveis, versões e assinatura eletrônica (ZapSign).
* Operação: financeiro (a receber, a pagar, baixas, recorrência, fornecedores, relatórios, previsão de caixa, CSV), calendário geral, distribuição de trabalho, linha do tempo com dependências e alertas diários.
* Portal do cliente por conta autenticada ou link seguro, com aprovação de materiais, propostas e contratos.

Módulos das próximas fases aparecem no menu desativados, com a fase indicada. Veja [docs/PLANO.md](docs/PLANO.md).

## Começar

```bash
cp .env.example .env    # URL e anon key do seu projeto Supabase
npm install
npm run dev
```

Passo a passo completo (banco, Edge Functions, primeiro administrador, deploy): [docs/IMPLANTACAO.md](docs/IMPLANTACAO.md).

## Documentação

* [Arquitetura, modelo de dados, fluxos, permissões e testes](docs/ARQUITETURA.md)
* [Plano por fases e dependências externas](docs/PLANO.md)
* [Implantação](docs/IMPLANTACAO.md)
* [Segurança e LGPD](docs/SEGURANCA-LGPD.md)

## Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor de desenvolvimento |
| `npm run build` | Typecheck + build de produção em `dist/` |
| `npm test` | Testes unitários (Vitest) |
| `npm run test:db` | Migrations + testes de RLS num Postgres descartável |

## Extras

`extras/fervo-landing/` guarda a landing page do estúdio Fervo criada anteriormente nesta conversa (HTML estático, independente do sistema).
