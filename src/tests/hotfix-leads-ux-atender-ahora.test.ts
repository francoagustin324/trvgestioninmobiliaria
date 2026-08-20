import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { renderSupervisedAttentionQueue } from '../lead-attention-queue.js';
import type { Client } from '../models.js';

function client(id: number, overrides: Partial<Client> = {}): Client {
  return {
    id,
    name: `Lead ${id}`,
    phone: `549351555${String(id).padStart(4, '0')}`,
    interest: 'Propiedad en Córdoba',
    status: 'Lead',
    temperature: 'Caliente',
    pipeline: 'Contactado',
    lastContact: '2026-08-19',
    nextAction: 'Confirmar financiación',
    nextFollowUp: '2026-08-19',
    ...overrides,
  };
}

const polish = readFileSync('src/lead-list-polish-ui.ts', 'utf8');
const queue = readFileSync('src/lead-attention-queue.ts', 'utf8');
const css = readFileSync('src/hotfix-leads-attention-ux.css', 'utf8');
const leads = readFileSync('src/mvp-leads-ui.ts', 'utf8');
const telemetry = readFileSync('src/lead-recommendation-instrumentation.ts', 'utf8');
const html = readFileSync('index.html', 'utf8');

test('HOTFIX UX A: ATENDER AHORA renderiza controles nativos accesibles por mouse y teclado', () => {
  const rendered = renderSupervisedAttentionQueue([client(77)], '2026-08-20');
  assert.match(rendered, /<button type="button" class="pc-supervised-attention-item"/);
  assert.match(rendered, /data-attention-client-id="77"/);
  assert.match(rendered, /aria-label="Abrir ficha completa de Lead 77"/);
  assert.match(rendered, /role="status" aria-live="polite"/);
  assert.equal(rendered.includes('tabindex="0"'), false, 'el botón nativo no necesita semántica inventada');
});

test('HOTFIX UX B: activación localiza el clientId, abre ficha, hace scroll y mueve foco visual', () => {
  const start = polish.indexOf('export function openAttentionLead');
  const end = polish.indexOf('function bindAttentionQueue');
  const source = polish.slice(start, end);
  assert.match(source, /data-client-id=\\?"\$\{clientId\}\\?"/);
  assert.match(source, /data-lead-full-sheet=\\?"\$\{clientId\}\\?"/);
  assert.match(source, /details\.open = true/);
  assert.match(source, /scrollIntoView\(\{ behavior: 'smooth'/);
  assert.match(source, /focus\(\{ preventScroll: true \}\)/);
  assert.match(source, /pc-attention-target/);
});

test('HOTFIX UX C: click delegado usa el mismo botón nativo; Enter/Espacio heredan activación estándar', () => {
  const start = polish.indexOf('function bindAttentionQueue');
  const end = polish.indexOf('export function enhanceLeadList');
  const source = polish.slice(start, end);
  assert.match(source, /addEventListener\('click'/);
  assert.match(source, /button\[data-attention-client-id\]/);
  assert.match(source, /openAttentionLead\(container, clientId\)/);
  assert.equal(source.includes("addEventListener('keydown'"), false, 'no duplicar activación de teclado del button nativo');
});

test('HOTFIX UX D: abrir una recomendación no produce mutaciones CRM ni decisiones de telemetría', () => {
  const start = polish.indexOf('export function openAttentionLead');
  const end = polish.indexOf('function bindAttentionQueue');
  const source = polish.slice(start, end);
  for (const forbidden of ['saveData', 'addActivity', 'nextAction', 'nextFollowUp', 'Reminder', 'pipeline =', 'registerWhatsAppContact', 'persistSupervisedRecommendationLifecycle', 'RECOMMENDATION_DECISION']) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
  assert.match(telemetry, /\[data-attention-client-id=/);
  assert.match(telemetry, /persistSupervisedRecommendationLifecycle/);
});

test('HOTFIX UX E: lead oculto conserva filtros y recibe aviso accesible, sin auto-clear', () => {
  const start = polish.indexOf('export function openAttentionLead');
  const end = polish.indexOf('function bindAttentionQueue');
  const source = polish.slice(start, end);
  assert.match(source, /oculto por los filtros actuales/);
  for (const forbidden of ['resetFilters', 'filters.stage', "stage = 'Todas'", 'renderMvpLeads']) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});

test('HOTFIX UX F: Todos sigue stage=Todas, default recent y Limpiar restaura PR143', () => {
  const initialStart = leads.indexOf('let filters: LeadListFilters');
  const initialEnd = leads.indexOf('let expandedClientId');
  const resetStart = leads.indexOf('function resetFilters()');
  const resetEnd = leads.indexOf('function synchronizeFilterStateFromControls');
  const initial = leads.slice(initialStart, initialEnd);
  const reset = leads.slice(resetStart, resetEnd);
  assert.match(initial, /stage:\s*'Todas'/);
  assert.match(initial, /order:\s*'recent'/);
  assert.match(reset, /stage:\s*'Todas'/);
  assert.match(reset, /order:\s*'recent'/);
  assert.match(reset, /temperature:\s*'Todas'/);
  assert.match(reset, /assignee:\s*'Todos'/);
});

test('HOTFIX UX G: selección Todos/etapas queda centrada y sutil en desktop/mobile', () => {
  assert.match(css, /#crm \.mvp-stage-counter\.active/);
  assert.match(css, /display: inline-flex/);
  assert.match(css, /align-items: center/);
  assert.match(css, /justify-content: center/);
  assert.match(css, /background: rgba\(62, 105, 84, \.09\)/);
  assert.match(css, /#crm \.mvp-stage-counter\.active b/);
  assert.match(css, /@media \(max-width: 720px\)/);
  assert.equal(css.includes('#ffd'), false);
});

test('HOTFIX UX H: cache-bust publica CSS y runtime nuevos sin tocar B1.4.1 histórico', () => {
  assert.match(html, /lead-attention-queue\.css\?v=20260818-1/);
  assert.match(html, /hotfix-leads-attention-ux\.css\?v=20260820-1/);
  assert.match(html, /mvp-main\.js\?v=20260820-1/);
  assert.match(queue, /sortLeads\(active, 'priority', today\)/);
  assert.match(queue, /Math\.min\(3/);
});