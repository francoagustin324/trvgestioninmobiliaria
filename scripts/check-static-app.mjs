import { readFileSync } from 'node:fs';

const requiredFiles = ['index.html', 'src/app/main.ts', 'src/styles.css', 'src/server.ts', 'src/assets/trv-logo.svg', 'src/assets/propcontrol-logo.svg', 'src/branding.ts'];
for (const file of requiredFiles) {
  const content = readFileSync(file, 'utf8');
  if (!content.trim()) throw new Error(`${file} está vacío`);
}

const html = readFileSync('index.html', 'utf8');

for (const file of requiredFiles) {
  const content = readFileSync(file, 'utf8');
  for (const marker of ['<<<<<<<', '=======', '>>>>>>>']) {
    if (content.includes(marker)) throw new Error(`${file} contiene marcador de conflicto: ${marker}`);
  }
}

if (!html.includes('src/main.js') || !html.includes('src/styles.css')) {
  throw new Error('index.html no referencia los assets principales');
}

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
if (packageJson.scripts?.start !== 'node dist/src/server.js') {
  throw new Error('package.json no contiene el start correcto para Railway');
}

const server = readFileSync('src/server.ts', 'utf8');
for (const text of ['0.0.0.0', 'process.env.PORT']) {
  if (!server.includes(text)) throw new Error(`Falta configuración de Railway en server.mjs: ${text}`);
}

const js = readFileSync('src/app/main.ts', 'utf8') + readFileSync('src/branding.ts', 'utf8');
for (const text of ['PropControl', 'CRM / Leads', 'Propiedades', 'Agenda / Seguimiento', 'localStorage', 'Alertas comerciales', 'Semáforo comercial', 'Cliente caliente sin contactar', 'Ver más', 'Fichas TRV', 'WhatsApp + IA', 'Nuevo cliente', 'propcontrol-logo.svg', 'trv-logo.svg', 'Ordená. Seguí. Cerrá.', 'Guardar ficha TRV', 'Importar automáticamente', 'Pegá el enlace de la propiedad', 'Propiedad sujeta a disponibilidad', 'window.print', 'wa.me']) {
  if (!js.includes(text)) throw new Error(`Falta el texto requerido: ${text}`);
}

console.log('Static app validation passed');
