import type { ImportPropertyResponse } from '../shared/import-types.js';
import { importFichaInfo } from './connectors/ficha-info.js';
import { importGeneric } from './connectors/generic.js';
import { importMercadoLibre } from './connectors/mercadolibre.js';
import { importTokko } from './connectors/tokko.js';
import { importZonaprop } from './connectors/zonaprop.js';
import { emptyImportedData } from './normalizer.js';
import { detectProvider } from './provider.js';
import { validateSafeUrl } from './utils/safe-url.js';

const GENERIC_ERROR = 'No pudimos importar automáticamente esta publicación. Podés reintentar o completar los datos manualmente.';

export async function importProperty(input: string): Promise<ImportPropertyResponse> {
  let safeUrl: URL;
  try {
    safeUrl = await validateSafeUrl(input);
  } catch (error) {
    return {
      success: false,
      provider: 'generic',
      sourceUrl: input,
      data: emptyImportedData(),
      warnings: [],
      error: error instanceof Error ? error.message : 'El enlace no es válido.',
    };
  }

  const provider = detectProvider(safeUrl.toString());
  try {
    if (provider === 'mercadolibre') return await importMercadoLibre(safeUrl.toString());
    if (provider === 'zonaprop') return await importZonaprop(safeUrl.toString());
    if (provider === 'ficha-info') return await importFichaInfo(safeUrl.toString());
    if (provider === 'tokko') return await importTokko(safeUrl.toString());
    return await importGeneric(safeUrl.toString(), { provider: 'generic', forceBrowserWhenWeak: true });
  } catch {
    return {
      success: false,
      provider,
      sourceUrl: safeUrl.toString(),
      data: emptyImportedData(),
      warnings: [],
      error: GENERIC_ERROR,
    };
  }
}
