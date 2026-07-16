import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const ui = readFileSync('src/mvp-properties-ui.ts', 'utf8');
const css = readFileSync('src/mvp-properties.css', 'utf8');
const html = readFileSync('index.html', 'utf8');

test('Propiedades ofrece ver y compartir una ficha para cliente', () => {
  assert.ok(ui.includes('data-share-property-ficha'));
  assert.ok(ui.includes('data-open-property-ficha'));
  assert.ok(ui.includes('propertyFichaLink(property)'));
  assert.ok(ui.includes('navigator.share'));
  assert.ok(ui.includes('Enlace copiado'));
});

test('el formulario separa información comercial e interna', () => {
  assert.ok(ui.includes('Información comercial'));
  assert.ok(ui.includes('Información interna'));
  assert.ok(ui.includes('Descripción comercial'));
  assert.ok(ui.includes('Fotos de la ficha'));
  assert.ok(ui.includes('No aparece en la ficha del cliente'));
});

test('las fotos se cargan desde el dispositivo, se ordenan y se eliminan de la ficha', () => {
  assert.ok(ui.includes('type="file"'));
  assert.ok(ui.includes('accept="image/*"'));
  assert.ok(ui.includes('multiple'));
  assert.ok(ui.includes('uploadPropertyPhoto'));
  assert.ok(ui.includes('data-photo-left'));
  assert.ok(ui.includes('data-photo-right'));
  assert.ok(ui.includes('data-photo-remove'));
});

test('el diseño presenta un flujo profesional y responsive', () => {
  assert.ok(css.includes('.mvp-property-flow'));
  assert.ok(css.includes('.mvp-property-photo-grid'));
  assert.ok(css.includes('.mvp-property-card-actions'));
  assert.ok(css.includes('.mvp-property-form-section-internal'));
  assert.ok(css.includes('@media (max-width:640px)'));
  assert.ok(html.includes('/src/mvp-properties.css?v=20260715-38'));
  assert.ok(html.includes('/dist/mvp-main.js?v=20260715-38'));
});
