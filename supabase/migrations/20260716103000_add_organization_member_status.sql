-- PropControl · Compatibilidad de membresías para fotos de propiedades
-- Corrige instalaciones donde organization_members todavía no tiene status.

alter table public.organization_members
  add column if not exists status text not null default 'active';

update public.organization_members
set status = 'active'
where status is null or btrim(status) = '';

alter table public.organization_members
  drop constraint if exists organization_members_status_check;

alter table public.organization_members
  add constraint organization_members_status_check
  check (status in ('active', 'suspended'));

create index if not exists organization_members_user_status_idx
  on public.organization_members (user_id, status);

create or replace function public.can_manage_property_photo(target_organization text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members as member
    where member.user_id = auth.uid()
      and member.organization_id::text = target_organization
      and member.status <> 'suspended'
  );
$$;

revoke all on function public.can_manage_property_photo(text) from public;
grant execute on function public.can_manage_property_photo(text) to authenticated;
