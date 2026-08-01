import assert from 'node:assert/strict';
import test from 'node:test';
import type { Client } from '../models.js';
import {
  addLocalDaysIso,
  normalizeWhatsAppPhone,
  suggestedFollowUp,
  suggestedWhatsAppMessage,
  whatsappUrl,
} from '../whatsapp-contact.js';

function client(overrides: Partial<Client> = {}): Client {
  return {
    id: 1,
    name: 'Lucía Martín',
    phone: '+54 9 351 511-0069',
    interest: 'Dúplex en Docta',
    status: 'Lead',
    temperature: 'Tibio',
    pipeline: 'Nuevo',
    ...overrides,
  };
}

test('B1.3 normaliza formatos argentinos frecuentes para wa.me', () => {
  for (const value of [
    '+54 9 351 511-0069',
    '54 9 351 5110069',
    '54 351 5110069',
    '351 511 0069',
    '351-511-0069',
    '0351 5110069',
    '0351 15 5110069',
    '351 15 5110069',
  ]) {
    const result = normalizeWhatsAppPhone(value);
    assert.equal(result.valid, true, value);
    assert.equal(result.normalized, '5493515110069', value);
    assert.equal(result.kind, 'argentina', value);
  }
});

test('B1.3 acepta un número internacional explícito y conserva solo dígitos', () => {
  const result = normalizeWhatsAppPhone('+598 (99) 123-456');
  assert.deepEqual(result, {
    valid: true,
    normalized: '59899123456',
    display: '+59899123456',
    reason: '',
    kind: 'international',
  });
});

test('B1.3 bloquea números incompletos ambiguos o con caracteres inválidos', () => {
  const incomplete = normalizeWhatsAppPhone('351 5110');
  assert.equal(incomplete.valid, false);
  assert.match(incomplete.reason, /incompleto/i);

  const ambiguous = normalizeWhatsAppPhone('59899123456');
  assert.equal(ambiguous.valid, false);
  assert.equal(ambiguous.kind, 'ambiguous');
  assert.match(ambiguous.reason, /país|internacional/i);

  const invalid = normalizeWhatsAppPhone('+54 9 351 ABC 0069');
  assert.equal(invalid.valid, false);
  assert.match(invalid.reason, /caracteres/i);
});

test('B1.3 construye el mensaje con datos existentes sin inventar', () => {
  assert.equal(
    suggestedWhatsAppMessage(client(), 'Franco Solís', 'TRV Gestión Inmobiliaria'),
    'Hola Lucía Martín, soy Franco Solís de TRV Gestión Inmobiliaria. Te escribo por tu consulta sobre Dúplex en Docta. ¿Seguís buscando una propiedad con estas características?',
  );
  assert.equal(
    suggestedWhatsAppMessage(client({ interest: '' }), 'Franco Solís', 'TRV Gestión Inmobiliaria'),
    'Hola Lucía Martín, soy Franco Solís de TRV Gestión Inmobiliaria. Te escribo por tu consulta inmobiliaria. ¿Seguís buscando una propiedad?',
  );
});

test('B1.3 conserva edición manual tildes saltos y codificación correcta', () => {
  const edited = 'Hola Lucía 👋\n¿Seguís buscando en Nueva Córdoba?';
  const url = whatsappUrl('5493515110069', edited);
  assert.equal(url, `https://wa.me/5493515110069?text=${encodeURIComponent(edited)}`);
  assert.match(url, /%C3%AD/);
  assert.match(url, /%0A/);
});

test('B1.3 aplica la matriz de sugerencias sin imponer fechas', () => {
  const now = new Date(2026, 7, 1, 10, 0, 0);
  assert.equal(addLocalDaysIso(1, now), '2026-08-02');
  assert.deepEqual(suggestedFollowUp(client(), false, now), {
    date: '2026-08-02',
    days: 1,
    reason: 'Lead nuevo o no contactado: seguimiento sugerido para mañana.',
  });
  assert.equal(suggestedFollowUp(client({ pipeline: 'Contactado', lastContact: '2026-08-01' }), false, now).days, 3);
  assert.equal(suggestedFollowUp(client({ pipeline: 'Contactado' }), true, now).days, 3);
  assert.equal(suggestedFollowUp(client({ purchaseTimeframe: '3-6 meses' }), false, now).days, 14);
  assert.equal(suggestedFollowUp(client({ temperature: 'Frío' }), false, now).days, 30);
  assert.deepEqual(suggestedFollowUp(client({ nextFollowUp: '2026-08-19' }), false, now), {
    date: '2026-08-19',
    days: null,
    reason: 'Se conserva la fecha pactada existente.',
  });
});
