import assert from 'node:assert/strict';
import test from 'node:test';
import {
  defaultCommercialNetworkFilters,
  filterCommercialContacts,
  findDuplicateCommercialContact,
  linkedPropertiesForContact,
  unlinkCommercialContact,
} from '../commercial-network.js';
import type { CommercialContact, Property } from '../models.js';

function contact(id: number, overrides: Partial<CommercialContact> = {}): CommercialContact {
  return {
    id,
    type: 'Colega / Inmobiliaria',
    name: `Contacto ${id}`,
    phone: `549351000000${id}`,
    createdAt: '2026-07-13T12:00:00.000Z',
    ...overrides,
  };
}

function property(id: number, overrides: Partial<Property> = {}): Property {
  return {
    id,
    title: `Propiedad ${id}`,
    address: 'Córdoba',
    type: 'Departamento',
    operation: 'Venta',
    price: 85000,
    owner: 'Propietario',
    status: 'Activa',
    ...overrides,
  };
}

test('encuentra al contacto buscando una propiedad vinculada', () => {
  const contacts = [
    contact(1, { name: 'Juan Pérez', company: 'Inmobiliaria Norte' }),
    contact(2, { name: 'María López', company: 'Desarrollos Centro' }),
  ];
  const properties = [property(1, { title: 'Dúplex en Docta', address: 'Docta Urbanización', sourceContactId: 2 })];
  const result = filterCommercialContacts(contacts, properties, { ...defaultCommercialNetworkFilters(), query: 'duplex docta' });
  assert.deepEqual(result.map((item) => item.id), [2]);
});

test('busca por nombre empresa teléfono zona y etiquetas', () => {
  const contacts = [
    contact(1, { name: 'José Álvarez', company: 'Grupo Horizonte', phone: '5493515110069', zones: 'General Paz', tags: 'Comparte comisión' }),
    contact(2, { name: 'Ana Ruiz', company: 'Constructora Sur' }),
  ];
  const properties: Property[] = [];
  assert.deepEqual(filterCommercialContacts(contacts, properties, { query: 'grupo horizonte', type: 'Todos' }).map((item) => item.id), [1]);
  assert.deepEqual(filterCommercialContacts(contacts, properties, { query: '0351 15 5110069', type: 'Todos' }).map((item) => item.id), [1]);
  assert.deepEqual(filterCommercialContacts(contacts, properties, { query: 'general paz', type: 'Todos' }).map((item) => item.id), [1]);
  assert.deepEqual(filterCommercialContacts(contacts, properties, { query: 'comparte comision', type: 'Todos' }).map((item) => item.id), [1]);
});

test('filtra colegas constructores y propietarios', () => {
  const contacts = [
    contact(1, { type: 'Colega / Inmobiliaria' }),
    contact(2, { type: 'Constructor / Desarrollista' }),
    contact(3, { type: 'Propietario' }),
  ];
  const result = filterCommercialContacts(contacts, [], { query: '', type: 'Constructor / Desarrollista' });
  assert.deepEqual(result.map((item) => item.id), [2]);
});

test('ordena primero los contactos con más propiedades vinculadas', () => {
  const contacts = [contact(1, { name: 'Uno' }), contact(2, { name: 'Dos' })];
  const properties = [
    property(1, { sourceContactId: 2 }),
    property(2, { sourceContactId: 2 }),
    property(3, { sourceContactId: 1 }),
  ];
  const result = filterCommercialContacts(contacts, properties, defaultCommercialNetworkFilters());
  assert.deepEqual(result.map((item) => item.id), [2, 1]);
  assert.equal(linkedPropertiesForContact(2, properties).length, 2);
});

test('detecta teléfonos duplicados con formatos equivalentes', () => {
  const contacts = [contact(1, { name: 'Franco', phone: '5493515110069' })];
  assert.equal(findDuplicateCommercialContact(contacts, '0351 15 511-0069')?.id, 1);
  assert.equal(findDuplicateCommercialContact(contacts, '0351 15 511-0069', 1), null);
});

test('desvincula un contacto sin borrar propiedades ni modificar la lista original', () => {
  const properties = [property(1, { sourceContactId: 7, sharedAt: '2026-07-11' }), property(2, { sourceContactId: 8 })];
  const result = unlinkCommercialContact(properties, 7);
  assert.equal(result.length, 2);
  assert.equal(result[0]?.sourceContactId, undefined);
  assert.equal(result[0]?.sharedAt, '2026-07-11');
  assert.equal(result[1]?.sourceContactId, 8);
  assert.equal(properties[0]?.sourceContactId, 7);
});
