import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const propertiesUi = readFileSync('src/mvp-properties-ui.ts', 'utf8');
const main = readFileSync('src/mvp-main.ts', 'utf8');
const store = readFileSync('src/store.ts', 'utf8');
const css = readFileSync('src/mvp-properties.css', 'utf8');
const html = readFileSync('index.html', 'utf8');

test('Propiedades usa el mismo formato operativo que Leads', () => {
  assert.ok(propertiesUi.includes('mvp-page-heading'));
  assert.ok(propertiesUi.includes('mvp-lead-form mvp-property-form'));
  assert.ok(propertiesUi.includes('mvp-lead-toolbar'));
  assert.ok(propertiesUi.includes('mvp-lead-card mvp-property-card'));
  assert.ok(propertiesUi.includes('data-edit-property'));
  assert.ok(propertiesUi.includes('data-delete="properties"'));
});

test('Propiedades permite buscar, crear y editar sin duplicar el registro', () => {
  assert.ok(propertiesUi.includes('mvp-property-search'));
  assert.ok(propertiesUi.includes('state.editingPropertyId'));
  assert.match(propertiesUi, /state\.crm\.properties\[index\] = property(?: as Property)?/);
  assert.match(propertiesUi, /state\.crm\.properties\.push\(property(?: as Property)?\)/);
  assert.ok(store.includes('editingPropertyId: null as number | null'));
});

test('el módulo principal usa la nueva interfaz y mantiene el borrado protegido', () => {
  assert.ok(main.includes("import { renderMvpProperties } from './mvp-properties-ui.js'"));
  assert.ok(main.includes("renderMvpProperties(qs<HTMLElement>('#propiedades'))"));
  assert.ok(main.includes("window.confirm('¿Eliminar este registro? PropControl guardará una copia local anterior.')"));
});

test('los estilos de propiedades están publicados y contemplan celular', () => {
  assert.ok(css.includes('.mvp-property-form'));
  assert.ok(css.includes('.mvp-property-card'));
  assert.ok(css.includes('@media (max-width:640px)'));
  assert.ok(html.includes('/src/mvp-properties.css?v='));
});
