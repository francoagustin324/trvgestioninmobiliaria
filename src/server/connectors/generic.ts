import type { ImportedPropertyData, ImportPropertyResponse, ImportProvider } from '../../shared/import-types.js';
import { fetchRenderedHtml } from '../browser.js';
import { extractPropertyFromHtml, importLooksUseful } from '../html-extractor.js';
import { extractPropertyFromJson } from '../json-extractor.js';
import { mergeImportedData } from '../normalizer.js';
import { safeFetchText, validateSafeUrl } from '../utils/safe-url.js';

export interface GenericImportOptions {
  provider: ImportProvider;
  forceBrowserWhenWeak?: boolean;
}

export async function importGeneric(url: string, options: GenericImportOptions): Promise<ImportPropertyResponse> {
  const safeUrl = await validateSafeUrl(url);
  const warnings: string[] = [];
  let lightweightData: ImportedPropertyData = { photoUrls: [] };
  let finalUrl = safeUrl;

  try {
    const response = await safeFetchText(safeUrl);
    finalUrl = response.finalUrl;
    lightweightData = extractPropertyFromHtml(response.text, response.finalUrl.toString());
  } catch (error) {
    warnings.push(error instanceof Error ? `Lectura directa: ${error.message}` : 'No se pudo leer el HTML inicial.');
  }

  if (!options.forceBrowserWhenWeak && importLooksUseful(lightweightData)) {
    return { success: true, provider: options.provider, sourceUrl: finalUrl.toString(), data: lightweightData, warnings };
  }

  try {
    const rendered = await fetchRenderedHtml(safeUrl);
    const renderedData = extractPropertyFromHtml(rendered.html, rendered.finalUrl.toString());
    const networkData = rendered.jsonPayloads.map((payload) => extractPropertyFromJson(payload));
    const data = mergeImportedData(...networkData, renderedData, lightweightData);
    if (!importLooksUseful(data)) {
      throw new Error('El portal no entregó datos suficientes de la propiedad.');
    }
    if (!data.photoUrls.length) warnings.push('No se pudieron recuperar las fotografías de la publicación.');
    return { success: true, provider: options.provider, sourceUrl: rendered.finalUrl.toString(), data, warnings };
  } catch (error) {
    warnings.push(error instanceof Error ? `Navegador: ${error.message}` : 'El navegador no pudo procesar la publicación.');
    if (importLooksUseful(lightweightData)) {
      return { success: true, provider: options.provider, sourceUrl: finalUrl.toString(), data: lightweightData, warnings };
    }
    throw new Error('No pudimos importar automáticamente esta publicación.');
  }
}
