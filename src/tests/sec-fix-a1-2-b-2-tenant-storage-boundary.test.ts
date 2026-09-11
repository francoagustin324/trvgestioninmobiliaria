import assert from 'node:assert/strict';
import test from 'node:test';
import { initialData, STORAGE_KEY } from '../models.js';
import {
  markTenantDirty,
  readTenantBackups,
  readTenantSnapshot,
  readTenantSyncState,
  tenantStorageNamespace,
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

const scopeA: TenantScope = Object.freeze({ userId: 'user-a', organizationId: 'org-a' });
const scopeB: TenantScope = Object.freeze({ userId: 'user-a', organizationId: 'org-b' });

function crmFor(organizationId: string, name = organizationId) {
  const crm = structuredClone(initialData);
  crm.organization.id = organizationId;
  crm.organization.name = name;
  return crm;
}

function backupRaw(organizationId: string, reason = 'Backup'): string {
  return JSON.stringify([
    {
      createdAt: '2026-09-08T00:00:00.000Z',
      reason,
      crm: crmFor(organizationId),
    },
  ]);
}

function snapshotRaw(storage: Storage, scope: TenantScope): string | null {
  return storage.getItem(tenantStorageNamespace(scope).crmKey);
}

function syncRaw(storage: Storage, scope: TenantScope): string | null {
  return storage.getItem(tenantStorageNamespace(scope).syncKey);
}

function backupsRaw(storage: Storage, scope: TenantScope): string | null {
  return storage.getItem(tenantStorageNamespace(scope).backupsKey);
}

test('A1.2-B.2 C3: organizationId con espacios falla cerrado antes de storage', () => {
  const storage = new MemoryStorage();
  const invalid: TenantScope = Object.freeze({ userId: 'user-a', organizationId: ' org-a ' });

  assert.throws(
    () => readTenantSnapshot(invalid, storage),
    /TENANT_SCOPE_IDENTIFIER_NOT_CANONICAL/,
  );
  assert.equal(storage.length, 0);
});

test('A1.2-B.2 C3: userId con espacios falla cerrado antes de storage', () => {
  const storage = new MemoryStorage();
  const invalid: TenantScope = Object.freeze({ userId: ' user-a ', organizationId: 'org-a' });

  assert.throws(
    () => writeTenantSnapshot(invalid, crmFor('org-a'), {}, storage),
    /TENANT_SCOPE_IDENTIFIER_NOT_CANONICAL/,
  );
  assert.equal(storage.length, 0);
});

test('A1.2-B.2 C3: scope canónico conserva key exacta y copia inmutable', () => {
  const mutable = { userId: 'user-a', organizationId: 'org-a' };
  const namespace = tenantStorageNamespace(mutable);
  mutable.organizationId = 'org-b';

  assert.equal(namespace.crmKey, `${STORAGE_KEY}:user:user-a:org:org-a`);
  assert.equal(namespace.syncKey, `${STORAGE_KEY}:user:user-a:org:org-a:sync`);
  assert.equal(namespace.backupsKey, `${STORAGE_KEY}:user:user-a:org:org-a:backups`);
  assert.equal(Object.isFrozen(namespace), true);
  assert.equal(Object.isFrozen(namespace.scope), true);
  assert.equal(namespace.scope.organizationId, 'org-a');
});

test('A1.2-B.2 C2: snapshot A accidental bajo key B bloquea write B sin mutación', () => {
  const storage = new MemoryStorage();
  const namespace = tenantStorageNamespace(scopeB);
  const unsafeRaw = JSON.stringify(crmFor('org-a', 'CRM A accidental'));
  storage.setItem(namespace.crmKey, unsafeRaw);
  const syncBefore = syncRaw(storage, scopeB);
  const backupsBefore = backupsRaw(storage, scopeB);

  assert.throws(
    () => writeTenantSnapshot(scopeB, crmFor('org-b', 'CRM B nuevo'), { reason: 'Reemplazo B' }, storage),
    /TENANT_EXISTING_SNAPSHOT_UNSAFE/,
  );

  assert.equal(snapshotRaw(storage, scopeB), unsafeRaw);
  assert.equal(syncRaw(storage, scopeB), syncBefore);
  assert.equal(backupsRaw(storage, scopeB), backupsBefore);
});

test('A1.2-B.2 C2: snapshot A accidental bajo key B bloquea markDirty B sin mutación', () => {
  const storage = new MemoryStorage();
  const namespace = tenantStorageNamespace(scopeB);
  const unsafeRaw = JSON.stringify(crmFor('org-a', 'CRM A accidental'));
  storage.setItem(namespace.crmKey, unsafeRaw);

  assert.throws(
    () => markTenantDirty(scopeB, crmFor('org-b', 'CRM B'), 'Dirty B', storage),
    /TENANT_EXISTING_SNAPSHOT_UNSAFE/,
  );

  assert.equal(snapshotRaw(storage, scopeB), unsafeRaw);
  assert.equal(syncRaw(storage, scopeB), null);
  assert.equal(backupsRaw(storage, scopeB), null);
  assert.equal(readTenantSyncState(scopeB, storage).dirty, false);
});

test('A1.2-B.2 C2: snapshot previo B válido conserva comportamiento histórico de write + backup', () => {
  const storage = new MemoryStorage();
  writeTenantSnapshot(scopeB, crmFor('org-b', 'Anterior B'), { markDirty: false }, storage);
  writeTenantSnapshot(scopeB, crmFor('org-b', 'Nuevo B'), { reason: 'Editar B' }, storage);

  assert.equal(readTenantSnapshot(scopeB, storage)?.organization.name, 'Nuevo B');
  assert.equal(readTenantSyncState(scopeB, storage).dirty, true);
  const backups = readTenantBackups(scopeB, storage);
  assert.equal(backups.length, 1);
  assert.equal(backups[0]?.crm.organization.id, 'org-b');
  assert.equal(backups[0]?.crm.organization.name, 'Anterior B');
});

test('A1.2-B.2 C1: backups B con sólo CRM B pasan lectura estricta', () => {
  const storage = new MemoryStorage();
  const namespace = tenantStorageNamespace(scopeB);
  const raw = backupRaw('org-b');
  storage.setItem(namespace.backupsKey, raw);

  const backups = readTenantBackups(scopeB, storage);
  assert.equal(backups.length, 1);
  assert.equal(backups[0]?.crm.organization.id, 'org-b');
  assert.equal(storage.getItem(namespace.backupsKey), raw);
});

test('A1.2-B.2 C1: un CRM A dentro de backups B invalida el conjunto completo', () => {
  const storage = new MemoryStorage();
  const namespace = tenantStorageNamespace(scopeB);
  const raw = JSON.stringify([
    { createdAt: '2026-09-08T00:00:00.000Z', reason: 'B', crm: crmFor('org-b') },
    { createdAt: '2026-09-08T00:01:00.000Z', reason: 'A', crm: crmFor('org-a') },
  ]);
  storage.setItem(namespace.backupsKey, raw);

  assert.throws(() => readTenantBackups(scopeB, storage), /TENANT_BACKUP_SET_UNSAFE/);
  assert.equal(storage.getItem(namespace.backupsKey), raw);
});

test('A1.2-B.2 C1: backup sin organization.id falla cerrado y preserva raw', () => {
  const storage = new MemoryStorage();
  const namespace = tenantStorageNamespace(scopeB);
  const crm = crmFor('org-b') as unknown as { organization: Record<string, unknown> };
  delete crm.organization.id;
  const raw = JSON.stringify([
    { createdAt: '2026-09-08T00:00:00.000Z', reason: 'Sin org', crm },
  ]);
  storage.setItem(namespace.backupsKey, raw);

  assert.throws(() => readTenantBackups(scopeB, storage), /TENANT_BACKUP_SET_UNSAFE/);
  assert.equal(storage.getItem(namespace.backupsKey), raw);
});

test('A1.2-B.2 C1: backup malformed falla cerrado y no se filtra silenciosamente', () => {
  const storage = new MemoryStorage();
  const namespace = tenantStorageNamespace(scopeB);
  const raw = JSON.stringify([
    { createdAt: '2026-09-08T00:00:00.000Z', crm: crmFor('org-b') },
  ]);
  storage.setItem(namespace.backupsKey, raw);

  assert.throws(() => readTenantBackups(scopeB, storage), /TENANT_BACKUP_SET_UNSAFE/);
  assert.equal(storage.getItem(namespace.backupsKey), raw);
});

test('A1.2-B.2 C1: CRM incompleto dentro de backup falla cerrado', () => {
  const storage = new MemoryStorage();
  const namespace = tenantStorageNamespace(scopeB);
  const raw = JSON.stringify([
    {
      createdAt: '2026-09-08T00:00:00.000Z',
      reason: 'CRM incompleto',
      crm: { organization: { id: 'org-b' } },
    },
  ]);
  storage.setItem(namespace.backupsKey, raw);

  assert.throws(() => readTenantBackups(scopeB, storage), /TENANT_BACKUP_SET_UNSAFE/);
  assert.equal(storage.getItem(namespace.backupsKey), raw);
});

test('A1.2-B.2 C1: JSON backups inválido falla cerrado y preserva raw exacto', () => {
  const storage = new MemoryStorage();
  const namespace = tenantStorageNamespace(scopeB);
  const raw = '{invalid-json';
  storage.setItem(namespace.backupsKey, raw);

  assert.throws(() => readTenantBackups(scopeB, storage), /TENANT_BACKUP_SET_UNSAFE/);
  assert.equal(storage.getItem(namespace.backupsKey), raw);
});
