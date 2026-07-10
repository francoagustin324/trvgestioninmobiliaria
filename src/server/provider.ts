import type { ImportProvider } from '../shared/import-types.js';

export function detectProvider(input: string): ImportProvider {
  const host = new URL(input).hostname.replace(/^www\./, '').toLowerCase();
  if (host === 'mercadolibre.com.ar' || host.endsWith('.mercadolibre.com.ar')) return 'mercadolibre';
  if (host === 'zonaprop.com.ar' || host.endsWith('.zonaprop.com.ar')) return 'zonaprop';
  if (host === 'ficha.info' || host.endsWith('.ficha.info')) return 'ficha-info';
  return 'generic';
}

export function extractMlaId(input: string): string | null {
  const match = input.match(/\b(MLA-?\d+)\b/i);
  return match ? match[1].replace('-', '').toUpperCase() : null;
}
