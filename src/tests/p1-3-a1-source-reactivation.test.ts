import assert from 'node:assert/strict';
import test from 'node:test';
import { clientFromFormValues } from '../client-editor.js';
import {
  LEAD_SOURCES,
  leadSourceChangeActivity,
  leadSourceDisplay,
  leadSourceMatchesFilter,
  leadSourceSummary,
  validateLeadSourceSelection,
} from '../lead-source.js';
import type { ActivityEntry, Client, Offer, Reservation, SyncedVisit } from '../models.js';
import {
  addIsoDays,
  reactivationCandidates,
  snoozeReactivation,
} from '../reactivation-engine.js';

function client(id: number, overrides: Partial<Client> = {}): Client {
  return {
    id,
    uid: `11111111-1111-4111-8111-${String(id).padStart(12, '0')}`,
    revision: 0,
    name: `Cliente ${id}`,
    phone: `549351555${String(id).padStart(4, '0')}`,
    interest: 'Departamento en Córdoba',
    status: 'Lead',
    temperature: 'Tibio',
    pipeline: 'Contactado',
    assignedToId: 1,
    createdById: 1,
    ...overrides,
  };
}

function activity(id: number, clientId: number, action: string, createdAt: string): ActivityEntry {
  return {
    id,
    actorId: 1,
    action,
    entityType: 'Cliente',
    entityId: clientId,
    detail: action,
    createdAt,
  };
}

const minimalForm = {
  name: 'Lead nuevo',
  phone: '5493515550199',
  interest: 'Casa zona norte',
  temperature: 'Tibio',
  pipeline: 'Nuevo',
};

test('Source: nuevo lead requiere origen y las fuentes V1 quedan cerradas', () => {
  assert.equal(LEAD_SOURCES.length, 14);
  assert.equal(validateLeadSourceSelection({ ...minimalForm, leadSource: '' }, null).ok, false);
  assert.equal(validateLeadSourceSelection({ ...minimalForm, leadSource: 'Meta Ads' }, null).ok, true);
  assert.throws(() => clientFromFormValues(90, { ...minimalForm, leadSource: '' }));
  const created = clientFromFormValues(90, {
    ...minimalForm,
    leadSource: 'Meta Ads',
    leadCampaign: 'Docta Septiembre',
  });
  assert.equal(created.leadSource, 'Meta Ads');
  assert.equal(created.leadCampaign, 'Docta Septiembre');
});

test('Source: histórico sin origen no rompe, muestra Origen no informado y puede editarse después', () => {
  const historical = client(1);
  assert.equal(leadSourceDisplay(historical), 'Origen no informado');
  assert.equal(validateLeadSourceSelection({}, historical).ok, true);
  const editedWithoutSource = clientFromFormValues(historical.id, {
    ...minimalForm,
    name: historical.name,
    phone: historical.phone,
  }, historical);
  assert.equal(editedWithoutSource.leadSource, undefined);
});

test('Source: Otro exige detalle y los textos de contexto quedan compactados', () => {
  assert.equal(validateLeadSourceSelection({ leadSource: 'Otro', leadSourceDetail: '' }, null).ok, false);
  assert.equal(validateLeadSourceSelection({ leadSource: 'Otro', leadSourceDetail: '  Feria   barrial  ' }, null).ok, true);
  const created = clientFromFormValues(91, {
    ...minimalForm,
    leadSource: 'Otro',
    leadSourceDetail: `  ${'x'.repeat(150)}  `,
  });
  assert.equal(created.leadSourceDetail?.length, 120);
});

test('Source: filtro distingue fuente y Origen no informado', () => {
  const meta = client(1, { leadSource: 'Meta Ads' });
  const zonaprop = client(2, { leadSource: 'Zonaprop' });
  const historical = client(3);
  assert.equal(leadSourceMatchesFilter(meta, 'Meta Ads'), true);
  assert.equal(leadSourceMatchesFilter(zonaprop, 'Meta Ads'), false);
  assert.equal(leadSourceMatchesFilter(historical, 'Origen no informado'), true);
  assert.equal([meta, zonaprop, historical].filter((item) => leadSourceMatchesFilter(item, 'Todas')).length, 3);
});

test('Source: cambio real produce una única Activity lógica; sin cambio no produce ninguna', () => {
  const previous = client(1, { leadSource: 'Zonaprop', leadSourceDetail: 'Depto General Paz' });
  const next = client(1, { leadSource: 'Meta Ads', leadCampaign: 'Docta Septiembre' });
  const change = leadSourceChangeActivity(previous, next);
  assert.equal(change?.action, 'Origen del lead actualizado');
  assert.match(change?.detail || '', /Zonaprop/);
  assert.match(change?.detail || '', /Meta Ads · Docta Septiembre/);
  assert.equal(leadSourceChangeActivity(next, { ...next }), null);
});

test('Source: resumen cuenta Leads/Ganados/Perdidos y nunca mezcla USD con ARS', () => {
  const clients = [
    client(1, {
      leadSource: 'Meta Ads', pipeline: 'Ganado', outcome: 'won', dealAmount: 100000, dealCurrency: 'USD',
      commissionAmount: 3000, commissionCurrency: 'USD',
    }),
    client(2, {
      leadSource: 'Meta Ads', pipeline: 'Ganado', outcome: 'won', dealAmount: 90000000, dealCurrency: 'ARS',
      commissionAmount: 2700000, commissionCurrency: 'ARS',
    }),
    client(3, { leadSource: 'Meta Ads', pipeline: 'Perdido', outcome: 'lost' }),
    client(4),
  ];
  const rows = leadSourceSummary(clients);
  const meta = rows.find((row) => row.source === 'Meta Ads')!;
  assert.equal(meta.leads, 3);
  assert.equal(meta.won, 2);
  assert.equal(meta.lost, 1);
  assert.deepEqual(meta.closedValueByCurrency, { USD: 100000, ARS: 90000000 });
  assert.deepEqual(meta.commissionByCurrency, { USD: 3000, ARS: 2700000 });
  assert.equal(rows.find((row) => row.source === 'Origen no informado')?.leads, 1);
});

test('Reactivation: terminales y follow-up vigente nunca aparecen; vencido sí aparece con días exactos', () => {
  const now = '2026-09-03';
  const candidates = reactivationCandidates([
    client(1, { pipeline: 'Ganado', outcome: 'won' }),
    client(2, { pipeline: 'Perdido', outcome: 'lost' }),
    client(3, { nextAction: 'Llamar', nextFollowUp: '2026-09-10' }),
    client(4, { nextAction: 'Llamar', nextFollowUp: '2026-08-26' }),
  ], [], { now });
  assert.deepEqual(candidates.map((item) => item.clientId), [4]);
  assert.equal(candidates[0]?.priority, 'Alta');
  assert.equal(candidates[0]?.reason, 'Seguimiento vencido hace 8 días');
});

test('Reactivation: sin próximo paso aparece una sola vez y la prioridad es determinística', () => {
  const clients = [client(1, { temperature: 'Tibio' }), client(2, { temperature: 'Caliente' })];
  const visit: SyncedVisit = {
    id: 1,
    clientId: 2,
    propertyId: 7,
    scheduledAt: '2026-08-20T18:00:00.000Z',
    status: 'Realizada',
    interest: 'Alto',
    assignedToId: 1,
    createdById: 1,
    createdAt: '2026-08-20T16:00:00.000Z',
    updatedAt: '2026-08-20T20:00:00.000Z',
  };
  const candidates = reactivationCandidates(clients, [], { now: '2026-09-03', visits: [visit] });
  assert.equal(new Set(candidates.map((item) => item.clientId)).size, candidates.length);
  assert.equal(candidates.find((item) => item.clientId === 1)?.reason, 'Sin próximo seguimiento');
  assert.equal(candidates.find((item) => item.clientId === 1)?.priority, 'Media');
  assert.equal(candidates.find((item) => item.clientId === 2)?.priority, 'Alta');
  assert.match(candidates.find((item) => item.clientId === 2)?.supportingReasons.join(' ') || '', /Visitó una propiedad/);
});

test('Reactivation: buckets 30/60/90 se asignan una sola vez con razón principal dormida', () => {
  const clients = [
    client(30, { nextAction: 'Contexto pendiente', lastContact: '2026-08-04' }),
    client(60, { nextAction: 'Contexto pendiente', lastContact: '2026-07-05' }),
    client(90, { nextAction: 'Contexto pendiente', lastContact: '2026-06-05' }),
  ];
  const candidates = reactivationCandidates(clients, [], { now: '2026-09-03' });
  assert.equal(candidates.find((item) => item.clientId === 30)?.dormantBucket, '30+');
  assert.equal(candidates.find((item) => item.clientId === 60)?.dormantBucket, '60+');
  assert.equal(candidates.find((item) => item.clientId === 90)?.dormantBucket, '90+');
  assert.equal(candidates.length, 3);
  candidates.forEach((candidate) => assert.match(candidate.reason, /Sin movimiento comercial hace/));
});

test('Reactivation: Visit/Offer/Reservation sólo elevan bajo reglas explícitas y exponen hito útil', () => {
  const visits: SyncedVisit[] = [{
    id: 1, clientId: 1, propertyId: 7, scheduledAt: '2026-08-20T18:00:00.000Z', status: 'Realizada', interest: 'Medio',
    assignedToId: 1, createdById: 1, createdAt: '2026-08-20T16:00:00.000Z', updatedAt: '2026-08-20T20:00:00.000Z',
  }];
  const offers: Offer[] = [{
    id: 1, clientId: 2, propertyId: 8, origin: 'Cliente', amount: 85000, currency: 'USD', status: 'Rechazada',
    assignedToId: 1, createdById: 1, createdAt: '2026-08-10T10:00:00.000Z', updatedAt: '2026-08-10T12:00:00.000Z',
  }];
  const reservations: Reservation[] = [{
    id: 1, clientId: 3, propertyId: 9, amount: 1000, currency: 'USD', reservedAt: '2026-07-10', status: 'Cancelada',
    assignedToId: 1, createdById: 1, createdAt: '2026-07-10T10:00:00.000Z', updatedAt: '2026-07-12T12:00:00.000Z',
  }];
  const clients = [
    client(1, { nextAction: 'Retomar con contexto' }),
    client(2, { nextAction: 'Retomar con contexto' }),
    client(3, { nextAction: 'Retomar con contexto' }),
    client(4, { nextAction: 'Retomar con contexto', lastContact: '2026-08-20' }),
  ];
  const candidates = reactivationCandidates(clients, [], { now: '2026-09-03', visits, offers, reservations });
  assert.equal(candidates.find((item) => item.clientId === 1)?.priority, 'Alta');
  assert.equal(candidates.find((item) => item.clientId === 2)?.priority, 'Alta');
  assert.equal(candidates.find((item) => item.clientId === 3)?.priority, 'Alta');
  assert.equal(candidates.some((item) => item.clientId === 4), false);
  assert.match(candidates.find((item) => item.clientId === 1)?.lastMilestone || '', /Visita realizada/);
});

test('Reactivation: snooze 7/30/60 oculta temporalmente y vuelve a ser elegible al vencer', () => {
  const base = client(1);
  for (const days of [7, 30, 60] as const) {
    const result = snoozeReactivation(base, days, '2026-09-03');
    assert.equal(result.client.reactivationSnoozedUntil, addIsoDays('2026-09-03', days));
    assert.equal(result.activity.action, 'Reactivación postergada');
    assert.equal(reactivationCandidates([result.client], [], { now: addIsoDays('2026-09-03', days - 1) }).length, 0);
    assert.equal(reactivationCandidates([result.client], [], { now: addIsoDays('2026-09-03', days) }).length, 1);
  }
});

test('Reactivation: la visibilidad se preserva porque el motor sólo itera Clients visibles y no revive IDs ajenos', () => {
  const visible = [client(1, { assignedToId: 1 })];
  const hidden = client(2, { assignedToId: 2 });
  const hiddenOffer: Offer = {
    id: 9, clientId: hidden.id, propertyId: 99, origin: 'Cliente', amount: 99999, currency: 'USD', status: 'Aceptada',
    assignedToId: 2, createdById: 2, createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-01T10:00:00.000Z',
  };
  const candidates = reactivationCandidates(visible, [activity(1, hidden.id, 'WhatsApp enviado', '2026-09-01T10:00:00.000Z')], {
    now: '2026-09-03',
    offers: [hiddenOffer],
  });
  assert.deepEqual(candidates.map((item) => item.clientId), [1]);
});
