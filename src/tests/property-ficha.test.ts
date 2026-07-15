import assert from 'node:assert/strict';
import test from 'node:test';
import { decodePublicFicha } from '../public-ficha.js';
import { propertyFichaLink, propertyToPublicFicha, type PropertyWithFicha } from '../property-ficha.js';

const property: PropertyWithFicha = {
  id: 7,
  title: 'Dúplex en Docta',
  address: 'Docta Urbanización, Córdoba',
  type: 'Dúplex',
  operation: 'Venta',
  price: 113000,
  owner: 'Dato privado del propietario',
  status: 'Activa',
  bedrooms: 2,
  bathrooms: 2,
  garage: '1 cochera',
  coveredMeters: 80,
  totalMeters: 180,
  paymentMethod: 'Entrega y cuotas',
  features: 'Patio, asador y calefacción central',
  description: 'Propiedad pensada para vivir o invertir.',
  notes: 'Comisión interna y teléfono privado',
  deed: 'A confirmar',
  creditReady: 'No',
  photoUrls: ['https://example.com/frente.jpg', 'javascript:alert(1)'],
};

test('la ficha pública conserva sólo información comercial', () => {
  const payload = propertyToPublicFicha(property);
  assert.equal(payload.title, 'Dúplex en Docta');
  assert.equal(payload.price, 'USD 113.000');
  assert.equal(payload.zone, 'Docta Urbanización, Córdoba');
  assert.equal(payload.coveredMeters, '80 m²');
  assert.deepEqual(payload.photoUrls, ['https://example.com/frente.jpg']);
  assert.equal('owner' in payload, false);
  assert.equal('notes' in payload, false);
});

test('el enlace compartible abre una ficha autocontenida y válida', () => {
  const link = propertyFichaLink(property, 'https://propcontrol.example', '/');
  assert.ok(link.startsWith('https://propcontrol.example/#public='));
  const encoded = link.split('#public=')[1];
  if (!encoded) throw new Error('El enlace no contiene una ficha pública.');
  const decoded = decodePublicFicha(encoded);
  assert.equal(decoded?.title, property.title);
  assert.equal(decoded?.description, property.description);
  assert.equal(decoded?.photoUrls.length, 1);
});
