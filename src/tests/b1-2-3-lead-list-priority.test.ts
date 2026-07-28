import assert from 'node:assert/strict';
import test from 'node:test';
import type { Client, TeamMember } from '../models.js';
import { followUpDisplay, primaryLeadAlert, readableResponsible, relativeCommercialDate, sortLeads } from '../lead-list-priority.js';

const base: Client = { id: 1, name: 'Lead', phone: '3515550000', interest: 'Departamento', status: 'Lead', temperature: 'Tibio', pipeline: 'Contactado', assignedToId: 1 };

test('B1.2.3 calcula fechas comerciales comprensibles', () => {
  assert.equal(relativeCommercialDate('2026-07-28', '2026-07-28'), 'Hoy');
  assert.equal(relativeCommercialDate('2026-07-29', '2026-07-28'), 'Mañana');
  assert.equal(relativeCommercialDate('2026-07-23', '2026-07-28'), 'Vencido hace 5 días');
  assert.equal(relativeCommercialDate('2026-08-20', '2026-07-28'), '20/08/2026');
});

test('B1.2.3 resuelve inconsistencias de próxima acción sin borrar datos', () => {
  assert.deepEqual(followUpDisplay({ ...base, nextFollowUp: '2026-07-20' }, '2026-07-28'), { action: 'Definir acción', date: 'Vencido hace 8 días · falta detalle', pending: true });
  assert.deepEqual(followUpDisplay({ ...base, nextAction: 'Llamar' }, '2026-07-28'), { action: 'Llamar', date: 'Falta programar fecha', pending: true });
  assert.equal(followUpDisplay({ ...base, pipeline: 'Ganado', nextAction: 'No mostrar', nextFollowUp: '2026-07-20' }).pending, false);
});

test('B1.2.3 prioriza una única alerta comercial', () => {
  assert.match(primaryLeadAlert({ ...base, nextFollowUp: '2026-07-09' }, '2026-07-28').label, /vencido hace 19 días/i);
  assert.equal(primaryLeadAlert({ ...base, pipeline: 'Nuevo', lastContact: undefined }, '2026-07-28').label, 'Nuevo sin contactar');
  assert.equal(primaryLeadAlert({ ...base, pipeline: 'Visita coordinada', nextFollowUp: '2026-07-28' }, '2026-07-28').label, 'Visita hoy');
});

test('B1.2.3 ordena terminales al final y vencidos primero', () => {
  const clients = [
    { ...base, id: 1, name: 'Ganado', pipeline: 'Ganado' },
    { ...base, id: 2, name: 'Normal', nextFollowUp: '2026-08-02' },
    { ...base, id: 3, name: 'Vencido', nextFollowUp: '2026-07-20' },
    { ...base, id: 4, name: 'Perdido', pipeline: 'Perdido' },
  ];
  assert.deepEqual(sortLeads(clients, 'priority', '2026-07-28').map((client) => client.name), ['Vencido', 'Normal', 'Ganado', 'Perdido']);
});

test('B1.2.3 resuelve responsable sin identificadores técnicos', () => {
  const members: TeamMember[] = [{ id: 1, userId: 'u1', name: 'trvgestioninmobiliaria', email: 'franco.solis@example.com', role: 'Dueño', status: 'Activo', createdAt: '2026-01-01' }];
  assert.equal(readableResponsible(base, members, 'Franco Solís', 'franco@example.com'), 'Franco Solís');
  assert.equal(readableResponsible({ ...base, assignedToId: 99 }, [], '', 'franco.solis@example.com'), 'Franco Solis');
});
