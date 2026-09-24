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

test('el módulo principal usa el workspace estable de Propiedades y mantiene el borrado protegido', () => {
  assert.ok(main.includes("import { renderMvpPropertiesWorkspace } from './mvp-properties-workspace.js'"));
  assert.ok(main.includes("renderMvpPropertiesWorkspace(qs<HTMLElement>('#propiedades'))"));
  assert.equal(main.includes("import { renderMvpProperties } from './mvp-properties-ui.js'"), false);
  assert.ok(main.includes("window.confirm('¿Eliminar este registro? OrdenBroker guardará una copia local anterior.')"));
});

test('los estilos de propiedades están publicados y contemplan celular', () => {
  assert.ok(css.includes('.mvp-property-form'));
  assert.ok(css.includes('.mvp-property-card'));
  assert.ok(css.includes('@media (max-width:640px)'));
  assert.match(css, /#propiedades \.mvp-property-form select \{[\s\S]*color:var\(--ob-navy\)[\s\S]*background:#fff/);
  assert.match(css, /#propiedades \.mvp-property-form select option \{[\s\S]*color:var\(--ob-navy\)[\s\S]*background:#fff/);
  assert.match(css, /#propiedades \.mvp-property-form select:focus-visible \{[\s\S]*outline:3px solid var\(--ob-secondary\)/);
  assert.match(css, /#propiedades \.mvp-property-form select:disabled \{[\s\S]*color:var\(--ob-slate\)[\s\S]*opacity:1/);
  assert.ok(html.includes('/src/mvp-properties.css?v=20260924-block2b-1'));
});


test('Bloque 2B usa alta esencial progresiva y rollback visible sin exigir datos secundarios', () => {
  for (const marker of [
    'mvp-property-quick-grid',
    'Título comercial',
    'Zona o ubicación aproximada',
    'Seleccionar tipo',
    'Seleccionar operación',
    'Precio USD',
    'Completar características',
    '<summary>Fotos</summary>',
    '<summary>Información interna</summary>',
    'rollbackPropertySave(form, writeContext, previousCrm)',
    'Los datos y fotos siguen en el formulario para reintentar',
  ]) assert.ok(propertiesUi.includes(marker), marker);

  assert.doesNotMatch(propertiesUi, /name="owner"[^>]*required/);
  assert.doesNotMatch(propertiesUi, /name="bedrooms"[^>]*required/);
  assert.doesNotMatch(propertiesUi, /name="bathrooms"[^>]*required/);
  assert.match(propertiesUi, /status: field\(values, 'status'\)\.trim\(\) \|\| editing\?\.status \|\| 'Activa'/);
  assert.match(propertiesUi, /price <= 0/);
});
