import { existsSync, readFileSync } from 'node:fs';
const requiredFiles = ['index.html','src/main.ts','src/models.ts','src/utils.ts','src/store.ts','src/public-ficha.ts','src/fichas-ui.ts','src/crm-ui.ts','src/styles.css','dist/main.js','server.mjs','src/assets/trv-logo.svg','tsconfig.json'];
for (const file of requiredFiles) {
  if (!existsSync(file)) throw new Error(`Falta el archivo requerido: ${file}`);
  const content = readFileSync(file, 'utf8');
  if (!content.trim()) throw new Error(`${file} está vacío`);
  for (const marker of ['<<<<<<<','=======','>>>>>>>']) if (content.includes(marker)) throw new Error(`${file} contiene marcador de conflicto: ${marker}`);
}
const html = readFileSync('index.html','utf8');
if (!html.includes('/dist/main.js') || !html.includes('/src/styles.css')) throw new Error('index.html no referencia los archivos compilados correctos');
const packageJson = JSON.parse(readFileSync('package.json','utf8'));
if (packageJson.scripts?.start !== 'node server.mjs') throw new Error('Start de Railway incorrecto');
if (!String(packageJson.scripts?.build).includes('tsc')) throw new Error('El build no compila TypeScript');
const source = requiredFiles.filter((file) => file.endsWith('.ts')).map((file) => readFileSync(file,'utf8')).join('\n');
for (const text of ['Fichas TRV','TRV Gestión Inmobiliaria','public=','5493515110069','Propiedad sujeta a disponibilidad','navigator.clipboard','window.print']) if (!source.includes(text)) throw new Error(`Falta función o texto requerido: ${text}`);
console.log('Static TypeScript app validation passed');
