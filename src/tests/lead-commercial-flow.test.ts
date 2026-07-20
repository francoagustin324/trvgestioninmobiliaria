import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildCommercialProgress,
  COMMERCIAL_STAGES,
  isCommercialStage,
} from '../lead-commercial-flow.js';
import type { Client } from '../models.js';

const baseClient: Client = {
  id: 7,
  name: 'Cliente de prueba',
  phone: '3515550101',
  interest: 'Departamento de dos dormitorios',
  status: 'Lead',
  temperature: 'Tibio',
  pipeline: 'Nuevo',
  nextFollowUp: '2026-07-22',
  assignedToId: 3,
  createdById: 1,
};

test('el flujo comercial reconoce únicamente las etapas permitidas', () => {
  assert.equal(COMMERCIAL_STAGES.length, 7);
  assert.equal(isCommercialStage('Visita coordinada'), true);
  assert.equal(isCommercialStage('Cualquier estado'), false);
});

test('coordinar una visita actualiza el lead, registra actividad y propone un seguimiento', () => {
  const result = buildCommercialProgress(baseClient, {
    stage: 'Visita coordinada',
    note: 'Visita confirmada con el cliente.',
    scheduledDate: '2026-07-25',
    now: new Date('2026-07-20T12:00:00.000Z'),
  });

  assert.equal(result.client.pipeline, 'Visita coordinada');
  assert.equal(result.client.lastContact, '2026-07-20');
  assert.equal(result.client.nextFollowUp, '2026-07-25');
  assert.equal(result.client.status, 'Lead');
  assert.deepEqual(result.reminder, {
    date: '2026-07-25',
    title: 'Visita con Cliente de prueba',
    related: 'Cliente de prueba',
    priority: 'Media',
  });
  assert.equal(result.activity.entityType, 'Cliente');
  assert.equal(result.activity.entityId, 7);
  assert.ok(result.activity.detail.includes('Visita coordinada'));
  assert.ok(result.activity.detail.includes('Visita confirmada con el cliente.'));
});

test('una operación ganada cierra el seguimiento y no crea otro recordatorio', () => {
  const result = buildCommercialProgress(baseClient, {
    stage: 'Ganada',
    scheduledDate: '2026-07-30',
    now: new Date('2026-07-20T12:00:00.000Z'),
  });

  assert.equal(result.client.pipeline, 'Ganada');
  assert.equal(result.client.status, 'Operación ganada');
  assert.equal(result.client.nextFollowUp, undefined);
  assert.equal(result.reminder, null);
  assert.ok(result.activity.detail.includes('operación se marcó como ganada'));
});

test('una operación perdida conserva trazabilidad sin dejar seguimiento activo', () => {
  const result = buildCommercialProgress(baseClient, {
    stage: 'Perdida',
    note: 'Compró otra propiedad.',
    now: new Date('2026-07-20T12:00:00.000Z'),
  });

  assert.equal(result.client.status, 'Operación perdida');
  assert.equal(result.client.nextFollowUp, undefined);
  assert.equal(result.reminder, null);
  assert.ok(result.activity.detail.includes('Compró otra propiedad.'));
});

test('la interfaz usa sólo leads visibles y guarda historial sin tocar Supabase', () => {
  const ui = readFileSync('src/mvp-leads-ui.ts', 'utf8');
  const css = readFileSync('src/lead-commercial-flow.css', 'utf8');
  const flow = readFileSync('src/lead-commercial-flow.ts', 'utf8');

  assert.ok(ui.includes('visibleClients()'));
  assert.ok(ui.includes('buildCommercialProgress'));
  assert.ok(ui.includes('addActivity(progress.activity)'));
  assert.ok(ui.includes("saveData(`Avance comercial de ${client.name}: ${stage}`)"));
  assert.ok(ui.includes('nextId(state.crm.reminders)'));
  assert.ok(css.includes('.mvp-commercial-panel'));
  assert.ok(css.includes('@media (max-width:640px)'));
  assert.ok(flow.includes("link.href = '/src/lead-commercial-flow.css?v=20260720-44'"));
  assert.equal(ui.includes('/rest/v1/'), false);
  assert.equal(ui.includes('/storage/v1/'), false);
});
