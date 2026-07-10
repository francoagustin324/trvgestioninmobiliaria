import type { ImportPropertyResponse } from '../../shared/import-types.js';
import { extractMlaId } from '../provider.js';
import { mergeData } from '../normalizer.js';
import { importGeneric } from './generic.js';

export async function importMercadoLibre(url: string): Promise<ImportPropertyResponse> {
  const id = extractMlaId(url);
  if (!id) return { ...(await importGeneric(url)), provider: 'mercadolibre', warnings: ['No se pudo detectar el ID MLA; se usó importador genérico.'] };
  try {
    const itemResponse = await fetch(`https://api.mercadolibre.com/items/${id}`);
    if (!itemResponse.ok) throw new Error('API item no disponible');
    const item = await itemResponse.json();
    const descriptionResponse = await fetch(`https://api.mercadolibre.com/items/${id}/description`);
    const description = descriptionResponse.ok ? await descriptionResponse.json() : {};
    const attr = (names: string[]) => item.attributes?.find((a: any) => names.includes(String(a.id)) || names.includes(String(a.name).toLowerCase()))?.value_name;
    return {
      success: true,
      provider: 'mercadolibre',
      data: mergeData({
        title: item.title,
        price: item.price ? `${item.currency_id || ''} ${item.price}`.trim() : '',
        description: description.plain_text,
        zone: [item.location?.city?.name, item.location?.state?.name].filter(Boolean).join(', '),
        approxAddress: item.location?.address_line,
        bedrooms: attr(['BEDROOMS', 'dormitorios']),
        bathrooms: attr(['FULL_BATHROOMS', 'baños']),
        garage: attr(['PARKING_LOTS', 'cocheras']) ? 'Sí' : '',
        coveredMeters: attr(['COVERED_AREA', 'superficie cubierta']),
        totalMeters: attr(['TOTAL_AREA', 'superficie total']),
        age: attr(['PROPERTY_AGE', 'antigüedad']),
        photoUrls: (item.pictures || []).map((picture: any) => picture.secure_url || picture.url),
      }),
      warnings: [],
    };
  } catch {
    const fallback = await importGeneric(url);
    return { ...fallback, provider: 'mercadolibre', warnings: ['Falló la API pública de MercadoLibre; se usó extracción HTML como respaldo.'] };
  }
}
