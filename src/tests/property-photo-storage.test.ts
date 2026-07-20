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
  const organizationId = '2ce3f73d-0ea3-4be6-a1c5-5a26dc502f53';
  const path = propertyPhotoObjectPath(organizationId, 27, 'jpg', 'foto-segura-123');
  assert.equal(path, `${organizationId}/27/foto-segura-123.jpg`);
  assert.equal(path.includes('..'), false);
});

test('genera una dirección pública del bucket de propiedades', () => {
  const url = publicPropertyPhotoUrl('https://example.supabase.co', 'usuario/27/foto principal.jpg');
  assert.equal(url, 'https://example.supabase.co/storage/v1/object/public/property-photos/usuario/27/foto%20principal.jpg');
});
