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

test('index usa solo la entrada MVP y carga las capas visuales aprobadas', () => {
  const html = readFileSync('index.html', 'utf8');
  assert.match(html, /\/dist\/mvp-main\.js/);
  assert.match(html, /\/src\/sidebar-brand\.css/);
  assert.match(html, /\/src\/mvp-polish\.css/);
  assert.ok(html.includes('20260714-21'));
  for (const legacy of ['/dist/main.js', 'team-bootstrap.js', 'team-scope.js', 'audio-simulation.js', 'intervention-alert.js']) {
    assert.equal(html.includes(legacy), false, legacy);
  }
});

test('PropControl aparece como la única marca principal del software en la barra superior', () => {
  const source = readFileSync('src/mvp-main.ts', 'utf8');
  assert.ok(source.includes("import { PRODUCT_BRAND } from './branding.js'"));
  assert.ok(source.includes('class="app-brand"'));
  assert.ok(source.includes('class="app-brand-logo"'));
  assert.ok(source.includes('class="app-brand-copy"'));
  assert.ok(source.includes('CRM inmobiliario'));
  assert.equal(source.includes('AGENCY_BRAND'), false);
  assert.equal(source.includes('mvp-agency-brand'), false);
  assert.equal(source.includes('mvp-sidebar-footer'), false);
  assert.equal(source.includes('mvp-company-name'), false);
});

test('el lateral conserva la paleta anterior azul oscuro y dorado', () => {
  const css = readFileSync('src/sidebar-brand.css', 'utf8');
  for (const marker of [
    '.mvp-product-brand',
    '.mvp-product-logo',
    '.mvp-product-copy',
    '.mvp-sidebar .nav-button.active::before',
    '.mvp-topbar-spacer',
    '.mvp-account-avatar svg',
    '#102737',
    '#0d2230',
    '#d4a017',
  ]) assert.ok(css.includes(marker), marker);
  assert.equal(css.includes('#0b3346'), false);
  assert.equal(css.includes('.mvp-agency-brand'), false);
  assert.equal(css.includes('.mvp-sidebar-footer'), false);
  assert.equal(css.includes('.mvp-company-name'), false);
});

test('el pulido visual mejora consistencia sin sumar funciones', () => {
  const css = readFileSync('src/mvp-polish.css', 'utf8');
  for (const marker of [
    '--mvp-deep: #0d1b2a',
    '--mvp-blue: #1e3a5f',
    '--mvp-gold: #d4a017',
    '.mvp-lead-card:hover',
    'button:focus-visible',
    '@media (max-width: 640px)',
    '@media (prefers-reduced-motion: reduce)',
  ]) assert.ok(css.includes(marker), marker);
  for (const forbidden of ['Inicio', 'Reportes', 'Configuración', 'Red comercial', 'Fichas TRV']) {
    assert.equal(css.includes(forbidden), false, forbidden);
  }
});

test('la cuenta usa icono genérico y no repite la inicial de TRV', () => {
  const source = readFileSync('src/mvp-auth.ts', 'utf8');
  assert.ok(source.includes('aria-label="Abrir menú de cuenta"'));
  assert.ok(source.includes('<svg viewBox="0 0 24 24"'));
  assert.equal(source.includes('const initials'), false);
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

test('la cuenta informa sincronización y permite recuperar una copia local', () => {
  const auth = readFileSync('src/mvp-auth.ts', 'utf8');
  const store = readFileSync('src/store.ts', 'utf8');
  const main = readFileSync('src/mvp-main.ts', 'utf8');
  for (const marker of ['Sincronizar de forma segura', 'Recuperar copia anterior']) {
    assert.ok(auth.includes(marker), marker);
  }
  const safety = readFileSync('src/sync-safety.ts', 'utf8');
  assert.ok(safety.includes('Cambios pendientes'));
  assert.ok(store.includes('activateStorageForCurrentSession'));
  assert.ok(store.includes('restoreLatestLocalBackup'));
  assert.ok(main.includes('propcontrol-cloud-status'));
});
