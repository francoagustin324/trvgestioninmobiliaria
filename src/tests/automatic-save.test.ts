import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('el guardado automático usa la misma compatibilidad segura que la sincronización manual', () => {
  const store = readFileSync('src/store.ts', 'utf8');
  assert.ok(store.includes("import { queueCloudSave } from './cloud-api-compatible.js'"));
  assert.equal(store.includes("import { queueCloudSave } from './cloud-api.js'"), false);
});

test('el menú de cuenta no repite el correo cuando el usuario todavía no está vinculado al directorio', () => {
  const auth = readFileSync('src/mvp-auth.ts', 'utf8');
  assert.ok(auth.includes("const accountName = member?.name || state.crm.organization.name || 'Cuenta PropControl';"));
  assert.ok(auth.includes('const accountDetail = member?.role || session.email;'));
  assert.ok(auth.includes('${escapeHtml(accountName)}'));
  assert.ok(auth.includes('${escapeHtml(accountDetail)}'));
});

test('los módulos principales usan una misma versión de caché explícita', () => {
  const html = readFileSync('index.html', 'utf8');
  const mainVersion = html.match(/\/dist\/mvp-main\.js\?v=([^"']+)/)?.[1];
  const compatibilityVersion = html.match(/\/dist\/cloud-compat-bootstrap\.js\?v=([^"']+)/)?.[1];
  assert.ok(mainVersion);
  assert.equal(compatibilityVersion, mainVersion);
});
