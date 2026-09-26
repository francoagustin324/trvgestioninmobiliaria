import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { ActivityEntry, Client, CrmData, Property, PublicTenantIdentity } from '../models.js';
import { initialData } from '../models.js';
import {
  buildPropertyDiffusionMessage,
  latestPropertyDiffusionSent,
  normalizedEmail,
  normalizedWhatsAppPhone,
  propertyDiffusionEmailUrl,
  propertyDiffusionSendCount,
  propertyDiffusionStatus,
  propertyDiffusionWhatsAppUrl,
} from '../property-diffusion.js';
import { buildPropertyOpportunities } from '../property-opportunities.js';
import { matchClientsForProperty } from '../property-matching.js';
import { propertyToPublicFicha } from '../property-ficha.js';

const uiSource = readFileSync('src/property-opportunities-ui.ts', 'utf8');
const storeSource = readFileSync('src/property-diffusion-store.ts', 'utf8');
const cssSource = readFileSync('src/property-opportunities.css', 'utf8');
const browserSource = readFileSync('src/tests/p1-4-a1-property-opportunities-browser.test.ts', 'utf8');
const workflowSource = readFileSync('.github/workflows/ci.yml', 'utf8');

function property(overrides: Partial<Property> = {}): Property {
  return {
    id: 101,
    uid: '11111111-1111-4111-8111-111111111111',
    title: 'Dúplex Docta',
    address: 'Docta Urbanización, Córdoba',
    type: 'Dúplex',
    operation: 'Venta',
    price: 120000,
    owner: 'PROPIETARIO PRIVADO',
    status: 'Activa',
    bedrooms: 2,
    bathrooms: 2,
    features: 'Patio',
    notes: 'NOTA INTERNA SECRETA',
    sourceLink: 'https://interno.example/SECRETO',
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
    interest: 'Busco dúplex en Docta',
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

const tenantIdentity: PublicTenantIdentity = {
  organizationId: 'org-block2c-a',
  name: 'Inmobiliaria Test',
  commercialPhone: '5493510000000',
  logoPath: '',
  legalText: '',
};

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

function tenantCrm(
  organizationId: string,
  userId: string,
  label: string,
  withDiffusion = false,
): CrmData {
  const crm = structuredClone(initialData);
  crm.organization = {
    ...crm.organization,
    id: organizationId,
    name: `Inmobiliaria ${label}`,
  };
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
  crm.activityLog = withDiffusion ? [{
    id: 1,
    actorId: 10,
    action: 'Propiedad enviada',
    entityType: 'Cliente',
    entityId: 201,
    entityUid: crm.clients[0]!.uid,
    detail: `Propiedad ${label} · WhatsApp`,
    createdAt: '2026-09-25T15:00:00.000Z',
    activityKind: 'property-diffusion',
    diffusionPropertyId: 101,
    diffusionPropertyUid: crm.properties[0]!.uid,
    diffusionClientId: 201,
    diffusionClientUid: crm.clients[0]!.uid,
    diffusionChannel: 'WhatsApp',
    diffusionStatus: 'ENVIADO',
  }] : [];
  crm.visits = [];
  crm.offers = [];
  crm.reservations = [];
  crm.contacts = [];
  crm.reminders = [];
  crm.fichas = [];
  crm.conversations = [];
  return crm;
}

async function persistenceHarness(label = 'A') {
  installMemoryStorage();
  const store = await import('../store.js');
  const runtime = await import('../tenant-runtime.js');
  const diffusionStore = await import('../property-diffusion-store.js');
  runtime.invalidateTenantRuntimeScope();
  const scope = {
    userId: `block2c-user-${label.toLowerCase()}`,
    organizationId: `org-block2c-${label.toLowerCase()}`,
  };
  runtime.installTenantRuntimeScope(scope, scope.userId);
  store.state.crm = tenantCrm(scope.organizationId, scope.userId, label);
  store.state.activeMemberId = 10;
  const runtimeLease = runtime.captureTenantRuntimeLease(scope);
  return {
    store,
    runtime,
    diffusionStore,
    scope,
    runtimeLease,
    property: store.state.crm.properties[0]!,
    client: store.state.crm.clients[0]!,
  };
}

test('A. una propiedad encuentra compradores compatibles usando el matching existente', () => {
  const target = property();
  const buyer = client();
  const opportunities = buildPropertyOpportunities(target, [buyer]);
  assert.equal(opportunities.length, 1);
  assert.equal(opportunities[0]?.match.client.id, buyer.id);
});

test('B. la UI conserva selección de uno o varios compradores antes de preparar difusión', () => {
  assert.match(uiSource, /const selectedClientIds = new Set<number>\(\)/);
  assert.match(uiSource, /selectedClientIds\.add\(clientId\)/);
  assert.match(uiSource, /selectedClientIds\.delete\(clientId\)/);
  assert.match(uiSource, /selected\.length/);
  assert.match(uiSource, /data-prepare-diffusion/);
});

test('C. preparar difusión abre revisión pero no envía ni registra automáticamente', () => {
  const start = uiSource.indexOf('async function prepareSelectedDiffusion');
  const end = uiSource.indexOf('function recordDiffusionStatus', start);
  assert.ok(start >= 0 && end > start);
  const prepare = uiSource.slice(start, end);
  assert.match(prepare, /publishAndRememberPropertyFicha/);
  assert.doesNotMatch(prepare, /window\.open|recordPropertyDiffusionEvent|wa\.me/);
  assert.match(uiSource, /data-diffusion-review/);
});

test('D. el mensaje preparado contiene sólo información comercial permitida', () => {
  const message = buildPropertyDiffusionMessage(property(), tenantIdentity, 'https://ordenbroker.test/ficha/abc123');
  assert.match(message, /Dúplex Docta/);
  assert.match(message, /Docta Urbanización, Córdoba/);
  assert.match(message, /USD 120\.000/);
  assert.match(message, /2 dormitorios/);
  assert.match(message, /https:\/\/ordenbroker\.test\/ficha\/abc123/);
});

test('E. propietario, notas internas y sourceLink nunca aparecen en el mensaje ni ficha pública', () => {
  const target = property();
  const message = buildPropertyDiffusionMessage(target, tenantIdentity, 'https://ordenbroker.test/ficha/abc123');
  const ficha = JSON.stringify(propertyToPublicFicha(target));
  for (const forbidden of ['PROPIETARIO PRIVADO', 'NOTA INTERNA SECRETA', 'interno.example/SECRETO']) {
    assert.equal(message.includes(forbidden), false);
    assert.equal(ficha.includes(forbidden), false);
  }
});

test('F. WhatsApp sólo se prepara con teléfono canónico válido y reutiliza la normalización existente', () => {
  assert.equal(normalizedWhatsAppPhone('sin teléfono'), null);
  assert.equal(propertyDiffusionWhatsAppUrl('', 'Hola'), null);
  assert.equal(propertyDiffusionWhatsAppUrl('123', 'Hola'), null);
  assert.equal(normalizedWhatsAppPhone('351 555 0101'), '5493515550101');
  assert.match(propertyDiffusionWhatsAppUrl('351 555 0101', 'Hola') ?? '', /^https:\/\/wa\.me\/5493515550101\?text=/);
  assert.equal(normalizedWhatsAppPhone('+54 9 351 555 0101'), '5493515550101');
  assert.equal(normalizedWhatsAppPhone('351555010'), null);
});

test('G. un cliente email-only conserva alternativa mailto sin necesitar teléfono', () => {
  const emailOnly = client({ phone: '', email: 'emailonly@example.test' });
  assert.equal(propertyDiffusionWhatsAppUrl(emailOnly.phone, 'Mensaje'), null);
  assert.equal(normalizedEmail(emailOnly.email), 'emailonly@example.test');
  assert.match(propertyDiffusionEmailUrl(emailOnly.email, 'Dúplex Docta', 'Mensaje') ?? '', /^mailto:emailonly@example\.test\?/);
});

test('H. abrir WhatsApp es una acción distinta de marcar Enviado', () => {
  assert.match(uiSource, /data-open-diffusion-whatsapp/);
  assert.match(uiSource, /data-mark-diffusion-sent/);
  assert.match(uiSource, /Abrir WhatsApp/);
  assert.match(uiSource, /Marcar como enviado/);
  assert.doesNotMatch(uiSource, /data-open-diffusion-whatsapp[^\n]*recordPropertyDiffusionEvent/);
});

test('I. marcar manualmente Enviado agrega una difusión estructurada', async () => {
  const h = await persistenceHarness('I');
  const entry = h.diffusionStore.recordPropertyDiffusionEvent({
    scope: h.scope,
    runtimeLease: h.runtimeLease,
    property: h.property,
    client: h.client,
    channel: 'WhatsApp',
    status: 'ENVIADO',
  }, () => {});
  assert.equal(entry.activityKind, 'property-diffusion');
  assert.equal(entry.diffusionStatus, 'ENVIADO');
  assert.equal(h.store.state.crm.activityLog.length, 1);
});

test('J. el envío registra actor, cliente, propiedad, fecha y canal', async () => {
  const h = await persistenceHarness('J');
  const entry = h.diffusionStore.recordPropertyDiffusionEvent({
    scope: h.scope,
    runtimeLease: h.runtimeLease,
    property: h.property,
    client: h.client,
    channel: 'Email',
    status: 'ENVIADO',
  }, () => {});
  assert.equal(entry.actorId, 10);
  assert.equal(entry.diffusionClientId, h.client.id);
  assert.equal(entry.diffusionPropertyId, h.property.id);
  assert.equal(entry.diffusionChannel, 'Email');
  assert.match(entry.createdAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('K. volver al mismo par propiedad-cliente detecta la difusión previa', async () => {
  const h = await persistenceHarness('K');
  h.diffusionStore.recordPropertyDiffusionEvent({
    scope: h.scope,
    runtimeLease: h.runtimeLease,
    property: h.property,
    client: h.client,
    channel: 'WhatsApp',
    status: 'ENVIADO',
  }, () => {});
  const currentClient = h.store.state.crm.clients[0]!;
  const previous = latestPropertyDiffusionSent(currentClient, h.property);
  assert.ok(previous);
  assert.equal(propertyDiffusionStatus(currentClient, h.property), 'ENVIADO');
  assert.match(uiSource, /Ya enviada el/);
});

test('L. el reenvío sigue permitido pero queda como un nuevo evento y la UI advierte', async () => {
  const h = await persistenceHarness('L');
  for (let index = 0; index < 2; index += 1) {
    h.diffusionStore.recordPropertyDiffusionEvent({
      scope: h.scope,
      runtimeLease: h.runtimeLease,
      property: h.property,
      client: h.client,
      channel: 'WhatsApp',
      status: 'ENVIADO',
    }, () => {});
  }
  assert.equal(propertyDiffusionSendCount(h.store.state.crm.clients[0]!, h.property), 2);
  assert.match(uiSource, /Marcar nuevo envío/);
});

test('M. Respondió se registra sin alterar pipeline, temperatura ni resultado comercial', async () => {
  const h = await persistenceHarness('M');
  const before = {
    pipeline: h.client.pipeline,
    temperature: h.client.temperature,
    outcome: h.client.outcome,
  };
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
  assert.equal(propertyDiffusionStatus(h.store.state.crm.clients[0]!, h.property), 'RESPONDIO');
  assert.deepEqual({
    pipeline: h.store.state.crm.clients[0]?.pipeline,
    temperature: h.store.state.crm.clients[0]?.temperature,
    outcome: h.store.state.crm.clients[0]?.outcome,
  }, before);
});

test('N. el seguimiento es opcional y reutiliza Leads sin inventar acción ni fecha', () => {
  assert.match(uiSource, /data-add-diffusion-followup="\$\{client\.id\}">Agregar seguimiento/);
  assert.match(uiSource, /state\.activeModule = 'crm'/);
  assert.match(uiSource, /state\.editingClientId = clientId/);
  assert.match(uiSource, /state\.openForms\.client = true/);
  assert.doesNotMatch(uiSource, /client\.nextAction\s*=/);
  assert.doesNotMatch(uiSource, /client\.nextFollowUp\s*=/);
  assert.doesNotMatch(storeSource, /nextAction|nextFollowUp/);
});

test('O. snapshots de dos tenants mantienen aislado el historial de difusión', async () => {
  const storage = installMemoryStorage();
  const store = await import('../store.js');
  const runtime = await import('../tenant-runtime.js');
  const tenantStorage = await import('../tenant-storage.js');
  runtime.invalidateTenantRuntimeScope();

  const scopeA = { userId: 'tenant-a-user', organizationId: 'tenant-a-org' };
  const scopeB = { userId: 'tenant-b-user', organizationId: 'tenant-b-org' };
  const crmA = tenantCrm(scopeA.organizationId, scopeA.userId, 'A', true);
  const crmB = tenantCrm(scopeB.organizationId, scopeB.userId, 'B', true);
  crmA.activityLog[0]!.detail = 'SOLO TENANT A';
  crmB.activityLog[0]!.detail = 'SOLO TENANT B';
  tenantStorage.writeTenantSnapshot(scopeA, crmA, { backup: false }, storage);
  tenantStorage.writeTenantSnapshot(scopeB, crmB, { backup: false }, storage);

  runtime.installTenantRuntimeScope(scopeA, scopeA.userId);
  store.activateStorageForTenant(scopeA);
  assert.deepEqual(store.state.crm.activityLog.map((entry: ActivityEntry) => entry.detail), ['SOLO TENANT A']);

  runtime.installTenantRuntimeScope(scopeB, scopeB.userId);
  store.activateStorageForTenant(scopeB);
  assert.deepEqual(store.state.crm.activityLog.map((entry: ActivityEntry) => entry.detail), ['SOLO TENANT B']);
});

test('P. cambiar de tenant durante una acción hace fail closed antes de mutar', async () => {
  const h = await persistenceHarness('P');
  const staleLease = h.runtimeLease;
  h.runtime.installTenantRuntimeScope(
    { userId: 'block2c-other-user', organizationId: 'org-block2c-other' },
    'block2c-other-user',
  );
  const before = h.store.state.crm.activityLog.length;
  assert.throws(() => h.diffusionStore.recordPropertyDiffusionEvent({
    scope: h.scope,
    runtimeLease: staleLease,
    property: h.property,
    client: h.client,
    channel: 'WhatsApp',
    status: 'ENVIADO',
  }, () => {}), /TENANT_RUNTIME_STALE/);
  assert.equal(h.store.state.crm.activityLog.length, before);
});

test('Q. un error de persistencia revierte la difusión y no deja Enviado falso', async () => {
  const h = await persistenceHarness('Q');
  const before = structuredClone(h.store.state.crm);
  assert.throws(() => h.diffusionStore.recordPropertyDiffusionEvent({
    scope: h.scope,
    runtimeLease: h.runtimeLease,
    property: h.property,
    client: h.client,
    channel: 'WhatsApp',
    status: 'ENVIADO',
  }, () => { throw new Error('PERSISTENCE_TEST_FAILURE'); }), /PERSISTENCE_TEST_FAILURE/);
  assert.deepEqual(h.store.state.crm.activityLog, before.activityLog);
  assert.equal(latestPropertyDiffusionSent(h.store.state.crm.clients[0]!, h.property), null);
});

test('R. el panel de difusión está cubierto por mobile sin overflow y con controles táctiles', () => {
  assert.match(cssSource, /\.diffusion-review \{[^}]*min-width:0/);
  assert.match(cssSource, /@media \(max-width:640px\)[\s\S]*\.diffusion-review \{[^}]*max-width:100%[^}]*overflow-x:clip/);
  assert.match(cssSource, /\.diffusion-open-channel,[\s\S]*min-height:44px/);
  assert.match(browserSource, /data-diffusion-review/);
  assert.match(browserSource, /reviewRight <= metrics\.viewport \+ 1/);
});

test('S. el matching histórico sigue siendo la única fuente de score', () => {
  const target = property();
  const buyers = [client(), client({ id: 202, uid: undefined, name: 'Fuera de presupuesto', budget: 'USD 50.000' })];
  const canonical = matchClientsForProperty(target, buyers);
  const opportunities = buildPropertyOpportunities(target, buyers);
  assert.deepEqual(
    opportunities.map(({ match }) => ({ id: match.client.id, score: match.score, level: match.level })),
    canonical.map((match) => ({ id: match.client.id, score: match.score, level: match.level })),
  );
  assert.doesNotMatch(uiSource, /evaluatePropertyMatch|score\s*[+\-*/]?=/);
});

test('T. la difusión reutiliza la publicación/ficha pública canónica y no crea un segundo publicador', () => {
  assert.match(uiSource, /publishAndRememberPropertyFicha/);
  assert.match(uiSource, /buildPropertyDiffusionMessage/);
  assert.doesNotMatch(uiSource, /from ['"]\.\/public-property-share\.js['"]/);
  assert.doesNotMatch(uiSource, /public_property_fichas|rest\/v1\/public_property_fichas/);
});

test('U. clientes email-only siguen participando del matching y del contacto asistido', () => {
  const emailOnly = client({ phone: '', email: 'solo-email@example.test' });
  const opportunities = buildPropertyOpportunities(property(), [emailOnly]);
  assert.equal(opportunities.length, 1);
  assert.equal(opportunities[0]?.match.client.email, 'solo-email@example.test');
  assert.match(uiSource, /propertyDiffusionEmailUrl/);
  assert.match(uiSource, /Preparar email/);
});

test('V. FULL CI conserva Bloque 2C dentro de la cardinalidad integrada vigente', () => {
  assert.match(workflowSource, /ux\/ordenbroker-block2c-assisted-property-diffusion/);
  assert.match(workflowSource, /fix\/ordenbroker-block2c1-durable-diffusion-ledger/);
  assert.match(workflowSource, /EXPECTED_TEST_TOTAL: "1482"/);
  assert.match(workflowSource, /expected = 1482/);
});
