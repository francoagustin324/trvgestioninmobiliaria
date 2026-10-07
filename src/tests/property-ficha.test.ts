import assert from 'node:assert/strict';
import test from 'node:test';
import { decodePublicFicha, publicFichaHtml } from '../public-ficha.js';
import type { PublicTenantIdentity } from '../models.js';
import { propertyFichaLink, propertyShareText, propertyToPublicFicha, type PropertyWithFicha } from '../property-ficha.js';

const TENANT_A: PublicTenantIdentity = {
  organizationId: 'tenant-a',
  name: 'TRV Gestión Inmobiliaria',
  commercialPhone: '+54 9 351 1111111',
  logoPath: '/tenant-a-logo.svg',
  legalText: 'Legal tenant A',
};

const TENANT_B: PublicTenantIdentity = {
  organizationId: 'tenant-b',
  name: 'Inmobiliaria Norte Test',
  commercialPhone: '+54 9 351 2222222',
  logoPath: '',
  legalText: 'Legal tenant B',
};

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
  const payload = propertyToPublicFicha(property, TENANT_A);
  assert.equal(payload.title, 'Dúplex en Docta');
  assert.equal(payload.price, 'USD 113.000');
  assert.equal(payload.zone, 'Docta Urbanización, Córdoba');
  assert.equal(payload.coveredMeters, '80 m²');
  assert.deepEqual(payload.photoUrls, ['https://example.com/frente.jpg']);
  assert.equal('owner' in payload, false);
  assert.equal('notes' in payload, false);
  assert.deepEqual(payload.tenant, TENANT_A);
});

test('el enlace compartible abre una ficha autocontenida y válida', () => {
  const link = propertyFichaLink(property, 'https://propcontrol.example', '/', TENANT_B);
  assert.ok(link.startsWith('https://propcontrol.example/#public='));
  const encoded = link.split('#public=')[1];
  if (!encoded) throw new Error('El enlace no contiene una ficha pública.');
  const decoded = decodePublicFicha(encoded);
  assert.equal(decoded?.title, property.title);
  assert.equal(decoded?.description, property.description);
  assert.equal(decoded?.photoUrls.length, 1);
  assert.deepEqual(decoded?.tenant, TENANT_B);
});

test('la ficha pública prioriza identidad tenant, contacto y fallback seguro sin cruces', () => {
  const payloadA = propertyToPublicFicha(property, TENANT_A);
  const payloadB = propertyToPublicFicha({ ...property, title: 'Casa Norte' }, TENANT_B);
  const htmlA = publicFichaHtml(payloadA);
  const htmlB = publicFichaHtml(payloadB);

  const galleryPosition = htmlA.indexOf('class="public-gallery');
  const summaryPosition = htmlA.indexOf('class="public-summary"');
  const factsPosition = htmlA.indexOf('class="public-key-facts"');
  const whatsappPosition = htmlA.indexOf('class="whatsapp-public"');
  const descriptionPosition = htmlA.indexOf('class="public-description"');
  const detailsPosition = htmlA.indexOf('class="public-details"');

  assert.ok(galleryPosition >= 0);
  assert.ok(galleryPosition < summaryPosition);
  assert.ok(summaryPosition < factsPosition);
  assert.ok(factsPosition < whatsappPosition);
  assert.ok(whatsappPosition < descriptionPosition);
  assert.ok(descriptionPosition < detailsPosition);

  assert.match(htmlA, /TRV Gestión Inmobiliaria/);
  assert.match(htmlA, /5493511111111/);
  assert.match(htmlA, /tenant-a-logo\.svg/);
  assert.match(htmlA, /Legal tenant A/);
  assert.doesNotMatch(htmlA, /Inmobiliaria Norte Test|5493512222222|Legal tenant B/);

  assert.match(htmlB, /Inmobiliaria Norte Test/);
  assert.match(htmlB, /5493512222222/);
  assert.match(htmlB, /public-tenant-logo-placeholder/);
  assert.match(htmlB, /Legal tenant B/);
  assert.doesNotMatch(htmlB, /TRV Gestión Inmobiliaria|5493511111111|tenant-a-logo|Legal tenant A/);

  const missing = publicFichaHtml(propertyToPublicFicha(property, {
    organizationId: 'tenant-c',
    name: 'Inmobiliaria Sin Datos',
    commercialPhone: '',
    logoPath: '',
    legalText: '',
  }));
  assert.doesNotMatch(missing, /class="whatsapp-public"|wa\.me\//);
  assert.match(missing, /public-tenant-logo-placeholder/);
  assert.doesNotMatch(missing, /Legal tenant A|Legal tenant B/);

  assert.equal(propertyShareText(property.title, TENANT_A), 'Te comparto esta propiedad de TRV Gestión Inmobiliaria: Dúplex en Docta');
  assert.equal(propertyShareText(property.title, TENANT_B), 'Te comparto esta propiedad de Inmobiliaria Norte Test: Dúplex en Docta');
  assert.match(htmlA, />Consultar por WhatsApp<\/a>/);
  assert.match(htmlA, /Ver todos los detalles/);
  assert.match(htmlA, /class="public-key-item"/);
});
