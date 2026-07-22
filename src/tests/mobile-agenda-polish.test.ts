import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync('index.html', 'utf8');
const css = readFileSync('src/mobile-agenda-polish.css', 'utf8');

test('carga el pulido de Seguimientos después de Usuarios', () => {
  assert.ok(html.includes('/src/mobile-agenda-polish.css?v=20260722-1'));
  assert.ok(html.indexOf('mobile-agenda-polish.css') > html.indexOf('mobile-users-polish.css'));
});

test('limita los cambios a móvil y al módulo Seguimientos', () => {
  assert.ok(css.includes('@media (max-width: 720px)'));
  assert.ok(css.includes('#agenda .agenda-summary'));
  assert.ok(css.includes('#agenda .agenda-section'));
  assert.ok(css.includes('#agenda .agenda-card'));
  assert.ok(css.includes('#agenda .agenda-card-actions'));
});

test('mantiene visibles completar, reprogramar y más acciones', () => {
  assert.ok(css.includes('#agenda .agenda-card-actions > button'));
  assert.ok(css.includes('#agenda .agenda-more-actions'));
  assert.ok(css.includes('#agenda .agenda-reprogram'));
  assert.equal(css.includes('.agenda-card-actions { display: none'), false);
});

test('no incorpora frameworks ni modifica recordatorios o seguridad', () => {
  const source = `${html}\n${css}`.toLowerCase();
  assert.equal(source.includes('react'), false);
  assert.equal(source.includes('tailwind'), false);
  assert.equal(source.includes('supabase'), false);
  assert.equal(source.includes('localstorage'), false);
});
