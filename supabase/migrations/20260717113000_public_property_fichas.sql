-- PropControl · Fichas públicas con enlace corto y editable

create table if not exists public.public_property_fichas (
  slug text primary key,
  organization_id text not null,
  property_key text not null,
  payload jsonb not null,
  published boolean not null default true,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint public_property_fichas_slug_format
    check (slug ~ '^[a-z0-9][a-z0-9-]{4,79}$'),
  constraint public_property_fichas_organization_property_unique
    unique (organization_id, property_key)
);

alter table public.public_property_fichas enable row level security;

grant select, insert, update, delete on public.public_property_fichas to authenticated;

create or replace function public.can_manage_public_property_ficha(target_organization text)
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
  );
$$;

revoke all on function public.can_manage_public_property_ficha(text) from public;
grant execute on function public.can_manage_public_property_ficha(text) to authenticated;

drop policy if exists "public_property_fichas_select_by_member" on public.public_property_fichas;
create policy "public_property_fichas_select_by_member"
on public.public_property_fichas
for select
to authenticated
using (public.can_manage_public_property_ficha(organization_id));

drop policy if exists "public_property_fichas_insert_by_member" on public.public_property_fichas;
create policy "public_property_fichas_insert_by_member"
on public.public_property_fichas
for insert
to authenticated
with check (
  created_by = auth.uid()
  and public.can_manage_public_property_ficha(organization_id)
);

drop policy if exists "public_property_fichas_update_by_member" on public.public_property_fichas;
create policy "public_property_fichas_update_by_member"
on public.public_property_fichas
for update
to authenticated
using (public.can_manage_public_property_ficha(organization_id))
with check (public.can_manage_public_property_ficha(organization_id));

drop policy if exists "public_property_fichas_delete_by_member" on public.public_property_fichas;
create policy "public_property_fichas_delete_by_member"
on public.public_property_fichas
for delete
to authenticated
using (public.can_manage_public_property_ficha(organization_id));

create or replace function public.get_public_property_ficha(target_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select ficha.payload
  from public.public_property_fichas as ficha
  where ficha.slug = target_slug
    and ficha.published = true
  limit 1;
$$;

revoke all on function public.get_public_property_ficha(text) from public;
grant execute on function public.get_public_property_ficha(text) to anon, authenticated;
