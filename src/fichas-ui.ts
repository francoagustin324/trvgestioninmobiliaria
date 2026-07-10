import { Ficha, FichaMode, Property } from './models.js';
import { publicFichaHtml, publicLink, publicPayload, whatsappText } from './public-ficha.js';
import { saveData, state } from './store.js';
import type { ImportedPropertyData, ImportPropertyResponse } from './shared/import-types.js';
import { copyText, escapeHtml, field, formValues, nextId, safePhotoUrl } from './utils.js';

function propertyToFicha(property: Property): Partial<Ficha> {
  return {
    title: property.title, propertyType: property.type, operation: property.operation,
    zone: property.address, approxAddress: property.address,
    price: property.price ? `USD ${new Intl.NumberFormat('es-AR').format(property.price)}` : '',
    status: property.status, sourcePropertyId: property.id,
  };
}

function normalizePhotos(value: string): string[] {
  return value.split('\n').map((item) => item.trim()).map(safePhotoUrl).filter((url): url is string => Boolean(url)).slice(0, 12);
}

function visibleMode(): 'property' | 'external' {
  return state.fichaMode === 'external' ? 'external' : 'property';
}

function createFicha(values: Record<string, string>): Ficha {
  const selectedProperty = state.crm.properties.find((property) => property.id === Number(field(values, 'sourcePropertyId')));
  const base = selectedProperty ? propertyToFicha(selectedProperty) : {};
  const current = state.editingFichaId ? state.crm.fichas.find((item) => item.id === state.editingFichaId) : undefined;
  return {
    id: state.editingFichaId ?? nextId(state.crm.fichas),
    mode: visibleMode(),
    title: field(values, 'title') || String(base.title || ''),
    propertyType: field(values, 'propertyType') || String(base.propertyType || ''),
    operation: field(values, 'operation') || String(base.operation || ''),
    zone: field(values, 'zone') || String(base.zone || ''),
    approxAddress: field(values, 'approxAddress') || String(base.approxAddress || ''),
    price: field(values, 'price') || String(base.price || ''),
    expenses: field(values, 'expenses'), bedrooms: field(values, 'bedrooms'), bathrooms: field(values, 'bathrooms'), garage: field(values, 'garage'),
    coveredMeters: field(values, 'coveredMeters'), totalMeters: field(values, 'totalMeters'), age: field(values, 'age'),
    status: field(values, 'status') || String(base.status || ''), amenities: field(values, 'amenities'), description: field(values, 'description'),
    deed: field(values, 'deed'), creditReady: field(values, 'creditReady'), paymentMethod: field(values, 'paymentMethod'),
    photoUrls: normalizePhotos(field(values, 'photoUrls')),
    photoEnhancement: field(values, 'photoEnhancement') === 'soft' ? 'soft' : 'none',
    sourcePropertyId: field(values, 'sourcePropertyId') ? Number(field(values, 'sourcePropertyId')) : undefined,
    internalOriginalLink: field(values, 'internalOriginalLink'), source: field(values, 'source'), internalNotes: field(values, 'internalNotes'),
    createdAt: current?.createdAt || new Date().toISOString(),
  };
}

function formHtml(): string {
  const options = state.crm.properties.map((property) => `<option value="${property.id}">${escapeHtml(property.title)}</option>`).join('');
  const mode = visibleMode();
  return `<form id="ficha-form" class="data-form ficha-form ${state.openForms.ficha ? '' : 'collapsed'}" data-mode="${mode}">
    <section class="own-property-box property-only">
      <span class="importer-kicker">Mis propiedades</span>
      <h3>Cargá una propiedad propia o elegí una ya guardada</h3>
      <p>Podés seleccionar una propiedad de tu cartera para completar datos básicos o cargarla directamente en el formulario.</p>
      <select name="sourcePropertyId" class="property-source"><option value="">Cargar una propiedad nueva</option>${options}</select>
    </section>
    <section class="importer-box external-only" aria-labelledby="importer-title">
      <span class="importer-kicker">Link recibido</span>
      <h3 id="importer-title">Pegá el enlace y generá una ficha TRV</h3>
      <p>Copiamos los datos y fotos publicados sin reescribir precios, metros, dormitorios ni descripción. Solo quitamos datos de contacto y marca comercial de terceros de la ficha para clientes.</p>
      <div class="provider-badges"><span>MercadoLibre</span><span>Zonaprop</span><span>ficha.info</span><span>Tokko</span><span>Otros portales</span></div>
      <div class="importer-controls"><input name="internalOriginalLink" type="url" class="import-url" placeholder="Pegá acá el enlace que te enviaron" inputmode="url"><button type="button" id="import-property">Crear ficha desde el link</button></div>
      <input name="source" class="provider-result" placeholder="Portal detectado" readonly>
      <div id="import-status" class="import-status" role="status" aria-live="polite"></div>
      <div id="import-photos" class="import-photos"></div>
    </section>
    <input name="title" placeholder="Título" required><input name="propertyType" placeholder="Tipo de propiedad"><select name="operation"><option value="">Operación</option><option>Venta</option><option>Alquiler</option><option>Captación</option></select><input name="zone" placeholder="Zona"><input name="approxAddress" placeholder="Dirección aproximada">
    <input name="price" placeholder="Precio"><input name="expenses" placeholder="Expensas"><input name="bedrooms" placeholder="Dormitorios"><input name="bathrooms" placeholder="Baños"><select name="garage"><option value="">Cochera</option><option>Sí</option><option>No</option></select>
    <input name="coveredMeters" placeholder="Metros cubiertos"><input name="totalMeters" placeholder="Metros totales"><input name="age" placeholder="Antigüedad"><input name="status" placeholder="Estado"><input name="amenities" placeholder="Amenities">
    <textarea name="description" placeholder="Descripción comercial"></textarea><input name="deed" placeholder="Escritura"><input name="creditReady" placeholder="Apto crédito"><input name="paymentMethod" placeholder="Forma de pago"><textarea name="photoUrls" placeholder="URLs de fotos, una por línea"></textarea>
    <label class="photo-enhancement-toggle"><input type="checkbox" name="photoEnhancement" value="soft"><span><b>Mejora visual suave de fotos</b><small>Ajusta luz, contraste y color en la ficha. No agrega, elimina ni modifica elementos de la propiedad.</small></span></label>
    <textarea name="internalNotes" placeholder="Observaciones internas"></textarea>
    <button type="submit">Guardar ficha TRV</button>
  </form>`;
}

export function renderFichas(container: HTMLElement): void {
  const selected = state.crm.fichas.find((item) => item.id === state.selectedFichaId) || state.crm.fichas[0] || null;
  if (selected && state.selectedFichaId === null) state.selectedFichaId = selected.id;
  const mode = visibleMode();
  container.innerHTML = `<div class="panel-heading"><div><span class="eyebrow">Fichas TRV</span><h2>Generador comercial</h2></div><button data-toggle="ficha-form">Nueva ficha</button></div>
    <div class="mode-tabs two-modes"><button data-mode="property" class="${mode === 'property' ? 'active' : ''}">Mis propiedades</button><button data-mode="external" class="${mode === 'external' ? 'active' : ''}">Pegar link recibido</button></div>
    ${formHtml()}
    <div class="fichas-layout"><section class="panel-card"><h3>Fichas guardadas</h3><div class="ficha-list">${state.crm.fichas.map((ficha) => `<article class="ficha-list-card ${selected?.id === ficha.id ? 'active' : ''}"><div><h4>${escapeHtml(ficha.title)}</h4><p>${escapeHtml([ficha.zone, ficha.price].filter(Boolean).join(' · '))}</p></div><div class="ficha-actions"><button data-ficha-action="view" data-id="${ficha.id}">Ver</button><button data-ficha-action="edit" data-id="${ficha.id}">Editar</button><button data-ficha-action="duplicate" data-id="${ficha.id}">Duplicar</button><button data-ficha-action="copy-link" data-id="${ficha.id}">Copiar link</button><button data-ficha-action="copy-text" data-id="${ficha.id}">Copiar WhatsApp</button><button data-ficha-action="share" data-id="${ficha.id}">Compartir</button><button data-ficha-action="print" data-id="${ficha.id}">PDF</button><button class="delete" data-delete="fichas" data-id="${ficha.id}">×</button></div></article>`).join('') || '<p class="empty-state">Todavía no hay fichas.</p>'}</div></section><section class="panel-card preview-panel"><h3>Vista previa para clientes</h3>${selected ? publicFichaHtml(publicPayload(selected)) : '<p class="empty-state">Elegí o creá una ficha.</p>'}</section></div>`;
  bindFichaForm();
}

function fillForm(ficha: Partial<Ficha> | ImportedPropertyData): void {
  const form = document.querySelector<HTMLFormElement>('#ficha-form');
  if (!form) return;
  Object.entries(ficha).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    const input = form.elements.namedItem(key);
    if (input instanceof HTMLInputElement && input.type === 'checkbox') {
      input.checked = value === 'soft' || value === true;
      return;
    }
    if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement || input instanceof HTMLSelectElement) input.value = Array.isArray(value) ? value.join('\n') : String(value);
  });
}

function providerLabel(provider: ImportPropertyResponse['provider']): string {
  return ({ mercadolibre: 'MercadoLibre', zonaprop: 'Zonaprop', 'ficha-info': 'ficha.info', tokko: 'Tokko', generic: 'Otro portal' })[provider];
}

function renderPhotoReview(form: HTMLFormElement): void {
  const textarea = form.elements.namedItem('photoUrls');
  const enhancement = form.elements.namedItem('photoEnhancement');
  const container = document.querySelector<HTMLElement>('#import-photos');
  if (!(textarea instanceof HTMLTextAreaElement) || !container) return;
  const enhanced = enhancement instanceof HTMLInputElement && enhancement.checked;
  const photos = normalizePhotos(textarea.value);
  container.innerHTML = photos.length ? `<div class="import-photo-heading"><strong>${photos.length} fotos encontradas</strong><span>Podés quitar las que no quieras usar. La mejora visual es opcional.</span></div><div class="import-photo-grid ${enhanced ? 'enhanced-preview' : ''}">${photos.map((url, index) => `<figure><img src="${escapeHtml(url)}" alt="Foto importada ${index + 1}" loading="lazy"><button type="button" data-remove-photo="${index}" aria-label="Quitar foto ${index + 1}">×</button></figure>`).join('')}</div>` : '';
  container.querySelectorAll<HTMLButtonElement>('[data-remove-photo]').forEach((button) => {
    button.addEventListener('click', () => {
      const index = Number(button.dataset.removePhoto);
      const current = normalizePhotos(textarea.value);
      current.splice(index, 1);
      textarea.value = current.join('\n');
      renderPhotoReview(form);
    });
  });
}

function setImportStatus(kind: 'loading' | 'success' | 'error', message: string, warnings: string[] = []): void {
  const status = document.querySelector<HTMLElement>('#import-status');
  if (!status) return;
  status.className = `import-status ${kind}`;
  status.replaceChildren();
  const main = document.createElement('strong');
  main.textContent = message;
  status.append(main);
  if (warnings.length) {
    const list = document.createElement('ul');
    for (const warning of warnings) { const item = document.createElement('li'); item.textContent = warning; list.append(item); }
    status.append(list);
  }
}

async function importPropertyFromLink(form: HTMLFormElement): Promise<void> {
  const urlInput = form.elements.namedItem('internalOriginalLink');
  const sourceInput = form.elements.namedItem('source');
  const button = document.querySelector<HTMLButtonElement>('#import-property');
  if (!(urlInput instanceof HTMLInputElement) || !(sourceInput instanceof HTMLInputElement) || !button) return;
  const url = urlInput.value.trim();
  if (!url) { setImportStatus('error', 'Pegá primero el enlace de la propiedad.'); return; }
  button.disabled = true;
  button.textContent = 'Creando ficha…';
  setImportStatus('loading', 'Estamos copiando los datos y buscando las fotos originales.');
  try {
    const response = await fetch('/api/import-property', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const payload = await response.json() as ImportPropertyResponse;
    if (!response.ok || !payload.success) throw new Error(payload.error || 'No pudimos importar automáticamente esta publicación.');
    fillForm(payload.data);
    urlInput.value = payload.sourceUrl;
    sourceInput.value = providerLabel(payload.provider);
    renderPhotoReview(form);
    setImportStatus('success', `Datos copiados desde ${providerLabel(payload.provider)} sin reescritura. Revisá la ficha y guardala.`, payload.warnings);
  } catch (error) {
    setImportStatus('error', error instanceof Error ? error.message : 'No pudimos importar automáticamente esta publicación. Podés completar los datos manualmente.');
  } finally {
    button.disabled = false;
    button.textContent = 'Crear ficha desde el link';
  }
}

function bindFichaForm(): void {
  const form = document.querySelector<HTMLFormElement>('#ficha-form');
  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    const ficha = createFicha(formValues(event.currentTarget as HTMLFormElement));
    const index = state.crm.fichas.findIndex((item) => item.id === ficha.id);
    if (index >= 0) state.crm.fichas[index] = ficha; else state.crm.fichas.push(ficha);
    state.selectedFichaId = ficha.id; state.editingFichaId = null; state.openForms.ficha = false; saveData();
    document.dispatchEvent(new CustomEvent('trv-render'));
  });
  document.querySelector<HTMLSelectElement>('[name="sourcePropertyId"]')?.addEventListener('change', (event) => {
    const property = state.crm.properties.find((item) => item.id === Number((event.currentTarget as HTMLSelectElement).value));
    if (property) fillForm(propertyToFicha(property));
  });
  document.querySelector<HTMLButtonElement>('#import-property')?.addEventListener('click', () => { if (form) void importPropertyFromLink(form); });
  if (form) {
    const photoTextarea = form.elements.namedItem('photoUrls');
    const enhancement = form.elements.namedItem('photoEnhancement');
    if (photoTextarea instanceof HTMLTextAreaElement) photoTextarea.addEventListener('change', () => renderPhotoReview(form));
    if (enhancement instanceof HTMLInputElement) enhancement.addEventListener('change', () => renderPhotoReview(form));
  }
}

export function handleFichaAction(action: string, id: number): void {
  const ficha = state.crm.fichas.find((item) => item.id === id);
  if (!ficha) return;
  if (action === 'view') state.selectedFichaId = id;
  if (action === 'edit') { state.selectedFichaId = id; state.editingFichaId = id; state.fichaMode = ficha.mode === 'external' ? 'external' : 'property'; state.openForms.ficha = true; }
  if (action === 'duplicate') { const copy = { ...ficha, id: nextId(state.crm.fichas), title: `${ficha.title} (copia)`, createdAt: new Date().toISOString() }; state.crm.fichas.push(copy); state.selectedFichaId = copy.id; saveData(); }
  if (action === 'copy-link') copyText(publicLink(ficha));
  if (action === 'copy-text') copyText(whatsappText(ficha));
  if (action === 'share') window.open(`https://wa.me/?text=${encodeURIComponent(whatsappText(ficha))}`, '_blank', 'noopener');
  if (action === 'print') state.selectedFichaId = id;
  document.dispatchEvent(new CustomEvent('trv-render'));
  if (action === 'edit') window.setTimeout(() => { fillForm(ficha); const form = document.querySelector<HTMLFormElement>('#ficha-form'); if (form) renderPhotoReview(form); }, 0);
  if (action === 'print') window.setTimeout(() => window.print(), 150);
}

export function setFichaMode(mode: FichaMode): void {
  state.fichaMode = mode === 'external' ? 'external' : 'property'; state.openForms.ficha = true;
  document.dispatchEvent(new CustomEvent('trv-render'));
}
