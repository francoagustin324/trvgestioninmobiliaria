import { existsSync, readFileSync } from 'node:fs';

const requiredFiles = [
  'index.html',
  'src/main.ts',
  'src/models.ts',
  'src/utils.ts',
  'src/store.ts',
  'src/public-ficha.ts',
  'src/fichas-ui.ts',
  'src/crm-ui.ts',
  'src/server.ts',
  'src/shared/import-types.ts',
  'src/server/import-service.ts',
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

const html = readFileSync('index.html', 'utf8');
if (!html.includes('/dist/main.js') || !html.includes('/src/styles.css') || !html.includes('/src/importer.css')) {
  throw new Error('index.html no referencia los archivos de la aplicación');
}

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
if (packageJson.scripts?.start !== 'node dist/server.js') throw new Error('Start de Railway incorrecto');
if (!String(packageJson.scripts?.build).includes('tsc')) throw new Error('El build no compila TypeScript');
if (!packageJson.dependencies?.playwright) throw new Error('Falta Playwright para portales dinámicos');

const tsconfig = readFileSync('tsconfig.json', 'utf8');
if (!tsconfig.includes('"strict": true')) throw new Error('TypeScript no está en modo estricto');

const source = requiredFiles.filter((file) => file.endsWith('.ts')).map((file) => readFileSync(file, 'utf8')).join('\n');
for (const text of ['Fichas TRV', 'public=', '5493515110069', 'navigator.clipboard', 'window.print', '/api/import-property', 'Crear ficha desde el link', 'Mis propiedades', 'Mejora visual suave', 'validateSafeUrl', 'chromium']) {
  if (!source.includes(text)) throw new Error(`Falta función o texto requerido: ${text}`);
}

console.log('TRV TypeScript importer validation passed');
