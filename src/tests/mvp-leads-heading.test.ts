import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync('index.html', 'utf8');
const leads = readFileSync('src/mvp-leads-ui.ts', 'utf8');
const properties = readFileSync('src/mvp-properties-ui.ts', 'utf8');
const conversations = readFileSync('src/mvp-conversations-ui.ts', 'utf8');
const agenda = readFileSync('src/agenda-ui.ts', 'utf8');
const users = readFileSync('src/mvp-users-ui.ts', 'utf8');
const settings = readFileSync('src/settings-ui.ts', 'utf8');
const packageJson = readFileSync('package.json', 'utf8').toLowerCase();

const redundantSubtitle = 'Nombre, WhatsApp, interés, presupuesto y propiedades compatibles.';

test('Leads conserva título y botón sin renderizar el subtítulo redundante', () => {
  assert.ok(leads.includes('<h1>Leads</h1>'));
  assert.ok(leads.includes('data-toggle="client-form">Nuevo lead</button>'));
  assert.equal(leads.includes(redundantSubtitle), false);
  assert.equal(leads.includes('<h1>Leads</h1><p>'), false);
});

test('Leads conserva la etiqueta y el placeholder actual del buscador', () => {
  assert.ok(leads.includes('<span>Buscar</span>'));
  assert.ok(leads.includes('placeholder="Nombre, WhatsApp, interés o presupuesto"'));
  assert.ok(leads.includes('id="mvp-lead-search"'));
});

test('las descripciones de los demás módulos permanecen disponibles', () => {
  assert.ok(properties.includes('Inventario interno y fichas profesionales listas para compartir.'));
  assert.ok(conversations.includes('Atendé consultas y revisá las plantillas aprobadas para iniciar contactos.'));
  assert.ok(agenda.includes('Resolvé primero los vencidos, completá cada gestión y reprogramá el próximo contacto sin perder información.'));
  assert.ok(users.includes('Administrá accesos y roles de la inmobiliaria.'));
  assert.ok(settings.includes('Tu perfil, los datos de la inmobiliaria y las preferencias de la app.'));
});

test('el cambio conserva la búsqueda, matching y guardado de Leads', () => {
  assert.ok(leads.includes('function leadRows(): Client[]'));
  assert.ok(leads.includes('matchPropertiesForClient(client, properties)'));
  assert.ok(leads.includes("form?.addEventListener('submit'"));
  assert.ok(leads.includes('state.crm.clients = upsertClient(state.crm.clients, client)'));
});

test('renueva únicamente la entrada principal y no incorpora frameworks', () => {
  assert.ok(html.includes('/dist/mvp-main.js?v=20260723-106'));
  assert.equal(packageJson.includes('react'), false);
  assert.equal(packageJson.includes('tailwind'), false);
});
