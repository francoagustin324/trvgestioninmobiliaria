# SEC-FIX A2.5 — Reproducible PostgreSQL/Supabase baseline

## Gate

Base exacta autorizada: `b8e9b3d37b37adf321af5bb0903bd804cb331a6e`.

Branch aislada: `codex/sec-fix-a2-5-baseline`.

Este gate no aplica SQL a Supabase producción, no crea ni reconstruye `supabase_migrations.schema_migrations`, no mergea, no deploya y no avanza a A3.

## Estrategia

La cadena histórica no se usa como migration ledger. A2.5 construye el estado final deseado mediante:

1. baseline explícita del núcleo que históricamente no tenía un `CREATE` reproducible;
2. replay de migrations históricas que sí son reutilizables y autocontenidas una vez presente ese núcleo;
3. estado resultante inmediatamente anterior a A2.1;
4. forward estricto A2.1 → A2.2 → A2.3 → A2.4.

Entrypoint pre-A2.1:

`supabase/baselines/sec_fix_a2_5/baseline.psql`

Core nuevo:

- `20260910150000_pre_a2_1_core.sql`
- `20260910150100_pre_a2_1_fichas_snapshot_rls.sql`

No se reescribe, borra ni modifica ninguna migration histórica.

## Objetos materializados por la baseline

### REQUIRED BASE OBJECT

- `public.organizations`
- `public.organization_members`
- `public.fichas`
- `public.propcontrol_records`
- sequence `public.organization_members_member_id_seq`
- PK/FK, defaults e índices mínimos del núcleo
- RLS/policies base de organizations, organization_members, fichas y propcontrol_records
- `private.normalized_org_role(text)`
- `private.is_active_org_member(uuid,uuid)`
- `private.org_member_role(uuid,uuid)`
- `private.org_member_number(uuid,uuid)`
- `public.is_org_member(uuid)`
- `private.can_access_property_photo(text)`
- `public.protect_propcontrol_record_identity()` y su trigger
- `public.handle_new_propcontrol_user()`

Luego el manifest reutiliza migrations existentes para crear/alinear:

- `public.public_property_fichas`
- public share RPC
- activation/membership hardening histórico compatible
- onboarding trigger exacto sobre `auth.users`
- entity types Visit/Offer/Reservation
- `private.commercial_operations`
- `private.commercial_entity_authority`
- helpers CAS/Visit
- legacy transactional RPCs requeridos por A2.3
- contratos V2 de A1.1 que A2.4 luego alinea.

## organization_members pre-A2.1

La baseline termina con:

- PK `(organization_id,user_id)`;
- FK `organization_id → organizations(id) ON DELETE CASCADE`;
- FK `user_id → auth.users(id) ON DELETE CASCADE`;
- `member_id bigint NOT NULL` con sequence/default;
- role `owner|admin|agent`;
- email/status y metadata operativa;
- status `NOT NULL DEFAULT 'active'`;
- **sin CHECK de status**, porque A2.1 es el dueño del CHECK canónico final.

No se recrea `organization_members_org_user_uq`: producción lo posee históricamente, pero duplica exactamente la unicidad ya garantizada por la PK y no existe dependencia demostrada por nombre.

## Semántica histórica intencional

Pre-A2.2, `private.org_member_role` y `private.org_member_number` conservan la semántica histórica `status <> suspended`, por lo que `invited` todavía puede devolver authority. El test A2.5 demuestra esa condición antes de A2.2 y luego demuestra que A2.2 la elimina: sólo `active` conserva authority.

## Orden reproducible

### Baseline pre-A2.1

1. core base nuevo;
2. snapshot RLS real;
3. public property fichas;
4. restrictive organization isolation;
5. suspended-member lockout;
6. hardened invitation activation;
7. guarded onboarding trigger;
8. Visit entity type;
9. Offer entity type;
10. Reservation entity type;
11. transactional foundation;
12. Visit transaction backend;
13. Visit authority capability;
14. Client CAS reassignment;
15. A1.1 org-aware V2 compatibility.

### Forward A2

1. `20260910130000_sec_fix_a2_1_canonical_organization_member_status.sql`
2. `20260910131500_sec_fix_a2_2_active_only_membership_authority_helpers.sql`
3. `20260910133000_sec_fix_a2_3_minimal_acl_hardening.sql`
4. `20260910140000_sec_fix_a2_4_org_aware_rpc_v2_alignment.sql`

## SUPABASE-MANAGED DEPENDENCY

La baseline genérica no intenta clonar internals administrados por Supabase.

### Auth

En Supabase real deben existir:

- schema `auth`;
- `auth.users`;
- `auth.uid()`;
- roles `anon`, `authenticated`, `service_role`.

El test PostgreSQL 17 crea únicamente un fixture compatible con las columnas consumidas por PropControl (`id`, `email`, `invited_at`, `raw_user_meta_data`) y una implementación mínima de `auth.uid()` basada en `request.jwt.claim.sub`.

### Storage

No se recrean localmente:

- schema/internals de `storage`;
- `storage.buckets`;
- `storage.objects`;
- `storage.foldername()`;
- metadata física del bucket `property-photos`;
- políticas administradas alrededor de `storage.objects`.

Sí se versiona la lógica propiedad de PropControl `private.can_access_property_photo(text)`. Las migrations históricas de Storage permanecen intactas y siguen siendo replayables en un entorno Supabase real.

## Public share

El contrato final esperado es:

`anon → EXECUTE public.get_public_property_ficha(text) → payload publicado`

`anon` no recibe `SELECT` directo sobre tablas CRM ni sobre `public.public_property_fichas`.

## Comparación contra A2.0 / producción

### REQUIRED BASE OBJECT

Las tablas núcleo y helpers que producción poseía pero cuya creación completa no estaba representada por la cadena histórica pasan a estar materializados en esta baseline.

### EXPECTED A2 FORWARD CHANGE

- A2.1: CHECK canónico exacto `active|invited|suspended`.
- A2.2: authority helpers active-only.
- A2.3: ACL mínima final y hardening de `SECURITY DEFINER`.
- A2.4: V2 explícitos por `organization_id`, firmas y ACL exactas.

### LEGACY DEBT → A3

No se corrige en A2.5:

- índice redundante histórico `organization_members_org_user_uq` existente en producción;
- RPCs legacy que infieren una única/primera membership;
- raw writers/bypass runtime pendientes;
- cualquier deuda expresamente excluida por el gate A2.5.

La baseline nueva **no** introduce el índice redundante en instalaciones nuevas.

### SUPABASE-MANAGED

Auth y Storage descritos arriba. También el migration ledger ausente en producción permanece ausente/no reconstruido.

### BLOCKER

Cualquier fallo de uno de los dos clean replays, del catálogo final, de seguridad, regressions o build convierte el gate en `BLOCKED` hasta corregirse. La mera compilación no habilita el veredicto reproducible.

## Evidencia automática A2.5

`src/tests/sec-fix-a2-5-reproducible-baseline.test.ts`:

- levanta dos contenedores `postgres:17` totalmente independientes;
- confirma versión 17;
- instala fixture Supabase mínimo;
- aplica la baseline;
- comprueba que termina pre-A2.1;
- aplica A2.1, A2.2, A2.3 y A2.4 individualmente;
- verifica tablas, columnas, defaults, PK/FK, índices, funciones y firmas;
- verifica onboarding trigger, RLS y policies;
- verifica ACL final, ausencia de TRUNCATE/TRIGGER/REFERENCES de app;
- verifica que anon no tenga acceso directo a CRM;
- verifica public share RPC;
- verifica invited/suspended/unknown status;
- verifica aislamiento tenant A/B;
- verifica onboarding normal e invitación;
- verifica multi-org explícito V2 y que el helper legacy singleton no elija silenciosamente una membership;
- genera un `pg_dump --schema-only` de cada reconstrucción y exige fingerprints SHA-256 idénticos.

Las regressions A2.1–A2.4, membership/RLS, onboarding, public share, CAS/Visit y A1 se ejecutan aparte en el workflow A2.5 para no duplicar suites ya probadas.

## Criterio de cierre

Sólo puede emitirse:

`SEC-FIX A2.5 = GREEN CANDIDATE / REPRODUCIBLE FROM CLEAN DB`

si los dos clean replays PostgreSQL 17, catálogo, security matrix, regressions y build quedan GREEN en el HEAD exacto reportado.
