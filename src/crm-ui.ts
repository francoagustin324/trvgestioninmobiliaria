import { todayIsoDate } from './agenda.js';
import {
  clientCompletenessScore,
  findHistoricalDuplicateGroups,
  hasClientMergeBackup,
  mergeDuplicateClients,
  recommendedPrimaryClient,
  restoreClientMergeBackup,
  saveClientMergeBackup,
  type DuplicateClientGroup,
} from './client-duplicates.js';
import { clientFromFormValues, upsertClient } from './client-editor.js';
import { defaultClientListFilters, filterAndSortClients, type ClientListFilters } from './client-list.js';
import { Client, Temperature } from './models.js';
import { findDuplicateClient, formatPhone, isPlausiblePhone } from './phone-normalizer.js';
import { saveData, state } from './store.js';
import { escapeHtml, field, formValues, nextId } from './utils.js';

const pipelines = ['Nuevo', 'Contactado', 'Calificado', 'Visita posible', 'Negociación', 'Cerrado', 'Perdido'];
let clientListFilters = defaultClientListFilters();

const crmDateFormatter = new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

function trafficLight(client: Client): { color: string; label: string; next: string } {
  const ready = client.temperature === 'Caliente' && client.budget && client.paymentMethod && client.purchaseTimeframe && client.canMoveForward === 'Sí';
  if (ready) return { color: 'verde', label: 'Caliente', next: client.pipeline === 'Visita posible' ? 'Este cliente parece apto para visita. Revisar y aprobar.' : 'Contactar hoy y avanzar.' };
  if (client.temperature === 'Frío' || client.canMoveForward === 'No') return { color: 'rojo', label: 'Frío', next: 'Completar calificación antes de ofrecer visita.' };
  return { color: 'amarillo', label: 'Tibio', next: 'Hacer seguimiento y completar datos faltantes.' };
}

function selectedOption(value: string, current: string | undefined): string {
  return `<option${value === current ? ' selected' : ''}>${escapeHtml(value)}</option>`;
}

function clientValue(client: Client | null, key: keyof Client): string {
  return escapeHtml(client?.[key] ?? '');
}

function showClientFormError(form: HTMLFormElement, message: string, duplicateId: number | null = null): void {
  const error = form.querySelector<HTMLElement>('#client-form-error');
  if (!error) return;
  error.hidden = false;
  error.innerHTML = duplicateId === null
    ? `<span>${escapeHtml(message)}</span>`
    : `<span>${escapeHtml(message)}</span><button type="button" class="secondary" data-edit-client="${duplicateId}">Abrir cliente existente</button>`;
}

function formattedCrmDate(value: string): string {
  return crmDateFormatter.format(new Date(`${value}T00:00:00Z`));
}

function followUpLabel(client: Client): string {
  if (!client.nextFollowUp) return 'Sin próximo seguimiento';
  const today = todayIsoDate();
  const prefix = client.nextFollowUp < today ? 'Vencido' : client.nextFollowUp === today ? 'Para hoy' : 'Próximo';
  return `${prefix}: ${formattedCrmDate(client.nextFollowUp)}`;
}

function clientCard(client: Client): string {
  const status = trafficLight(client);
  return `<article class="crm-card ${status.color}">
    <div>
      <div class="card-title"><h3>${escapeHtml(client.name)}</h3><span class="traffic ${status.color}">${escapeHtml(status.label)}</span><span class="pipeline-chip">${escapeHtml(client.pipeline)}</span></div>
      <p>${escapeHtml(client.interest)}</p>
      <small>${escapeHtml(formatPhone(client.phone))} · ${escapeHtml(client.budget || 'Sin presupuesto')}</small>
      <span class="follow-up-chip">${escapeHtml(followUpLabel(client))}</span>
      <strong class="next-step">${escapeHtml(status.next)}</strong>
    </div>
    <div class="record-actions"><button type="button" class="secondary edit-button" data-edit-client="${client.id}" aria-label="Editar ${escapeHtml(client.name)}">Editar</button><button type="button" class="delete" data-delete="clients" data-id="${client.id}" aria-label="Eliminar ${escapeHtml(client.name)}">×</button></div>
  </article>`;
}

function filteredClients(): Client[] {
  return filterAndSortClients(state.crm.clients, clientListFilters, todayIsoDate());
}

function clientResultsHtml(clients: Client[]): string {
  if (!clients.length) return '<p class="empty-state">No encontramos clientes con esos filtros.</p>';
  return clients.map(clientCard).join('');
}

function updateClientResults(container: HTMLElement): void {
  const clients = filteredClients();
  const results = container.querySelector<HTMLElement>('#client-results');
  const count = container.querySelector<HTMLElement>('#client-result-count');
  if (results) results.innerHTML = clientResultsHtml(clients);
  if (count) count.textContent = `${clients.length} de ${state.crm.clients.length} clientes`;
}

function readClientFilters(form: HTMLFormElement): ClientListFilters {
  const values = formValues(form);
  return {
    query: field(values, 'query'),
    temperature: field(values, 'temperature') as ClientListFilters['temperature'],
    pipeline: field(values, 'pipeline'),
    followUp: field(values, 'followUp') as ClientListFilters['followUp'],
    sort: field(values, 'sort') as ClientListFilters['sort'],
  };
}

function bindClientFilters(container: HTMLElement): void {
  const form = container.querySelector<HTMLFormElement>('#client-filters');
  if (!form) return;
  const applyFilters = (): void => {
    clientListFilters = readClientFilters(form);
    updateClientResults(container);
  };
  form.addEventListener('input', applyFilters);
  form.addEventListener('change', applyFilters);
  form.querySelector<HTMLElement>('[data-clear-client-filters]')?.addEventListener('click', () => {
    clientListFilters = defaultClientListFilters();
    form.reset();
    updateClientResults(container);
    form.querySelector<HTMLInputElement>('[name="query"]')?.focus();
  });
}

function duplicateClientRow(client: Client, recommendedId: number): string {
  const recommended = client.id === recommendedId;
  const contact = client.lastContact ? `Último contacto ${formattedCrmDate(client.lastContact)}` : 'Sin fecha de contacto';
  return `<article class="duplicate-client-row ${recommended ? 'recommended' : ''}">
    <div>
      <div class="duplicate-client-title"><strong>${escapeHtml(client.name)}</strong>${recommended ? '<span>Recomendado</span>' : ''}</div>
      <p>${escapeHtml(formatPhone(client.phone))} · ${escapeHtml(client.pipeline)} · ${escapeHtml(client.temperature)}</p>
      <small>${escapeHtml(contact)} · ${clientCompletenessScore(client)} campos completos</small>
    </div>
    <button type="button" class="secondary" data-merge-client-primary="${client.id}">Conservar este y fusionar</button>
  </article>`;
}

function duplicateGroupHtml(group: DuplicateClientGroup): string {
  const recommended = recommendedPrimaryClient(group);
  return `<article class="duplicate-group">
    <div class="duplicate-group-heading">
      <div><span class="eyebrow">Mismo teléfono</span><h4>${escapeHtml(formatPhone(group.clients[0]?.phone ?? group.identity))}</h4></div>
      <strong>${group.clients.length} registros</strong>
    </div>
    <p class="duplicate-explanation">Elegí cuál conservar. PropControl completará campos vacíos, mantendrá el seguimiento más urgente y guardará los datos de los otros registros dentro de las observaciones.</p>
    <div class="duplicate-client-list">${group.clients.map((client) => duplicateClientRow(client, recommended.id)).join('')}</div>
  </article>`;
}

function duplicateAuditHtml(): string {
  const groups = findHistoricalDuplicateGroups(state.crm.clients);
  const duplicateRecords = groups.reduce((total, group) => total + group.clients.length, 0);
  const backupAction = hasClientMergeBackup()
    ? '<button type="button" class="secondary" data-undo-client-merge>Deshacer última fusión</button>'
    : '';

  if (!groups.length) {
    return `<details class="duplicate-audit is-clean">
      <summary><span><b>Control de duplicados históricos</b><small>La base no tiene teléfonos repetidos.</small></span><span class="duplicate-summary-actions"><strong>Base limpia</strong>${backupAction}</span></summary>
      <p>No se encontraron clientes anteriores con el mismo número normalizado. PropControl seguirá bloqueando nuevos duplicados.</p>
    </details>`;
  }

  return `<details class="duplicate-audit has-duplicates" open>
    <summary><span><b>Revisar duplicados históricos</b><small>La fusión siempre requiere tu confirmación.</small></span><span class="duplicate-summary-actions"><strong>${groups.length} grupos · ${duplicateRecords} registros</strong>${backupAction}</span></summary>
    <div class="duplicate-warning">No se fusionará nada automáticamente. Revisá cada grupo y elegí el registro principal.</div>
    <div class="duplicate-groups">${groups.map(duplicateGroupHtml).join('')}</div>
  </details>`;
}

function bindDuplicateTools(container: HTMLElement): void {
  container.querySelectorAll<HTMLButtonElement>('[data-merge-client-primary]').forEach((button) => {
    button.addEventListener('click', () => {
      const primaryId = Number(button.dataset.mergeClientPrimary);
      const group = findHistoricalDuplicateGroups(state.crm.clients).find((item) => item.clients.some((client) => client.id === primaryId));
      const primary = group?.clients.find((client) => client.id === primaryId);
      if (!group || !primary) return;

      const removedNames = group.clients.filter((client) => client.id !== primaryId).map((client) => client.name).join(', ');
      const confirmed = window.confirm(`Se conservará ${primary.name} y se fusionarán ${removedNames}. Los datos se respaldarán y podrás deshacer la operación. ¿Continuar?`);
      if (!confirmed) return;

      saveClientMergeBackup(state.crm.clients);
      const result = mergeDuplicateClients(state.crm.clients, primaryId);
      state.crm.clients = result.clients;
      if (result.removedIds.includes(state.editingClientId ?? -1)) {
        state.editingClientId = null;
        state.openForms.client = false;
      }
      saveData();
      document.dispatchEvent(new CustomEvent('trv-render'));
    });
  });

  container.querySelector<HTMLButtonElement>('[data-undo-client-merge]')?.addEventListener('click', () => {
    const restored = restoreClientMergeBackup();
    if (!restored) return;
    state.crm.clients = restored;
    state.editingClientId = null;
    state.openForms.client = false;
    saveData();
    document.dispatchEvent(new CustomEvent('trv-render'));
  });
}

export function renderHome(container: HTMLElement): void {
  const hot = state.crm.clients.filter((client) => client.temperature === 'Caliente').length;
  const visits = state.crm.clients.filter((client) => client.pipeline === 'Visita posible').length;
  const overdue = state.crm.reminders.filter((reminder) => reminder.date < new Date().toISOString().slice(0, 10)).length;
  container.innerHTML = `<div class="metric-grid"><article><span>Leads</span><strong>${state.crm.clients.length}</strong></article><article><span>Calientes</span><strong>${hot}</strong></article><article><span>Visitas posibles</span><strong>${visits}</strong></article><article><span>Seguimientos vencidos</span><strong>${overdue}</strong></article><article><span>Propiedades activas</span><strong>${state.crm.properties.filter((item) => item.status !== 'Cerrada').length}</strong></article><article><span>Fichas TRV</span><strong>${state.crm.fichas.length}</strong></article></div><div class="dashboard-grid"><article class="panel-card"><span class="eyebrow">Prioridad comercial</span><h2>Clientes para revisar</h2>${state.crm.clients.map((client) => { const status = trafficLight(client); return `<div class="mini-alert ${status.color}"><b>${escapeHtml(client.name)}</b><span>${escapeHtml(status.next)}</span></div>`; }).join('') || '<p>No hay clientes.</p>'}</article><article class="panel-card"><span class="eyebrow">Actividad</span><h2>Resumen</h2><p>${state.crm.properties.length} propiedades cargadas.</p><p>${state.crm.reminders.length} tareas pendientes.</p><p>${state.crm.fichas.length} fichas comerciales.</p></article></div>`;
}

export function renderClients(container: HTMLElement): void {
  let editingClient = state.crm.clients.find((client) => client.id === state.editingClientId) ?? null;
  if (state.editingClientId !== null && !editingClient) {
    state.editingClientId = null;
    editingClient = null;
  }

  const formTitle = editingClient ? `Editar ${escapeHtml(editingClient.name)}` : 'Nuevo cliente';
  const submitLabel = editingClient ? 'Guardar cambios' : 'Guardar cliente';
  const temperatures: Temperature[] = ['Caliente', 'Tibio', 'Frío'];
  const statuses = ['Lead', 'Cliente', 'Seguimiento', 'Cerrado'];
  const clients = filteredClients();

  container.innerHTML = `<div class="panel-heading"><div><span class="eyebrow">CRM / Leads</span><h2>Pipeline comercial</h2></div><button type="button" data-toggle="client-form">Nuevo cliente</button></div>
  <form id="client-form" class="data-form ${state.openForms.client ? '' : 'collapsed'}">
    <div class="form-heading"><div><span class="eyebrow">${editingClient ? 'Edición' : 'Alta'}</span><h3>${formTitle}</h3></div>${editingClient ? '<span>Modificá los datos y guardá. La actualización se respaldará online.</span>' : '<span>El teléfono se normaliza automáticamente y no se permiten duplicados.</span>'}</div>
    <input name="name" aria-label="Nombre" placeholder="Nombre" value="${clientValue(editingClient, 'name')}" required>
    <input name="phone" aria-label="Teléfono" inputmode="tel" autocomplete="tel" placeholder="Teléfono" value="${clientValue(editingClient, 'phone')}" required>
    <input name="email" aria-label="Email" type="email" placeholder="Email" value="${clientValue(editingClient, 'email')}">
    <input name="interest" aria-label="Qué busca o zona" placeholder="Qué busca / zona" value="${clientValue(editingClient, 'interest')}" required>
    <select name="status" aria-label="Estado">${statuses.map((value) => selectedOption(value, editingClient?.status ?? 'Lead')).join('')}</select>
    <select name="temperature" aria-label="Temperatura">${temperatures.map((value) => selectedOption(value, editingClient?.temperature ?? 'Tibio')).join('')}</select>
    <select name="pipeline" aria-label="Etapa del pipeline">${pipelines.map((value) => selectedOption(value, editingClient?.pipeline ?? 'Nuevo')).join('')}</select>
    <input name="lastContact" aria-label="Último contacto" type="date" value="${clientValue(editingClient, 'lastContact')}">
    <input name="nextFollowUp" aria-label="Próximo seguimiento" type="date" value="${clientValue(editingClient, 'nextFollowUp')}">
    <input name="budget" aria-label="Presupuesto" placeholder="Presupuesto" value="${clientValue(editingClient, 'budget')}">
    <input name="paymentMethod" aria-label="Forma de pago" placeholder="Forma de pago" value="${clientValue(editingClient, 'paymentMethod')}">
    <input name="purchaseTimeframe" aria-label="Plazo de compra" placeholder="Plazo de compra" value="${clientValue(editingClient, 'purchaseTimeframe')}">
    <select name="purpose" aria-label="Motivo de compra">${['Vivir', 'Invertir'].map((value) => selectedOption(value, editingClient?.purpose ?? 'Vivir')).join('')}</select>
    <select name="knowsArea" aria-label="Conoce la zona">${['Sí', 'No'].map((value) => selectedOption(value, editingClient?.knowsArea ?? 'No')).join('')}</select>
    <select name="canMoveForward" aria-label="Puede avanzar">${['Sí', 'No'].map((value) => selectedOption(value, editingClient?.canMoveForward ?? 'No')).join('')}</select>
    <input name="objections" aria-label="Objeciones" placeholder="Objeciones" value="${clientValue(editingClient, 'objections')}">
    <textarea name="notes" aria-label="Observaciones" placeholder="Observaciones">${clientValue(editingClient, 'notes')}</textarea>
    <div id="client-form-error" class="form-error" role="alert" hidden></div>
    <div class="form-actions"><button type="submit">${submitLabel}</button>${editingClient ? '<button type="button" class="secondary" data-cancel-client-edit>Cancelar</button>' : ''}</div>
  </form>
  ${duplicateAuditHtml()}
  <form id="client-filters" class="client-filter-bar" aria-label="Buscar y filtrar clientes">
    <label class="client-search"><span>Buscar</span><input name="query" type="search" autocomplete="off" placeholder="Nombre, teléfono, zona, presupuesto..." value="${escapeHtml(clientListFilters.query)}"></label>
    <label><span>Temperatura</span><select name="temperature">${['Todas', ...temperatures].map((value) => selectedOption(value, clientListFilters.temperature)).join('')}</select></label>
    <label><span>Etapa</span><select name="pipeline">${['Todas', ...pipelines].map((value) => selectedOption(value, clientListFilters.pipeline)).join('')}</select></label>
    <label><span>Seguimiento</span><select name="followUp">${['Todos', 'Vencidos', 'Hoy', 'Próximos', 'Sin fecha'].map((value) => selectedOption(value, clientListFilters.followUp)).join('')}</select></label>
    <label><span>Ordenar</span><select name="sort">${['Seguimiento urgente', 'Último contacto', 'Nombre A-Z', 'Temperatura'].map((value) => selectedOption(value, clientListFilters.sort)).join('')}</select></label>
    <button type="button" class="secondary" data-clear-client-filters>Limpiar</button>
  </form>
  <div class="client-list-meta"><strong id="client-result-count" aria-live="polite">${clients.length} de ${state.crm.clients.length} clientes</strong><span>La búsqueda no modifica tus datos.</span></div>
  <div id="client-results" class="card-list">${clientResultsHtml(clients)}</div>`;

  bindClientFilters(container);
  bindDuplicateTools(container);

  container.querySelector<HTMLFormElement>('#client-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const values = formValues(form);
    const id = editingClient?.id ?? nextId(state.crm.clients);
    const client = clientFromFormValues(id, values);

    if (!isPlausiblePhone(client.phone)) {
      showClientFormError(form, 'Ingresá un teléfono válido de entre 8 y 15 dígitos.');
      form.querySelector<HTMLInputElement>('[name="phone"]')?.focus();
      return;
    }

    const duplicate = findDuplicateClient(state.crm.clients, client.phone, editingClient?.id ?? null);
    if (duplicate) {
      showClientFormError(form, `Ese teléfono ya pertenece a ${duplicate.name}.`, duplicate.id);
      return;
    }

    state.crm.clients = upsertClient(state.crm.clients, client);
    state.editingClientId = null;
    state.openForms.client = false;
    saveData();
    document.dispatchEvent(new CustomEvent('trv-render'));
  });
}

export function renderProperties(container: HTMLElement): void {
  container.innerHTML = `<div class="panel-heading"><div><span class="eyebrow">Propiedades</span><h2>Inventario activo</h2></div><button data-toggle="property-form">Nueva propiedad</button></div><form id="property-form" class="data-form ${state.openForms.property ? '' : 'collapsed'}"><input name="title" placeholder="Nombre" required><input name="address" placeholder="Zona o dirección" required><select name="type"><option>Departamento</option><option>Casa</option><option>Terreno</option><option>Comercial</option></select><select name="operation"><option>Venta</option><option>Captación</option></select><input name="price" type="number" min="0" placeholder="Precio" required><input name="owner" placeholder="Propietario o colega" required><select name="status"><option>Activa</option><option>Captación</option><option>Reservada</option><option>Cerrada</option></select><button type="submit">Guardar propiedad</button></form><div class="property-board">${state.crm.properties.map((property) => `<article class="property-card"><div><span>${escapeHtml(property.status)}</span><h3>${escapeHtml(property.title)}</h3><p>${escapeHtml(property.address)} · ${escapeHtml(property.type)}</p><strong>USD ${new Intl.NumberFormat('es-AR').format(property.price)}</strong></div><button class="delete" data-delete="properties" data-id="${property.id}">×</button></article>`).join('') || '<p class="empty-state">No hay propiedades.</p>'}</div>`;
  container.querySelector<HTMLFormElement>('#property-form')?.addEventListener('submit', (event) => {
    event.preventDefault(); const values = formValues(event.currentTarget as HTMLFormElement);
    state.crm.properties.push({ id: nextId(state.crm.properties), title: field(values, 'title'), address: field(values, 'address'), type: field(values, 'type'), operation: field(values, 'operation'), price: Number(field(values, 'price')), owner: field(values, 'owner'), status: field(values, 'status') });
    state.openForms.property = false; saveData(); document.dispatchEvent(new CustomEvent('trv-render'));
  });
}
