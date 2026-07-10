import type { ImportedPropertyData } from '../shared/import-types.js';
import { cleanText, uniquePhotos } from './utils/sanitize.js';

export function emptyImportedData(): ImportedPropertyData {
  return { photoUrls: [] };
}

export function normalizeImportedData(data: Partial<ImportedPropertyData>): ImportedPropertyData {
  const normalized: ImportedPropertyData = { photoUrls: uniquePhotos(data.photoUrls ?? []) };
  for (const [key, value] of Object.entries(data)) {
    if (key === 'photoUrls' || typeof value !== 'string') continue;
    const cleaned = cleanText(value);
    if (cleaned) (normalized as Record<string, string | string[]>)[key] = cleaned;
  }
  return normalized;
}

export function mergeImportedData(...items: Array<Partial<ImportedPropertyData>>): ImportedPropertyData {
  const merged: Partial<ImportedPropertyData> = {};
  const photos: string[] = [];
  for (const item of items) {
    for (const [key, value] of Object.entries(item)) {
      if (key === 'photoUrls') {
        if (Array.isArray(value)) photos.push(...value.filter((photo): photo is string => typeof photo === 'string'));
        continue;
      }
      if (typeof value === 'string' && value.trim() && !(merged as Record<string, unknown>)[key]) {
        (merged as Record<string, unknown>)[key] = value;
      }
    }
  }
  merged.photoUrls = photos;
  return normalizeImportedData(merged);
}
