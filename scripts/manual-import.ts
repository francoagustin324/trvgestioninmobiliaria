import { importProperty } from '../src/server/import-service.js';
const url = process.argv[2];
if (!url) throw new Error('Uso: npm run import:manual -- <url>');
console.log(JSON.stringify(await importProperty(url), null, 2));
