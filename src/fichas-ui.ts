import { Ficha, FichaMode, Property } from './models.js';
import { publicFichaHtml, publicLink, publicPayload, whatsappText } from './public-ficha.js';
import { saveData, state } from './store.js';
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
  return value.split('\n').map((item) => item.trim()).map(safePhotoUrl).filter((url): url is string => Boolean(url));
}

function createFicha(values: Record<string, string>): Ficha {
  const selectedProperty = state.crm.properties.find((property) => property.id === Number(field(values, 'sourcePropertyId')));
  const base = selectedProperty ? propertyToFicha(selectedProperty) : {};
  const current = state.editingFichaId ? state.crm.fichas.find((item) => item.id === state.editingFichaId) : undefined;
  return {
    id: state.editingFichaId ?? nextId(state.crm.fichas),
    mode: state.fichaMode,
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
    sourcePropertyId: field(values, 'sourcePropertyId') ? Number(field(values, 'sourcePropertyId')) : undefined,
    internalOriginalLink: field(values, 'internalOriginalLink'), source: field(values, 'source'), internalNotes: field(values, 'internalNotes'),
    createdAt: current?.createdAt || new Date().toISOString(),
  };
}

function formHtml(): string {
  const options = state.crm.properties.map((property) => `<option value="${property.id}">${escapeHtml(property.title)}</option>`).join('');
  return `<form id="ficha-form" class="data-form ficha-form ${state.openForms.ficha ? '' : 'collapsed'}" data-mode="${state.fichaMode}">
    <select name="sourcePropertyId" class="property-source"><option value="">Elegir propiedad</option>${options}</select>
    <input name="title" placeholder="Título" required><input name="propertyType" placeholder="Tipo de propiedad"><select name="operation"><option>Venta</option><option>Captación</option></select><input name="zone" placeholder="Zona"><input name="approxAddress" placeholder="Dirección aproximada">
    <input name="price" placeholder="Precio"><input name="expenses" placeholder="Expensas"><input name="bedrooms" placeholder="Dormitorios"><input name="bathrooms" placeholder="Baños"><select name="garage"><option value="">Cochera</option><option>Sí</option><option>No</option></select>
    <input name="coveredMeters" placeholder="Metros cubiertos"><input name="totalMeters" placeholder="Metros totales"><input name="age" placeholder="Antigüedad"><input name="status" placeholder="Estado"><input name="amenities" placeholder="Amenities">
    <textarea name="description" placeholder="Descripción comercial"></textarea><input name="deed" placeholder="Escritura"><input name="creditReady" placeholder="Apto crédito"><input name="paymentMethod" placeholder="Forma de pago"><textarea name="photoUrls" placeholder="URLs de fotos, una por línea"></textarea>
    <input name="internalOriginalLink" class="external-only" placeholder="Link original interno"><input name="source" class="external-only" placeholder="Fuente: Zonaprop, Tokko, colega"><textarea name="internalNotes" placeholder="Observaciones internas"></textarea>
    <button type="submit">Guardar ficha TRV</button>
  </form>`;
}

export function renderFichas(container: HTMLElement): void {
  const selected = state.crm.fichas.find((item) => item.id === state.selectedFichaId) || state.crm.fichas[0] || null;
  if (selected && state.selectedFichaId === null) state.selectedFichaId = selected.id;
  container.innerHTML = `<div class="panel-heading"><div><span class="eyebrow">Fichas TRV</span><h2>Generador comercial</h2></div><button data-toggle="ficha-form">Nueva ficha</button></div>
    <div class="mode-tabs"><button data-mode="manual" class="${state.fichaMode === 'manual' ? 'active' : ''}">Carga manual</button><button data-mode="property" class="${state.fichaMode === 'property' ? 'active' : ''}">Desde propiedad</button><button data-mode="external" class="${state.fichaMode === 'external' ? 'active' : ''}">Colega / portal</button></div>
    ${formHtml()}
    <div class="fichas-layout"><section class="panel-card"><h3>Fichas guardadas</h3><div class="ficha-list">${state.crm.fichas.map((ficha) => `<article class="ficha-list-card ${selected?.id === ficha.id ? 'active' : ''}"><div><h4>${escapeHtml(ficha.title)}</h4><p>${escapeHtml([ficha.zone, ficha.price].filter(Boolean).join(' · '))}</p></div><div class="ficha-actions"><button data-ficha-action="view" data-id="${ficha.id}">Ver</button><button data-ficha-action="edit" data-id="${ficha.id}">Editar</button><button data-ficha-action="duplicate" data-id="${ficha.id}">Duplicar</button><button data-ficha-action="copy-link" data-id="${ficha.id}">Copiar link</button><button data-ficha-action="copy-text" data-id="${ficha.id}">Copiar WhatsApp</button><button data-ficha-action="share" data-id="${ficha.id}">Compartir</button><button data-ficha-action="print" data-id="${ficha.id}">PDF</button><button class="delete" data-delete="fichas" data-id="${ficha.id}">×</button></div></article>`).join('') || '<p class="empty-state">Todavía no hay fichas.</p>'}</div></section><section class="panel-card preview-panel"><h3>Vista previa para clientes</h3>${selected ? publicFichaHtml(publicPayload(selected)) : '<p class="empty-state">Elegí o creá una ficha.</p>'}</section></div>`;
  bindFichaForm();
}

function fillForm(ficha: Partial<Ficha>): void {
  const form = document.querySelector<HTMLFormElement>('#ficha-form');
  if (!form) return;
  Object.entries(ficha).forEach(([key, value]) => {
    const input = form.elements.namedItem(key);
    if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement || input instanceof HTMLSelectElement) input.value = Array.isArray(value) ? value.join('\n') : String(value ?? '');
  });
}

function bindFichaForm(): void {
  document.querySelector<HTMLFormElement>('#ficha-form')?.addEventListener('submit', (event) => {
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
}

export function handleFichaAction(action: string, id: number): void {
  const ficha = state.crm.fichas.find((item) => item.id === id);
  if (!ficha) return;
  if (action === 'view') state.selectedFichaId = id;
  if (action === 'edit') { state.selectedFichaId = id; state.editingFichaId = id; state.fichaMode = ficha.mode; state.openForms.ficha = true; }
  if (action === 'duplicate') { const copy = { ...ficha, id: nextId(state.crm.fichas), title: `${ficha.title} (copia)`, createdAt: new Date().toISOString() }; state.crm.fichas.push(copy); state.selectedFichaId = copy.id; saveData(); }
  if (action === 'copy-link') copyText(publicLink(ficha));
  if (action === 'copy-text') copyText(whatsappText(ficha));
  if (action === 'share') window.open(`https://wa.me/?text=${encodeURIComponent(whatsappText(ficha))}`, '_blank', 'noopener');
  document.dispatchEvent(new CustomEvent('trv-render'));
  if (action === 'edit') window.setTimeout(() => fillForm(ficha), 0);
  if (action === 'print') window.setTimeout(() => window.print(), 150);
}

export function setFichaMode(mode: FichaMode): void {
  state.fichaMode = mode; state.openForms.ficha = true;
  document.dispatchEvent(new CustomEvent('trv-render'));
}
