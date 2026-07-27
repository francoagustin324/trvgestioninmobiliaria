-- PropControl · B0.3 · Alta autónoma e invitaciones sin organizaciones duplicadas
--
-- Corrección mínima:
--   1. Conserva public.handle_new_propcontrol_user() para el registro autónomo.
--   2. Impide que el handler se ejecute para usuarios creados por una invitación de Supabase Auth.
--   3. Usa auth.users.invited_at, controlado por Auth, y no metadata editable por el usuario.
--   4. No modifica filas, RLS, Storage ni membresías existentes al aplicarse.

begin;

do $preflight$
declare
  handler_oid oid;
  handler_definition text;
  normalized_definition text;
  users_relation_oid oid;
begin
  select function_info.oid,
         pg_catalog.pg_get_functiondef(function_info.oid)
  into handler_oid, handler_definition
  from pg_catalog.pg_proc as function_info
  join pg_catalog.pg_namespace as namespace
    on namespace.oid = function_info.pronamespace
  where namespace.nspname = 'public'
    and function_info.proname = 'handle_new_propcontrol_user'
    and function_info.pronargs = 0
    and function_info.prorettype = 'pg_catalog.trigger'::pg_catalog.regtype;

  if handler_oid is null then
    raise exception 'B0.3 abortado: falta public.handle_new_propcontrol_user() RETURNS trigger.';
  end if;

  select relation.oid
  into users_relation_oid
  from pg_catalog.pg_class as relation
  join pg_catalog.pg_namespace as namespace
    on namespace.oid = relation.relnamespace
  where namespace.nspname = 'auth'
    and relation.relname = 'users'
    and relation.relkind in ('r', 'p');

  if users_relation_oid is null then
    raise exception 'B0.3 abortado: falta auth.users.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid = users_relation_oid
      and attribute.attname = 'invited_at'
      and attribute.attnum > 0
      and not attribute.attisdropped
  ) then
    raise exception 'B0.3 abortado: auth.users no expone invited_at.';
  end if;

  normalized_definition := pg_catalog.replace(pg_catalog.lower(handler_definition), '"', '');

  if pg_catalog.strpos(normalized_definition, 'public.organizations') = 0
     or pg_catalog.strpos(normalized_definition, 'public.organization_members') = 0 then
    raise exception 'B0.3 abortado: el handler no califica completamente organizations y organization_members.';
  end if;
end;
$preflight$;

-- Se conservan el cuerpo y la semántica actual del alta autónoma.
-- Solo se fijan las propiedades de ejecución exigidas para un trigger sobre auth.users.
alter function public.handle_new_propcontrol_user() security definer;
alter function public.handle_new_propcontrol_user() set search_path = '';

drop trigger if exists on_propcontrol_user_created on auth.users;
create trigger on_propcontrol_user_created
after insert on auth.users
for each row
when (new.invited_at is null)
execute function public.handle_new_propcontrol_user();

commit;
