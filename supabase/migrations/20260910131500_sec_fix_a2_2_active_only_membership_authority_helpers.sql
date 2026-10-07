-- SEC-FIX A2.2 — autoridad de membership exclusivamente active.
-- Forward-only. No modifica datos, policies ni grants; endurece los helpers consumidos por RLS.

begin;

do $preflight$
declare
  members_oid oid;
  role_proc_oid oid;
  number_proc_oid oid;
  normalized_role_proc_oid oid;
  auth_uid_proc_oid oid;
  actual_return_type oid;
  actual_default_count integer;
begin
  select relation.oid
  into members_oid
  from pg_catalog.pg_class as relation
  join pg_catalog.pg_namespace as namespace
    on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public'
    and relation.relname = 'organization_members'
    and relation.relkind in ('r', 'p');

  if members_oid is null then
    raise exception 'SEC-FIX A2.2 abortado: falta public.organization_members.';
  end if;

  if exists (
    select 1
    from (
      values
        ('organization_id'::text, 'pg_catalog.uuid'::pg_catalog.regtype),
        ('user_id'::text, 'pg_catalog.uuid'::pg_catalog.regtype),
        ('role'::text, 'pg_catalog.text'::pg_catalog.regtype),
        ('member_id'::text, 'pg_catalog.int8'::pg_catalog.regtype),
        ('status'::text, 'pg_catalog.text'::pg_catalog.regtype)
    ) as expected(column_name, type_oid)
    where not exists (
      select 1
      from pg_catalog.pg_attribute as attribute
      where attribute.attrelid = members_oid
        and attribute.attname = expected.column_name
        and attribute.atttypid = expected.type_oid
        and attribute.attnum > 0
        and not attribute.attisdropped
    )
  ) then
    raise exception 'SEC-FIX A2.2 abortado: public.organization_members no tiene las columnas/tipos esperados.';
  end if;

  role_proc_oid := pg_catalog.to_regprocedure('private.org_member_role(uuid,uuid)');
  if role_proc_oid is null then
    raise exception 'SEC-FIX A2.2 abortado: falta private.org_member_role(uuid,uuid).';
  end if;

  select procedure_info.prorettype, procedure_info.pronargdefaults
  into actual_return_type, actual_default_count
  from pg_catalog.pg_proc as procedure_info
  where procedure_info.oid = role_proc_oid;

  if actual_return_type <> 'pg_catalog.text'::pg_catalog.regtype
     or actual_default_count <> 1 then
    raise exception 'SEC-FIX A2.2 abortado: firma incompatible de private.org_member_role(uuid,uuid).';
  end if;

  number_proc_oid := pg_catalog.to_regprocedure('private.org_member_number(uuid,uuid)');
  if number_proc_oid is null then
    raise exception 'SEC-FIX A2.2 abortado: falta private.org_member_number(uuid,uuid).';
  end if;

  select procedure_info.prorettype, procedure_info.pronargdefaults
  into actual_return_type, actual_default_count
  from pg_catalog.pg_proc as procedure_info
  where procedure_info.oid = number_proc_oid;

  if actual_return_type <> 'pg_catalog.int8'::pg_catalog.regtype
     or actual_default_count <> 1 then
    raise exception 'SEC-FIX A2.2 abortado: firma incompatible de private.org_member_number(uuid,uuid).';
  end if;

  normalized_role_proc_oid := pg_catalog.to_regprocedure('private.normalized_org_role(text)');
  if normalized_role_proc_oid is null then
    raise exception 'SEC-FIX A2.2 abortado: falta private.normalized_org_role(text).';
  end if;

  auth_uid_proc_oid := pg_catalog.to_regprocedure('auth.uid()');
  if auth_uid_proc_oid is null then
    raise exception 'SEC-FIX A2.2 abortado: falta auth.uid().';
  end if;
end;
$preflight$;

create or replace function private.org_member_role(target_org uuid, target_user uuid default auth.uid())
returns text
language sql
stable
security definer
set search_path to ''
as $function$
  select private.normalized_org_role(member.role)
  from public.organization_members as member
  where member.organization_id = target_org
    and member.user_id = target_user
    and member.status = 'active'
  limit 1;
$function$;

create or replace function private.org_member_number(target_org uuid, target_user uuid default auth.uid())
returns bigint
language sql
stable
security definer
set search_path to ''
as $function$
  select member.member_id
  from public.organization_members as member
  where member.organization_id = target_org
    and member.user_id = target_user
    and member.status = 'active'
  limit 1;
$function$;

commit;
