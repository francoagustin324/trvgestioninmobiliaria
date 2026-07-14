import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../mobile-layout-fix.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

test('la cabecera movil usa una sola fila compacta', () => {
  assert.match(css, /\.mvp-topbar\s*\{[\s\S]*display:\s*flex\s*!important/);
  assert.match(css, /\.mvp-topbar-spacer\s*\{[\s\S]*display:\s*none\s*!important/);
});

test('menu queda a la izquierda y cuenta a la derecha', () => {
  assert.match(css, /\.mvp-topbar \.mobile-nav-trigger\s*\{[\s\S]*order:\s*0/);
  assert.match(css, /\.mvp-topbar #cloud-account\s*\{[\s\S]*margin-left:\s*auto/);
  assert.match(css, /\.mvp-topbar #cloud-account\s*\{[\s\S]*justify-content:\s*flex-end\s*!important/);
});

test('la correccion movil tiene version de cache nueva', () => {
  assert.match(html, /mobile-layout-fix\.css\?v=20260714-25/);
});
