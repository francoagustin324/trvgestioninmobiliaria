import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync('index.html', 'utf8');
const css = readFileSync('src/mobile-leads-polish.css', 'utf8');

test('carga el pulido de Leads después de la navegación móvil', () => {
  assert.ok(html.includes('/src/mobile-leads-polish.css?v=20260722-2'));
  assert.ok(html.indexOf('mobile-leads-polish.css') > html.indexOf('mobile-bottom-nav.css'));
});

test('limita los cambios a la experiencia móvil y al módulo Leads', () => {
  assert.ok(css.includes('@media (max-width: 720px)'));
  assert.ok(css.includes('#crm .mvp-lead-card-with-matches'));
  assert.ok(css.includes('#crm .mvp-lead-toolbar'));
  assert.ok(css.includes('#crm .mvp-lead-card-main'));
  assert.ok(css.includes('#crm .mvp-lead-matches > summary'));
});

test('mantiene accesibles contactos y acciones comerciales', () => {
  assert.ok(css.includes('#crm .mvp-contact-btn'));
  assert.ok(css.includes('#crm .mvp-lead-actions .mvp-icon-btn'));
  assert.equal(css.includes('.mvp-contact-btn { display: none'), false);
  assert.equal(css.includes('.mvp-lead-actions { display: none'), false);
});

test('no incorpora frameworks ni afecta datos o seguridad', () => {
  const source = `${html}\n${css}`.toLowerCase();
  assert.equal(source.includes('react'), false);
  assert.equal(source.includes('tailwind'), false);
  assert.equal(source.includes('supabase'), false);
  assert.equal(source.includes('localstorage'), false);
});