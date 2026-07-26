# PRELIMINAR — Baseline de Supabase producción (B0.2-A)

## Estado

Este documento es **preliminar**. Describe el procedimiento de inventario y comparación necesario para construir posteriormente una baseline confiable del esquema real de Supabase producción.

Todavía no contiene resultados observados de producción y **no es una migración ejecutable**. Permanecerá preliminar hasta que Franco ejecute de forma manual el inventario de solo lectura y entregue el JSON real para su análisis.

## Objetivo de B0.2-A

B0.2-A prepara una auditoría integral, catalogal y estrictamente de solo lectura del proyecto Supabase de producción. Su finalidad es establecer una fuente verificable para reconstruir más adelante el esquema desde cero sin inferir estructuras, permisos o dependencias a partir de migraciones parciales.

Esta etapa solamente agrega:

- el SQL de inventario fuera de `supabase/migrations`;
- esta documentación preliminar;
- pruebas estáticas que protegen el carácter de solo lectura y el alcance del inventario.

No crea todavía una migración baseline, no corrige drift y no modifica ningún objeto de Supabase.

## Estado conocido antes del inventario

Los únicos hechos aceptados antes de observar el JSON real son:

- B0.1 está cerrado;
- el PR #111 fue fusionado y su migración fue aplicada manualmente en producción;
- el postflight de B0.1 fue revisado;
- las pruebas controladas de autorización finalizaron 12/12;
- el PR #112 fue fusionado;
- B0.1 no debe volver a ejecutarse;
- el repositorio contiene migraciones incrementales que no demuestran por sí solas que una base vacía pueda reconstruirse de forma completa;
- por ese motivo, la baseline futura debe derivarse del esquema real inventariado y luego compararse contra GitHub.

No se afirma todavía que una tabla, función, trigger, política, bucket o migración técnica exista o falte en producción. Esos resultados dependen exclusivamente del JSON real.

## Inventario preparado

El archivo `supabase/audits/b0_2_production_inventory_readonly.sql` está diseñado para devolver exactamente una fila y una columna JSONB llamada `b0_2_production_inventory`.

La consulta revisará únicamente metadatos estructurales y de autorización. No consulta registros comerciales, usuarios, archivos ni payloads.

### Tablas principales

Se revisarán:

- `public.organizations`;
- `public.organization_members`;
- `public.fichas`;
- `public.propcontrol_records`;
- `public.public_property_fichas`.

Para cada objeto se relevarán, cuando corresponda:

- existencia y tipo de relación;
- propietario;
- columnas, posición, tipo, nulabilidad, default, identidad y generación;
- claves primarias;
- claves foráneas;
- restricciones;
- índices;
- RLS habilitado y RLS forzado;
- políticas;
- grants efectivos por rol.

No se leerán filas de esas tablas.

### Funciones

Se revisarán:

- `private.is_active_org_member`;
- `private.org_member_role`;
- `private.org_member_number`;
- `private.can_access_property_photo`;
- `public.activate_my_organization_memberships`;
- `public.is_org_member`;
- `public.can_manage_public_property_ficha`;
- `public.handle_new_propcontrol_user`;
- `public.protect_propcontrol_record_identity`.

Para cada función y sobrecarga se relevarán:

- firma e identidad de argumentos;
- argumentos declarados;
- tipo de retorno;
- lenguaje;
- volatilidad;
- `SECURITY DEFINER` o `SECURITY INVOKER`;
- `search_path` configurado;
- propietario;
- permisos `EXECUTE`;
- definición normalizada;
- dependencias que PostgreSQL exponga en sus catálogos.

El inventario obtiene definiciones mediante metadatos de PostgreSQL. No invoca ni ejecuta ninguna función inspeccionada.

### Triggers

Se revisarán:

- los triggers no internos de las cinco tablas principales;
- el trigger `auth.users.on_propcontrol_user_created`;
- la función vinculada;
- momento de ejecución;
- eventos;
- nivel fila o sentencia;
- estado habilitado;
- definición catalogal.

La revisión de `auth.users` se limita a catálogos del esquema. No consulta filas de usuarios.

### Storage

Se revisará únicamente metadata de `storage.buckets`:

- nombre técnico del bucket;
- condición pública o privada;
- límite de tamaño;
- tipos MIME permitidos.

También se relevarán las políticas catalogadas sobre `storage.objects` para poder identificar su alcance estructural.

No se consulta `storage.objects`, no se enumeran archivos y no se extraen nombres, rutas o propietarios de objetos almacenados.

### Historial de migraciones

Se revisará:

- existencia técnica de `supabase_migrations.schema_migrations`;
- identificadores de versiones registrados;
- comparación contra los identificadores de migraciones actualmente conocidos en GitHub;
- clasificación preliminar del historial como presente, vacío, incompleto o ausente.

La comparación inicial considera estos identificadores técnicos versionados:

- `20260713`;
- `20260715093000`;
- `20260716103000`;
- `20260716103100`;
- `20260717113000`;
- `20260717190000`;
- `20260724190000`.

La presencia de un identificador no demuestra por sí sola que el contenido aplicado sea idéntico al archivo actual de GitHub. Esa equivalencia deberá analizarse después del inventario real y, cuando sea necesario, mediante comparaciones estructurales adicionales.

### Objetos previstos para fases posteriores

Se confirmará existencia o ausencia de:

- `public.user_profiles`;
- `public.organization_settings`;
- bucket `profile-avatars`.

Su ausencia no será corregida en B0.2-A. El inventario solamente la documentará.

## Comparación entre producción y GitHub

Después de recibir el JSON real se construirá una matriz de comparación con, como mínimo:

1. objeto observado en producción;
2. definición o comportamiento estructural observado;
3. archivo o migración de GitHub que pretende representarlo;
4. coincidencia completa, coincidencia parcial, objeto no versionado o definición divergente;
5. dependencia anterior necesaria para reconstruirlo;
6. riesgo de seguridad o disponibilidad asociado;
7. tratamiento propuesto para una baseline futura.

La comparación deberá distinguir claramente:

- objetos creados fuera de migraciones versionadas;
- migraciones aplicadas manualmente sin registro técnico;
- archivos presentes en GitHub pero posiblemente no aplicados;
- objetos modificados después de su creación;
- grants implícitos o heredados;
- políticas permisivas y restrictivas combinadas;
- funciones con sobrecargas o firmas divergentes;
- dependencias en `auth`, `storage`, extensiones o esquemas administrados por Supabase.

## Riesgos de drift

Una baseline incorrecta puede:

- omitir columnas, restricciones o índices necesarios;
- recrear grants demasiado amplios;
- alterar la combinación efectiva de políticas RLS;
- perder triggers de identidad o auditoría;
- cambiar `SECURITY DEFINER`, volatilidad o `search_path` de funciones;
- asumir un historial de migraciones que producción no reconoce;
- crear buckets o políticas con configuración distinta;
- producir una base nueva que compile pero no conserve el aislamiento entre inmobiliarias;
- impedir restauraciones, staging reproducible o alta segura de nuevos clientes SaaS.

Por eso no se generará una migración baseline hasta revisar el inventario real y resolver cada hallazgo bloqueante.

## Objetos potencialmente no versionados

Antes de observar producción no se puede enumerar cuáles objetos están efectivamente sin versionar. B0.2-A parte de la posibilidad de que existan:

- tablas base creadas antes del historial actual;
- funciones o triggers creados manualmente;
- políticas RLS reemplazadas en SQL Editor;
- grants que no aparecen completos en las migraciones actuales;
- buckets y políticas de Storage aplicados en iteraciones distintas;
- versiones registradas que no representen exactamente el estado final del objeto.

El JSON real determinará cuáles de estas posibilidades son hechos y cuáles no aplican.

## Procedimiento para completar la baseline

La baseline se completará en etapas separadas:

1. conservar el SQL de inventario como artefacto de auditoría, fuera de migraciones;
2. obtener el JSON real de producción mediante una ejecución manual y controlada;
3. verificar que el JSON no contenga datos personales ni secretos;
4. revisar hallazgos bloqueantes, warnings y objetos ausentes;
5. comparar cada objeto observado contra migraciones y código en GitHub;
6. identificar el orden real de dependencias entre esquemas, tablas, funciones, triggers, RLS, grants y Storage;
7. diseñar una baseline nueva para una base vacía, sin editar migraciones ya aplicadas;
8. validar esa baseline únicamente en un proyecto de staging descartable;
9. ejecutar pruebas positivas y negativas de autorización;
10. documentar diferencias inevitables entre objetos administrados por Supabase y objetos propios de PropControl;
11. abrir un trabajo separado para la eventual migración baseline ejecutable.

Cada corrección posterior deberá tener alcance, pruebas, rollback y autorización independientes.

## Regla de no corrección

B0.2-A no corrige ningún resultado. Aunque el inventario futuro revele un trigger incorrecto, RLS deshabilitado, una función divergente, un grant excesivo o un historial incompleto, esta etapa se limitará a documentarlo.

No se modificará `handle_new_propcontrol_user`, invitaciones, organización activa, usos de `LIMIT 1`, Storage, frontend, WhatsApp ni IA hasta analizar el JSON real y autorizar un trabajo separado.

## Seguridad y privacidad

El inventario está limitado a catálogos y metadata técnica. No debe incluir:

- usuarios;
- emails;
- teléfonos;
- identificadores personales;
- nombres de clientes;
- nombres de organizaciones;
- leads;
- propiedades;
- conversaciones;
- payloads;
- tokens;
- secretos;
- URLs privadas;
- archivos de Storage.

## Rollback

No aplica rollback de base de datos porque B0.2-A no modifica producción, no ejecuta SQL y no crea una migración ejecutable.

El único rollback del repositorio, antes de una eventual fusión, consiste en cerrar el PR Draft o eliminar los tres archivos nuevos de su rama. Esto no afecta Supabase ni datos reales.

## Criterio de cierre de B0.2-A

Esta etapa podrá considerarse preparada cuando:

- el SQL permanezca estrictamente de solo lectura;
- las pruebas estáticas y la suite completa estén aprobadas;
- el PR continúe en modo Draft;
- se confirme que no hubo ejecución SQL ni cambios en Supabase;
- el documento continúe marcado como preliminar;
- Franco entregue posteriormente el JSON real para una fase de análisis separada.

Hasta entonces, este documento no representa una baseline definitiva de producción.
