begin;

create schema if not exists private;
grant usage on schema private to authenticated, service_role;

alter table if exists public.organizations
  add column if not exists seat_limit integer,
  add column if not exists plan_label text not null default 'Piloto';

alter table if exists public.organization_members
  add column if not exists member_id bigint,
  add column if not exists display_name text,
  add column if not exists email text,
  add column if not exists phone text,
  add column if not exists status text not null default 'active',
  add column if not exists last_active_at timestamptz;

create sequence if not exists public.organization_members_member_id_seq;
alter sequence public.organization_members_member_id_seq owned by public.organization_members.member_id;
alter table public.organization_members
  alter column member_id set default nextval('public.organization_members_member_id_seq');

update public.organization_members
set member_id = nextval('public.organization_members_member_id_seq')
where member_id is null;

select setval(
  'public.organization_members_member_id_seq',
  greatest(coalesce((select max(member_id) from public.organization_members), 1), 1),
  true
);

alter table public.organization_members alter column member_id set not null;

update public.organization_members om
set email = coalesce(nullif(om.email, ''), u.email),
    display_name = coalesce(nullif(om.display_name, ''), split_part(coalesce(u.email, 'Usuario'), '@', 1)),
    status = case
      when lower(coalesce(om.status, 'active')) in ('active','invited','suspended') then lower(om.status)
      else 'active'
    end
from auth.users u
where u.id = om.user_id;

create unique index if not exists organization_members_org_member_id_uq
  on public.organization_members (organization_id, member_id);
create unique index if not exists organization_members_org_user_uq
  on public.organization_members (organization_id, user_id);
create index if not exists organization_members_org_email_idx
  on public.organization_members (organization_id, lower(email))
  where email is not null and email <> '';
create index if not exists organization_members_user_org_idx
  on public.organization_members (user_id, organization_id);

create or replace function private.normalized_org_role(value text)
returns text
language sql
immutable
as $$
  select case
    when lower(coalesce(value, '')) in ('owner','dueño','dueno') then 'owner'
    when lower(coalesce(value, '')) in ('admin','administrator','administrador') then 'admin'
    else 'agent'
  end
$$;

create or replace function private.org_member_role(target_org uuid, target_user uuid default auth.uid())
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select private.normalized_org_role(om.role)
  from public.organization_members om
  where om.organization_id = target_org
    and om.user_id = target_user
    and lower(coalesce(om.status, 'active')) <> 'suspended'
  limit 1
$$;

create or replace function private.org_member_number(target_org uuid, target_user uuid default auth.uid())
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select om.member_id
  from public.organization_members om
  where om.organization_id = target_org
    and om.user_id = target_user
    and lower(coalesce(om.status, 'active')) <> 'suspended'
  limit 1
$$;

create or replace function private.is_active_org_member(target_org uuid, target_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members om
    where om.organization_id = target_org
      and om.user_id = target_user
      and lower(coalesce(om.status, 'active')) = 'active'
  )
$$;

revoke all on function private.normalized_org_role(text) from public;
revoke all on function private.org_member_role(uuid, uuid) from public;
revoke all on function private.org_member_number(uuid, uuid) from public;
revoke all on function private.is_active_org_member(uuid, uuid) from public;
grant execute on function private.normalized_org_role(text) to authenticated, service_role;
grant execute on function private.org_member_role(uuid, uuid) to authenticated, service_role;
grant execute on function private.org_member_number(uuid, uuid) to authenticated, service_role;
grant execute on function private.is_active_org_member(uuid, uuid) to authenticated, service_role;

create table if not exists public.propcontrol_records (
  organization_id uuid not null,
  entity_type text not null check (entity_type in (
    'organization','client','property','commercial_contact','reminder','ficha','conversation','activity'
  )),
  entity_key text not null,
  assigned_member_id bigint,
  payload jsonb not null default '{}'::jsonb,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, entity_type, entity_key)
);

create index if not exists propcontrol_records_org_assignee_idx
  on public.propcontrol_records (organization_id, assigned_member_id);
create index if not exists propcontrol_records_org_type_idx
  on public.propcontrol_records (organization_id, entity_type);

create or replace function public.protect_propcontrol_record_identity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.organization_id := old.organization_id;
  new.entity_type := old.entity_type;
  new.entity_key := old.entity_key;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists protect_propcontrol_record_identity on public.propcontrol_records;
create trigger protect_propcontrol_record_identity
before update on public.propcontrol_records
for each row execute function public.protect_propcontrol_record_identity();

alter table public.propcontrol_records enable row level security;
grant select, insert, update, delete on public.propcontrol_records to authenticated;

drop policy if exists propcontrol_records_select on public.propcontrol_records;
create policy propcontrol_records_select
on public.propcontrol_records
for select
to authenticated
using (
  private.is_active_org_member(organization_id)
  and (
    private.org_member_role(organization_id) in ('owner','admin')
    or entity_type = 'organization'
    or assigned_member_id = private.org_member_number(organization_id)
  )
);

drop policy if exists propcontrol_records_insert on public.propcontrol_records;
create policy propcontrol_records_insert
on public.propcontrol_records
for insert
to authenticated
with check (
  private.is_active_org_member(organization_id)
  and created_by = auth.uid()
  and (
    private.org_member_role(organization_id) in ('owner','admin')
    or assigned_member_id = private.org_member_number(organization_id)
  )
);

drop policy if exists propcontrol_records_update on public.propcontrol_records;
create policy propcontrol_records_update
on public.propcontrol_records
for update
to authenticated
using (
  private.is_active_org_member(organization_id)
  and (
    private.org_member_role(organization_id) in ('owner','admin')
    or assigned_member_id = private.org_member_number(organization_id)
  )
)
with check (
  private.is_active_org_member(organization_id)
  and (
    private.org_member_role(organization_id) in ('owner','admin')
    or assigned_member_id = private.org_member_number(organization_id)
  )
);

drop policy if exists propcontrol_records_delete on public.propcontrol_records;
create policy propcontrol_records_delete
on public.propcontrol_records
for delete
to authenticated
using (
  private.is_active_org_member(organization_id)
  and (
    private.org_member_role(organization_id) in ('owner','admin')
    or assigned_member_id = private.org_member_number(organization_id)
  )
);

alter table public.organization_members enable row level security;
grant select on public.organization_members to authenticated;

drop policy if exists organization_members_directory_select on public.organization_members;
create policy organization_members_directory_select
on public.organization_members
for select
to authenticated
using (
  user_id = auth.uid()
  or private.is_active_org_member(organization_id)
);

-- Esta política restrictiva evita que una política antigua más amplia exponga otra organización.
drop policy if exists organization_members_org_scope_restrictive on public.organization_members;
create policy organization_members_org_scope_restrictive
on public.organization_members
as restrictive
for select
to authenticated
using (
  user_id = auth.uid()
  or private.is_active_org_member(organization_id)
);

drop policy if exists organization_members_owner_admin_insert on public.organization_members;
create policy organization_members_owner_admin_insert
on public.organization_members
as restrictive
for insert
to authenticated
with check (private.org_member_role(organization_id) in ('owner','admin'));

drop policy if exists organization_members_owner_admin_update on public.organization_members;
create policy organization_members_owner_admin_update
on public.organization_members
as restrictive
for update
to authenticated
using (private.org_member_role(organization_id) in ('owner','admin'))
with check (private.org_member_role(organization_id) in ('owner','admin'));

drop policy if exists organization_members_owner_admin_delete on public.organization_members;
create policy organization_members_owner_admin_delete
on public.organization_members
as restrictive
for delete
to authenticated
using (
  private.org_member_role(organization_id) in ('owner','admin')
  and user_id <> auth.uid()
  and lower(coalesce(role, '')) not in ('owner','dueño','dueno')
);

create or replace function public.activate_my_organization_memberships()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.organization_members
  set status = 'active', last_active_at = now()
  where user_id = auth.uid()
    and lower(coalesce(status, 'active')) <> 'suspended';
end;
$$;
revoke all on function public.activate_my_organization_memberships() from public;
grant execute on function public.activate_my_organization_memberships() to authenticated;

-- El snapshot antiguo queda disponible solamente para dueño/administrador.
-- Estas políticas restrictivas se combinan con las políticas existentes de fichas.
do $$
begin
  if to_regclass('public.fichas') is not null then
    execute 'alter table public.fichas enable row level security';
    execute 'drop policy if exists propcontrol_snapshot_owner_admin_select on public.fichas';
    execute $policy$
      create policy propcontrol_snapshot_owner_admin_select
      on public.fichas as restrictive for select to authenticated
      using (
        source <> 'propcontrol_system_snapshot'
        or private.org_member_role(organization_id) in ('owner','admin')
      )
    $policy$;
    execute 'drop policy if exists propcontrol_snapshot_owner_admin_update on public.fichas';
    execute $policy$
      create policy propcontrol_snapshot_owner_admin_update
      on public.fichas as restrictive for update to authenticated
      using (
        source <> 'propcontrol_system_snapshot'
        or private.org_member_role(organization_id) in ('owner','admin')
      )
      with check (
        source <> 'propcontrol_system_snapshot'
        or private.org_member_role(organization_id) in ('owner','admin')
      )
    $policy$;
    execute 'drop policy if exists propcontrol_snapshot_owner_admin_delete on public.fichas';
    execute $policy$
      create policy propcontrol_snapshot_owner_admin_delete
      on public.fichas as restrictive for delete to authenticated
      using (
        source <> 'propcontrol_system_snapshot'
        or private.org_member_role(organization_id) in ('owner','admin')
      )
    $policy$;
  end if;
end $$;

commit;
