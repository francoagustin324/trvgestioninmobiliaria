import type { ImportPropertyResponse } from '../shared/import-types.js';
import { detectProvider } from './provider.js';
import { validateSafeUrl } from './utils/safe-url.js';
import { importMercadoLibre } from './connectors/mercadolibre.js';
import { importZonaprop } from './connectors/zonaprop.js';
import { importFichaInfo } from './connectors/fichaInfo.js';
import { importGeneric } from './connectors/generic.js';
import { emptyData } from './normalizer.js';

export async function importProperty(url: string): Promise<ImportPropertyResponse> {
  let safeUrl: URL;
  try { safeUrl = await validateSafeUrl(url); } catch (error) { return { success: false, provider: 'generic', data: emptyData(), warnings: [], error: error instanceof Error ? error.message : 'URL inválida' }; }
  const provider = detectProvider(safeUrl.toString());
  try {
    if (provider === 'mercadolibre') return await importMercadoLibre(safeUrl.toString());
    if (provider === 'zonaprop') return await importZonaprop(safeUrl.toString());
    if (provider === 'ficha-info') return await importFichaInfo(safeUrl.toString());
    return await importGeneric(safeUrl.toString());
  } catch (error) {
    return { success: false, provider, data: emptyData(), warnings: [], error: 'No pudimos importar automáticamente esta publicación. Podés reintentar o completar los datos manualmente.' };
  }
}
