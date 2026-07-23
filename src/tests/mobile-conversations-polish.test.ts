import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync('index.html', 'utf8');
const ui = readFileSync('src/mvp-conversations-ui.ts', 'utf8');
const css = readFileSync('src/mobile-conversations-polish.css', 'utf8');
const shellCss = readFileSync('src/mobile-bottom-nav.css', 'utf8');
const packageJson = readFileSync('package.json', 'utf8').toLowerCase();

test('carga el pulido móvil de Conversaciones después de las capas existentes', () => {
  assert.ok(html.includes('/src/mobile-conversations-polish.css?v=20260723-1'));
  assert.ok(html.indexOf('mobile-conversations-polish.css') > html.indexOf('mvp.css'));
  assert.ok(html.indexOf('mobile-conversations-polish.css') > html.indexOf('mobile-bottom-nav.css'));
  assert.ok(html.indexOf('mobile-conversations-polish.css') > html.indexOf('mobile-properties-polish.css'));
});

test('conserva título, pestañas, búsqueda, contador y lista de conversaciones', () => {
  assert.ok(ui.includes('<h1>Conversaciones</h1>'));
  assert.ok(ui.includes('data-conversations-tab="bandeja"'));
  assert.ok(ui.includes('data-conversations-tab="plantillas"'));
  assert.ok(ui.includes('class="mvp-conversation-list"'));
  assert.ok(ui.includes('class="mvp-conversation-count"'));
  assert.ok(ui.includes('data-conversation-search'));
  assert.ok(ui.includes('data-select-conversation'));
});

test('cada conversación conserva nombre, último mensaje, hora, no leídos y selección', () => {
  assert.ok(ui.includes('client?.name || conversation.phone'));
  assert.ok(ui.includes("latest ? messageContent(latest) : 'Sin mensajes'"));
  assert.ok(ui.includes('<time>${escapeHtml(timeFormatter.format(new Date(conversation.lastActivity)))}</time>'));
  assert.ok(ui.includes('conversation.unread'));
  assert.ok(ui.includes("selected ? ' active' : ''"));
  assert.ok(css.includes('min-height: 64px'));
  assert.ok(css.includes('text-overflow: ellipsis'));
  assert.ok(css.includes('white-space: nowrap'));
});

test('conserva contacto, teléfono, Abrir WhatsApp, interés y presupuesto', () => {
  assert.ok(ui.includes('class="mvp-chat-header"'));
  assert.ok(ui.includes('client?.name || conversation.phone'));
  assert.ok(ui.includes('${escapeHtml(conversation.phone)}'));
  assert.ok(ui.includes('href="https://wa.me/${digits}"'));
  assert.ok(ui.includes('Abrir WhatsApp'));
  assert.ok(ui.includes('<span>Interés</span>'));
  assert.ok(ui.includes('<span>Presupuesto</span>'));
  assert.ok(css.includes('#whatsapp .mvp-chat-lead-data strong'));
  assert.ok(css.includes('overflow-wrap: anywhere'));
});

test('conserva historial, orden actual, contenido y hora de los mensajes', () => {
  assert.ok(ui.includes('conversation.messages.map(messageBubble).join'));
  assert.ok(ui.includes('class="mvp-message ${direction}"'));
  assert.ok(ui.includes('<p>${escapeHtml(messageContent(message))}</p>'));
  assert.ok(ui.includes('<time>${escapeHtml(timeFormatter.format(new Date(message.createdAt)))}</time>'));
  assert.ok(css.includes('min-height: 140px'));
  assert.ok(css.includes('max-height: min(42vh, 350px)'));
  assert.ok(css.includes('word-break: break-word'));
  assert.ok(css.includes('overflow-x: hidden'));
});

test('conserva el compositor deshabilitado y no agrega lógica de envío', () => {
  assert.ok(ui.includes('class="mvp-compose-disabled"'));
  assert.ok(ui.includes('<textarea rows="2"'));
  assert.ok(ui.includes('disabled></textarea>'));
  assert.ok(ui.includes('<button type="button" disabled>Enviar</button>'));
  assert.equal(ui.includes("mvp-compose-disabled')?.addEventListener"), false);
  assert.equal(ui.includes('sendMessage('), false);
  assert.ok(css.includes('min-height: 48px'));
  assert.ok(css.includes('min-height: 44px'));
});

test('mantiene alcance móvil, dos columnas en 720 px y una columna en teléfono', () => {
  assert.ok(css.includes('@media (max-width: 720px)'));
  assert.ok(css.includes('@media (max-width: 599px)'));
  assert.ok(css.includes('@media (min-width: 600px) and (max-width: 720px)'));
  assert.ok(css.includes('grid-template-columns: minmax(220px, 0.72fr) minmax(0, 1.28fr)'));
  assert.ok(css.includes('#whatsapp.module-panel'));
  assert.equal(css.includes('#crm'), false);
  assert.equal(css.includes('#propiedades'), false);
  assert.equal(css.includes('@media (min-width: 721px)'), false);
});

test('respeta la navegación inferior y safe area sin modificar la capa global', () => {
  assert.ok(css.includes('scroll-margin-bottom: calc(var(--pc-mobile-nav-height, 76px) + 24px + env(safe-area-inset-bottom))'));
  assert.ok(shellCss.includes('padding: 12px 14px calc(var(--pc-mobile-nav-height) + 40px + env(safe-area-inset-bottom))'));
  assert.ok(shellCss.includes('grid-template-columns: repeat(5, minmax(0, 1fr))'));
  assert.equal(css.includes('.mobile-bottom-nav {'), false);
  assert.equal(css.includes('.mvp-content {'), false);
});

test('no incorpora React, Tailwind, frameworks ni dependencias nuevas', () => {
  assert.equal(packageJson.includes('react'), false);
  assert.equal(packageJson.includes('tailwind'), false);
  const parsed = JSON.parse(readFileSync('package.json', 'utf8')) as { dependencies?: Record<string, string> };
  assert.deepEqual(Object.keys(parsed.dependencies ?? {}), ['playwright']);
});
