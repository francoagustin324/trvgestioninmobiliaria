import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync('index.html', 'utf8');
const main = readFileSync('src/mvp-main.ts', 'utf8');
const css = readFileSync('src/mobile-bottom-nav.css', 'utf8');

test('carga el ajuste móvil después del skin visual principal', () => {
  assert.ok(html.includes('/src/mobile-bottom-nav.css?v=20260722-1'));
  assert.ok(html.indexOf('mobile-bottom-nav.css') > html.indexOf('liquid-glass-skin.css'));
});

test('renderiza una navegación móvil accesible con los cinco módulos principales', () => {
  assert.ok(main.includes('class="mobile-bottom-nav"'));
  assert.ok(main.includes('aria-label="Navegación móvil"'));
  assert.ok(main.includes("whatsapp: 'Chats'"));
  assert.ok(main.includes("agenda: 'Agenda'"));
  assert.ok(main.includes("equipo: 'Equipo'"));
});

test('sincroniza estado, permisos y aria-current en todas las copias de navegación', () => {
  assert.ok(main.includes('querySelectorAll<HTMLButtonElement>'));
  assert.ok(main.includes("button.toggleAttribute('hidden', !allowed)"));
  assert.ok(main.includes("button.setAttribute('aria-current', 'page')"));
});

test('en teléfono reemplaza el riel lateral y recupera todo el ancho útil', () => {
  assert.ok(css.includes('@media (max-width: 720px)'));
  assert.ok(css.includes('.premium-sidebar,'));
  assert.ok(css.includes('display: none !important'));
  assert.ok(css.includes('width: 100% !important'));
  assert.ok(css.includes('margin: 0 !important'));
  assert.ok(css.includes('position: fixed'));
  assert.ok(css.includes('env(safe-area-inset-bottom)'));
});

test('no agrega frameworks ni modifica el stack técnico', () => {
  const foundation = `${html}\n${main}\n${css}`.toLowerCase();
  assert.equal(foundation.includes('tailwind'), false);
  assert.equal(foundation.includes('framer-motion'), false);
  assert.equal(foundation.includes('lucide-react'), false);
});
