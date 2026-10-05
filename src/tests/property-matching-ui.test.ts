import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const leadUi = readFileSync('src/mvp-leads-ui.ts', 'utf8');
const matchingCss = readFileSync('src/mvp-matching.css', 'utf8');
const pipelineCss = readFileSync('src/lead-pipeline.css', 'utf8');
const mobileLeadsCss = readFileSync('src/mobile-leads-polish.css', 'utf8');
const html = readFileSync('index.html', 'utf8');

test('Leads usa bounded en cards cerradas y conserva exhaustive en la ficha expandida', () => {
  assert.match(
    leadUi,
    /import \{ matchPropertiesForClient, matchRelevantPropertiesForClient, type PropertyMatch \} from '\.\/property-matching\.js';/,
  );

  const matchesStart = leadUi.indexOf('function matchesForLead(client: Client, properties: Property[], exhaustive: boolean): string');
  const matchesEnd = leadUi.indexOf('function clientHistory', matchesStart);
  assert.ok(matchesStart >= 0 && matchesEnd > matchesStart, 'debe existir el selector productivo bounded/exhaustive');
  const matchesBlock = leadUi.slice(matchesStart, matchesEnd);

  assert.match(
    matchesBlock,
    /exhaustive\s*\?\s*matchPropertiesForClient\(client, properties\)\s*:\s*matchRelevantPropertiesForClient\(client, properties\)/,
    'expanded debe conservar matching exhaustivo y collapsed debe usar matching bounded/relevant',
  );
  assert.match(
    matchesBlock,
    /\)\.slice\(0, 3\)/,
    'la UI debe seguir mostrando como máximo tres propiedades compatibles',
  );
  assert.ok(matchesBlock.includes('mejor coincidencia'), 'debe conservar el resumen de mejor coincidencia');
  assert.ok(matchesBlock.includes('matches.map(matchRow)'), 'debe seguir renderizando las coincidencias con la presentación existente');

  const cardStart = leadUi.indexOf('function card(client: Client, properties: Property[]): string');
  const cardEnd = leadUi.indexOf('function focusLeadForm', cardStart);
  assert.ok(cardStart >= 0 && cardEnd > cardStart, 'debe existir el armado de card del lead');
  const cardBlock = leadUi.slice(cardStart, cardEnd);

  assert.match(
    cardBlock,
    /const expanded = expandedClientId === client\.id \|\| openedReadOnly;/,
    'la apertura debe derivarse del lead expandido o lectura explícita',
  );
  assert.match(
    cardBlock,
    /matches: matchesForLead\(client, properties, expanded\),/,
    'el modo bounded/exhaustive debe depender del estado real de expansión',
  );
});

test('Leads conserva reasons, warnings, score y navegación de coincidencias', () => {
  assert.ok(leadUi.includes('match.reasons.slice(0, 3)'));
  assert.ok(leadUi.includes('match.warnings[0]'));
  assert.ok(leadUi.includes('mvp-match-score'));
  assert.ok(leadUi.includes('data-open-match-property'));

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
