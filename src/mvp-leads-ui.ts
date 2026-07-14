import { clientFromFormValues, upsertClient } from './client-editor.js';
import type { Client } from './models.js';
import { findDuplicateClient, formatPhone, isPlausiblePhone } from './phone-normalizer.js';
import { saveData, state } from './store.js';
import { escapeHtml, formValues, nextId } from './utils.js';

let searchText = '';

function value(client: Client | null, key: keyof Client): string {
  const current = client?.[key];
  return escapeHtml(typeof current === 'string' ? current : '');
}

function leadRows(): Client[] {
  const query = searchText.trim().toLowerCase();
  if (!query) return state.crm.clients;
  return state.crm.clients.filter((client) => [client.name, client.phone, client.interest, client.budget]
    .some((item) => String(item ?? '').toLowerCase().includes(query)));
}

function card(client: Client): string {
  const digits = client.phone.replace(/\D/g, '');
  return `<article class="mvp-lead-card"><div><div class="mvp-lead-name"><h3>${escapeHtml(client.name)}</h3><span>${escapeHtml(client.budget || 'Sin presupuesto')}</span></div><p>${escapeHtml(client.interest || 'Sin interés definido')}</p><a class="mvp-whatsapp-link" href="https://wa.me/${digits}" target="_blank" rel="noopener noreferrer">WhatsApp · ${escapeHtml(formatPhone(client.phone))}</a></div><div class="mvp-lead-actions"><button type="button" class="secondary" data-edit-client="${client.id}" aria-controls="mvp-lead-form">Editar</button><button type="button" class="delete" data-delete="clients" data-id="${client.id}">×</button></div></article>`;
}

function focusLeadForm(container: HTMLElement): void {
  window.requestAnimationFrame(() => {
    const form = container.querySelector<HTMLFormElement>('#mvp-lead-form:not(.collapsed)');
    if (!form) return;
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    form.querySelector<HTMLInputElement>('input[name="name"]')?.focus({ preventScroll: true });
  });
}

export function renderMvpLeads(container: HTMLElement): void {
  const editing = state.crm.clients.find((client) => client.id === state.editingClientId) ?? null;
  const leads = leadRows();
  container.innerHTML = `<div class="mvp-page-heading"><div><h1>Leads</h1><p>Nombre, WhatsApp, interés y presupuesto.</p></div><button type="button" data-toggle="client-form">Nuevo lead</button></div><form id="mvp-lead-form" class="mvp-lead-form ${state.openForms.client ? '' : 'collapsed'}"><div class="mvp-form-heading"><h2>${editing ? `Editar ${escapeHtml(editing.name)}` : 'Nuevo lead'}</h2><button type="button" class="quiet-button" data-cancel-client-edit>Cerrar</button></div><label>Nombre<input name="name" value="${value(editing, 'name')}" required></label><label>Número de WhatsApp<input name="phone" value="${value(editing, 'phone')}" inputmode="tel" required></label><label>Lugar o propiedad de interés<input name="interest" value="${value(editing, 'interest')}" required></label><label>Presupuesto<input name="budget" value="${value(editing, 'budget')}" placeholder="Ej. USD 85.000"></label><div data-lead-error class="form-error" hidden></div><button type="submit">${editing ? 'Guardar cambios' : 'Guardar lead'}</button></form><div class="mvp-lead-toolbar"><label><span>Buscar</span><input id="mvp-lead-search" type="search" value="${escapeHtml(searchText)}" placeholder="Nombre, WhatsApp, interés o presupuesto"></label><strong>${leads.length} leads</strong></div><div class="mvp-lead-list">${leads.map(card).join('') || '<p class="empty-state">No hay leads para mostrar.</p>'}</div>`;

  container.querySelector<HTMLInputElement>('#mvp-lead-search')?.addEventListener('input', (event) => {
    searchText = (event.currentTarget as HTMLInputElement).value;
    renderMvpLeads(container);
    container.querySelector<HTMLInputElement>('#mvp-lead-search')?.focus();
  });

  container.querySelectorAll<HTMLButtonElement>('[data-edit-client]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const clientId = Number(button.dataset.editClient);
      if (!clientId || !state.crm.clients.some((client) => client.id === clientId)) return;
      state.editingClientId = clientId;
      state.openForms.client = true;
      renderMvpLeads(container);
      focusLeadForm(container);
    });
  });

  container.querySelector<HTMLFormElement>('#mvp-lead-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const client = clientFromFormValues(editing?.id ?? nextId(state.crm.clients), formValues(form), editing);
    const error = form.querySelector<HTMLElement>('[data-lead-error]');
    if (!isPlausiblePhone(client.phone)) {
      if (error) { error.textContent = 'Ingresá un número de WhatsApp válido.'; error.hidden = false; }
      return;
    }
    const duplicate = findDuplicateClient(state.crm.clients, client.phone, editing?.id ?? null);
    if (duplicate) {
      if (error) { error.textContent = `Ese WhatsApp ya pertenece a ${duplicate.name}.`; error.hidden = false; }
      return;
    }
    if (!editing) { client.assignedToId = state.activeMemberId; client.createdById = state.activeMemberId; }
    state.crm.clients = upsertClient(state.crm.clients, client);
    state.editingClientId = null;
    state.openForms.client = false;
    saveData();
    document.dispatchEvent(new CustomEvent('trv-render'));
  });
}
