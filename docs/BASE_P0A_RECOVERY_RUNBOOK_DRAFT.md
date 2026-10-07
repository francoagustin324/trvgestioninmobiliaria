# BASE-P0A — Recovery Runbook — DRAFT

## Status

DRAFT ONLY.

This runbook is intentionally incomplete until an isolated restore drill succeeds.

`NEVER_DISABLE_RLS_IN_PRODUCTION=TRUE`

No step in this document authorizes a production restore, mutation, migration, grant change, RLS change, or secret rotation.

---

# 1. Incident classification

Every recovery event must be classified before action.

## FULL_DISASTER

Use only when the platform as a whole requires restoration, for example:

- database unavailable/corrupt;
- broad destructive mutation affecting multiple tenants;
- project loss;
- platform-wide schema/data failure.

## SINGLE_TENANT_RECOVERY

Use when only one `organization_id` is damaged, deleted, or corrupted.

A single-tenant incident must **not** be repaired by rolling the whole production database backward if that would revert legitimate changes belonging to other tenants.

If scope is uncertain, STOP and classify before proceeding.

---

# 2. Recovery invariants

1. RLS remains enabled in production.
2. Never execute `ALTER TABLE ... DISABLE ROW LEVEL SECURITY` as part of recovery.
3. Never bypass tenant scoping in application-facing code to make recovery easier.
4. Never restore production-wide state to fix one tenant unless incident classification changes to FULL_DISASTER.
5. Every recovery action must be reviewable and attributable.
6. No secret values may be committed to Git.
7. No Storage orphan is deleted during the first recovery pass.
8. No irreversible cleanup is performed before validation.
9. Recovery is considered incomplete until DB and Storage have both been reconciled.
10. Idempotency/CAS behavior must be tested after restore.

---

# 3. Recovery coordinate model

Recovery is a pair:

`(Postgres_T, Storage_T)`

These timestamps may differ.

Required evidence for each recovery:

- database source timestamp;
- database source type;
- Storage source timestamp;
- Storage source type;
- known gap between them;
- incident cutover timestamp;
- operator;
- approval reference.

Never claim "restored to T" unless both database and Storage semantics are documented.

---

# 4. Pre-incident prerequisites

The final runbook must eventually contain verified references for:

- production Supabase project ref;
- production Railway service/environment;
- database backup mechanism;
- database backup retention;
- Storage backup/export mechanism;
- backup monitoring;
- backup owner;
- encrypted off-site location class;
- secret recovery source;
- incident contact path;
- isolated restore project procedure.

Phase 1 does not yet prove all of these.

---

# 5. FULL_DISASTER branch

## 5.1 Stop conditions

Before restore:

- freeze planned deploys;
- stop non-essential writes where operationally possible;
- capture incident timestamp;
- preserve surviving logs/evidence;
- capture latest known healthy schema/catalog evidence;
- identify external writers/webhooks/jobs.

Do not proceed if the production project is not positively identified.

## 5.2 Select recovery sources

Select:

- `Postgres_T`;
- `Storage_T`.

Record:

- source age;
- expected data-loss window;
- known gaps.

If PITR is available, record earliest/latest valid recovery points.

If only logical dump exists, record dump generation time.

## 5.3 Isolated restoration first

Preferred sequence:

1. create/select isolated Supabase project;
2. restore database;
3. reconstruct required project configuration;
4. restore/copy Storage;
5. disable or isolate unintended external side effects where possible;
6. validate before any production cutover.

Important: database extensions such as cron, pg_net, wrappers or webhooks may create external effects after a restore. Their presence must be inventoried before selecting the restore method.

## 5.4 Structural validation

Validate exact critical schema state:

- schemas;
- extensions;
- types/enums;
- sequences/identity;
- tables/columns;
- PK/FK/check constraints;
- indexes;
- functions/RPCs;
- SECURITY DEFINER / INVOKER;
- search_path;
- triggers;
- RLS enabled/forced;
- policies;
- grants;
- Auth mapping;
- Storage bucket metadata/policies;
- `private.commercial_operations`.

## 5.5 Critical data validation

Use aggregate/controlled validation:

- critical row counts;
- organizations count;
- organization_members count;
- propcontrol_records count;
- commercial operation count;
- terminal/active state sanity;
- no unexpected null/duplicate tenant keys.

Do not dump customer PII into incident notes.

## 5.6 DB → Storage reconciliation

For every DB reference to a physical object:

- determine expected bucket/key;
- verify object existence;
- optionally compare size/hash where available.

Classify missing objects.

Do not silently remove DB references.

## 5.7 Storage → DB reconciliation

Enumerate recovered Storage objects and identify objects without a valid DB reference.

Classify them as orphan candidates.

Do not delete them during the drill or initial incident restore.

## 5.8 Security validation

Test at minimum:

- Owner;
- Administrator;
- Agent/Corredor;
- unauthenticated/anon surface where applicable;
- suspended/invited membership behavior;
- explicit cross-tenant access attempt;
- direct REST access where relevant;
- critical RPCs.

Recovery fails if tenant isolation cannot be demonstrated.

## 5.9 CAS / idempotency validation

Validate:

- current entity revision;
- stale expected revision;
- successful CAS;
- rejected stale CAS;
- operationId retry;
- operationId replay from before/after restore point;
- no duplicate commercial mutation.

## 5.10 Production cutover

Production cutover requires separate human approval.

Before cutover:

- validation suite GREEN;
- DB ↔ Storage reconciliation understood;
- data-loss window accepted;
- external integration behavior understood;
- secret/config reconstruction ready;
- rollback/abort path defined.

---

# 6. SINGLE_TENANT_RECOVERY branch

## 6.1 Principle

Recover only the affected `organization_id`.

Do not restore the live platform globally.

## 6.2 Isolated source restore

Restore the relevant full backup into an isolated environment.

The isolated restore is allowed to contain every tenant because it is not production.

## 6.3 Tenant extraction manifest

Build a deterministic manifest of all entities belonging to the target organization.

The final implementation must include dependency order and relationship closure for at least:

- organization;
- organization_members;
- propcontrol_records;
- commercial operations;
- public/private property metadata;
- any tenant-owned Storage references;
- other repo-intended tenant-owned entities discovered by P0A.1.

Do not assume every table has the same tenant column name.

## 6.4 Dependency validation

Before extracting/reinserting:

- validate PK/FK closure;
- verify referenced users/auth identities;
- verify property/file references;
- verify no row belongs to another tenant;
- calculate aggregate counts;
- identify conflicts with live production.

## 6.5 Recovery package

Create a tenant-scoped recovery package that contains only the approved organization.

Required metadata:

- source restore point;
- target organization_id;
- row counts by entity type;
- Storage objects expected;
- conflicts detected;
- operationId/revision risk set.

No secrets.

## 6.6 Preflight against live production

Before mutation, compare package vs live state:

- rows already present;
- rows missing;
- rows changed since restore point;
- revision conflicts;
- unique conflicts;
- foreign key conflicts;
- operationId collisions.

Any ambiguous conflict blocks automatic recovery.

## 6.7 Controlled tenant-only reinsertion

Future procedure must:

- keep RLS enabled;
- use a reviewed privileged administrative path;
- scope every write to the target organization;
- use explicit transactions where safe;
- enforce expected row counts;
- stop on conflict;
- avoid destructive broad deletes.

This phase does not implement that procedure.

## 6.8 Non-target tenant proof

Before and after recovery, capture aggregate fingerprints/counts for unaffected tenants.

Recovery is invalid if an unrelated tenant changes.

## 6.9 Tenant validation

Validate affected tenant:

- membership authority;
- Owner;
- Administrator;
- Agent;
- matching ownership boundaries;
- critical records;
- Storage references;
- commercial operations;
- CAS/revision state.

Then re-run cross-tenant denial tests.

---

# 7. operationId / revision / CAS restore hazard

## Scenario

1. Snapshot/restore point is T.
2. Commercial operation O completes successfully at T+1.
3. Incident causes restore back to T.
4. Restored database no longer contains O's final ledger/domain state.
5. Client retries the same operationId.

The retry is not automatically safe merely because the restored snapshot lacks O.

## Required detection strategy

Before production cutover, build a reconciliation set covering the interval after T using surviving evidence such as:

- application/cloud logs;
- sync/outbox evidence;
- client retry queues if available;
- database evidence from a later recoverable source;
- operational audit records.

Compare:

- operationId;
- tenant;
- entity;
- operation type;
- recovered revision;
- current expected revision;
- final state if known.

## Validation outcomes

### SAFE_RETRY

Recovered state and CAS preconditions prove the retry represents the same missing mutation.

### ALREADY_APPLIED

External/surviving evidence proves the operation already produced the intended result.

### CONFLICT

Revision/domain state differs. Do not replay automatically.

### UNKNOWN

Insufficient evidence. Manual review required.

The first drill must intentionally test each feasible class.

---

# 8. Secrets/config recovery

Secrets are not restored from Postgres/Storage backup.

Required inventory fields only:

- SECRET_NAME
- SYSTEM
- RECOVERY_METHOD
- ROTATION_REQUIRED
- BACKUP_LOCATION_CLASS

Never include secret values in Git, incident tickets, screenshots, or recovery evidence.

Systems to cover:

- Railway;
- Supabase API keys;
- service/secret keys;
- publishable/anon keys;
- WhatsApp/webhook secrets;
- third-party provider credentials;
- GitHub Actions secrets;
- custom domains/DNS where applicable.

Secret rotation is a separate controlled operation.

---

# 9. Restore drill gate

A restore drill must run only in an isolated environment.

Minimum validation:

- critical row counts;
- organization_members;
- propcontrol_records;
- private.commercial_operations;
- RLS enabled;
- exact critical policies;
- grants;
- SECURITY DEFINER state;
- search_path;
- sequences;
- Auth mapping;
- Storage references;
- tenant isolation;
- critical RPCs;
- CAS;
- revision conflicts;
- operationId replay;
- Owner;
- Administrator;
- Agent;
- active cross-tenant attack attempt.

## Measured outputs

The drill must record:

- backup timestamp;
- restore start;
- DB ready;
- Storage ready;
- security validation ready;
- final ready-to-cutover time.

Only after a successful drill may RPO/RTO be promoted from provisional to approved.

---

# 10. Runbook finalization gate

This draft cannot become the final runbook until:

1. production project is confirmed;
2. P0A.1 actual-vs-intended matrix is complete;
3. backup capability is verified;
4. isolated FULL_DISASTER drill succeeds;
5. SINGLE_TENANT drill succeeds;
6. DB ↔ Storage reconciliation succeeds;
7. CAS/idempotency drill succeeds;
8. measured RPO/RTO are accepted;
9. secret/config recovery sources are confirmed;
10. CEREBRO approves the final procedure.

Until then:

`RUNBOOK_STATUS=DRAFT_ONLY`
