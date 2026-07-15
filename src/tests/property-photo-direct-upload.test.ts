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
const migration = readFileSync('supabase/migrations/20260715093000_property_photos.sql', 'utf8');

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

test('la carga directa usa sesión, inmobiliaria y ruta aislada', () => {
  assert.ok(upload.includes('/rest/v1/organization_members'));
  assert.ok(upload.includes("select', 'organization_id'"));
  assert.ok(upload.includes('/storage/v1/object/'));
  assert.ok(upload.includes('Authorization: `Bearer ${accessToken}`'));
  assert.ok(upload.includes("const PHOTO_BUCKET = 'property-photos'"));
});

test('la carga mantiene fallback al servidor cuando existe clave privada', () => {
  assert.ok(upload.includes('photoStorageConfigured'));
  assert.ok(upload.includes("fetchWithRetry('/api/property-photos'"));
  assert.ok(upload.includes('directStorageUpload'));
});

test('la migración crea bucket público con políticas por inmobiliaria', () => {
  assert.ok(migration.includes("'property-photos'"));
  assert.ok(migration.includes('file_size_limit'));
  assert.ok(migration.includes('create or replace function public.can_manage_property_photo'));
  assert.ok(migration.includes('member.user_id = auth.uid()'));
  assert.ok(migration.includes('member.organization_id::text = target_organization'));
  assert.equal(migration.includes('member.status'), false);
  assert.ok(migration.includes('for insert'));
  assert.ok(migration.includes('for delete'));
});
