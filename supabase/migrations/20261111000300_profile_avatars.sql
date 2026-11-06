-- =============================================================================
-- ANDRA&GO OS — 0021 Perfil: foto (envio próprio) ou avatar pronto
-- avatar_path aceita só:
--   • "preset:<nome>"        avatares prontos (rostos do Andrade e do Gomes, logo…)
--   • "<user_id>/<arquivo>"  foto enviada pela própria pessoa no bucket `avatars`
-- O bucket é público para leitura (a URL tem um id aleatório); só a dona da
-- pasta envia, troca ou apaga, e apenas imagens de até 2 MB.
-- =============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "avatars own read" on storage.objects for select to authenticated using (
  bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars own upload" on storage.objects for insert to authenticated with check (
  bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars own update" on storage.objects for update to authenticated using (
  bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars own delete" on storage.objects for delete to authenticated using (
  bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

alter table public.profiles
  add constraint profiles_avatar_path_check check (
    avatar_path is null
    or avatar_path ~ '^preset:(andrade|gomes|logo|amp-ink|amp-blue|amp-paper|stacked)$'
    or (avatar_path like id::text || '/%' and avatar_path !~ '\.\.' and length(avatar_path) <= 200)),
  add constraint profiles_full_name_len check (length(full_name) <= 120),
  add constraint profiles_phone_len check (phone is null or length(phone) <= 30);
