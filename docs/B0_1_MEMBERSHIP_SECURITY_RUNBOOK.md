# PR B0.1 · Seguridad de membresías invited

## Estado y alcance

Este documento acompaña la migración `20260724190000_harden_invited_membership_activation.sql`.

- El PR no ejecuta SQL automáticamente.
- El workflow `TRV CI` solo compila TypeScript y ejecuta pruebas.
- Fusionar el PR no modifica Supabase.
- La migración debe copiarse sin edición y ejecutarse manualmente una sola vez.
- No se deben copiar nombres, emails, teléfonos ni identificadores personales en el informe de ejecución.

## Pre-ejecución

1. Confirmar que `main` corresponde al commit aprobado para la ejecución.
2. Confirmar que esta migración todavía no se ejecutó en Supabase.
3. Confirmar las firmas actuales de las tres funciones mediante metadatos:

```sql
select
  n.nspname as function_schema,
  p.proname as function_name,
  pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_arguments,
  pg_catalog.pg_get_function_result(p.oid) as return_type,
  p.prosecdef as security_definer,
  p.proconfig as function_configuration
from pg_catalog.pg_proc as p
join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'activate_my_organization_memberships',
    'is_org_member',
    'can_manage_public_property_ficha'
  )
order by p.proname, identity_arguments;
```

Resultado esperado:

- `activate_my_organization_memberships()` retorna `void`.
- `is_org_member(target_org uuid)` retorna `boolean`.
- `can_manage_public_property_ficha(target_organization text)` retorna `boolean`.

4. Obtener únicamente conteos agregados por estado:

```sql
select
  pg_catalog.lower(coalesce(status, '')) as normalized_status,
  pg_catalog.count(*) as membership_count
from public.organization_members
group by pg_catalog.lower(coalesce(status, ''))
order by normalized_status;
```

5. Obtener únicamente el total agregado de usuarios con más de una invitación pendiente:

```sql
select pg_catalog.count(*) as users_with_multiple_invited_memberships
from (
  select member.user_id
  from public.organization_members as member
  where pg_catalog.lower(coalesce(member.status, '')) = 'invited'
  group by member.user_id
  having pg_catalog.count(*) > 1
) as ambiguous_users;
```

6. No ejecutar la migración si:

- falta alguna función;
- cambió alguna firma;
- `private.is_active_org_member(uuid, uuid)` no existe;
- existe un resultado inesperado en el preflight;
- el SQL del PR fue editado manualmente.

## Ejecución

1. Abrir Supabase SQL Editor.
2. Copiar exactamente el contenido fusionado de:
   `supabase/migrations/20260724190000_harden_invited_membership_activation.sql`.
3. Pegarlo completo en una consulta nueva.
4. No modificar ninguna línea.
5. Ejecutarlo una sola vez.
6. Conservar el resultado técnico sin incluir datos personales.

## Post-ejecución

Validar en un entorno controlado:

- `anon` no puede ejecutar `activate_my_organization_memberships()`.
- `authenticated` sí puede ejecutarlo.
- Usuario sin membresías `invited`: retorna normalmente y no cambia filas.
- Usuario con una sola `invited`: activa únicamente esa membresía.
- Usuario con dos `invited`: recibe error de ambigüedad y no cambia filas.
- Membresías `active` permanecen `active`.
- Membresías `suspended` permanecen `suspended`.
- Un usuario `invited` no accede a `organizations` mediante las políticas legacy.
- Un usuario `invited` no accede a `fichas` mediante las políticas legacy.
- Un usuario `invited` no administra `public_property_fichas`.
- Un usuario `active` conserva el acceso esperado.
- Un `PATCH` REST directo sobre `organization_members` continúa denegado por RLS.

Volver a ejecutar únicamente los conteos agregados del preflight para registrar el resultado. No listar filas ni IDs.

## Rollback

No ejecutar rollback durante la publicación normal.

Si aparece una regresión confirmada, el rollback debe realizarse mediante una nueva migración correctiva. No editar ni borrar la migración ya aplicada.

### Definición previa de `activate_my_organization_memberships()`

```sql
create or replace function public.activate_my_organization_memberships()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.organization_members
  set status = 'active', last_active_at = now()
  where user_id = auth.uid()
    and lower(coalesce(status, 'active')) <> 'suspended';
end;
$$;

revoke all on function public.activate_my_organization_memberships() from public;
grant execute on function public.activate_my_organization_memberships() to anon, authenticated, service_role;
```

### Definición previa de `is_org_member(uuid)`

```sql
create or replace function public.is_org_member(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1
    from public.organization_members
    where organization_id = target_org
      and user_id = auth.uid()
      and lower(coalesce(status, 'active')) <> 'suspended'
  );
$function$;

revoke all on function public.is_org_member(uuid) from public;
grant execute on function public.is_org_member(uuid) to public, anon, authenticated, service_role;
```

### Definición previa de `can_manage_public_property_ficha(text)`

```sql
create or replace function public.can_manage_public_property_ficha(target_organization text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1
    from public.organization_members as member
    where member.user_id = auth.uid()
      and member.organization_id::text = target_organization
      and lower(coalesce(member.status, 'active')) <> 'suspended'
  );
$function$;

revoke all on function public.can_manage_public_property_ficha(text) from public;
grant execute on function public.can_manage_public_property_ficha(text) to anon, authenticated, service_role;
```

## Alcance excluido

Este procedimiento no modifica:

- `handle_new_propcontrol_user` ni el trigger de `auth.users`;
- el frontend de invitaciones;
- el servidor de Equipo;
- selección de organización activa ni usos de `limit=1`;
- `user_profiles`, `organization_settings` o `profile-avatars`;
- Storage, `property-photos`, Railway o datos existentes;
- tablas, políticas o columnas de fichas públicas.
