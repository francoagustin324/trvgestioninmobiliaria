-- SEC-FIX A2.5 — real pre-A2.1 restrictive policies for legacy snapshots.
-- Kept separate from the core baseline so the reusable bootstrap remains auditable.

begin;

create policy propcontrol_snapshot_owner_admin_select
on public.fichas
as restrictive
for select
to authenticated
using (
  source <> 'propcontrol_system_snapshot'
  or private.org_member_role(organization_id) in ('owner', 'admin')
);

create policy propcontrol_snapshot_owner_admin_update
on public.fichas
as restrictive
for update
to authenticated
using (
  source <> 'propcontrol_system_snapshot'
  or private.org_member_role(organization_id) in ('owner', 'admin')
)
with check (
  source <> 'propcontrol_system_snapshot'
  or private.org_member_role(organization_id) in ('owner', 'admin')
);

create policy propcontrol_snapshot_owner_admin_delete
on public.fichas
as restrictive
for delete
to authenticated
using (
  source <> 'propcontrol_system_snapshot'
  or private.org_member_role(organization_id) in ('owner', 'admin')
);

commit;
