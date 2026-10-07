# BASE-P0A — Production Baseline & Recovery — Phase 1 Audit

## Status

This document is an inventory/design artifact only.

- Approved MAIN inspected: `13d99e94a32bef9f35ac8f3c09c0a9ec505933c2`
- Product code changed: **NO**
- Production mutated: **NO**
- RLS changed: **NO**
- Migrations applied: **NO**
- Real data changed: **NO**
- SQL executed against production: **NO**
- Block 2H modified: **NO**

## Sources reviewed

Existing repository sources:

- `docs/SUPABASE_PRODUCTION_BASELINE.md`
- `supabase/audits/b0_2_production_inventory_readonly.sql`
- `docs/SEC_FIX_A2_5_BASELINE.md`
- `docs/B0_1_MEMBERSHIP_SECURITY_RUNBOOK.md`
- `supabase/baselines/sec_fix_a2_5/*`
- `supabase/migrations/*`

Read-only platform metadata:

- Supabase organization/project metadata
- Supabase current documentation
- Railway production environment/service metadata

No secret values were read or recorded.

---

# P0A.3a — Backup / Recovery capability

## Verified account-level facts

Supabase organization `PropControl` is currently on:

- plan: `free`
- tier: `tier_free`

Two active Supabase projects are visible. One is explicitly named `PropControl-staging`; the other is an older generic project. The exact production mapping is **not yet proven** because Railway exposes the variable name `SUPABASE_URL` but not its value.

### Production project mapping

Status: **PARTIAL / HUMAN CONFIRMATION REQUIRED**

Before any production inventory SQL or recovery drill, the operator must explicitly confirm which Supabase project ref is production.

## Backup contract supported by the current plan

Supabase documentation currently states:

- automatic daily Dashboard backups are a Pro/Team/Enterprise plan capability;
- Free projects should maintain their own off-site logical backups using `supabase db dump` / `pg_dump`;
- PITR is an add-on for paid plans and also requires an eligible compute add-on;
- database backups contain database data/metadata but do **not** contain the binary objects stored through Supabase Storage.

Therefore the currently verified Free plan does **not** establish a production-grade recoverability contract.

### Operational interpretation

The following are **not proven** today:

- guaranteed usable daily backup;
- guaranteed retention window;
- PITR restore window;
- tested restore duration;
- coordinated point-in-time restore for database + Storage.

A provider-side backup that might internally exist for Free projects must not be treated as an operational backup unless it is actually available and restorable by the operator.

## Exact backup inventory still requiring external account verification

The current Supabase connector does not expose the project's backup list / recovery window.

Required manual verification in Supabase Dashboard for the confirmed production project:

1. Database → Backups → Scheduled
   - whether any restore points are visible;
   - earliest available restore point;
   - latest available restore point;
   - whether download/restore is available.
2. Database → Backups → Point in Time
   - PITR enabled/disabled;
   - earliest recovery point;
   - latest recovery point;
   - configured recovery retention.
3. Settings → Add-ons
   - PITR eligibility and current state.
4. Storage
   - bucket inventory;
   - whether an independent Storage export/backup process exists outside Supabase.
5. Organization → Billing / Plan
   - confirm plan has not changed between this audit and the drill.

Until those checks are captured:

`BACKUP_CAPABILITY_VERIFICATION=BLOCKED_EXTERNAL_ACCOUNT_ACCESS`

## Provisional RPO / RTO

The requested target:

- RPO: 24h
- RTO: 4h

remains **PROVISIONAL ONLY**.

Current verified capabilities do not demonstrate that either target can be met.

The targets may only become final after:

1. backup capability verification;
2. an isolated restore drill;
3. measured database restore time;
4. measured Storage recovery/reconciliation time;
5. end-to-end tenant/security validation.

---

# P0A.1 — Read-only production inventory

## Existing inventory strengths

`supabase/audits/b0_2_production_inventory_readonly.sql` already provides useful coverage for:

- schemas;
- target tables;
- columns;
- identity metadata at column level;
- indexes;
- constraints;
- foreign keys;
- functions;
- function signatures;
- SECURITY DEFINER / INVOKER state;
- function configuration / search_path;
- triggers;
- RLS enabled;
- RLS forced;
- policies;
- table/function grants;
- `organization_members`;
- `propcontrol_records`;
- relevant `auth.users` existence/trigger preflight;
- Storage bucket metadata;
- Storage object policies.

It is explicitly outside `supabase/migrations`, which is correct for an audit artifact.

## Existing inventory gaps against P0A

The current SQL does **not** yet explicitly inventory all P0A-required object classes.

| Area | Current coverage | P0A status |
| --- | --- | --- |
| Schemas | Yes | READY |
| Extensions | No explicit `pg_extension` inventory | GAP |
| Tables / columns | Yes for selected targets | PARTIAL |
| Types / enums | No explicit `pg_type/pg_enum` inventory | GAP |
| Sequences | Identity column metadata exists, but no explicit sequence object inventory | PARTIAL |
| Indexes | Yes | READY |
| Constraints / FK | Yes | READY |
| Functions / RPCs | Selected function catalog | PARTIAL |
| SECURITY DEFINER / INVOKER | Yes | READY |
| search_path | Yes via function config | READY |
| Triggers | Yes for current targets | PARTIAL |
| RLS enabled / forced | Yes | READY |
| Policies | Yes for current targets + Storage objects | PARTIAL |
| Grants | Yes for current tables/functions | PARTIAL |
| `organization_members` | Yes | READY |
| `propcontrol_records` | Yes | READY |
| `private.commercial_operations` | Not inventoried | GAP |
| Auth relevant tables | `auth.users` preflight/trigger only | PARTIAL |
| Storage buckets | Metadata only | PARTIAL |
| Storage policies | Yes | READY |
| Critical functions | Existing selected list only | PARTIAL |
| Extensions dependencies | Not inventoried | GAP |
| Jobs / cron | Not inventoried | GAP |
| Webhooks / `pg_net` | Not inventoried | GAP |
| External integrations | Not inventoried by SQL | GAP |
| `operationId` / revision / CAS recovery surface | Not inventoried | GAP |

## Production actual vs repository intended

The required classification is:

- `MATCH`
- `PARTIAL`
- `DIVERGENT`
- `UNVERSIONED`
- `MISSING_IN_PROD`
- `EXTRA_IN_PROD`

It is **not yet safe to assign these statuses object-by-object**, because the current live production inventory has not been re-run under this P0A authorization.

Previous repository documentation records a historical read-only preflight where:

- `public`, `private`, `auth`, and `storage` existed;
- `storage.buckets` and `storage.objects` existed;
- the expected technical migration ledger was unavailable.

That evidence is useful historical context, not a substitute for a fresh production inventory.

### Mandatory next inventory sequence

1. Human confirms exact production project.
2. CEREBRO explicitly authorizes Stage 1 only.
3. Run only the existing catalog preflight.
4. Stop if `safe_to_run_inventory=false`.
5. Review warnings/blockers.
6. Separately authorize the extended Stage 2 P0A inventory.
7. Capture JSON result without row-level business data.
8. Generate object-level `PRODUCTION_ACTUAL vs REPO_INTENDED` matrix.

No correction may be performed during that sequence.

---

# P0A.2 — Reproducible baseline

## Repository evidence

The repository contains:

- historical forward migrations;
- a reproducible A2.5 baseline under `supabase/baselines/sec_fix_a2_5`;
- an explicit `baseline.psql` replay order;
- tests documented as rebuilding the baseline in PostgreSQL 17.

`docs/SEC_FIX_A2_5_BASELINE.md` explicitly states that the baseline materializes core objects that were historically present in production but not fully represented by the old migration chain, then replays reusable migrations forward.

It also explicitly includes intended support for:

- `private.commercial_operations`;
- transactional helpers;
- Visit authority;
- CAS helpers;
- tenant isolation;
- Auth/Storage managed dependencies.

## Important limitation

The repository does not currently contain `supabase/config.toml`.

That means the repo has a reproducible database baseline strategy, but does not yet prove a complete one-command Supabase platform reconstruction including all managed project settings.

## Migration ledger

The production candidate currently returns no migrations through the connector migration-list operation. Existing repository documentation previously recorded `supabase_migrations.schema_migrations` as unavailable.

This must **not** be interpreted as "migrations were never applied".

For P0A, schema/object comparison is authoritative; migration history is supporting evidence only.

## Forward-only rule

Applied migration files must never be edited.

Any future correction must use a new forward migration.

Each future corrective migration must be classified before approval:

### REVERSIBLE

Rollback can be represented by a safe forward migration without data loss or security weakening.

Examples:
- additive index;
- additive non-destructive function/RPC change with preserved prior definition.

### CONDITIONALLY_REVERSIBLE

Rollback is possible only if explicit preconditions are satisfied and verified.

Examples:
- constraint tightening after validating all rows;
- column type changes where lossless conversion can be proven;
- policy/grant changes where the old security contract is still acceptable.

### IRREVERSIBLE

Rollback cannot restore the previous state without backup/recovery or data reconstruction.

Examples:
- destructive data rewrite;
- dropping semantically unique information;
- irreversible identifier remapping.

No such migration is authorized in Phase 1.

---

# Postgres + Storage recovery model

Recovery must be treated as a coordinated pair:

`(Postgres_T, Storage_T)`

No assumption may be made that both sides share the same recovery timestamp.

Database backup restores metadata such as Storage rows, but not the physical Storage objects.

The future drill must therefore validate both directions.

## DB → Storage

For each recovered DB file/photo reference:

- expected bucket;
- expected object key/path;
- object existence;
- optional size/hash metadata where available.

Missing physical objects are recovery failures.

## Storage → DB

Enumerate Storage objects and identify objects with no corresponding valid DB reference.

These are "orphan candidates".

Phase 1 and the future first drill must **not delete** orphans.

---

# Recovery and multitenancy

## Invariant

`NEVER_DISABLE_RLS_IN_PRODUCTION=TRUE`

RLS must never be disabled to perform recovery.

## Scenario A — FULL_DISASTER

Use only when the whole platform requires restoration.

Target model:

1. establish incident/cutover time;
2. select database restore source;
3. select Storage recovery source;
4. restore into an isolated environment first where practical;
5. validate schema/security/tenant isolation;
6. reconcile DB ↔ Storage;
7. validate Auth mapping and RPCs;
8. approve production cutover explicitly.

## Scenario B — SINGLE_TENANT_RECOVERY

Never roll all production backward to repair one tenant.

Target model:

1. restore the relevant full backup into an isolated environment;
2. identify the affected `organization_id`;
3. extract only entities owned by that organization;
4. validate FK/dependency closure;
5. build a tenant-scoped recovery package;
6. preflight counts and conflicts against live production;
7. recover only that organization through a reviewed privileged procedure while RLS remains enabled;
8. validate that every other organization is unchanged.

A production-wide restore for a single-tenant incident is prohibited unless the incident has been reclassified as FULL_DISASTER.

---

# Idempotency / CAS recovery risk

The recovery design must explicitly include:

- `private.commercial_operations`;
- `operationId`;
- `revision`;
- compare-and-swap behavior.

## Risk

An operation may have successfully completed after restore point `T`.

If the database is restored to a point before that operation, the restored ledger may no longer contain the completed operation while a client/session can still retry the same `operationId`.

That retry must not be automatically assumed safe merely because the restored snapshot does not contain the ledger row.

## Required future drill

Build a replay reconciliation set for the recovery interval:

1. define restore timestamp `T`;
2. capture all surviving evidence of operations after `T` from available logs/sync evidence before cutover where possible;
3. compare operation IDs against restored `private.commercial_operations`;
4. compare current/recovered entity revisions;
5. intentionally replay a previously completed operation ID in the isolated drill;
6. prove that CAS/idempotency behavior does not create a duplicate or silently overwrite a newer state;
7. quarantine ambiguous conflicts for manual review.

No idempotency implementation change is authorized in Phase 1.

---

# Secrets / config / infrastructure inventory

No secret values are stored in this document.

## Railway — verified metadata

Production Railway environment:

- source repo: `francoagustin324/trvgestioninmobiliaria`
- source branch: `main`
- service replicas: 1
- deployment region: `sfo`
- Railway volume mounts: none
- Railway buckets: none
- staged changes at inspection: none

Declared Railway variable names:

| SECRET_NAME | SYSTEM | RECOVERY_METHOD | ROTATION_REQUIRED | BACKUP_LOCATION_CLASS |
| --- | --- | --- | --- | --- |
| `SUPABASE_URL` | Railway / Supabase | Re-obtain from confirmed Supabase project settings | Conditional on project replacement | Platform configuration inventory |
| `SUPABASE_PUBLISHABLE_KEY` | Railway / Supabase | Re-obtain from Supabase API settings | Conditional / on compromise or key migration | Secret/config manager; never repo |
| `SUPABASE_SECRET_KEY` | Railway / Supabase | Recreate/re-obtain from Supabase API settings under operator control | Yes on compromise/project recreation | Secret manager; never repo |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Railway / WhatsApp provider | Recover/rotate from provider + Railway configuration | Conditional; required on compromise | Secret manager/provider configuration |

GitHub secret names and third-party provider credentials are not yet fully inventoried.

Future inventory may record **names and recovery source only**, never values.

## External integration evidence

Supabase Edge Functions:

- no Edge Functions are currently listed in either visible Supabase project.

This does not prove absence of:

- Postgres cron;
- `pg_net`;
- database webhooks;
- external service callbacks.

Those require the extended catalog inventory.

---

# P0 risks

## P0-1 — Recoverability not guaranteed

The organization is on Free and no operator-usable automated backup/retention/PITR contract has been proven.

Impact: catastrophic data loss may exceed the provisional RPO/RTO.

## P0-2 — Storage is not covered by database backup

A database restore can recreate metadata pointing at files that were not restored.

Impact: broken property photos/files despite an apparently successful DB restore.

## P0-3 — Exact production Supabase project not yet proven

Two projects exist and Railway keeps `SUPABASE_URL` hidden.

Impact: inventory/restore against the wrong project is unacceptable.

## P0-4 — Current production schema drift is not yet measured

The migration ledger cannot be trusted as the source of truth.

Impact: clean environments may differ from live production.

## P0-5 — Inventory blind spots

The current read-only script does not cover all P0A objects, especially extensions, enums, explicit sequences, `private.commercial_operations`, cron/webhooks and CAS recovery state.

## P0-6 — Single-tenant recovery is not operationalized

There is no proven procedure for restoring one `organization_id` without affecting others.

## P0-7 — Idempotency replay after restore is unproven

Restoring before a successful commercial operation may remove ledger evidence needed to recognize a later retry.

## P0-8 — Infrastructure/config is only partially versioned

Railway runtime configuration and secrets live outside Postgres/Storage and are not represented by database backup.

## P0-9 — Restore duration is unknown

No measured drill exists, so RTO 4h is not validated.

---

# Minimal artifact proposal

Phase 1 should remain documentation/read-only.

Recommended next artifacts, in order:

1. `supabase/audits/p0a_production_inventory_readonly.sql`
   - extend B0.2 inventory;
   - catalog-only except explicitly approved aggregate metadata;
   - no mutations.
2. `docs/BASE_P0A_PRODUCTION_ACTUAL_VS_INTENDED.md`
   - generated/filled only after authorized inventory;
   - object classification matrix.
3. `scripts/p0a/compare-production-inventory.mjs`
   - offline comparator: inventory JSON vs repository intended manifest;
   - no database connection.
4. `docs/BASE_P0A_RECOVERY_RUNBOOK.md`
   - finalize only after successful restore drill.
5. Optional evidence directory outside secret material:
   - restore drill timings;
   - aggregate counts;
   - catalog fingerprints;
   - no customer PII and no secret values.

No corrective migration should be created until the production matrix identifies a concrete divergence and CEREBRO authorizes that correction.

---

# What can be completed offline/local

Fully offline:

- parse repository migrations and baseline;
- build the intended-object manifest;
- extend/static-review read-only inventory SQL;
- test audit SQL against PostgreSQL 17 fixtures;
- build comparator tooling;
- define classification matrix;
- design restore validation assertions;
- define CAS/idempotency replay tests;
- define DB ↔ Storage reconciliation algorithm;
- draft runbook;
- inventory environment variable names from versioned references.

Requires real Supabase access:

- confirm production project;
- live preflight;
- live catalog inventory;
- backup list/retention/PITR window;
- bucket/object inventory;
- Storage policy reality;
- Auth mapping reality;
- extensions;
- cron/webhooks;
- actual grants/policies/functions/triggers;
- restore drill source selection.

Requires human approval:

- selecting/confirming production project;
- any SQL execution against production, even read-only;
- enabling/upgrading paid backup/PITR capability;
- creating a paid isolated restore project;
- initiating any restore;
- exporting or reinserting tenant data;
- rotating secrets;
- any forward corrective migration;
- any production cutover.

---

# Exact implementation plan by subphase

## P0A.3a-1 — Account capability closure

Human confirms production project.

Capture Dashboard evidence for:

- scheduled backups;
- PITR;
- retention;
- Storage backup/export strategy.

Output:

- verified backup capability matrix;
- measured/current RPO capability;
- drill source.

## P0A.1a — Extend audit tooling offline

Create a new read-only audit file; do not rewrite the historical B0.2 artifact.

Add:

- extensions/dependencies;
- types/enums;
- explicit sequences;
- all critical tables including `private.commercial_operations`;
- critical RPC signatures;
- broader triggers/policies/grants;
- Auth-relevant structural metadata;
- cron/`pg_net`/webhook catalog;
- CAS/idempotency structural fields.

Validate statically and in PostgreSQL 17 fixture.

## P0A.1b — Authorized production preflight

Run only preflight.

No business rows.

Stop on any blocker.

## P0A.1c — Authorized full structural inventory

Run Stage 2 only after separate approval.

Export catalog JSON.

No correction.

## P0A.2a — Repository intended manifest

Create intended manifest from:

- A2.5 baseline;
- replay order;
- forward migrations after A2.5;
- Supabase-managed dependency contract.

## P0A.2b — Drift classification

Offline comparator emits:

- MATCH
- PARTIAL
- DIVERGENT
- UNVERSIONED
- MISSING_IN_PROD
- EXTRA_IN_PROD

Every finding must link to:

- production catalog evidence;
- repository intended source;
- proposed treatment;
- reversibility classification.

## P0A.3b — Backup policy decision

Using verified account capability:

- decide whether Free is acceptable;
- define automated DB export if retained;
- define independent Storage backup/export;
- define off-site retention;
- assign operator/ownership;
- define monitoring/failure alerting.

No implementation without approval.

## P0A.4a — Isolated restore drill

Never production.

Restore/copy database into isolated project/environment.

Restore/copy Storage independently.

Run complete validation suite.

Measure timings.

## P0A.4b — Tenant recovery drill

Simulate one damaged organization.

Extract/recover only that tenant.

Prove other tenants are unchanged.

## P0A.4c — Idempotency/CAS drill

Exercise:

- operationId replay;
- stale revision;
- conflict;
- successful retry;
- restored-before-completion scenario.

## P0A.5 — Final runbook

Only after all drill gates pass.

Publish measured RPO/RTO and operational procedures.

---

# Phase 1 verdict

`P0A.3a = PARTIAL / EXTERNAL ACCOUNT VERIFICATION REQUIRED`

`P0A.1 = PARTIAL / LIVE INVENTORY NOT AUTHORIZED YET`

`P0A.2 = DESIGNABLE OFFLINE / PRODUCTION DRIFT UNKNOWN`

`P0A.4 = SPECIFICATION ONLY / NOT EXECUTED`

`P0A.5 = DRAFT STRUCTURE ONLY`

No production changes are authorized by this document.
