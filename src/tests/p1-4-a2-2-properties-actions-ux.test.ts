import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const ui = readFileSync('src/mvp-properties-ui.ts', 'utf8');
const workspace = readFileSync('src/mvp-properties-workspace.ts', 'utf8');
const main = readFileSync('src/mvp-main.ts', 'utf8');
const propertiesCss = readFileSync('src/mvp-properties.css', 'utf8');
const mobileCss = readFileSync('src/mobile-properties-polish.css', 'utf8');
const html = readFileSync('index.html', 'utf8');

test('P1.4-A2.2 deja la cabecera con copy exacto y sin tutorial permanente', () => {
  assert.match(ui, /<h1>Propiedades<\/h1>/);
  assert.match(ui, /Gestioná tu inventario y encontrá clientes compatibles\./);
  assert.match(ui, />Nueva propiedad<\/button>/);
  assert.match(ui, />Buscar clientes compatibles<\/button>/);
  assert.doesNotMatch(ui, /mvp-property-flow/);
  for (const removed of ['1. Cargá la propiedad', '2. Agregá y ordená las fotos', '3. Compartí la ficha']) {
    assert.equal(ui.includes(removed), false, removed);
  }
});

test('P1.4-A2.2 da un único owner estructural al entrypoint de Oportunidades', () => {
  assert.match(main, /import \{ renderMvpPropertiesWorkspace \} from '\.\/mvp-properties-workspace\.js';/);
  assert.match(main, /renderMvpPropertiesWorkspace\(qs<HTMLElement>\('#propiedades'\)\)/);
  assert.doesNotMatch(main, /renderMvpProperties\(qs<HTMLElement>\('#propiedades'\)\)/);
  assert.match(workspace, /renderMvpProperties\(container, \{/);
  assert.match(workspace, /onOpenOpportunities: \(\) => \{/);
  assert.doesNotMatch(workspace, /createElement/);
  assert.doesNotMatch(workspace, /insertBefore/);
  assert.doesNotMatch(workspace, /MutationObserver/);
  assert.equal(existsSync('src/property-opportunities-bootstrap.ts'), false);
  assert.doesNotMatch(html, /property-opportunities-bootstrap\.js/);
});

test('P1.4-A2.2 preserva el callback explícito en rerenders locales y globales', () => {
  assert.match(ui, /export interface MvpPropertiesRenderOptions/);
  assert.match(ui, /onOpenOpportunities\?: \(\) => void/);
  assert.match(ui, /renderMvpProperties\(container, options\)/);
  assert.match(ui, /updatePropertyResults\(container, options\)/);
  assert.match(ui, /bindPropertyCardActions\(container, options\)/);
  assert.match(ui, /options\.onOpenOpportunities\?\.\(\)/);
  assert.match(ui, /document\.dispatchEvent\(new CustomEvent\('trv-render'\)\)/);
  assert.doesNotMatch(ui, /MutationObserver/);
});

test('P1.4-A2.2 agrupa primary y secondary con jerarquía y targets táctiles', () => {
  assert.match(ui, /class="mvp-properties-heading-actions"/);
  assert.match(ui, /class="secondary property-opportunities-entry"/);
  assert.match(ui, /class="mvp-properties-primary-action"/);
  assert.match(propertiesCss, /\.mvp-properties-heading-actions \{/);
  assert.match(propertiesCss, /display:flex/);
  assert.match(propertiesCss, /min-height:44px/);
  assert.match(propertiesCss, /\.mvp-properties-primary-action/);
  assert.match(propertiesCss, /\.property-opportunities-entry/);
  assert.match(propertiesCss, /var\(--brand-bright\)/);
  assert.match(propertiesCss, /var\(--brand\)/);
  assert.match(propertiesCss, /var\(--glass-brand\)/);
  assert.match(propertiesCss, /button:focus-visible/);
});

test('P1.4-A2.2 prioriza Nueva propiedad y apila acciones sin overflow en móvil', () => {
  assert.match(mobileCss, /#propiedades \.mvp-properties-heading-actions/);
  assert.match(mobileCss, /grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(mobileCss, /\[data-toggle="property-form"\][\s\S]*order: 1/);
  assert.match(mobileCss, /\[data-open-property-opportunities\][\s\S]*order: 2/);
  assert.match(mobileCss, /min-height: 46px/);
  assert.match(mobileCss, /overflow-x: clip/);
  assert.doesNotMatch(mobileCss, /mvp-property-flow/);
});

test('P1.4-A2.2 actualiza únicamente el cache-busting directo necesario', () => {
  assert.match(html, /mvp-properties\.css\?v=20260906-p1-4-a2-2-1/);
  assert.match(html, /mobile-properties-polish\.css\?v=20260906-p1-4-a2-2-1/);
  assert.match(html, /mvp-main\.js\?v=20260906-p1-4-a2-2-1/);
  assert.match(html, /property-opportunities\.css\?v=20260906-p1-4-a2-1-1/);
});
