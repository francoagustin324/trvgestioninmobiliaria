import type { ImportPropertyResponse } from '../../shared/import-types.js';
import { importGeneric } from './generic.js';

export async function importFichaInfo(url: string): Promise<ImportPropertyResponse> {
  const result = await importGeneric(url, { provider: 'ficha-info', forceBrowserWhenWeak: true });
  return {
    ...result,
    warnings: result.warnings.length ? result.warnings : ['Ficha importada. Confirmá que no queden datos comerciales de terceros en la descripción.'],
  };
}
