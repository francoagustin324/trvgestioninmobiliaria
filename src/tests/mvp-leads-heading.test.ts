import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const leads = readFileSync('src/mvp-leads-ui.ts', 'utf8');
const properties = readFileSync('src/mvp-properties-ui.ts', 'utf8');
const conversations = readFileSync('src/mvp-conversations-ui.ts', 'utf8');
const agenda = readFileSync('src/agenda-ui.ts', 'utf8');
const users = readFileSync('src/mvp-users-ui.ts', 'utf8');
const settings = readFileSync('src/settings-ui.ts', 'utf8');
const packageJson = readFileSync('package.json', 'utf8').toLowerCase();

const redundantSubtitle = 'Nombre, WhatsApp, interés, presupuesto y propiedades compatibles.';

test('Leads conserva título, botón y una introducción comercial útil', () => {
  assert.ok(leads.includes('<h1>Leads</h1>'));
  assert.ok(leads.includes('data-toggle="client-form">Nuevo lead</button>'));
  assert.equal(leads.includes(redundantSubtitle), false);
  assert.ok(leads.includes('Priorizá a quién contactar, resolvé la próxima acción y abrí la ficha completa solo cuando haga falta.'));
});

test('Leads mantiene búsqueda comercial con placeholder móvil legible', () => {
  assert.ok(leads.includes('<span>Buscar</span>'));
  assert.ok(leads.includes('placeholder="Nombre, WhatsApp o interés"'));
  assert.ok(leads.includes('id="mvp-lead-search"'));
  assert.ok(leads.includes('filterLeads(visibleClients(), filters)'));
});

test('las descripciones de los demás módulos permanecen disponibles', () => {
  assert.ok(properties.includes('Inventario interno y fichas profesionales listas para compartir.'));
  assert.ok(conversations.includes('Atendé consultas y revisá las plantillas aprobadas para iniciar contactos.'));
  assert.ok(agenda.includes('Resolvé primero los vencidos, completá cada gestión y reprogramá el próximo contacto sin perder información.'));
  assert.ok(users.includes('Administrá accesos y roles de la inmobiliaria.'));
  assert.ok(settings.includes('Tu perfil, los datos de la inmobiliaria y las preferencias de la app.'));
});

test('el cambio conserva búsqueda, matching, visibilidad y guardado de Leads', () => {
  assert.ok(leads.includes('function leadRows(): Client[]'));
  assert.ok(leads.includes('visibleClients()'));
  assert.ok(leads.includes('matchPropertiesForClient(client, properties)'));
  assert.ok(leads.includes("querySelector<HTMLFormElement>('#mvp-lead-form')?.addEventListener('submit'"));
  assert.ok(leads.includes('state.crm.clients = upsertClient(state.crm.clients, client)'));
});

test('el alcance no incorpora React, Tailwind ni dependencias visuales', () => {
  assert.equal(packageJson.includes('react'), false);
  assert.equal(packageJson.includes('tailwind'), false);
});
