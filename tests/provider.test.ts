import test from 'node:test';
import assert from 'node:assert/strict';
import { detectProvider, extractMlaId } from '../src/server/provider.js';

test('detecta proveedores soportados', () => {
  assert.equal(detectProvider('https://departamento.mercadolibre.com.ar/MLA-1573489279-edificio-general-paz-_JM'), 'mercadolibre');
  assert.equal(detectProvider('https://www.zonaprop.com.ar/propiedades/clasificado/abc.html'), 'zonaprop');
  assert.equal(detectProvider('https://ficha.info/p/fdf845bacaa9490b8ef55407caee5b02'), 'ficha-info');
  assert.equal(detectProvider('https://example.com/propiedad'), 'generic');
});

test('extrae y normaliza ID MLA', () => {
  assert.equal(extractMlaId('https://departamento.mercadolibre.com.ar/MLA-1573489279-edificio-general-paz-_JM'), 'MLA1573489279');
});
