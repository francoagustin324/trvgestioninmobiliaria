import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  preparePropertyPhoto,
  PropertyPhotoUploadError,
  propertyPhotoMime,
  shouldStopPropertyPhotoBatch,
} from '../property-photo-upload.js';

const upload = readFileSync('src/property-photo-upload.ts', 'utf8');
const server = readFileSync('src/server/property-photo-storage.ts', 'utf8');
const migration = readFileSync('supabase/migrations/20260720120000_property_photos_by_organization.sql', 'utf8');

test('los errores estructurales detienen el lote', () => {
  assert.equal(shouldStopPropertyPhotoBatch(
    new PropertyPhotoUploadError('Falta Storage', 'STORAGE_NOT_READY', true),
  ), true);
  assert.equal(shouldStopPropertyPhotoBatch(
    new PropertyPhotoUploadError('Falló una foto', 'UPLOAD_FAILED'),
  ), false);
});

test('reconoce JPG de Android aunque el tipo MIME venga vacío', () => {
  assert.equal(propertyPhotoMime({ name: '1000822648.jpg', type: '' }), 'image/jpeg');
  assert.equal(propertyPhotoMime({ name: 'foto.JPEG', type: 'application/octet-stream' }), 'image/jpeg');
  assert.equal(propertyPhotoMime({ name: 'foto.heic', type: 'image/heic' }), null);
});

test('un JPG liviano se prepara sin abrirlo ni recodificarlo', async () => {
  const file = new File([Buffer.from('contenido-jpg')], '1000822648.jpg', { type: '' });
  const prepared = await preparePropertyPhoto(file);
  assert.equal(prepared.mimeType, 'image/jpeg');
  assert.equal(prepared.extension, 'jpg');
  assert.equal(prepared.blob.size, file.size);
});

test('el navegador envía la foto como binario a PropControl', () => {
  assert.ok(upload.includes('/api/property-photos?'));
  assert.ok(upload.includes("'Content-Type': photo.mimeType"));
  assert.ok(upload.includes('body: photo.blob'));
  assert.ok(upload.includes('uploadId: uploadIdentifier()'));
  assert.equal(upload.includes('blobToDataUrl'), false);
  assert.equal(upload.includes('dataUrl: await'), false);
  assert.equal(upload.includes('/storage/v1/object/'), false);
});

test('el servidor guarda en una carpeta de la inmobiliaria autenticada', () => {
  assert.ok(server.includes('authenticatedPhotoOwner'));
  assert.ok(server.includes('return { userId, organizationId, accessToken }'));
  assert.ok(server.includes('propertyPhotoObjectPath(\n    organizationId'));
  assert.ok(server.includes('/auth/v1/user'));
  assert.ok(server.includes('/rest/v1/organization_members'));
  assert.ok(server.includes('/storage/v1/object/'));
  assert.ok(server.includes('Authorization: `Bearer ${accessToken}`'));
});

test('la migración aísla las fotos por inmobiliaria', () => {
  assert.ok(migration.includes('property_photos_select_by_org'));
  assert.ok(migration.includes('property_photos_insert_by_org'));
  assert.ok(migration.includes('property_photos_update_by_org'));
  assert.ok(migration.includes('property_photos_delete_by_org'));
  assert.ok(migration.includes('private.can_access_property_photo((storage.foldername(name))[1])'));
  assert.ok(migration.includes('private.is_active_org_member'));
  assert.equal(migration.includes("(storage.foldername(name))[1] = auth.uid()::text"), false);
});
