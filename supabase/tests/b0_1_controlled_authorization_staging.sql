-- PropControl · B0.1 · Pruebas controladas de autorización en staging
--
-- USO EXCLUSIVO:
--   - Ejecutar únicamente en un proyecto Supabase de staging vacío.
--   - No ejecutar en producción.
--   - No guardar datos reales, emails reales, teléfonos reales ni tokens.
--
-- SEGURIDAD:
--   - Aborta antes de comenzar si detecta cualquiera de los objetos objetivo.
--   - Crea únicamente estructuras y datos ficticios.
--   - Ejecuta las pruebas con los roles anon y authenticated.
--   - Elimina todos los objetos permanentes creados antes de confirmar.
--   - Si ocurre un error no controlado, la transacción completa se revierte.
--   - El único objeto que queda durante la sesión es una tabla temporal de resultados.

begin;

create temporary table b0_1_test_meta (
  private_schema_was_missing boolean not null
);

insert into b0_1_test_meta(private_schema_was_missing)
values (to_regnamespace('private') is null);

do $preflight$
begin
  if to_regclass('public.organizations') is not null
    or to_regclass('public.organization_members') is not null
    or to_regclass('public.fichas') is not null
    or to_regclass('public.public_property_fichas') is not null
    or to_regprocedure('private.is_active_org_member(uuid,uuid)') is not null
    or to_regprocedure('public.activate_my_organization_memberships()') is not null
    or to_regprocedure('public.is_org_member(uuid)') is not null
    or to_regprocedure('public.can_manage_public_property_ficha(text)') is not null
  then
    raise exception
      'Prueba detenida: staging no está vacío o contiene objetos B0.1. No se modificó nada.';
  end if;
end;
$preflight$;

create temporary table b0_1_test_results (
  test_order integer primary key,
  test_name text not null,
  passed boolean not null,
  details jsonb not null default '{}'::jsonb
);

grant select, insert, update on table b0_1_test_results to anon, authenticated;

create schema if not exists private;
grant usage on schema private to authenticated, service_role;

create table public.organizations (
  id uuid primary key,
  name text not null
);

create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null,
  role text not null default 'agent',
  status text not null check (lower(status) in ('active', 'invited', 'suspended')),
  last_active_at timestamptz,
  primary key (organization_id, user_id)
);

create table public.fichas (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb
);

create table public.public_property_fichas (
  slug text primary key,
  organization_id text not null,
  payload jsonb not null default '{}'::jsonb,
  published boolean not null default true
);

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.fichas enable row level security;
alter table public.public_property_fichas enable row level security;

grant select on table public.organizations to authenticated;
grant select on table public.organization_members to authenticated;
grant select on table public.fichas to authenticated;
grant select, insert, update, delete on table public.public_property_fichas to authenticated;

create or replace function private.is_active_org_member(
  target_org uuid,
  target_user uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select exists (
    select 1
    from public.organization_members as om
    where om.organization_id = target_org
      and om.user_id = target_user
      and lower(coalesce(om.status, 'active')) = 'active'
  );
$function$;

revoke all on function private.is_active_org_member(uuid, uuid) from public;
grant execute on function private.is_active_org_member(uuid, uuid)
  to authenticated, service_role;

-- Definiciones exactas de B0.1.

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
    count(*),
    (array_agg(candidate.organization_id))[1]
  into invited_count, invited_organization_id
  from (
    select member.organization_id
    from public.organization_members as member
    where member.user_id = current_user_id
      and lower(coalesce(member.status, '')) = 'invited'
    order by member.organization_id
    limit 2
    for update
  ) as candidate;

  if invited_count = 0 then
    return;
  end if;

  if invited_count > 1 then
    raise exception
      'No se puede activar la membresía: existe más de una invitación pendiente.'
      using errcode = 'P0001';
  end if;

  update public.organization_members as member
  set status = 'active',
      last_active_at = now()
  where member.organization_id = invited_organization_id
    and member.user_id = current_user_id
    and lower(coalesce(member.status, '')) = 'invited';
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
grant execute on function public.is_org_member(uuid)
  to anon, authenticated, service_role;

create or replace function public.can_manage_public_property_ficha(
  target_organization text
)
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

  return private.is_active_org_member(
    parsed_organization_id,
    auth.uid()
  );
end;
$function$;

revoke all on function public.can_manage_public_property_ficha(text) from public;
revoke all on function public.can_manage_public_property_ficha(text) from anon;
grant execute on function public.can_manage_public_property_ficha(text)
  to authenticated;
grant execute on function public.can_manage_public_property_ficha(text)
  to service_role;

create policy organizations_select_by_active_member
on public.organizations
for select
to authenticated
using (public.is_org_member(id));

create policy organization_members_self_or_active_select
on public.organization_members
for select
to authenticated
using (
  user_id = auth.uid()
  or private.is_active_org_member(organization_id)
);

create policy fichas_select_by_active_member
on public.fichas
for select
to authenticated
using (public.is_org_member(organization_id));

create policy public_property_fichas_select_by_active_member
on public.public_property_fichas
for select
to authenticated
using (
  public.can_manage_public_property_ficha(organization_id)
);

create policy public_property_fichas_insert_by_active_member
on public.public_property_fichas
for insert
to authenticated
with check (
  public.can_manage_public_property_ficha(organization_id)
);

create policy public_property_fichas_update_by_active_member
on public.public_property_fichas
for update
to authenticated
using (
  public.can_manage_public_property_ficha(organization_id)
)
with check (
  public.can_manage_public_property_ficha(organization_id)
);

create policy public_property_fichas_delete_by_active_member
on public.public_property_fichas
for delete
to authenticated
using (
  public.can_manage_public_property_ficha(organization_id)
);

insert into public.organizations(id, name)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'ORG_A'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'ORG_B'),
  ('cccccccc-cccc-4ccc-8ccc-ccccccccccc3', 'ORG_C');

insert into public.fichas(id, organization_id, payload)
values
  (
    '10000000-0000-4000-8000-000000000001',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    '{"test":"ORG_A"}'::jsonb
  ),
  (
    '10000000-0000-4000-8000-000000000002',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    '{"test":"ORG_B"}'::jsonb
  ),
  (
    '10000000-0000-4000-8000-000000000003',
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc3',
    '{"test":"ORG_C"}'::jsonb
  );

insert into public.public_property_fichas(slug, organization_id, payload)
values
  (
    'b01-org-a',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    '{"test":"ORG_A"}'::jsonb
  ),
  (
    'b01-org-b',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    '{"test":"ORG_B"}'::jsonb
  ),
  (
    'b01-org-c',
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc3',
    '{"test":"ORG_C"}'::jsonb
  );

-- U_ZERO: active + suspended, cero invited.
insert into public.organization_members(
  organization_id,
  user_id,
  role,
  status,
  last_active_at
)
values
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    '00000000-0000-4000-8000-000000000001',
    'agent',
    'active',
    '2026-01-01T00:00:00Z'
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    '00000000-0000-4000-8000-000000000001',
    'agent',
    'suspended',
    '2026-01-02T00:00:00Z'
  );

-- U_ONE: una invited + active + suspended.
insert into public.organization_members(
  organization_id,
  user_id,
  role,
  status,
  last_active_at
)
values
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    '00000000-0000-4000-8000-000000000002',
    'agent',
    'invited',
    null
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    '00000000-0000-4000-8000-000000000002',
    'admin',
    'active',
    '2026-01-03T00:00:00Z'
  ),
  (
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc3',
    '00000000-0000-4000-8000-000000000002',
    'agent',
    'suspended',
    '2026-01-04T00:00:00Z'
  );

-- U_TWO: dos invited + active.
insert into public.organization_members(
  organization_id,
  user_id,
  role,
  status,
  last_active_at
)
values
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    '00000000-0000-4000-8000-000000000003',
    'agent',
    'invited',
    null
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    '00000000-0000-4000-8000-000000000003',
    'agent',
    'invited',
    null
  ),
  (
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc3',
    '00000000-0000-4000-8000-000000000003',
    'admin',
    'active',
    '2026-01-05T00:00:00Z'
  );

-- U_INVITED: invited solamente.
insert into public.organization_members(
  organization_id,
  user_id,
  role,
  status,
  last_active_at
)
values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  '00000000-0000-4000-8000-000000000004',
  'agent',
  'invited',
  null
);

-- U_ACTIVE: active solamente.
insert into public.organization_members(
  organization_id,
  user_id,
  role,
  status,
  last_active_at
)
values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  '00000000-0000-4000-8000-000000000005',
  'agent',
  'active',
  '2026-01-06T00:00:00Z'
);

-- 1. anon no ejecuta activate_my_organization_memberships.

select set_config('request.jwt.claim.sub', '', true);
select set_config(
  'request.jwt.claims',
  '{"role":"anon"}',
  true
);

set local role anon;

do $test_anon$
declare
  call_denied boolean := false;
  error_state text;
  execute_privilege boolean;
begin
  execute_privilege := has_function_privilege(
    current_user,
    'public.activate_my_organization_memberships()',
    'execute'
  );

  begin
    perform public.activate_my_organization_memberships();
  exception
    when others then
      call_denied := true;
      error_state := sqlstate;
  end;

  insert into pg_temp.b0_1_test_results(
    test_order,
    test_name,
    passed,
    details
  )
  values (
    1,
    'anon no ejecuta activate_my_organization_memberships',
    not execute_privilege and call_denied,
    jsonb_build_object(
      'execute_privilege', execute_privilege,
      'call_denied', call_denied,
      'sqlstate', error_state
    )
  );
end;
$test_anon$;

reset role;

-- 2, 3, 6 y 7. authenticated, cero invited, active y suspended.

select set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-8000-000000000001',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

set local role authenticated;

do $test_zero$
declare
  before_state jsonb;
  after_state jsonb;
  call_ok boolean := true;
  error_state text;
  execute_privilege boolean;
  active_ok boolean;
  suspended_ok boolean;
begin
  execute_privilege := has_function_privilege(
    current_user,
    'public.activate_my_organization_memberships()',
    'execute'
  );

  select jsonb_agg(to_jsonb(member) order by member.organization_id)
  into before_state
  from public.organization_members as member
  where member.user_id = auth.uid();

  begin
    perform public.activate_my_organization_memberships();
  exception
    when others then
      call_ok := false;
      error_state := sqlstate;
  end;

  select jsonb_agg(to_jsonb(member) order by member.organization_id)
  into after_state
  from public.organization_members as member
  where member.user_id = auth.uid();

  select exists (
    select 1
    from public.organization_members
    where user_id = auth.uid()
      and organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
      and status = 'active'
      and last_active_at = '2026-01-01T00:00:00Z'
  )
  into active_ok;

  select exists (
    select 1
    from public.organization_members
    where user_id = auth.uid()
      and organization_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'
      and status = 'suspended'
      and last_active_at = '2026-01-02T00:00:00Z'
  )
  into suspended_ok;

  insert into pg_temp.b0_1_test_results
  values
    (
      2,
      'authenticated sí ejecuta activate_my_organization_memberships',
      execute_privilege and call_ok,
      jsonb_build_object(
        'execute_privilege', execute_privilege,
        'call_ok', call_ok,
        'sqlstate', error_state
      )
    ),
    (
      3,
      'cero invited es no-op',
      call_ok and before_state = after_state,
      jsonb_build_object(
        'before_equals_after', before_state = after_state
      )
    ),
    (
      6,
      'active permanece active',
      call_ok and active_ok,
      jsonb_build_object('active_unchanged', active_ok)
    ),
    (
      7,
      'suspended permanece suspended',
      call_ok and suspended_ok,
      jsonb_build_object('suspended_unchanged', suspended_ok)
    );
end;
$test_zero$;

reset role;

-- 4. Una invited activa únicamente esa membresía.

select set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-8000-000000000002',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);

set local role authenticated;

do $test_one$
declare
  before_other jsonb;
  after_other jsonb;
  call_ok boolean := true;
  error_state text;
  target_ok boolean;
  active_count integer;
  suspended_count integer;
begin
  select jsonb_agg(to_jsonb(member) order by member.organization_id)
  into before_other
  from public.organization_members as member
  where member.user_id = auth.uid()
    and member.organization_id <> 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

  begin
    perform public.activate_my_organization_memberships();
  exception
    when others then
      call_ok := false;
      error_state := sqlstate;
  end;

  select jsonb_agg(to_jsonb(member) order by member.organization_id)
  into after_other
  from public.organization_members as member
  where member.user_id = auth.uid()
    and member.organization_id <> 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

  select exists (
    select 1
    from public.organization_members
    where user_id = auth.uid()
      and organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
      and status = 'active'
      and last_active_at is not null
  )
  into target_ok;

  select
    count(*) filter (where status = 'active'),
    count(*) filter (where status = 'suspended')
  into active_count, suspended_count
  from public.organization_members
  where user_id = auth.uid();

  insert into pg_temp.b0_1_test_results
  values (
    4,
    'una invited activa solo una',
    call_ok
      and target_ok
      and before_other = after_other
      and active_count = 2
      and suspended_count = 1,
    jsonb_build_object(
      'call_ok', call_ok,
      'sqlstate', error_state,
      'target_activated', target_ok,
      'other_memberships_unchanged', before_other = after_other,
      'active_count', active_count,
      'suspended_count', suspended_count
    )
  );
end;
$test_one$;

reset role;

-- 5. Dos invited generan error y cero cambios.

select set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-8000-000000000003',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000003","role":"authenticated"}',
  true
);

set local role authenticated;

do $test_two$
declare
  before_state jsonb;
  after_state jsonb;
  expected_error boolean := false;
  error_state text;
  error_message text;
begin
  select jsonb_agg(to_jsonb(member) order by member.organization_id)
  into before_state
  from public.organization_members as member
  where member.user_id = auth.uid();

  begin
    perform public.activate_my_organization_memberships();
  exception
    when sqlstate 'P0001' then
      expected_error := true;
      error_state := sqlstate;
      error_message := sqlerrm;
    when others then
      error_state := sqlstate;
      error_message := sqlerrm;
  end;

  select jsonb_agg(to_jsonb(member) order by member.organization_id)
  into after_state
  from public.organization_members as member
  where member.user_id = auth.uid();

  insert into pg_temp.b0_1_test_results
  values (
    5,
    'dos invited generan error y cero cambios',
    expected_error and before_state = after_state,
    jsonb_build_object(
      'expected_error', expected_error,
      'sqlstate', error_state,
      'message_mentions_multiple_invitations',
        position('más de una invitación pendiente' in coalesce(error_message, '')) > 0,
      'before_equals_after', before_state = after_state
    )
  );
end;
$test_two$;

reset role;

-- 8, 9 y 10. invited no accede a organizations, fichas ni public_property_fichas.

select set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-8000-000000000004',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}',
  true
);

set local role authenticated;

do $test_invited_access$
declare
  organizations_visible integer;
  fichas_visible integer;
  public_fichas_visible integer;
begin
  select count(*)
  into organizations_visible
  from public.organizations
  where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

  select count(*)
  into fichas_visible
  from public.fichas
  where organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

  select count(*)
  into public_fichas_visible
  from public.public_property_fichas
  where organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

  insert into pg_temp.b0_1_test_results
  values
    (
      8,
      'invited no accede a organizations',
      organizations_visible = 0,
      jsonb_build_object('visible_rows', organizations_visible)
    ),
    (
      9,
      'invited no accede a fichas',
      fichas_visible = 0,
      jsonb_build_object('visible_rows', fichas_visible)
    ),
    (
      10,
      'invited no accede a public_property_fichas',
      public_fichas_visible = 0,
      jsonb_build_object('visible_rows', public_fichas_visible)
    );
end;
$test_invited_access$;

reset role;

-- 11. active conserva acceso esperado.

select set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-8000-000000000005',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000005","role":"authenticated"}',
  true
);

set local role authenticated;

do $test_active_access$
declare
  organizations_visible integer;
  fichas_visible integer;
  public_fichas_visible integer;
begin
  select count(*)
  into organizations_visible
  from public.organizations
  where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

  select count(*)
  into fichas_visible
  from public.fichas
  where organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

  select count(*)
  into public_fichas_visible
  from public.public_property_fichas
  where organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

  insert into pg_temp.b0_1_test_results
  values (
    11,
    'active conserva acceso',
    organizations_visible = 1
      and fichas_visible = 1
      and public_fichas_visible = 1,
    jsonb_build_object(
      'organizations_visible', organizations_visible,
      'fichas_visible', fichas_visible,
      'public_property_fichas_visible', public_fichas_visible
    )
  );
end;
$test_active_access$;

reset role;

-- 12. PATCH/UPDATE directo de organization_members continúa bloqueado.

select set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-8000-000000000004',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}',
  true
);

set local role authenticated;

do $test_direct_patch$
declare
  denied boolean := false;
  affected_rows integer := 0;
  final_status text;
  error_state text;
begin
  begin
    update public.organization_members
    set status = 'active'
    where organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
      and user_id = auth.uid();

    get diagnostics affected_rows = row_count;
  exception
    when others then
      denied := true;
      error_state := sqlstate;
  end;

  select status
  into final_status
  from public.organization_members
  where organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
    and user_id = auth.uid();

  insert into pg_temp.b0_1_test_results
  values (
    12,
    'PATCH directo de organization_members continúa bloqueado',
    (denied or affected_rows = 0)
      and final_status = 'invited',
    jsonb_build_object(
      'denied', denied,
      'affected_rows', affected_rows,
      'final_status', final_status,
      'sqlstate', error_state
    )
  );
end;
$test_direct_patch$;

reset role;

-- Limpieza permanente dentro de la misma transacción.

drop policy organizations_select_by_active_member
  on public.organizations;
drop policy organization_members_self_or_active_select
  on public.organization_members;
drop policy fichas_select_by_active_member
  on public.fichas;
drop policy public_property_fichas_select_by_active_member
  on public.public_property_fichas;
drop policy public_property_fichas_insert_by_active_member
  on public.public_property_fichas;
drop policy public_property_fichas_update_by_active_member
  on public.public_property_fichas;
drop policy public_property_fichas_delete_by_active_member
  on public.public_property_fichas;

drop function public.activate_my_organization_memberships();
drop function public.is_org_member(uuid);
drop function public.can_manage_public_property_ficha(text);
drop function private.is_active_org_member(uuid, uuid);

drop table public.public_property_fichas;
drop table public.fichas;
drop table public.organization_members;
drop table public.organizations;

do $cleanup_schema$
begin
  if (
    select private_schema_was_missing
    from pg_temp.b0_1_test_meta
  ) then
    execute 'drop schema private';
  end if;
end;
$cleanup_schema$;

commit;

select jsonb_build_object(
  'check', 'B0.1 controlled authorization tests',
  'environment', 'staging',
  'persistent_changes', false,
  'cleanup_verified',
    to_regclass('public.organizations') is null
    and to_regclass('public.organization_members') is null
    and to_regclass('public.fichas') is null
    and to_regclass('public.public_property_fichas') is null
    and to_regprocedure('private.is_active_org_member(uuid,uuid)') is null
    and to_regprocedure('public.activate_my_organization_memberships()') is null
    and to_regprocedure('public.is_org_member(uuid)') is null
    and to_regprocedure('public.can_manage_public_property_ficha(text)') is null,
  'passed', bool_and(passed),
  'passed_count', count(*) filter (where passed),
  'failed_count', count(*) filter (where not passed),
  'total_tests', count(*),
  'results', jsonb_agg(
    jsonb_build_object(
      'order', test_order,
      'test', test_name,
      'passed', passed,
      'details', details
    )
    order by test_order
  )
) as b0_1_controlled_authorization_results
from pg_temp.b0_1_test_results;
