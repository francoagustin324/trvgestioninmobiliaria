import type { ImportedPropertyData } from '../shared/import-types.js';
import { cleanText, uniquePhotos } from './utils/sanitize.js';

export function emptyData(): ImportedPropertyData { return { photoUrls: [] }; }

export function normalizeData(data: Partial<ImportedPropertyData>): ImportedPropertyData {
  const normalized: ImportedPropertyData = { photoUrls: uniquePhotos(data.photoUrls || []) };
  for (const [key, value] of Object.entries(data)) {
    if (key === 'photoUrls') continue;
    if (typeof value === 'string' && value.trim()) (normalized as unknown as Record<string, unknown>)[key] = cleanText(value);
  }
  return normalized;
}

export function mergeData(...items: Partial<ImportedPropertyData>[]): ImportedPropertyData {
  return normalizeData(Object.assign({}, ...items, { photoUrls: items.flatMap((item) => item.photoUrls || []) }));
}
