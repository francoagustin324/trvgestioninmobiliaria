import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePropertyPhotoStatus } from '../property-photo-ux.js';

test('elimina ruido de red y mensajes repetidos', () => {
  const message = '0 fotos listas. Failed to fetch El almacenamiento de fotos todavía no está configurado. Failed to fetch El almacenamiento de fotos todavía no está configurado.';
  assert.equal(
    normalizePropertyPhotoStatus(message),
    '0 fotos listas. El almacenamiento de fotos todavía no está configurado.',
  );
});

test('conserva un mensaje normal de progreso', () => {
  assert.equal(
    normalizePropertyPhotoStatus('2 fotos listas para la ficha.'),
    '2 fotos listas para la ficha.',
  );
});
