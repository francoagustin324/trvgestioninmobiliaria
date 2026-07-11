import type { ImportPropertyResponse, ImportProvider } from './shared/import-types.js';
import { state } from './store.js';

function providerLabel(provider: ImportProvider): string {
  return ({ mercadolibre: 'MercadoLibre', zonaprop: 'Zonaprop', 'ficha-info': 'ficha.info', tokko: 'Tokko', generic: 'Otro portal' })[provider];
}

function fillForm(payload: ImportPropertyResponse): void {
  const form = document.querySelector<HTMLFormElement>('#ficha-form');
  if (!form) throw new Error('No se pudo abrir el formulario de Fichas TRV.');

  for (const [key, value] of Object.entries(payload.data)) {
    if (value === undefined || value === null || value === '') continue;
    const input = form.elements.namedItem(key);
    if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement || input instanceof HTMLSelectElement) {
      input.value = Array.isArray(value) ? value.join('\n') : String(value);
    }
  }

  const sourceUrl = form.elements.namedItem('internalOriginalLink');
  const source = form.elements.namedItem('source');
  if (sourceUrl instanceof HTMLInputElement) sourceUrl.value = payload.sourceUrl;
  if (source instanceof HTMLInputElement) source.value = providerLabel(payload.provider);

  const photos = form.elements.namedItem('photoUrls');
  if (photos instanceof HTMLTextAreaElement) photos.dispatchEvent(new Event('change', { bubbles: true }));

  const status = document.querySelector<HTMLElement>('#import-status');
  if (status) {
    status.className = 'import-status success';
    status.replaceChildren();
    const title = document.createElement('strong');
    title.textContent = `Datos copiados desde ${providerLabel(payload.provider)}. Revisá la ficha y guardala.`;
    status.append(title);
    if (payload.warnings.length) {
      const list = document.createElement('ul');
      for (const warning of payload.warnings) {
        const item = document.createElement('li');
        item.textContent = warning;
        list.append(item);
      }
      status.append(list);
    }
  }
}

export async function consumeExtensionImport(token: string): Promise<void> {
  state.activeModule = 'fichas';
  state.fichaMode = 'external';
  state.openForms.ficha = true;
  document.dispatchEvent(new CustomEvent('trv-render'));

  const response = await fetch(`/api/extension-import/${encodeURIComponent(token)}`, { cache: 'no-store' });
  const payload = await response.json() as ImportPropertyResponse;
  if (!response.ok || !payload.success) throw new Error(payload.error || 'No se pudo recuperar la publicación enviada por la extensión.');

  fillForm(payload);
  history.replaceState(null, '', `${location.pathname}${location.search}`);
}
