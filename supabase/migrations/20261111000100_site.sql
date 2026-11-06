-- =============================================================================
-- ANDRA&GO OS — 0019 Site institucional
-- O conteúdo editável do site público (portfólio, políticas, redes, contato)
-- fica em site_settings. A leitura é pública de propósito: o site lê direto com
-- a anon key, então aqui só entra o que já é publicado na internet.
-- A escrita exige settings.manage. Imagens ficam no bucket público site-public.
-- =============================================================================
create table public.site_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  content         jsonb not null default '{}'::jsonb check (jsonb_typeof(content) = 'object'),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger trg_site_settings_updated before update on public.site_settings
  for each row execute function public.set_updated_at();

alter table public.site_settings enable row level security;
create policy site_public_read on public.site_settings for select to anon, authenticated using (true);
create policy site_insert on public.site_settings for insert to authenticated
  with check (public.has_perm(organization_id, 'settings.manage'));
create policy site_update on public.site_settings for update to authenticated
  using (public.has_perm(organization_id, 'settings.manage'))
  with check (public.has_perm(organization_id, 'settings.manage'));
create policy site_delete on public.site_settings for delete to authenticated
  using (public.has_perm(organization_id, 'settings.manage'));

grant select on public.site_settings to anon;
grant select, insert, update, delete on public.site_settings to authenticated;

insert into storage.buckets (id, name, public, file_size_limit)
values ('site-public', 'site-public', true, 10485760)
on conflict (id) do nothing;

-- O bucket é público para quem tem a URL. Esta política serve à gestão dos arquivos:
-- sem ela o Postgres não enxerga a linha e o delete não afeta nada.
create policy "site-public manage read" on storage.objects for select to authenticated using (
  bucket_id = 'site-public' and public.has_perm(((storage.foldername(name))[1])::uuid, 'settings.manage'));
create policy "site-public upload" on storage.objects for insert to authenticated with check (
  bucket_id = 'site-public' and public.has_perm(((storage.foldername(name))[1])::uuid, 'settings.manage'));
create policy "site-public delete" on storage.objects for delete to authenticated using (
  bucket_id = 'site-public' and public.has_perm(((storage.foldername(name))[1])::uuid, 'settings.manage'));
