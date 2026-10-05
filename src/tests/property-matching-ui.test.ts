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

  const contentStart = leadUi.indexOf('function matchesContentForLead(client: Client, properties: Property[], exhaustive: boolean): string');
  const contentEnd = leadUi.indexOf('function matchesForLead', contentStart);
  assert.ok(contentStart >= 0 && contentEnd > contentStart, 'debe existir el selector productivo bounded/exhaustive');
  const contentBlock = leadUi.slice(contentStart, contentEnd);
  assert.match(
    contentBlock,
    /exhaustive\s*\?\s*matchPropertiesForClient\(client, properties\)\s*:\s*matchRelevantPropertiesForClient\(client, properties\)/,
    'expanded debe conservar matching exhaustivo y collapsed debe usar matching bounded/relevant',
  );
  assert.match(contentBlock, /\)\.slice\(0, 3\)/, 'la UI debe seguir mostrando como máximo tres propiedades compatibles');
  assert.ok(contentBlock.includes('mejor coincidencia'), 'debe conservar el resumen de mejor coincidencia');
  assert.ok(contentBlock.includes('matches.map(matchRow)'), 'debe seguir renderizando las coincidencias con la presentación existente');

  const wrapperStart = leadUi.indexOf('function matchesForLead(client: Client, properties: Property[], exhaustive: boolean): string');
  const wrapperEnd = leadUi.indexOf('function refreshLeadMatches', wrapperStart);
  assert.ok(wrapperStart >= 0 && wrapperEnd > wrapperStart, 'debe existir el slot observable del lead');
  const wrapperBlock = leadUi.slice(wrapperStart, wrapperEnd);
  assert.match(wrapperBlock, /data-lead-matches-slot="\$\{client\.id\}"/);
  assert.match(wrapperBlock, /data-match-mode="\$\{exhaustive \? 'exhaustive' : 'bounded'\}"/);

  const refreshStart = leadUi.indexOf('function refreshLeadMatches(');
  const refreshEnd = leadUi.indexOf('function clientHistory', refreshStart);
  assert.ok(refreshStart >= 0 && refreshEnd > refreshStart, 'debe existir refresco focal del bloque de matches');
  const refreshBlock = leadUi.slice(refreshStart, refreshEnd);
  assert.match(refreshBlock, /visibleClients\(\)\.find\(\(item\) => item\.id === clientId\)/);
  assert.match(refreshBlock, /matchesContentForLead\(client, visibleProperties\(\), exhaustive\)/);
  assert.match(refreshBlock, /bindLeadMatchActions\(slot\)/);

  const cardStart = leadUi.indexOf('function card(client: Client, properties: Property[]): string');
  const cardEnd = leadUi.indexOf('function focusLeadForm', cardStart);
  assert.ok(cardStart >= 0 && cardEnd > cardStart, 'debe existir el armado de card del lead');
  const cardBlock = leadUi.slice(cardStart, cardEnd);
  assert.match(cardBlock, /const expanded = expandedClientId === client\.id \|\| openedReadOnly;/);
  assert.match(cardBlock, /matches: matchesForLead\(client, properties, expanded\),/);

  const toggleStart = leadUi.indexOf('function bindFullSheets(container: HTMLElement): void');
  const toggleEnd = leadUi.indexOf('const followUpActionContainers', toggleStart);
  assert.ok(toggleStart >= 0 && toggleEnd > toggleStart, 'debe existir binding runtime de details');
  const toggleBlock = leadUi.slice(toggleStart, toggleEnd);
  assert.match(toggleBlock, /refreshLeadMatches\(details, clientId, true\)/, 'abrir debe recalcular exhaustive sólo ese lead');
  assert.match(toggleBlock, /refreshLeadMatches\(details, clientId, false\)/, 'cerrar debe volver al bounded de la card');
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
