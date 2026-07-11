import type { ImportedPropertyData } from '../shared/import-types.js';

function findValue(value: unknown, keys: Set<string>, depth = 0): string | undefined {
  if (!value || typeof value !== 'object' || depth > 10) return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findValue(item, keys, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  const record = value as Record<string, unknown>;
  for (const [key, item] of Object.entries(record)) {
    if (keys.has(key.toLowerCase()) && (typeof item === 'string' || typeof item === 'number')) return String(item);
  }
  for (const item of Object.values(record)) {
    const found = findValue(item, keys, depth + 1);
    if (found) return found;
  }
  return undefined;
}

function collectImages(value: unknown, output: string[], depth = 0, keyHint = ''): void {
  if (depth > 10 || output.length >= 80) return;
  if (typeof value === 'string') {
    if (/^https?:\/\//i.test(value) && (/image|photo|picture|gallery|media|thumbnail/i.test(keyHint) || /\.(?:jpe?g|png|webp|avif)(?:[?#].*)?$/i.test(value))) output.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectImages(item, output, depth + 1, keyHint);
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) collectImages(item, output, depth + 1, key);
  }
}

export function extractPropertyFromJson(value: unknown): Partial<ImportedPropertyData> {
  const photoUrls: string[] = [];
  collectImages(value, photoUrls);
  const price = findValue(value, new Set(['formattedprice', 'price', 'amount']));
  const currency = findValue(value, new Set(['pricecurrency', 'currency', 'currencyid', 'currency_id']));
  return {
    title: findValue(value, new Set(['postingtitle', 'publicationtitle', 'title', 'name'])),
    description: findValue(value, new Set(['description', 'plain_text', 'body', 'content'])),
    price: price && currency && !price.toUpperCase().includes(currency.toUpperCase()) ? `${currency} ${price}` : price,
    expenses: findValue(value, new Set(['expenses', 'expensas', 'maintenancefee'])),
    bedrooms: findValue(value, new Set(['bedrooms', 'dormitorios', 'roomamount'])),
    bathrooms: findValue(value, new Set(['bathrooms', 'baños', 'banos', 'bathroomamount'])),
    garage: findValue(value, new Set(['garage', 'garages', 'parking', 'cochera', 'parkingspaces'])),
    coveredMeters: findValue(value, new Set(['coveredarea', 'coveredmeters', 'superficiecubierta', 'roofedarea'])),
    totalMeters: findValue(value, new Set(['totalarea', 'totalmeters', 'superficietotal', 'surface', 'floorsize'])),
    zone: findValue(value, new Set(['neighborhood', 'barrio', 'locality', 'addresslocality', 'zone', 'locationname'])),
    approxAddress: findValue(value, new Set(['streetaddress', 'address', 'direccion', 'formattedaddress'])),
    propertyType: findValue(value, new Set(['propertytype', 'property_type', 'tipopropiedad', 'typology'])),
    operation: findValue(value, new Set(['operation', 'operationtype', 'tipooperacion', 'business_type'])),
    age: findValue(value, new Set(['age', 'antiguedad', 'antigüedad'])),
    amenities: findValue(value, new Set(['amenities', 'features', 'comodidades'])),
    photoUrls,
  };
}
