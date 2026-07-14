import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('el botón Editar abre directamente el formulario del lead', () => {
  const source = readFileSync('src/mvp-leads-ui.ts', 'utf8');
  for (const marker of [
    "container.querySelectorAll<HTMLButtonElement>('[data-edit-client]')",
    "button.addEventListener('click'",
    'state.editingClientId = clientId;',
    'state.openForms.client = true;',
    'renderMvpLeads(container);',
    'focusLeadForm(container);',
  ]) assert.ok(source.includes(marker), marker);
});

test('la edición lleva la pantalla al formulario y enfoca el nombre', () => {
  const source = readFileSync('src/mvp-leads-ui.ts', 'utf8');
  assert.ok(source.includes('#mvp-lead-form:not(.collapsed)'));
  assert.ok(source.includes("form.scrollIntoView({ behavior: 'smooth', block: 'start' });"));
  assert.ok(source.includes('input[name="name"]'));
  assert.ok(source.includes('focus({ preventScroll: true })'));
});

test('la entrada principal dejó atrás la caché anterior del módulo', () => {
  const html = readFileSync('index.html', 'utf8');
  const mainVersion = html.match(/\/dist\/mvp-main\.js\?v=([^"']+)/)?.[1];
  const compatibilityVersion = html.match(/\/dist\/cloud-compat-bootstrap\.js\?v=([^"']+)/)?.[1];
  assert.ok(mainVersion);
  assert.notEqual(mainVersion, '20260714-22');
  assert.equal(compatibilityVersion, mainVersion);
});
