import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync('index.html', 'utf8');
const css = readFileSync('src/mobile-conversations-polish.css', 'utf8');

test('carga el pulido de Conversaciones después de Propiedades', () => {
  assert.ok(html.includes('/src/mobile-conversations-polish.css?v=20260722-1'));
  assert.ok(html.indexOf('mobile-conversations-polish.css') > html.indexOf('mobile-properties-polish.css'));
});

test('limita los cambios a móvil y al módulo Conversaciones', () => {
  assert.ok(css.includes('@media (max-width: 720px)'));
  assert.ok(css.includes('#whatsapp .mvp-conversations-layout'));
  assert.ok(css.includes('#whatsapp .mvp-conversation-list'));
  assert.ok(css.includes('#whatsapp .mvp-conversation-detail'));
  assert.ok(css.includes('#whatsapp .mvp-message-history'));
});

test('mantiene visible la salida a WhatsApp y el historial', () => {
  assert.ok(css.includes('#whatsapp .mvp-chat-header a'));
  assert.ok(css.includes('#whatsapp .mvp-message'));
  assert.equal(css.includes('.mvp-chat-header a { display: none'), false);
  assert.equal(css.includes('.mvp-message-history { display: none'), false);
});

test('no incorpora frameworks ni modifica datos o seguridad', () => {
  const source = `${html}\n${css}`.toLowerCase();
  assert.equal(source.includes('react'), false);
  assert.equal(source.includes('tailwind'), false);
  assert.equal(source.includes('supabase'), false);
  assert.equal(source.includes('localstorage'), false);
});
