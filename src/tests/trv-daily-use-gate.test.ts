import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('TRV Daily Use Gate mantiene contratos de navegación, actividad, agenda y cierre', () => {
  const store = readFileSync('src/store.ts', 'utf8');
  const auth = readFileSync('src/mvp-auth.ts', 'utf8');
  const navigation = readFileSync('src/entity-read-navigation.ts', 'utf8');
  const main = readFileSync('src/mvp-main.ts', 'utf8');

  assert.match(store, /export function resetTransientState\(\): void/);
  assert.match(store, /registerTransientStateReset/);
  assert.match(store, /transientStateResetHandlers\.forEach\(\(handler\) => handler\(\)\)/);
  assert.match(auth, /data-account-logout[\s\S]*resetTransientState\(\)[\s\S]*signOutCloud\(\)/);
  assert.match(main, /from '\.\/entity-read-navigation\.js'/);

  assert.match(navigation, /export function openEntityReadOnly/);
  assert.match(navigation, /export function returnToEntityReadOnly/);
  assert.match(navigation, /visibleClients\(\)/);
  assert.match(navigation, /visibleProperties\(\)/);
  assert.match(navigation, /state\.editingClientId = null/);
  assert.match(navigation, /state\.editingPropertyId = null/);
  assert.match(navigation, /state\.openForms\.client = false/);
  assert.match(navigation, /state\.openForms\.property = false/);
  assert.match(navigation, /registerTransientStateReset\(clearReadEntityNavigation\)/);
  assert.doesNotMatch(navigation, /localStorage|writeTenantSnapshot|queueCloudSave|saveData/);

  const leads = readFileSync('src/mvp-leads-ui.ts', 'utf8');
  const properties = readFileSync('src/mvp-properties-ui.ts', 'utf8');
  const opportunities = readFileSync('src/property-opportunities-ui.ts', 'utf8');
  const workspace = readFileSync('src/mvp-properties-workspace.ts', 'utf8');
  const leadCard = readFileSync('src/lead-card-compact-ui.ts', 'utf8');

  assert.match(leads, /data-open-match-property[\s\S]*openEntityReadOnly/);
  assert.doesNotMatch(leads, /data-open-match-property[\s\S]{0,900}state\.editingPropertyId = propertyId/);
  assert.match(leads, /Volver a propiedad/);
  assert.match(properties, /data-property-read-sheet/);
  assert.match(properties, /data-open-property-read/);
  assert.match(properties, /Volver al lead/);
  assert.match(opportunities, /data-open-opportunity-client/);
  assert.match(opportunities, /openEntityReadOnly\([\s\S]*entityType: 'lead'/);
  assert.doesNotMatch(opportunities, /data-edit-client="${client\.id}">Abrir ficha/);
  assert.match(workspace, /currentReadEntityTarget\(\)\?\.entityType === 'property'/);
  assert.match(leadCard, /navigation\?: string/);

  const pipeline = readFileSync('src/lead-pipeline-essential.ts', 'utf8');
  const followupUi = readFileSync('src/followup-completion-ui.ts', 'utf8');
  const agendaUi = readFileSync('src/agenda-ui.ts', 'utf8');

  assert.match(pipeline, /completeClientFollowUpWithDecision/);
  assert.match(pipeline, /kind: 'scheduled'/);
  assert.match(pipeline, /kind: 'none'/);
  assert.match(pipeline, /Sin seguimiento por ahora/);
  assert.match(pipeline, /nextFollowUp < today/);
  assert.match(leads, /requestFollowUpCompletion\(client,[\s\S]*completeClientFollowUpWithDecision/);
  assert.match(agendaUi, /requestFollowUpCompletion\(client,[\s\S]*completeClientFollowUpWithDecision/);
  assert.match(leads, /addActivityForAuthenticatedTenant\(requireCurrentTenantScope\(\), result\.activity\)/);
  assert.match(agendaUi, /addActivityForAuthenticatedTenant\(renderScope, result\.activity\)/);
  assert.doesNotMatch(leads, /const result = completeClientFollowUp\(client\)/);
  assert.doesNotMatch(agendaUi, /const result = completeClientFollowUp\(client\)/);
  assert.match(followupUi, /type="button" class="quiet-button" data-followup-cancel/);
  assert.match(followupUi, /data-followup-none/);
  assert.match(followupUi, /event\.preventDefault\(\)/);
  assert.doesNotMatch(followupUi, /localStorage|saveData|addActivity|queueCloudSave|waitForTimeout|setTimeout/);
});
