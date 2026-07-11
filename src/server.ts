import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importProperty } from './server/import-service.js';
import { storeExtensionImport, takeExtensionImport } from './server/extension-import-store.js';
import { handleWhatsAppWebhook, WebhookDeduplicator } from './server/whatsapp-webhook.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.PORT || 4173);
const host = '0.0.0.0';
const supabaseUrl = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/g, '');
const supabasePublishableKey = (process.env.SUPABASE_PUBLISHABLE_KEY || '').trim();
const cloudConfigured = Boolean(supabaseUrl && supabasePublishableKey);
const whatsappWebhookVerifyToken = (process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || '').trim();
const metaAppSecret = (process.env.META_APP_SECRET || '').trim();
const whatsappWebhookDeduplicator = new WebhookDeduplicator();
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
  '.zip': 'application/zip',
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
  return current.count > 30;
}

function sendJson(response: ServerResponse, status: number, payload: unknown, extraHeaders: Record<string, string> = {}): void {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  });
  response.end(JSON.stringify(payload));
}

async function readJson(request: IncomingMessage, maxBytes = 10_000): Promise<Record<string, unknown>> {
  const contentType = request.headers['content-type'] || '';
  if (!contentType.toLowerCase().startsWith('application/json')) throw new Error('La solicitud debe enviarse como JSON.');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > maxBytes) throw new Error('La solicitud es demasiado grande.');
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  const parsed: unknown = JSON.parse(raw || '{}');
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('El contenido JSON no es válido.');
  return parsed as Record<string, unknown>;
}

function extensionCorsHeaders(request: IncomingMessage): Record<string, string> | null {
  const origin = request.headers.origin;
  const marker = request.headers['x-trv-extension'];
  const chromeOrigin = typeof origin === 'string' && /^chrome-extension:\/\/[a-p]{32}$/.test(origin);
  const serviceWorkerWithoutOrigin = origin === undefined && marker === '1';
  if (!chromeOrigin && !serviceWorkerWithoutOrigin) return null;
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-TRV-Extension',
    'Access-Control-Max-Age': '600',
  };
  if (chromeOrigin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers.Vary = 'Origin';
  }
  return headers;
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

  const whatsappHandled = await handleWhatsAppWebhook(request, response, {
    verifyToken: whatsappWebhookVerifyToken,
    appSecret: metaAppSecret,
    deduplicator: whatsappWebhookDeduplicator,
    onEvent: ({ duplicate, summary }) => {
      console.info('WhatsApp webhook recibido', JSON.stringify({
        duplicate,
        messages: summary.messageIds.length,
        statuses: summary.statusKeys.length,
        phoneNumbers: summary.phoneNumberIds.length,
      }));
    },
  });
  if (whatsappHandled) return;

  if (request.method === 'GET' && pathname === '/health') {
    sendJson(response, 200, { ok: true, cloudConfigured });
    return;
  }

  if (request.method === 'GET' && pathname === '/api/cloud-config') {
    sendJson(response, 200, cloudConfigured
      ? { configured: true, url: supabaseUrl, publishableKey: supabasePublishableKey }
      : { configured: false });
    return;
  }

  if (pathname === '/api/extension-import' && request.method === 'OPTIONS') {
    const cors = extensionCorsHeaders(request);
    if (!cors) {
      sendJson(response, 403, { success: false, error: 'Origen no autorizado.' });
      return;
    }
    response.writeHead(204, cors);
    response.end();
    return;
  }

  if (pathname === '/api/extension-import' && request.method === 'POST') {
    const cors = extensionCorsHeaders(request);
    if (!cors) {
      sendJson(response, 403, { success: false, error: 'Origen no autorizado.' });
      return;
    }
    if (rateLimit(request)) {
      sendJson(response, 429, { success: false, error: 'Demasiados intentos. Esperá unos minutos y volvé a probar.' }, cors);
      return;
    }
    try {
      const body = await readJson(request, 600_000);
      if (typeof body.sourceUrl !== 'string' || !body.sourceUrl.trim()) throw new Error('Falta el enlace original de la publicación.');
      if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data)) throw new Error('La extensión no envió datos válidos.');
      const token = storeExtensionImport(body.sourceUrl, body.data);
      sendJson(response, 201, { success: true, token }, cors);
    } catch (error) {
      sendJson(response, 400, { success: false, error: error instanceof Error ? error.message : 'No se pudo recibir la publicación.' }, cors);
    }
    return;
  }

  const extensionTokenMatch = pathname.match(/^\/api\/extension-import\/([0-9a-f-]{36})$/i);
  if (request.method === 'GET' && extensionTokenMatch?.[1]) {
    const payload = takeExtensionImport(extensionTokenMatch[1]);
    if (!payload) {
      sendJson(response, 404, { success: false, error: 'La importación venció o ya fue utilizada. Volvé a usar la extensión.' });
      return;
    }
    sendJson(response, 200, payload);
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
  console.log(`PropControl listo en http://${host}:${port} · nube ${cloudConfigured ? 'configurada' : 'pendiente'}`);
});
