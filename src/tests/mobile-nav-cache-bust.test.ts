import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync('index.html', 'utf8');

const shellVersion = '20260729-2';

test('carga una versión nueva y coordinada del shell móvil', () => {
  assert.ok(html.includes(`/dist/cloud-compat-bootstrap.js?v=${shellVersion}`));
  assert.ok(html.includes(`/dist/mvp-main.js?v=${shellVersion}`));
  assert.ok(html.includes(`/dist/invitation-link-ux.js?v=${shellVersion}`));
  assert.ok(html.includes(`/dist/sync-recovery-bootstrap.js?v=${shellVersion}`));
  assert.equal(html.includes('/dist/mvp-main.js?v=20260722-96'), false);
});

test('mantiene cargado el CSS de navegación inferior con versión B1.2.2', () => {
  assert.ok(html.includes('/src/mobile-bottom-nav.css?v=20260728-1'));
  assert.ok(html.includes('/src/mobile-leads-polish.css?v=20260728-1'));
});
