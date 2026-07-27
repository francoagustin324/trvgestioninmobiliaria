# PRELIMINAR — Baseline de Supabase producción (B0.2-A)

## Estado

Este documento continúa siendo **preliminar**. B0.2-A prepara una auditoría estrictamente de solo lectura para reconstruir más adelante una baseline confiable del esquema real de Supabase producción.

No es una migración ejecutable, no crea una baseline y no autoriza cambios en Supabase.

## Resultado real que motiva esta corrección

El preflight ejecutado manualmente en producción confirmó que existen los esquemas `public`, `private`, `auth` y `storage`; también existen `storage.buckets`, `storage.objects` y las columnas técnicas requeridas de `storage.buckets`.

Producción no expone `supabase_migrations` ni `supabase_migrations.schema_migrations`. Esta ausencia no implica que las migraciones no se hayan aplicado. Solo significa que el historial técnico no está disponible mediante esa relación en esta base de datos.

Por ese motivo:

- `supabase_migrations` deja de ser un requisito bloqueante;
- el historial técnico queda marcado como `unavailable`;
- la baseline futura deberá compararse principalmente contra el esquema real observado;
- no se debe inventar ni crear el historial faltante.

## Objetivo

El artefacto `supabase/audits/b0_2_production_inventory_readonly.sql` conserva dos etapas independientes:

1. **Etapa 1 — Preflight catalogal.**
2. **Etapa 2 — Inventario completo.**

Ambas son de solo lectura. La Etapa 2 solo puede ejecutarse cuando la Etapa 1 devuelve `safe_to_run_inventory: true` y existe una autorización operativa separada.

## Etapa 1 — Preflight catalogal

El preflight:

- usa únicamente relaciones y funciones de `pg_catalog` como fuentes físicas;
- no consulta directamente filas de `storage.buckets`, `storage.objects`, `auth.users` ni tablas comerciales;
- comprueba los esquemas y objetos indispensables para la Etapa 2;
- informa objetos opcionales sin convertir su ausencia en bloqueo;
- devuelve una sola fila JSONB en `b0_2_production_inventory_preflight`;
- incluye `read_only`, `catalog_only`, `safe_to_run_inventory`, `warnings` y `blocking_findings`.

### Requisitos bloqueantes

Para habilitar el inventario estructural se requieren:

- esquema `storage`;
- relación `storage.buckets`;
- columnas `storage.buckets.name`;
- `storage.buckets.public`;
- `storage.buckets.file_size_limit`;
- `storage.buckets.allowed_mime_types`;
- relaciones y funciones de `pg_catalog` utilizadas por el inventario.

### Objetos opcionales

El preflight observa, sin bloquear:

- `public`;
- `private`;
- `auth`;
- `storage.objects`;
- `auth.users`;
- `supabase_migrations`;
- `supabase_migrations.schema_migrations`;
- `supabase_migrations.schema_migrations.version`.

Cuando el historial técnico no está disponible, el preflight devuelve la advertencia `migration history unavailable` y puede seguir devolviendo `safe_to_run_inventory: true` si todos los requisitos indispensables existen.

## Etapa 2 — Inventario completo

La segunda sentencia revalida únicamente las dependencias indispensables de Storage y devuelve una sola fila JSONB llamada `b0_2_production_inventory`.

No contiene `FROM supabase_migrations.schema_migrations` ni `JOIN supabase_migrations.schema_migrations`. Tampoco usa SQL dinámico para intentar acceder a una relación opcional.

### Tablas principales

Se inventarían mediante catálogos:

- `public.organizations`;
- `public.organization_members`;
- `public.fichas`;
- `public.propcontrol_records`;
- `public.public_property_fichas`.

Para cada tabla se relevan existencia, propietario, columnas, tipos, nulabilidad, defaults, claves, restricciones, índices, RLS, políticas y grants. No se consultan filas de esas tablas.

### Funciones

Se inspeccionan sin ejecutarlas:

- `private.is_active_org_member`;
- `private.org_member_role`;
- `private.org_member_number`;
- `private.can_access_property_photo`;
- `public.activate_my_organization_memberships`;
- `public.is_org_member`;
- `public.can_manage_public_property_ficha`;
- `public.handle_new_propcontrol_user`;
- `public.protect_propcontrol_record_identity`.

Para cada firma se relevan argumentos, retorno, lenguaje, volatilidad, seguridad, `search_path`, propietario, permisos `EXECUTE`, definición normalizada y dependencias catalogables.

### Protección de ACL

`table_grants` y `function_grants` no llaman `pg_catalog.acldefault` cuando el objeto o su `owner_oid` son nulos.

- objeto ausente o propietario nulo: ACL nula y grants vacíos;
- objeto existente sin ACL explícita: `acldefault` con propietario válido;
- objeto con ACL explícita: se utiliza la ACL observada.

### Triggers, RLS y políticas

Se inventarían:

- triggers no internos de las tablas principales;
- `auth.users.on_propcontrol_user_created`, cuando exista;
- función vinculada, evento, momento, nivel, estado y definición;
- RLS habilitado y forzado;
- políticas de las tablas principales;
- políticas relacionadas con `storage.objects` obtenidas desde `pg_catalog`.

No se consultan filas de `auth.users` ni de `storage.objects`.

### Storage

Se lee exclusivamente metadata permitida de `storage.buckets`:

- nombre técnico;
- público o privado;
- límite de tamaño;
- MIME permitidos.

No se listan archivos.

### Historial de migraciones

Cuando `supabase_migrations.schema_migrations` no existe, `migration_history` devuelve:

```json
{
  "source_available": false,
  "status": "unavailable",
  "registered_versions": [],
  "missing_expected_versions": [],
  "unrecognized_versions": [],
  "warning": "supabase_migrations.schema_migrations is not available in this production database"
}
```

El estado `unavailable` no permite concluir que una migración no fue aplicada. La comparación deberá apoyarse en tablas, columnas, restricciones, funciones, triggers, políticas, grants y Storage realmente observados.

No se debe inventar ni crear el historial faltante para completar esta etapa.

## Objetos previstos para fases posteriores

El inventario confirma existencia o ausencia de:

- `public.user_profiles`;
- `public.organization_settings`;
- bucket `profile-avatars`.

B0.2-A no crea ni corrige estos objetos.

## Comparación producción contra GitHub

La baseline futura se diseñará a partir de una matriz que relacione:

1. objeto observado en producción;
2. definición estructural observada;
3. archivo o migración de GitHub que pretende representarlo;
4. coincidencia completa, parcial, divergente o no versionada;
5. dependencias necesarias;
6. riesgo de seguridad o disponibilidad;
7. tratamiento propuesto para una baseline futura.

Como el historial técnico está `unavailable`, la evidencia principal será el esquema real. Los archivos de migración existentes servirán para explicar intención y evolución, pero no reemplazan la observación catalogal.

## Riesgos de drift

Una baseline incorrecta puede omitir columnas, índices, restricciones, triggers o grants; modificar la combinación efectiva de RLS; ampliar permisos; cambiar `SECURITY DEFINER` o `search_path`; y producir entornos nuevos que no preserven el aislamiento entre inmobiliarias.

Por eso no se crea una baseline ejecutable hasta analizar el JSON real completo.

## Objetos potencialmente no versionados

El inventario permitirá detectar:

- tablas base creadas fuera de migraciones;
- funciones o triggers no representados en GitHub;
- políticas reemplazadas manualmente;
- grants divergentes;
- buckets configurados fuera del historial versionado;
- drift entre producción y archivos actuales.

No se corregirá ninguno de esos puntos en B0.2-A.

## Procedimiento para completar B0.2

1. conservar el SQL fuera de `supabase/migrations`;
2. validar las dos etapas en PostgreSQL 17 efímero;
3. revisar estáticamente que ambas sean de solo lectura;
4. obtener autorización separada antes de ejecutar cualquier etapa en Supabase;
5. ejecutar primero únicamente el preflight;
6. detenerse cuando `safe_to_run_inventory` sea `false`;
7. revisar advertencias y hallazgos;
8. obtener otra autorización concreta para la Etapa 2;
9. ejecutar el inventario completo solo con preflight positivo;
10. analizar el JSON real;
11. comparar producción contra GitHub;
12. diseñar y validar la baseline en un trabajo futuro separado.

## Alcance excluido

Esta corrección no:

- ejecuta SQL en Supabase;
- modifica producción;
- crea `supabase_migrations`;
- crea una migración baseline;
- corrige `handle_new_propcontrol_user`;
- modifica triggers, RLS, invitaciones u organización activa;
- toca `LIMIT 1`;
- modifica frontend, WhatsApp o IA;
- avanza a B1.

## Rollback

No aplica rollback de base de datos porque esta etapa no modifica Supabase ni producción.

El rollback del repositorio consiste en cerrar el PR Draft o revertir sus commits antes de una eventual publicación autorizada.

## Criterio de cierre

B0.2-A continúa preliminar hasta que:

- ambas etapas estén validadas en PostgreSQL 17 aislado;
- TypeScript estricto, build, suite completa y CI estén en `success`;
- el PR permanezca en Draft;
- no se haya ejecutado SQL en Supabase;
- no se haya modificado producción;
- exista una autorización posterior específica para publicar el PR.
