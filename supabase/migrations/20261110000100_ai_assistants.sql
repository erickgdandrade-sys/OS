-- =============================================================================
-- ANDRA&GO OS — 0018 Assistentes de IA: Andrade (tarefas) e Gomes (plataforma)
-- A Edge Function `assistant` usa o JWT do próprio usuário para ler e alterar
-- dados (as mesmas regras de RLS da tela). As mensagens são gravadas pela
-- função depois de validar que a conversa pertence ao usuário.
-- =============================================================================
alter table public.ai_conversations
  add column assistant text not null default 'gomes' check (assistant in ('andrade', 'gomes')),
  add column updated_at timestamptz not null default now();
create index idx_ai_conv_user on public.ai_conversations(user_id, assistant, updated_at desc);

alter table public.ai_messages add column actions jsonb not null default '[]'::jsonb check (jsonb_typeof(actions) = 'array');
create index idx_ai_msg_conv on public.ai_messages(conversation_id, created_at);
