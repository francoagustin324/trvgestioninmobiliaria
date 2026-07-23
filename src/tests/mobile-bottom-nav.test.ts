import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync('index.html', 'utf8');
const main = readFileSync('src/mvp-main.ts', 'utf8');
const models = readFileSync('src/models.ts', 'utf8');
const css = readFileSync('src/mobile-bottom-nav.css', 'utf8');
const packageJson = readFileSync('package.json', 'utf8');

function mobileModuleIds(): string[] {
  const block = main.match(/const mobileNavigationModules: ModuleId\[\] = \[([\s\S]*?)\];/);
  assert.ok(block, 'Debe existir la lista explícita de módulos móviles');
  return [...block[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

test('carga el ajuste móvil después del skin visual principal', () => {
  assert.ok(html.includes('/src/mobile-bottom-nav.css?v=20260723-2'));
  assert.ok(html.indexOf('mobile-bottom-nav.css') > html.indexOf('liquid-glass-skin.css'));
});

test('la navegación móvil contiene exactamente los cinco accesos principales', () => {
  assert.deepEqual(mobileModuleIds(), ['crm', 'whatsapp', 'agenda', 'propiedades', 'equipo']);
  assert.equal(mobileModuleIds().includes('configuracion'), false);
  assert.ok(main.includes('class="mobile-bottom-nav"'));
  assert.ok(main.includes('aria-label="Navegación móvil"'));
  assert.ok(main.includes("whatsapp: 'Chats'"));
  assert.ok(main.includes("agenda: 'Agenda'"));
  assert.ok(main.includes("equipo: 'Equipo'"));
});

test('Configuración continúa en escritorio y se abre desde el menú del avatar', () => {
  assert.ok(models.includes("['configuracion', 'Configuración']"));
  assert.ok(main.includes(': modules;'));
  assert.ok(main.includes("canAccessModule('configuracion')"));
  assert.ok(main.includes("settingsButton.dataset.module = 'configuracion'"));
  assert.ok(main.includes("settingsButton.textContent = 'Configuración'"));
  assert.ok(main.includes("settingsButton.dataset.accountSettings = ''"));
  assert.ok(main.includes('logout.before(settingsButton)'));
  assert.ok(main.includes("removeAttribute('open')"));
});

test('sincroniza estado, permisos y aria-current en todas las copias de navegación', () => {
  assert.ok(main.includes('querySelectorAll<HTMLButtonElement>'));
  assert.ok(main.includes("button.toggleAttribute('hidden', !allowed)"));
  assert.ok(main.includes("button.setAttribute('aria-current', 'page')"));
});

test('cada cambio de módulo vuelve al inicio sin animación lenta', () => {
  assert.ok(main.includes('function resetModuleScroll(): void'));
  assert.ok(main.includes("behavior: 'auto'"));
  assert.ok(main.includes('window.scrollTo({ top: 0, left: 0'));
  assert.ok(main.includes('resetModuleScroll();'));
});

test('en teléfono mantiene una fila, ancho seguro y espacio inferior suficiente', () => {
  assert.ok(css.includes('@media (max-width: 720px)'));
  assert.ok(css.includes('grid-template-columns: repeat(5, minmax(0, 1fr))'));
  assert.ok(css.includes('right: var(--pc-mobile-nav-edge)'));
  assert.ok(css.includes('left: var(--pc-mobile-nav-edge)'));
  assert.ok(css.includes('padding: 12px 14px calc(var(--pc-mobile-nav-height) + 40px + env(safe-area-inset-bottom))'));
  assert.ok(css.includes('padding: 7px 7px calc(7px + env(safe-area-inset-bottom))'));
  assert.ok(css.includes('overflow: hidden'));
  assert.ok(css.includes('min-width: 0'));
});

test('no agrega frameworks ni modifica dependencias', () => {
  const foundation = `${html}\n${main}\n${css}\n${packageJson}`.toLowerCase();
  assert.equal(foundation.includes('tailwind'), false);
  assert.equal(foundation.includes('framer-motion'), false);
  assert.equal(foundation.includes('lucide-react'), false);
  assert.equal(foundation.includes('react"'), false);
});
