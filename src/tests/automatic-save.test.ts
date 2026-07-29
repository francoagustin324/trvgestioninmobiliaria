import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('el guardado automático usa la misma compatibilidad segura que la sincronización manual', () => {
  const store = readFileSync('src/store.ts', 'utf8');
  assert.ok(store.includes("import { queueCloudSave } from './cloud-api-compatible.js'"));
  assert.equal(store.includes("import { queueCloudSave } from './cloud-api.js'"), false);
});

test('el menú de cuenta no repite el correo cuando existe una identidad humana presentable', () => {
  const auth = readFileSync('src/mvp-auth.ts', 'utf8');
  const presentation = readFileSync('src/account-menu-presentation.ts', 'utf8');
  assert.ok(auth.includes('accountIdentityPresentation({'));
  assert.ok(auth.includes('identity.name'));
  assert.ok(auth.includes('identity.detail'));
  assert.ok(presentation.includes('input.settings.profileName'));
  assert.ok(presentation.includes('input.authenticatedMember || input.activeMember'));
  assert.ok(presentation.includes('readableEmailName(input.email'));
  // El correo puede derivar un nombre legible, pero nunca se imprime como identidad completa.
  assert.equal(auth.includes('const accountName = member?.name || session.email'), false);
  assert.equal(auth.includes('${escapeHtml(session.email)}'), false);
});

test('los módulos principales usan una misma versión de caché explícita', () => {
  const html = readFileSync('index.html', 'utf8');
  const mainVersion = html.match(/\/dist\/mvp-main\.js\?v=([^"']+)/)?.[1];
  const compatibilityVersion = html.match(/\/dist\/cloud-compat-bootstrap\.js\?v=([^"']+)/)?.[1];
  assert.ok(mainVersion);
  assert.equal(compatibilityVersion, mainVersion);
});
