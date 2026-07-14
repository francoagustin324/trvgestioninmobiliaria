import assert from 'node:assert/strict';
import test from 'node:test';
import type { TeamMember } from '../models.js';
import {
  activeMembers,
  assignmentVisible,
  roleCanAccessModule,
  roleCanManageTeam,
  roleCanViewAll,
  seatAvailable,
  validSeatLimit,
} from '../team-policy.js';

const members: TeamMember[] = [
  { id: 1, name: 'Dueño', email: 'dueno@example.com', role: 'Dueño', status: 'Activo', createdAt: '2026-07-13T00:00:00.000Z' },
  { id: 2, name: 'Admin', email: 'admin@example.com', role: 'Administrador', status: 'Activo', createdAt: '2026-07-13T00:00:00.000Z' },
  { id: 3, name: 'Corredor', email: 'corredor@example.com', role: 'Corredor', status: 'Pendiente de acceso', createdAt: '2026-07-13T00:00:00.000Z' },
  { id: 4, name: 'Suspendido', email: 'suspendido@example.com', role: 'Corredor', status: 'Suspendido', createdAt: '2026-07-13T00:00:00.000Z' },
];

test('dueño y administrador gestionan usuarios; corredor no', () => {
  assert.equal(roleCanManageTeam('Dueño'), true);
  assert.equal(roleCanManageTeam('Administrador'), true);
  assert.equal(roleCanManageTeam('Corredor'), false);
});

test('dueño y administrador ven toda la operación', () => {
  assert.equal(roleCanViewAll('Dueño'), true);
  assert.equal(roleCanViewAll('Administrador'), true);
  assert.equal(roleCanViewAll('Corredor'), false);
});

test('corredor solo accede a los módulos operativos del MVP', () => {
  assert.equal(roleCanAccessModule('Corredor', 'crm'), true);
  assert.equal(roleCanAccessModule('Corredor', 'whatsapp'), true);
  assert.equal(roleCanAccessModule('Corredor', 'agenda'), true);
  assert.equal(roleCanAccessModule('Corredor', 'propiedades'), true);
  assert.equal(roleCanAccessModule('Corredor', 'equipo'), false);
  assert.equal(roleCanAccessModule('Corredor', 'reportes'), false);
  assert.equal(roleCanAccessModule('Corredor', 'configuracion'), false);
  assert.equal(roleCanAccessModule('Dueño', 'equipo'), true);
});

test('corredor solo ve registros asignados; superiores ven todos', () => {
  assert.equal(assignmentVisible('Corredor', 3, 3), true);
  assert.equal(assignmentVisible('Corredor', 3, 2), false);
  assert.equal(assignmentVisible('Corredor', 3, undefined), false);
  assert.equal(assignmentVisible('Administrador', 2, 3), true);
  assert.equal(assignmentVisible('Dueño', 1, undefined), true);
});

test('los suspendidos no consumen cupo operativo', () => {
  assert.deepEqual(activeMembers(members).map((member) => member.id), [1, 2, 3]);
  assert.equal(seatAvailable(members, null), true);
  assert.equal(seatAvailable(members, 4), true);
  assert.equal(seatAvailable(members, 3), false);
  assert.equal(validSeatLimit(members, 2), false);
  assert.equal(validSeatLimit(members, 3), true);
  assert.equal(validSeatLimit(members, null), true);
});

test('el sistema admite equipos grandes sin una cifra fija', () => {
  const largeTeam = Array.from({ length: 100 }, (_, index): TeamMember => ({
    id: index + 1,
    name: `Usuario ${index + 1}`,
    email: `usuario${index + 1}@example.com`,
    role: index === 0 ? 'Dueño' : 'Corredor',
    status: 'Activo',
    createdAt: '2026-07-13T00:00:00.000Z',
  }));
  assert.equal(seatAvailable(largeTeam, null), true);
  assert.equal(seatAvailable(largeTeam, 100), false);
  assert.equal(seatAvailable(largeTeam, 101), true);
});
