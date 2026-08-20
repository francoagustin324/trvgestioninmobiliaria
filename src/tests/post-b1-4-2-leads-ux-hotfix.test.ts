import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const queueSource = readFileSync('src/lead-attention-queue.ts', 'utf8');
const navigationSource = readFileSync('src/lead-attention-navigation.ts', 'utf8');
const listSource = readFileSync('src/lead-list-polish-ui.ts', 'utf8');
const queueCss = readFileSync('src/lead-attention-queue.css', 'utf8');
const leadsSource = readFileSync('src/mvp-leads-ui.ts', 'utf8');
const telemetrySource = readFileSync('src/lead-recommendation-instrumentation.ts', 'utf8');

test('hotfix UX: ATENDER AHORA usa botón nativo accesible y navegación DOM aislada', () => {
  assert.match(queueSource, /<button type="button" class="pc-supervised-attention-item"/);
  assert.match(queueSource, /data-attention-client-id=/);
  assert.match(queueSource, /aria-label="Abrir ficha completa de/);
  assert.match(listSource, /bindSupervisedAttentionLeadNavigation\(container\)/);
  assert.match(navigationSource, /details\.open = true/);
  assert.match(navigationSource, /scrollIntoView\(\{ behavior: 'smooth', block: 'center', inline: 'nearest' \}\)/);
  assert.match(navigationSource, /card\.focus\(\{ preventScroll: true \}\)/);
  assert.match(navigationSource, /role', 'status'/);
  assert.match(navigationSource, /aria-live', 'polite'/);
});

test('hotfix UX: abrir recomendación no contiene ninguna vía de mutación comercial o telemetría', () => {
  for (const forbidden of [
    'saveData(',
    'addActivity(',
    'registerWhatsApp',
    'nextAction =',
    'nextFollowUp =',
    'updatePipeline(',
    'persistSupervisedRecommendation',
    'recommendationShownEvent',
    'recommendationDecisionEvent',
    'ActivityEntry',
  ]) {
    assert.equal(navigationSource.includes(forbidden), false, `Navegación no debe contener ${forbidden}`);
  }
  assert.equal((listSource.match(/instrumentVisibleSupervisedRecommendations\(container\)/g) || []).length, 1);
  assert.match(telemetrySource, /lead-recommendation-telemetry\.js/);
});

test('hotfix UX: un lead oculto conserva filtros y comunica el bloqueo sin limpiar silenciosamente', () => {
  assert.match(navigationSource, /Este lead está oculto por los filtros actuales\. Ajustá o limpiá los filtros para verlo\./);
  for (const forbidden of [
    'mvp-lead-search',
    'mvp-lead-stage-filter',
    'mvp-lead-temperature-filter',
    'mvp-lead-assignee-filter',
    'mvp-lead-order',
    'data-clear-lead-filters',
    'data-stage-quick',
  ]) {
    assert.equal(navigationSource.includes(forbidden), false, `Navegación no debe modificar ${forbidden}`);
  }
});

test('hotfix UX: Todos mantiene stage=Todas y defaults recent/Limpiar PR143 en el source of truth existente', () => {
  assert.match(leadsSource, /stage:\s*'Todas'/);
  assert.match(leadsSource, /order:\s*'recent'/);
  assert.match(leadsSource, /data-stage-quick="Todas"[^>]*>Todos <b>/);
  assert.match(leadsSource, /filters\.stage = 'Todas'/);
  assert.match(leadsSource, /filters\.order = 'recent'/);
});

test('hotfix UX: estilo de etapa activa es centrado y sutil en desktop/mobile', () => {
  assert.match(queueCss, /\.pc-stage-summary \.mvp-stage-counter \{[\s\S]*display: inline-flex;[\s\S]*align-items: center;[\s\S]*justify-content: center;/);
  assert.match(queueCss, /\.pc-stage-summary \.mvp-stage-counter b \{[\s\S]*place-items: center;[\s\S]*margin-left: 0;/);
  assert.match(queueCss, /background: #173b31;/);
  assert.equal(queueCss.includes('background: #6e5a24'), false, 'El hotfix no debe restaurar el fondo amarillo fuerte.');
  assert.match(queueCss, /@media \(max-width: 720px\)[\s\S]*\.pc-supervised-attention-item \{[\s\S]*min-height: 44px;/);
});
