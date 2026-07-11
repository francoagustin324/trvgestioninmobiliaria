import assert from 'node:assert/strict';
import test from 'node:test';
import { extractPropertyFromJson } from '../server/json-extractor.js';
import { normalizeImportedData } from '../server/normalizer.js';
import { storeExtensionImport, takeExtensionImport } from '../server/extension-import-store.js';
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

test('extrae datos y fotos desde respuestas JSON de portales', () => {
  const data = extractPropertyFromJson({
    posting: {
      postingTitle: 'Departamento reciclado en Nueva Córdoba',
      price: 125000,
      currency: 'USD',
      bedrooms: 2,
      bathrooms: 1,
      totalArea: 78,
      location: { neighborhood: 'Nueva Córdoba' },
      pictures: [
        { imageUrl: 'https://img.example.com/depto-1.webp' },
        { imageUrl: 'https://img.example.com/depto-2.webp' },
      ],
    },
  });
  assert.equal(data.title, 'Departamento reciclado en Nueva Córdoba');
  assert.equal(data.price, 'USD 125000');
  assert.equal(data.bedrooms, '2');
  assert.equal(data.zone, 'Nueva Córdoba');
  assert.equal(data.photoUrls?.length ?? 0, 2);
});

test('guarda y consume una importación enviada por la extensión', () => {
  const token = storeExtensionImport('https://www.zonaprop.com.ar/propiedades/departamento.html', {
    title: 'Departamento en Nueva Córdoba',
    price: 'USD 120000',
    photoUrls: ['https://img.example.com/depto.webp'],
  });
  const payload = takeExtensionImport(token);
  assert.equal(payload?.success, true);
  assert.equal(payload?.provider, 'zonaprop');
  assert.equal(payload?.data.title, 'Departamento en Nueva Córdoba');
  assert.equal(takeExtensionImport(token), null);
});
