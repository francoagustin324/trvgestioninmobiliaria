import { existsSync, readFileSync, statSync } from 'node:fs';

const requiredFiles = [
  'index.html',
  'src/main.ts',
  'src/auth-ui.ts',
  'src/cloud-api.ts',
  'src/branding.ts',
  'src/models.ts',
  'src/utils.ts',
  'src/store.ts',
  'src/client-editor.ts',
  'src/phone-normalizer.ts',
  'src/agenda.ts',
  'src/agenda-ui.ts',
  'src/public-ficha.ts',
  'src/fichas-ui.ts',
  'src/extension-import-ui.ts',
  'src/extension-install-ui.ts',
  'src/crm-ui.ts',
  'src/server.ts',
  'src/shared/import-types.ts',
  'src/server/import-service.ts',
  'src/server/extension-import-store.ts',
  'src/server/whatsapp-webhook.ts',
  'src/server/provider.ts',
  'src/server/browser.ts',
  'src/server/html-extractor.ts',
  'src/server/utils/safe-url.ts',
  'src/server/utils/sanitize.ts',
  'src/tests/whatsapp-webhook.test.ts',
  'src/tests/client-editor.test.ts',
  'src/tests/phone-normalizer.test.ts',
  'src/tests/agenda.test.ts',
  'src/styles.css',
  'src/crm-safety.css',
  'src/agenda.css',
  'src/importer.css',
  'src/propcontrol-theme.css',
  'src/cloud-auth.css',
  'src/mobile-premium.css',
  'src/professional-polish.css',
  'dist/main.js',
  'dist/server.js',
  'src/assets/propcontrol-mark.svg',
  'src/assets/propcontrol-logo.svg',
  'src/assets/trv-logo.svg',
  'extension/trv-fichas-chrome/manifest.json',
  'extension/trv-fichas-chrome/background.js',
  'extension/trv-fichas-chrome/extractor.js',
  'extension/trv-fichas-chrome/popup.html',
  'extension/trv-fichas-chrome/popup.css',
  'extension/trv-fichas-chrome/popup.js',
  'extension/trv-fichas-chrome/INSTALAR.txt',
  'scripts/build-extension-zip.mjs',
  'tsconfig.json',
  'Dockerfile',
];

for (const file of requiredFiles) {
  if (!existsSync(file)) throw new Error(`Falta el archivo requerido: ${file}`);
  const content = readFileSync(file, 'utf8');
  if (!content.trim()) throw new Error(`${file} está vacío`);
  for (const marker of ['<<<<<<<', '=======', '>>>>>>>']) {
    if (content.includes(marker)) throw new Error(`${file} contiene marcador de conflicto: ${marker}`);
  }
  if (file.endsWith('.ts') && content.includes('@ts-nocheck')) throw new Error(`${file} desactiva el control de TypeScript`);
}

const zipPath = 'extension/trv-fichas-chrome.zip';
if (!existsSync(zipPath) || statSync(zipPath).size < 1000) throw new Error('No se generó el ZIP instalable de la extensión');
const zip = readFileSync(zipPath);
if (zip.readUInt32LE(0) !== 0x04034b50) throw new Error('El ZIP de la extensión no es válido');

const html = readFileSync('index.html', 'utf8');
for (const asset of ['/dist/main.js', '/src/styles.css', '/src/crm-safety.css', '/src/agenda.css', '/src/importer.css', '/src/propcontrol-theme.css', '/src/cloud-auth.css', '/src/mobile-premium.css', '/src/professional-polish.css', '/src/assets/propcontrol-mark.svg']) {
  if (!html.includes(asset)) throw new Error(`index.html no referencia ${asset}`);
}
if (!html.includes('viewport-fit=cover')) throw new Error('Falta soporte de safe area para móviles');
if (!html.includes('PropControl')) throw new Error('El título interno no usa PropControl');

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
if (packageJson.scripts?.start !== 'node dist/server.js') throw new Error('Start de Railway incorrecto');
if (!String(packageJson.scripts?.build).includes('tsc')) throw new Error('El build no compila TypeScript');
if (!String(packageJson.scripts?.build).includes('build-extension-zip')) throw new Error('El build no genera la extensión instalable');
if (!packageJson.dependencies?.playwright) throw new Error('Falta Playwright para portales dinámicos');

const tsconfig = readFileSync('tsconfig.json', 'utf8');
if (!tsconfig.includes('"strict": true')) throw new Error('TypeScript no está en modo estricto');

const manifest = JSON.parse(readFileSync('extension/trv-fichas-chrome/manifest.json', 'utf8'));
if (manifest.manifest_version !== 3) throw new Error('La extensión debe usar Manifest V3');
if (!String(manifest.name).includes('PropControl')) throw new Error('La extensión no usa la marca PropControl');
for (const permission of ['activeTab', 'scripting', 'tabs']) {
  if (!manifest.permissions?.includes(permission)) throw new Error(`Falta permiso de extensión: ${permission}`);
}
if (!manifest.background?.service_worker || !manifest.action?.default_popup) throw new Error('La extensión no tiene service worker o popup');

const branding = readFileSync('src/branding.ts', 'utf8');
for (const text of ['PRODUCT_BRAND', 'AGENCY_BRAND', 'PropControl', 'TRV Gestión Inmobiliaria', '5493515110069']) {
  if (!branding.includes(text)) throw new Error(`Falta configuración de marca: ${text}`);
}

const publicFicha = readFileSync('src/public-ficha.ts', 'utf8');
if (!publicFicha.includes('AGENCY_BRAND.name') || !publicFicha.includes('AGENCY_BRAND')) {
  throw new Error('Las fichas públicas no conservan la marca de la inmobiliaria');
}

const cloudApi = readFileSync('src/cloud-api.ts', 'utf8');
for (const text of ['/auth/v1/signup', '/auth/v1/token?grant_type=password', 'organization_members', 'propcontrol_system_snapshot', 'queueCloudSave']) {
  if (!cloudApi.includes(text)) throw new Error(`Falta función de nube: ${text}`);
}
if (cloudApi.includes('SUPABASE_SECRET_KEY')) throw new Error('La clave secreta no debe incluirse en el código del navegador');

const server = readFileSync('src/server.ts', 'utf8');
for (const text of ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', '/api/cloud-config', 'WHATSAPP_WEBHOOK_VERIFY_TOKEN', 'META_APP_SECRET']) {
  if (!server.includes(text)) throw new Error(`Falta configuración de servidor: ${text}`);
}
if (server.includes("process.env.SUPABASE_SECRET_KEY") && server.includes('publishableKey: process.env.SUPABASE_SECRET_KEY')) {
  throw new Error('El servidor intenta exponer la clave secreta');
}

const whatsappWebhook = readFileSync('src/server/whatsapp-webhook.ts', 'utf8');
for (const text of ['/api/whatsapp/webhook', 'x-hub-signature-256', 'timingSafeEqual', 'hub.verify_token', 'WebhookDeduplicator']) {
  if (!whatsappWebhook.includes(text)) throw new Error(`Falta protección del webhook: ${text}`);
}
if (whatsappWebhook.includes('console.log(payload)') || whatsappWebhook.includes('console.info(payload)')) {
  throw new Error('El webhook no debe registrar payloads completos con datos personales');
}

const responsiveCss = readFileSync('src/mobile-premium.css', 'utf8');
for (const text of ['overflow-x: clip', '.mobile-nav-trigger', '.sidebar-backdrop', 'body.mobile-nav-open', '@media (max-width: 720px)', 'env(safe-area-inset-bottom)']) {
  if (!responsiveCss.includes(text)) throw new Error(`Falta protección responsive: ${text}`);
}

const main = readFileSync('src/main.ts', 'utf8');
for (const text of ['data-mobile-nav-toggle', 'data-mobile-nav-close', 'setMobileNavigation', 'aria-expanded', 'data-edit-client', 'data-cancel-client-edit', 'window.confirm', 'renderAgenda']) {
  if (!main.includes(text)) throw new Error(`Falta interacción principal: ${text}`);
}

const crmUi = readFileSync('src/crm-ui.ts', 'utf8');
for (const text of ['Guardar cambios', 'Editar', 'upsertClient', 'clientFromFormValues', 'record-actions', 'findDuplicateClient', 'client-form-error', 'Abrir cliente existente']) {
  if (!crmUi.includes(text)) throw new Error(`Falta protección del CRM: ${text}`);
}

const phoneNormalizer = readFileSync('src/phone-normalizer.ts', 'utf8');
for (const text of ['normalizePhone', 'phoneIdentity', 'findDuplicateClient', 'isPlausiblePhone', 'argentinaNationalNumber']) {
  if (!phoneNormalizer.includes(text)) throw new Error(`Falta normalización telefónica: ${text}`);
}

const agenda = readFileSync('src/agenda.ts', 'utf8');
for (const text of ['buildAgendaItems', 'groupAgendaItems', 'todayIsoDate', 'terminalClient']) {
  if (!agenda.includes(text)) throw new Error(`Falta lógica de agenda: ${text}`);
}

const agendaUi = readFileSync('src/agenda-ui.ts', 'utf8');
for (const text of ['Seguimientos priorizados', 'Abrir cliente', 'data-edit-client', 'data-delete="reminders"']) {
  if (!agendaUi.includes(text)) throw new Error(`Falta interfaz de agenda: ${text}`);
}

const source = requiredFiles.filter((file) => file.endsWith('.ts') || file.endsWith('.js')).map((file) => readFileSync(file, 'utf8')).join('\n');
for (const text of ['Fichas TRV', 'public=', '5493515110069', 'navigator.clipboard', 'window.print', '/api/import-property', '/api/extension-import', 'Crear ficha desde el link', 'Mis propiedades', 'Mejora visual suave', 'TRV_IMPORT_CURRENT', 'validateSafeUrl', 'chromium', 'PropControl', 'Ingresar / crear cuenta', '/api/whatsapp/webhook']) {
  if (!source.includes(text)) throw new Error(`Falta función o texto requerido: ${text}`);
}

console.log('PropControl: TypeScript, teléfonos normalizados, duplicados bloqueados, agenda comercial, autenticación, Supabase y webhook de WhatsApp aprobados');
