import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import {
  getWebhookChallenge,
  summarizeWhatsAppWebhook,
  verifyMetaSignature,
  WebhookDeduplicator,
} from '../server/whatsapp-webhook.js';

test('acepta la verificación de Meta solo con el token correcto', () => {
  const valid = getWebhookChallenge(
    '/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=seguro&hub.challenge=12345',
    'seguro',
  );
  assert.equal(valid, '12345');

  const invalid = getWebhookChallenge(
    '/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=incorrecto&hub.challenge=12345',
    'seguro',
  );
  assert.equal(invalid, null);
});

test('valida X-Hub-Signature-256 con comparación segura', () => {
  const secret = 'app-secret-de-prueba';
  const body = Buffer.from('{"object":"whatsapp_business_account"}', 'utf8');
  const digest = createHmac('sha256', secret).update(body).digest('hex');

  assert.equal(verifyMetaSignature(body, `sha256=${digest}`, secret), true);
  assert.equal(verifyMetaSignature(body, `sha256=${'0'.repeat(64)}`, secret), false);
  assert.equal(verifyMetaSignature(body, undefined, secret), false);
});

test('resume mensajes, estados y número sin guardar el payload completo en logs', () => {
  const summary = summarizeWhatsAppWebhook({
    entry: [{
      changes: [{
        value: {
          metadata: { phone_number_id: 'phone-1' },
          messages: [{ id: 'wamid.1' }, { id: 'wamid.1' }],
          statuses: [
            { id: 'wamid.2', status: 'sent' },
            { id: 'wamid.2', status: 'delivered' },
          ],
        },
      }],
    }],
  });

  assert.deepEqual(summary.messageIds, ['wamid.1']);
  assert.deepEqual(summary.statusKeys, ['wamid.2:sent', 'wamid.2:delivered']);
  assert.deepEqual(summary.phoneNumberIds, ['phone-1']);
});

test('marca como duplicado un reintento dentro de la ventana de idempotencia', () => {
  const deduplicator = new WebhookDeduplicator(1_000, 10);
  assert.equal(deduplicator.isDuplicate(['message:wamid.1'], 100), false);
  assert.equal(deduplicator.isDuplicate(['message:wamid.1'], 200), true);
  assert.equal(deduplicator.isDuplicate(['message:wamid.1'], 1_101), false);
});
