import { readFileSync } from 'node:fs';

const requiredFiles = ['index.html', 'src/main.js', 'src/styles.css'];
for (const file of requiredFiles) {
  const content = readFileSync(file, 'utf8');
  if (!content.trim()) throw new Error(`${file} está vacío`);
}

const html = readFileSync('index.html', 'utf8');
if (!html.includes('src/main.js') || !html.includes('src/styles.css')) {
  throw new Error('index.html no referencia los assets principales');
}

const js = readFileSync('src/main.js', 'utf8');
for (const text of ['TRV CRM', 'Clientes / Leads', 'Propiedades', 'Recordatorios', 'localStorage']) {
  if (!js.includes(text)) throw new Error(`Falta el texto requerido: ${text}`);
}

console.log('Static app validation passed');
