import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { initialData, type Client, type Property, type Visit } from '../models.js';
import { hasSyncMetadata } from '../sync-identity.js';
import { readLocalSnapshot, writeLocalSnapshot } from '../sync-safety.js';
import {
  coordinateVisit,
  localVisitIso,
  registerVisitResult,
  visitsForClient,
} from '../visit-workflow.js';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

function lead(pipeline = 'Nuevo', overrides: Partial<Client> = {}): Client {
  return {
    id: 10,
    name: 'Lucía Martín',
    phone: '+54 9 351 555-0101',
    email: 'lucia@example.com',
    interest: 'Dúplex en Docta',
    budget: '120000',
    currency: 'USD',
    paymentMethod: 'Contado',
    zones: 'Docta',
    purpose: 'Vivir',
    purchaseTimeframe: '0-3 meses',
    canMoveForward: 'Sí',
    knowsArea: 'Sí',
    status: 'Lead',
    temperature: 'Caliente',
    pipeline,
    assignedToId: 20,
    createdById: 20,
    ...overrides,
  } as Client;
}

function property(overrides: Partial<Property> = {}): Property {
  return {
    id: 30,
    title: 'Docta Etapa 3',
    address: 'Docta, Córdoba',
    type: 'Dúplex',
    operation: 'Venta',
    price: 133000,
    owner: 'Constructor',
    status: 'Disponible',
    assignedToId: 20,
    createdById: 20,
    ...overrides,
  } as Property;
}

const agent = { id: 20, role: 'Corredor' as const };
const owner = { id: 1, role: 'Dueño' as const };
const scheduleNow = new Date(2026, 7, 23, 12, 0, 0, 0);
const scheduledDate = '2026-08-25';
const scheduledTime = '15:30';

function coordinated(): Visit {
  return coordinateVisit({
    visits: [],
    client: lead(),
    property: property(),
    actor: agent,
    localDate: scheduledDate,
    localTime: scheduledTime,
    now: scheduleNow,
  }).visit;
}

function coordinate(stage = 'Nuevo') {
  return coordinateVisit({
    visits: [],
    client: lead(stage),
    property: property(),
    actor: agent,
    localDate: scheduledDate,
    localTime: scheduledTime,
    now: scheduleNow,
  });
}

test('P1.1-A2 crea una única Visit Coordinada con relaciones, responsable, creador y horario correctos', () => {
  const result = coordinate();
  assert.equal(result.visit.id, 1);
  assert.equal(result.visit.clientId, 10);
  assert.equal(result.visit.propertyId, 30);
  assert.equal(result.visit.assignedToId, 20);
  assert.equal(result.visit.createdById, 20);
  assert.equal(result.visit.status, 'Coordinada');
  assert.equal(result.visit.scheduledAt, localVisitIso(scheduledDate, scheduledTime));
  assert.equal(result.visit.createdAt, scheduleNow.toISOString());
  assert.equal(result.visit.updatedAt, scheduleNow.toISOString());
  assert.equal(result.visit.interest, undefined);
  assert.equal(result.visit.objection, undefined);
});

test('P1.1-A2 mantiene nextAction/nextFollowUp exclusivamente en Client al coordinar', () => {
  const result = coordinate();
  assert.equal(result.client.nextAction, 'Visita · Docta Etapa 3');
  assert.equal(result.client.nextFollowUp, scheduledDate);
  assert.equal('nextAction' in result.visit, false);
  assert.equal('nextFollowUp' in result.visit, false);
});

for (const stage of ['Nuevo', 'Contactado', 'Calificado'] as const) {
  test(`P1.1-A2 avanza ${stage} a Visita coordinada`, () => {
    assert.equal(coordinate(stage).client.pipeline, 'Visita coordinada');
  });
}

for (const stage of ['Negociación', 'Reservado'] as const) {
  test(`P1.1-A2 no degrada ${stage} al coordinar`, () => {
    assert.equal(coordinate(stage).client.pipeline, stage);
  });
}

for (const stage of ['Ganado', 'Perdido'] as const) {
  test(`P1.1-A2 bloquea coordinación normal para ${stage}`, () => {
    assert.throws(() => coordinate(stage), /ganado o perdido/i);
  });
}

test('P1.1-A2 respeta permisos de Corredor y visibilidad global de Dueño', () => {
  const foreignProperty = property({ assignedToId: 30 });
  assert.throws(() => coordinateVisit({
    visits: [], client: lead(), property: foreignProperty, actor: agent,
    localDate: scheduledDate, localTime: scheduledTime, now: scheduleNow,
  }), /permiso/i);
  assert.doesNotThrow(() => coordinateVisit({
    visits: [], client: lead(), property: foreignProperty, actor: owner,
    localDate: scheduledDate, localTime: scheduledTime, now: scheduleNow,
  }));
});

test('P1.1-A2 evita doble coordinación idéntica y conserva IDs incrementales', () => {
  const first = coordinate().visit;
  assert.throws(() => coordinateVisit({
    visits: [first], client: lead(), property: property(), actor: agent,
    localDate: scheduledDate, localTime: scheduledTime, now: scheduleNow,
  }), /ya está coordinada/i);
  const second = coordinateVisit({
    visits: [first], client: lead(), property: property({ id: 31, title: 'General Paz' }), actor: agent,
    localDate: scheduledDate, localTime: scheduledTime, now: scheduleNow,
  });
  assert.equal(second.visit.id, 2);
});

test('P1.1-A2 evita visitas pasadas y reconstruye fecha/hora local sin UTC manual', () => {
  assert.throws(() => coordinateVisit({
    visits: [], client: lead(), property: property(), actor: agent,
    localDate: '2026-08-22', localTime: '10:00', now: scheduleNow,
  }), /pasado/i);
  const iso = localVisitIso('2026-08-25', '18:45');
  const local = new Date(iso);
  assert.equal(local.getFullYear(), 2026);
  assert.equal(local.getMonth(), 7);
  assert.equal(local.getDate(), 25);
  assert.equal(local.getHours(), 18);
  assert.equal(local.getMinutes(), 45);
});

test('P1.1-A2 Realizada exige interest, actualiza Visit existente y no infiere Negociación', () => {
  const visit = coordinated();
  assert.throws(() => registerVisitResult({
    visit, client: lead('Visita coordinada'), property: property(), actor: agent,
    status: 'Realizada', nextAction: 'Enviar propuesta', nextFollowUp: '2026-08-27', now: new Date(2026, 7, 25, 18),
  }), /nivel de interés/i);
  const result = registerVisitResult({
    visit, client: lead('Visita coordinada'), property: property(), actor: agent,
    status: 'Realizada', interest: 'Alto', objection: 'Quiere revisar expensas',
    nextAction: 'Enviar propuesta', nextFollowUp: '2026-08-27', now: new Date(2026, 7, 25, 18),
  });
  const visits = [visit];
  visits[0] = result.visit;
  assert.equal(visits.length, 1);
  assert.equal(visits[0]?.status, 'Realizada');
  assert.equal(visits[0]?.interest, 'Alto');
  assert.equal(result.client.pipeline, 'Visita coordinada');
  assert.notEqual(result.visit.updatedAt, visit.updatedAt);
});

for (const status of ['Cancelada', 'No asistió'] as const) {
  test(`P1.1-A2 ${status} no exige interest y lo deja undefined`, () => {
    const result = registerVisitResult({
      visit: coordinated(), client: lead('Visita coordinada'), property: property(), actor: agent,
      status, interest: 'Alto', nextAction: 'Recontactar', nextFollowUp: '2026-08-27', now: new Date(2026, 7, 25, 18),
    });
    assert.equal(result.visit.status, status);
    assert.equal(result.visit.interest, undefined);
  });
}

test('P1.1-A2 resultado exige próximo compromiso en Client para lead no terminal', () => {
  const visit = coordinated();
  assert.throws(() => registerVisitResult({
    visit, client: lead('Visita coordinada'), property: property(), actor: agent,
    status: 'Cancelada', nextAction: '', nextFollowUp: '', now: new Date(2026, 7, 25, 18),
  }), /próxima acción/i);
  const result = registerVisitResult({
    visit, client: lead('Visita coordinada'), property: property(), actor: agent,
    status: 'Cancelada', objection: 'Tuvo un imprevisto', nextAction: 'Recoordinar visita', nextFollowUp: '2026-08-28', now: new Date(2026, 7, 25, 18),
  });
  assert.equal(result.client.nextAction, 'Recoordinar visita');
  assert.equal(result.client.nextFollowUp, '2026-08-28');
  assert.equal('nextAction' in result.visit, false);
  assert.equal('nextFollowUp' in result.visit, false);
});

test('P1.1-A2 ActivityEntry derivada usa Cliente y resumen humano', () => {
  const scheduled = coordinate();
  assert.deepEqual(scheduled.activity, {
    action: 'Visita coordinada',
    entityType: 'Cliente',
    entityId: 10,
    detail: `Docta Etapa 3 · ${scheduledDate} ${scheduledTime}`,
  });
  const done = registerVisitResult({
    visit: scheduled.visit, client: scheduled.client, property: property(), actor: agent,
    status: 'Realizada', interest: 'Medio', nextAction: 'Enviar alternativas', nextFollowUp: '2026-08-27', now: new Date(2026, 7, 25, 18),
  });
  assert.equal(done.activity.entityType, 'Cliente');
  assert.equal(done.activity.entityId, 10);
  assert.equal(done.activity.action, 'Visita realizada');
  assert.match(done.activity.detail, /Docta Etapa 3/);
  assert.match(done.activity.detail, /Interés Medio/);
});

test('P1.1-A2 historial filtra por clientId y prioriza próxima Coordinada determinísticamente', () => {
  const now = new Date(2026, 7, 23, 12);
  const visits: Visit[] = [
    { ...coordinated(), id: 1, clientId: 10, scheduledAt: localVisitIso('2026-08-28', '10:00') },
    { ...coordinated(), id: 2, clientId: 99, scheduledAt: localVisitIso('2026-08-24', '10:00') },
    { ...coordinated(), id: 3, clientId: 10, scheduledAt: localVisitIso('2026-08-24', '10:00') },
    { ...coordinated(), id: 4, clientId: 10, status: 'Realizada', interest: 'Bajo', scheduledAt: localVisitIso('2026-08-30', '10:00') },
  ];
  assert.deepEqual(visitsForClient(visits, 10, now).map((visit) => visit.id), [3, 1, 4]);
});

test('P1.1-A2 visita coordinada sobrevive snapshot local/F5 usando persistencia canónica A1', () => {
  const storage = new MemoryStorage();
  const crm = structuredClone(initialData);
  const visit = coordinate().visit;
  crm.visits = [visit];
  writeLocalSnapshot(crm, { markDirty: true, reason: 'P1.1-A2 visita coordinada' }, storage);
  const restored = readLocalSnapshot(storage);
  const restoredVisit = restored?.visits[0];
  assert.ok(restoredVisit);
  assert.ok(hasSyncMetadata(restoredVisit));
  assert.match(restoredVisit.uid ?? '', /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(restoredVisit.revision, 0);
  assert.equal(restoredVisit.interest, undefined);
  assert.equal(restoredVisit.objection, undefined);
  assert.deepEqual(restored?.visits, [{
    uid: visit.uid,
    revision: visit.revision,
    id: visit.id,
    clientId: visit.clientId,
    propertyId: visit.propertyId,
    scheduledAt: visit.scheduledAt,
    status: visit.status,
    assignedToId: visit.assignedToId,
    createdById: visit.createdById,
    createdAt: visit.createdAt,
    updatedAt: visit.updatedAt,
  }]);
});

test('P1.1-A2 conserva Agenda/Reminder/B1.4.2 fuera del flujo y Visit sin campos prohibidos', () => {
  const agenda = readFileSync('src/agenda.ts', 'utf8');
  const workflow = readFileSync('src/visit-workflow.ts', 'utf8');
  const ui = readFileSync('src/visit-workflow-ui.ts', 'utf8');
  const model = readFileSync('src/models.ts', 'utf8');
  const visitBlock = model.match(/export interface Visit \{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.doesNotMatch(agenda, /\bvisits\b/);
  assert.doesNotMatch(`${workflow}\n${ui}`, /state\.crm\.reminders|Reminder|lead-recommendation|supervised_recommendation/i);
  assert.doesNotMatch(visitBlock, /nextAction|nextFollowUp|offerId|reservationId|commissionId|metadata/);
  assert.match(ui, /saveData\(/);
  assert.match(ui, /addActivity\(/);
});

test('P1.1-A2 UI vive dentro del Lead, muestra propiedad/fecha/status y protege doble submit', () => {
  const ui = readFileSync('src/visit-workflow-ui.ts', 'utf8');
  const css = readFileSync('src/visit-workflow.css', 'utf8');
  const index = readFileSync('index.html', 'utf8');
  assert.match(ui, /\.mvp-lead-card\[data-client-id\]/);
  assert.match(ui, />Visitas</);
  assert.match(ui, /formatScheduledAt\(visit\.scheduledAt\)/);
  assert.match(ui, /visit\.status/);
  assert.match(ui, /form\.dataset\.submitting/);
  assert.match(ui, /visibleProperties\(\)/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /@media \(max-width: 720px\)/);
  assert.match(index, /visit-workflow\.css/);
  assert.match(index, /visit-workflow-ui\.js/);
  assert.doesNotMatch(index, /data-module="visitas"/i);
});
