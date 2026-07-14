import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { clientFromFormValues } from '../client-editor.js';
import { modules, type Client } from '../models.js';

test('la navegación del MVP contiene solo los cinco módulos aprobados', () => {
  assert.deepEqual(modules, [
    ['crm', 'Leads'],
    ['whatsapp', 'Conversaciones'],
    ['agenda', 'Seguimientos'],
    ['propiedades', 'Propiedades'],
    ['equipo', 'Usuarios'],
  ]);
});

test('index usa solo la entrada MVP y carga la capa visual de marca', () => {
  const html = readFileSync('index.html', 'utf8');
  assert.match(html, /\/dist\/mvp-main\.js/);
  assert.match(html, /\/src\/sidebar-brand\.css/);
  for (const legacy of ['/dist/main.js', 'team-bootstrap.js', 'team-scope.js', 'audio-simulation.js', 'intervention-alert.js']) {
    assert.equal(html.includes(legacy), false, legacy);
  }
});

test('PropControl aparece una sola vez como marca dentro del menú lateral', () => {
  const source = readFileSync('src/mvp-main.ts', 'utf8');
  assert.ok(source.includes("import { PRODUCT_BRAND } from './branding.js'"));
  assert.ok(source.includes('class="mvp-brand"'));
  assert.ok(source.includes('class="mvp-brand-mark"'));
  assert.ok(source.includes('class="mvp-sidebar-footer"'));
  assert.equal(source.includes('module-title'), false);
  assert.ok(source.includes('mvp-company-name'));
});

test('el diseño lateral combina marca, navegación y contexto de inmobiliaria', () => {
  const css = readFileSync('src/sidebar-brand.css', 'utf8');
  for (const marker of [
    '.mvp-brand',
    '.mvp-brand-mark',
    '.mvp-sidebar .nav-button.active::before',
    '.mvp-sidebar-footer',
    '.mvp-company-name strong',
    '#d4a017',
  ]) assert.ok(css.includes(marker), marker);
});

test('el formulario visible del lead se limita a cuatro datos comerciales', () => {
  const source = readFileSync('src/mvp-leads-ui.ts', 'utf8');
  for (const label of ['Nombre', 'Número de WhatsApp', 'Lugar o propiedad de interés', 'Presupuesto']) {
    assert.ok(source.includes(label), label);
  }
  for (const hiddenField of ['Forma de pago', 'Plazo de compra', 'Motivo de compra', 'Objeciones', 'Observaciones']) {
    assert.equal(source.includes(hiddenField), false, hiddenField);
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

test('autenticación tiene URLs públicas separadas para login y registro', () => {
  const source = readFileSync('src/mvp-auth.ts', 'utf8');
  for (const marker of ["'/login'", "'/registro'", 'isLoginPage', 'isRegisterPage', 'Nombre de la inmobiliaria']) {
    assert.ok(source.includes(marker), marker);
  }
  assert.equal(source.includes("location.hash === '#registro'"), false);
});

test('la cuenta visible es un avatar y el rol queda dentro del menú', () => {
  const source = readFileSync('src/mvp-auth.ts', 'utf8');
  assert.ok(source.includes('aria-label="Abrir menú de cuenta"'));
  assert.ok(source.includes('mvp-account-avatar'));
  assert.equal(source.includes('<summary><span><b>Dueño'), false);
});

test('conversaciones usa una bandeja limpia y no la pantalla avanzada anterior', () => {
  const main = readFileSync('src/mvp-main.ts', 'utf8');
  const source = readFileSync('src/mvp-conversations-ui.ts', 'utf8');
  assert.ok(main.includes('renderMvpConversations'));
  assert.equal(main.includes('renderWhatsApp'), false);
  for (const marker of ['Bandeja', 'Plantillas de Meta', 'Abrir WhatsApp', 'Interés', 'Presupuesto']) assert.ok(source.includes(marker));
  for (const hidden of ['Auditoría masiva', 'Simular mensaje entrante', 'IA supervisada']) assert.equal(source.includes(hidden), false);
});

test('plantillas Meta incluyen organización profesional y no simulan envío', () => {
  const source = readFileSync('src/message-templates-ui.ts', 'utf8');
  for (const marker of ['Plantillas de Meta', 'category', 'language', 'status', 'quality', 'variables', 'buttons', 'updatedAt', 'Vista previa']) {
    assert.ok(source.includes(marker), marker);
  }
  assert.ok(source.includes('disabled'));
  assert.ok(source.includes('al conectar Meta'));
});

test('administración de usuarios no contiene vista simulada de usuario', () => {
  const source = readFileSync('src/mvp-users-ui.ts', 'utf8');
  assert.ok(source.includes('Administrá accesos y roles'));
  assert.equal(source.includes('Vista de usuario'), false);
  assert.equal(source.includes('Carga de trabajo'), false);
});
