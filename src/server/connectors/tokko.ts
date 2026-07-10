import type { ImportPropertyResponse } from '../../shared/import-types.js';
import { importGeneric } from './generic.js';

export async function importTokko(url: string): Promise<ImportPropertyResponse> {
  return importGeneric(url, { provider: 'tokko', forceBrowserWhenWeak: true });
}
