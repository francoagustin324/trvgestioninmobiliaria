import { existsSync, readFileSync, statSync } from 'node:fs';

const requiredFiles = [
  'index.html',
  'src/main.ts',
  'src/models.ts',
  'src/utils.ts',
  'src/store.ts',
  'src/public-ficha.ts',
  'src/fichas-ui.ts',
  'src/extension-import-ui.ts',
  'src/extension-install-ui.ts',
  'src/crm-ui.ts',
  'src/server.ts',
  'src/shared/import-types.ts',
  'src/server/import-service.ts',
  'src/server/extension-import-store.ts',
  'src/server/provider.ts',
  'src/server/browser.ts',
  'src/server/html-extractor.ts',
  'src/server/utils/safe-url.ts',
  'src/server/utils/sanitize.ts',
  'src/styles.css',
  'src/importer.css',
  'dist/main.js',
  'dist/server.js',
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
if (!html.includes('/dist/main.js') || !html.includes('/src/styles.css') || !html.includes('/src/importer.css')) {
  throw new Error('index.html no referencia los archivos de la aplicación');
}

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
if (packageJson.scripts?.start !== 'node dist/server.js') throw new Error('Start de Railway incorrecto');
if (!String(packageJson.scripts?.build).includes('tsc')) throw new Error('El build no compila TypeScript');
if (!String(packageJson.scripts?.build).includes('build-extension-zip')) throw new Error('El build no genera la extensión instalable');
if (!packageJson.dependencies?.playwright) throw new Error('Falta Playwright para portales dinámicos');

const tsconfig = readFileSync('tsconfig.json', 'utf8');
if (!tsconfig.includes('"strict": true')) throw new Error('TypeScript no está en modo estricto');

const manifest = JSON.parse(readFileSync('extension/trv-fichas-chrome/manifest.json', 'utf8'));
if (manifest.manifest_version !== 3) throw new Error('La extensión debe usar Manifest V3');
for (const permission of ['activeTab', 'scripting', 'tabs']) {
  if (!manifest.permissions?.includes(permission)) throw new Error(`Falta permiso de extensión: ${permission}`);
}
if (!manifest.background?.service_worker || !manifest.action?.default_popup) throw new Error('La extensión no tiene service worker o popup');

const source = requiredFiles.filter((file) => file.endsWith('.ts') || file.endsWith('.js')).map((file) => readFileSync(file, 'utf8')).join('\n');
for (const text of ['Fichas TRV', 'public=', '5493515110069', 'navigator.clipboard', 'window.print', '/api/import-property', '/api/extension-import', 'Crear ficha desde el link', 'Mis propiedades', 'Mejora visual suave', 'TRV_IMPORT_CURRENT', 'validateSafeUrl', 'chromium']) {
  if (!source.includes(text)) throw new Error(`Falta función o texto requerido: ${text}`);
}

console.log('TRV TypeScript importer and Chrome extension validation passed');
