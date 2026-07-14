import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { clientFromFormValues } from '../client-editor.js';
import { modules, type Client } from '../models.js';

test('la navegación pública del MVP contiene solo cinco módulos', () => {
  assert.deepEqual(modules, [
    ['crm', 'Leads'],
    ['whatsapp', 'Conversaciones'],
    ['agenda', 'Seguimientos'],
    ['propiedades', 'Propiedades'],
    ['equipo', 'Usuarios'],
  ]);
});

test('index usa la entrada MVP y no carga los inyectores anteriores', () => {
  const html = readFileSync('index.html', 'utf8');
  assert.match(html, /\/dist\/mvp-main\.js/);
  assert.doesNotMatch(html, /\/dist\/main\.js/);
  assert.doesNotMatch(html, /team-bootstrap\.js/);
  assert.doesNotMatch(html, /team-scope\.js/);
});

test('el formulario visible del lead se limita a cuatro datos comerciales', () => {
  const source = readFileSync('src/mvp-leads-ui.ts', 'utf8');
  for (const label of ['Nombre', 'Número de WhatsApp', 'Lugar o propiedad de interés', 'Presupuesto']) {
    assert.ok(source.includes(label), label);
  }
  for (const hiddenModule of ['Fichas TRV', 'Red comercial', 'Vista de usuario']) {
    assert.equal(source.includes(hiddenModule), false, hiddenModule);
  }
});

test('editar cuatro campos no elimina la calificación interna existente', () => {
  const current: Client = {
    id: 7,
    name: 'Nombre anterior',
    phone: '5493515550000',
    interest: 'General Paz',
    budget: 'USD 70.000',
    status: 'Lead',
    temperature: 'Caliente',
    pipeline: 'Calificado',
    paymentMethod: 'Contado',
    purchaseTimeframe: '0-3 meses',
    purpose: 'Vivir',
    knowsArea: 'Sí',
    canMoveForward: 'Sí',
    objections: 'Necesita cochera',
    notes: 'Dato interno',
    assignedToId: 3,
    createdById: 1,
  };
  const updated = clientFromFormValues(7, {
    name: 'Nombre nuevo',
    phone: '3515551111',
    interest: 'Cofico',
    budget: 'USD 80.000',
  }, current);
  assert.equal(updated.name, 'Nombre nuevo');
  assert.equal(updated.interest, 'Cofico');
  assert.equal(updated.paymentMethod, 'Contado');
  assert.equal(updated.pipeline, 'Calificado');
  assert.equal(updated.notes, 'Dato interno');
  assert.equal(updated.assignedToId, 3);
});

test('autenticación tiene páginas públicas separadas para login y registro', () => {
  const source = readFileSync('src/mvp-auth.ts', 'utf8');
  assert.ok(source.includes("location.hash === '#registro'"));
  assert.ok(source.includes('Ingresar'));
  assert.ok(source.includes('Crear cuenta'));
  assert.ok(source.includes('Nombre de la inmobiliaria'));
});

test('las plantillas se presentan organizadas y sin envío falso', () => {
  const source = readFileSync('src/message-templates-ui.ts', 'utf8');
  for (const marker of ['Plantillas de Meta', 'category', 'language', 'status', 'variables']) assert.ok(source.includes(marker));
  assert.ok(source.includes('disabled'));
  assert.ok(source.includes('al conectar Meta'));
});
