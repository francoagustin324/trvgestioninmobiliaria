import type { CommercialContact, CommercialContactType, Property } from './models.js';
import { isPlausiblePhone, phoneIdentity } from './phone-normalizer.js';

export interface CommercialNetworkFilters {
  query: string;
  type: 'Todos' | CommercialContactType;
}

export function normalizeNetworkText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function defaultCommercialNetworkFilters(): CommercialNetworkFilters {
  return { query: '', type: 'Todos' };
}

export function linkedPropertiesForContact(contactId: number, properties: Property[]): Property[] {
  return properties
    .filter((property) => property.sourceContactId === contactId)
    .sort((left, right) => left.title.localeCompare(right.title, 'es'));
}

function matchesQuery(contact: CommercialContact, properties: Property[], query: string): boolean {
  const normalizedQuery = normalizeNetworkText(query);
  if (!normalizedQuery) return true;

  const linkedProperties = linkedPropertiesForContact(contact.id, properties);
  const searchable = normalizeNetworkText([
    contact.name,
    contact.company,
    contact.phone,
    contact.email,
    contact.type,
    contact.zones,
    contact.tags,
    contact.notes,
    ...linkedProperties.flatMap((property) => [property.title, property.address, property.type]),
  ].join(' '));

  const queryDigits = query.replace(/\D+/g, '');
  const phoneMatches = queryDigits.length >= 5 && phoneIdentity(contact.phone).includes(phoneIdentity(query));
  return searchable.includes(normalizedQuery) || phoneMatches;
}

export function filterCommercialContacts(
  contacts: CommercialContact[],
  properties: Property[],
  filters: CommercialNetworkFilters,
): CommercialContact[] {
  return [...contacts]
    .filter((contact) => filters.type === 'Todos' || contact.type === filters.type)
    .filter((contact) => matchesQuery(contact, properties, filters.query))
    .sort((left, right) => {
      const linkedDifference = linkedPropertiesForContact(right.id, properties).length - linkedPropertiesForContact(left.id, properties).length;
      return linkedDifference || left.name.localeCompare(right.name, 'es');
    });
}

export function findDuplicateCommercialContact(
  contacts: CommercialContact[],
  phone: string,
  excludeId: number | null = null,
): CommercialContact | null {
  const identity = phoneIdentity(phone);
  if (!identity || !isPlausiblePhone(phone)) return null;
  return contacts.find((contact) => contact.id !== excludeId && phoneIdentity(contact.phone) === identity) ?? null;
}

export function unlinkCommercialContact(properties: Property[], contactId: number): Property[] {
  return properties.map((property) => property.sourceContactId === contactId
    ? { ...property, sourceContactId: undefined }
    : property);
}
