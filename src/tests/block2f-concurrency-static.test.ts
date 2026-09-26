import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const store = readFileSync('src/store.ts', 'utf8');
const api = readFileSync('src/cloud-api-compatible.ts', 'utf8');
const writer = readFileSync('src/tenant-visit-v2.ts', 'utf8');
const records = readFileSync('src/cloud-records.ts', 'utf8');
const transition = readFileSync('src/commercial-sync-transition.ts', 'utf8');
const models = readFileSync('src/models.ts', 'utf8');
const migration = readFileSync('supabase/migrations/20260926224500_block2f_property_snapshot_cas.sql', 'utf8');
const baseline = readFileSync('src/tenant-concurrency-baseline.ts', 'utf8');
const propertyCas = readFileSync('src/tenant-property-cas.ts', 'utf8');

test('2F writer map conserva cola/lease y deriva a deltas con CAS por registro', () => {
  assert.match(store, /saveData[\s\S]*writeTenantSnapshot[\s\S]*queueCloudSave/);
  assert.match(api, /createCloudSaveJob[\s\S]*LatestSerialQueue/);
  assert.match(api, /resolveTenantVisitAuthority[\s\S]*pushCloudDataWithVisitAuthorityV2/);
  assert.match(writer, /fetchCloudRecords[\s\S]*readTenantConcurrencyBaseline/);
  assert.match(writer, /reconcileClientsWithCas[\s\S]*reconcilePropertiesWithCas/);
  assert.match(writer, /expectedRevision:\s*clientRevision\(base\.payload\)/);
  assert.match(writer, /expectedRevision:\s*propertyRevision\(base\.payload\)/);
  assert.match(writer, /writeTenantConcurrencyBaseline\(scope, crmSyncRecords\(refreshed\)\)/);
  assert.match(writer, /markTenantCloudSaved\(scope, latestRemoteVersion\(crmSyncRecords\(refreshed\)\), token\)/);
  assert.match(baseline, /:concurrency-baseline:v1/);
  assert.match(baseline, /organizationId:\s*scope\.organizationId/);
});

test('2F matriz: Client/Property/Visit protegidos; entidades restantes continúan snapshot o append-only explícito', () => {
  assert.match(writer, /client_snapshot_cas_v2/);
  assert.match(writer, /invokePropertySnapshotCasV1/);
  assert.match(writer, /genericWritable[\s\S]*row\.entity_type === 'client' \|\| row\.entity_type === 'property'/);
  assert.match(transition, /transactionOwnedEntityTypes:\s*new Set<TransactionalCommercialEntityType>\(\['visit'\]\)/);
  assert.match(writer, /isVisitOwnedActivity[\s\S]*return false/);

  for (const entity of ['offer', 'reservation', 'reminder', 'conversation']) {
    assert.match(records, new RegExp(`row\\(org, '${entity === 'conversation' ? 'conversation' : entity}'`));
  }
  assert.match(models, /propertyDiffusions\?: PropertyDiffusionLedgerRecord\[\]/);
  assert.match(writer, /genericDelta\(/);
  assert.doesNotMatch(writer, /CRDT|Redis|WebSocket/i);
});

test('2F Property CAS y UX de conflicto son atómicos, tenant-scoped y fail-closed', () => {
  assert.match(migration, /create or replace function public\.property_snapshot_cas_v1\(/i);
  assert.match(migration, /security invoker/i);
  assert.match(migration, /set search_path = ''/i);
  assert.doesNotMatch(migration, /security definer/i);
  assert.match(migration, /member\.organization_id = target_org[\s\S]*member\.user_id = current_user_id[\s\S]*member\.status = 'active'/);
  assert.match(migration, /for update/gi);
  assert.match(migration, /current_record\.revision <> expected_revision[\s\S]*STALE_REVISION/);
  assert.match(migration, /revision = current_record\.revision \+ 1/);
  assert.match(migration, /exception when unique_violation[\s\S]*STALE_REVISION/);
  assert.match(migration, /revoke all on function public\.property_snapshot_cas_v1[\s\S]*grant execute[\s\S]*authenticated/);
  assert.match(propertyCas, /TENANT_RECORD_CONFLICT/);
  assert.match(api, /Este registro cambió en otro dispositivo\. Tus cambios no sobrescribieron la versión más reciente\./);
  assert.match(api, /markTenantSyncError\(job\.scope, message\)/);
});
