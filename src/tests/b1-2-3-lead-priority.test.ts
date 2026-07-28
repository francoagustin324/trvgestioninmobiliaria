import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  leadFollowUpDisplay,
  leadPrimaryAlert,
  readableLeadAssignee,
  relativeLeadDate,
  sortLeads,
} from '../lead-list-priority.js';
import { completeClientFollowUp, reprogramClientFollowUp } from '../lead-pipeline.js';
import type { Client, TeamMember } from '../models.js';

function client(id: number, overrides: Partial<Client> = {}): Client {
  return {
    id,
    name: `Lead ${id}`,
    phone: `549351555${String(id).padStart(4, '0')}`,
    interest: 'Departamento en Córdoba',
    status: 'Lead',
    temperature: 'Tibio',
    pipeline: 'Contactado',
    ...overrides,
  };
}

const today = '2026-07-28';

test('calcula una sola alerta principal respetando la prioridad comercial', () => {
  assert.equal(leadPrimaryAlert(client(1, { nextFollowUp: '2026-07-20', nextAction: 'Llamar' }), today).label, 'Seguimiento vencido hace 8 días');
  assert.equal(leadPrimaryAlert(client(2, { pipeline: 'Nuevo', lastContact: undefined }), today).label, 'Nuevo sin contactar');
  assert.equal(leadPrimaryAlert(client(3, { pipeline: 'Visita coordinada', nextFollowUp: today, nextAction: 'Visita a las 17:30' }), today).label, 'Visita hoy a las 17:30');
  assert.equal(leadPrimaryAlert(client(4, { nextFollowUp: today, nextAction: 'Enviar opciones' }), today).label, 'Contactar hoy');
  assert.equal(leadPrimaryAlert(client(5, { pipeline: 'Calificado', nextFollowUp: undefined, nextAction: undefined }), today).label, 'Calificado sin seguimiento');
  assert.equal(leadPrimaryAlert(client(6, { budget: '', paymentMethod: '' }), today).label, 'Falta presupuesto');
  assert.equal(leadPrimaryAlert(client(7, { budget: 'USD 100.000', currency: 'USD', paymentMethod: '' }), today).label, 'Falta forma de pago');
  assert.equal(leadPrimaryAlert(client(8, { budget: 'USD 100.000', currency: 'USD', paymentMethod: 'Contado', canMoveForward: 'No confirmado' }), today).label, 'Falta confirmar capacidad de avance');
  assert.equal(leadPrimaryAlert(client(9, { budget: 'USD 100.000', currency: 'USD', paymentMethod: 'Contado', canMoveForward: 'Todavía no' }), today).label, 'No listo todavía');
  assert.equal(leadPrimaryAlert(client(10, { pipeline: 'Ganado' }), today).label, 'Ganado');
});

test('expresa fechas comerciales y resuelve combinaciones inconsistentes sin borrar datos', () => {
  assert.equal(relativeLeadDate('2026-07-28', today), 'Hoy');
  assert.equal(relativeLeadDate('2026-07-29', today), 'Mañana');
  assert.equal(relativeLeadDate('2026-07-27', today), 'Vencido ayer');
  assert.equal(relativeLeadDate('2026-07-23', today), 'Vencido hace 5 días');
  assert.equal(relativeLeadDate('2026-07-31', today), 'En 3 días');
  assert.equal(relativeLeadDate('2026-11-11', today), '11/11/2026');

  assert.deepEqual(
    leadFollowUpDisplay(client(1, { nextFollowUp: '2026-07-09', nextAction: undefined }), today),
    { action: 'Definir acción', dateLabel: 'fecha vencida hace 19 días', state: 'missing-action' },
  );
  assert.deepEqual(
    leadFollowUpDisplay(client(2, { nextAction: 'Enviar documentación', nextFollowUp: undefined }), today),
    { action: 'Enviar documentación', dateLabel: 'Falta programar fecha', state: 'missing-date' },
  );
  assert.deepEqual(
    leadFollowUpDisplay(client(3), today),
    { action: 'Sin próxima acción', dateLabel: '', state: 'empty' },
  );
  assert.deepEqual(
    leadFollowUpDisplay(client(4, { pipeline: 'Perdido', nextAction: 'Dato histórico', nextFollowUp: '2026-07-01' }), today),
    { action: 'Operación cerrada', dateLabel: '', state: 'terminal' },
  );
});

test('ordena por prioridad después de separar terminales', () => {
  const leads = [
    client(1, { name: 'Ganado', pipeline: 'Ganado', temperature: 'Caliente' }),
    client(2, { name: 'Tibio', temperature: 'Tibio' }),
    client(3, { name: 'Caliente', temperature: 'Caliente' }),
    client(4, { name: 'Vencido', nextAction: 'Llamar', nextFollowUp: '2026-07-20' }),
    client(5, { name: 'Nuevo', pipeline: 'Nuevo', lastContact: undefined }),
    client(6, { name: 'Hoy', nextAction: 'Enviar opciones', nextFollowUp: today }),
    client(7, { name: 'Visita', pipeline: 'Visita coordinada', nextAction: 'Visita', nextFollowUp: '2026-07-30' }),
    client(8, { name: 'Calificado sin acción', pipeline: 'Calificado', nextAction: undefined, nextFollowUp: undefined }),
    client(9, { name: 'Perdido', pipeline: 'Perdido', temperature: 'Caliente' }),
  ];
  assert.deepEqual(sortLeads(leads, 'priority', today).map((item) => item.name), [
    'Vencido',
    'Nuevo',
    'Hoy',
    'Visita',
    'Calificado sin acción',
    'Caliente',
    'Tibio',
    'Perdido',
    'Ganado',
  ]);
  assert.deepEqual(sortLeads(leads, 'name', today).slice(-2).map((item) => item.name), ['Ganado', 'Perdido']);
});

test('resuelve responsable sin mostrar identificadores técnicos', () => {
  const members: TeamMember[] = [{
    id: 1,
    name: 'trvgestioninmobiliaria',
    email: 'franco.solis@example.com',
    role: 'Dueño',
    status: 'Activo',
    createdAt: '2026-07-01T00:00:00.000Z',
  }, {
    id: 2,
    name: 'María Corredora',
    email: 'maria@example.com',
    role: 'Corredor',
    status: 'Activo',
    createdAt: '2026-07-01T00:00:00.000Z',
  }];
  assert.equal(readableLeadAssignee(client(1, { assignedToId: 2 }), members, 'Franco Solís', 'franco@example.com'), 'María Corredora');
  assert.equal(readableLeadAssignee(client(2, { assignedToId: 1 }), members, 'Franco Solís', 'franco@example.com'), 'Franco Solís');
  assert.equal(readableLeadAssignee(client(3, { assignedToId: 1 }), members, '', 'franco.solis@example.com'), 'Franco Solis');
  assert.equal(readableLeadAssignee(client(4, { assignedToId: undefined }), [], '', ''), 'Sin asignar');
});

test('completar y reprogramar seguimiento reutiliza las reglas existentes sin crear Reminder', () => {
  const original = client(1, { nextAction: 'Llamar', nextFollowUp: '2026-07-30' });
  const reprogrammed = reprogramClientFollowUp(original, '2026-08-02');
  assert.equal(reprogrammed.client.nextAction, 'Llamar');
  assert.equal(reprogrammed.client.nextFollowUp, '2026-08-02');
  const completed = completeClientFollowUp(reprogrammed.client, new Date('2026-07-28T12:00:00.000Z'));
  assert.equal(completed.client.nextAction, undefined);
  assert.equal(completed.client.nextFollowUp, undefined);
  assert.equal(completed.client.lastContact, '2026-07-28');
  assert.equal('reminder' in completed, false);
});

test('la integración conserva permisos, matching, Agenda y calificación automática', () => {
  const source = readFileSync('src/mvp-leads-ui.ts', 'utf8');
  assert.match(source, /filterLeads\(visibleClients\(\), filters\)/);
  assert.match(source, /sortLeads\(assigned, filters\.order\)/);
  assert.match(source, /matchPropertiesForClient/);
  assert.match(source, /renderLeadQualificationPanel/);
  assert.match(source, /completeClientFollowUp/);
  assert.match(source, /reprogramClientFollowUp/);
  assert.match(source, /data-lead-full-sheet/);
  assert.match(source, /data-clear-lead-filters/);
});

test('un Lead histórico sin campos nuevos continúa siendo ordenable y renderizable', () => {
  const historical = client(91, {
    budget: undefined,
    currency: undefined,
    paymentMethod: undefined,
    purchaseTimeframe: undefined,
    canMoveForward: undefined,
    assignedToId: undefined,
  });
  assert.doesNotThrow(() => sortLeads([historical], 'priority', today));
  assert.equal(leadPrimaryAlert(historical, today).label, 'Falta presupuesto');
  assert.equal(readableLeadAssignee(historical, [], '', ''), 'Sin asignar');
});
