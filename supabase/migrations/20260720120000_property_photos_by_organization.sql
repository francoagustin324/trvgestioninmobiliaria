-- PropControl · Fotos de propiedades aisladas por inmobiliaria
--
-- Reemplaza el aislamiento por usuario (auth.uid()) por aislamiento por
-- organización: la carpeta raíz de cada foto pasa a ser el organization_id.
-- Con esto los miembros de una misma inmobiliaria pueden gestionar las fotos
-- que subió cualquier compañero, y ninguna otra inmobiliaria puede tocarlas.
--
-- El bucket sigue siendo público en este paso. Pasarlo a privado con enlaces
-- firmados es un paso posterior y separado.
--
-- Aplicar una sola vez en el SQL Editor de Supabase (o con la CLI). No borra
-- datos: solo reemplaza políticas y agrega una función auxiliar.

-- Función auxiliar: valida que la carpeta raíz sea el organization_id de una
-- inmobiliaria de la que el usuario actual es miembro ACTIVO. Devuelve false
-- ante cualquier valor que no sea un UUID válido, evitando errores de casteo
-- dentro de la política (el CASE garantiza que folder::uuid solo se evalúe
-- cuando el texto tiene forma de UUID).
create or replace function private.can_access_property_photo(folder text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select case
    when folder ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then private.is_active_org_member(folder::uuid, auth.uid())
    else false
  end
$function$;

revoke all on function private.can_access_property_photo(text) from public;
grant execute on function private.can_access_property_photo(text) to authenticated, service_role;

-- Reemplazo de políticas: de carpeta por usuario a carpeta por inmobiliaria.
drop policy if exists "property_photos_select_by_user" on storage.objects;
drop policy if exists "property_photos_insert_by_user" on storage.objects;
drop policy if exists "property_photos_update_by_user" on storage.objects;
drop policy if exists "property_photos_delete_by_user" on storage.objects;
drop policy if exists "property_photos_select_by_org" on storage.objects;
drop policy if exists "property_photos_insert_by_org" on storage.objects;
drop policy if exists "property_photos_update_by_org" on storage.objects;
drop policy if exists "property_photos_delete_by_org" on storage.objects;

create policy "property_photos_select_by_org"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'property-photos'
  and private.can_access_property_photo((storage.foldername(name))[1])
);

create policy "property_photos_insert_by_org"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'property-photos'
  and private.can_access_property_photo((storage.foldername(name))[1])
);

create policy "property_photos_update_by_org"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'property-photos'
  and private.can_access_property_photo((storage.foldername(name))[1])
)
with check (
  bucket_id = 'property-photos'
  and private.can_access_property_photo((storage.foldername(name))[1])
);

create policy "property_photos_delete_by_org"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'property-photos'
  and private.can_access_property_photo((storage.foldername(name))[1])
);
