import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const core = readFileSync('src/whatsapp-contact-core.ts', 'utf8');
const domain = readFileSync('src/whatsapp-contact.ts', 'utf8');
const ui = readFileSync('src/whatsapp-contact-ui.ts', 'utf8');
const html = readFileSync('index.html', 'utf8');

test('B1.3 separa mensaje teléfono y sugerencias del estado y el navegador', () => {
  assert.equal(core.includes("from './store.js'"), false);
  assert.equal(core.includes('localStorage'), false);
  assert.equal(core.includes('document.'), false);
  assert.equal(core.includes('window.'), false);
  assert.ok(core.includes('normalizeWhatsAppPhone'));
  assert.ok(core.includes('suggestedWhatsAppMessage'));
  assert.ok(core.includes('suggestedFollowUp'));
  assert.ok(core.includes('whatsappUrl'));
});

test('B1.3 integra resultado e historial sin crear una colección comercial paralela', () => {
  assert.ok(domain.includes("action: 'Contacto por WhatsApp'"));
  assert.ok(domain.includes("action: 'Seguimiento por WhatsApp programado'"));
  assert.ok(domain.includes("client.nextAction = 'Volver a contactar por WhatsApp'"));
  assert.ok(domain.includes('client.nextFollowUp = date'));
  assert.ok(domain.includes('visibleClients()'));
  assert.equal(domain.includes('whatsappActivities'), false);
  assert.equal(domain.includes('whatsappReminders'), false);
});

test('B1.3 nunca interpreta abrir WhatsApp como envío confirmado', () => {
  assert.ok(ui.includes("window.open(whatsappUrl(opened.phone, opened.message), '_blank'"));
  assert.ok(ui.includes('¿Enviaste el mensaje a'));
  assert.ok(ui.includes('PropControl nunca lo registra automáticamente.'));
  assert.ok(ui.includes('registerWhatsAppContact(attempt)'));
  assert.equal(ui.includes('openChannel(); register'), false);
});

test('B1.3 carga únicamente módulos locales sin proveedor ni credenciales', () => {
  assert.ok(html.includes('/dist/whatsapp-contact-ui.js'));
  assert.equal(`${core}\n${domain}\n${ui}`.match(/Twilio|YCloud|WATI|Cloud API/gi), null);
  assert.equal(`${core}\n${domain}\n${ui}`.match(/api[_-]?key|secret[_-]?key/gi), null);
});
