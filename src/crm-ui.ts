import { clientFromFormValues, upsertClient } from './client-editor.js';
import { Client, Temperature } from './models.js';
import { saveData, state } from './store.js';
import { escapeHtml, field, formValues, nextId } from './utils.js';

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
  const pipelines = ['Nuevo', 'Contactado', 'Calificado', 'Visita posible', 'Negociación', 'Cerrado', 'Perdido'];

  container.innerHTML = `<div class="panel-heading"><div><span class="eyebrow">CRM / Leads</span><h2>Pipeline comercial</h2></div><button type="button" data-toggle="client-form">Nuevo cliente</button></div>
  <form id="client-form" class="data-form ${state.openForms.client ? '' : 'collapsed'}">
    <div class="form-heading"><div><span class="eyebrow">${editingClient ? 'Edición' : 'Alta'}</span><h3>${formTitle}</h3></div>${editingClient ? '<span>Modificá los datos y guardá. La actualización se respaldará online.</span>' : ''}</div>
    <input name="name" aria-label="Nombre" placeholder="Nombre" value="${clientValue(editingClient, 'name')}" required>
    <input name="phone" aria-label="Teléfono" placeholder="Teléfono" value="${clientValue(editingClient, 'phone')}" required>
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
    <div class="form-actions"><button type="submit">${submitLabel}</button>${editingClient ? '<button type="button" class="secondary" data-cancel-client-edit>Cancelar</button>' : ''}</div>
  </form>
  <div class="card-list">${state.crm.clients.map((client) => { const status = trafficLight(client); return `<article class="crm-card ${status.color}"><div><div class="card-title"><h3>${escapeHtml(client.name)}</h3><span class="traffic ${status.color}">${escapeHtml(status.label)}</span></div><p>${escapeHtml(client.interest)}</p><small>${escapeHtml(client.phone)} · ${escapeHtml(client.budget || 'Sin presupuesto')}</small><strong class="next-step">${escapeHtml(status.next)}</strong></div><div class="record-actions"><button type="button" class="secondary edit-button" data-edit-client="${client.id}" aria-label="Editar ${escapeHtml(client.name)}">Editar</button><button type="button" class="delete" data-delete="clients" data-id="${client.id}" aria-label="Eliminar ${escapeHtml(client.name)}">×</button></div></article>`; }).join('') || '<p class="empty-state">No hay clientes.</p>'}</div>`;

  document.querySelector<HTMLFormElement>('#client-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const values = formValues(event.currentTarget as HTMLFormElement);
    const id = editingClient?.id ?? nextId(state.crm.clients);
    state.crm.clients = upsertClient(state.crm.clients, clientFromFormValues(id, values));
    state.editingClientId = null;
    state.openForms.client = false;
    saveData();
    document.dispatchEvent(new CustomEvent('trv-render'));
  });
}

export function renderProperties(container: HTMLElement): void {
  container.innerHTML = `<div class="panel-heading"><div><span class="eyebrow">Propiedades</span><h2>Inventario activo</h2></div><button data-toggle="property-form">Nueva propiedad</button></div><form id="property-form" class="data-form ${state.openForms.property ? '' : 'collapsed'}"><input name="title" placeholder="Nombre" required><input name="address" placeholder="Zona o dirección" required><select name="type"><option>Departamento</option><option>Casa</option><option>Terreno</option><option>Comercial</option></select><select name="operation"><option>Venta</option><option>Captación</option></select><input name="price" type="number" min="0" placeholder="Precio" required><input name="owner" placeholder="Propietario o colega" required><select name="status"><option>Activa</option><option>Captación</option><option>Reservada</option><option>Cerrada</option></select><button type="submit">Guardar propiedad</button></form><div class="property-board">${state.crm.properties.map((property) => `<article class="property-card"><div><span>${escapeHtml(property.status)}</span><h3>${escapeHtml(property.title)}</h3><p>${escapeHtml(property.address)} · ${escapeHtml(property.type)}</p><strong>USD ${new Intl.NumberFormat('es-AR').format(property.price)}</strong></div><button class="delete" data-delete="properties" data-id="${property.id}">×</button></article>`).join('') || '<p class="empty-state">No hay propiedades.</p>'}</div>`;
  document.querySelector<HTMLFormElement>('#property-form')?.addEventListener('submit', (event) => {
    event.preventDefault(); const values = formValues(event.currentTarget as HTMLFormElement);
    state.crm.properties.push({ id: nextId(state.crm.properties), title: field(values, 'title'), address: field(values, 'address'), type: field(values, 'type'), operation: field(values, 'operation'), price: Number(field(values, 'price')), owner: field(values, 'owner'), status: field(values, 'status') });
    state.openForms.property = false; saveData(); document.dispatchEvent(new CustomEvent('trv-render'));
  });
}
