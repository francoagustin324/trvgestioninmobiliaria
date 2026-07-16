-- Verificación idempotente del hotfix de membresías para fotos.
-- Falla de forma explícita si la columna no quedó disponible.

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'organization_members'
      and column_name = 'status'
  ) then
    raise exception 'organization_members.status no fue creada';
  end if;
end
$$;
