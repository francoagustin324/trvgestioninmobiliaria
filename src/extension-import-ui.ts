import type { ImportPropertyResponse, ImportProvider } from './shared/import-types.js';
import { state } from './store.js';

function providerLabel(provider: ImportProvider): string {
  return ({ mercadolibre: 'MercadoLibre', zonaprop: 'Zonaprop', 'ficha-info': 'ficha.info', tokko: 'Tokko', generic: 'Otro portal' })[provider];
}

function importedNumber(value: string | undefined): number | undefined {
  const match = String(value ?? '').match(/-?\d[\d.,]*/);
  if (!match) return undefined;
  const token = match[0];
  const lastDot = token.lastIndexOf('.');
  const lastComma = token.lastIndexOf(',');
  const separatorIndex = Math.max(lastDot, lastComma);
  let normalizedValue = token;
  if (separatorIndex >= 0) {
    const separator = token[separatorIndex] || '';
    const fractionLength = token.length - separatorIndex - 1;
    const separatorCount = separator ? token.split(separator).length - 1 : 0;
    normalizedValue = fractionLength === 3 || separatorCount > 1
      ? token.replace(/[.,]/g, '')
      : token.slice(0, separatorIndex).replace(/[.,]/g, '') + '.' + token.slice(separatorIndex + 1);
  }
  const parsed = Number(normalizedValue);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function importedUsdPrice(value: string | undefined): number | undefined {
  const raw = String(value ?? '').trim();
  if (!raw) return undefined;
  const explicitUsd = /(?:^|[^A-Z0-9])(?:USD|U\$S|US\$)(?=\s|[\d.,])/i.test(raw);
  const conflictingCurrency = /\b(?:ARS|EUR|BRL)\b|(?:^|\s)GS\.?\s/i.test(raw);
  if (!explicitUsd || conflictingCurrency) return undefined;
  return importedNumber(raw);
}

function setImportedValue(form: HTMLFormElement, name: string, value: string | number | undefined): void {
  if (value === undefined || value === null || String(value).trim() === '') return;
  const control = form.elements.namedItem(name);
  if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) control.value = String(value);
}

function normalizedOption(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function setImportedSelect(form: HTMLFormElement, name: string, value: string | undefined): void {
  if (!value?.trim()) return;
  const control = form.elements.namedItem(name);
  if (!(control instanceof HTMLSelectElement)) return;
  const target = normalizedOption(value);
  const match = Array.from(control.options).find((option) => normalizedOption(option.value) === target);
  if (match) control.value = match.value;
  else control.selectedIndex = -1;
}

function fillMvpPropertyForm(payload: ImportPropertyResponse): void {
  const form = document.querySelector<HTMLFormElement>('#mvp-property-form:not(.collapsed)');
  if (!form) throw new Error('No se pudo abrir el formulario de propiedades de OrdenBroker.');

  const data = payload.data;
  setImportedValue(form, 'title', data.title);
  setImportedValue(form, 'address', data.zone || data.approxAddress);
  setImportedSelect(form, 'type', data.propertyType);
  setImportedSelect(form, 'operation', data.operation);
  setImportedSelect(form, 'status', data.status);

  const price = importedUsdPrice(data.price);
  setImportedValue(form, 'price', price);
  setImportedValue(form, 'bedrooms', importedNumber(data.bedrooms));
  setImportedValue(form, 'bathrooms', importedNumber(data.bathrooms));
  setImportedValue(form, 'garage', data.garage);
  setImportedValue(form, 'coveredMeters', importedNumber(data.coveredMeters));
  setImportedValue(form, 'totalMeters', importedNumber(data.totalMeters));
  setImportedValue(form, 'age', data.age);
  setImportedSelect(form, 'deed', data.deed);
  setImportedSelect(form, 'creditReady', data.creditReady);
  setImportedValue(form, 'paymentMethod', data.paymentMethod);
  setImportedValue(form, 'features', data.amenities);
  setImportedValue(form, 'description', data.description);
  setImportedValue(form, 'sourceLink', payload.sourceUrl);

  const photos = form.elements.namedItem('photoUrls');
  if (photos instanceof HTMLTextAreaElement) {
    photos.value = data.photoUrls.join('\n');
    photos.dispatchEvent(new Event('change', { bubbles: true }));
  }

  const warnings = [...payload.warnings];
  if (data.price && price === undefined) {
    warnings.push('El precio publicado no está expresado claramente en USD. Completalo manualmente antes de guardar.');
  }

  const status = form.querySelector<HTMLElement>('[data-property-import-status]');
  if (status) {
    status.hidden = false;
    status.replaceChildren();
    const title = document.createElement('strong');
    title.textContent = 'Propiedad importada. Revisá los datos antes de guardar.';
    status.append(title);
    if (warnings.length) {
      const list = document.createElement('ul');
      for (const warning of warnings) {
        const item = document.createElement('li');
        item.textContent = warning;
        list.append(item);
      }
      status.append(list);
    }
  }
}

function fillForm(payload: ImportPropertyResponse): void {
  const form = document.querySelector<HTMLFormElement>('#ficha-form');
  if (!form) throw new Error('No se pudo abrir el formulario de propiedades de OrdenBroker.');

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


export async function consumeExtensionPropertyImport(token: string): Promise<ImportPropertyResponse> {
  const response = await fetch('/api/extension-import/' + encodeURIComponent(token), { cache: 'no-store' });
  const payload = await response.json() as ImportPropertyResponse;
  if (!response.ok || !payload.success) {
    throw new Error(payload.error || 'No se pudo recuperar la propiedad enviada por la extensión.');
  }
  fillMvpPropertyForm(payload);
  history.replaceState(null, '', location.pathname + location.search);
  return payload;
}
