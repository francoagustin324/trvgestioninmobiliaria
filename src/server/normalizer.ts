import type { ImportedPropertyData } from '../shared/import-types.js';
import { cleanTechnicalText, cleanText, uniquePhotos } from './utils/sanitize.js';

const COMMERCIAL_TEXT_FIELDS = new Set<keyof ImportedPropertyData>(['title', 'description', 'amenities']);

export function emptyImportedData(): ImportedPropertyData {
  return { photoUrls: [] };
}

export function normalizeImportedData(data: Partial<ImportedPropertyData>): ImportedPropertyData {
  const normalized: ImportedPropertyData = { photoUrls: uniquePhotos(data.photoUrls ?? []) };
  const writable = normalized as unknown as Record<string, string | string[]>;
  for (const [key, value] of Object.entries(data)) {
    if (key === 'photoUrls' || typeof value !== 'string') continue;
    const cleaned = COMMERCIAL_TEXT_FIELDS.has(key as keyof ImportedPropertyData) ? cleanText(value) : cleanTechnicalText(value);
    if (cleaned) writable[key] = cleaned;
  }
  return normalized;
}

export function mergeImportedData(...items: Array<Partial<ImportedPropertyData>>): ImportedPropertyData {
  const merged: Partial<ImportedPropertyData> = {};
  const writable = merged as unknown as Record<string, unknown>;
  const photos: string[] = [];
  for (const item of items) {
    for (const [key, value] of Object.entries(item)) {
      if (key === 'photoUrls') {
        if (Array.isArray(value)) photos.push(...value.filter((photo): photo is string => typeof photo === 'string'));
        continue;
      }
      if (typeof value === 'string' && value.trim() && !writable[key]) writable[key] = value;
    }
  }
  merged.photoUrls = photos;
  return normalizeImportedData(merged);
}
