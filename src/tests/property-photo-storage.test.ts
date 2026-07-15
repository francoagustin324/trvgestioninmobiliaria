import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parsePropertyPhotoDataUrl,
  propertyPhotoObjectPath,
  publicPropertyPhotoUrl,
} from '../server/property-photo-storage.js';

test('acepta imágenes permitidas y rechaza formatos inseguros', () => {
  const parsed = parsePropertyPhotoDataUrl('data:image/jpeg;base64,aG9sYQ==');
  assert.equal(parsed.mimeType, 'image/jpeg');
  assert.equal(parsed.extension, 'jpg');
  assert.equal(parsed.bytes.toString('utf8'), 'hola');
  assert.throws(() => parsePropertyPhotoDataUrl('data:text/html;base64,aG9sYQ=='));
  assert.throws(() => parsePropertyPhotoDataUrl('javascript:alert(1)'));
});

test('la ruta queda aislada por inmobiliaria y propiedad', () => {
  const path = propertyPhotoObjectPath('trv-gestion_inmobiliaria', 27, 'jpg');
  assert.ok(path.startsWith('trv-gestion_inmobiliaria/27/'));
  assert.ok(path.endsWith('.jpg'));
  assert.equal(path.includes('..'), false);
});

test('genera una dirección pública del bucket de propiedades', () => {
  const url = publicPropertyPhotoUrl('https://example.supabase.co', 'org/27/foto principal.jpg');
  assert.equal(url, 'https://example.supabase.co/storage/v1/object/public/property-photos/org/27/foto%20principal.jpg');
});
