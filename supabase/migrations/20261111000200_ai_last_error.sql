-- Diagnóstico dos assistentes: último erro do provedor de IA por conversa
-- (texto do provedor, sem chaves). Gravado só pela Edge Function.
alter table public.ai_conversations add column last_error text;
