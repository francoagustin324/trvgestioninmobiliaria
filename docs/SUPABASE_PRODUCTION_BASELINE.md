# PRELIMINAR — Baseline de Supabase producción (B0.2-A)

## Estado

Este documento sigue siendo **preliminar**. B0.2-A prepara una auditoría de solo lectura para conocer el esquema real de Supabase producción antes de diseñar una baseline reproducible.

Todavía no contiene resultados observados, no es una migración ejecutable y no autoriza ninguna ejecución en Supabase. B0.2-A no crea una baseline ejecutable.

El PR #113 fue fusionado antes de esta revisión correctiva. Esa fusión únicamente incorporó artefactos al repositorio: **no constituye autorización para ejecutar el SQL**. El trabajo correctivo posterior debe permanecer en un PR nuevo y en modo Draft hasta una autorización independiente.

## Objetivo

B0.2-A debe producir metadata técnica suficiente para comparar producción contra GitHub sin leer información comercial o personal. La etapa no corrige drift, no crea objetos y no genera todavía una migración baseline.

El artefacto `supabase/audits/b0_2_production_inventory_readonly.sql` queda dividido en dos etapas independientes:

1. **Etapa 1 — Preflight catalogal.**
2. **Etapa 2 — Inventario completo.**

La Etapa 2 solo podrá ejecutarse cuando la Etapa 1 devuelva exactamente `safe_to_run_inventory: true`.

## Etapa 1 — Preflight catalogal

El preflight:

- es estrictamente de solo lectura;
- utiliza únicamente relaciones y funciones de `pg_catalog`;
- no consulta `storage.buckets` ni `supabase_migrations.schema_migrations` directamente;
- no consulta filas de `auth.users`;
- no consulta leads, propiedades, conversaciones, organizaciones ni archivos;
- devuelve una sola fila y una columna JSONB llamada `b0_2_production_inventory_preflight`;
- incluye la clave booleana `safe_to_run_inventory`;
- enumera requisitos y hallazgos bloqueantes.

### Esquemas confirmados

El preflight informa la existencia de:

- `pg_catalog`;
- `public`;
- `private`;
- `auth`;
- `storage`;
- `supabase_migrations`.

La ausencia de un esquema observado no siempre bloquea el inventario. Solamente bloquean los objetos indispensables para que la segunda sentencia pueda analizarse y ejecutarse con seguridad.

### Relaciones y columnas indispensables

El preflight exige para habilitar la Etapa 2:

- `storage.buckets`;
- `supabase_migrations.schema_migrations`;
- `storage.buckets.name`;
- `storage.buckets.public`;
- `storage.buckets.file_size_limit`;
- `storage.buckets.allowed_mime_types`;
- `supabase_migrations.schema_migrations.version`.

También observa, sin convertir su ausencia en un bloqueo automático:

- `storage.objects`;
- `auth.users`.

### Catálogos y funciones técnicas

El preflight confirma las relaciones catalogales usadas por el inventario y funciones como:

- `pg_catalog.acldefault`;
- `pg_catalog.aclexplode`;
- `pg_catalog.format_type`;
- `pg_catalog.pg_get_expr`;
- `pg_catalog.pg_get_constraintdef`;
- `pg_catalog.pg_get_indexdef`;
- `pg_catalog.pg_get_functiondef`;
- `pg_catalog.pg_get_triggerdef`;
- `pg_catalog.pg_describe_object`.

### Regla de detención

- `safe_to_run_inventory = false`: detenerse. La Etapa 2 no debe ejecutarse.
- `safe_to_run_inventory = true`: la Etapa 2 queda técnicamente habilitada, pero todavía requiere autorización operativa separada.

Un resultado `true` no significa que el esquema esté correcto. Solamente confirma que existen las dependencias mínimas para relevarlo.

## Etapa 2 — Inventario completo

La segunda sentencia vuelve a validar las dependencias mínimas y devuelve una sola fila con una columna JSONB llamada `b0_2_production_inventory`.

Inventaría metadata de los siguientes grupos.

### Tablas principales

- `public.organizations`;
- `public.organization_members`;
- `public.fichas`;
- `public.propcontrol_records`;
- `public.public_property_fichas`.

Para cada tabla releva:

- existencia;
- propietario;
- columnas, tipos, nulabilidad y defaults;
- identidad y columnas generadas;
- claves primarias y foráneas;
- restricciones;
- índices;
- RLS habilitado y forzado;
- políticas;
- grants.

No lee filas de esas tablas.

### Funciones

- `private.is_active_org_member`;
- `private.org_member_role`;
- `private.org_member_number`;
- `private.can_access_property_photo`;
- `public.activate_my_organization_memberships`;
- `public.is_org_member`;
- `public.can_manage_public_property_ficha`;
- `public.handle_new_propcontrol_user`;
- `public.protect_propcontrol_record_identity`.

Para cada firma releva argumentos, retorno, lenguaje, volatilidad, seguridad, `search_path`, propietario, permisos `EXECUTE`, definición normalizada y dependencias catalogables. Ninguna función inspeccionada es ejecutada.

### Protección de ACL

`table_grants` y `function_grants` no llaman `pg_catalog.acldefault` cuando el objeto o su `owner_oid` son nulos.

La regla es explícita:

- objeto ausente o propietario nulo → ACL nula y grants vacíos;
- objeto existente sin ACL explícita → `acldefault` con propietario válido;
- objeto con ACL explícita → se usa esa ACL.

Esto permite inventariar objetos ausentes sin provocar una llamada inválida a `acldefault`.

### Triggers

Se revisan:

- triggers no internos de las tablas principales;
- `auth.users.on_propcontrol_user_created` cuando exista;
- función vinculada;
- momento, eventos y nivel;
- estado habilitado;
- definición catalogal.

No se consultan filas de `auth.users`.

### Storage

Se releva únicamente metadata de buckets:

- nombre técnico;
- público o privado;
- límite de tamaño;
- MIME permitidos.

Las políticas de `storage.objects` se obtienen desde `pg_catalog`. No se consulta ni se enumera ningún archivo.

### Historial de migraciones

Se releva:

- existencia ya confirmada por preflight;
- versiones técnicas registradas;
- versiones esperadas según GitHub;
- versiones esperadas faltantes;
- versiones no reconocidas;
- estado `empty`, `incomplete` o `present`.

La presencia de una versión no demuestra igualdad byte a byte con el archivo actual.

### Objetos previstos

Se confirma existencia o ausencia de:

- `public.user_profiles`;
- `public.organization_settings`;
- bucket `profile-avatars`.

B0.2-A no los crea ni corrige.

## Resultado JSON del inventario

El JSON completo incluye como mínimo:

- `check`;
- `read_only`;
- `generated_at`;
- `server_version`;
- `preflight_revalidated`;
- `schemas`;
- `tables`;
- `functions`;
- `triggers`;
- `rls`;
- `policies`;
- `grants`;
- `storage_buckets`;
- `migration_history`;
- `expected_objects_missing`;
- `warnings`;
- `blocking_findings`.

No debe incluir usuarios, emails, teléfonos, clientes, organizaciones reales, payloads, tokens, secretos, URLs privadas ni archivos.

## Comparación producción contra GitHub

Después de recibir resultados reales y revisados se construirá una matriz con:

1. objeto observado;
2. definición estructural observada;
3. archivo o migración que pretende representarlo;
4. coincidencia completa, parcial, divergente o no versionada;
5. dependencias necesarias;
6. riesgo de seguridad o disponibilidad;
7. tratamiento propuesto para una baseline futura.

## Riesgos de drift

Una baseline incorrecta puede omitir columnas, índices, restricciones, triggers o grants; alterar RLS; ampliar permisos; cambiar `SECURITY DEFINER` o `search_path`; y producir un staging que compile pero no preserve el aislamiento entre inmobiliarias.

Por eso no se crea una baseline ejecutable hasta analizar el inventario real.

## Objetos potencialmente no versionados

Hasta observar producción solo pueden considerarse hipótesis:

- tablas base creadas manualmente;
- funciones o triggers fuera de migraciones;
- políticas reemplazadas en SQL Editor;
- grants no reflejados completamente;
- buckets configurados en momentos distintos;
- historial técnico incompleto.

No deben afirmarse como hechos antes del JSON real.

## Procedimiento para completar B0.2

1. conservar el SQL fuera de `supabase/migrations`;
2. revisar estáticamente la Etapa 1;
3. obtener una autorización separada antes de cualquier ejecución;
4. ejecutar únicamente el preflight;
5. detenerse si `safe_to_run_inventory` es `false`;
6. revisar el resultado y confirmar que no contiene datos sensibles;
7. obtener otra autorización concreta para la Etapa 2;
8. ejecutar el inventario completo solamente con preflight `true`;
9. analizar el JSON real;
10. comparar producción contra GitHub;
11. diseñar la baseline en un trabajo futuro y separado;
12. validarla exclusivamente en staging descartable.

## Alcance excluido

Esta corrección no:

- ejecuta SQL;
- modifica Supabase;
- modifica producción;
- crea una migración baseline;
- no corrige `handle_new_propcontrol_user`;
- modifica invitaciones;
- implementa organización activa;
- toca `LIMIT 1`;
- modifica RLS, Storage o frontend;
- toca WhatsApp o IA;
- avanza a B1.

## Rollback

No aplica rollback de base de datos porque esta etapa no modifica Supabase ni producción.

El rollback del repositorio consiste en cerrar el PR correctivo Draft o revertir sus cambios antes de una eventual publicación autorizada.

## Criterio de cierre

B0.2-A continúa preliminar hasta que:

- el preflight y el inventario estén revisados;
- TypeScript, build, suite y CI estén en `success`;
- el PR correctivo permanezca en Draft;
- no se haya ejecutado SQL;
- no se haya modificado Supabase;
- exista una autorización posterior y específica para cada ejecución.
