import assert from 'node:assert/strict';
import test from 'node:test';
import type { ActivityEntry, Client, CrmData, Property } from '../models.js';
import { initialData } from '../models.js';
import {
  latestPropertyDiffusionResponse,
  latestPropertyDiffusionSent,
  propertyDiffusionSendCount,
  propertyDiffusionStatus,
} from '../property-diffusion.js';
import { clientFromFormValues } from '../client-editor.js';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(String(key), String(value)); }
}

function installMemoryStorage(): MemoryStorage {
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: storage,
  });
  return storage;
}

function property(overrides: Partial<Property> = {}): Property {
  return {
    id: 101,
    uid: '11111111-1111-4111-8111-111111111111',
    title: 'Dúplex Docta',
    address: 'Docta Urbanización, Córdoba',
    type: 'Dúplex',
    operation: 'Venta',
    price: 120000,
    owner: 'Propietario Test',
    status: 'Activa',
    bedrooms: 2,
    assignedToId: 10,
    createdById: 10,
    ...overrides,
  };
}

function client(overrides: Partial<Client> = {}): Client {
  return {
    id: 201,
    uid: '22222222-2222-4222-8222-222222222222',
    name: 'Comprador Test',
    phone: '5493515550101',
    email: 'comprador@example.test',
    interest: 'Dúplex en Docta',
    status: 'Lead',
    temperature: 'Tibio',
    pipeline: 'Calificado',
    budget: 'USD 130.000',
    propertyType: 'Dúplex',
    zones: 'Docta',
    bedrooms: 2,
    assignedToId: 10,
    createdById: 10,
    ...overrides,
  };
}

function tenantCrm(organizationId: string, userId: string, label = 'A'): CrmData {
  const crm = structuredClone(initialData);
  crm.organization = { ...crm.organization, id: organizationId, name: `Inmobiliaria ${label}` };
  crm.teamMembers = [{
    id: 10,
    userId,
    name: `Corredor ${label}`,
    email: `${label.toLowerCase()}@example.test`,
    role: 'Corredor',
    status: 'Activo',
    createdAt: '2026-09-25T12:00:00.000Z',
  }];
  crm.clients = [client({ name: `Cliente ${label}` })];
  crm.properties = [property({ title: `Propiedad ${label}` })];
  crm.activityLog = [];
  crm.visits = [];
  crm.offers = [];
  crm.reservations = [];
  crm.contacts = [];
  crm.reminders = [];
  crm.fichas = [];
  crm.conversations = [];
  return crm;
}

async function harness(label: string) {
  const storage = installMemoryStorage();
  const store = await import('../store.js');
  const runtime = await import('../tenant-runtime.js');
  const diffusionStore = await import('../property-diffusion-store.js');
  const teamAccess = await import('../team-access.js');
  const tenantStorage = await import('../tenant-storage.js');
  runtime.invalidateTenantRuntimeScope();
  const scope = {
    userId: `block2c1-user-${label.toLowerCase()}`,
    organizationId: `org-block2c1-${label.toLowerCase()}`,
  };
  runtime.installTenantRuntimeScope(scope, scope.userId);
  store.state.crm = tenantCrm(scope.organizationId, scope.userId, label);
  store.state.activeMemberId = 10;
  const runtimeLease = runtime.captureTenantRuntimeLease(scope);
  return {
    storage,
    store,
    runtime,
    diffusionStore,
    teamAccess,
    tenantStorage,
    scope,
    runtimeLease,
    property: store.state.crm.properties[0]!,
    client: store.state.crm.clients[0]!,
  };
}

function addNoiseActivities(
  teamAccess: Awaited<ReturnType<typeof harness>>['teamAccess'],
  scope: Awaited<ReturnType<typeof harness>>['scope'],
  count: number,
): void {
  for (let index = 0; index < count; index += 1) {
    teamAccess.addActivityForAuthenticatedTenant(scope, {
      action: `Actividad posterior ${index + 1}`,
      entityType: 'Cliente',
      entityId: 201,
      detail: 'Actividad no relacionada con difusión',
    });
  }
}

test('2C.1 crítico: la difusión sigue durable después de más de 250 actividades generales', async () => {
  const h = await harness('ROTATE');
  const sentEntry = h.diffusionStore.recordPropertyDiffusionEvent({
    scope: h.scope,
    runtimeLease: h.runtimeLease,
    property: h.property,
    client: h.client,
    channel: 'WhatsApp',
    status: 'ENVIADO',
  }, () => {});
  const sentAt = sentEntry.createdAt;

  addNoiseActivities(h.teamAccess, h.scope, 251);

  assert.equal(h.store.state.crm.activityLog.length, 250);
  assert.equal(h.store.state.crm.activityLog.some((entry: ActivityEntry) => entry.uid === sentEntry.uid), false);
  const currentClient = h.store.state.crm.clients[0]!;
  const durable = latestPropertyDiffusionSent(currentClient, h.property);
  assert.ok(durable);
  assert.equal(durable.createdAt, sentAt);
  assert.equal(durable.diffusionChannel, 'WhatsApp');
  assert.equal(propertyDiffusionStatus(currentClient, h.property), 'ENVIADO');
  assert.equal(propertyDiffusionSendCount(currentClient, h.property), 1);
});

test('2C.1 permite registrar RESPONDIO aunque el ActivityEntry del envío ya haya rotado', async () => {
  const h = await harness('RESPONSE');
  h.diffusionStore.recordPropertyDiffusionEvent({
    scope: h.scope,
    runtimeLease: h.runtimeLease,
    property: h.property,
    client: h.client,
    channel: 'WhatsApp',
    status: 'ENVIADO',
  }, () => {});
  addNoiseActivities(h.teamAccess, h.scope, 251);

  const responseEntry = h.diffusionStore.recordPropertyDiffusionEvent({
    scope: h.scope,
    runtimeLease: h.runtimeLease,
    property: h.property,
    client: h.client,
    channel: 'WhatsApp',
    status: 'RESPONDIO',
  }, () => {});

  const currentClient = h.store.state.crm.clients[0]!;
  const response = latestPropertyDiffusionResponse(currentClient, h.property);
  assert.ok(response);
  assert.equal(response.createdAt, responseEntry.createdAt);
  assert.equal(response.diffusionChannel, 'WhatsApp');
  assert.equal(propertyDiffusionStatus(currentClient, h.property), 'RESPONDIO');
});

test('2C.1 conserva reenvíos después de la rotación y vuelve a ENVIADO hasta nueva respuesta', async () => {
  const h = await harness('RESEND');
  h.diffusionStore.recordPropertyDiffusionEvent({
    scope: h.scope,
    runtimeLease: h.runtimeLease,
    property: h.property,
    client: h.client,
    channel: 'WhatsApp',
    status: 'ENVIADO',
  }, () => {});
  h.diffusionStore.recordPropertyDiffusionEvent({
    scope: h.scope,
    runtimeLease: h.runtimeLease,
    property: h.property,
    client: h.client,
    channel: 'WhatsApp',
    status: 'RESPONDIO',
  }, () => {});
  addNoiseActivities(h.teamAccess, h.scope, 251);

  const resend = h.diffusionStore.recordPropertyDiffusionEvent({
    scope: h.scope,
    runtimeLease: h.runtimeLease,
    property: h.property,
    client: h.client,
    channel: 'Email',
    status: 'ENVIADO',
  }, () => {});

  const currentClient = h.store.state.crm.clients[0]!;
  const sent = latestPropertyDiffusionSent(currentClient, h.property);
  assert.ok(sent);
  assert.equal(sent.createdAt, resend.createdAt);
  assert.equal(sent.diffusionChannel, 'Email');
  assert.equal(propertyDiffusionSendCount(currentClient, h.property), 2);
  assert.equal(propertyDiffusionStatus(currentClient, h.property), 'ENVIADO');
});

test('2C.1 ledger sobrevive guardar, rotar activityLog y recargar el tenant', async () => {
  const h = await harness('RELOAD');
  const persistSnapshot = (): void => {
    h.tenantStorage.writeTenantSnapshot(h.scope, h.store.state.crm, {
      markDirty: true,
      reason: 'TEST_2C1',
      backup: false,
    });
  };
  h.diffusionStore.recordPropertyDiffusionEvent({
    scope: h.scope,
    runtimeLease: h.runtimeLease,
    property: h.property,
    client: h.client,
    channel: 'WhatsApp',
    status: 'ENVIADO',
  }, persistSnapshot);
  addNoiseActivities(h.teamAccess, h.scope, 251);
  persistSnapshot();

  h.store.state.crm = tenantCrm(h.scope.organizationId, h.scope.userId, 'RESET');
  h.store.activateStorageForTenant(h.scope);

  const reloadedClient = h.store.state.crm.clients[0]!;
  const reloadedProperty = h.store.state.crm.properties[0]!;
  assert.equal(h.store.state.crm.activityLog.some((entry: ActivityEntry) => entry.activityKind === 'property-diffusion'), false);
  assert.equal(propertyDiffusionStatus(reloadedClient, reloadedProperty), 'ENVIADO');
  assert.equal(propertyDiffusionSendCount(reloadedClient, reloadedProperty), 1);
});

test('2C.1 ledger viaja dentro del registro client en cloud sync y vuelve en hidratación', async () => {
  const h = await harness('SYNC');
  h.diffusionStore.recordPropertyDiffusionEvent({
    scope: h.scope,
    runtimeLease: h.runtimeLease,
    property: h.property,
    client: h.client,
    channel: 'Email',
    status: 'ENVIADO',
  }, () => {});

  const cloudRecords = await import('../cloud-records.js');
  const context = {
    organizationId: h.scope.organizationId,
    currentMemberId: 10,
    currentRole: 'Corredor' as const,
    members: structuredClone(h.store.state.crm.teamMembers),
  };
  const rows = cloudRecords.crmToCloudRecords(h.store.state.crm, context, h.scope.userId);
  const clientRow = rows.find((row) => row.entity_type === 'client');
  assert.ok(clientRow);
  assert.equal(Array.isArray((clientRow.payload as Client).propertyDiffusions), true);

  const hydrated = cloudRecords.cloudRecordsToCrm(
    rows,
    context,
    tenantCrm(h.scope.organizationId, h.scope.userId, 'FALLBACK'),
  );
  assert.equal(propertyDiffusionStatus(hydrated.clients[0]!, hydrated.properties[0]!), 'ENVIADO');
  assert.equal(propertyDiffusionSendCount(hydrated.clients[0]!, hydrated.properties[0]!), 1);
});

test('2C.1 snapshots mantienen aislado el ledger entre tenant A y tenant B', async () => {
  const h = await harness('TENANTS');
  h.diffusionStore.recordPropertyDiffusionEvent({
    scope: h.scope,
    runtimeLease: h.runtimeLease,
    property: h.property,
    client: h.client,
    channel: 'WhatsApp',
    status: 'ENVIADO',
  }, () => {});
  h.tenantStorage.writeTenantSnapshot(h.scope, h.store.state.crm, { backup: false }, h.storage);

  const scopeB = { userId: 'block2c1-user-b', organizationId: 'org-block2c1-b' };
  const crmB = tenantCrm(scopeB.organizationId, scopeB.userId, 'B');
  h.tenantStorage.writeTenantSnapshot(scopeB, crmB, { backup: false }, h.storage);

  h.runtime.installTenantRuntimeScope(h.scope, h.scope.userId);
  h.store.activateStorageForTenant(h.scope);
  assert.equal(propertyDiffusionStatus(h.store.state.crm.clients[0]!, h.store.state.crm.properties[0]!), 'ENVIADO');

  h.runtime.installTenantRuntimeScope(scopeB, scopeB.userId);
  h.store.activateStorageForTenant(scopeB);
  assert.equal(propertyDiffusionStatus(h.store.state.crm.clients[0]!, h.store.state.crm.properties[0]!), 'PENDIENTE');
  assert.equal(h.store.state.crm.clients[0]!.propertyDiffusions, undefined);
});

test('2C.1 fallo de persistencia revierte ledger y activityLog como una sola operación', async () => {
  const h = await harness('ROLLBACK');
  const before = structuredClone(h.store.state.crm);
  assert.throws(() => h.diffusionStore.recordPropertyDiffusionEvent({
    scope: h.scope,
    runtimeLease: h.runtimeLease,
    property: h.property,
    client: h.client,
    channel: 'WhatsApp',
    status: 'ENVIADO',
  }, () => {
    throw new Error('BLOCK2C1_PERSISTENCE_FAILURE');
  }), /BLOCK2C1_PERSISTENCE_FAILURE/);

  assert.deepEqual(h.store.state.crm.activityLog, before.activityLog);
  assert.deepEqual(h.store.state.crm.clients[0]!.propertyDiffusions, before.clients[0]!.propertyDiffusions);
  assert.equal(propertyDiffusionStatus(h.store.state.crm.clients[0]!, h.store.state.crm.properties[0]!), 'PENDIENTE');
});

test('2C.1 tenant stale falla cerrado antes de crear ledger o actividad', async () => {
  const h = await harness('STALE');
  const before = structuredClone(h.store.state.crm);
  h.runtime.installTenantRuntimeScope(
    { userId: 'otro-user', organizationId: 'otra-org' },
    'otro-user',
  );

  assert.throws(() => h.diffusionStore.recordPropertyDiffusionEvent({
    scope: h.scope,
    runtimeLease: h.runtimeLease,
    property: h.property,
    client: h.client,
    channel: 'WhatsApp',
    status: 'ENVIADO',
  }, () => {}), /TENANT_RUNTIME_STALE/);
  assert.deepEqual(h.store.state.crm.activityLog, before.activityLog);
  assert.deepEqual(h.store.state.crm.clients[0]!.propertyDiffusions, before.clients[0]!.propertyDiffusions);
});

test('2C.1 datos legacy sólo en activityLog hidratan ledger una vez y no duplican al recargar', async () => {
  const h = await harness('LEGACY');
  const legacy = tenantCrm(h.scope.organizationId, h.scope.userId, 'LEGACY');
  legacy.activityLog = [{
    id: 1,
    uid: '33333333-3333-4333-8333-333333333333',
    actorId: 10,
    action: 'Propiedad enviada',
    entityType: 'Cliente',
    entityId: 201,
    entityUid: legacy.clients[0]!.uid,
    detail: 'Propiedad LEGACY · WhatsApp',
    createdAt: '2026-09-25T15:00:00.000Z',
    activityKind: 'property-diffusion',
    diffusionPropertyId: 101,
    diffusionPropertyUid: legacy.properties[0]!.uid,
    diffusionClientId: 201,
    diffusionClientUid: legacy.clients[0]!.uid,
    diffusionChannel: 'WhatsApp',
    diffusionStatus: 'ENVIADO',
  }];
  h.tenantStorage.writeTenantSnapshot(h.scope, legacy, { backup: false }, h.storage);

  h.store.activateStorageForTenant(h.scope);
  assert.equal(propertyDiffusionSendCount(h.store.state.crm.clients[0]!, h.store.state.crm.properties[0]!), 1);
  assert.equal(propertyDiffusionStatus(h.store.state.crm.clients[0]!, h.store.state.crm.properties[0]!), 'ENVIADO');

  h.tenantStorage.writeTenantSnapshot(h.scope, h.store.state.crm, { backup: false }, h.storage);
  h.store.activateStorageForTenant(h.scope);
  assert.equal(propertyDiffusionSendCount(h.store.state.crm.clients[0]!, h.store.state.crm.properties[0]!), 1);
});

test('2C.1 migración legacy conserva respuesta, canal y actor sin inventar registros inválidos', async () => {
  const h = await harness('LEGACYRESP');
  const legacy = tenantCrm(h.scope.organizationId, h.scope.userId, 'LEGACYRESP');
  legacy.activityLog = [
    {
      id: 3,
      actorId: 10,
      action: 'Actividad dañada',
      entityType: 'Cliente',
      entityId: 201,
      detail: 'No debe convertirse en ledger',
      createdAt: '2026-09-25T17:00:00.000Z',
      activityKind: 'property-diffusion',
      diffusionPropertyId: 999,
      diffusionClientId: 999,
      diffusionChannel: 'WhatsApp',
      diffusionStatus: 'ENVIADO',
    },
    {
      id: 2,
      actorId: 10,
      action: 'Cliente respondió a la propiedad',
      entityType: 'Cliente',
      entityId: 201,
      detail: 'Respuesta',
      createdAt: '2026-09-25T16:00:00.000Z',
      activityKind: 'property-diffusion',
      diffusionPropertyId: 101,
      diffusionPropertyUid: legacy.properties[0]!.uid,
      diffusionClientId: 201,
      diffusionClientUid: legacy.clients[0]!.uid,
      diffusionChannel: 'Email',
      diffusionStatus: 'RESPONDIO',
    },
    {
      id: 1,
      actorId: 10,
      action: 'Propiedad enviada',
      entityType: 'Cliente',
      entityId: 201,
      detail: 'Envío',
      createdAt: '2026-09-25T15:00:00.000Z',
      activityKind: 'property-diffusion',
      diffusionPropertyId: 101,
      diffusionPropertyUid: legacy.properties[0]!.uid,
      diffusionClientId: 201,
      diffusionClientUid: legacy.clients[0]!.uid,
      diffusionChannel: 'WhatsApp',
      diffusionStatus: 'ENVIADO',
    },
  ];
  h.tenantStorage.writeTenantSnapshot(h.scope, legacy, { backup: false }, h.storage);

  h.store.activateStorageForTenant(h.scope);
  const currentClient = h.store.state.crm.clients[0]!;
  const currentProperty = h.store.state.crm.properties[0]!;
  const response = latestPropertyDiffusionResponse(currentClient, currentProperty);
  assert.ok(response);
  assert.equal(response.createdAt, '2026-09-25T16:00:00.000Z');
  assert.equal(response.diffusionChannel, 'Email');
  assert.equal(response.actorId, 10);
  assert.equal(propertyDiffusionStatus(currentClient, currentProperty), 'RESPONDIO');
  assert.equal(currentClient.propertyDiffusions?.length, 1);
});

test('2C.1 editar un Lead conserva el ledger interno durable', async () => {
  const h = await harness('EDIT');
  h.diffusionStore.recordPropertyDiffusionEvent({
    scope: h.scope,
    runtimeLease: h.runtimeLease,
    property: h.property,
    client: h.client,
    channel: 'WhatsApp',
    status: 'ENVIADO',
  }, () => {});
  const current = h.store.state.crm.clients[0]!;
  const ledgerBefore = structuredClone(current.propertyDiffusions);
  const edited = clientFromFormValues(current.id, {
    name: 'Cliente Editado',
    phone: current.phone,
    email: current.email ?? '',
    interest: current.interest,
    temperature: current.temperature,
    pipeline: String(current.pipeline),
  }, current);
  assert.deepEqual(edited.propertyDiffusions, ledgerBefore);
});
