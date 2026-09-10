-- SEC-FIX A2.3 — ACL mínimas y hardening de SECURITY DEFINER.
-- Forward-only. No modifica datos ni policies. Reconstruye ACL conocidas desde cero.
--
-- Inventario de callers demostrado en repo:
--   authenticated/Data API:
--     organization_members     SELECT
--     fichas                   SELECT, INSERT, UPDATE
--     propcontrol_records      SELECT, INSERT, UPDATE, DELETE
--     public_property_fichas   SELECT, INSERT, UPDATE
--   service_role/backend Equipo:
--     organizations            SELECT
--     organization_members     SELECT, INSERT, UPDATE
--     organization_members_member_id_seq USAGE (default member_id)
--   anon:
--     ninguna tabla; la ficha pública usa EXECUTE get_public_property_ficha(text).

begin;

do $preflight$
declare
  object_name text;
  signature text;
  procedure_oid oid;
  is_security_definer boolean;
begin
  foreach object_name in array array[
    'public.organizations',
    'public.organization_members',
    'public.fichas',
    'public.propcontrol_records',
    'public.public_property_fichas'
  ] loop
    if pg_catalog.to_regclass(object_name) is null then
      raise exception 'SEC-FIX A2.3 abortado: falta tabla requerida %.', object_name;
    end if;
  end loop;

  if pg_catalog.to_regclass('public.organization_members_member_id_seq') is null then
    raise exception 'SEC-FIX A2.3 abortado: falta public.organization_members_member_id_seq.';
  end if;

  -- Estas funciones deben existir y seguir siendo SECURITY DEFINER antes de tocar ACL.
  foreach signature in array array[
    'private.is_active_org_member(uuid,uuid)',
    'private.org_member_role(uuid,uuid)',
    'private.org_member_number(uuid,uuid)',
    'private.can_access_property_photo(text)',
    'public.is_org_member(uuid)',
    'public.activate_my_organization_memberships()',
    'public.can_manage_public_property_ficha(text)',
    'public.get_public_property_ficha(text)',
    'public.handle_new_propcontrol_user()',
    'private.next_commercial_legacy_id(uuid,text)',
    'private.commercial_visit_duplicate_exists(uuid,bigint,bigint,timestamptz)'
  ] loop
    procedure_oid := pg_catalog.to_regprocedure(signature);
    if procedure_oid is null then
      raise exception 'SEC-FIX A2.3 abortado: falta función requerida %.', signature;
    end if;
    select procedure_info.prosecdef
    into is_security_definer
    from pg_catalog.pg_proc as procedure_info
    where procedure_info.oid = procedure_oid;
    if is_security_definer is not true then
      raise exception 'SEC-FIX A2.3 abortado: % debe ser SECURITY DEFINER.', signature;
    end if;
  end loop;

  -- Dependencias SECURITY INVOKER/trigger-only cuyos EXECUTE también quedan explícitos.
  foreach signature in array array[
    'private.normalized_org_role(text)',
    'public.protect_propcontrol_record_identity()',
    'private.visit_authority_active(uuid)',
    'private.visit_normalized(text)',
    'private.visit_qualification_missing(jsonb)',
    'private.guard_transaction_owned_records()',
    'public.visit_transaction_authority_active()',
    'public.client_snapshot_cas(jsonb,boolean)',
    'public.commercial_visit_mutation(uuid,text,jsonb,boolean)'
  ] loop
    if pg_catalog.to_regprocedure(signature) is null then
      raise exception 'SEC-FIX A2.3 abortado: falta función requerida %.', signature;
    end if;
  end loop;
end;
$preflight$;

-- ---------------------------------------------------------------------------
-- TABLAS: revocar todo lo heredado y conceder sólo el caller productivo probado.
-- ---------------------------------------------------------------------------
revoke all privileges on table public.organizations
  from public, anon, authenticated, service_role;
revoke all privileges on table public.organization_members
  from public, anon, authenticated, service_role;
revoke all privileges on table public.fichas
  from public, anon, authenticated, service_role;
revoke all privileges on table public.propcontrol_records
  from public, anon, authenticated, service_role;
revoke all privileges on table public.public_property_fichas
  from public, anon, authenticated, service_role;

-- Frontend/Data API autenticada.
grant select on table public.organization_members to authenticated;
grant select, insert, update on table public.fichas to authenticated;
grant select, insert, update, delete on table public.propcontrol_records to authenticated;
grant select, insert, update on table public.public_property_fichas to authenticated;

-- Backend Equipo con secret/service role.
grant select on table public.organizations to service_role;
grant select, insert, update on table public.organization_members to service_role;

-- Default member_id usado por las inserciones del backend de Equipo.
revoke all privileges on sequence public.organization_members_member_id_seq
  from public, anon, authenticated, service_role;
grant usage on sequence public.organization_members_member_id_seq to service_role;

-- ---------------------------------------------------------------------------
-- SEARCH_PATH: todos los SECURITY DEFINER relevantes quedan con path vacío.
-- ---------------------------------------------------------------------------
alter function private.is_active_org_member(uuid, uuid) set search_path to '';
alter function private.org_member_role(uuid, uuid) set search_path to '';
alter function private.org_member_number(uuid, uuid) set search_path to '';
alter function private.can_access_property_photo(text) set search_path to '';
alter function public.is_org_member(uuid) set search_path to '';
alter function public.activate_my_organization_memberships() set search_path to '';
alter function public.can_manage_public_property_ficha(text) set search_path to '';
alter function public.get_public_property_ficha(text) set search_path to '';
alter function public.handle_new_propcontrol_user() set search_path to '';
alter function private.next_commercial_legacy_id(uuid, text) set search_path to '';
alter function private.commercial_visit_duplicate_exists(uuid, bigint, bigint, timestamptz) set search_path to '';

-- También se fija el helper invoker puro para evitar depender de search_path ambiental.
alter function private.normalized_org_role(text) set search_path to '';

-- ---------------------------------------------------------------------------
-- FUNCIONES: estado conocido y mínimo. PUBLIC/anon/service_role no heredan EXECUTE.
-- ---------------------------------------------------------------------------
revoke all privileges on function private.is_active_org_member(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all privileges on function private.org_member_role(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all privileges on function private.org_member_number(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all privileges on function private.normalized_org_role(text)
  from public, anon, authenticated, service_role;
revoke all privileges on function private.can_access_property_photo(text)
  from public, anon, authenticated, service_role;
revoke all privileges on function public.is_org_member(uuid)
  from public, anon, authenticated, service_role;
revoke all privileges on function public.activate_my_organization_memberships()
  from public, anon, authenticated, service_role;
revoke all privileges on function public.can_manage_public_property_ficha(text)
  from public, anon, authenticated, service_role;
revoke all privileges on function public.get_public_property_ficha(text)
  from public, anon, authenticated, service_role;
revoke all privileges on function public.handle_new_propcontrol_user()
  from public, anon, authenticated, service_role;
revoke all privileges on function public.protect_propcontrol_record_identity()
  from public, anon, authenticated, service_role;
revoke all privileges on function private.visit_authority_active(uuid)
  from public, anon, authenticated, service_role;
revoke all privileges on function private.visit_normalized(text)
  from public, anon, authenticated, service_role;
revoke all privileges on function private.visit_qualification_missing(jsonb)
  from public, anon, authenticated, service_role;
revoke all privileges on function private.next_commercial_legacy_id(uuid, text)
  from public, anon, authenticated, service_role;
revoke all privileges on function private.commercial_visit_duplicate_exists(uuid, bigint, bigint, timestamptz)
  from public, anon, authenticated, service_role;
revoke all privileges on function private.guard_transaction_owned_records()
  from public, anon, authenticated, service_role;
revoke all privileges on function public.visit_transaction_authority_active()
  from public, anon, authenticated, service_role;
revoke all privileges on function public.client_snapshot_cas(jsonb, boolean)
  from public, anon, authenticated, service_role;
revoke all privileges on function public.commercial_visit_mutation(uuid, text, jsonb, boolean)
  from public, anon, authenticated, service_role;

-- RLS/Data API y RPCs legítimos del usuario autenticado.
grant execute on function private.is_active_org_member(uuid, uuid) to authenticated;
grant execute on function private.org_member_role(uuid, uuid) to authenticated;
grant execute on function private.org_member_number(uuid, uuid) to authenticated;
grant execute on function private.can_access_property_photo(text) to authenticated;
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.activate_my_organization_memberships() to authenticated;
grant execute on function public.can_manage_public_property_ficha(text) to authenticated;
grant execute on function private.visit_authority_active(uuid) to authenticated;
grant execute on function private.visit_normalized(text) to authenticated;
grant execute on function private.visit_qualification_missing(jsonb) to authenticated;
grant execute on function private.next_commercial_legacy_id(uuid, text) to authenticated;
grant execute on function private.commercial_visit_duplicate_exists(uuid, bigint, bigint, timestamptz) to authenticated;
grant execute on function public.visit_transaction_authority_active() to authenticated;
grant execute on function public.client_snapshot_cas(jsonb, boolean) to authenticated;
grant execute on function public.commercial_visit_mutation(uuid, text, jsonb, boolean) to authenticated;

-- Única excepción anon demostrada: carga pública por slug vía RPC SECURITY DEFINER.
grant execute on function public.get_public_property_ficha(text) to anon;

-- V2 pertenece a A2.4 en producción: A2.3 NO lo crea ni exige. Si ya existe (repo/entorno
-- adelantado), sólo normaliza su EXECUTE al caller autenticado documentado.
do $optional_v2_acl$
declare
  signature text;
begin
  foreach signature in array array[
    'public.visit_transaction_authority_active_v2(uuid)',
    'public.client_snapshot_cas_v2(uuid,jsonb,boolean)',
    'public.commercial_visit_mutation_v2(uuid,uuid,text,jsonb,boolean)'
  ] loop
    if pg_catalog.to_regprocedure(signature) is not null then
      execute pg_catalog.format(
        'revoke all privileges on function %s from public, anon, authenticated, service_role',
        signature
      );
      execute pg_catalog.format('grant execute on function %s to authenticated', signature);
    end if;
  end loop;
end;
$optional_v2_acl$;

commit;
