# Implantação

## 1. Supabase

1. Crie um projeto em https://supabase.com (região São Paulo, `sa-east-1`).
2. Instale o CLI e vincule: `npx supabase login` e `npx supabase link --project-ref SEU_REF`.
3. Aplique o banco: `npx supabase db push` (roda `supabase/migrations/` em ordem).
4. Em **Authentication → Providers → Email**: desligue *Allow new users to sign up*; senha mínima 10.
5. Em **Authentication → URL Configuration**: *Site URL* = URL do app; *Redirect URLs* = `https://SEU-APP/convite` e `https://SEU-APP/redefinir-senha`.
6. Em **Authentication → SMTP**: configure um SMTP próprio (o padrão do Supabase envia poucos e-mails por hora).
7. Edge Functions:
   ```bash
   npx supabase secrets set APP_URL=https://SEU-APP APP_ORIGINS=https://SEU-APP
   npx supabase functions deploy invite-member
   npx supabase functions deploy invite-client
   npx supabase functions deploy first-access --no-verify-jwt
   npx supabase functions deploy portal --no-verify-jwt
   npx supabase functions deploy proposal-public --no-verify-jwt
   npx supabase functions deploy document-pdf
   npx supabase functions deploy signature-send
   npx supabase functions deploy signature-webhook --no-verify-jwt
   ```
   Assinatura eletrônica (opcional): crie uma conta na ZapSign, gere o token de API e rode
   `npx supabase secrets set ZAPSIGN_API_TOKEN=… ZAPSIGN_WEBHOOK_SECRET=<texto aleatório longo>`
   (para testar, adicione `ZAPSIGN_API_URL=https://sandbox.api.zapsign.com.br/api/v1`). No painel da ZapSign,
   cadastre o webhook para `https://SEU_REF.supabase.co/functions/v1/signature-webhook` com o header
   `x-webhook-secret` igual ao segredo. Confira os nomes dos eventos na documentação atual da ZapSign:
   a função trata `doc_signed`, `doc_refused` e `signer_signed`.
   `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` já são injetadas pelo Supabase.
8. Rotina diária de vencidos: em **Database → Cron**, agende `select public.run_daily_alerts();` às 03:00 (marca vencidos, expira propostas e cria os alertas do dia).
9. Backups: plano Pro tem backup diário e PITR; no gratuito, agende `supabase db dump` num CI.

## 2. Frontend

```bash
cp .env.example .env      # preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY
npm install
npm run dev               # http://localhost:5173
```

Produção (Vercel ou Cloudflare Pages): comando `npm run build`, pasta `dist`, variáveis `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`. Configure *rewrite* de todas as rotas para `/index.html` (SPA).

## 3. Primeiro administrador

O administrador inicial é definido no banco (`platform_settings.bootstrap_admin_email`), hoje **erickgdandrade@gmail.com**. Para trocar, rode no SQL Editor:

```sql
update public.platform_settings set value = 'novo@email.com' where key = 'bootstrap_admin_email';
```

Primeiro acesso:

1. Abra o app e clique em **Criar minha senha** (tela de login).
2. Informe o e-mail do administrador. A Edge Function `first-access` envia um link de criação de senha **somente** para esse e-mail e **somente** enquanto nenhum estúdio existir. Para qualquer outro e-mail, nada acontece e a resposta é a mesma, sem revelar quais e-mails existem.
3. Abra o link, crie a senha e configure o estúdio. Você passa a ser o administrador.

Não existe cadastro público. Depois disso, novos usuários (equipe e contas de clientes) são cadastrados apenas pelo administrador, em **Equipe → Cadastrar usuário** e na aba **Portal do cliente** de cada projeto. A criação de outros estúdios na mesma instalação fica desligada (`allow_new_organizations = false`).

Alternativa sem passar pelo app: `node scripts/bootstrap-admin.mjs erickgdandrade@gmail.com` com a service role no terminal.

## 4. Testes

```bash
npm test                  # regras do frontend (Vitest)
npm run typecheck
PGHOST=/caminho/do/socket PGPORT=5432 npm run test:db   # RLS e fluxos, num Postgres 15+ descartável
```

`test:db` apaga e recria o banco `nexo_test`; nunca aponte para o banco de produção.
