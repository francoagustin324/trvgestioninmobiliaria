import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { initialData, STORAGE_KEY } from '../models.js';
import {
  hasTenantLocalBackup,
  inspectTenantLegacyMigration,
  markTenantCloudSaved,
  migrateLegacyStorageToTenant,
  readTenantBackups,
  readTenantSnapshot,
  readTenantSyncState,
  tenantHasPendingLocalChanges,
  tenantStorageNamespace,
  tenantSyncSaveToken,
  writeTenantSnapshot,
} from '../tenant-storage.js';
import type { TenantScope } from '../active-organization.js';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number { return this.values.size; }

  clear(): void { this.values.clear(); }

  getItem(key: string): string | null { return this.values.get(key) ?? null; }

  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }

  removeItem(key: string): void { this.values.delete(key); }

  setItem(key: string, value: string): void { this.values.set(key, value); }
}

const scopeA: TenantScope = Object.freeze({ userId: 'user-1', organizationId: 'org-a' });
const scopeB: TenantScope = Object.freeze({ userId: 'user-1', organizationId: 'org-b' });

function crmFor(organizationId: string, clientName = organizationId) {
  const crm = structuredClone(initialData);
  crm.organization.id = organizationId;
  crm.organization.name = `Inmobiliaria ${organizationId}`;
  crm.clients[0]!.id = 77;
  crm.clients[0]!.name = clientName;
  return crm;
}

function userLegacyKey(userId = 'user-1'): string {
  return `${STORAGE_KEY}:user:${userId}`;
}

test('A1.2-B: mismo user / Org A y Org B generan namespaces distintos', () => {
  const a = tenantStorageNamespace(scopeA);
  const b = tenantStorageNamespace(scopeB);

  assert.equal(a.crmKey, `${STORAGE_KEY}:user:user-1:org:org-a`);
  assert.equal(a.syncKey, `${STORAGE_KEY}:user:user-1:org:org-a:sync`);
  assert.equal(a.backupsKey, `${STORAGE_KEY}:user:user-1:org:org-a:backups`);
  assert.notEqual(a.crmKey, b.crmKey);
  assert.notEqual(a.syncKey, b.syncKey);
  assert.notEqual(a.backupsKey, b.backupsKey);
});

test('A1.2-B: snapshot de A nunca es visible al leer B', () => {
  const storage = new MemoryStorage();
  writeTenantSnapshot(scopeA, crmFor('org-a', 'Cliente A'), { markDirty: false }, storage);

  assert.equal(readTenantSnapshot(scopeA, storage)?.clients[0]?.name, 'Cliente A');
  assert.equal(readTenantSnapshot(scopeB, storage), null);
});

test('A1.2-B: sync state y dirty de A nunca afectan B', () => {
  const storage = new MemoryStorage();
  writeTenantSnapshot(scopeA, crmFor('org-a'), { reason: 'Cambio A' }, storage);

  assert.equal(tenantHasPendingLocalChanges(scopeA, storage), true);
  assert.equal(readTenantSyncState(scopeA, storage).dirty, true);
  assert.equal(tenantHasPendingLocalChanges(scopeB, storage), false);
  assert.equal(readTenantSyncState(scopeB, storage).dirty, false);
});

test('A1.2-B: generation queda aislada por tenant', () => {
  const storage = new MemoryStorage();
  const a = crmFor('org-a');
  const b = crmFor('org-b');

  writeTenantSnapshot(scopeA, a, { reason: 'A1' }, storage);
  a.clients[0]!.notes = 'A2';
  writeTenantSnapshot(scopeA, a, { reason: 'A2' }, storage);
  writeTenantSnapshot(scopeB, b, { reason: 'B1' }, storage);

  assert.equal(readTenantSyncState(scopeA, storage).localGeneration, 2);
  assert.equal(readTenantSyncState(scopeB, storage).localGeneration, 1);
});

test('A1.2-B: fingerprint y cloud-saved de A no limpian B', () => {
  const storage = new MemoryStorage();
  const a = crmFor('org-a', 'A');
  const b = crmFor('org-b', 'B');

  writeTenantSnapshot(scopeA, a, { reason: 'A' }, storage);
  const tokenA = tenantSyncSaveToken(scopeA, a, storage);
  writeTenantSnapshot(scopeB, b, { reason: 'B' }, storage);

  assert.notEqual(
    readTenantSyncState(scopeA, storage).localFingerprint,
    readTenantSyncState(scopeB, storage).localFingerprint,
  );
  assert.equal(markTenantCloudSaved(scopeA, '2026-09-08T00:00:00.000Z', tokenA, storage), true);
  assert.equal(readTenantSyncState(scopeA, storage).dirty, false);
  assert.equal(readTenantSyncState(scopeB, storage).dirty, true);
});

test('A1.2-B: backup de A no aparece en B', () => {
  const storage = new MemoryStorage();
  const first = crmFor('org-a', 'Primero');
  const second = crmFor('org-a', 'Segundo');

  writeTenantSnapshot(scopeA, first, { markDirty: false }, storage);
  writeTenantSnapshot(scopeA, second, { reason: 'Editar A' }, storage);

  assert.equal(hasTenantLocalBackup(scopeA, storage), true);
  assert.equal(readTenantBackups(scopeA, storage).length, 1);
  assert.equal(hasTenantLocalBackup(scopeB, storage), false);
  assert.equal(readTenantBackups(scopeB, storage).length, 0);
});

test('A1.2-B: mismo clientId legacy en A/B sigue completamente separado', () => {
  const storage = new MemoryStorage();
  writeTenantSnapshot(scopeA, crmFor('org-a', 'ID 77 A'), { markDirty: false }, storage);
  writeTenantSnapshot(scopeB, crmFor('org-b', 'ID 77 B'), { markDirty: false }, storage);

  assert.equal(readTenantSnapshot(scopeA, storage)?.clients[0]?.id, 77);
  assert.equal(readTenantSnapshot(scopeB, storage)?.clients[0]?.id, 77);
  assert.equal(readTenantSnapshot(scopeA, storage)?.clients[0]?.name, 'ID 77 A');
  assert.equal(readTenantSnapshot(scopeB, storage)?.clients[0]?.name, 'ID 77 B');
});

test('A1.2-B: usuario distinto también queda aislado aunque la org tenga mismo id', () => {
  const storage = new MemoryStorage();
  const otherUser: TenantScope = Object.freeze({ userId: 'user-2', organizationId: 'org-a' });
  writeTenantSnapshot(scopeA, crmFor('org-a', 'User 1'), { markDirty: false }, storage);
  writeTenantSnapshot(otherUser, crmFor('org-a', 'User 2'), { markDirty: false }, storage);

  assert.notEqual(tenantStorageNamespace(scopeA).crmKey, tenantStorageNamespace(otherUser).crmKey);
  assert.equal(readTenantSnapshot(scopeA, storage)?.clients[0]?.name, 'User 1');
  assert.equal(readTenantSnapshot(otherUser, storage)?.clients[0]?.name, 'User 2');
});

test('A1.2-B: namespace captura copia inmutable del scope', () => {
  const mutable = { userId: 'user-1', organizationId: 'org-a' };
  const namespace = tenantStorageNamespace(mutable);
  mutable.organizationId = 'org-b';

  assert.equal(Object.isFrozen(namespace), true);
  assert.equal(Object.isFrozen(namespace.scope), true);
  assert.equal(namespace.scope.organizationId, 'org-a');
  assert.equal(namespace.crmKey, `${STORAGE_KEY}:user:user-1:org:org-a`);
});

test('A1.2-B migration: sin legacy devuelve NO_LEGACY y no escribe target', () => {
  const storage = new MemoryStorage();
  const result = inspectTenantLegacyMigration(scopeA, storage);
  assert.equal(result.classification, 'NO_LEGACY');
  assert.equal(result.outcome, 'NO_LEGACY');
  assert.equal(storage.getItem(tenantStorageNamespace(scopeA).crmKey), null);
});

test('A1.2-B migration: legacy org A + scope A clasifica EXACT_ORG_MATCH', () => {
  const storage = new MemoryStorage();
  storage.setItem(userLegacyKey(), JSON.stringify(crmFor('org-a')));

  const result = inspectTenantLegacyMigration(scopeA, storage);
  assert.equal(result.classification, 'EXACT_ORG_MATCH');
  assert.equal(result.outcome, 'EXACT_ORG_MATCH');
  assert.equal(result.rawOrganizationId, 'org-a');
  assert.equal(result.source, 'user');
});

test('A1.2-B migration: legacy org A + scope B exige RECOVERY_REQUIRED', () => {
  const storage = new MemoryStorage();
  storage.setItem(userLegacyKey(), JSON.stringify(crmFor('org-a')));

  const result = inspectTenantLegacyMigration(scopeB, storage);
  assert.equal(result.classification, 'ORG_MISMATCH');
  assert.equal(result.outcome, 'RECOVERY_REQUIRED');
  assert.equal(storage.getItem(tenantStorageNamespace(scopeB).crmKey), null);
});

test('A1.2-B migration: legacy sin organization.id no adivina tenant', () => {
  const storage = new MemoryStorage();
  const raw = JSON.stringify({ ...structuredClone(initialData), organization: { name: 'Sin id' } });
  storage.setItem(userLegacyKey(), raw);

  const result = inspectTenantLegacyMigration(scopeA, storage);
  assert.equal(result.classification, 'RECOVERY_REQUIRED');
  assert.equal(result.outcome, 'RECOVERY_REQUIRED');
  assert.equal(result.rawOrganizationId, null);
  assert.equal(storage.getItem(tenantStorageNamespace(scopeA).crmKey), null);
});

test('A1.2-B migration: target existente nunca se sobrescribe', () => {
  const storage = new MemoryStorage();
  const namespace = tenantStorageNamespace(scopeA);
  const targetRaw = JSON.stringify(crmFor('org-a', 'TARGET EXISTENTE'));
  storage.setItem(namespace.crmKey, targetRaw);
  storage.setItem(userLegacyKey(), JSON.stringify(crmFor('org-a', 'LEGACY')));

  const result = migrateLegacyStorageToTenant(scopeA, storage);
  assert.equal(result.classification, 'TARGET_ALREADY_EXISTS');
  assert.equal(result.outcome, 'TARGET_ALREADY_EXISTS');
  assert.equal(result.copied, false);
  assert.equal(storage.getItem(namespace.crmKey), targetRaw);
});

test('A1.2-B migration: dos legacy sources distintos son AMBIGUOUS_LEGACY', () => {
  const storage = new MemoryStorage();
  storage.setItem(STORAGE_KEY, JSON.stringify(crmFor('org-a', 'BASE')));
  storage.setItem(userLegacyKey(), JSON.stringify(crmFor('org-a', 'USER')));

  const result = inspectTenantLegacyMigration(scopeA, storage);
  assert.equal(result.classification, 'AMBIGUOUS_LEGACY');
  assert.equal(result.outcome, 'RECOVERY_REQUIRED');
  assert.equal(storage.getItem(tenantStorageNamespace(scopeA).crmKey), null);
});

test('A1.2-B migration: sources legacy byte-equivalentes son deterministas', () => {
  const storage = new MemoryStorage();
  const raw = JSON.stringify(crmFor('org-a'));
  const syncRaw = JSON.stringify({ dirty: true, localGeneration: 3 });
  const backupsRaw = JSON.stringify([]);
  storage.setItem(STORAGE_KEY, raw);
  storage.setItem(`${STORAGE_KEY}:sync`, syncRaw);
  storage.setItem(`${STORAGE_KEY}:backups`, backupsRaw);
  storage.setItem(userLegacyKey(), raw);
  storage.setItem(`${userLegacyKey()}:sync`, syncRaw);
  storage.setItem(`${userLegacyKey()}:backups`, backupsRaw);

  const result = inspectTenantLegacyMigration(scopeA, storage);
  assert.equal(result.classification, 'EXACT_ORG_MATCH');
  assert.equal(result.source, 'user');
});

test('A1.2-B migration: copy exacta preserva CRM, sync, backups y source legacy', () => {
  const storage = new MemoryStorage();
  const sourceKey = userLegacyKey();
  const snapshotRaw = JSON.stringify(crmFor('org-a', 'LEGACY EXACTO'));
  const syncRaw = JSON.stringify({
    dirty: true,
    localGeneration: 7,
    localFingerprint: 'fingerprint-legacy',
    verifiedGeneration: 2,
  });
  const backupsRaw = JSON.stringify([{ createdAt: '2026-09-01T00:00:00.000Z', reason: 'Legacy', crm: crmFor('org-a') }]);
  storage.setItem(sourceKey, snapshotRaw);
  storage.setItem(`${sourceKey}:sync`, syncRaw);
  storage.setItem(`${sourceKey}:backups`, backupsRaw);

  const result = migrateLegacyStorageToTenant(scopeA, storage);
  const target = tenantStorageNamespace(scopeA);

  assert.equal(result.classification, 'EXACT_ORG_MATCH');
  assert.equal(result.outcome, 'EXACT_ORG_MATCH');
  assert.equal(result.copied, true);
  assert.equal(storage.getItem(target.crmKey), snapshotRaw);
  assert.equal(storage.getItem(target.syncKey), syncRaw);
  assert.equal(storage.getItem(target.backupsKey), backupsRaw);
  assert.equal(storage.getItem(sourceKey), snapshotRaw);
  assert.equal(storage.getItem(`${sourceKey}:sync`), syncRaw);
  assert.equal(storage.getItem(`${sourceKey}:backups`), backupsRaw);
});

test('A1.2-B migration: repetición es idempotente y no toca source', () => {
  const storage = new MemoryStorage();
  const sourceKey = userLegacyKey();
  const raw = JSON.stringify(crmFor('org-a'));
  storage.setItem(sourceKey, raw);

  const first = migrateLegacyStorageToTenant(scopeA, storage);
  const targetBefore = storage.getItem(tenantStorageNamespace(scopeA).crmKey);
  const second = migrateLegacyStorageToTenant(scopeA, storage);

  assert.equal(first.copied, true);
  assert.equal(second.classification, 'TARGET_ALREADY_EXISTS');
  assert.equal(second.copied, false);
  assert.equal(storage.getItem(tenantStorageNamespace(scopeA).crmKey), targetBefore);
  assert.equal(storage.getItem(sourceKey), raw);
});

test('A1.2-B migration: organization.id RAW debe coincidir exactamente antes de copiar', () => {
  const storage = new MemoryStorage();
  const raw = JSON.stringify(crmFor(' org-a '));
  storage.setItem(userLegacyKey(), raw);

  const result = migrateLegacyStorageToTenant(scopeA, storage);
  assert.equal(result.classification, 'ORG_MISMATCH');
  assert.equal(result.outcome, 'RECOVERY_REQUIRED');
  assert.equal(result.rawOrganizationId, ' org-a ');
  assert.equal(storage.getItem(tenantStorageNamespace(scopeA).crmKey), null);
  assert.equal(storage.getItem(userLegacyKey()), raw);
});

test('A1.2-B static guard: migration no normaliza ni reescribe organization.id', () => {
  const source = readFileSync('src/tenant-storage.ts', 'utf8');
  const migrationStart = source.indexOf('export function inspectTenantLegacyMigration');
  assert.ok(migrationStart >= 0);
  const migrationSurface = source.slice(migrationStart);

  assert.equal(/prepareCrmSyncContracts/.test(migrationSurface), false);
  assert.equal(/organization\.id\s*=/.test(migrationSurface), false);
  assert.match(migrationSurface, /rawOrganizationId\(snapshotRaw\)/);
});

test('A1.2-B static guard: migración no corre automáticamente al importar módulo', () => {
  const source = readFileSync('src/tenant-storage.ts', 'utf8');
  assert.equal((source.match(/migrateLegacyStorageToTenant\s*\(/g) ?? []).length, 1);
});

test('A1.2-B static guard: tenant operations delegan al motor sync-safety existente', () => {
  const source = readFileSync('src/tenant-storage.ts', 'utf8');
  assert.match(source, /from '\.\/sync-safety\.js'/);
  assert.match(source, /return readLocalSnapshot\(tenantView\(scope, storage\)\)/);
  assert.match(source, /writeLocalSnapshot\(crm, options, tenantView\(scope, storage\)\)/);
  assert.match(source, /return getSyncState\(tenantView\(scope, storage\)\)/);
  assert.equal(/localGeneration\s*:\s*\(/.test(source), false);
});

test('A1.2-B static guard: runtime canónico todavía no consume tenant storage', () => {
  const runtimeFiles = [
    'src/mvp-main.ts',
    'src/mvp-auth.ts',
    'src/cloud-api-compatible.ts',
    'src/visit-workflow-cutover.ts',
    'src/sync-recovery-bootstrap.ts',
  ];
  runtimeFiles.forEach((path) => {
    const source = readFileSync(path, 'utf8');
    assert.equal(source.includes('tenant-storage'), false, `${path} no debe hacer cutover A1.2-B`);
  });
});
