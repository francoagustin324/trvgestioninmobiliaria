import assert from 'node:assert/strict';
import test from 'node:test';
import {
  commercialAlertDedupeKey,
  evaluateCommercialAlertConditions,
  visitConfirmationDetail,
  VISIT_CONFIRMED_ACTION,
} from '../commercial-alert-engine.js';
import { operationalAttentionQueue, renderOperationalAttentionQueue } from '../lead-attention-queue.js';
import type {
  ActivityEntry,
  Client,
  Offer,
  Property,
  Reminder,
  Reservation,
  SyncedVisit,
  Visit,
} from '../models.js';

const TODAY = '2026-09-29';
const NOW = new Date('2026-09-29T15:00:00.000Z');
const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';

function client(id: number, overrides: Partial<Client> = {}): Client {
  return {
    id,
    uid: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
    revision: 3,
    name: `Cliente ${id}`,
    phone: `549351555${String(id).padStart(4, '0')}`,
    interest: 'Departamento 2 dormitorios General Paz',
    status: 'Lead',
    temperature: 'Tibio',
    pipeline: 'Contactado',
    lastContact: '2026-09-29',
    nextAction: 'Enviar opciones',
    nextFollowUp: '2026-10-05',
    budget: 'USD 120000',
    currency: 'USD',
    paymentMethod: 'Contado',
    purchaseTimeframe: '0-3 meses',
    purpose: 'Vivir',
    canMoveForward: 'Sí',
    knowsArea: 'Sí',
    zones: 'General Paz',
    propertyType: 'Departamento',
    bedrooms: 2,
    assignedToId: 1,
    createdById: 1,
    ...overrides,
  };
}

function property(id: number, overrides: Partial<Property> = {}): Property {
  return {
    id,
    uid: `10000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
    revision: 2,
    title: `Departamento ${id}`,
    address: 'General Paz, Córdoba',
    type: 'Departamento',
    operation: 'Venta',
    price: 110000,
    owner: 'Propietario',
    status: 'Activa',
    bedrooms: 2,
    assignedToId: 1,
    createdById: 1,
    ...overrides,
  };
}

function evaluation(overrides: Partial<Parameters<typeof evaluateCommercialAlertConditions>[0]> = {}) {
  return {
    organizationId: ORG_A,
    clients: [] as Client[],
    properties: [] as Property[],
    visits: [] as Visit[],
    offers: [] as Offer[],
    reservations: [] as Reservation[],
    reminders: [] as Reminder[],
    activityLog: [] as ActivityEntry[],
    actor: { id: 1, role: 'Dueño' as const },
    today: TODAY,
    now: NOW,
    ...overrides,
  };
}

function activeOf(type: ReturnType<typeof evaluateCommercialAlertConditions>[number]['type'], values: ReturnType<typeof evaluateCommercialAlertConditions>) {
  return values.filter((condition) => condition.type === type);
}

test('Block 2H A-T: el motor puro detecta las diez condiciones y evita falsos positivos', () => {
  const newLead = client(1, {
    pipeline: 'Nuevo',
    lastContact: undefined,
    nextAction: undefined,
    nextFollowUp: undefined,
  });
  const newLeadCreated: ActivityEntry = {
    id: 1,
    actorId: 1,
    action: 'Lead creado',
    entityType: 'Cliente',
    entityId: 1,
    detail: 'Alta',
    createdAt: '2026-09-29T14:20:00.000Z',
  };
  let conditions = evaluateCommercialAlertConditions(evaluation({
    clients: [newLead],
    activityLog: [newLeadCreated],
  }));
  assert.equal(activeOf('NEW_LEAD_UNATTENDED', conditions).length, 1, 'A: lead nuevo genera alerta');
  assert.equal(activeOf('NEW_LEAD_UNATTENDED', conditions)[0]?.action, 'Atender ahora', 'A: CTA aprobado');

  const contacted = { ...newLead, lastContact: TODAY, pipeline: 'Contactado' as const };
  conditions = evaluateCommercialAlertConditions(evaluation({
    clients: [contacted],
    activityLog: [
      newLeadCreated,
      {
        id: 2,
        actorId: 1,
        action: 'Contacto por WhatsApp',
        entityType: 'Cliente',
        entityId: 1,
        detail: 'Contacto real',
        createdAt: '2026-09-29T14:40:00.000Z',
      },
    ],
  }));
  assert.equal(activeOf('NEW_LEAD_UNATTENDED', conditions).length, 0, 'C: contacto comercial válido elimina condición');

  const overdue = client(2, { nextAction: 'Llamar', nextFollowUp: '2026-09-27' });
  conditions = evaluateCommercialAlertConditions(evaluation({ clients: [overdue] }));
  assert.equal(activeOf('FOLLOW_UP_OVERDUE', conditions).length, 1, 'D: follow-up vencido alerta');
  assert.equal(activeOf('FOLLOW_UP_OVERDUE', conditions)[0]?.action, 'Hacer seguimiento', 'D: CTA aprobado');
  assert.equal(activeOf('FOLLOW_UP_OVERDUE', evaluateCommercialAlertConditions(evaluation({
    clients: [{ ...overdue, nextFollowUp: '2026-10-03' }],
  }))).length, 0, 'E/F: follow-up futuro o reprogramado no alerta');

  const forgotten = client(3, {
    lastContact: '2026-09-20',
    nextAction: undefined,
    nextFollowUp: undefined,
  });
  conditions = evaluateCommercialAlertConditions(evaluation({ clients: [forgotten] }));
  assert.equal(activeOf('FORGOTTEN_LEAD', conditions).length, 1, 'G: lead activo abandonado alerta');
  assert.equal(activeOf('FORGOTTEN_LEAD', evaluateCommercialAlertConditions(evaluation({
    clients: [{ ...forgotten, pipeline: 'Ganado' }],
  }))).length, 0, 'G: lead terminal nunca se marca olvidado');
  assert.equal(activeOf('FORGOTTEN_LEAD', evaluateCommercialAlertConditions(evaluation({
    clients: [{ ...forgotten, nextAction: 'Enviar alternativas' }],
  }))).length, 1, 'G: un nextAction sin fecha válida no prueba gestión vigente');

  const visitBase: SyncedVisit = {
    id: 10,
    uid: '20000000-0000-4000-8000-000000000010',
    revision: 1,
    clientId: 4,
    propertyId: 10,
    scheduledAt: '2026-09-29T18:00:00.000Z',
    status: 'Coordinada',
    assignedToId: 1,
    createdById: 1,
    createdAt: '2026-09-28T12:00:00.000Z',
    updatedAt: '2026-09-28T12:00:00.000Z',
  };
  const visitClient = client(4, { pipeline: 'Visita coordinada', nextAction: 'Confirmar visita', nextFollowUp: TODAY });
  conditions = evaluateCommercialAlertConditions(evaluation({
    clients: [visitClient],
    properties: [property(10)],
    visits: [visitBase],
  }));
  assert.equal(activeOf('VISIT_UNCONFIRMED', conditions).length, 1, 'I: visita futura sin confirmar alerta');

  const confirmActivity: ActivityEntry = {
    id: 10,
    actorId: 1,
    action: VISIT_CONFIRMED_ACTION,
    entityType: 'Cliente',
    entityId: 4,
    detail: visitConfirmationDetail(visitBase),
    createdAt: '2026-09-29T15:01:00.000Z',
  };
  assert.equal(activeOf('VISIT_UNCONFIRMED', evaluateCommercialAlertConditions(evaluation({
    clients: [visitClient],
    properties: [property(10)],
    visits: [visitBase],
    activityLog: [confirmActivity],
  }))).length, 0, 'H: visita confirmada no alerta');
  assert.equal(activeOf('VISIT_UNCONFIRMED', evaluateCommercialAlertConditions(evaluation({
    clients: [visitClient],
    properties: [property(10)],
    visits: [{ ...visitBase, status: 'Cancelada' }],
  }))).length, 0, 'J: visita cancelada no alerta');

  const pastVisit = { ...visitBase, id: 11, scheduledAt: '2026-09-28T18:00:00.000Z' };
  assert.equal(activeOf('VISIT_RESULT_MISSING', evaluateCommercialAlertConditions(evaluation({
    clients: [visitClient],
    properties: [property(10)],
    visits: [pastVisit],
  }))).length, 1, 'K: visita pasada sin resultado alerta');
  const realizedVisit = { ...pastVisit, status: 'Realizada' as const, interest: 'Alto' as const, updatedAt: '2026-09-29T14:00:00.000Z' };
  const realizedActivity: ActivityEntry = {
    id: 11,
    actorId: 1,
    action: 'Visita realizada',
    entityType: 'Cliente',
    entityId: 4,
    detail: 'Resultado causal',
    createdAt: '2026-09-29T14:00:01.000Z',
    commercialEntityType: 'visit',
    commercialEntityId: realizedVisit.id,
  };
  assert.equal(activeOf('VISIT_RESULT_MISSING', evaluateCommercialAlertConditions(evaluation({
    clients: [visitClient],
    properties: [property(10)],
    visits: [realizedVisit],
    activityLog: [realizedActivity],
  }))).length, 0, 'L: visita con resultado causal y próximo paso válido no alerta');

  const offerClient = client(5, { pipeline: 'Negociación', nextAction: 'Esperar respuesta', nextFollowUp: '2026-10-02' });
  const stalledOffer: Offer = {
    id: 20,
    clientId: 5,
    propertyId: 10,
    origin: 'Cliente',
    amount: 108000,
    currency: 'USD',
    status: 'Pendiente',
    assignedToId: 1,
    createdById: 1,
    createdAt: '2026-09-25T12:00:00.000Z',
    updatedAt: '2026-09-26T12:00:00.000Z',
  };
  assert.equal(activeOf('OFFER_STALLED', evaluateCommercialAlertConditions(evaluation({
    clients: [offerClient],
    properties: [property(10)],
    offers: [stalledOffer],
  }))).length, 1, 'M: oferta activa estancada alerta');
  const stalledOfferConditions = evaluateCommercialAlertConditions(evaluation({
    clients: [offerClient],
    properties: [property(10)],
    offers: [stalledOffer],
  }));
  assert.equal(activeOf('OFFER_STALLED', stalledOfferConditions)[0]?.action, 'Retomar oferta', 'M: CTA aprobado');
  assert.equal(activeOf('OFFER_STALLED', evaluateCommercialAlertConditions(evaluation({
    clients: [offerClient],
    properties: [property(10)],
    offers: [{ ...stalledOffer, updatedAt: '2026-09-29T14:30:00.000Z' }],
  }))).length, 0, 'N: oferta con movimiento reciente no alerta');

  const reservationClient = client(6, { pipeline: 'Reservado', nextAction: 'Revisar reserva', nextFollowUp: '2026-10-01' });
  const reservation: Reservation = {
    id: 30,
    clientId: 6,
    propertyId: 10,
    amount: 5000,
    currency: 'USD',
    reservedAt: '2026-09-25',
    expiresAt: '2026-09-30',
    status: 'Activa',
    assignedToId: 1,
    createdById: 1,
    createdAt: '2026-09-25T12:00:00.000Z',
    updatedAt: '2026-09-27T12:00:00.000Z',
  };
  assert.equal(activeOf('RESERVATION_STALLED', evaluateCommercialAlertConditions(evaluation({
    clients: [reservationClient],
    properties: [property(10)],
    reservations: [reservation],
  }))).length, 1, 'O: reserva que requiere intervención alerta');
  assert.equal(activeOf('RESERVATION_STALLED', evaluateCommercialAlertConditions(evaluation({
    clients: [reservationClient],
    properties: [property(10)],
    reservations: [{ ...reservation, status: 'Concretada' }],
  }))).length, 0, 'O: reserva concretada resuelve automáticamente la condición');
  assert.equal(activeOf('RESERVATION_STALLED', evaluateCommercialAlertConditions(evaluation({
    clients: [{ ...reservationClient, nextAction: 'Revisar documentación de reserva', nextFollowUp: '2026-09-30' }],
    properties: [property(10)],
    reservations: [reservation],
  }))).length, 0, 'O: un próximo paso válido antes del vencimiento resuelve la alerta de reserva');

  const advanced = client(7, {
    pipeline: 'Negociación',
    nextAction: undefined,
    nextFollowUp: undefined,
    lastContact: TODAY,
  });
  assert.equal(activeOf('ADVANCED_NO_NEXT_ACTION', evaluateCommercialAlertConditions(evaluation({
    clients: [advanced],
  }))).length, 1, 'P: operación avanzada sin próximo paso alerta');
  assert.equal(activeOf('ADVANCED_NO_NEXT_ACTION', evaluateCommercialAlertConditions(evaluation({
    clients: [{ ...advanced, nextAction: 'Llamar', nextFollowUp: '2026-10-01' }],
  }))).length, 0, 'Q: operación con próximo paso no alerta');

  const matchClient = client(8, { nextFollowUp: '2026-10-05', qualificationUpdatedAt: '2026-09-29T10:00:00.000Z' });
  const matchProperty = property(80);
  assert.equal(activeOf('NEW_RELEVANT_MATCH', evaluateCommercialAlertConditions(evaluation({
    clients: [matchClient],
    properties: [matchProperty],
  }))).length, 1, 'R: match nuevo relevante alerta');
  const matchConditions = evaluateCommercialAlertConditions(evaluation({
    clients: [matchClient],
    properties: [matchProperty],
  }));
  assert.equal(activeOf('NEW_RELEVANT_MATCH', matchConditions)[0]?.action, 'Ver oportunidad', 'R: CTA aprobado');

  const matchDismissal: ActivityEntry = {
    id: 80,
    actorId: 1,
    action: 'Match descartado',
    entityType: 'Cliente',
    entityId: 8,
    diffusionClientId: 8,
    diffusionPropertyId: 80,
    detail: 'Propiedad descartada del matching\npropertyRevision=2',
    createdAt: '2026-09-29T12:00:00.000Z',
  };
  assert.equal(activeOf('NEW_RELEVANT_MATCH', evaluateCommercialAlertConditions(evaluation({
    clients: [matchClient],
    properties: [matchProperty],
    activityLog: [matchDismissal],
  }))).length, 0, 'S: match descartado no reaparece sin cambio real');

  const taskClient = client(9, { nextAction: 'Enviar documentación', nextFollowUp: '2026-09-28' });
  const mirroredReminder: Reminder = {
    id: 90,
    date: '2026-09-28',
    title: 'Enviar documentación',
    related: 'Cliente 9',
    priority: 'Alta',
    assignedToId: 1,
    createdById: 1,
  };
  conditions = evaluateCommercialAlertConditions(evaluation({
    clients: [taskClient],
    reminders: [mirroredReminder],
  }));
  assert.equal(activeOf('FOLLOW_UP_OVERDUE', conditions).length, 1);
  assert.equal(activeOf('TASK_OVERDUE', conditions).length, 0, 'T: tarea espejo no duplica follow-up');
  assert.equal(activeOf('TASK_OVERDUE', evaluateCommercialAlertConditions(evaluation({
    clients: [taskClient],
    reminders: [{ ...mirroredReminder, id: 91, title: 'Pedir documentación al propietario' }],
  }))).length, 1, 'T: tarea vencida distinta sí alerta');
  const completedReminder = {
    ...mirroredReminder,
    id: 93,
    title: 'Pedir documentación al propietario',
    completedAt: NOW.toISOString(),
  } as Reminder & { completedAt: string };
  assert.equal(activeOf('TASK_OVERDUE', evaluateCommercialAlertConditions(evaluation({
    clients: [taskClient],
    reminders: [completedReminder],
  }))).length, 0, 'T: completar tarea resuelve automáticamente la condición');
  assert.equal(activeOf('TASK_OVERDUE', evaluateCommercialAlertConditions(evaluation({
    clients: [taskClient],
    reminders: [{ ...mirroredReminder, id: 94, date: '2026-10-02', title: 'Pedir documentación al propietario' }],
  }))).length, 0, 'T: reprogramar tarea a futuro resuelve automáticamente la condición');

  const taskMarkup = renderOperationalAttentionQueue(evaluation({
    clients: [taskClient],
    reminders: [{ ...mirroredReminder, id: 95, title: 'Pedir documentación al propietario' }],
  }), 20);
  const taskButton = taskMarkup.match(/<button[^>]*data-operational-action="task-overdue"[^>]*>/)?.[0] ?? '';
  assert.match(taskButton, /data-attention-module="agenda"/, 'T CTA: Resolver tarea navega al módulo Agenda');
  assert.match(taskButton, /data-attention-target="agenda"/, 'T CTA: conserva destino comercial Agenda');
  assert.doesNotMatch(
    taskButton,
    /data-attention-client-id=/,
    'T CTA: una tarea ligada a un lead no debe ser interceptada por la navegación a la ficha del lead',
  );

  const offerDominatesGeneric = evaluateCommercialAlertConditions(evaluation({
    clients: [client(40, {
      pipeline: 'Negociación',
      lastContact: '2026-09-20',
      nextAction: undefined,
      nextFollowUp: undefined,
    })],
    properties: [property(40)],
    offers: [{ ...stalledOffer, id: 40, clientId: 40, propertyId: 40 }],
  }));
  assert.equal(activeOf('OFFER_STALLED', offerDominatesGeneric).length, 1, 'dedupe: oferta específica permanece');
  assert.equal(activeOf('FORGOTTEN_LEAD', offerDominatesGeneric).length, 0, 'dedupe: oferta frenada domina lead olvidado');
  assert.equal(activeOf('ADVANCED_NO_NEXT_ACTION', offerDominatesGeneric).length, 0, 'dedupe: oferta frenada domina operación genérica');

  const overdueAdvanced = client(41, {
    pipeline: 'Negociación',
    lastContact: TODAY,
    nextAction: undefined,
    nextFollowUp: '2026-09-28',
  });
  const overdueAdvancedConditions = evaluateCommercialAlertConditions(evaluation({ clients: [overdueAdvanced] }));
  assert.equal(activeOf('FOLLOW_UP_OVERDUE', overdueAdvancedConditions).length, 1, 'dedupe: follow-up específico permanece');
  assert.equal(activeOf('ADVANCED_NO_NEXT_ACTION', overdueAdvancedConditions).length, 0, 'dedupe: follow-up vencido domina operación genérica');

  const tomorrowVisitClient = client(42, {
    pipeline: 'Visita coordinada',
    nextAction: 'Confirmar visita',
    nextFollowUp: '2026-09-30',
  });
  const tomorrowVisit: Visit = {
    ...visitBase,
    id: 42,
    clientId: 42,
    propertyId: 42,
    scheduledAt: '2026-09-30T18:00:00.000Z',
  };
  const visitQueue = operationalAttentionQueue({
    ...evaluation({
      clients: [tomorrowVisitClient],
      properties: [property(42)],
      visits: [tomorrowVisit],
    }),
  }, 20);
  assert.equal(visitQueue.some((item) => item.clientId === 42 && item.kind === 'visit-confirm'), true, 'dedupe UI: visita específica permanece');
  assert.equal(visitQueue.some((item) => item.clientId === 42 && item.kind === 'next-follow-up'), false, 'dedupe UI: visita específica domina próximo seguimiento 2G');

  const reservationQueue = operationalAttentionQueue({
    ...evaluation({
      clients: [reservationClient],
      properties: [property(10)],
      reservations: [reservation],
    }),
  }, 20);
  assert.equal(reservationQueue.some((item) => item.clientId === 6 && item.kind === 'reservation-attention'), true, 'dedupe UI: reserva específica permanece');
  assert.equal(reservationQueue.some((item) => item.clientId === 6 && item.kind === 'close-intervention'), false, 'dedupe UI: reserva específica domina intervención genérica de cierre');

  const reservedOverdueClient = client(43, {
    pipeline: 'Reservado',
    nextAction: 'Llamar por documentación',
    nextFollowUp: '2026-09-28',
  });
  const reservedOverdueQueue = operationalAttentionQueue({
    ...evaluation({ clients: [reservedOverdueClient] }),
  }, 20);
  assert.equal(reservedOverdueQueue.some((item) => item.clientId === 43 && item.kind === 'follow-up-overdue'), true, 'dedupe cierre: follow-up específico permanece');
  assert.equal(reservedOverdueQueue.some((item) => item.clientId === 43 && item.kind === 'close-intervention'), false, 'dedupe cierre: follow-up específico domina intervención genérica');

  const visitTaskConditions = evaluateCommercialAlertConditions(evaluation({
    clients: [visitClient],
    properties: [property(10)],
    visits: [visitBase],
    reminders: [{
      id: 92,
      date: '2026-09-28',
      title: 'Confirmar visita',
      related: visitClient.name,
      priority: 'Alta',
      assignedToId: 1,
      createdById: 1,
    }],
  }));
  assert.equal(activeOf('VISIT_UNCONFIRMED', visitTaskConditions).length, 1, 'dedupe tarea: alerta específica de visita permanece');
  assert.equal(activeOf('TASK_OVERDUE', visitTaskConditions).length, 0, 'dedupe tarea: recordatorio espejo no duplica la visita');
});

test('Block 2H derivación: la misma snapshot es determinística y la resolución vive sólo en estado comercial real', () => {
  const overdue = client(20, { nextAction: 'Llamar', nextFollowUp: '2026-09-27' });
  const input = evaluation({ clients: [overdue] });
  const first = evaluateCommercialAlertConditions(input);
  const second = evaluateCommercialAlertConditions(input);
  assert.deepEqual(second, first, 'misma snapshot produce exactamente las mismas condiciones derivadas');
  assert.equal(activeOf('FOLLOW_UP_OVERDUE', first).length, 1);

  const resolved = evaluateCommercialAlertConditions(evaluation({
    clients: [{ ...overdue, nextFollowUp: '2026-10-03' }],
  }));
  assert.equal(activeOf('FOLLOW_UP_OVERDUE', resolved).length, 0, 'reprogramar el estado real elimina la condición sin lifecycle paralelo');

  const matchClient = client(21, { qualificationUpdatedAt: '2026-09-29T10:00:00.000Z' });
  const matchProperty = property(21);
  const matchBefore = evaluateCommercialAlertConditions(evaluation({
    clients: [matchClient],
    properties: [matchProperty],
  }));
  assert.equal(activeOf('NEW_RELEVANT_MATCH', matchBefore).length, 1);
  const dismissal: ActivityEntry = {
    id: 210,
    actorId: 1,
    action: 'Match descartado',
    entityType: 'Cliente',
    entityId: matchClient.id,
    diffusionClientId: matchClient.id,
    diffusionPropertyId: matchProperty.id,
    detail: 'Descartado por usuario\npropertyRevision=2',
    createdAt: '2026-09-29T12:00:00.000Z',
  };
  const matchAfter = evaluateCommercialAlertConditions(evaluation({
    clients: [matchClient],
    properties: [matchProperty],
    activityLog: [dismissal],
  }));
  assert.equal(activeOf('NEW_RELEVANT_MATCH', matchAfter).length, 0, 'descartar el match persiste como actividad real y elimina la condición');
});

test('Block 2H seguridad/tenant: dedupe incluye organización y actor sólo ve asignaciones autorizadas', () => {
  const conditionA = {
    organizationId: ORG_A,
    type: 'FOLLOW_UP_OVERDUE' as const,
    entityType: 'client' as const,
    entityId: 1,
    conditionVersion: '2026-09-27:llamar',
  };
  const conditionB = { ...conditionA, organizationId: ORG_B };
  assert.notEqual(commercialAlertDedupeKey(conditionA), commercialAlertDedupeKey(conditionB), 'mismo entityId en tenants distintos no colisiona');

  const mine = client(30, { assignedToId: 1, nextAction: 'Llamar', nextFollowUp: '2026-09-27' });
  const other = client(31, { assignedToId: 2, nextAction: 'Llamar', nextFollowUp: '2026-09-27' });
  const agentConditions = evaluateCommercialAlertConditions(evaluation({
    clients: [mine, other],
    actor: { id: 1, role: 'Corredor' },
  }));
  assert.ok(agentConditions.some((condition) => condition.clientId === 30));
  assert.equal(agentConditions.some((condition) => condition.clientId === 31), false, 'Corredor no infiere alertas asignadas a otro miembro');

  const ownerConditions = evaluateCommercialAlertConditions(evaluation({
    clients: [mine, other],
    actor: { id: 1, role: 'Dueño' },
  }));
  assert.ok(ownerConditions.some((condition) => condition.clientId === 30));
  assert.ok(ownerConditions.some((condition) => condition.clientId === 31), 'Dueño conserva alcance organizacional');
});
