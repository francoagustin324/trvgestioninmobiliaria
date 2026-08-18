import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  renderSupervisedAttentionQueue,
  supervisedAttentionQueue,
} from '../lead-attention-queue.js';
import type { Client } from '../models.js';

const TODAY = '2026-08-18';

function client(id: number, name: string, overrides: Partial<Client> = {}): Client {
  return {
    id,
    name,
    phone: `549351555${String(id).padStart(4, '0')}`,
    interest: 'Propiedad en Córdoba',
    status: 'Lead',
    temperature: 'Tibio',
    pipeline: 'Contactado',
    lastContact: '2026-08-17',
    nextAction: 'Enviar opciones',
    nextFollowUp: '2026-08-25',
    ...overrides,
  };
}

function overdue(): Client {
  return client(10, 'Juan Pérez', {
    temperature: 'Caliente',
    nextFollowUp: '2026-08-16',
    nextAction: 'Confirmar financiación',
  });
}

function newUncontacted(): Client {
  return client(20, 'María López', {
    pipeline: 'Nuevo',
    lastContact: undefined,
    nextAction: undefined,
    nextFollowUp: undefined,
  });
}

function visitToday(): Client {
  return client(30, 'Pedro Díaz', {
    pipeline: 'Visita coordinada',
    temperature: 'Caliente',
    nextFollowUp: TODAY,
    nextAction: 'Confirmar visita 17:30',
  });
}

test('B1.4.1 A: vencido aparece antes que nuevo sin contactar', () => {
  const result = supervisedAttentionQueue([newUncontacted(), overdue()], TODAY);
  assert.deepEqual(result.map((item) => item.clientId), [10, 20]);
  assert.match(result[0]!.reason, /Seguimiento vencido/);
});

test('B1.4.1 B: nuevo sin contactar aparece antes que prioridad no urgente', () => {
  const result = supervisedAttentionQueue([
    client(40, 'Lead no urgente', { temperature: 'Caliente' }),
    newUncontacted(),
  ], TODAY);
  assert.equal(result[0]!.clientId, 20);
  assert.match(result[0]!.reason, /Nuevo/);
});

test('B1.4.1 C: visita de hoy conserva motivo, hora y acción existente', () => {
  const result = supervisedAttentionQueue([visitToday()], TODAY);
  assert.equal(result.length, 1);
  assert.match(result[0]!.reason, /Visita hoy/);
  assert.match(result[0]!.reason, /17:30/);
  assert.equal(result[0]!.action, 'Confirmar visita');
});

test('B1.4.1 D/E: terminales quedan fuera y la cola nunca supera tres recomendaciones', () => {
  const result = supervisedAttentionQueue([
    overdue(),
    newUncontacted(),
    visitToday(),
    client(40, 'Cuarto lead'),
    client(50, 'Ganado', { pipeline: 'Ganado' }),
    client(60, 'Perdido', { pipeline: 'Perdido' }),
  ], TODAY, 20);
  assert.equal(result.length, 3);
  assert.equal(result.some((item) => item.stage === 'Ganado' || item.stage === 'Perdido'), false);
});

test('B1.4.1 F/G: producción usa visibleClients global y no los filtros de la lista normal', () => {
  const polish = readFileSync('src/lead-list-polish-ui.ts', 'utf8');
  const queue = readFileSync('src/lead-attention-queue.ts', 'utf8');
  assert.ok(polish.includes('renderSupervisedAttentionQueue(visibleClients())'));
  assert.equal(polish.includes('state.crm.clients'), false);
  assert.equal(queue.includes('filterLeads'), false);
  assert.equal(queue.includes('LeadFilters'), false);
  assert.equal(queue.includes('filters.'), false);
  assert.ok(queue.includes("sortLeads(active, 'priority', today)"));
});

test('B1.4.1 H/I: orden normal y Limpiar conservan recent y orden no cuenta como filtro comercial', () => {
  const source = readFileSync('src/mvp-leads-ui.ts', 'utf8');
  const initialStart = source.indexOf('let filters: LeadListFilters');
  const initialEnd = source.indexOf('let expandedClientId');
  const resetStart = source.indexOf('function resetFilters()');
  const resetEnd = source.indexOf('function synchronizeFilterStateFromControls');
  const activeStart = source.indexOf('function activeSecondaryFilters()');
  const activeEnd = source.indexOf('function filterPanel()');
  const initial = source.slice(initialStart, initialEnd);
  const reset = source.slice(resetStart, resetEnd);
  const active = source.slice(activeStart, activeEnd);

  assert.match(initial, /stage:\s*'Todas'/);
  assert.match(initial, /order:\s*'recent'/);
  assert.match(reset, /stage:\s*'Todas'/);
  assert.match(reset, /order:\s*'recent'/);
  assert.match(reset, /temperature:\s*'Todas'/);
  assert.match(reset, /assignee:\s*'Todos'/);
  assert.match(reset, /overdueOnly:\s*false/);
  assert.match(reset, /missingNextActionOnly:\s*false/);
  assert.equal(active.includes('filters.order'), false);
});

test('B1.4.1 J: calcular y renderizar recomendaciones no muta Client ni contiene efectos de escritura', () => {
  const clients = [overdue(), newUncontacted(), visitToday()];
  const before = structuredClone(clients);
  supervisedAttentionQueue(clients, TODAY);
  const html = renderSupervisedAttentionQueue(clients, TODAY);
  assert.deepEqual(clients, before);
  assert.match(html, /ATENDER AHORA/);

  const source = readFileSync('src/lead-attention-queue.ts', 'utf8');
  for (const forbidden of ['saveData', 'addActivity', 'Reminder', 'nextFollowUp =', 'nextAction =', 'Math.random', 'score']) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
  for (const sourceOfTruth of ['sortLeads', 'leadPrimaryAlert', 'leadCardAttentionPresentation', 'commercialStage', 'isTerminalClient']) {
    assert.ok(source.includes(sourceOfTruth), sourceOfTruth);
  }
});

test('B1.4.1 K/L: CSS mantiene top 3 compacto, sin overflow móvil y sin overlays', () => {
  const css = readFileSync('src/lead-attention-queue.css', 'utf8');
  const html = readFileSync('index.html', 'utf8');
  assert.ok(html.includes('/src/lead-attention-queue.css?v=20260818-1'));
  assert.ok(css.includes('grid-template-columns: repeat(3, minmax(0, 1fr))'));
  assert.ok(css.includes('max-width: 100%'));
  assert.ok(css.includes('min-width: 0'));
  assert.ok(css.includes('@media (max-width: 720px)'));
  assert.ok(css.includes('overflow-x: hidden'));
  assert.ok(css.includes('overflow-wrap: anywhere'));
  assert.equal(css.includes('position: fixed'), false);
  assert.equal(css.includes('position: absolute'), false);
});

test('B1.4.1: empty state no inventa urgencias', () => {
  const html = renderSupervisedAttentionQueue([
    client(50, 'Ganado', { pipeline: 'Ganado' }),
    client(60, 'Perdido', { pipeline: 'Perdido' }),
  ], TODAY);
  assert.match(html, /No hay leads activos para atender ahora/);
  assert.equal(html.includes('data-attention-client-id='), false);
});
