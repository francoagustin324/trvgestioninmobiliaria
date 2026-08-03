import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync('index.html', 'utf8');
const whatsappScope = readFileSync('src/whatsapp-action-scope.ts', 'utf8');

const shellVersion = '20260802-1';

test('carga una versión nueva y coordinada del shell móvil', () => {
  assert.ok(html.includes(`/dist/cloud-compat-bootstrap.js?v=${shellVersion}`));
  assert.ok(html.includes(`/dist/mvp-main.js?v=${shellVersion}`));
  assert.ok(html.includes(`/dist/lead-real-use-ui.js?v=${shellVersion}`));
  assert.ok(html.includes(`/dist/invitation-link-ux.js?v=${shellVersion}`));
  assert.ok(html.includes(`/dist/sync-recovery-bootstrap.js?v=${shellVersion}`));
  assert.ok(html.includes(`/dist/whatsapp-action-scope.js?v=${shellVersion}`));
  assert.equal(html.includes('/dist/whatsapp-contact-ui.js'), false);
  assert.ok(whatsappScope.includes("from './whatsapp-contact-ui.js'"));
  assert.equal(html.includes('/dist/mvp-main.js?v=20260722-96'), false);
});

test('mantiene cargado el CSS de navegación inferior y agrega estabilización de uso real', () => {
  assert.ok(html.includes('/src/mobile-bottom-nav.css?v=20260728-1'));
  assert.ok(html.includes('/src/mobile-leads-polish.css?v=20260728-1'));
  assert.ok(html.includes(`/src/real-use-stabilization.css?v=${shellVersion}`));
});
