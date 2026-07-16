-- PropControl · Fotos de propiedades
-- Aplicar con Supabase CLI o pegar una sola vez en SQL Editor.

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'property-photos',
  'property-photos',
  true,
  1800000,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "property_photos_insert_by_member" on storage.objects;
drop policy if exists "property_photos_update_by_member" on storage.objects;
drop policy if exists "property_photos_delete_by_member" on storage.objects;
drop policy if exists "property_photos_select_by_user" on storage.objects;
drop policy if exists "property_photos_insert_by_user" on storage.objects;
drop policy if exists "property_photos_update_by_user" on storage.objects;
drop policy if exists "property_photos_delete_by_user" on storage.objects;

drop function if exists public.can_manage_property_photo(text);

create policy "property_photos_select_by_user"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'property-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "property_photos_insert_by_user"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'property-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "property_photos_update_by_user"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'property-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'property-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "property_photos_delete_by_user"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'property-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);
