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

create or replace function public.can_manage_property_photo(target_organization text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members as member
    where member.user_id = auth.uid()
      and member.organization_id::text = target_organization
  );
$$;

revoke all on function public.can_manage_property_photo(text) from public;
grant execute on function public.can_manage_property_photo(text) to authenticated;

drop policy if exists "property_photos_insert_by_member" on storage.objects;
create policy "property_photos_insert_by_member"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'property-photos'
  and public.can_manage_property_photo((storage.foldername(name))[1])
);

drop policy if exists "property_photos_update_by_member" on storage.objects;
create policy "property_photos_update_by_member"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'property-photos'
  and public.can_manage_property_photo((storage.foldername(name))[1])
)
with check (
  bucket_id = 'property-photos'
  and public.can_manage_property_photo((storage.foldername(name))[1])
);

drop policy if exists "property_photos_delete_by_member" on storage.objects;
create policy "property_photos_delete_by_member"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'property-photos'
  and public.can_manage_property_photo((storage.foldername(name))[1])
);
