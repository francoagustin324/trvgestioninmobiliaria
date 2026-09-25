import assert from 'node:assert/strict';
import test from 'node:test';
import type { TenantScope } from '../active-organization.js';
import { initialData, type ActivityEntry, type Client, type CrmData, type Property } from '../models.js';
import {
  buildPropertyDiffusionMessage,
  latestPropertyDiffusion,
  propertyDiffusionContact,
  propertyDiffusionHistory,
  recordPropertyDiffusionResponse,
  recordPropertyDiffusionSent,
} from '../property-diffusion.js';
import { state } from '../store.js';
import { readTenantSnapshot } from '../tenant-storage.js';
import { captureTenantRuntimeLease, installTenantRuntimeScope, invalidateTenantRuntimeScope } from '../tenant-runtime.js';

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>();
  failWrites = false;
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { if (this.failWrites) throw new Error('storage down'); this.values.set(key, value); }
}

function fixture(scope: TenantScope): CrmData {
  const crm = structuredClone(initialData);
  crm.organization.id = scope.organizationId;
  crm.organization.name = 'Inmobiliaria Test';
  crm.teamMembers = [{
    id: 1, userId: scope.userId, name: 'Corredor Test', email: 'test@example.test', role: 'Dueño', status: 'Activo', createdAt: '2026-09-25T10:00:00.000Z',
  }];
  crm.clients = [{
    id: 11, uid: '11111111-1111-4111-8111-111111111111', name: 'Comprador Test', phone: '351 555 0101', email: 'comprador@example.test',
    interest: 'Departamento General Paz', status: 'Lead', temperature: 'Tibio', pipeline: 'Calificado', nextAction: '', nextFollowUp: '',
    budget: 'USD 120.000', propertyType: 'Departamento', zones: 'General Paz', assignedToId: 1, createdById: 1,
  }];
  crm.properties = [{
    id: 21, uid: '22222222-2222-4222-8222-222222222222', title: 'Departamento General Paz', address: 'General Paz, Córdoba',
    type: 'Departamento', operation: 'Venta', price: 100000, owner: 'Propietario privado', status: 'Activa', bedrooms: 2,
    notes: 'NOTA INTERNA SECRETA', sourceLink: 'https://interno.example/propiedad', assignedToId: 1, createdById: 1,
  }];
  crm.activityLog = [];
  crm.visits = []; crm.offers = []; crm.reservations = []; crm.contacts = []; crm.reminders = []; crm.fichas = []; crm.conversations = [];
  return crm;
}

function install(scope: TenantScope, storage: MemoryStorage): void {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  state.crm = fixture(scope);
  state.activeMemberId = 1;
  installTenantRuntimeScope(scope, scope.userId);
}

test('2C: el mensaje usa sólo datos comerciales permitidos y reutiliza el texto de ficha pública', () => {
  const property = fixture({ userId: 'u', organizationId: 'org-a' }).properties[0]!;
  const message = buildPropertyDiffusionMessage(property, { organizationId: 'org-a', name: 'Inmobiliaria Test', commercialPhone: '', logoPath: '', legalText: '' }, 'https://public.example/ficha/abc');
  assert.match(message, /Te comparto esta propiedad de Inmobiliaria Test: Departamento General Paz/);
  assert.match(message, /General Paz, Córdoba/);
  assert.match(message, /USD 100\.000/);
  assert.match(message, /2 dormitorios/);
  assert.match(message, /https:\/\/public\.example\/ficha\/abc/);
  assert.doesNotMatch(message, /Propietario privado/);
  assert.doesNotMatch(message, /NOTA INTERNA SECRETA/);
  assert.doesNotMatch(message, /interno\.example/);
});

test('2C: WhatsApp sólo existe con teléfono válido y email-only conserva mailto', () => {
  const base: Client = fixture({ userId: 'u', organizationId: 'org-a' }).clients[0]!;
  const valid = propertyDiffusionContact(base, 'Mensaje', 'Propiedad');
  assert.match(valid.whatsappUrl || '', /^https:\/\/wa\.me\/549/);
  assert.match(valid.emailUrl || '', /^mailto:comprador@example\.test/);
  const emailOnly = propertyDiffusionContact({ ...base, phone: '', email: 'solo@email.test' }, 'Mensaje', 'Propiedad');
  assert.equal(emailOnly.whatsappUrl, null);
  assert.match(emailOnly.emailUrl || '', /^mailto:solo@email\.test/);
  const invalid = propertyDiffusionContact({ ...base, phone: 'abc', email: '' }, 'Mensaje', 'Propiedad');
  assert.equal(invalid.whatsappUrl, null);
  assert.equal(invalid.emailUrl, null);
});

test('2C: historial estructurado advierte reenvíos y distingue respuesta', () => {
  const crm = fixture({ userId: 'u', organizationId: 'org-a' });
  const property = crm.properties[0]!;
  const client = crm.clients[0]!;
  const sent: ActivityEntry = {
    id: 1, actorId: 1, action: 'Propiedad difundida', entityType: 'Cliente', entityId: client.id, detail: '', createdAt: '2026-09-25T12:00:00.000Z',
    metadata: { kind: 'property_diffusion', event: 'sent', attemptId: 'a1', propertyId: property.id, propertyUid: property.uid, clientId: client.id, clientUid: client.uid, channel: 'WhatsApp', status: 'ENVIADO', sentAt: '2026-09-25T12:00:00.000Z' },
  };
  const responded: ActivityEntry = {
    id: 2, actorId: 1, action: 'Respuesta a propiedad difundida', entityType: 'Cliente', entityId: client.id, detail: '', createdAt: '2026-09-25T13:00:00.000Z',
    metadata: { ...sent.metadata!, event: 'responded', status: 'RESPONDIO', respondedAt: '2026-09-25T13:00:00.000Z' },
  };
  assert.equal(propertyDiffusionHistory([responded, sent], property, client).length, 2);
  const latest = latestPropertyDiffusion([responded, sent], property, client)!;
  assert.equal(latest.attemptId, 'a1');
  assert.equal(latest.status, 'RESPONDIO');
  assert.equal(latest.channel, 'WhatsApp');
});

test('2C: marcar enviado persiste actor/par/fecha/canal; abrir/preparar no es parte de esta mutación', () => {
  const scope: TenantScope = { userId: 'block2c-user', organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
  const storage = new MemoryStorage();
  install(scope, storage);
  try {
    const lease = captureTenantRuntimeLease(scope);
    const clientBefore = structuredClone(state.crm.clients[0]!);
    const sent = recordPropertyDiffusionSent({ scope, runtimeLease: lease, propertyId: 21, clientId: 11, channel: 'WhatsApp' }, new Date('2026-09-25T15:00:00.000Z'));
    assert.equal(sent.actorId, 1);
    assert.equal(sent.metadata?.propertyId, 21);
    assert.equal(sent.metadata?.clientId, 11);
    assert.equal(sent.metadata?.channel, 'WhatsApp');
    assert.equal(sent.metadata?.status, 'ENVIADO');
    assert.equal(sent.metadata?.sentAt, '2026-09-25T15:00:00.000Z');
    const persisted = readTenantSnapshot(scope, storage)!;
    assert.ok(persisted.activityLog.some((entry) => entry.metadata?.attemptId === sent.metadata?.attemptId));
    assert.equal(state.crm.clients[0]!.pipeline, clientBefore.pipeline);
    assert.equal(state.crm.clients[0]!.nextAction, clientBefore.nextAction);
    assert.equal(state.crm.clients[0]!.nextFollowUp, clientBefore.nextFollowUp);

    const response = recordPropertyDiffusionResponse({ scope, runtimeLease: lease, propertyId: 21, clientId: 11, channel: 'WhatsApp', attemptId: sent.metadata!.attemptId }, new Date('2026-09-25T16:00:00.000Z'));
    assert.equal(response.metadata?.status, 'RESPONDIO');
    assert.equal(state.crm.clients[0]!.pipeline, clientBefore.pipeline);
    assert.equal(state.crm.clients[0]!.nextAction, clientBefore.nextAction);
    assert.equal(state.crm.clients[0]!.nextFollowUp, clientBefore.nextFollowUp);

    const resend = recordPropertyDiffusionSent({ scope, runtimeLease: lease, propertyId: 21, clientId: 11, channel: 'Email' }, new Date('2026-09-25T17:00:00.000Z'));
    assert.notEqual(resend.metadata?.attemptId, sent.metadata?.attemptId);
    assert.equal(propertyDiffusionHistory(state.crm.activityLog, state.crm.properties[0]!, state.crm.clients[0]!).filter((entry) => entry.metadata?.event === 'sent').length, 2);
  } finally { invalidateTenantRuntimeScope(); }
});

test('2C: tenant B no ve historial de A y un lease A obsoleto falla cerrado', () => {
  const scopeA: TenantScope = { userId: 'user-a', organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
  const scopeB: TenantScope = { userId: 'user-b', organizationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' };
  const storage = new MemoryStorage();
  install(scopeA, storage);
  const leaseA = captureTenantRuntimeLease(scopeA);
  const sentA = recordPropertyDiffusionSent(
    { scope: scopeA, runtimeLease: leaseA, propertyId: 21, clientId: 11, channel: 'WhatsApp' },
    new Date('2026-09-25T15:30:00.000Z'),
  );
  assert.equal(readTenantSnapshot(scopeA, storage)?.activityLog.some((entry) => entry.metadata?.attemptId === sentA.metadata?.attemptId), true);

  state.crm = fixture(scopeB);
  installTenantRuntimeScope(scopeB, scopeB.userId);
  try {
    assert.equal(
      latestPropertyDiffusion(state.crm.activityLog, state.crm.properties[0]!, state.crm.clients[0]!),
      null,
      'el historial tenant A no puede aparecer al cambiar a tenant B',
    );
    assert.equal(readTenantSnapshot(scopeB, storage), null, 'la difusión A no puede crear un snapshot B');
    assert.throws(() => recordPropertyDiffusionSent({ scope: scopeA, runtimeLease: leaseA, propertyId: 21, clientId: 11, channel: 'WhatsApp' }), /TENANT_RUNTIME_STALE/);
    assert.equal(state.crm.organization.id, scopeB.organizationId);
    assert.equal(state.crm.activityLog.length, 0);
  } finally { invalidateTenantRuntimeScope(); }
});

test('2C: error de persistencia revierte el estado en memoria y no deja difusión falsa', () => {
  const scope: TenantScope = { userId: 'block2c-user', organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
  const storage = new MemoryStorage();
  install(scope, storage);
  const lease = captureTenantRuntimeLease(scope);
  storage.failWrites = true;
  try {
    assert.throws(() => recordPropertyDiffusionSent({ scope, runtimeLease: lease, propertyId: 21, clientId: 11, channel: 'WhatsApp' }), /storage down/);
    assert.equal(state.crm.activityLog.length, 0);
    assert.equal(latestPropertyDiffusion(state.crm.activityLog, state.crm.properties[0]!, state.crm.clients[0]!), null);
  } finally { invalidateTenantRuntimeScope(); }
});
