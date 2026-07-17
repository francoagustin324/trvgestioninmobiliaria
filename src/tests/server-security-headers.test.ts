import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const server = readFileSync('src/server.ts', 'utf8');

test('aplica cabeceras de seguridad antes de procesar cualquier ruta', () => {
  const applyPosition = server.indexOf('applySecurityHeaders(response);');
  const webhookPosition = server.indexOf('handleWhatsAppWebhook(request, response');
  assert.ok(applyPosition >= 0);
  assert.ok(webhookPosition > applyPosition);
});

test('protege la aplicación contra inyección, iframes y filtración de referencias', () => {
  assert.ok(server.includes("response.setHeader('Content-Security-Policy'"));
  assert.ok(server.includes("\"default-src 'self'\""));
  assert.ok(server.includes("\"script-src 'self'\""));
  assert.ok(server.includes("\"frame-ancestors 'none'\""));
  assert.ok(server.includes("response.setHeader('X-Frame-Options', 'DENY')"));
  assert.ok(server.includes("response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')"));
});

test('permite únicamente las conexiones necesarias para PropControl y Supabase', () => {
  assert.ok(server.includes('safeOrigin(supabaseUrl)'));
  assert.ok(server.includes('`connect-src ${connectSources}`'));
  assert.ok(server.includes("\"img-src 'self' data: blob: https:\""));
});
