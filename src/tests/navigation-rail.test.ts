import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const main = readFileSync('src/mvp-main.ts', 'utf8');
const css = readFileSync('src/mobile-layout-fix.css', 'utf8');
const html = readFileSync('index.html', 'utf8');

test('cada módulo principal muestra icono y etiqueta accesible', () => {
  for (const moduleId of ['crm', 'whatsapp', 'agenda', 'propiedades', 'equipo']) {
    assert.ok(main.includes(`${moduleId}: '<svg`), moduleId);
  }
  assert.ok(main.includes('class="nav-icon"'));
  assert.ok(main.includes('class="nav-label"'));
  assert.ok(main.includes('title="${label}"'));
});

test('en celular la barra queda visible a la izquierda sin menú desplegable', () => {
  assert.ok(css.includes('@media (max-width: 720px)'));
  assert.ok(css.includes('--pc-mobile-rail: 80px'));
  assert.match(css, /\.mvp-sidebar\s*\{[\s\S]*transform:\s*none\s*!important/);
  assert.match(css, /\.mvp-topbar \.mobile-nav-trigger\s*\{?[\s\S]*display:\s*none\s*!important/);
  assert.match(css, /\.mvp-content\s*\{[\s\S]*margin:\s*0 0 0 var\(--pc-mobile-rail\)\s*!important/);
});

test('la versión publicada renueva los dos módulos JavaScript juntos', () => {
  const compatibilityVersion = html.match(/cloud-compat-bootstrap\.js\?v=([^"']+)/)?.[1];
  const mainVersion = html.match(/mvp-main\.js\?v=([^"']+)/)?.[1];
  assert.ok(compatibilityVersion);
  assert.equal(mainVersion, compatibilityVersion);
});
