# Hotfix · organization_members.status

## Error observado

`column organization_members.status does not exist`

## Causa

La carga directa de fotos y la función de seguridad de Storage esperan la columna `status` en `public.organization_members`, pero algunas instalaciones anteriores no la tienen.

## Corrección

Aplicar la migración:

`supabase/migrations/20260716103000_add_organization_member_status.sql`

La migración:

- agrega `status` con valor predeterminado `active`;
- normaliza registros existentes;
- restringe los valores a `active` o `suspended`;
- recrea la función segura para administrar fotos.

## Validación manual

Desde el celular, cargar una foto en una propiedad, guardar y abrir la ficha pública desde otro dispositivo.
