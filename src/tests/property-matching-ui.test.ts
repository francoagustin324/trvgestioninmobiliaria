import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const leadUi = readFileSync('src/mvp-leads-ui.ts', 'utf8');
const matchingCss = readFileSync('src/mvp-matching.css', 'utf8');
const html = readFileSync('index.html', 'utf8');

test('Leads utiliza el motor existente y muestra hasta tres propiedades compatibles', () => {
  assert.ok(leadUi.includes("import { matchPropertiesForClient, type PropertyMatch } from './property-matching.js'"));
  assert.ok(leadUi.includes('matchPropertiesForClient(client, properties).slice(0, 3)'));
  assert.ok(leadUi.includes('mejor coincidencia'));
  assert.ok(leadUi.includes('match.reasons.slice(0, 3)'));
  assert.ok(leadUi.includes('match.warnings[0]'));
});

test('el acceso a una coincidencia respeta propiedades visibles y abre el módulo existente', () => {
  assert.ok(leadUi.includes("import { visibleProperties } from './team-access.js'"));
  assert.ok(leadUi.includes('visibleProperties().some((property) => property.id === propertyId)'));
  assert.ok(leadUi.includes("state.activeModule = 'propiedades'"));
  assert.ok(leadUi.includes('state.editingPropertyId = propertyId'));
  assert.ok(leadUi.includes('state.openForms.property = true'));
  assert.ok(!leadUi.includes("state.activeModule = 'matching'"));
});

test('el matching tiene presentación responsive y recurso versionado', () => {
  assert.ok(matchingCss.includes('.mvp-lead-card-with-matches'));
  assert.ok(matchingCss.includes('.mvp-match-score.alta'));
  assert.ok(matchingCss.includes('@media (max-width:640px)'));
  assert.ok(html.includes('/src/mvp-matching.css?v=20260719-43'));
});
