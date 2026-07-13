import {
  defaultCommercialNetworkFilters,
  filterCommercialContacts,
  findDuplicateCommercialContact,
  linkedPropertiesForContact,
  type CommercialNetworkFilters,
} from './commercial-network.js';
import type { CommercialContact, CommercialContactType } from './models.js';
import { formatPhone, isPlausiblePhone, normalizePhone } from './phone-normalizer.js';
import { enhancePropertyNetwork } from './property-network-ui.js';
import { saveData, state } from './store.js';
import { escapeHtml, field, formValues, nextId } from './utils.js';

const contactTypes: CommercialContactType[] = ['Colega / Inmobiliaria', 'Constructor / Desarrollista', 'Propietario'];
const dateFormatter = new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
let networkFilters = defaultCommercialNetworkFilters();

function selectedOption(value: string, current: string | undefined): string {
  return `<option${value === current ? ' selected' : ''}>${escapeHtml(value)}</option>`;
}

function contactValue(contact: CommercialContact | null, key: keyof CommercialContact): string {
  return escapeHtml(contact?.[key] ?? '');
}

function formattedDate(value: string | undefined): string {
  return value ? dateFormatter.format(new Date(`${value}T00:00:00Z`)) : 'Sin fecha';
}

function linkedPropertyHtml(contact: CommercialContact): string {
  const linked = linkedPropertiesForContact(contact.id, state.crm.properties);
  if (!linked.length) return '<p class="network-empty">Todavía no hay propiedades vinculadas a este contacto.</p>';

  return `<div class="network-property-list">${linked.map((property) => `<article>
    <div><strong>${escapeHtml(property.title)}</strong><span>${escapeHtml(property.address)} · USD ${new Intl.NumberFormat('es-AR').format(property.price)}</span></div>
    ${property.sourceLink ? `<a href="${escapeHtml(property.sourceLink)}" target="_blank" rel="noreferrer">Abrir fuente</a>` : ''}
  </article>`).join('')}</div>`;
}

function contactDetailsHtml(contact: CommercialContact): string {
  const whatsapp = normalizePhone(contact.phone);
  return `<section class="network-detail" aria-label="Detalle de ${escapeHtml(contact.name)}">
    <div class="network-detail-head">
      <div><span class="eyebrow">Ficha comercial</span><h3>${escapeHtml(contact.name)}</h3><p>${escapeHtml(contact.company || contact.type)}</p></div>
      <div class="network-detail-actions">
        <a class="button-link" href="https://wa.me/${escapeHtml(whatsapp)}" target="_blank" rel="noreferrer">Abrir WhatsApp</a>
        <button type="button" class="secondary" data-edit-contact="${contact.id}">Editar</button>
      </div>
    </div>
    <div class="network-detail-grid">
      <div><span>Tipo</span><strong>${escapeHtml(contact.type)}</strong></div>
      <div><span>Teléfono</span><strong>${escapeHtml(formatPhone(contact.phone))}</strong></div>
      <div><span>Email</span><strong>${escapeHtml(contact.email || 'Sin email')}</strong></div>
      <div><span>Último contacto</span><strong>${escapeHtml(formattedDate(contact.lastContact))}</strong></div>
      <div><span>Zonas</span><strong>${escapeHtml(contact.zones || 'Sin zonas')}</strong></div>
      <div><span>Etiquetas</span><strong>${escapeHtml(contact.tags || 'Sin etiquetas')}</strong></div>
    </div>
    ${contact.notes ? `<p class="network-notes">${escapeHtml(contact.notes)}</p>` : ''}
    <div class="network-linked-heading"><div><span class="eyebrow">Productos vinculados</span><h4>Propiedades compartidas</h4></div><strong>${linkedPropertiesForContact(contact.id, state.crm.properties).length}</strong></div>
    ${linkedPropertyHtml(contact)}
  </section>`;
}

function contactCardHtml(contact: CommercialContact): string {
  const linked = linkedPropertiesForContact(contact.id, state.crm.properties);
  const selected = contact.id === state.selectedContactId;
  return `<article class="network-card ${selected ? 'selected' : ''}">
    <div>
      <span class="network-type">${escapeHtml(contact.type)}</span>
      <h3>${escapeHtml(contact.name)}</h3>
      <p>${escapeHtml(contact.company || 'Contacto independiente')}</p>
      <small>${escapeHtml(formatPhone(contact.phone))} · ${linked.length} ${linked.length === 1 ? 'propiedad' : 'propiedades'}</small>
      ${contact.zones ? `<span class="network-zones">${escapeHtml(contact.zones)}</span>` : ''}
    </div>
    <div class="record-actions">
      <button type="button" class="secondary" data-open-contact="${contact.id}">${selected ? 'Ficha abierta' : 'Ver ficha'}</button>
      <button type="button" class="secondary" data-edit-contact="${contact.id}">Editar</button>
      <button type="button" class="delete" data-delete="contacts" data-id="${contact.id}" aria-label="Eliminar ${escapeHtml(contact.name)}">×</button>
    </div>
  </article>`;
}

function readFilters(form: HTMLFormElement): CommercialNetworkFilters {
  const values = formValues(form);
  return {
    query: field(values, 'query'),
    type: field(values, 'type') as CommercialNetworkFilters['type'],
  };
}

function updateResults(container: HTMLElement): void {
  const contacts = filterCommercialContacts(state.crm.contacts, state.crm.properties, networkFilters);
  const results = container.querySelector<HTMLElement>('#network-results');
  const count = container.querySelector<HTMLElement>('#network-result-count');
  if (results) results.innerHTML = contacts.map(contactCardHtml).join('') || '<p class="empty-state">No encontramos contactos con esos filtros.</p>';
  if (count) count.textContent = `${contacts.length} de ${state.crm.contacts.length} contactos`;
}

function showFormError(form: HTMLFormElement, message: string): void {
  const error = form.querySelector<HTMLElement>('#contact-form-error');
  if (!error) return;
  error.hidden = false;
  error.textContent = message;
}

export function renderCommercialNetwork(container: HTMLElement): void {
  enhancePropertyNetwork(document.querySelector<HTMLElement>('#propiedades'));
  const editing = state.crm.contacts.find((contact) => contact.id === state.editingContactId) ?? null;
  if (state.editingContactId !== null && !editing) state.editingContactId = null;
  const visibleContacts = filterCommercialContacts(state.crm.contacts, state.crm.properties, networkFilters);
  const selected = state.crm.contacts.find((contact) => contact.id === state.selectedContactId) ?? null;

  container.innerHTML = `<div class="panel-heading"><div><span class="eyebrow">Contactos y productos</span><h2>Red comercial</h2><p>Encontrá en segundos quién te compartió cada propiedad.</p></div><button type="button" data-toggle="contact-form">Nuevo contacto</button></div>
  <form id="contact-form" class="data-form ${state.openForms.contact ? '' : 'collapsed'}">
    <div class="form-heading"><div><span class="eyebrow">${editing ? 'Edición' : 'Alta'}</span><h3>${editing ? `Editar ${escapeHtml(editing.name)}` : 'Nuevo contacto comercial'}</h3></div><span>Usá un solo registro por persona o empresa.</span></div>
    <select name="type" aria-label="Tipo de contacto">${contactTypes.map((type) => selectedOption(type, editing?.type ?? contactTypes[0])).join('')}</select>
    <input name="name" aria-label="Nombre" placeholder="Nombre y apellido" value="${contactValue(editing, 'name')}" required>
    <input name="company" aria-label="Empresa o inmobiliaria" placeholder="Empresa o inmobiliaria" value="${contactValue(editing, 'company')}">
    <input name="phone" aria-label="WhatsApp" inputmode="tel" autocomplete="tel" placeholder="WhatsApp" value="${contactValue(editing, 'phone')}" required>
    <input name="email" aria-label="Email" type="email" placeholder="Email" value="${contactValue(editing, 'email')}">
    <input name="zones" aria-label="Zonas" placeholder="Zonas: Docta, General Paz, Zona Norte..." value="${contactValue(editing, 'zones')}">
    <input name="tags" aria-label="Etiquetas" placeholder="Etiquetas: departamentos, pozo, comparte comisión..." value="${contactValue(editing, 'tags')}">
    <input name="lastContact" aria-label="Último contacto" type="date" value="${contactValue(editing, 'lastContact')}">
    <textarea name="notes" aria-label="Notas" placeholder="Cómo trabaja, comisión, condiciones, observaciones...">${contactValue(editing, 'notes')}</textarea>
    <div id="contact-form-error" class="form-error" role="alert" hidden></div>
    <div class="form-actions"><button type="submit">${editing ? 'Guardar cambios' : 'Guardar contacto'}</button>${editing ? '<button type="button" class="secondary" data-cancel-contact-edit>Cancelar</button>' : ''}</div>
  </form>
  <form id="network-filters" class="client-filter-bar" aria-label="Buscar red comercial">
    <label class="client-search"><span>Buscar</span><input name="query" type="search" autocomplete="off" placeholder="Nombre, inmobiliaria, teléfono o propiedad..." value="${escapeHtml(networkFilters.query)}"></label>
    <label><span>Tipo</span><select name="type">${['Todos', ...contactTypes].map((type) => selectedOption(type, networkFilters.type)).join('')}</select></label>
    <button type="button" class="secondary" data-clear-network-filters>Limpiar</button>
  </form>
  <div class="client-list-meta"><strong id="network-result-count">${visibleContacts.length} de ${state.crm.contacts.length} contactos</strong><span>También busca dentro de las propiedades vinculadas.</span></div>
  <div id="network-results" class="network-list">${visibleContacts.map(contactCardHtml).join('') || '<p class="empty-state">No hay contactos cargados.</p>'}</div>
  ${selected ? contactDetailsHtml(selected) : '<div class="network-guide"><strong>Cómo usarlo</strong><p>Cargá al colega, constructor o propietario. Después, al crear una propiedad, elegí quién te la compartió.</p></div>'}`;

  const filterForm = container.querySelector<HTMLFormElement>('#network-filters');
  filterForm?.addEventListener('input', () => {
    networkFilters = readFilters(filterForm);
    updateResults(container);
  });
  filterForm?.addEventListener('change', () => {
    networkFilters = readFilters(filterForm);
    updateResults(container);
  });
  filterForm?.querySelector<HTMLElement>('[data-clear-network-filters]')?.addEventListener('click', () => {
    networkFilters = defaultCommercialNetworkFilters();
    filterForm.reset();
    updateResults(container);
  });

  container.querySelector<HTMLFormElement>('#contact-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const values = formValues(form);
    const phone = field(values, 'phone');
    if (!isPlausiblePhone(phone)) {
      showFormError(form, 'Ingresá un teléfono válido de entre 8 y 15 dígitos.');
      return;
    }
    const duplicate = findDuplicateCommercialContact(state.crm.contacts, phone, editing?.id ?? null);
    if (duplicate) {
      showFormError(form, `Ese teléfono ya pertenece a ${duplicate.name}.`);
      return;
    }

    const contact: CommercialContact = {
      id: editing?.id ?? nextId(state.crm.contacts),
      type: field(values, 'type') as CommercialContactType,
      name: field(values, 'name'),
      company: field(values, 'company'),
      phone: normalizePhone(phone),
      email: field(values, 'email'),
      zones: field(values, 'zones'),
      tags: field(values, 'tags'),
      lastContact: field(values, 'lastContact'),
      notes: field(values, 'notes'),
      createdAt: editing?.createdAt ?? new Date().toISOString(),
    };

    state.crm.contacts = editing
      ? state.crm.contacts.map((item) => item.id === editing.id ? contact : item)
      : [...state.crm.contacts, contact];
    state.selectedContactId = contact.id;
    state.editingContactId = null;
    state.openForms.contact = false;
    saveData();
    document.dispatchEvent(new CustomEvent('trv-render'));
  });
}
