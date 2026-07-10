import type { ImportedPropertyData, ImportPropertyResponse } from '../../shared/import-types.js';
import { mergeImportedData } from '../normalizer.js';
import { extractMlaId } from '../provider.js';
import { importGeneric } from './generic.js';

interface MercadoLibreAttribute {
  id?: string;
  name?: string;
  value_name?: string;
}

interface MercadoLibreItem {
  title?: string;
  price?: number;
  currency_id?: string;
  attributes?: MercadoLibreAttribute[];
  pictures?: Array<{ secure_url?: string; url?: string }>;
  location?: {
    address_line?: string;
    neighborhood?: { name?: string };
    city?: { name?: string };
    state?: { name?: string };
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`MercadoLibre respondió ${response.status}.`);
    return await response.json() as T;
  } finally {
    clearTimeout(timeout);
  }
}

function attribute(item: MercadoLibreItem, ids: string[], names: RegExp): string | undefined {
  return item.attributes?.find((entry) => ids.includes(entry.id ?? '') || names.test(entry.name ?? ''))?.value_name;
}

function apiData(item: MercadoLibreItem, description: string): ImportedPropertyData {
  const neighborhood = item.location?.neighborhood?.name;
  const city = item.location?.city?.name;
  const state = item.location?.state?.name;
  const parking = attribute(item, ['PARKING_LOTS', 'GARAGES'], /cochera|garage|estacionamiento/i);
  return mergeImportedData({
    title: item.title,
    price: item.price ? `${item.currency_id === 'USD' ? 'USD' : item.currency_id ?? ''} ${new Intl.NumberFormat('es-AR').format(item.price)}`.trim() : undefined,
    description,
    zone: [neighborhood, city, state].filter(Boolean).join(', ') || undefined,
    approxAddress: item.location?.address_line,
    propertyType: attribute(item, ['PROPERTY_TYPE'], /tipo de propiedad/i),
    operation: attribute(item, ['OPERATION'], /operaci[oó]n/i),
    bedrooms: attribute(item, ['BEDROOMS'], /dormitorios?|habitaciones?/i),
    bathrooms: attribute(item, ['FULL_BATHROOMS', 'BATHROOMS'], /baños?|banos?/i),
    garage: parking && parking !== '0' ? 'Sí' : undefined,
    coveredMeters: attribute(item, ['COVERED_AREA'], /superficie cubierta/i),
    totalMeters: attribute(item, ['TOTAL_AREA'], /superficie total/i),
    age: attribute(item, ['PROPERTY_AGE'], /antigüedad|antiguedad/i),
    expenses: attribute(item, ['MAINTENANCE_FEE'], /expensas/i),
    creditReady: attribute(item, ['SUITABLE_FOR_MORTGAGE_LOAN'], /apto cr[eé]dito/i),
    photoUrls: (item.pictures ?? []).map((picture) => picture.secure_url || picture.url || '').filter(Boolean),
  });
}

export async function importMercadoLibre(url: string): Promise<ImportPropertyResponse> {
  const id = extractMlaId(url);
  if (!id) return importGeneric(url, { provider: 'mercadolibre', forceBrowserWhenWeak: true });
  const warnings: string[] = [];
  try {
    const item = await fetchJson<MercadoLibreItem>(`https://api.mercadolibre.com/items/${id}`);
    let description = '';
    try {
      const payload = await fetchJson<{ plain_text?: string }>(`https://api.mercadolibre.com/items/${id}/description`);
      description = payload.plain_text ?? '';
    } catch {
      warnings.push('MercadoLibre no entregó la descripción por API.');
    }
    const data = apiData(item, description);
    if (!data.description || data.photoUrls.length < 2) {
      try {
        const fallback = await importGeneric(url, { provider: 'mercadolibre', forceBrowserWhenWeak: true });
        return { ...fallback, data: mergeImportedData(data, fallback.data), warnings: [...warnings, ...fallback.warnings] };
      } catch {
        warnings.push('No se pudo completar la publicación mediante el HTML.');
      }
    }
    return { success: true, provider: 'mercadolibre', sourceUrl: url, data, warnings };
  } catch {
    return importGeneric(url, { provider: 'mercadolibre', forceBrowserWhenWeak: true });
  }
}
