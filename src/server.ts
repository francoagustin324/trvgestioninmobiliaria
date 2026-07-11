import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importProperty } from './server/import-service.js';

const root = fileURLToPath(new URL('../public/', import.meta.url));
const port = Number(process.env.PORT || 4173);
const host = '0.0.0.0';
const contentTypes: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };

function sendJson(response: any, status: number, payload: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(payload));
}

async function readJson(request: any) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 20_000) throw new Error('Payload demasiado grande.');
  }
  return JSON.parse(body || '{}');
}

function resolveRequestPath(url = '/') {
  const pathname = decodeURIComponent(new URL(url, `http://${host}:${port}`).pathname);
  const requestedPath = pathname === '/' ? 'index.html' : pathname.slice(1);
  const filePath = normalize(join(root, requestedPath));
  return filePath.startsWith(root) ? filePath : join(root, 'index.html');
}

const server = createServer(async (request, response) => {
  if (request.method === 'POST' && request.url === '/api/import-property') {
    try {
      const body = await readJson(request);
      if (typeof body.url !== 'string') return sendJson(response, 400, { success: false, error: 'Falta url.' });
      return sendJson(response, 200, await importProperty(body.url));
    } catch (error) { return sendJson(response, 400, { success: false, error: error instanceof Error ? error.message : 'Solicitud inválida.' }); }
  }
  const filePath = resolveRequestPath(request.url || '/');
  const target = existsSync(filePath) && statSync(filePath).isFile() ? filePath : join(root, 'index.html');
  response.writeHead(200, { 'Content-Type': contentTypes[extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  createReadStream(target).pipe(response);
});

server.listen(port, host, () => console.log(`TRV CRM listo en http://${host}:${port}`));
