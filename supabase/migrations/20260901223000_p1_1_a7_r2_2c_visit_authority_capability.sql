-- P1.1-A7-R2.2C1 — capability de selección del writer transaccional Visit.
-- Sólo expone un boolean derivado de la membership activa del caller.

begin;

create function public.visit_transaction_authority_active()
returns boolean
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  current_user_id uuid := auth.uid();
  active_organizations uuid[];
  target_organization_id uuid;
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  select pg_catalog.array_agg(member.organization_id order by member.organization_id)
  into active_organizations
  from public.organization_members as member
  where member.user_id = current_user_id
    and pg_catalog.lower(coalesce(member.status, 'active')) = 'active';

  if coalesce(pg_catalog.array_length(active_organizations, 1), 0) <> 1 then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  target_organization_id := active_organizations[1];
  return private.visit_authority_active(target_organization_id);
end;
$function$;

revoke all on function public.visit_transaction_authority_active() from public;
revoke all on function public.visit_transaction_authority_active() from anon;
grant execute on function public.visit_transaction_authority_active() to authenticated;

commit;
