-- SEC-FIX A2.1 — contrato canónico de organization_members.status.
-- Forward-only. No normaliza filas: cualquier dato no canónico aborta antes de ALTER material.

begin;

do $preflight$
declare
  members_oid oid;
  status_attnum smallint;
  status_type oid;
  unexpected_status_constraint text;
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
    raise exception 'SEC-FIX A2.1 abortado: falta public.organization_members.';
  end if;

  select attribute.attnum, attribute.atttypid
  into status_attnum, status_type
  from pg_catalog.pg_attribute as attribute
  where attribute.attrelid = members_oid
    and attribute.attname = 'status'
    and attribute.attnum > 0
    and not attribute.attisdropped;

  if status_attnum is null then
    raise exception 'SEC-FIX A2.1 abortado: falta public.organization_members.status.';
  end if;

  if status_type <> 'pg_catalog.text'::pg_catalog.regtype then
    raise exception 'SEC-FIX A2.1 abortado: organization_members.status debe ser TEXT.';
  end if;

  if exists (
    select 1
    from public.organization_members as member
    where member.status is null
       or member.status not in ('active', 'invited', 'suspended')
  ) then
    raise exception 'SEC-FIX A2.1 abortado: existen status no canónicos; no se modificó ninguna fila.';
  end if;

  select constraint_info.conname
  into unexpected_status_constraint
  from pg_catalog.pg_constraint as constraint_info
  where constraint_info.conrelid = members_oid
    and constraint_info.contype = 'c'
    and status_attnum = any (constraint_info.conkey)
    and constraint_info.conname <> 'organization_members_status_check'
  order by constraint_info.conname
  limit 1;

  if unexpected_status_constraint is not null then
    raise exception 'SEC-FIX A2.1 abortado: CHECK inesperado sobre status: %.', unexpected_status_constraint;
  end if;
end;
$preflight$;

alter table public.organization_members
  alter column status set default 'active',
  alter column status set not null;

alter table public.organization_members
  drop constraint if exists organization_members_status_check;

alter table public.organization_members
  add constraint organization_members_status_check
  check (status in ('active', 'invited', 'suspended'));

commit;
