-- PropControl · Aislamiento restrictivo adicional por inmobiliaria
-- Esta migración no reemplaza los permisos por rol existentes.
-- Agrega una condición obligatoria de pertenencia a la inmobiliaria incluso
-- si en el futuro se incorpora por error otra política permisiva más amplia.

begin;

revoke all on table public.propcontrol_records from anon;

alter table public.propcontrol_records enable row level security;

drop policy if exists propcontrol_records_org_scope_restrictive
  on public.propcontrol_records;
create policy propcontrol_records_org_scope_restrictive
on public.propcontrol_records
as restrictive
for all
to authenticated
using (private.is_active_org_member(organization_id))
with check (private.is_active_org_member(organization_id));

revoke all on table public.public_property_fichas from anon;

alter table public.public_property_fichas enable row level security;

drop policy if exists public_property_fichas_org_scope_restrictive
  on public.public_property_fichas;
create policy public_property_fichas_org_scope_restrictive
on public.public_property_fichas
as restrictive
for all
to authenticated
using (public.can_manage_public_property_ficha(organization_id))
with check (public.can_manage_public_property_ficha(organization_id));

-- La lectura pública continúa exclusivamente mediante
-- public.get_public_property_ficha(text), que devuelve sólo el payload comercial.

commit;
