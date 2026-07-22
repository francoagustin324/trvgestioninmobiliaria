import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync('index.html', 'utf8');
const tokens = readFileSync('src/design-tokens.css', 'utf8');

test('carga la fundación visual sin alterar el arranque de la aplicación', () => {
  assert.ok(html.includes('/src/design-tokens.css?v=20260722-1'));
  assert.ok(html.includes('<div class="app-backdrop" aria-hidden="true"></div>'));
  assert.ok(html.indexOf('app-backdrop') < html.indexOf('id="root"'));
});

test('define superficies glass y compatibilidad sin backdrop-filter', () => {
  assert.ok(tokens.includes('.glass {'));
  assert.ok(tokens.includes('.glass-brand {'));
  assert.ok(tokens.includes('backdrop-filter: blur(22px) saturate(1.45)'));
  assert.ok(tokens.includes('@supports not ((backdrop-filter: blur(1px))'));
});

test('incluye movimiento accesible y foco visible', () => {
  assert.ok(tokens.includes('.app-backdrop {'));
  assert.ok(tokens.includes('@keyframes backdrop-drift'));
  assert.ok(tokens.includes('@media (prefers-reduced-motion: reduce)'));
  assert.ok(tokens.includes(':focus-visible'));
});

test('la fundación no incorpora frameworks ni librerías ajenas al stack actual', () => {
  const foundation = `${html}\n${tokens}`.toLowerCase();
  assert.equal(foundation.includes('react'), false);
  assert.equal(foundation.includes('tailwind'), false);
  assert.equal(foundation.includes('framer-motion'), false);
  assert.equal(foundation.includes('lucide-react'), false);
});

test('el skin liquid glass reviste el login y se carga al final', () => {
  const skin = readFileSync('src/liquid-glass-skin.css', 'utf8');
  assert.ok(html.includes('/src/liquid-glass-skin.css'));
  // debe cargarse después del resto de los estilos para poder sobrescribir
  assert.ok(html.indexOf('liquid-glass-skin.css') > html.indexOf('mvp.css'));
  assert.ok(skin.includes('.public-auth-card'));
  assert.ok(skin.includes('.public-auth-shell'));
  const s = skin.toLowerCase();
  assert.equal(s.includes('react'), false);
  assert.equal(s.includes('tailwind'), false);
});
