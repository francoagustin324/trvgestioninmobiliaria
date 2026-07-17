import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const ui = readFileSync('src/mvp-properties-ui.ts', 'utf8');
const css = readFileSync('src/mvp-properties.css', 'utf8');
const html = readFileSync('index.html', 'utf8');

 test('Propiedades publica, abre y comparte una ficha corta para cliente', () => {
  assert.ok(ui.includes('data-share-property-ficha'));
  assert.ok(ui.includes('data-open-property-ficha'));
  assert.ok(ui.includes('publishPropertyFicha(property)'));
  assert.ok(ui.includes('navigator.share'));
  assert.ok(ui.includes('Enlace corto copiado'));
  assert.ok(ui.includes('Ficha publicada'));
});

test('una ficha ya publicada se actualiza al guardar cambios', () => {
  assert.ok(ui.includes('if (property.publicSlug)'));
  assert.ok(ui.includes('Actualizando ficha pública'));
  assert.ok(ui.includes("saveData('Ficha pública actualizada')"));
});

test('el formulario separa información comercial e interna', () => {
  assert.ok(ui.includes('Información comercial'));
  assert.ok(ui.includes('Información interna'));
  assert.ok(ui.includes('Descripción comercial'));
  assert.ok(ui.includes('Fotos de la ficha'));
  assert.ok(ui.includes('No aparece en la ficha del cliente'));
});

test('las fotos se cargan secuencialmente, se ordenan y se eliminan de la ficha', () => {
  assert.ok(ui.includes('type="file"'));
  assert.ok(ui.includes('accept="image/*"'));
  assert.ok(ui.includes('multiple'));
  assert.ok(ui.includes('for (let index = 0; index < files.length; index += 1)'));
  assert.ok(ui.includes('await uploadPropertyPhoto(file, propertyId)'));
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
  assert.ok(html.includes('/src/mvp-properties.css?v=20260717-41'));
  assert.ok(html.includes('/dist/mvp-main.js?v=20260717-41'));
});
