import { readFileSync } from 'node:fs';

const requiredFiles = ['index.html', 'src/main.js', 'src/styles.css', 'server.mjs', 'src/assets/trv-logo.svg'];
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

const packageJson = readFileSync('package.json', 'utf8');
if (!packageJson.includes('node server.mjs')) {
  throw new Error('package.json no contiene el start correcto para Railway');
}

const server = readFileSync('server.mjs', 'utf8');
for (const text of ['0.0.0.0', 'process.env.PORT']) {
  if (!server.includes(text)) throw new Error(`Falta configuración de Railway en server.mjs: ${text}`);
}

const js = readFileSync('src/main.js', 'utf8');
for (const text of ['TRV CRM', 'CRM / Leads', 'Propiedades', 'Agenda / Seguimiento', 'localStorage', 'Alertas comerciales', 'Semáforo comercial', 'Cliente caliente sin contactar', 'Ver más', 'Fichas TRV', 'WhatsApp + IA', 'Nuevo cliente', 'trv-logo.svg', 'Plantilla visual preparada con la marca TRV']) {
  if (!js.includes(text)) throw new Error(`Falta el texto requerido: ${text}`);
}

console.log('Static app validation passed');
