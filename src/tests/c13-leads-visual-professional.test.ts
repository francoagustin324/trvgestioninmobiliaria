import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync('index.html', 'utf8');
const queue = readFileSync('src/lead-attention-queue.ts', 'utf8');
const visualCss = readFileSync('src/hotfix-leads-visual-professional.css', 'utf8');
const compactCard = readFileSync('src/lead-card-compact-ui.ts', 'utf8');

test('C13 A: capa visual final queda después de PR153 y con cache bust propio', () => {
  const previous = html.indexOf('/src/hotfix-leads-attention-ux.css?v=20260820-3');
  const current = html.indexOf('/src/hotfix-leads-visual-professional.css?v=20260821-3');
  assert.ok(previous >= 0, 'Debe conservarse la capa visual PR153.');
  assert.ok(current > previous, 'C13 debe cargar como última capa visual de Leads.');
});

test('C13 B: copy de priorización es profesional y mantiene un único bloque supervisado', () => {
  assert.match(queue, /LEADS PRIORITARIOS/);
  assert.match(queue, /Gestioná primero los contactos que requieren acción\./);
  assert.match(queue, /Contactos para gestionar primero\./);
  assert.doesNotMatch(queue, />ATENDER AHORA</);
  assert.doesNotMatch(queue, /Prioridad global de tus leads visibles/);
  assert.match(queue, /data-supervised-attention-queue/);
  assert.match(queue, /data-attention-client-id/);
});

test('C13 C: motor y contratos B1.4.1 permanecen top-3, priority y sin filtros locales', () => {
  assert.match(queue, /Math\.min\(3/);
  assert.match(queue, /sortLeads\(active, 'priority', today\)/);
  assert.match(queue, /\.slice\(0, cappedLimit\)/);
  assert.equal(queue.includes('filterLeads'), false);
  assert.equal(queue.includes('LeadFilters'), false);
  assert.equal(queue.includes('filters.'), false);
});

test('C13 D: visual cubre seguimiento, reprogramación, acciones y targets sin lógica comercial', () => {
  for (const selector of [
    '.pc-supervised-attention-queue',
    '.pc-supervised-attention-item',
    '#crm .mvp-lead-next-action',
    '#crm .mvp-lead-followup-menu[open] > .mvp-lead-followup-popover',
    '#crm .mvp-lead-followup-popover input[type="date"]',
    '#crm .mvp-lead-followup-popover form button[type="submit"]',
    '#crm .mvp-lead-full-actions',
    '#crm .mvp-lead-full-actions [data-delete="clients"]',
  ]) assert.ok(visualCss.includes(selector), selector);
  assert.match(visualCss, /min-height:\s*44px/);
  assert.match(visualCss, /@media \(max-width: 720px\)/);
  assert.match(visualCss, /@media \(max-width: 360px\)/);

  for (const forbidden of [
    'RECOMMENDATION_SHOWN',
    'RECOMMENDATION_DECISION',
    'ActivityEntry',
    'Reminder',
    'nextAction =',
    'nextFollowUp =',
    'saveData',
    'localStorage',
    'fetch(',
  ]) assert.equal(visualCss.includes(forbidden), false, forbidden);
});

test('C13 E: markup funcional de seguimiento y Editar/Eliminar continúa en su renderer histórico', () => {
  assert.match(compactCard, /data-reprogram-client-follow-up/);
  assert.match(compactCard, /<label>Nueva fecha<input type="date"/);
  assert.match(compactCard, /data-edit-client=/);
  assert.match(compactCard, /data-delete="clients"/);
  assert.match(compactCard, /data-action|data-reprogram-client-follow-up|data-edit-client/);
});