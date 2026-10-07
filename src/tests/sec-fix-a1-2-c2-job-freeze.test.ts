import assert from 'node:assert/strict';
import test from 'node:test';
import './sec-fix-a1-2-c2-test-setup.js';
import { createCloudSaveJob } from '../cloud-api-compatible.js';
import { initialData } from '../models.js';
import { installTenantRuntimeScope, invalidateTenantRuntimeScope } from '../tenant-runtime.js';
import { writeTenantSnapshot } from '../tenant-storage.js';

const scope = Object.freeze({
  userId: 'user-freeze',
  organizationId: '00000000-0000-0000-0000-0000000000f1',
});

test('C2 CloudSaveJob congela profundamente snapshot/CRM además de scope, token y lease', () => {
  invalidateTenantRuntimeScope();
  installTenantRuntimeScope(scope, scope.userId);

  const crm = structuredClone(initialData);
  crm.organization.id = scope.organizationId;
  crm.organization.name = 'Freeze Test';
  crm.clients[0]!.name = 'Cliente original';
  writeTenantSnapshot(scope, crm, { markDirty: true, reason: 'freeze-test' });

  const job = createCloudSaveJob(scope, crm, false);
  crm.organization.name = 'Mutación externa';
  crm.clients[0]!.name = 'Mutación externa';

  assert.equal(job.snapshot.organization.name, 'Freeze Test');
  assert.equal(job.snapshot.clients[0]?.name, 'Cliente original');
  assert.equal(Object.isFrozen(job), true);
  assert.equal(Object.isFrozen(job.scope), true);
  assert.equal(Object.isFrozen(job.token), true);
  assert.equal(Object.isFrozen(job.runtimeLease), true);
  assert.equal(Object.isFrozen(job.snapshot), true);
  assert.equal(Object.isFrozen(job.snapshot.organization), true);
  assert.equal(Object.isFrozen(job.snapshot.clients), true);
  assert.equal(Object.isFrozen(job.snapshot.clients[0]), true);
});
