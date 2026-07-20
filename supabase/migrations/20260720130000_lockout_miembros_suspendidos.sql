-- PropControl · Cerrar el acceso de miembros suspendidos
--
-- Dos funciones de seguridad chequeaban solo "¿es miembro de la organización?"
-- sin mirar si el miembro está SUSPENDIDO:
--   - public.is_org_member(uuid)                → usa clients, properties, reminders,
--                                                 fichas, organizations, organization_members
--   - public.can_manage_public_property_ficha(text) → usa public_property_fichas
-- Resultado: un corredor suspendido conservaba acceso a esas tablas. La tabla
-- principal que usa la app (propcontrol_records) ya excluía suspendidos vía
-- private.is_active_org_member; esto alinea las dos funciones que faltaban.
--
-- Cambio mínimo y quirúrgico: se agrega SOLO la condición de "no suspendido".
-- Los miembros activos, invitados o sin estado (NULL) NO cambian su acceso.
-- No borra datos ni toca políticas ni tablas. Idempotente (create or replace).
--
-- Aplicar una sola vez en el SQL Editor de Supabase (o con la CLI).

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
