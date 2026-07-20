import assert from 'node:assert/strict';
import test from 'node:test';
import { clientIp, staticCacheControl } from '../server/request-helpers.js';

test('clientIp usa la IP real reenviada por el proxy, no la del socket', () => {
  assert.equal(clientIp({ 'x-forwarded-for': '203.0.113.5, 10.0.0.1' }, '10.0.0.1'), '203.0.113.5');
  assert.equal(clientIp({ 'x-forwarded-for': '198.51.100.9' }, '10.0.0.1'), '198.51.100.9');
  assert.equal(clientIp({}, '198.51.100.7'), '198.51.100.7');
  assert.equal(clientIp({}), 'unknown');
});

test('cachea fuerte los assets versionados y nunca el HTML', () => {
  assert.equal(staticCacheControl('/dist/mvp-main.js?v=20260718-42', '.js'), 'public, max-age=31536000, immutable');
  assert.equal(staticCacheControl('/src/mvp.css?v=20260717-41', '.css'), 'public, max-age=31536000, immutable');
  // Sin ?v no se cachea (por si algún asset se pide sin versión).
  assert.equal(staticCacheControl('/dist/mvp-main.js', '.js'), 'no-store, no-cache, must-revalidate, max-age=0');
  // El HTML nunca se cachea, aunque llegue con ?v, para tomar cada deploy.
  assert.equal(staticCacheControl('/index.html?v=1', '.html'), 'no-store, no-cache, must-revalidate, max-age=0');
});
