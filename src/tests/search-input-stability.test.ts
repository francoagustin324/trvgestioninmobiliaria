import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const leadsUi = readFileSync('src/mvp-leads-ui.ts', 'utf8');
const propertiesUi = readFileSync('src/mvp-properties-ui.ts', 'utf8');

function inputHandler(source: string, inputId: string): string {
  const start = source.indexOf(`container.querySelector<HTMLInputElement>('#${inputId}')?.addEventListener('input'`);
  assert.notEqual(start, -1, `No se encontró el evento input de ${inputId}`);
  return source.slice(start, source.indexOf('\n  });', start) + 6);
}

test('el buscador de propiedades actualiza resultados sin reconstruir el campo', () => {
  const handler = inputHandler(propertiesUi, 'mvp-property-search');
  assert.ok(handler.includes('updatePropertyResults(container)'));
  assert.ok(!handler.includes('renderMvpProperties(container)'));
  assert.ok(propertiesUi.includes('id="mvp-property-results"'));
  assert.ok(propertiesUi.includes('id="mvp-property-count"'));
});

test('el buscador de leads actualiza resultados sin reconstruir el campo', () => {
  const handler = inputHandler(leadsUi, 'mvp-lead-search');
  assert.ok(handler.includes('updateLeadResults(container)'));
  assert.ok(!handler.includes('renderMvpLeads(container)'));
  assert.ok(leadsUi.includes('id="mvp-lead-results"'));
  assert.ok(leadsUi.includes('id="mvp-lead-count"'));
});
