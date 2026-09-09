import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const ui = readFileSync('src/mvp-properties-ui.ts', 'utf8');
const css = readFileSync('src/mvp-properties.css', 'utf8');
const html = readFileSync('index.html', 'utf8');

 test('Propiedades publica, abre y comparte una ficha corta para cliente con scope/lease capturados', () => {
  assert.ok(ui.includes('data-share-property-ficha'));
  assert.ok(ui.includes('data-open-property-ficha'));
  assert.ok(ui.includes('publishAndRememberPropertyFicha(property, scope, runtimeLease)'));
  assert.ok(ui.includes('captureTenantRuntimeLease(scope)'));
  assert.ok(ui.includes('navigator.share'));
  assert.ok(ui.includes('Enlace corto copiado'));
  assert.ok(ui.includes('Ficha publicada'));
});

test('una ficha ya publicada se actualiza al guardar cambios bajo el mismo helper tenant-aware', () => {
  assert.ok(ui.includes('if (property.publicSlug)'));
  assert.ok(ui.includes('Actualizando ficha pública'));
  assert.ok(ui.includes("'Ficha pública actualizada'"));
  assert.ok(ui.includes('publishAndRememberPropertyFicha('));
  assert.ok(ui.includes('assertPropertyShareOperationCurrent(scope, runtimeLease)'));
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
  assert.ok(ui.includes('await uploadPropertyPhoto(file, propertyId, scope, runtimeLease)'));
  assert.ok(ui.includes('propertyPhotoOperationIsCurrent(scope, runtimeLease, form.isConnected)'));
  assert.ok(ui.includes('data-photo-left'));
  assert.ok(ui.includes('data-photo-right'));
  assert.ok(ui.includes('data-photo-remove'));
});

test('Propiedades conserva el contrato A2.2 sin tutorial permanente y mantiene el diseño responsive', () => {
  assert.ok(ui.includes('<h1>Propiedades</h1>'));
  assert.ok(ui.includes('Gestioná tu inventario y encontrá clientes compatibles.'));
  assert.ok(ui.includes('data-toggle="property-form">Nueva propiedad</button>'));
  assert.ok(ui.includes('data-open-property-opportunities>Buscar clientes compatibles</button>'));
  assert.equal(ui.includes('1. Cargá la propiedad'), false);
  assert.equal(ui.includes('2. Agregá y ordená las fotos'), false);
  assert.equal(ui.includes('3. Compartí la ficha'), false);
  assert.equal(css.includes('.mvp-property-flow'), false);
  assert.ok(css.includes('.mvp-property-photo-grid'));
  assert.ok(css.includes('.mvp-property-card-actions'));
  assert.ok(css.includes('.mvp-property-form-section-internal'));
  assert.ok(css.includes('@media (max-width:640px)'));
  assert.ok(html.includes('/src/mvp-properties.css?v=20260906-p1-4-a2-2-1'));
  assert.ok(html.includes('/src/mobile-properties-polish.css?v=20260906-p1-4-a2-2-1'));
  assert.ok(html.includes('/dist/mvp-main.js?v=20260906-p1-4-a2-2-1'));
});
