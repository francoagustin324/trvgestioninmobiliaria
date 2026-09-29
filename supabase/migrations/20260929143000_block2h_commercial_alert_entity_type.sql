-- BLOQUE 2H — habilita alertas comerciales como registro tenant-scoped.
-- Migración aditiva. No se aplica desde este bloque a producción.

begin;

do $$
begin
  if pg_catalog.to_regclass('public.propcontrol_records') is null then
    raise exception 'BLOCK2H abortado: falta public.propcontrol_records.';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_row
    where constraint_row.conrelid = pg_catalog.to_regclass('public.propcontrol_records')
      and constraint_row.conname = 'propcontrol_records_entity_type_check'
  ) then
    raise exception 'BLOCK2H abortado: falta propcontrol_records_entity_type_check.';
  end if;
end
$$;

alter table public.propcontrol_records
  drop constraint propcontrol_records_entity_type_check;

alter table public.propcontrol_records
  add constraint propcontrol_records_entity_type_check
  check (entity_type = any (array[
    'organization'::text,
    'client'::text,
    'property'::text,
    'commercial_contact'::text,
    'reminder'::text,
    'ficha'::text,
    'conversation'::text,
    'activity'::text,
    'visit'::text,
    'offer'::text,
    'reservation'::text,
    'commercial_alert'::text
  ]));

create index if not exists propcontrol_records_org_alert_owner_idx
  on public.propcontrol_records (organization_id, assigned_member_id, updated_at desc)
  where entity_type = 'commercial_alert';

commit;
