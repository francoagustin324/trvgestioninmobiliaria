import { clientFromFormValues, upsertClient } from './client-editor.js';
import {
  buildCommercialProgress,
  COMMERCIAL_STAGES,
  isCommercialStage,
  type CommercialStage,
} from './lead-commercial-flow.js';
import type { ActivityEntry, Client } from './models.js';
import { findDuplicateClient, formatPhone, isPlausiblePhone } from './phone-normalizer.js';
import { matchPropertiesForClient, type PropertyMatch } from './property-matching.js';
import { saveData, state } from './store.js';
import { addActivity, visibleClients, visibleProperties } from './team-access.js';
import { escapeHtml, field, formValues, nextId } from './utils.js';

let searchText = '';
const priceFormatter = new Intl.NumberFormat('es-AR');
const activityDateFormatter = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function value(client: Client | null, key: keyof Client): string {
  const current = client?.[key];
  return escapeHtml(typeof current === 'string' ? current : '');
}

function leadRows(): Client[] {
  const clients = visibleClients();
  const query = searchText.trim().toLowerCase();
  if (!query) return clients;
  return clients.filter((client) => [client.name, client.phone, client.interest, client.budget, client.pipeline]
    .some((item) => String(item ?? '').toLowerCase().includes(query)));
}

function matchRow(match: PropertyMatch): string {
  const reasons = match.reasons.slice(0, 3);
  const warning = match.warnings[0];
  return `<article class="mvp-match-row">
    <div class="mvp-match-property">
      <div class="mvp-match-title"><strong>${escapeHtml(match.property.title)}</strong><span>USD ${priceFormatter.format(match.property.price)}</span></div>
      <p>${escapeHtml(match.property.address)}</p>
      <div class="mvp-property-meta">${reasons.map((reason) => `<span>${escapeHtml(reason)}</span>`).join('')}</div>
      ${warning ? `<small>${escapeHtml(warning)}</small>` : ''}
    </div>
    <div class="mvp-match-actions">
      <b class="mvp-match-score ${match.level.toLowerCase()}">${match.score}%</b>
      <button type="button" class="secondary" data-open-match-property="${match.property.id}">Abrir propiedad</button>
    </div>
  </article>`;
}

function matchesForLead(client: Client): string {
  const properties = visibleProperties();
  if (!properties.length) return '<p class="mvp-match-empty">Todavía no hay propiedades cargadas para comparar.</p>';
  const matches = matchPropertiesForClient(client, properties).slice(0, 3);
  if (!matches.length) return '<p class="mvp-match-empty">No hay coincidencias claras con las propiedades disponibles.</p>';
  const best = matches[0]!;
  return `<details class="mvp-lead-matches">
    <summary><span>${matches.length} ${matches.length === 1 ? 'propiedad compatible' : 'propiedades compatibles'}</span><strong>${best.score}% mejor coincidencia</strong></summary>
    <div class="mvp-match-list">${matches.map(matchRow).join('')}</div>
  </details>`;
}

function stageClass(stage: string): string {
  const mapping: Partial<Record<CommercialStage, string>> = {
    Nuevo: 'nuevo',
    Calificado: 'calificado',
    'Visita coordinada': 'visita',
    Negociación: 'negociacion',
    Reservado: 'reservado',
    Ganada: 'ganada',
    Perdida: 'perdida',
  };
  return isCommercialStage(stage) ? mapping[stage] ?? 'nuevo' : 'otro';
}

function stageOptions(current: string): string {
  const placeholder = isCommercialStage(current) ? '' : '<option value="" selected disabled>Elegí la nueva etapa</option>';
  return placeholder + COMMERCIAL_STAGES.map((stage) => `<option value="${escapeHtml(stage)}"${stage === current ? ' selected' : ''}>${escapeHtml(stage)}</option>`).join('');
}

function activityDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Sin fecha' : activityDateFormatter.format(date);
}

function clientHistory(client: Client): ActivityEntry[] {
  return state.crm.activityLog
    .filter((entry) => entry.entityType === 'Cliente' && entry.entityId === client.id)
    .slice(0, 5);
}

function commercialFlow(client: Client): string {
  const history = clientHistory(client);
  const currentStage = client.pipeline || 'Nuevo';
  return `<details class="mvp-commercial-flow">
    <summary>
      <span><small>Etapa comercial</small><strong class="mvp-commercial-stage ${stageClass(currentStage)}">${escapeHtml(currentStage)}</strong></span>
      <b>Registrar avance</b>
    </summary>
    <div class="mvp-commercial-panel">
      <form data-commercial-progress="${client.id}">
        <label>Etapa<select name="stage" required>${stageOptions(currentStage)}</select></label>
        <label>Próxima acción<input name="scheduledDate" type="date" value="${escapeHtml(client.nextFollowUp || '')}"></label>
        <label class="mvp-commercial-note">Detalle<textarea name="note" rows="2" placeholder="Ej. Visitó, le gustó y pidió revisar financiación."></textarea></label>
        <button type="submit">Guardar avance</button>
      </form>
      <div class="mvp-commercial-history">
        <strong>Últimos movimientos</strong>
        ${history.length ? `<ol>${history.map((entry) => `<li><span>${escapeHtml(entry.action)}</span><p>${escapeHtml(entry.detail)}</p><time>${escapeHtml(activityDate(entry.createdAt))}</time></li>`).join('')}</ol>` : '<p>Todavía no hay avances comerciales registrados.</p>'}
      </div>
    </div>
  </details>`;
}

function card(client: Client): string {
  const digits = client.phone.replace(/\D/g, '');
  return `<article class="mvp-lead-card mvp-lead-card-with-matches"><div class="mvp-lead-card-main"><div><div class="mvp-lead-name"><h3>${escapeHtml(client.name)}</h3><span>${escapeHtml(client.budget || 'Sin presupuesto')}</span></div><p>${escapeHtml(client.interest || 'Sin interés definido')}</p><a class="mvp-whatsapp-link" href="https://wa.me/${digits}" target="_blank" rel="noopener noreferrer">WhatsApp · ${escapeHtml(formatPhone(client.phone))}</a></div><div class="mvp-lead-actions"><button type="button" class="secondary" data-edit-client="${client.id}" aria-controls="mvp-lead-form">Editar</button><button type="button" class="delete" data-delete="clients" data-id="${client.id}">×</button></div></div>${commercialFlow(client)}${matchesForLead(client)}</article>`;
}

function focusLeadForm(container: HTMLElement): void {
  window.requestAnimationFrame(() => {
    const form = container.querySelector<HTMLFormElement>('#mvp-lead-form:not(.collapsed)');
    if (!form) return;
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    form.querySelector<HTMLInputElement>('input[name="name"]')?.focus({ preventScroll: true });
  });
}

function bindLeadCardActions(container: HTMLElement): void {
  container.querySelectorAll<HTMLButtonElement>('[data-edit-client]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const clientId = Number(button.dataset.editClient);
      if (!clientId || !visibleClients().some((client) => client.id === clientId)) return;
      state.editingClientId = clientId;
      state.openForms.client = true;
      renderMvpLeads(container);
      focusLeadForm(container);
    });
  });
  container.querySelectorAll<HTMLButtonElement>('[data-open-match-property]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const propertyId = Number(button.dataset.openMatchProperty);
      if (!propertyId || !visibleProperties().some((property) => property.id === propertyId)) return;
      state.activeModule = 'propiedades';
      state.editingPropertyId = propertyId;
      state.openForms.property = true;
      document.dispatchEvent(new CustomEvent('trv-render'));
      window.requestAnimationFrame(() => document.querySelector('#mvp-property-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    });
  });
  container.querySelectorAll<HTMLFormElement>('[data-commercial-progress]').forEach((form) => {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const clientId = Number(form.dataset.commercialProgress);
      const client = visibleClients().find((item) => item.id === clientId);
      if (!client) return;
      const values = formValues(form);
      const stage = field(values, 'stage');
      if (!isCommercialStage(stage)) return;
      const progress = buildCommercialProgress(client, {
        stage,
        note: field(values, 'note'),
        scheduledDate: field(values, 'scheduledDate'),
      });
      state.crm.clients = state.crm.clients.map((item) => item.id === client.id ? progress.client : item);
      if (progress.reminder) {
        const assignedToId = client.assignedToId ?? state.activeMemberId;
        const exists = state.crm.reminders.some((reminder) => reminder.date === progress.reminder?.date
          && reminder.title === progress.reminder?.title
          && reminder.related === progress.reminder?.related
          && reminder.assignedToId === assignedToId);
        if (!exists) {
          state.crm.reminders.push({
            ...progress.reminder,
            id: nextId(state.crm.reminders),
            assignedToId,
            createdById: state.activeMemberId,
          });
        }
      }
      addActivity(progress.activity);
      saveData(`Avance comercial de ${client.name}: ${stage}`);
      document.dispatchEvent(new CustomEvent('trv-render'));
    });
  });
}

function updateLeadResults(container: HTMLElement): void {
  const leads = leadRows();
  const results = container.querySelector<HTMLElement>('#mvp-lead-results');
  const count = container.querySelector<HTMLElement>('#mvp-lead-count');
  if (results) results.innerHTML = leads.map(card).join('') || '<p class="empty-state">No hay leads para mostrar.</p>';
  if (count) count.textContent = `${leads.length} leads`;
  bindLeadCardActions(container);
}

export function renderMvpLeads(container: HTMLElement): void {
  const editing = visibleClients().find((client) => client.id === state.editingClientId) ?? null;
  const leads = leadRows();
  container.innerHTML = `<div class="mvp-page-heading"><div><h1>Leads</h1><p>Calificá, coordiná visitas, negociá y cerrá operaciones sin perder el historial.</p></div><button type="button" data-toggle="client-form">Nuevo lead</button></div><form id="mvp-lead-form" class="mvp-lead-form ${state.openForms.client ? '' : 'collapsed'}"><div class="mvp-form-heading"><h2>${editing ? `Editar ${escapeHtml(editing.name)}` : 'Nuevo lead'}</h2><button type="button" class="quiet-button" data-cancel-client-edit>Cerrar</button></div><label>Nombre<input name="name" value="${value(editing, 'name')}" required></label><label>Número de WhatsApp<input name="phone" value="${value(editing, 'phone')}" inputmode="tel" required></label><label>Lugar o propiedad de interés<input name="interest" value="${value(editing, 'interest')}" placeholder="Ej. Departamento de 2 dormitorios en General Paz, apto crédito" required></label><label>Presupuesto<input name="budget" value="${value(editing, 'budget')}" placeholder="Ej. USD 85.000"></label><div data-lead-error class="form-error" hidden></div><button type="submit">${editing ? 'Guardar cambios' : 'Guardar lead'}</button></form><div class="mvp-lead-toolbar"><label><span>Buscar</span><input id="mvp-lead-search" type="search" value="${escapeHtml(searchText)}" placeholder="Nombre, WhatsApp, interés, presupuesto o etapa"></label><strong id="mvp-lead-count">${leads.length} leads</strong></div><div id="mvp-lead-results" class="mvp-lead-list">${leads.map(card).join('') || '<p class="empty-state">No hay leads para mostrar.</p>'}</div>`;

  container.querySelector<HTMLInputElement>('#mvp-lead-search')?.addEventListener('input', (event) => {
    searchText = (event.currentTarget as HTMLInputElement).value;
    updateLeadResults(container);
  });

  bindLeadCardActions(container);

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
