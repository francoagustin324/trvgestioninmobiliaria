# Alcance PR55

- Eliminar dependencias de columnas inexistentes `member_id` y `status`.
- Aceptar JPG de Android con tipo MIME vacío.
- Subir fotos livianas sin recodificar.
- Mantener compresión para fotos grandes.
- Adaptar la migración de Supabase Storage al esquema real.
- Forzar actualización de caché en celular y computadora.

## Prueba manual final

1. Cargar una sola foto JPG desde Android.
2. Confirmar que aparece la vista previa.
3. Guardar la propiedad.
4. Abrir la ficha desde otro dispositivo.
