import './sec-fix-a1-2-c2-test-setup.js';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { initialData } from '../models.js';
import type { CrmData, TeamMember, TeamRole } from '../models.js';
import type { TenantScope } from '../active-organization.js';
import {
  authenticatedTenantMember,
  setActiveMemberId,
  state,
} from '../store.js';
import { addActivityForAuthenticatedTenant } from '../team-access.js';
import {
  assertTenantRuntimeLeaseCurrent,
  captureTenantRuntimeLease,
  installTenantRuntimeScope,
  invalidateTenantRuntimeScope,
} from '../tenant-runtime.js';
import {
  readTenantSnapshot,
  tenantStorageNamespace,
  writeTenantSnapshot,
} from '../tenant-storage.js';
import { registerOffer, resolveOffer } from '../offer-workflow.js';
import { registerReservation, updateReservationStatus } from '../reservation-workflow.js';
import {
  isLeadQualificationOpen,
  requestLeadQualification,
  resetLeadQualificationForTests,
} from '../lead-qualification-ui.js';
import {
  assertCurrentWhatsAppHumanIdentity,
  configureCurrentWhatsAppHumanIdentity,
} from '../whatsapp-human-identity.js';

const TEAM_VIEW_KEY = 'propcontrol-active-team-member-v1';
const AUTH_USER = 'user-a3-2-shared';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

function member(id: number, role: TeamRole, userId: string, name: string): TeamMember {
  return {
    id,
    userId,
    name,
    email: `${name.toLowerCase().replace(/\s+/g, '.')}@example.test`,
    role,
    status: 'Activo',
    createdAt: '2026-09-11T12:00:00.000Z',
  };
}

function crmFor(
  scope: TenantScope,
  authenticated: TeamMember,
  visual: TeamMember,
  entityId = 77,
): CrmData {
  const crm = structuredClone(initialData);
  crm.organization = { id: scope.organizationId, name: `Org ${scope.organizationId}`, seatLimit: 10, planLabel: 'Test' };
  crm.settings.agencyName = `Agencia ${scope.organizationId}`;
  crm.teamMembers = [authenticated, visual];
  crm.activityLog = [];
  crm.clients = [{
    id: entityId,
    name: `Lead ${scope.organizationId}`,
    phone: '3515550000',
    interest: 'Compra',
    status: 'Activo',
    temperature: 'Tibio',
    pipeline: 'Nuevo',
    assignedToId: authenticated.id,
    createdById: authenticated.id,
  }];
  crm.properties = [{
    id: entityId,
    title: `Propiedad ${scope.organizationId}`,
    address: 'Test 123',
    type: 'Departamento',
    operation: 'Venta',
    price: 100000,
    owner: 'Propietario',
    status: 'Activa',
    assignedToId: authenticated.id,
    createdById: authenticated.id,
  }];
  crm.offers = [];
  crm.reservations = [];
  crm.reminders = [];
  crm.contacts = [];
  crm.conversations = [];
  return crm;
}

function install(
  organizationId: string,
  authenticatedId: number,
  authenticatedRole: TeamRole,
  visualId: number,
  visualRole: TeamRole,
  entityId = 77,
): { scope: TenantScope; authenticated: TeamMember; visual: TeamMember; crm: CrmData } {
  const scope = Object.freeze({ userId: AUTH_USER, organizationId });
  const authenticated = member(authenticatedId, authenticatedRole, AUTH_USER, `Auth ${authenticatedRole} ${organizationId}`);
  const visual = member(visualId, visualRole, `visual-${organizationId}-${visualId}`, `Visual ${visualRole} ${organizationId}`);
  installTenantRuntimeScope(scope, AUTH_USER);
  const crm = crmFor(scope, authenticated, visual, entityId);
  state.crm = crm;
  state.activeMemberId = authenticated.id;
  setActiveMemberId(visual.id);
  return { scope, authenticated, visual, crm };
}

function authActor(scope: TenantScope): { id: number; role: TeamRole } {
  const resolved = authenticatedTenantMember(scope);
  assert.ok(resolved, 'Debe existir exactamente un miembro autenticado para el TenantScope.');
  return { id: resolved.id, role: resolved.role };
}

function offerInput(entityId: number, now = new Date('2026-09-11T15:00:00.000Z')) {
  return {
    clientId: entityId,
    propertyId: entityId,
    origin: 'Cliente' as const,
    amount: 95000,
    currency: 'USD' as const,
    nextAction: 'Revisar oferta',
    nextFollowUp: '2026-09-12',
    now,
  };
}

afterEach(() => {
  resetLeadQualificationForTests();
  invalidateTenantRuntimeScope();
  localStorage.clear();
});

test('A3.2: TEAM_VIEW_KEY y activeMemberId no sustituyen al owner autenticado como write actor', () => {
  const { scope, authenticated, visual } = install('org-owner', 101, 'Dueño', 102, 'Corredor');
  assert.equal(state.activeMemberId, visual.id);
  assert.equal(localStorage.getItem(TEAM_VIEW_KEY), String(visual.id));
  assert.equal(authenticatedTenantMember(scope)?.id, authenticated.id);
  assert.equal(authenticatedTenantMember(scope)?.role, 'Dueño');

  addActivityForAuthenticatedTenant(scope, {
    action: 'A3.2 owner write',
    entityType: 'Cliente',
    entityId: 77,
    detail: 'tampering visual no cambia actor',
  });
  assert.equal(state.crm.activityLog[0]?.actorId, authenticated.id);
  assert.notEqual(state.crm.activityLog[0]?.actorId, visual.id);
});

test('A3.2: agent autenticado mirando owner/admin no adquiere identidad ni privilegios elevados', () => {
  const { scope, authenticated, visual } = install('org-agent', 201, 'Corredor', 202, 'Dueño');
  assert.equal(state.activeMemberId, visual.id);
  const actor = authActor(scope);
  assert.deepEqual(actor, { id: authenticated.id, role: 'Corredor' });

  const created = registerOffer(state.crm, actor, offerInput(77));
  assert.equal(created.offer.createdById, authenticated.id);
  assert.equal(created.offer.assignedToId, authenticated.id);
  assert.equal(created.crm.activityLog[0]?.actorId, authenticated.id);

  const foreign = structuredClone(state.crm);
  foreign.clients[0]!.assignedToId = visual.id;
  foreign.properties[0]!.assignedToId = visual.id;
  assert.throws(
    () => registerOffer(foreign, actor, offerInput(77)),
    /No tenés permiso/,
    'La vista Dueño no debe elevar al Corredor autenticado.',
  );
});

test('A3.2: Offers create/accept/reject conservan actor autenticado bajo tampering visual', () => {
  const { scope, authenticated } = install('org-offers', 301, 'Corredor', 302, 'Dueño');
  const actor = authActor(scope);
  const first = registerOffer(state.crm, actor, offerInput(77));
  assert.equal(first.offer.createdById, authenticated.id);
  assert.equal(first.crm.activityLog[0]?.actorId, authenticated.id);

  const accepted = resolveOffer(first.crm, actor, {
    offerId: first.offer.id,
    status: 'Aceptada',
    nextAction: 'Preparar reserva',
    nextFollowUp: '2026-09-13',
    now: new Date('2026-09-11T16:00:00.000Z'),
  });
  assert.equal(accepted.offer.status, 'Aceptada');
  assert.equal(accepted.crm.activityLog[0]?.actorId, authenticated.id);

  const second = registerOffer(state.crm, actor, offerInput(77, new Date('2026-09-11T17:00:00.000Z')));
  const rejected = resolveOffer(second.crm, actor, {
    offerId: second.offer.id,
    status: 'Rechazada',
    nextAction: 'Buscar alternativa',
    nextFollowUp: '2026-09-14',
    now: new Date('2026-09-11T18:00:00.000Z'),
  });
  assert.equal(rejected.offer.status, 'Rechazada');
  assert.equal(rejected.crm.activityLog[0]?.actorId, authenticated.id);
});

test('A3.2: Reservations reserve/cancel usan actor autenticado, no identidad visual', () => {
  const { scope, authenticated } = install('org-reservations', 401, 'Corredor', 402, 'Administrador');
  const actor = authActor(scope);
  const reserved = registerReservation(state.crm, actor, {
    clientId: 77,
    propertyId: 77,
    amount: 5000,
    currency: 'USD',
    reservedAt: '2026-09-11',
    expiresAt: '2026-09-20',
    now: new Date('2026-09-11T15:00:00.000Z'),
  });
  assert.equal(reserved.reservation.createdById, authenticated.id);
  assert.equal(reserved.reservation.assignedToId, authenticated.id);
  assert.equal(reserved.crm.activityLog[0]?.actorId, authenticated.id);

  const cancelled = updateReservationStatus(reserved.crm, actor, {
    reservationId: reserved.reservation.id,
    status: 'Cancelada',
    now: new Date('2026-09-12T15:00:00.000Z'),
  });
  assert.equal(cancelled.reservation.status, 'Cancelada');
  assert.equal(cancelled.crm.activityLog[0]?.actorId, authenticated.id);
});

test('A3.2: mismo usuario y mismo legacy entity id quedan aislados entre Org A/B por scope, actor y storage', () => {
  const storage = new MemoryStorage();
  const a = install('org-A', 501, 'Dueño', 502, 'Corredor', 42);
  const leaseA = captureTenantRuntimeLease(a.scope);
  const crmA = structuredClone(state.crm);
  writeTenantSnapshot(a.scope, crmA, { markDirty: true, backup: false }, storage);
  const keyA = tenantStorageNamespace(a.scope).crmKey;
  const rawA = storage.getItem(keyA);
  assert.ok(rawA);
  assert.equal(authenticatedTenantMember(a.scope)?.id, 501);

  const b = install('org-B', 601, 'Administrador', 602, 'Corredor', 42);
  const crmB = structuredClone(state.crm);
  writeTenantSnapshot(b.scope, crmB, { markDirty: true, backup: false }, storage);
  const keyB = tenantStorageNamespace(b.scope).crmKey;
  const rawBBefore = storage.getItem(keyB);
  assert.ok(rawBBefore);
  assert.notEqual(keyA, keyB);
  assert.equal(authenticatedTenantMember(b.scope)?.id, 601);
  assert.equal(readTenantSnapshot(a.scope, storage)?.organization.id, 'org-A');
  assert.equal(readTenantSnapshot(b.scope, storage)?.organization.id, 'org-B');
  assert.equal(readTenantSnapshot(a.scope, storage)?.clients[0]?.id, 42);
  assert.equal(readTenantSnapshot(b.scope, storage)?.clients[0]?.id, 42);

  crmA.clients[0]!.notes = 'solo A';
  writeTenantSnapshot(a.scope, crmA, { markDirty: true, backup: false }, storage);
  assert.equal(storage.getItem(keyB), rawBBefore, 'Persistir A debe dejar B byte-identical.');
  assert.equal(readTenantSnapshot(b.scope, storage)?.clients[0]?.notes, undefined);
  assert.throws(() => assertTenantRuntimeLeaseCurrent(leaseA), /TENANT_RUNTIME_STALE/);
});

test('A3.2: Qualification session usa userId + organizationId + clientId y no colisiona entre A/B', () => {
  const previousDocument = (globalThis as { document?: unknown }).document;
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    writable: true,
    value: { dispatchEvent: () => true },
  });
  try {
    const a = install('org-qual-A', 701, 'Corredor', 702, 'Dueño', 9);
    requestLeadQualification(9);
    assert.equal(isLeadQualificationOpen(9), true);

    install('org-qual-B', 801, 'Corredor', 802, 'Dueño', 9);
    assert.equal(isLeadQualificationOpen(9), false, 'El mismo clientId en otra organización no puede reutilizar la sesión A.');
    requestLeadQualification(9);
    assert.equal(isLeadQualificationOpen(9), true);

    installTenantRuntimeScope(a.scope, AUTH_USER);
    state.crm = crmFor(a.scope, a.authenticated, a.visual, 9);
    assert.equal(isLeadQualificationOpen(9), false, 'Volver a A no debe ver la sesión abierta en B.');
  } finally {
    if (previousDocument === undefined) delete (globalThis as { document?: unknown }).document;
    else Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: previousDocument });
  }
});

test('A3.2: WhatsApp human identity deriva del miembro autenticado y queda tenant-bound', () => {
  const a = install('org-wa-A', 901, 'Dueño', 902, 'Corredor');
  const configuredA = configureCurrentWhatsAppHumanIdentity({
    humanName: 'Franco Solis',
    confirmed: true,
    now: new Date('2026-09-11T12:00:00.000Z'),
  });
  assert.equal(configuredA.valid, true);
  assert.equal(configuredA.identity?.actorId, a.authenticated.id);
  assert.equal(configuredA.identity?.organizationId, a.scope.organizationId);
  assert.notEqual(configuredA.identity?.actorId, a.visual.id);
  assert.equal(assertCurrentWhatsAppHumanIdentity(configuredA.identity).valid, true);

  const b = install('org-wa-B', 1001, 'Administrador', 1002, 'Dueño');
  assert.equal(assertCurrentWhatsAppHumanIdentity(configuredA.identity).valid, false, 'La identidad A no puede autorizar B.');
  const configuredB = configureCurrentWhatsAppHumanIdentity({
    humanName: 'Franco Solis',
    confirmed: true,
    now: new Date('2026-09-11T13:00:00.000Z'),
  });
  assert.equal(configuredB.valid, true);
  assert.equal(configuredB.identity?.actorId, b.authenticated.id);
  assert.equal(configuredB.identity?.organizationId, b.scope.organizationId);
  assert.notEqual(configuredB.identity?.identityId, configuredA.identity?.identityId);
});
