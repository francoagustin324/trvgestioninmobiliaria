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
  assert.match(main, /import '\.\/entity-read-navigation\.js'/);

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
});
