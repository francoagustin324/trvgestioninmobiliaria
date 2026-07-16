-- PropControl · Compatibilidad de Storage con esquemas antiguos.
-- No depende de organization_members.status.

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
  );
$$;

revoke all on function public.can_manage_property_photo(text) from public;
grant execute on function public.can_manage_property_photo(text) to authenticated;
