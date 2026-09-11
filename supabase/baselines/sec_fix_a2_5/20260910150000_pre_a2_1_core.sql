-- SEC-FIX A2.5 — Reproducible PostgreSQL/Supabase baseline
-- Core state immediately before the reusable historical/transactional forward chain.
--
-- IMPORTANT:
-- - This is a bootstrap baseline, not a production migration ledger reconstruction.
-- - auth.users and auth.uid() are SUPABASE-MANAGED DEPENDENCIES. A plain PostgreSQL
--   validation environment must install the fixture documented/tested by A2.5 first.
-- - Supabase Storage internals are intentionally not recreated here.
-- - organization_members has no status CHECK here: A2.1 owns the canonical CHECK.
-- - The redundant production UNIQUE (organization_id, user_id) is intentionally not
--   recreated because the primary key already enforces the same key.

begin;

create schema if not exists private;
grant usage on schema private to authenticated, service_role;

create table public.organizations (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default pg_catalog.now(),
  seat_limit integer,
  plan_label text not null default 'Piloto'
);

create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner',
  created_at timestamptz not null default pg_catalog.now(),
  member_id bigint not null,
  display_name text,
  email text,
  phone text,
  status text not null default 'active',
  last_active_at timestamptz,
  primary key (organization_id, user_id),
  constraint organization_members_role_check check (role in ('owner', 'admin', 'agent'))
);

create sequence public.organization_members_member_id_seq
  owned by public.organization_members.member_id;

alter table public.organization_members
  alter column member_id set default pg_catalog.nextval('public.organization_members_member_id_seq'::pg_catalog.regclass);

create unique index organization_members_org_member_id_uq
  on public.organization_members (organization_id, member_id);
create index organization_members_org_email_idx
  on public.organization_members (organization_id, pg_catalog.lower(email))
  where email is not null and email <> '';
create index organization_members_user_org_idx
  on public.organization_members (user_id, organization_id);

create table public.fichas (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null,
  public_data jsonb not null default '{}'::jsonb,
  internal_data jsonb not null default '{}'::jsonb,
  source text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now()
);

create index fichas_organization_id_idx on public.fichas (organization_id);

create or replace function private.normalized_org_role(value text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $function$
  select case
    when pg_catalog.lower(coalesce(value, '')) in ('owner', 'dueño', 'dueno') then 'owner'
    when pg_catalog.lower(coalesce(value, '')) in ('admin', 'administrator', 'administrador') then 'admin'
    else 'agent'
  end
$function$;

-- Historical pre-A2.2 semantics: invited was still considered authority here.
-- A2.2 replaces this function with active-only semantics.
create or replace function private.org_member_role(
  target_org uuid,
  target_user uuid default auth.uid()
)
returns text
language sql
stable
security definer
set search_path = ''
as $function$
  select private.normalized_org_role(member.role)
  from public.organization_members as member
  where member.organization_id = target_org
    and member.user_id = target_user
    and pg_catalog.lower(coalesce(member.status, 'active')) <> 'suspended'
  limit 1
$function$;

-- Historical pre-A2.2 semantics. A2.2 hardens this to status = active.
create or replace function private.org_member_number(
  target_org uuid,
  target_user uuid default auth.uid()
)
returns bigint
language sql
stable
security definer
set search_path = ''
as $function$
  select member.member_id
  from public.organization_members as member
  where member.organization_id = target_org
    and member.user_id = target_user
    and pg_catalog.lower(coalesce(member.status, 'active')) <> 'suspended'
  limit 1
$function$;

create or replace function private.is_active_org_member(
  target_org uuid,
  target_user uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.organization_members as member
    where member.organization_id = target_org
      and member.user_id = target_user
      and pg_catalog.lower(coalesce(member.status, '')) = 'active'
  )
$function$;

revoke all on function private.normalized_org_role(text) from public;
revoke all on function private.org_member_role(uuid, uuid) from public;
revoke all on function private.org_member_number(uuid, uuid) from public;
revoke all on function private.is_active_org_member(uuid, uuid) from public;
grant execute on function private.normalized_org_role(text) to authenticated, service_role;
grant execute on function private.org_member_role(uuid, uuid) to authenticated, service_role;
grant execute on function private.org_member_number(uuid, uuid) to authenticated, service_role;
grant execute on function private.is_active_org_member(uuid, uuid) to authenticated, service_role;

create or replace function public.is_org_member(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select private.is_active_org_member(target_org, auth.uid());
$function$;

revoke all on function public.is_org_member(uuid) from public;
grant execute on function public.is_org_member(uuid) to authenticated, service_role;

-- Storage authorization helper is real application-owned logic. storage.objects,
-- storage.foldername() and its policies remain SUPABASE-MANAGED and are not created.
create or replace function private.can_access_property_photo(folder text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select case
    when folder ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then private.is_active_org_member(folder::uuid, auth.uid())
    else false
  end
$function$;

revoke all on function private.can_access_property_photo(text) from public;
grant execute on function private.can_access_property_photo(text) to authenticated, service_role;

create table public.propcontrol_records (
  organization_id uuid not null,
  entity_type text not null check (entity_type in (
    'organization', 'client', 'property', 'commercial_contact',
    'reminder', 'ficha', 'conversation', 'activity'
  )),
  entity_key text not null,
  assigned_member_id bigint,
  payload jsonb not null default '{}'::jsonb,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  primary key (organization_id, entity_type, entity_key)
);

create index propcontrol_records_org_assignee_idx
  on public.propcontrol_records (organization_id, assigned_member_id);
create index propcontrol_records_org_type_idx
  on public.propcontrol_records (organization_id, entity_type);

create or replace function public.protect_propcontrol_record_identity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  new.organization_id := old.organization_id;
  new.entity_type := old.entity_type;
  new.entity_key := old.entity_key;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.updated_at := pg_catalog.now();
  return new;
end;
$function$;

create trigger protect_propcontrol_record_identity
before update on public.propcontrol_records
for each row execute function public.protect_propcontrol_record_identity();

-- Reproducible onboarding function required by B0.3. The trigger itself is created
-- by 20260727030000_guard_invited_user_onboarding.sql, preserving its exact contract.
create or replace function public.handle_new_propcontrol_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  new_organization_id uuid;
  organization_name text;
  member_name text;
begin
  if new.invited_at is not null then
    return new;
  end if;

  -- Defensive idempotency: an already-associated user never receives an implicit
  -- second organization. Explicit multi-org membership is handled separately.
  if exists (
    select 1
    from public.organization_members as member
    where member.user_id = new.id
  ) then
    return new;
  end if;

  organization_name := coalesce(
    nullif(pg_catalog.btrim(new.raw_user_meta_data ->> 'organization_name'), ''),
    nullif(pg_catalog.btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(pg_catalog.split_part(coalesce(new.email, ''), '@', 1), ''),
    'Mi inmobiliaria'
  );

  member_name := coalesce(
    nullif(pg_catalog.btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(pg_catalog.split_part(coalesce(new.email, ''), '@', 1), ''),
    'Usuario'
  );

  insert into public.organizations (name)
  values (organization_name)
  returning id into new_organization_id;

  insert into public.organization_members (
    organization_id,
    user_id,
    role,
    display_name,
    email,
    status,
    last_active_at
  ) values (
    new_organization_id,
    new.id,
    'owner',
    member_name,
    new.email,
    'active',
    pg_catalog.now()
  );

  return new;
end;
$function$;

revoke all on function public.handle_new_propcontrol_user() from public;
revoke all on function public.handle_new_propcontrol_user() from anon;
revoke all on function public.handle_new_propcontrol_user() from authenticated;
grant execute on function public.handle_new_propcontrol_user() to service_role;

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.fichas enable row level security;
alter table public.propcontrol_records enable row level security;

grant select on public.organizations to authenticated;
grant select, insert, update, delete on public.organization_members to authenticated;
grant select, insert, update, delete on public.fichas to authenticated;
grant select, insert, update, delete on public.propcontrol_records to authenticated;

create policy organizations_member_select
on public.organizations
for select
to authenticated
using (public.is_org_member(id));

create policy organization_members_directory_select
on public.organization_members
for select
to authenticated
using (
  user_id = auth.uid()
  or private.is_active_org_member(organization_id)
);

create policy organization_members_org_scope_restrictive
on public.organization_members
as restrictive
for select
to authenticated
using (
  user_id = auth.uid()
  or private.is_active_org_member(organization_id)
);

create policy organization_members_owner_admin_insert
on public.organization_members
as restrictive
for insert
to authenticated
with check (private.org_member_role(organization_id) in ('owner', 'admin'));

create policy organization_members_owner_admin_update
on public.organization_members
as restrictive
for update
to authenticated
using (private.org_member_role(organization_id) in ('owner', 'admin'))
with check (private.org_member_role(organization_id) in ('owner', 'admin'));

create policy organization_members_owner_admin_delete
on public.organization_members
as restrictive
for delete
to authenticated
using (
  private.org_member_role(organization_id) in ('owner', 'admin')
  and user_id <> auth.uid()
  and pg_catalog.lower(coalesce(role, '')) not in ('owner', 'dueño', 'dueno')
);

create policy fichas_member_select
on public.fichas
for select
to authenticated
using (private.is_active_org_member(organization_id));

create policy fichas_member_insert
on public.fichas
for insert
to authenticated
with check (
  private.is_active_org_member(organization_id)
  and (created_by is null or created_by = auth.uid())
);

create policy fichas_member_update
on public.fichas
for update
to authenticated
using (private.is_active_org_member(organization_id))
with check (private.is_active_org_member(organization_id));

create policy fichas_member_delete
on public.fichas
for delete
to authenticated
using (private.is_active_org_member(organization_id));

create policy propcontrol_records_select
on public.propcontrol_records
for select
to authenticated
using (
  private.is_active_org_member(organization_id)
  and (
    private.org_member_role(organization_id) in ('owner', 'admin')
    or entity_type = 'organization'
    or assigned_member_id = private.org_member_number(organization_id)
  )
);

create policy propcontrol_records_insert
on public.propcontrol_records
for insert
to authenticated
with check (
  private.is_active_org_member(organization_id)
  and created_by = auth.uid()
  and (
    private.org_member_role(organization_id) in ('owner', 'admin')
    or assigned_member_id = private.org_member_number(organization_id)
  )
);

create policy propcontrol_records_update
on public.propcontrol_records
for update
to authenticated
using (
  private.is_active_org_member(organization_id)
  and (
    private.org_member_role(organization_id) in ('owner', 'admin')
    or assigned_member_id = private.org_member_number(organization_id)
  )
)
with check (
  private.is_active_org_member(organization_id)
  and (
    private.org_member_role(organization_id) in ('owner', 'admin')
    or assigned_member_id = private.org_member_number(organization_id)
  )
);

create policy propcontrol_records_delete
on public.propcontrol_records
for delete
to authenticated
using (
  private.is_active_org_member(organization_id)
  and (
    private.org_member_role(organization_id) in ('owner', 'admin')
    or assigned_member_id = private.org_member_number(organization_id)
  )
);

commit;
