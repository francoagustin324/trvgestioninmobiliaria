import type { FichaPublica, Property } from './models.js';
import { encodePublicFicha } from './public-ficha.js';
import { safePhotoUrl } from './utils.js';

export type PropertyWithFicha = Property & {
  garage?: string;
  coveredMeters?: number;
  totalMeters?: number;
  age?: string;
  deed?: string;
  creditReady?: string;
  description?: string;
  photoUrls?: string[];
};

const priceFormatter = new Intl.NumberFormat('es-AR');

export function propertyToPublicFicha(property: PropertyWithFicha): FichaPublica {
  const photoUrls = (property.photoUrls ?? [])
    .map(safePhotoUrl)
    .filter((url): url is string => Boolean(url))
    .slice(0, 8);

  return {
    title: property.title,
    propertyType: property.type,
    operation: property.operation,
    zone: property.address,
    price: property.price > 0 ? `USD ${priceFormatter.format(property.price)}` : 'Consultar',
    bedrooms: property.bedrooms ? String(property.bedrooms) : undefined,
    bathrooms: property.bathrooms ? String(property.bathrooms) : undefined,
    garage: property.garage,
    coveredMeters: property.coveredMeters ? `${property.coveredMeters} m²` : undefined,
    totalMeters: property.totalMeters ? `${property.totalMeters} m²` : undefined,
    age: property.age,
    status: property.status,
    amenities: property.features,
    description: property.description,
    deed: property.deed,
    creditReady: property.creditReady,
    paymentMethod: property.paymentMethod,
    photoUrls,
    photoEnhancement: 'none',
  };
}

export function propertyFichaLink(
  property: PropertyWithFicha,
  origin = location.origin,
  pathname = location.pathname,
): string {
  return `${origin}${pathname}#public=${encodePublicFicha(propertyToPublicFicha(property))}`;
}
