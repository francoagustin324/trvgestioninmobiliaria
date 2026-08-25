begin;

do $$
declare
  constraint_exists boolean;
begin
  if to_regclass('public.propcontrol_records') is null then
    raise exception 'propcontrol_records table is required';
  end if;

  select exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'propcontrol_records'
      and c.conname = 'propcontrol_records_entity_type_check'
      and c.contype = 'c'
  ) into constraint_exists;

  if not constraint_exists then
    raise exception 'expected check constraint propcontrol_records_entity_type_check was not found';
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
    'reservation'::text
  ]));

commit;
