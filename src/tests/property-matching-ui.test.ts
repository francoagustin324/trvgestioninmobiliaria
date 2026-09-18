import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const leadUi = readFileSync('src/mvp-leads-ui.ts', 'utf8');
const matchingCss = readFileSync('src/mvp-matching.css', 'utf8');
const pipelineCss = readFileSync('src/lead-pipeline.css', 'utf8');
const mobileLeadsCss = readFileSync('src/mobile-leads-polish.css', 'utf8');
const html = readFileSync('index.html', 'utf8');

test('Leads utiliza el motor existente y muestra hasta tres propiedades compatibles', () => {
  assert.ok(leadUi.includes("import { matchPropertiesForClient, type PropertyMatch } from './property-matching.js'"));
  assert.ok(leadUi.includes('matchPropertiesForClient(client, properties).slice(0, 3)'));
  assert.ok(leadUi.includes('mejor coincidencia'));
  assert.ok(leadUi.includes('match.reasons.slice(0, 3)'));
  assert.ok(leadUi.includes('match.warnings[0]'));
});

test('el acceso a una coincidencia respeta propiedades visibles y abre lectura sin caer en Edit', () => {
  assert.match(leadUi, /from '\.\/team-access\.js'/);
  assert.ok(leadUi.includes('visibleProperties()'));
  assert.ok(leadUi.includes('visibleProperties().some((property) => property.id === propertyId)'));
  assert.match(leadUi, /openEntityReadOnly\([\s\S]*entityType: 'property'[\s\S]*returnTarget:[\s\S]*entityType: 'lead'/);
  const openMatchStart = leadUi.indexOf("container.querySelectorAll<HTMLButtonElement>('[data-open-match-property]')");
  const openMatchEnd = leadUi.indexOf('bindDelegatedFollowUpActions(container)', openMatchStart);
  assert.ok(openMatchStart >= 0 && openMatchEnd > openMatchStart);
  const openMatchBlock = leadUi.slice(openMatchStart, openMatchEnd);
  assert.doesNotMatch(openMatchBlock, /editingPropertyId|openForms\.property|data-edit-property/);
});

test('el matching tiene presentación responsive, controles táctiles y recursos versionados', () => {
  assert.ok(matchingCss.includes('.mvp-lead-card-with-matches'));
  assert.ok(matchingCss.includes('.mvp-match-score.alta'));
  assert.ok(matchingCss.includes('@media (max-width:640px)'));
  assert.ok(matchingCss.includes('.mvp-match-actions button { min-height:44px'));
  assert.ok(pipelineCss.includes('.mvp-lead-card.mvp-lead-card-with-matches'));
  assert.ok(mobileLeadsCss.includes('@media (max-width: 520px)'));
  assert.ok(mobileLeadsCss.includes('#crm .mvp-lead-matches > summary'));
  assert.ok(html.includes('/src/mvp-matching.css?v=20260719-43'));
});
