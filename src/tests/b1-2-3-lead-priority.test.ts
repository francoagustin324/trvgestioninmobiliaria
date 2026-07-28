import assert from 'node:assert/strict';
import test from 'node:test';
import type { Client } from '../models.js';
import {
  leadFollowUpPresentation,
  leadPrimaryAlert,
  relativeLeadDate,
  sortLeadsForDailyWork,
} from '../lead-daily-priority.js';

function lead(overrides: Partial<Client> = {}): Client {
  return {
    id: overrides.id ?? 1,
    name: overrides.name ?? 'Lead de prueba',
    phone: overrides.phone ?? '5493515110069',
    interest: overrides.interest ?? 'Dúplex en Córdoba',
    status: overrides.status ?? 'Lead',
    temperature: overrides.temperature ?? 'Tibio',
    pipeline: overrides.pipeline ?? 'Contactado',
    ...overrides,
  };
}

const today = '2026-07-28';

test('B1.2.3 muestra una única alerta principal priorizada', () => {
  assert.equal(leadPrimaryAlert(lead({ nextFollowUp: '2026-07-20', nextAction: 'Llamar' }), today).label, 'Seguimiento vencido hace 8 días');
  assert.equal(leadPrimaryAlert(lead({ pipeline: 'Nuevo', lastContact: undefined }), today).label, 'Nuevo sin contactar');
  assert.equal(leadPrimaryAlert(lead({ pipeline: 'Visita coordinada', nextFollowUp: today, nextAction: 'Visita a las 17:30' }), today).label, 'Visita hoy a las 17:30');
  assert.equal(leadPrimaryAlert(lead({ pipeline: 'Calificado', budget: 'USD 120.000', currency: 'USD', paymentMethod: 'Contado', zones: 'Docta', purpose: 'Vivir', purchaseTimeframe: '0-3 meses', canMoveForward: 'Sí' }), today).label, 'Calificado sin seguimiento');
});

test('B1.2.3 expresa fechas con contexto comercial', () => {
  assert.equal(relativeLeadDate(today, today), 'Hoy');
  assert.equal(relativeLeadDate('2026-07-29', today), 'Mañana');
  assert.equal(relativeLeadDate('2026-07-27', today), 'Vencido ayer');
  assert.equal(relativeLeadDate('2026-07-23', today), 'Vencido hace 5 días');
  assert.equal(relativeLeadDate('2026-07-31', today), 'En 3 días');
  assert.equal(relativeLeadDate('2026-11-11', today), '11/11/2026');
});

test('B1.2.3 resuelve combinaciones incompletas de próxima acción sin borrar datos', () => {
  assert.equal(leadFollowUpPresentation(lead({ nextFollowUp: '2026-07-20' }), today)?.combined, 'Definir acción · fecha vencida');
  assert.equal(leadFollowUpPresentation(lead({ nextAction: 'Enviar opciones' }), today)?.combined, 'Enviar opciones · Falta programar fecha');
  assert.equal(leadFollowUpPresentation(lead(), today)?.combined, 'Sin próxima acción');
  assert.equal(leadFollowUpPresentation(lead({ pipeline: 'Ganado', nextAction: 'Dato histórico', nextFollowUp: '2026-07-20' }), today), null);
});

test('B1.2.3 ordena vencidos, nuevos, hoy, calificados y terminales al final', () => {
  const rows = [
    lead({ id: 1, name: 'Ganado', pipeline: 'Ganado' }),
    lead({ id: 2, name: 'Tibio', temperature: 'Tibio' }),
    lead({ id: 3, name: 'Vencido', nextFollowUp: '2026-07-20', nextAction: 'Llamar' }),
    lead({ id: 4, name: 'Nuevo', pipeline: 'Nuevo', lastContact: undefined }),
    lead({ id: 5, name: 'Hoy', nextFollowUp: today, nextAction: 'Contactar' }),
    lead({ id: 6, name: 'Calificado', pipeline: 'Calificado' }),
    lead({ id: 7, name: 'Perdido', pipeline: 'Perdido' }),
  ];
  assert.deepEqual(sortLeadsForDailyWork(rows, 'Prioridad', today).map((item) => item.name), [
    'Vencido', 'Nuevo', 'Hoy', 'Calificado', 'Tibio', 'Ganado', 'Perdido',
  ]);
});

test('B1.2.3 conserva compatibilidad con Leads históricos', () => {
  const historical = lead({ budget: undefined, currency: undefined, nextAction: undefined, nextFollowUp: undefined });
  assert.doesNotThrow(() => leadPrimaryAlert(historical, today));
  assert.doesNotThrow(() => sortLeadsForDailyWork([historical], 'Prioridad', today));
});
