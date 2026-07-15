import type { Property } from './models.js';
import { propertyFichaLink, type PropertyWithFicha } from './property-ficha.js';
import { saveData, state } from './store.js';
import { escapeHtml, field, formValues, nextId } from './utils.js';

let searchText = '';
const priceFormatter = new Intl.NumberFormat('es-AR');

function normalized(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function textValue(property: PropertyWithFicha | null, key: keyof PropertyWithFicha): string {
  const current = property?.[key];
  return escapeHtml(current === undefined || current === null ? '' : String(current));
}

function photoValue(property: PropertyWithFicha | null): string {
  return escapeHtml((property?.photoUrls ?? []).join('\n'));
}

function option(value: string, label: string, current: string | undefined): string {
  return `<option value="${escapeHtml(value)}"${value === (current ?? '') ? ' selected' : ''}>${escapeHtml(label)}</option>`;
}

function propertyRows(): PropertyWithFicha[] {
  const query = normalized(searchText);
  const properties = (state.crm.properties as PropertyWithFicha[]);
  const filtered = query
    ? properties.filter((property) => [
      property.title,
      property.address,
      property.type,
      property.operation,
      property.owner,
      property.status,
      property.price,
      property.features,
      property.description,
    ].some((item) => normalized(item).includes(query)))
    : [...properties];

  return filtered.sort((left, right) => (
    left.status.localeCompare(right.status, 'es', { sensitivity: 'base' })
    || left.title.localeCompare(right.title, 'es', { sensitivity: 'base' })
  ));
}

function card(property: PropertyWithFicha): string {
  const details = [
    property.type,
    property.bedrooms ? `${property.bedrooms} dorm.` : '',
    property.bathrooms ? `${property.bathrooms} baños` : '',
    property.coveredMeters ? `${property.coveredMeters} m² cubiertos` : '',
  ].filter(Boolean).join(' · ');
  const photoCount = property.photoUrls?.length ?? 0;

  return `<article class="mvp-lead-card mvp-property-card">
    <div class="mvp-property-main">
      <div class="mvp-lead-name mvp-property-title">
        <h3>${escapeHtml(property.title)}</h3>
        <span>USD ${priceFormatter.format(property.price)}</span>
      </div>
      <p>${escapeHtml(property.address)}${details ? ` · ${escapeHtml(details)}` : ''}</p>
      <div class="mvp-property-meta">
        <span>${escapeHtml(property.operation)}</span>
        <span>${escapeHtml(property.status)}</span>
        <span>${photoCount ? `${photoCount} foto${photoCount === 1 ? '' : 's'}` : 'Sin fotos'}</span>
        <span class="mvp-property-internal">Interno: ${escapeHtml(property.owner || 'Sin propietario')}</span>
      </div>
    </div>
    <div class="mvp-lead-actions mvp-property-card-actions">
      <button type="button" class="mvp-property-share" data-share-property-ficha="${property.id}">Compartir ficha</button>
      <button type="button" class="secondary" data-open-property-ficha="${property.id}">Ver ficha</button>
      <button type="button" class="secondary" data-edit-property="${property.id}" aria-controls="mvp-property-form">Editar</button>
      <button type="button" class="delete" data-delete="properties" data-id="${property.id}" aria-label="Eliminar ${escapeHtml(property.title)}">×</button>
    </div>
  </article>`;
}

function focusPropertyForm(container: HTMLElement): void {
  window.requestAnimationFrame(() => {
    const form = container.querySelector<HTMLFormElement>('#mvp-property-form:not(.collapsed)');
    if (!form) return;
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    form.querySelector<HTMLInputElement>('input[name="title"]')?.focus({ preventScroll: true });
  });
}

function findProperty(id: number): PropertyWithFicha | null {
  return (state.crm.properties as PropertyWithFicha[]).find((property) => property.id === id) ?? null;
}

function showButtonFeedback(button: HTMLButtonElement, message: string): void {
  const original = button.textContent ?? '';
  button.textContent = message;
  button.disabled = true;
  window.setTimeout(() => {
    button.textContent = original;
    button.disabled = false;
  }, 1800);
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('No se pudo copiar el enlace.');
}

async function sharePropertyFicha(property: PropertyWithFicha, button: HTMLButtonElement): Promise<void> {
  const url = propertyFichaLink(property);
  try {
    if (navigator.share) {
      await navigator.share({
        title: property.title,
        text: `Te comparto esta propiedad de TRV Gestión Inmobiliaria: ${property.title}`,
        url,
      });
      return;
    }
    await copyText(url);
    showButtonFeedback(button, 'Enlace copiado');
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    window.alert(error instanceof Error ? error.message : 'No se pudo compartir la ficha.');
  }
}

function bindPropertyCardActions(container: HTMLElement): void {
  container.querySelectorAll<HTMLButtonElement>('[data-edit-property]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const propertyId = Number(button.dataset.editProperty);
      if (!propertyId || !findProperty(propertyId)) return;
      state.editingPropertyId = propertyId;
      state.openForms.property = true;
      renderMvpProperties(container);
      focusPropertyForm(container);
    });
  });

  container.querySelectorAll<HTMLButtonElement>('[data-open-property-ficha]').forEach((button) => {
    button.addEventListener('click', () => {
      const property = findProperty(Number(button.dataset.openPropertyFicha));
      if (!property) return;
      window.open(propertyFichaLink(property), '_blank', 'noopener,noreferrer');
    });
  });

  container.querySelectorAll<HTMLButtonElement>('[data-share-property-ficha]').forEach((button) => {
    button.addEventListener('click', () => {
      const property = findProperty(Number(button.dataset.sharePropertyFicha));
      if (!property) return;
      void sharePropertyFicha(property, button);
    });
  });
}

function updatePropertyResults(container: HTMLElement): void {
  const properties = propertyRows();
  const results = container.querySelector<HTMLElement>('#mvp-property-results');
  const count = container.querySelector<HTMLElement>('#mvp-property-count');
  if (results) results.innerHTML = properties.map(card).join('') || '<p class="empty-state">No hay propiedades para mostrar.</p>';
  if (count) count.textContent = `${properties.length} propiedades`;
  bindPropertyCardActions(container);
}

function optionalNumber(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function photoUrls(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
}

export function renderMvpProperties(container: HTMLElement): void {
  const editing = findProperty(state.editingPropertyId ?? 0);
  const properties = propertyRows();
  const types = ['Departamento', 'Casa', 'Dúplex', 'Terreno', 'Comercial'];
  const operations = ['Venta', 'Alquiler', 'Captación'];
  const statuses = ['Activa', 'Captación', 'Reservada', 'Cerrada'];

  container.innerHTML = `<div class="mvp-page-heading">
    <div><h1>Propiedades</h1><p>Inventario interno y fichas profesionales listas para compartir.</p></div>
    <button type="button" data-toggle="property-form">Nueva propiedad</button>
  </div>
  <div class="mvp-property-flow" aria-label="Flujo comercial">
    <strong>1. Cargá la propiedad</strong><span>→</span><strong>2. Revisá la ficha</strong><span>→</span><strong>3. Compartí el enlace</strong>
  </div>
  <form id="mvp-property-form" class="mvp-lead-form mvp-property-form ${state.openForms.property ? '' : 'collapsed'}">
    <div class="mvp-form-heading">
      <div><h2>${editing ? `Editar ${escapeHtml(editing.title)}` : 'Nueva propiedad'}</h2><p>Los datos comerciales se muestran en la ficha. Los datos internos nunca se comparten.</p></div>
      <button type="button" class="quiet-button" data-cancel-property-edit>Cerrar</button>
    </div>

    <div class="mvp-property-form-section"><strong>Información comercial</strong><span>Visible para el cliente</span></div>
    <label>Título comercial<input name="title" value="${textValue(editing, 'title')}" placeholder="Ej. Dúplex de 2 dormitorios en Docta" required></label>
    <label>Zona o ubicación aproximada<input name="address" value="${textValue(editing, 'address')}" placeholder="Ej. Docta Urbanización, Córdoba" required></label>
    <label>Tipo<select name="type">${types.map((item) => option(item, item, editing?.type)).join('')}</select></label>
    <label>Operación<select name="operation">${operations.map((item) => option(item, item, editing?.operation)).join('')}</select></label>
    <label>Precio USD<input name="price" type="number" min="0" value="${textValue(editing, 'price')}" required></label>
    <label>Estado<select name="status">${statuses.map((item) => option(item, item, editing?.status)).join('')}</select></label>
    <label>Dormitorios<input name="bedrooms" type="number" min="0" value="${textValue(editing, 'bedrooms')}"></label>
    <label>Baños<input name="bathrooms" type="number" min="0" value="${textValue(editing, 'bathrooms')}"></label>
    <label>Cochera<input name="garage" value="${textValue(editing, 'garage')}" placeholder="Ej. 1 cochera cubierta"></label>
    <label>Metros cubiertos<input name="coveredMeters" type="number" min="0" value="${textValue(editing, 'coveredMeters')}"></label>
    <label>Metros totales<input name="totalMeters" type="number" min="0" value="${textValue(editing, 'totalMeters')}"></label>
    <label>Antigüedad<input name="age" value="${textValue(editing, 'age')}" placeholder="Ej. A estrenar"></label>
    <label>Escritura<select name="deed">${['', 'Sí', 'No', 'En trámite', 'A confirmar'].map((item) => option(item, item || 'No informado', editing?.deed)).join('')}</select></label>
    <label>Apto crédito<select name="creditReady">${['', 'Sí', 'No', 'A confirmar'].map((item) => option(item, item || 'No informado', editing?.creditReady)).join('')}</select></label>
    <label>Forma de pago<input name="paymentMethod" value="${textValue(editing, 'paymentMethod')}" placeholder="Contado, crédito, financiación..."></label>
    <label class="mvp-property-wide">Características<textarea name="features" placeholder="Balcón, cochera, pileta, patio, seguridad...">${textValue(editing, 'features')}</textarea></label>
    <label class="mvp-property-wide">Descripción comercial<textarea name="description" placeholder="Descripción clara y breve para presentar la propiedad al cliente.">${textValue(editing, 'description')}</textarea></label>
    <label class="mvp-property-wide">Fotos para la ficha<textarea name="photoUrls" placeholder="Pegá hasta 8 enlaces de fotos, uno por línea.">${photoValue(editing)}</textarea><small>Se mostrarán en el mismo orden. La primera será la foto principal.</small></label>

    <div class="mvp-property-form-section mvp-property-form-section-internal"><strong>Información interna</strong><span>No aparece en la ficha del cliente</span></div>
    <label>Propietario o colega<input name="owner" value="${textValue(editing, 'owner')}" required></label>
    <label class="mvp-property-wide">Notas internas<textarea name="notes" placeholder="Datos privados, comisión, condiciones o información del colega.">${textValue(editing, 'notes')}</textarea></label>

    <div data-property-error class="form-error" hidden></div>
    <button type="submit">${editing ? 'Guardar cambios' : 'Guardar propiedad'}</button>
  </form>
  <div class="mvp-lead-toolbar">
    <label><span>Buscar</span><input id="mvp-property-search" type="search" value="${escapeHtml(searchText)}" placeholder="Nombre, zona, tipo, propietario o precio"></label>
    <strong id="mvp-property-count">${properties.length} propiedades</strong>
  </div>
  <div id="mvp-property-results" class="mvp-lead-list">${properties.map(card).join('') || '<p class="empty-state">No hay propiedades para mostrar.</p>'}</div>`;

  container.querySelector<HTMLInputElement>('#mvp-property-search')?.addEventListener('input', (event) => {
    searchText = (event.currentTarget as HTMLInputElement).value;
    updatePropertyResults(container);
  });

  bindPropertyCardActions(container);

  container.querySelector<HTMLButtonElement>('[data-cancel-property-edit]')?.addEventListener('click', () => {
    state.editingPropertyId = null;
    state.openForms.property = false;
    renderMvpProperties(container);
  });

  container.querySelector<HTMLFormElement>('#mvp-property-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const values = formValues(form);
    const price = Number(field(values, 'price'));
    const error = form.querySelector<HTMLElement>('[data-property-error]');
    if (!Number.isFinite(price) || price < 0) {
      if (error) {
        error.textContent = 'Ingresá un precio válido.';
        error.hidden = false;
      }
      return;
    }

    const property: PropertyWithFicha = {
      ...(editing || {}),
      id: editing?.id ?? nextId(state.crm.properties),
      title: field(values, 'title').trim(),
      address: field(values, 'address').trim(),
      type: field(values, 'type'),
      operation: field(values, 'operation'),
      price,
      owner: field(values, 'owner').trim(),
      status: field(values, 'status'),
      bedrooms: optionalNumber(field(values, 'bedrooms')),
      bathrooms: optionalNumber(field(values, 'bathrooms')),
      garage: field(values, 'garage').trim(),
      coveredMeters: optionalNumber(field(values, 'coveredMeters')),
      totalMeters: optionalNumber(field(values, 'totalMeters')),
      age: field(values, 'age').trim(),
      deed: field(values, 'deed'),
      creditReady: field(values, 'creditReady'),
      paymentMethod: field(values, 'paymentMethod').trim(),
      features: field(values, 'features').trim(),
      description: field(values, 'description').trim(),
      photoUrls: photoUrls(field(values, 'photoUrls')),
      notes: field(values, 'notes').trim(),
      assignedToId: editing?.assignedToId ?? state.activeMemberId,
      createdById: editing?.createdById ?? state.activeMemberId,
    };

    if (editing) {
      const index = state.crm.properties.findIndex((item) => item.id === editing.id);
      if (index >= 0) state.crm.properties[index] = property as Property;
    } else {
      state.crm.properties.push(property as Property);
    }

    state.editingPropertyId = null;
    state.openForms.property = false;
    saveData(editing ? 'Propiedad editada' : 'Propiedad creada');
    document.dispatchEvent(new CustomEvent('trv-render'));
  });
}
