import { randomUUID } from 'node:crypto';
import type { ImportPropertyResponse, ImportedPropertyData } from '../shared/import-types.js';
import { normalizeImportedData } from './normalizer.js';
import { detectProvider } from './provider.js';

interface StoredImport {
  expiresAt: number;
  payload: ImportPropertyResponse;
}

const imports = new Map<string, StoredImport>();
const TTL_MS = 15 * 60_000;
const MAX_IMPORTS = 100;

function cleanup(): void {
  const now = Date.now();
  for (const [token, item] of imports) {
    if (item.expiresAt <= now) imports.delete(token);
  }
  while (imports.size > MAX_IMPORTS) {
    const oldest = imports.keys().next().value as string | undefined;
    if (!oldest) break;
    imports.delete(oldest);
  }
}

function suspiciousExtensionTitle(value: string | undefined): boolean {
  const title = String(value ?? '').trim();
  if (!title) return false;
  if (/^(?:https?:\/\/)?(?:www\.)?[a-z0-9.-]+\.[a-z]{2,}\/?$/i.test(title)) return true;
  return /(?:captcha|access denied|acceso denegado|cloudflare|verification|verificaci[oó]n|verify you are human|verifica que eres humano|just a moment|checking your browser|challenge)/i.test(title);
}

export function hasSufficientExtensionPropertyData(data: ImportedPropertyData): boolean {
  const title = String(data.title ?? '').trim();
  if (title && suspiciousExtensionTitle(title)) return false;
  const meaningfulTitle = title.length >= 4;
  const secondarySignals = [
    data.price,
    data.zone || data.approxAddress,
    data.propertyType,
    data.operation,
    data.bedrooms || data.bathrooms,
    data.coveredMeters || data.totalMeters,
    String(data.description ?? '').trim().length >= 20 ? data.description : '',
    data.photoUrls.length ? 'photos' : '',
  ].filter(Boolean).length;
  return meaningfulTitle ? secondarySignals >= 1 : secondarySignals >= 2;
}

export function storeExtensionImport(sourceUrl: string, rawData: Partial<ImportedPropertyData>): string {
  cleanup();
  const parsedUrl = new URL(sourceUrl);
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('El enlace de origen no es válido.');
  const data = normalizeImportedData({ ...rawData, photoUrls: Array.isArray(rawData.photoUrls) ? rawData.photoUrls : [] });
  if (!hasSufficientExtensionPropertyData(data)) {
    throw new Error('La extensión no encontró información inmobiliaria suficiente en la publicación.');
  }
  const token = randomUUID();
  imports.set(token, {
    expiresAt: Date.now() + TTL_MS,
    payload: {
      success: true,
      provider: detectProvider(parsedUrl.toString()),
      sourceUrl: parsedUrl.toString(),
      data,
      warnings: data.photoUrls.length ? [] : ['No se detectaron fotografías. Revisá si la galería terminó de cargar antes de volver a intentar.'],
    },
  });
  return token;
}

export function takeExtensionImport(token: string): ImportPropertyResponse | null {
  cleanup();
  const item = imports.get(token);
  if (!item) return null;
  imports.delete(token);
  return item.payload;
}
