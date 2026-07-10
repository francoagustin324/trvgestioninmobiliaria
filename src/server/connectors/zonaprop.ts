import type { ImportPropertyResponse } from '../../shared/import-types.js';
import { importGeneric } from './generic.js';

export async function importZonaprop(url: string): Promise<ImportPropertyResponse> {
  const result = await importGeneric(url, { provider: 'zonaprop', forceBrowserWhenWeak: true });
  return {
    ...result,
    warnings: result.warnings.length ? result.warnings : ['Importación automática completada. Revisá precio, expensas y documentación antes de guardar.'],
  };
}
