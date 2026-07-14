import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const ui = readFileSync('src/agenda-ui.ts', 'utf8');
const css = readFileSync('src/agenda.css', 'utf8');
const html = readFileSync('index.html', 'utf8');

test('el formulario usa un selector buscable únicamente de leads', () => {
  assert.ok(ui.includes('agendaRelatedOptions(state.crm.clients)'));
  assert.ok(!ui.includes('state.crm.properties'));
  assert.ok(ui.includes('filterAgendaRelatedOptions(options, input.value)'));
  assert.ok(ui.includes('<label for="agenda-related-input">Lead</label>'));
  assert.ok(ui.includes('role="combobox"'));
  assert.ok(ui.includes('role="listbox"'));
  assert.ok(ui.includes('data-related-key'));
});

test('las tarjetas quedan en una sola secuencia vertical y con acciones secundarias agrupadas', () => {
  assert.match(css, /\.agenda-board\s*\{[^}]*grid-template-columns:\s*1fr/);
  assert.ok(ui.includes('agenda-position'));
  assert.ok(ui.includes('<summary>Más acciones</summary>'));
  assert.ok(ui.includes('Ordenados por fecha y prioridad.'));
});

test('renueva juntos el módulo principal, recuperación y estilos de agenda', () => {
  const compatibilityVersion = html.match(/cloud-compat-bootstrap\.js\?v=([^"']+)/)?.[1];
  const mainVersion = html.match(/mvp-main\.js\?v=([^"']+)/)?.[1];
  const recoveryVersion = html.match(/sync-recovery-bootstrap\.js\?v=([^"']+)/)?.[1];
  const agendaVersion = html.match(/agenda\.css\?v=([^"']+)/)?.[1];
  assert.ok(compatibilityVersion);
  assert.equal(mainVersion, compatibilityVersion);
  assert.equal(recoveryVersion, compatibilityVersion);
  assert.equal(agendaVersion, compatibilityVersion);
});
