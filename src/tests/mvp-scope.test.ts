import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import test from 'node:test';
import { clientFromFormValues } from '../client-editor.js';
import { PRODUCT_BRAND } from '../branding.js';
import { modules, type Client } from '../models.js';

test('la navegación del MVP contiene los módulos aprobados', () => {
  assert.deepEqual(modules, [
    ['crm', 'Leads'],
    ['whatsapp', 'Chats'],
    ['agenda', 'Agenda'],
    ['propiedades', 'Propiedades'],
    ['equipo', 'Equipo'],
    ['configuracion', 'Configuración'],
  ]);
});

test('index usa solo la entrada MVP y carga las capas visuales aprobadas', () => {
  const html = readFileSync('index.html', 'utf8');
  assert.match(html, /\/dist\/mvp-main\.js/);
  assert.match(html, /\/src\/sidebar-brand\.css/);
  assert.match(html, /\/src\/mvp-polish\.css/);
  assert.ok(html.includes('20260714-21'));
  for (const legacy of [
    '/dist/main.js',
    '/dist/team-bootstrap.js',
    '/dist/team-ui.js',
    '/dist/legacy-quarantine/team-scope.js',
    '/dist/legacy-quarantine/team-bootstrap.js',
    '/dist/legacy-quarantine/team-ui.js',
    'audio-simulation.js',
    'intervention-alert.js',
  ]) {
    assert.equal(html.includes(legacy), false, legacy);
  }
});

test('Product Brand Authority mantiene OrdenBroker separado de la identidad tenant', () => {
  const source = readFileSync('src/mvp-main.ts', 'utf8');
  const auth = readFileSync('src/mvp-auth.ts', 'utf8');
  const invitation = readFileSync('src/mvp-invitation-auth.ts', 'utf8');
  const account = readFileSync('src/account-menu-presentation.ts', 'utf8');
  const html = readFileSync('index.html', 'utf8');

  assert.equal(PRODUCT_BRAND.name, 'OrdenBroker');
  assert.equal(PRODUCT_BRAND.tagline, 'Tu inmobiliaria, bajo control');
  assert.equal(PRODUCT_BRAND.tagline.endsWith('.'), false);
  assert.equal(PRODUCT_BRAND.phrase, 'Ordená. Seguí. Cerrá.');
  assert.equal(PRODUCT_BRAND.logo, '/src/assets/ordenbroker-mark.png');
  assert.equal(PRODUCT_BRAND.wordmark, '/src/assets/ordenbroker-wordmark.png');
  assert.doesNotMatch(PRODUCT_BRAND.logo, /propcontrol/i);
  assert.doesNotMatch(PRODUCT_BRAND.wordmark, /propcontrol/i);
  assert.deepEqual(PRODUCT_BRAND.colors, {
    navy: '#0F1B35',
    deepBlue: '#103676',
    primary: '#0958ED',
    secondary: '#296BE9',
    slate: '#616C7E',
    bluishGray: '#98A9C5',
    border: '#DBDFE4',
    white: '#FFFFFF',
  });

  for (const asset of [
    'src/assets/ordenbroker-logo-tagline.png',
    'src/assets/ordenbroker-wordmark.png',
    'src/assets/ordenbroker-mark.png',
    'src/assets/ordenbroker-favicon-32.png',
    'src/assets/ordenbroker-apple-touch-icon.png',
    'src/assets/ordenbroker-app-icon-512.png',
  ]) {
    assert.equal(existsSync(asset), true, asset);
    assert.ok(statSync(asset).size > 0, asset);
  }
  for (const legacyAsset of [
    'src/assets/logo-propcontrol.png',
    'src/assets/logo-propcontrol-app.png',
    'src/assets/propcontrol-logo.svg',
    'src/assets/propcontrol-mark.svg',
  ]) assert.equal(existsSync(legacyAsset), true, legacyAsset);

  assert.match(html, /<title>OrdenBroker \| Sistema comercial inmobiliario<\/title>/);
  assert.match(html, /<meta name="description" content="OrdenBroker: sistema comercial para corredores e inmobiliarias\." \/>/);
  assert.match(html, /<meta name="theme-color" content="#0F1B35" \/>/);
  assert.match(html, /rel="icon" href="\/src\/assets\/ordenbroker-favicon-32\.png\?v=20260920-ob-1"/);
  assert.match(html, /rel="apple-touch-icon" href="\/src\/assets\/ordenbroker-apple-touch-icon\.png\?v=20260920-ob-1"/);
  assert.doesNotMatch(html, /(?:icon|apple-touch-icon)[^>]+propcontrol/i);

  const designTokens = readFileSync('src/design-tokens.css', 'utf8');
  for (const token of [
    '--ob-navy: #0F1B35',
    '--ob-deep-blue: #103676',
    '--ob-primary: #0958ED',
    '--ob-secondary: #296BE9',
    '--ob-slate: #616C7E',
    '--ob-bluish-gray: #98A9C5',
    '--ob-border: #DBDFE4',
    '--ob-white: #FFFFFF',
  ]) assert.ok(designTokens.includes(token), token);

  const publicFicha = readFileSync('src/public-ficha.ts', 'utf8');
  const settings = readFileSync('src/settings-ui.ts', 'utf8');
  assert.ok(publicFicha.includes('tenant.logoPath'));
  assert.ok(publicFicha.includes('tenantInitials(tenant.name)'));
  assert.equal(publicFicha.includes('PRODUCT_BRAND'), false);
  assert.ok(settings.includes('commercial.logoPath'));
  assert.ok(settings.includes('initialsOf(name)'));
  assert.equal(existsSync('src/assets/trv-logo.svg'), true);

  const activeProductBrandSources = [html, source, auth, invitation, readFileSync('src/branding.ts', 'utf8')].join('\n');
  assert.doesNotMatch(activeProductBrandSources, /\/src\/assets\/(?:logo-propcontrol|propcontrol-)/i);

  assert.ok(source.includes("import { PRODUCT_BRAND } from './branding.js'"));
  assert.ok(source.includes('class="app-brand"'));
  assert.ok(source.includes('class="app-brand-logo"'));
  assert.ok(source.includes('class="app-brand-copy"'));
  assert.ok(source.includes('document.title = `Ficha de propiedad | ${PRODUCT_BRAND.name}`;'));

  assert.ok(auth.includes("import { PRODUCT_BRAND } from './branding.js'"));
  assert.ok(invitation.includes("import { PRODUCT_BRAND } from './branding.js'"));
  assert.ok(invitation.includes('Activá tu acceso a ${PRODUCT_BRAND.name}.'));

  const mvpCss = readFileSync('src/mvp.css', 'utf8');
  const skinCss = readFileSync('src/liquid-glass-skin.css', 'utf8');
  const stylesCss = readFileSync('src/styles.css', 'utf8');
  assert.match(mvpCss, /\.public-auth-brand img \{ width:auto; height:54px; max-width:54px; object-fit:contain; \}/);
  assert.match(skinCss, /\.public-auth-lockup img \{ width: auto; height: 54px; max-width: 54px; object-fit: contain; \}/);
  assert.match(skinCss, /button:not\([\s\S]*color: var\(--ob-white\);[\s\S]*background: linear-gradient\(150deg, var\(--brand-bright\), var\(--brand\)\)/);
  assert.match(skinCss, /\.public-auth-card input:focus-visible[\s\S]*border-color: var\(--ob-primary\);[\s\S]*outline: 3px solid var\(--ob-secondary\);/);
  assert.doesNotMatch(skinCss, /rgba\(9,\s*33,\s*23|#06140e/i);
  assert.match(skinCss, /Ficha pública tenant-first/);
  assert.match(publicFicha, /const logoUrl = safePublicLogo\(tenant\.logoPath\)/);
  assert.match(publicFicha, /public-tenant-logo-placeholder/);
  assert.doesNotMatch(publicFicha, /PRODUCT_BRAND/);
  assert.match(stylesCss, /\.preview-panel, \.preview-panel \*,\s*\.public-page, \.public-page \* \{ visibility: visible !important; \}/);
  assert.match(stylesCss, /\.preview-panel \{ position: absolute; inset: 0; padding: 0; border: 0; box-shadow: none; \}/);
  assert.match(stylesCss, /\.public-page \{ position: absolute; inset: 0; padding: 0 !important; background: #fff !important; \}/);

  assert.ok(account.includes("import { PRODUCT_BRAND } from './branding.js'"));
  assert.ok(account.includes('|| PRODUCT_BRAND.name;'));
  assert.ok(account.includes('|| `Cuenta ${PRODUCT_BRAND.name}`;'));

  assert.equal(source.includes('AGENCY_BRAND'), false);
  assert.equal(source.includes('mvp-agency-brand'), false);
  assert.equal(source.includes('mvp-sidebar-footer'), false);
  assert.equal(source.includes('mvp-company-name'), false);
});

test('el lateral consume la paleta oficial OrdenBroker sin dorado legacy', () => {
  const css = readFileSync('src/sidebar-brand.css', 'utf8');
  for (const marker of [
    '.mvp-product-brand',
    '.mvp-product-logo',
    '.mvp-product-copy',
    '.mvp-sidebar .nav-button.active::before',
    '.mvp-topbar-spacer',
    '.mvp-account-avatar svg',
    'var(--ob-deep-blue)',
    'var(--ob-navy)',
    'var(--ob-primary)',
  ]) assert.ok(css.includes(marker), marker);
  for (const legacyColor of ['#102737', '#0d2230', '#d4a017']) assert.equal(css.includes(legacyColor), false, legacyColor);
  assert.equal(css.includes('#0b3346'), false);
  assert.equal(css.includes('.mvp-agency-brand'), false);
  assert.equal(css.includes('.mvp-sidebar-footer'), false);
  assert.equal(css.includes('.mvp-company-name'), false);
});

test('el pulido visual mejora consistencia sin sumar funciones', () => {
  const css = readFileSync('src/mvp-polish.css', 'utf8');
  for (const marker of [
    '--mvp-deep: var(--ob-navy)',
    '--mvp-blue: var(--ob-primary)',
    '--mvp-gold: var(--ob-secondary)',
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
  assert.ok(source.includes('aria-label="Abrir menú de cuenta de'));
  assert.ok(source.includes('aria-controls="${ACCOUNT_PANEL_ID}"'));
  assert.ok(source.includes('<svg viewBox="0 0 24 24"'));
  assert.equal(source.includes('const initials'), false);
});

test('el formulario de lead separa calificación esencial y preferencias opcionales', () => {
  const leads = readFileSync('src/mvp-leads-ui.ts', 'utf8');
  const essential = readFileSync('src/lead-essential-ui.ts', 'utf8');
  const source = `${leads}\n${essential}`;
  for (const label of [
    'Nombre',
    'Número de WhatsApp',
    'Lugar o propiedad de interés',
    'Presupuesto o rango',
    'Etapa comercial',
    'Próxima acción',
    'Fecha del próximo seguimiento',
    'Forma de pago',
    'Situación del crédito',
    'Zona o barrios principales',
    'Finalidad',
    'Plazo o urgencia',
    'Posibilidad actual de avanzar',
    'Preferencias y datos opcionales',
  ]) assert.ok(source.includes(label), label);
  assert.ok(source.includes('lead-form-essential'));
  assert.ok(source.includes('lead-form-secondary'));
});

test('editar campos parciales no elimina la calificación interna existente', () => {
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
    nextAction: 'Confirmar fondos',
    nextFollowUp: '2026-07-31',
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
  assert.equal(updated.nextAction, 'Confirmar fondos');
  assert.equal(updated.nextFollowUp, '2026-07-31');
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

  const navigation = readFileSync('src/entity-read-navigation.ts', 'utf8');
  assert.match(store, /export function resetTransientState\(\): void/);
  assert.match(store, /registerTransientStateReset/);
  assert.match(store, /activateStorageForTenant[\s\S]*resetTransientState\(\)/);
  assert.match(store, /replaceDataForTenant[\s\S]*resetTransientState\(\)/);
  assert.match(auth, /data-account-logout[\s\S]*resetTransientState\(\)[\s\S]*signOutCloud\(\)/);
  assert.match(navigation, /registerTransientStateReset\(clearReadEntityNavigation\)/);
  assert.doesNotMatch(navigation, /localStorage|saveData|queueCloudSave|writeTenantSnapshot/);
});
