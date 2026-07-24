-- PropControl · B0.1 · Seguridad de membresías invited
--
-- Cambio correctivo y compatible:
--   1. Una invitación solo se activa cuando existe exactamente una membresía invited.
--   2. Invited y suspended dejan de ser miembros válidos para las funciones legacy.
--   3. Se conservan las firmas consumidas por la aplicación y por las políticas RLS.
--
-- Esta migración no modifica filas al aplicarse. El único UPDATE queda dentro del
-- cuerpo del RPC y se ejecuta posteriormente, cuando un usuario autenticado lo invoca.

begin;

create or replace function public.activate_my_organization_memberships()
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  current_user_id uuid := auth.uid();
  invited_count bigint := 0;
  invited_organization_id uuid;
begin
  if current_user_id is null then
    raise exception 'No autorizado: se requiere una sesión autenticada.'
      using errcode = '42501';
  end if;

  select
    pg_catalog.count(*),
    (pg_catalog.array_agg(candidate.organization_id))[1]
  into invited_count, invited_organization_id
  from (
    select member.organization_id
    from public.organization_members as member
    where member.user_id = current_user_id
      and pg_catalog.lower(coalesce(member.status, '')) = 'invited'
    order by member.organization_id
    limit 2
    for update
  ) as candidate;

  if invited_count = 0 then
    return;
  end if;

  if invited_count > 1 then
    raise exception 'No se puede activar la membresía: existe más de una invitación pendiente.'
      using errcode = 'P0001';
  end if;

  update public.organization_members as member
  set status = 'active',
      last_active_at = pg_catalog.now()
  where member.organization_id = invited_organization_id
    and member.user_id = current_user_id
    and pg_catalog.lower(coalesce(member.status, '')) = 'invited';
end;
$function$;

revoke all on function public.activate_my_organization_memberships() from public;
revoke all on function public.activate_my_organization_memberships() from anon;
grant execute on function public.activate_my_organization_memberships() to authenticated;
grant execute on function public.activate_my_organization_memberships() to service_role;

create or replace function public.is_org_member(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select private.is_active_org_member(target_org, auth.uid());
$function$;

revoke all on function public.is_org_member(uuid) from public;
grant execute on function public.is_org_member(uuid) to anon, authenticated, service_role;

create or replace function public.can_manage_public_property_ficha(target_organization text)
returns boolean
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  parsed_organization_id uuid;
begin
  if target_organization is null then
    return false;
  end if;

  begin
    parsed_organization_id := target_organization::uuid;
  exception
    when invalid_text_representation then
      return false;
  end;

  return private.is_active_org_member(parsed_organization_id, auth.uid());
end;
$function$;

revoke all on function public.can_manage_public_property_ficha(text) from public;
revoke all on function public.can_manage_public_property_ficha(text) from anon;
grant execute on function public.can_manage_public_property_ficha(text) to authenticated;
grant execute on function public.can_manage_public_property_ficha(text) to service_role;

commit;
