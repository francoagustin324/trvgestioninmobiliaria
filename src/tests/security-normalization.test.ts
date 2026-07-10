import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeImportedData } from '../server/normalizer.js';
import { isPrivateIp, validateSafeUrl } from '../server/utils/safe-url.js';
import { cleanText, uniquePhotos } from '../server/utils/sanitize.js';

test('bloquea localhost e IP privadas', async () => {
  await assert.rejects(() => validateSafeUrl('http://localhost/property'));
  await assert.rejects(() => validateSafeUrl('http://127.0.0.1/property'));
  await assert.rejects(() => validateSafeUrl('http://192.168.1.10/property'));
  assert.equal(isPrivateIp('10.0.0.1'), true);
  assert.equal(isPrivateIp('8.8.8.8'), false);
});

test('limpia contactos sin borrar datos técnicos', () => {
  const cleaned = cleanText('Departamento 2 dormitorios, 80 m². WhatsApp +54 9 351 555 1234. contacto@otra.com');
  assert.match(cleaned, /2 dormitorios/);
  assert.match(cleaned, /80 m²/);
  assert.doesNotMatch(cleaned, /351 555/);
  assert.doesNotMatch(cleaned, /contacto@/);
});

test('elimina fotos duplicadas y logos', () => {
  const photos = uniquePhotos([
    'https://img.example.com/property-1.jpg?w=800',
    'https://img.example.com/property-1.jpg?w=1200',
    'https://img.example.com/logo.png',
    'https://img.example.com/property-2.webp',
  ]);
  assert.equal(photos.length, 2);
});

test('normaliza datos y conserva precios grandes', () => {
  const data = normalizeImportedData({
    title: '  Departamento céntrico  ',
    description: 'Llamar al +54 9 351 555 1234',
    price: 'ARS 10000000',
    totalMeters: '120 m²',
    photoUrls: [],
  });
  assert.equal(data.title, 'Departamento céntrico');
  assert.equal(data.description, 'Llamar al');
  assert.equal(data.price, 'ARS 10000000');
  assert.equal(data.totalMeters, '120 m²');
});
