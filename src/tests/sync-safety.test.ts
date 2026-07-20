import assert from 'node:assert/strict';
import test from 'node:test';
import { initialData, STORAGE_KEY } from '../models.js';
import {
  activateAccountStorage,
  assertRemoteIsSafe,
  getSyncState,
  hasLocalBackup,
  markCloudHydrated,
  readLocalSnapshot,
  restoreLatestBackup,
  scopedStorageKey,
  stableFingerprint,
  syncStatusLabel,
  writeLocalSnapshot,
} from '../sync-safety.js';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number { return this.values.size; }

  clear(): void { this.values.clear(); }

  getItem(key: string): string | null { return this.values.get(key) ?? null; }

  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }

  removeItem(key: string): void { this.values.delete(key); }

  setItem(key: string, value: string): void { this.values.set(key, value); }
}

function signedStorage(userId = 'franco-user'): MemoryStorage {
  const storage = new MemoryStorage();
  storage.setItem('propcontrol-cloud-session-v1', JSON.stringify({ userId }));
  return storage;
}

test('separa la base local por cuenta sin heredar la base pre-login', () => {
  const storage = signedStorage();
  storage.setItem(STORAGE_KEY, JSON.stringify(initialData));

  const key = activateAccountStorage(storage);

  assert.equal(key, `${STORAGE_KEY}:user:franco-user`);
  assert.equal(scopedStorageKey(storage), key);
  // La cuenta nueva NO hereda los datos de la clave base pre-login...
  assert.equal(readLocalSnapshot(storage), null);
  // ...ni queda marcada como pendiente de subir (no se empuja nada a la nube).
  assert.equal(getSyncState(storage).dirty, false);
  // La clave base se conserva intacta (no se borra).
  assert.ok(storage.getItem(STORAGE_KEY));
});

test('los datos de una cuenta no se filtran a otra en el mismo navegador', () => {
  // El usuario A deja datos en la clave base del navegador (uso sin iniciar sesión).
  const storage = new MemoryStorage();
  const datosDeA = structuredClone(initialData);
  datosDeA.clients[0]!.name = 'Cliente privado de A';
  storage.setItem(STORAGE_KEY, JSON.stringify(datosDeA));

  // El usuario B (otra inmobiliaria) inicia sesión en el mismo navegador.
  storage.setItem('propcontrol-cloud-session-v1', JSON.stringify({ userId: 'usuario-b' }));
  activateAccountStorage(storage);

  // B arranca vacío (bajará SUS datos de la nube), nunca ve los de A...
  assert.equal(readLocalSnapshot(storage), null);
  // ...y no queda nada marcado para subir a la organización de B.
  assert.equal(getSyncState(storage).dirty, false);
});

test('crea copias locales rotativas y recupera la versión anterior', () => {
  const storage = signedStorage();
  const first = structuredClone(initialData);
  const second = structuredClone(initialData);
  second.clients[0]!.name = 'Nombre modificado';

  writeLocalSnapshot(first, { markDirty: false }, storage);
  writeLocalSnapshot(second, { reason: 'Editar lead' }, storage);

  assert.equal(hasLocalBackup(storage), true);
  const restored = restoreLatestBackup(storage);
  assert.equal(restored?.clients[0]?.name, first.clients[0]?.name);
  assert.equal(readLocalSnapshot(storage)?.clients[0]?.name, first.clients[0]?.name);
  assert.equal(getSyncState(storage).dirty, true);
});

test('bloquea un guardado cuando la nube cambió después de la última sincronización', () => {
  const storage = signedStorage();
  const crm = structuredClone(initialData);
  writeLocalSnapshot(crm, { markDirty: false }, storage);
  markCloudHydrated('2026-07-14T10:00:00.000Z', storage);
  crm.clients[0]!.budget = 'USD 100.000';
  writeLocalSnapshot(crm, { reason: 'Actualizar presupuesto' }, storage);

  assert.throws(
    () => assertRemoteIsSafe('2026-07-14T10:05:00.000Z', undefined, undefined, storage),
    /frenó el guardado/,
  );
});

test('en la primera migración permite datos iguales y frena bases diferentes', () => {
  const storage = signedStorage();
  const crm = structuredClone(initialData);
  writeLocalSnapshot(crm, { reason: 'Migración inicial' }, storage);
  const fingerprint = stableFingerprint(crm);

  assert.doesNotThrow(() => assertRemoteIsSafe('2026-07-14T10:00:00.000Z', fingerprint, fingerprint, storage));
  assert.throws(
    () => assertRemoteIsSafe('2026-07-14T10:00:00.000Z', fingerprint, stableFingerprint({ distinto: true }), storage),
    /datos distintos/,
  );
});

test('informa claramente cuando existen cambios pendientes', () => {
  const storage = signedStorage();
  writeLocalSnapshot(structuredClone(initialData), { reason: 'Nuevo lead' }, storage);
  assert.equal(syncStatusLabel(getSyncState(storage)), 'Cambios pendientes');
});
