# Corrección final de fotos

Esta revisión corrige dos incompatibilidades detectadas en el uso real:

- `organization_members` no posee las columnas `member_id` ni `status`; las consultas y políticas usan únicamente `user_id` y `organization_id`.
- Algunos Android entregan archivos `.jpg` con tipo MIME vacío o con decodificación limitada. Las fotos de hasta 1,7 MB se suben sin recodificar; las más grandes usan tres métodos de lectura antes de informar un error.

La migración de Storage también fue adaptada al esquema real y no depende de `status`.
