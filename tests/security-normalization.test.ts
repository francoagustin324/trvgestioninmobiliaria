import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSafeUrl } from '../src/server/utils/safe-url.js';
import { cleanText, uniquePhotos } from '../src/server/utils/sanitize.js';
import { normalizeData } from '../src/server/normalizer.js';

test('bloquea localhost e IP privadas', async () => {
  await assert.rejects(() => validateSafeUrl('http://localhost:3000'));
  await assert.rejects(() => validateSafeUrl('http://127.0.0.1/test'));
  await assert.rejects(() => validateSafeUrl('ftp://example.com/test'));
});

test('limpia teléfonos, emails y links externos', () => {
  const clean = cleanText('Contactar al 351 555 1234 o test@mail.com https://portal.test aviso real');
  assert.equal(clean.includes('test@mail.com'), false);
  assert.equal(clean.includes('https://'), false);
  assert.equal(clean.includes('351 555'), false);
});

test('normaliza datos y elimina fotos duplicadas o no válidas', () => {
  const normalized = normalizeData({ title: ' Casa ', photoUrls: ['https://img.test/a.jpg?x=1', 'https://img.test/a.jpg?x=2', 'data:image/png;base64,aaa', 'https://img.test/logo.png'] });
  assert.equal(normalized.title, 'Casa');
  assert.deepEqual(normalized.photoUrls, ['https://img.test/a.jpg']);
});
