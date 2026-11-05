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
   npx supabase functions deploy portal --no-verify-jwt
   ```
   `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` já são injetadas pelo Supabase.
8. Rotina diária de vencidos: em **Database → Cron**, agende `select public.mark_overdue(); select public.expire_proposals();` às 03:00.
9. Backups: plano Pro tem backup diário e PITR; no gratuito, agende `supabase db dump` num CI.

## 2. Frontend

```bash
cp .env.example .env      # preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY
npm install
npm run dev               # http://localhost:5173
```

Produção (Vercel ou Cloudflare Pages): comando `npm run build`, pasta `dist`, variáveis `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`. Configure *rewrite* de todas as rotas para `/index.html` (SPA).

## 3. Primeiro administrador

```bash
SUPABASE_URL=https://SEU_REF.supabase.co SUPABASE_SERVICE_ROLE_KEY=... APP_URL=https://SEU-APP \
  node scripts/bootstrap-admin.mjs voce@estudio.com.br
```

Abra o e-mail, crie a senha e configure o estúdio no primeiro acesso. A partir daí, convide a equipe em **Equipe → Convidar pessoa**. O script se recusa a rodar se já existir um estúdio.

## 4. Testes

```bash
npm test                  # regras do frontend (Vitest)
npm run typecheck
PGHOST=/caminho/do/socket PGPORT=5432 npm run test:db   # RLS e fluxos, num Postgres 15+ descartável
```

`test:db` apaga e recria o banco `nexo_test`; nunca aponte para o banco de produção.
