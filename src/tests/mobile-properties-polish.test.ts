import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync('index.html', 'utf8');
const ui = readFileSync('src/mvp-properties-ui.ts', 'utf8');
const css = readFileSync('src/mobile-properties-polish.css', 'utf8');
const shellCss = readFileSync('src/mobile-bottom-nav.css', 'utf8');
const main = readFileSync('src/mvp-main.ts', 'utf8');
const packageJson = readFileSync('package.json', 'utf8').toLowerCase();

test('carga el pulido móvil de Propiedades después de las capas existentes', () => {
  assert.ok(html.includes('/src/mobile-properties-polish.css?v=20260723-1'));
  assert.ok(html.indexOf('mobile-properties-polish.css') > html.indexOf('mvp-properties.css'));
  assert.ok(html.indexOf('mobile-properties-polish.css') > html.indexOf('mobile-bottom-nav.css'));
});

test('la guía conserva los tres pasos y usa una grilla móvil sin scroll horizontal', () => {
  for (const step of ['1. Cargá la propiedad', '2. Agregá y ordená las fotos', '3. Compartí la ficha']) {
    assert.ok(ui.includes(step), step);
  }
  for (const shortStep of ["content: '1. Propiedad'", "content: '2. Fotos'", "content: '3. Publicar'"]) {
    assert.ok(css.includes(shortStep), shortStep);
  }
  assert.ok(css.includes('grid-template-columns: repeat(3, minmax(0, 1fr))'));
  assert.ok(css.includes('white-space: normal'));
  assert.equal(css.includes('overflow-x: auto'), false);
});

test('foto y placeholder comparten una estructura y proporción inmobiliaria uniforme', () => {
  assert.ok(ui.includes('class="mvp-property-cover"'));
  assert.ok(ui.includes('class="mvp-property-cover mvp-property-cover-empty"'));
  assert.ok(css.includes('aspect-ratio: 16 / 9'));
  assert.ok(css.includes('object-fit: cover'));
  assert.ok(css.includes('#propiedades .mvp-property-cover-empty'));
});

test('título, precio y metadatos mantienen jerarquía y wrapping controlado', () => {
  assert.ok(ui.includes('<span>USD ${priceFormatter.format(property.price)}</span>'));
  assert.ok(css.includes('#propiedades .mvp-property-title'));
  assert.ok(css.includes('#propiedades .mvp-property-title > span'));
  assert.ok(css.includes('#propiedades .mvp-property-meta'));
  assert.ok(css.includes('flex-wrap: wrap'));
  assert.ok(css.includes('overflow-wrap: anywhere'));
});

test('mantiene y ordena las acciones funcionales sin cambiar su lógica', () => {
  for (const action of ['data-share-property-ficha', 'data-open-property-ficha', 'data-edit-property', 'data-delete="properties"']) {
    assert.ok(ui.includes(action), action);
  }
  assert.ok(css.includes('[data-share-property-ficha]'));
  assert.ok(css.includes('grid-column: 1 / -1'));
  assert.ok(css.includes("content: 'Eliminar'"));
  assert.ok(main.includes("window.confirm('¿Eliminar este registro?"));
  assert.ok(main.includes("removeItem(collection, id)"));
});

test('conserva estados de fotos, ficha, operación, estado e interno responsable', () => {
  for (const marker of ['Sin fotos', 'Ficha publicada', 'Ficha sin publicar', 'mvp-property-internal', 'property.operation', 'property.status']) {
    assert.ok(ui.includes(marker), marker);
  }
});

test('reutiliza el espacio inferior global y safe area sin duplicarlo', () => {
  assert.ok(shellCss.includes('env(safe-area-inset-bottom)'));
  assert.ok(shellCss.includes('var(--pc-mobile-nav-height) + 40px'));
  assert.ok(css.includes('padding-bottom: 12px'));
  assert.equal(css.includes('--pc-mobile-nav-height'), false);
});

test('no cambia URLs públicas, dependencias ni stack técnico', () => {
  assert.ok(ui.includes('publishPropertyFicha(property)'));
  assert.ok(ui.includes('published.url'));
  assert.equal(css.includes('/ficha/'), false);
  assert.equal(packageJson.includes('"react"'), false);
  assert.equal(packageJson.includes('tailwind'), false);
  assert.equal(css.toLowerCase().includes('supabase'), false);
});
