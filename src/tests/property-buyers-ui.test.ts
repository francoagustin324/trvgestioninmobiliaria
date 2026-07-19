import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const buyersUi = readFileSync('src/property-buyers-ui.ts', 'utf8');
const buyersCss = readFileSync('src/property-buyers.css', 'utf8');
const html = readFileSync('index.html', 'utf8');

test('Propiedades reutiliza el motor existente para encontrar compradores', () => {
  assert.ok(buyersUi.includes("matchClientsForProperty(property, clients).slice(0, 3)"));
  assert.ok(buyersUi.includes('match.reasons.slice(0, 3)'));
  assert.ok(buyersUi.includes('match.warnings[0]'));
  assert.ok(buyersUi.includes('${match.score}%'));
});

test('el matching respeta la visibilidad del usuario activo', () => {
  assert.ok(buyersUi.includes('visibleProperties().find'));
  assert.ok(buyersUi.includes('const clients = visibleClients()'));
  assert.ok(buyersUi.includes('visibleClients().some'));
  assert.ok(!buyersUi.includes('state.crm.clients.filter'));
});

test('la interfaz abre el lead compatible sin modificar datos', () => {
  assert.ok(buyersUi.includes("state.activeModule = 'crm'"));
  assert.ok(buyersUi.includes('state.editingClientId = clientId'));
  assert.ok(buyersUi.includes('state.openForms.client = true'));
  assert.ok(buyersUi.includes("new CustomEvent('trv-render')"));
  assert.ok(!buyersUi.includes('saveData'));
  assert.ok(!buyersUi.includes('fetch('));
});

test('la mejora se integra aunque la lista de propiedades se vuelva a renderizar', () => {
  assert.ok(buyersUi.includes('new MutationObserver(scheduleEnhancement)'));
  assert.ok(buyersUi.includes("document.addEventListener('trv-render', scheduleEnhancement)"));
  assert.ok(buyersUi.includes("card.insertAdjacentHTML('beforeend', html)"));
});

test('los recursos de compradores están cargados y son responsive', () => {
  assert.ok(html.includes('/src/property-buyers.css?v=20260719-44'));
  assert.ok(html.includes('/dist/property-buyers-ui.js?v=20260719-44'));
  assert.ok(buyersCss.includes('@media (max-width:640px)'));
  assert.ok(buyersCss.includes('grid-column:1 / -1'));
});

test('la integración no expone credenciales ni crea dependencias externas', () => {
  assert.ok(!buyersUi.includes('SUPABASE_SECRET_KEY'));
  assert.ok(!buyersUi.includes('service_role'));
  assert.ok(!buyersUi.includes('NexoBroker'));
});
