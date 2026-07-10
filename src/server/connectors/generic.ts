import type { ImportedPropertyData, ImportPropertyResponse } from '../../shared/import-types.js';
import { detectProvider } from '../provider.js';
import { mergeData } from '../normalizer.js';
import { normalizeWhitespace, uniquePhotos } from '../utils/sanitize.js';
import { safeFetchText, validateSafeUrl } from '../utils/safe-url.js';

function meta(html: string, selector: string): string | undefined {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["']`, 'i')) || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["']`, 'i'));
  return match?.[1];
}

function jsonLd(html: string): Partial<ImportedPropertyData> {
  const blocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const block of blocks) {
    try {
      const parsed = JSON.parse(block[1].trim());
      const item = Array.isArray(parsed) ? parsed[0] : parsed;
      const offer = item.offers || {};
      return { title: item.name, description: item.description, approxAddress: item.address?.streetAddress || item.address?.addressLocality, zone: item.address?.addressLocality, price: offer.price ? `${offer.priceCurrency || ''} ${offer.price}`.trim() : undefined, photoUrls: Array.isArray(item.image) ? item.image : item.image ? [item.image] : [] };
    } catch { /* continue */ }
  }
  return {};
}

export function parseGenericHtml(html: string, url: string): ImportedPropertyData {
  const text = normalizeWhitespace(html);
  const title = meta(html, 'og:title') || html.match(/<title[^>]*>(.*?)<\/title>/i)?.[1];
  const description = meta(html, 'og:description') || meta(html, 'description');
  const images = [...html.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi)].map((m) => new URL(m[1], url).toString());
  const ogImage = meta(html, 'og:image');
  const data: Partial<ImportedPropertyData> = {
    title,
    description,
    photoUrls: uniquePhotos([...(ogImage ? [new URL(ogImage, url).toString()] : []), ...images]),
    bedrooms: text.match(/(\d+)\s*(dormitorios?|hab(?:itaciones?)?)/i)?.[1],
    bathrooms: text.match(/(\d+)\s*bañ/i)?.[1],
    garage: /cochera|garage/i.test(text) ? 'Sí' : undefined,
    coveredMeters: text.match(/(\d+[\d.,]*)\s*m[²2]\s*cub/i)?.[1],
    totalMeters: text.match(/(\d+[\d.,]*)\s*m[²2]\s*(tot|sup)/i)?.[1],
    expenses: text.match(/expensas?\s*[:$]?\s*([\w\s.$]+)/i)?.[1]?.slice(0, 40),
    creditReady: /apto crédito/i.test(text) ? 'Sí' : undefined,
    deed: /escritura/i.test(text) ? 'Consultar' : undefined,
  };
  return mergeData(jsonLd(html), data);
}

export async function importGeneric(url: string): Promise<ImportPropertyResponse> {
  const safeUrl = await validateSafeUrl(url);
  const { text, finalUrl } = await safeFetchText(safeUrl);
  return { success: true, provider: detectProvider(finalUrl.toString()), data: parseGenericHtml(text, finalUrl.toString()), warnings: [] };
}
