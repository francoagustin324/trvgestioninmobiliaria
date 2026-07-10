import type { ImportedPropertyData } from '../shared/import-types.js';
import { mergeImportedData } from './normalizer.js';
import { cleanText, decodeHtmlEntities, uniquePhotos, visibleText } from './utils/sanitize.js';

function metaContent(html: string, key: string): string | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["']`, 'i'),
  ];
  for (const pattern of patterns) {
    const value = html.match(pattern)?.[1];
    if (value) return decodeHtmlEntities(value);
  }
  return undefined;
}

function absoluteUrl(value: string, baseUrl: string): string | null {
  try { return new URL(decodeHtmlEntities(value), baseUrl).toString(); } catch { return null; }
}

function stringsFromUnknown(value: unknown, output: string[], depth = 0): void {
  if (depth > 8 || output.length > 80) return;
  if (typeof value === 'string') {
    if (/^https?:\/\//i.test(value) && /\.(?:jpe?g|png|webp)(?:[?#].*)?$/i.test(value)) output.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) stringsFromUnknown(item, output, depth + 1);
    return;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) stringsFromUnknown(item, output, depth + 1);
  }
}

function firstStringByKeys(value: unknown, keys: Set<string>, depth = 0): string | undefined {
  if (!value || typeof value !== 'object' || depth > 8) return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstStringByKeys(item, keys, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  const record = value as Record<string, unknown>;
  for (const [key, item] of Object.entries(record)) {
    if (keys.has(key.toLowerCase()) && (typeof item === 'string' || typeof item === 'number')) return String(item);
  }
  for (const item of Object.values(record)) {
    const found = firstStringByKeys(item, keys, depth + 1);
    if (found) return found;
  }
  return undefined;
}

function dataFromJson(value: unknown): Partial<ImportedPropertyData> {
  if (!value || typeof value !== 'object') return {};
  const images: string[] = [];
  stringsFromUnknown(value, images);
  return {
    title: firstStringByKeys(value, new Set(['title', 'name', 'postingtitle', 'publicationtitle'])),
    description: firstStringByKeys(value, new Set(['description', 'plain_text', 'body', 'content'])),
    price: firstStringByKeys(value, new Set(['formattedprice', 'price', 'amount'])),
    expenses: firstStringByKeys(value, new Set(['expenses', 'expensas'])),
    bedrooms: firstStringByKeys(value, new Set(['bedrooms', 'dormitorios'])),
    bathrooms: firstStringByKeys(value, new Set(['bathrooms', 'baños', 'banos'])),
    coveredMeters: firstStringByKeys(value, new Set(['coveredarea', 'coveredmeters', 'superficiecubierta'])),
    totalMeters: firstStringByKeys(value, new Set(['totalarea', 'totalmeters', 'superficietotal'])),
    zone: firstStringByKeys(value, new Set(['neighborhood', 'barrio', 'locality', 'addresslocality', 'zone'])),
    approxAddress: firstStringByKeys(value, new Set(['streetaddress', 'address', 'direccion'])),
    propertyType: firstStringByKeys(value, new Set(['propertytype', 'property_type', 'tipopropiedad'])),
    operation: firstStringByKeys(value, new Set(['operation', 'operationtype', 'tipooperacion'])),
    photoUrls: images,
  };
}

function jsonBlocks(html: string): Array<Partial<ImportedPropertyData>> {
  const results: Array<Partial<ImportedPropertyData>> = [];
  const patterns = [
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    /<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/gi,
  ];
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const raw = match[1]?.trim();
      if (!raw) continue;
      try { results.push(dataFromJson(JSON.parse(raw))); } catch { /* datos parciales inválidos: continuar */ }
    }
  }
  return results;
}

function imageUrls(html: string, baseUrl: string): string[] {
  const urls: string[] = [];
  const og = metaContent(html, 'og:image');
  if (og) {
    const absolute = absoluteUrl(og, baseUrl);
    if (absolute) urls.push(absolute);
  }
  for (const match of html.matchAll(/<(?:img|source)[^>]+(?:src|data-src)=["']([^"']+)["'][^>]*>/gi)) {
    const raw = match[1];
    if (!raw) continue;
    const absolute = absoluteUrl(raw, baseUrl);
    if (absolute) urls.push(absolute);
  }
  for (const match of html.matchAll(/(?:srcset|data-srcset)=["']([^"']+)["']/gi)) {
    const raw = match[1];
    if (!raw) continue;
    const candidates = raw.split(',').map((item) => item.trim().split(/\s+/)[0]).filter((item): item is string => Boolean(item));
    const largest = candidates.at(-1);
    if (!largest) continue;
    const absolute = absoluteUrl(largest, baseUrl);
    if (absolute) urls.push(absolute);
  }
  return uniquePhotos(urls);
}

function inferFromText(html: string): Partial<ImportedPropertyData> {
  const text = visibleText(html);
  const lower = text.toLowerCase();
  const propertyType = /departamento|depto\b/.test(lower) ? 'Departamento' : /casa\b/.test(lower) ? 'Casa' : /terreno|lote\b/.test(lower) ? 'Terreno' : /duplex|dúplex/.test(lower) ? 'Dúplex' : undefined;
  const operation = /\ben alquiler\b|\balquiler\b/.test(lower) ? 'Alquiler' : /\ben venta\b|\bventa\b/.test(lower) ? 'Venta' : undefined;
  const garage = /(?:con\s+)?(?:cochera|garage|garaje)/i.test(text) ? 'Sí' : undefined;
  const deed = /(?:posee|con|cuenta con|tiene)\s+escritura/i.test(text) ? 'Sí' : undefined;
  const creditReady = /apto\s+cr[eé]dito/i.test(text) ? 'Sí' : /no\s+apto\s+cr[eé]dito/i.test(text) ? 'No' : undefined;
  return {
    propertyType,
    operation,
    bedrooms: text.match(/(\d+)\s*(?:dormitorios?|habitaciones?)/i)?.[1],
    bathrooms: text.match(/(\d+)\s*(?:baños?|banos?)/i)?.[1],
    garage,
    coveredMeters: text.match(/([\d.,]+)\s*m(?:²|2)\s*(?:cubiertos?|cub\.?)/i)?.[1],
    totalMeters: text.match(/([\d.,]+)\s*m(?:²|2)\s*(?:totales?|total|sup(?:erficie)?)/i)?.[1],
    expenses: text.match(/expensas?\s*(?:aprox\.?|mensuales?)?\s*[:$]?\s*([A-Z]{0,3}\s*\$?\s*[\d.,]+)/i)?.[1],
    age: text.match(/(?:antigüedad|antiguedad)\s*[:\-]?\s*([\d]+\s*años?)/i)?.[1],
    deed,
    creditReady,
    amenities: [
      /pileta|piscina/i.test(text) ? 'Pileta' : '',
      /sum\b/i.test(text) ? 'SUM' : '',
      /parrilla|asador/i.test(text) ? 'Parrilla / asador' : '',
      /seguridad\s*24/i.test(text) ? 'Seguridad 24 h' : '',
      /gimnasio/i.test(text) ? 'Gimnasio' : '',
    ].filter(Boolean).join(', ') || undefined,
  };
}

export function extractPropertyFromHtml(html: string, baseUrl: string): ImportedPropertyData {
  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const metadata: Partial<ImportedPropertyData> = {
    title: metaContent(html, 'og:title') || (titleTag ? decodeHtmlEntities(titleTag) : undefined),
    description: metaContent(html, 'og:description') || metaContent(html, 'description'),
    price: metaContent(html, 'product:price:amount') || metaContent(html, 'og:price:amount'),
    photoUrls: imageUrls(html, baseUrl),
  };
  const merged = mergeImportedData(...jsonBlocks(html), metadata, inferFromText(html));
  if (merged.description) merged.description = cleanText(merged.description).slice(0, 5000);
  if (merged.title) merged.title = cleanText(merged.title).slice(0, 180);
  return merged;
}

export function importLooksUseful(data: ImportedPropertyData): boolean {
  const usefulFields = [data.title, data.price, data.zone, data.bedrooms, data.totalMeters, data.description].filter(Boolean).length;
  return Boolean(data.title && (data.photoUrls.length >= 2 || usefulFields >= 3));
}
