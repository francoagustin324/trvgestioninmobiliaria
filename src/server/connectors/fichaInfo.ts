import type { ImportPropertyResponse } from '../../shared/import-types.js';
import { importGeneric } from './generic.js';
export async function importFichaInfo(url: string): Promise<ImportPropertyResponse> {
  const result = await importGeneric(url);
  return { ...result, provider: 'ficha-info', warnings: result.data.title ? [] : ['ficha.info no expuso todos los datos en HTML inicial.'] };
}
