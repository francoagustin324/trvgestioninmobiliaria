import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importProperty } from './server/import-service.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.PORT || 4173);
const host = '0.0.0.0';
const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

const requestWindows = new Map<string, { count: number; resetAt: number }>();

function rateLimit(request: IncomingMessage): boolean {
  const key = request.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const current = requestWindows.get(key);
  if (!current || current.resetAt <= now) {
    requestWindows.set(key, { count: 1, resetAt: now + 10 * 60_000 });
    return false;
  }
  current.count += 1;
  return current.count > 12;
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(payload));
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const contentType = request.headers['content-type'] || '';
  if (!contentType.toLowerCase().startsWith('application/json')) throw new Error('La solicitud debe enviarse como JSON.');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > 10_000) throw new Error('La solicitud es demasiado grande.');
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  const parsed: unknown = JSON.parse(raw || '{}');
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('El contenido JSON no es válido.');
  return parsed as Record<string, unknown>;
}

function resolveRequestPath(requestUrl: string): string {
  const pathname = decodeURIComponent(new URL(requestUrl, `http://${host}:${port}`).pathname);
  const requestedPath = pathname === '/' ? 'index.html' : pathname.slice(1);
  const filePath = normalize(join(root, requestedPath));
  return filePath.startsWith(root) ? filePath : join(root, 'index.html');
}

function serveStatic(request: IncomingMessage, response: ServerResponse): void {
  let filePath: string;
  try { filePath = resolveRequestPath(request.url || '/'); } catch { filePath = join(root, 'index.html'); }
  const target = existsSync(filePath) && statSync(filePath).isFile() ? filePath : join(root, 'index.html');
  response.writeHead(200, {
    'Content-Type': contentTypes[extname(target)] || 'application/octet-stream',
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    Pragma: 'no-cache',
    Expires: '0',
    'X-Content-Type-Options': 'nosniff',
  });
  createReadStream(target).on('error', () => response.destroy()).pipe(response);
}

const server = createServer(async (request, response) => {
  const pathname = new URL(request.url || '/', `http://${host}:${port}`).pathname;
  if (request.method === 'GET' && pathname === '/health') {
    sendJson(response, 200, { ok: true });
    return;
  }
  if (request.method === 'POST' && pathname === '/api/import-property') {
    if (rateLimit(request)) {
      sendJson(response, 429, { success: false, error: 'Demasiados intentos. Esperá unos minutos y volvé a probar.' });
      return;
    }
    try {
      const body = await readJson(request);
      if (typeof body.url !== 'string' || !body.url.trim()) {
        sendJson(response, 400, { success: false, error: 'Pegá el enlace de una propiedad.' });
        return;
      }
      const result = await importProperty(body.url);
      sendJson(response, result.success ? 200 : 422, result);
    } catch (error) {
      sendJson(response, 400, { success: false, error: error instanceof Error ? error.message : 'La solicitud no es válida.' });
    }
    return;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    sendJson(response, 405, { error: 'Método no permitido.' });
    return;
  }
  serveStatic(request, response);
});

server.listen(port, host, () => {
  console.log(`TRV CRM listo en http://${host}:${port}`);
});
