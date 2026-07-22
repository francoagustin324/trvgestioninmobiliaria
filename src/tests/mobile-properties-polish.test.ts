import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync('index.html', 'utf8');
const css = readFileSync('src/mobile-properties-polish.css', 'utf8');

test('carga el pulido de Propiedades después de Leads móvil', () => {
  assert.ok(html.includes('/src/mobile-properties-polish.css?v=20260722-1'));
  assert.ok(html.indexOf('mobile-properties-polish.css') > html.indexOf('mobile-leads-polish.css'));
});

test('limita los cambios a móvil y al módulo Propiedades', () => {
  assert.ok(css.includes('@media (max-width: 720px)'));
  assert.ok(css.includes('#propiedades .mvp-property-card'));
  assert.ok(css.includes('#propiedades .mvp-property-cover'));
  assert.ok(css.includes('#propiedades .mvp-property-card-actions'));
  assert.ok(css.includes('#propiedades .mvp-property-flow'));
});

test('mantiene disponibles las acciones funcionales de cada propiedad', () => {
  assert.ok(css.includes('[data-open-property-ficha]'));
  assert.ok(css.includes('[data-share-property-ficha]'));
  assert.ok(css.includes('[data-edit-property]'));
  assert.ok(css.includes('.delete'));
  assert.equal(css.includes('display: none; /* action'), false);
});

test('no incorpora frameworks ni modifica datos o seguridad', () => {
  const source = `${html}\n${css}`.toLowerCase();
  assert.equal(source.includes('react'), false);
  assert.equal(source.includes('tailwind'), false);
  assert.equal(source.includes('supabase'), false);
  assert.equal(source.includes('localstorage'), false);
});
