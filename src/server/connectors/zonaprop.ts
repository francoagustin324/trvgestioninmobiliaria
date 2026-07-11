import type { ImportPropertyResponse } from '../../shared/import-types.js';
import { importGeneric } from './generic.js';
export async function importZonaprop(url: string): Promise<ImportPropertyResponse> {
  const result = await importGeneric(url);
  return { ...result, provider: 'zonaprop', warnings: result.data.title ? [] : ['Zonaprop puede bloquear datos renderizados; se extrajo solo información disponible públicamente.'] };
}
