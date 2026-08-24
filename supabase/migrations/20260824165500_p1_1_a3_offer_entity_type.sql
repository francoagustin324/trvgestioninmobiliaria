-- PropControl · P1.1-A3 · Offer top-level
-- Cambio exclusivo: ampliar el CHECK de propcontrol_records.entity_type para admitir 'offer'.
-- No modifica datos, RLS, policies, grants, columnas, PK, índices, funciones, membresías ni aislamiento por organización.

begin;

do $preflight$
begin
  if pg_catalog.to_regclass('public.propcontrol_records') is null then
    raise exception 'P1.1-A3 abortado: falta public.propcontrol_records.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_row
    where constraint_row.conrelid = pg_catalog.to_regclass('public.propcontrol_records')
      and constraint_row.conname = 'propcontrol_records_entity_type_check'
      and constraint_row.contype = 'c'
  ) then
    raise exception 'P1.1-A3 abortado: falta el constraint esperado propcontrol_records_entity_type_check.';
  end if;
end;
$preflight$;

alter table public.propcontrol_records
  drop constraint propcontrol_records_entity_type_check;

alter table public.propcontrol_records
  add constraint propcontrol_records_entity_type_check
  check (entity_type in (
    'organization',
    'client',
    'property',
    'commercial_contact',
    'reminder',
    'ficha',
    'conversation',
    'activity',
    'visit',
    'offer'
  ));

commit;
