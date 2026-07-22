import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync('index.html', 'utf8');

test('carga una versión nueva del shell principal después de la navegación inferior', () => {
  assert.ok(html.includes('/dist/mvp-main.js?v=20260722-95'));
  assert.equal(html.includes('/dist/mvp-main.js?v=20260722-44'), false);
});

test('mantiene cargado el CSS de navegación inferior', () => {
  assert.ok(html.includes('/src/mobile-bottom-nav.css?v=20260722-1'));
});
