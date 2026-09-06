import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = process.cwd();
const workspaceSource = readFileSync(resolve(root, 'src/mvp-properties-workspace.ts'), 'utf8');
const uiSource = readFileSync(resolve(root, 'src/property-opportunities-ui.ts'), 'utf8');
const cssSource = readFileSync(resolve(root, 'src/property-opportunities.css'), 'utf8');
const indexSource = readFileSync(resolve(root, 'index.html'), 'utf8');
const browserRegressionSource = readFileSync(resolve(root, 'src/tests/p1-4-a1-property-opportunities-browser.test.ts'), 'utf8');

test('P1.4-A2 hace descubrible el acceso comercial desde Propiedades', () => {
  assert.match(workspaceSource, /Buscar clientes compatibles/);
  assert.match(workspaceSource, /property-opportunities-entry/);
  assert.match(workspaceSource, /insertBefore\(opportunitiesButton, newPropertyButton\)/);
});

test('P1.4-A2.1 separa Paso 1, selector y propiedad seleccionada con semántica clara', () => {
  assert.match(uiSource, /Buscar clientes para una propiedad/);
  assert.match(uiSource, /Elegí una propiedad y PropControl te muestra los clientes compatibles según el matching actual\./);
  assert.match(uiSource, /opportunity-step-kicker">PASO 1/);
  assert.match(uiSource, /opportunity-property-step-title">Elegí la propiedad que querés trabajar/);
  assert.match(uiSource, /class="opportunity-property-field"/);
  assert.match(uiSource, /for="opportunity-property-select">Seleccionar propiedad/);
  assert.match(uiSource, /id="opportunity-property-select" data-opportunity-property/);
  assert.match(uiSource, /Seleccioná una propiedad…/);
  assert.match(uiSource, /class="opportunity-workspace" data-opportunity-workspace/);
  assert.match(uiSource, /class="opportunity-property-summary-copy"/);
  assert.match(uiSource, /class="opportunity-property-price"/);
  assert.match(uiSource, /2<\/span><div><strong>Revisá los clientes compatibles/);
  assert.match(uiSource, /Buscar cliente/);
  assert.match(uiSource, /Compatibilidad/);
  assert.match(uiSource, /Seguimiento/);
  assert.match(uiSource, /Estado/);
  assert.match(uiSource, /Abrir ficha/);
  assert.match(uiSource, /Volver a propiedades/);
});

test('P1.4-A2.1 protege geometría, legibilidad y aire del selector en desktop/mobile', () => {
  assert.match(cssSource, /\.property-opportunities \{ display:grid; gap:26px;/);
  assert.match(cssSource, /\.opportunity-property-picker \{ display:grid; gap:16px; padding:22px; min-width:0; \}/);
  assert.match(cssSource, /\.opportunity-property-field \{ width:min\(100%,760px\); min-width:0; \}/);
  assert.match(cssSource, /padding-right:46px/);
  assert.match(cssSource, /white-space:nowrap/);
  assert.match(cssSource, /text-overflow:ellipsis/);
  assert.match(cssSource, /line-height:1\.35/);
  assert.match(cssSource, /\.opportunity-workspace \{ display:grid; gap:24px; min-width:0; \}/);
  assert.match(cssSource, /grid-template-columns:minmax\(0,1fr\) auto/);
  assert.match(cssSource, /@media \(max-width:400px\)/);
  assert.match(cssSource, /min-height:44px/);
});

test('P1.4-A2 integra Oportunidades con los tokens visuales oficiales sin volver a superficies blancas dominantes', () => {
  for (const token of ['--ink', '--ink-soft', '--brand', '--brand-bright', '--glass-bg', '--glass-stroke', '--glass-brand']) {
    assert.match(cssSource, new RegExp(`var\\(${token}\\)`), `Falta reutilizar token oficial ${token}`);
  }
  assert.doesNotMatch(cssSource, /background\s*:\s*#fff\b/i);
  assert.doesNotMatch(cssSource, /color\s*:\s*#173951\b/i);
  assert.match(cssSource, /opportunity-open-client/);
  assert.match(cssSource, /opportunity-property-field select:focus-visible/);
  assert.match(cssSource, /opportunity-filters input::placeholder/);
});

test('P1.4-A2 conserva selección local, apertura de ficha y contratos P1.4-A1', () => {
  assert.match(uiSource, /const selectedClientIds = new Set<number>\(\)/);
  assert.match(uiSource, /data-opportunity-select/);
  assert.match(uiSource, /data-edit-client="\$\{client\.id\}"/);
  assert.match(uiSource, /selectedClientIds\.add\(clientId\)/);
  assert.match(uiSource, /selectedClientIds\.delete\(clientId\)/);
  assert.match(uiSource, /buildPropertyOpportunities\(property, clients\)/);
  assert.doesNotMatch(uiSource, /matchClientsForProperty/);
  assert.doesNotMatch(uiSource, /MutationObserver/);
});

test('P1.4-A2 mantiene las regresiones browser que cubren filtros, selección, desktop/mobile y page errors', () => {
  assert.match(browserRegressionSource, /browser desktop: matching canónico, filtros, selección y visibilidad/);
  assert.match(browserRegressionSource, /data-opportunity-compatibility/);
  assert.match(browserRegressionSource, /data-opportunity-followup/);
  assert.match(browserRegressionSource, /2 clientes seleccionados/);
  assert.match(browserRegressionSource, /pageErrors/);
  assert.match(browserRegressionSource, /mobile 390: sin overflow y controles táctiles/);
  assert.match(browserRegressionSource, /scrollWidth/);
});

test('P1.4-A2.1 actualiza cache-busting de UI y CSS de Oportunidades', () => {
  assert.match(indexSource, /property-opportunities\.css\?v=20260906-p1-4-a2-1-1/);
  assert.match(indexSource, /property-opportunities-bootstrap\.js\?v=20260906-p1-4-a2-1-1/);
});
