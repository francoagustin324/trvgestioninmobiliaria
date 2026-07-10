import assert from 'node:assert/strict';
import test from 'node:test';
import { detectProvider, extractMlaId } from '../server/provider.js';

test('detecta portales soportados', () => {
  assert.equal(detectProvider('https://departamento.mercadolibre.com.ar/MLA-1573489279-test'), 'mercadolibre');
  assert.equal(detectProvider('https://www.zonaprop.com.ar/propiedades/test.html'), 'zonaprop');
  assert.equal(detectProvider('https://ficha.info/p/abc'), 'ficha-info');
  assert.equal(detectProvider('https://demo.tokkobroker.com/property/1'), 'tokko');
  assert.equal(detectProvider('https://ejemplo.com/propiedad'), 'generic');
});

test('normaliza el ID de MercadoLibre', () => {
  assert.equal(extractMlaId('https://departamento.mercadolibre.com.ar/MLA-1573489279-test'), 'MLA1573489279');
  assert.equal(extractMlaId('https://mercadolibre.com.ar/item/MLA1573489279'), 'MLA1573489279');
  assert.equal(extractMlaId('https://ejemplo.com/sin-id'), null);
});
