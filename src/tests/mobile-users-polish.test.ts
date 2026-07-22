import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync('index.html', 'utf8');
const css = readFileSync('src/mobile-users-polish.css', 'utf8');

test('carga el pulido de Usuarios después de Conversaciones', () => {
  assert.ok(html.includes('/src/mobile-users-polish.css?v=20260722-1'));
  assert.ok(html.indexOf('mobile-users-polish.css') > html.indexOf('mobile-conversations-polish.css'));
});

test('limita los cambios a móvil y al módulo Usuarios', () => {
  assert.ok(css.includes('@media (max-width: 720px)'));
  assert.ok(css.includes('#equipo .mvp-user-row'));
  assert.ok(css.includes('#equipo .mvp-user-info'));
  assert.ok(css.includes('#equipo .mvp-user-status'));
  assert.ok(css.includes('#equipo .mvp-user-form'));
});

test('mantiene visibles roles, estados y acciones de acceso', () => {
  assert.ok(css.includes('#equipo .mvp-user-row > label select'));
  assert.ok(css.includes('#equipo .mvp-user-row > button'));
  assert.equal(css.includes('.mvp-user-row > button { display: none'), false);
  assert.equal(css.includes('.mvp-user-row > label { display: none'), false);
});

test('no incorpora frameworks ni modifica permisos o seguridad', () => {
  const source = `${html}\n${css}`.toLowerCase();
  assert.equal(source.includes('react'), false);
  assert.equal(source.includes('tailwind'), false);
  assert.equal(source.includes('supabase'), false);
  assert.equal(source.includes('localstorage'), false);
});
