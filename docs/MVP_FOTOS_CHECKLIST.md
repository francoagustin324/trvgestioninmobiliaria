# PropControl · Checklist de fotos del MVP

## Estado del código

- Carga directa desde celular o computadora.
- Compresión automática a JPEG.
- Límite de 8 fotos por propiedad.
- Portada definida por la primera posición.
- Orden y eliminación desde el formulario.
- Ficha pública con las fotos.
- Fallback al servidor si Railway tiene `SUPABASE_SECRET_KEY`.
- Carga directa con sesión autenticada si Railway no tiene clave secreta.
- Mensajes de error deduplicados.

## Activación única de Supabase Storage

Aplicar el archivo:

`supabase/migrations/20260715093000_property_photos.sql`

La migración:

1. crea el bucket público `property-photos`;
2. limita cada archivo a 1,8 MB;
3. permite JPG, PNG y WEBP;
4. autoriza la carga sólo a usuarios activos de la misma inmobiliaria;
5. permite ordenar o quitar fotos sin exponer datos internos.

## Prueba manual final

1. Abrir Propiedades.
2. Crear o editar una propiedad.
3. Cargar una sola foto.
4. Confirmar que aparece la vista previa.
5. Guardar la propiedad.
6. Volver a editar y confirmar que la foto sigue visible.
7. Abrir Ver ficha.
8. Confirmar que la foto aparece y no se muestran propietario ni notas internas.
9. Repetir con tres fotos, cambiar el orden y guardar.
10. Abrir la ficha desde otro dispositivo.

## Criterio de aprobación

El MVP de fotos queda aprobado cuando una foto cargada desde el celular se conserva después de guardar, aparece en la ficha pública y puede abrirse desde otro dispositivo.
