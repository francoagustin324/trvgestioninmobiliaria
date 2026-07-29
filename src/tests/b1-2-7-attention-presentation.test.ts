import assert from 'node:assert/strict';
import test from 'node:test';
import { leadCardAttentionPresentation } from '../lead-card-attention.js';
import { renderCompactLeadCard } from '../lead-card-compact-ui.js';
import { leadPrimaryAlert } from '../lead-list-priority.js';
import type { Client } from '../models.js';

const today = '2026-07-29';

function lead(overrides: Partial<Client> = {}): Client {
  return {
    id: 1,
    name: 'Lead de prueba',
    phone: '5493515550001',
    email: 'lead@example.test',
    interest: 'Departamento de dos dormitorios',
    status: 'Lead',
    temperature: 'Tibio',
    pipeline: 'Contactado',
    assignedToId: 1,
    createdById: 1,
    ...overrides,
  };
}

function commerciallyComplete(overrides: Partial<Client> = {}): Client {
  return lead({
    budget: '120000',
    currency: 'USD',
    paymentMethod: 'Contado',
    zones: 'General Paz',
    purpose: 'Vivir',
    purchaseTimeframe: '0-3 meses',
    canMoveForward: 'Sí',
    ...overrides,
  });
}

const cardContext = {
  expanded: false,
  responsible: 'Franco Solís',
  qualificationPanel: '',
  history: '',
  matches: '',
};

test('LeadAlert incorpora un identificador semántico no persistente', () => {
  assert.equal(leadPrimaryAlert(lead({ nextFollowUp: '2026-07-09' }), today).kind, 'overdue');
  assert.equal(leadPrimaryAlert(lead({ pipeline: 'Nuevo' }), today).kind, 'new-uncontacted');
  assert.equal(leadPrimaryAlert(lead({ pipeline: 'Ganado', status: 'Operación ganada' }), today).kind, 'terminal');
});

test('vencido sin acción muestra una sola vez el vencimiento y recomienda definir acción', () => {
  const client = lead({ name: 'Grupo Norte', nextFollowUp: '2026-07-09' });
  const presentation = leadCardAttentionPresentation(client, today);
  assert.equal(presentation.alertKind, 'overdue');
  assert.equal(presentation.alertLabel, 'Vencido · 20 días');
  assert.equal(presentation.actionLabel, 'Definir acción');
  assert.equal(presentation.showDate, false);
  assert.equal(presentation.dateLabel, '');
  assert.match(presentation.alertFullLabel, /Seguimiento vencido hace 20 días/);
  assert.match(presentation.alertFullLabel, /09\/07\/2026/);
});

test('vencido con acción conserva la acción y no repite la fecha relativa', () => {
  const presentation = leadCardAttentionPresentation(lead({
    name: 'Edgardo',
    nextAction: 'Confirmar visita',
    nextFollowUp: '2026-07-09',
  }), today);
  assert.equal(presentation.alertLabel, 'Vencido · 20 días');
  assert.equal(presentation.actionLabel, 'Confirmar visita');
  assert.equal(presentation.showDate, false);
});

test('seguimiento de hoy muestra Hoy una sola vez', () => {
  const presentation = leadCardAttentionPresentation(lead({
    nextAction: 'Llamar al cliente',
    nextFollowUp: today,
  }), today);
  assert.equal(presentation.alertKind, 'due-today');
  assert.equal(presentation.alertLabel, 'Hoy');
  assert.equal(presentation.actionLabel, 'Llamar al cliente');
  assert.equal(presentation.showDate, false);
});

test('visita de hoy muestra la hora solo en la alerta', () => {
  const presentation = leadCardAttentionPresentation(lead({
    pipeline: 'Visita coordinada',
    nextAction: 'Confirmar visita a las 17:30',
    nextFollowUp: today,
  }), today);
  assert.equal(presentation.alertKind, 'visit-today');
  assert.equal(presentation.alertLabel, 'Visita hoy · 17:30');
  assert.equal(presentation.actionLabel, 'Confirmar visita');
  assert.equal(presentation.showDate, false);
});

test('seguimiento futuro conserva la fecha en la acción sin contaminar la alerta de calificación', () => {
  const presentation = leadCardAttentionPresentation(lead({
    budget: '120000',
    currency: 'USD',
    nextAction: 'Confirmar monto de entrega',
    nextFollowUp: '2026-08-01',
  }), today);
  assert.equal(presentation.alertKind, 'qualification-missing');
  assert.equal(presentation.alertLabel, 'Falta forma de pago');
  assert.equal(presentation.alertFullLabel, 'Falta forma de pago');
  assert.equal(presentation.actionLabel, 'Confirmar monto de entrega');
  assert.equal(presentation.showDate, true);
  assert.equal(presentation.dateLabel, 'En 3 días');
  assert.equal(presentation.actionTitle, 'Próxima acción: Confirmar monto de entrega. Programada para 01/08/2026.');
});

test('nuevo sin contactar recomienda el primer contacto sin mostrar Sin próxima acción', () => {
  const presentation = leadCardAttentionPresentation(lead({ pipeline: 'Nuevo', lastContact: undefined }), today);
  assert.equal(presentation.alertKind, 'new-uncontacted');
  assert.equal(presentation.alertLabel, 'Nuevo sin contactar');
  assert.equal(presentation.actionLabel, 'Contactar por primera vez');
  assert.equal(presentation.showDate, false);
  assert.doesNotMatch(`${presentation.alertLabel} ${presentation.actionLabel} ${presentation.dateLabel}`, /Sin próxima acción/);
});

test('calificado sin seguimiento usa una sola indicación y recomienda programarlo', () => {
  const presentation = leadCardAttentionPresentation(commerciallyComplete({ pipeline: 'Calificado' }), today);
  assert.equal(presentation.alertKind, 'no-follow-up');
  assert.equal(presentation.alertLabel, 'Sin seguimiento');
  assert.equal(presentation.actionLabel, 'Programar seguimiento');
  assert.equal(presentation.showDate, false);
  assert.doesNotMatch(`${presentation.alertLabel} ${presentation.actionLabel} ${presentation.dateLabel}`, /Calificado sin seguimiento|Sin próxima acción|Falta programar seguimiento/);
});

test('sin acción ni fecha fuera de Nuevo y Calificado oculta el badge genérico', () => {
  const presentation = leadCardAttentionPresentation(commerciallyComplete({ pipeline: 'Contactado' }), today);
  assert.equal(presentation.alertKind, 'no-action');
  assert.equal(presentation.showAlert, false);
  assert.equal(presentation.actionLabel, 'Definir próxima acción');
  assert.equal(presentation.showAction, true);
});

test('Ganado y Perdido se comunican solamente mediante la etapa', () => {
  for (const [pipeline, status] of [
    ['Ganado', 'Operación ganada'],
    ['Perdido', 'Operación perdida'],
  ] as const) {
    const presentation = leadCardAttentionPresentation(lead({
      pipeline,
      status,
      nextAction: 'Seguimiento heredado',
      nextFollowUp: '2026-07-09',
    }), today);
    assert.equal(presentation.alertKind, 'terminal');
    assert.equal(presentation.showAlert, false);
    assert.equal(presentation.showAction, false);
    assert.equal(presentation.actionLabel, '');
    assert.equal(presentation.dateLabel, '');
    assert.equal(presentation.scheduledDateLabel, '09/07/2026');
  }
});

test('la ficha terminal presenta la fecha histórica como registro y no como obligación activa', () => {
  const withHistory = renderCompactLeadCard(lead({
    pipeline: 'Ganado',
    status: 'Operación ganada',
    nextAction: 'Seguimiento heredado',
    nextFollowUp: '2026-07-09',
  }), cardContext);
  assert.match(withHistory, /<span>Fecha de seguimiento registrada<\/span><strong>09\/07\/2026<\/strong>/);
  assert.doesNotMatch(withHistory, /<span>Seguimiento programado<\/span>/);
  assert.doesNotMatch(withHistory, /class="mvp-lead-next-action/);

  const withoutHistory = renderCompactLeadCard(lead({
    pipeline: 'Perdido',
    status: 'Operación perdida',
    nextAction: undefined,
    nextFollowUp: undefined,
  }), cardContext);
  assert.match(withoutHistory, /<span>Seguimiento<\/span><strong>Sin seguimiento pendiente<\/strong>/);
  assert.doesNotMatch(withoutHistory, /<span>Seguimiento programado<\/span>/);
});

test('la presentación no modifica ni persiste nextFollowUp ni nextAction', () => {
  const client = lead({ nextAction: undefined, nextFollowUp: '2026-07-09' });
  const before = structuredClone(client);
  const presentation = leadCardAttentionPresentation(client, today);
  assert.deepEqual(client, before);
  assert.equal(client.nextAction, undefined);
  assert.equal(client.nextFollowUp, '2026-07-09');
  assert.equal(presentation.actionLabel, 'Definir acción');
  assert.equal(presentation.scheduledDate, '2026-07-09');
});
