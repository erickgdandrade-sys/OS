-- =============================================================================
-- ANDRA&GO OS — 0023 Assistente do site (perguntas rápidas sobre o estúdio)
-- Contador de uso por visitante (hash do IP, nunca o IP) e por hora, para o
-- assistente público não esgotar a cota gratuita da IA. Só a Edge Function
-- (service role) grava e lê.
-- =============================================================================
create table public.site_assistant_usage (
  visitor   text not null,          -- sha-256 do IP + sal
  hour      timestamptz not null,
  count     int not null default 0,
  primary key (visitor, hour)
);
alter table public.site_assistant_usage enable row level security;   -- sem políticas: invisível para anon/authenticated

create or replace function public.site_assistant_hit(p_visitor text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_hour timestamptz := date_trunc('hour', now()); v_mine int; v_day int;
begin
  insert into public.site_assistant_usage (visitor, hour, count) values (p_visitor, v_hour, 1)
  on conflict (visitor, hour) do update set count = site_assistant_usage.count + 1
  returning count into v_mine;
  select coalesce(sum(count), 0) into v_day from public.site_assistant_usage where hour > now() - interval '24 hours';
  delete from public.site_assistant_usage where hour < now() - interval '3 days';
  return jsonb_build_object('mine', v_mine, 'day', v_day);
end $$;
revoke execute on function public.site_assistant_hit(text) from public, anon, authenticated;
grant execute on function public.site_assistant_hit(text) to service_role;
