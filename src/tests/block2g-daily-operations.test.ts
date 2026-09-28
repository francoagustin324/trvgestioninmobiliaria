import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { operationalAttentionQueue, renderOperationalAttentionQueue } from '../lead-attention-queue.js';
import { renderCompactLeadCard } from '../lead-card-compact-ui.js';
import type { ActivityEntry, Client, Offer, Property, Reminder, Reservation, Visit } from '../models.js';

const TODAY = '2026-09-28';
const NOW = new Date('2026-09-28T15:00:00Z');

function client(id: number, overrides: Partial<Client> = {}): Client {
  return {
    id,
    uid: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
    name: `Cliente ${id}`,
    phone: `549351555${String(id).padStart(4, '0')}`,
    interest: 'Departamento 2 dormitorios General Paz',
    status: 'Lead',
    temperature: 'Tibio',
    pipeline: 'Contactado',
    lastContact: TODAY,
    nextAction: 'Enviar opciones',
    nextFollowUp: '2026-10-02',
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
    title: `Departamento General Paz ${id}`,
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

test('Block 2G A-M: Qué hacer ahora ordena trabajo real sin duplicar ni tocar contratos 2F', () => {
  const clients: Client[] = [
    client(1, { name: 'Lead nuevo', pipeline: 'Nuevo', lastContact: undefined, nextAction: undefined, nextFollowUp: undefined }),
    client(2, { name: 'Follow-up vencido', temperature: 'Caliente', nextAction: 'Llamar por financiación', nextFollowUp: '2026-09-26' }),
    client(3, { name: 'Visita hoy', pipeline: 'Visita coordinada', nextAction: 'Confirmar visita 18:00', nextFollowUp: TODAY }),
    client(4, { name: 'Oferta frenada', pipeline: 'Negociación', nextAction: 'Esperar respuesta', nextFollowUp: '2026-10-01' }),
    client(5, { name: 'Reserva urgente', pipeline: 'Reservado', nextAction: 'Revisar reserva', nextFollowUp: '2026-09-29' }),
    client(6, { name: 'Match nuevo', nextFollowUp: '2026-10-10' }),
    client(7, { name: 'Visita incompleta', pipeline: 'Visita coordinada', nextAction: undefined, nextFollowUp: undefined }),
  ];
  const properties = [property(10), property(11)];
  const activities: ActivityEntry[] = [{
    id: 1,
    actorId: 1,
    action: 'Lead creado',
    entityType: 'Cliente',
    entityId: 1,
    detail: 'Alta',
    createdAt: '2026-09-28T14:25:00Z',
  }];
  const visits: Visit[] = [
    { id: 1, clientId: 3, propertyId: 10, scheduledAt: '2026-09-28T18:00:00Z', status: 'Coordinada', assignedToId: 1, createdById: 1, createdAt: '2026-09-27T10:00:00Z', updatedAt: '2026-09-27T10:00:00Z' },
    { id: 2, clientId: 7, propertyId: 11, scheduledAt: '2026-09-27T18:00:00Z', status: 'Realizada', assignedToId: 1, createdById: 1, createdAt: '2026-09-26T10:00:00Z', updatedAt: '2026-09-27T19:00:00Z' },
  ];
  const offers: Offer[] = [{
    id: 1,
    clientId: 4,
    propertyId: 10,
    origin: 'Cliente',
    amount: 108000,
    currency: 'USD',
    status: 'Pendiente',
    assignedToId: 1,
    createdById: 1,
    createdAt: '2026-09-24T12:00:00Z',
    updatedAt: '2026-09-25T12:00:00Z',
  }];
  const reservations: Reservation[] = [{
    id: 1,
    clientId: 5,
    propertyId: 10,
    amount: 5000,
    currency: 'USD',
    reservedAt: '2026-09-25',
    expiresAt: '2026-09-28',
    status: 'Activa',
    assignedToId: 1,
    createdById: 1,
    createdAt: '2026-09-25T12:00:00Z',
    updatedAt: '2026-09-26T12:00:00Z',
  }];
  const reminders: Reminder[] = [{
    id: 1,
    date: '2026-09-27',
    title: 'Enviar documentación',
    related: 'Oferta frenada',
    priority: 'Alta',
    assignedToId: 1,
    createdById: 1,
  }];

  const input = {
    clients,
    properties,
    visits,
    offers,
    reservations,
    reminders,
    activityLog: activities,
    actor: { id: 1, role: 'Dueño' as const },
    today: TODAY,
    now: NOW,
  };

  const queue = operationalAttentionQueue(input, 20);

  assert.ok(queue.some((item) => item.kind === 'new-uncontacted' && item.clientId === 1), 'A: lead nuevo aparece');
  assert.ok(queue.some((item) => item.kind === 'follow-up-overdue' && item.clientId === 2), 'C: follow-up vencido aparece');
  assert.ok(queue.some((item) => item.kind === 'visit-confirm' && item.clientId === 3), 'D: visita próxima genera acción');
  assert.ok(queue.some((item) => item.kind === 'visit-result' && item.clientId === 7), 'E: visita realizada/incompleta genera acción');
  assert.ok(queue.some((item) => item.kind === 'offer-stalled' && item.clientId === 4), 'F: oferta frenada aparece');
  assert.ok(queue.some((item) => item.kind === 'new-match' && item.clientId === 6), 'G: match nuevo relevante aparece');
  assert.ok(queue.some((item) => item.kind === 'reservation-attention' && item.clientId === 5), 'reserva pendiente aparece');
  assert.ok(queue.some((item) => item.kind === 'task-overdue'), 'tarea vencida aparece');

  const contacted = clients.map((value) => value.id === 1
    ? { ...value, pipeline: 'Contactado', lastContact: TODAY, nextAction: 'Enviar opciones', nextFollowUp: '2026-10-05' }
    : value);
  assert.equal(
    operationalAttentionQueue({ ...input, clients: contacted }, 20).some((item) => item.kind === 'new-uncontacted' && item.clientId === 1),
    false,
    'B: atendido deja de estar pendiente de primera atención',
  );

  const resolvedOffers = offers.map((value) => ({ ...value, status: 'Aceptada' as const, updatedAt: NOW.toISOString() }));
  assert.equal(
    operationalAttentionQueue({ ...input, offers: resolvedOffers }, 20).some((item) => item.kind === 'offer-stalled' && item.sourceId === 1),
    false,
    'I: resolver oferta actualiza la lista',
  );

  const keys = queue.map((item) => item.key);
  assert.equal(new Set(keys).size, keys.length, 'J: no hay duplicados de situación');
  const perClient = new Map<number, number>();
  queue.forEach((item) => {
    if (item.clientId) perClient.set(item.clientId, (perClient.get(item.clientId) ?? 0) + 1);
  });
  assert.ok([...perClient.values()].every((count) => count <= 2), 'J: anti-spam limita acciones repetidas por cliente');

  const html = renderOperationalAttentionQueue(input, 8);
  assert.match(html, /QUÉ HACER AHORA/);
  assert.match(html, /data-operational-action=/);
  assert.match(html, /CRÍTICO|ALTO|NORMAL/);

  const overdueCard = renderCompactLeadCard(client(20, {
    nextAction: 'Enviar contraoferta',
    nextFollowUp: '2026-09-27',
  }), {
    expanded: false,
    responsible: 'Franco',
    qualificationPanel: '',
    history: '',
    matches: '',
  });
  assert.match(overdueCard, /Próxima acción vencida/, 'H: nextAction vencida queda explícita en la ficha');

  const css = readFileSync('src/lead-attention-queue.css', 'utf8');
  assert.match(css, /pc-daily-ops-item\.pc-supervised-attention-item[\s\S]*?min-height:\s*74px/);
  assert.match(css.slice(css.indexOf('@media (max-width: 720px)')), /pc-daily-ops-item\.pc-supervised-attention-item[\s\S]*?min-height:\s*58px/);
  assert.equal(css.includes('position: fixed'), false, 'K: cola mobile no agrega overlay fijo');
  assert.equal(css.includes('position: absolute'), false, 'K: cola mobile no agrega overlay absoluto');

  const queueSource = readFileSync('src/lead-attention-queue.ts', 'utf8');
  for (const forbidden of ['saveData(', 'queueCloudSave(', 'pushCloudData(']) {
    assert.equal(queueSource.includes(forbidden), false, `cola derivada no escribe: ${forbidden}`);
  }

  const concurrency = readFileSync('src/tenant-visit-v2.ts', 'utf8');
  assert.match(concurrency, /clientSnapshotCasV2|client_snapshot_cas_v2/, 'L/M: Client CAS sigue presente');
  assert.match(concurrency, /propertySnapshotCasV1|property_snapshot_cas_v1/, 'L/M: Property CAS sigue presente');
  assert.match(concurrency, /pushCloudDataWithVisitAuthorityV2/, 'L/M: autoridad Visit 2F sigue presente');
});
