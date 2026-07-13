import { saveData, state } from './store.js';
import { escapeHtml, field, formValues, nextId, safePhotoUrl } from './utils.js';

function contactOptions(selectedId: number | undefined): string {
  const options = state.crm.contacts
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name, 'es'))
    .map((contact) => `<option value="${contact.id}"${contact.id === selectedId ? ' selected' : ''}>${escapeHtml(contact.name)}${contact.company ? ` · ${escapeHtml(contact.company)}` : ''}</option>`)
    .join('');
  return `<option value="">Sin contacto vinculado</option>${options}`;
}

function propertySourceEditor(propertyId: number): string {
  const property = state.crm.properties.find((item) => item.id === propertyId);
  if (!property) return '';
  const contact = state.crm.contacts.find((item) => item.id === property.sourceContactId);
  const summary = contact ? `Compartida por ${contact.name}` : 'Sin origen vinculado';
  return `<details class="property-source-editor">
    <summary><span>${escapeHtml(summary)}</span><small>Organizar origen</small></summary>
    <div class="property-source-editor-body">
      <label><span>Contacto</span><select data-property-source-contact>${contactOptions(property.sourceContactId)}</select></label>
      <label><span>Fecha compartida</span><input data-property-source-date type="date" value="${escapeHtml(property.sharedAt || '')}"></label>
      <label class="property-source-link-field"><span>Enlace original</span><input data-property-source-link type="url" placeholder="Link del mensaje o publicación" value="${escapeHtml(property.sourceLink || '')}"></label>
      <div class="property-source-actions">
        ${contact ? `<button type="button" class="secondary" data-open-contact="${contact.id}">Abrir contacto</button>` : ''}
        ${property.sourceLink ? `<a href="${escapeHtml(property.sourceLink)}" target="_blank" rel="noreferrer">Abrir fuente</a>` : ''}
        <button type="button" data-save-property-source="${property.id}">Guardar origen</button>
      </div>
    </div>
  </details>`;
}

function appendSourceFields(form: HTMLFormElement): void {
  if (form.querySelector('[data-new-property-source]')) return;
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!submit) return;
  const wrapper = document.createElement('div');
  wrapper.className = 'property-source-new';
  wrapper.dataset.newPropertySource = 'true';
  wrapper.innerHTML = `<div class="form-heading"><div><span class="eyebrow">Origen comercial</span><h4>Quién compartió el producto</h4></div><span>Opcional, pero clave para encontrarlo después.</span></div>
    <select name="sourceContactId" aria-label="Contacto que compartió la propiedad">${contactOptions(undefined)}</select>
    <input name="sharedAt" aria-label="Fecha compartida" type="date">
    <input name="sourceLink" aria-label="Enlace original" type="url" placeholder="Link del mensaje o publicación original">`;
  submit.before(wrapper);

  form.addEventListener('submit', () => {
    const values = formValues(form);
    const expectedId = nextId(state.crm.properties);
    const sourceContactId = Number(field(values, 'sourceContactId')) || undefined;
    const sharedAt = field(values, 'sharedAt') || undefined;
    const rawSourceLink = field(values, 'sourceLink');
    const sourceLink = rawSourceLink ? safePhotoUrl(rawSourceLink) ?? undefined : undefined;
    queueMicrotask(() => {
      const property = state.crm.properties.find((item) => item.id === expectedId);
      if (!property) return;
      property.sourceContactId = sourceContactId;
      property.sharedAt = sharedAt;
      property.sourceLink = sourceLink;
      saveData();
      document.dispatchEvent(new CustomEvent('trv-render'));
    });
  }, { capture: true });
}

function decoratePropertyCards(container: HTMLElement): void {
  const cards = Array.from(container.querySelectorAll<HTMLElement>('.property-card'));
  cards.forEach((card, index) => {
    if (card.querySelector('.property-source-editor')) return;
    const property = state.crm.properties[index];
    const main = card.querySelector<HTMLElement>('.property-card-main');
    if (!property || !main) return;
    main.insertAdjacentHTML('beforeend', propertySourceEditor(property.id));
  });
}

function bindSourceActions(container: HTMLElement): void {
  container.querySelectorAll<HTMLButtonElement>('[data-save-property-source]').forEach((button) => {
    button.addEventListener('click', () => {
      const propertyId = Number(button.dataset.savePropertySource);
      const property = state.crm.properties.find((item) => item.id === propertyId);
      const editor = button.closest<HTMLElement>('.property-source-editor');
      if (!property || !editor) return;
      property.sourceContactId = Number(editor.querySelector<HTMLSelectElement>('[data-property-source-contact]')?.value) || undefined;
      property.sharedAt = editor.querySelector<HTMLInputElement>('[data-property-source-date]')?.value || undefined;
      const rawSourceLink = editor.querySelector<HTMLInputElement>('[data-property-source-link]')?.value.trim() || '';
      property.sourceLink = rawSourceLink ? safePhotoUrl(rawSourceLink) ?? undefined : undefined;
      saveData();
      document.dispatchEvent(new CustomEvent('trv-render'));
    });
  });
}

export function enhancePropertyNetwork(container: HTMLElement | null): void {
  if (!container) return;
  const form = container.querySelector<HTMLFormElement>('#property-form');
  if (form) appendSourceFields(form);
  decoratePropertyCards(container);
  bindSourceActions(container);
}
