import { clientFromFormValues, upsertClient } from './client-editor.js';
import {
  activitiesForClientSave,
  commercialStage,
  COMMERCIAL_STAGES,
  filterLeads,
  isTerminalClient,
  localIsoDate,
  stageCounters,
  type LeadFilters,
} from './lead-pipeline.js';
import {
  bindLeadQualificationPanel,
  renderLeadQualificationPanel,
  requestLeadQualification,
} from './lead-qualification-ui.js';
import {
  renderEssentialQualificationFields,
  renderLeadCommercialSummary,
  renderLeadSecondaryMeta,
  renderSecondaryQualificationFields,
} from './lead-essential-ui.js';
import type { ActivityEntry, Client, CommercialStage, Temperature } from './models.js';
import { findDuplicateClient, formatPhone, isPlausiblePhone } from './phone-normalizer.js';
import { matchPropertiesForClient, type PropertyMatch } from './property-matching.js';
import { saveData, state } from './store.js';
import { addActivity, memberName, visibleClients, visibleProperties } from './team-access.js';
import { escapeHtml, formValues, nextId } from './utils.js';
import { appIcons } from './icons.js';

let filters: LeadFilters = {
  search: '',
  stage: 'Todas',
  temperature: 'Todas',
  overdueOnly: false,
  missingNextActionOnly: false,
};

const priceFormatter = new Intl.NumberFormat('es-AR');
const activityFormatter = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
const dateFormatter = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'UTC',
});

function value(client: Client | null, key: keyof Client): string {
  const current = client?.[key];
  if (typeof current === 'number') return escapeHtml(String(current));
  return escapeHtml(typeof current === 'string' ? current : '');
}

function selected(current: string | undefined, expected: string): string {
  return current === expected ? ' selected' : '';
}

function leadRows(): Client[] {
  return filterLeads(visibleClients(), filters);
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
  if (isTerminalClient(client)) return '';
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

function tempIcon(temperature: string): string {
  const slug = temperature === 'Caliente' ? 'cliente-caliente'
    : temperature === 'Frío' ? 'cliente-frio'
    : 'cliente-tibio';
  return `<img class="mvp-temp-icon" src="/src/assets/${slug}.png?v=20260722-45" alt="" title="Cliente ${escapeHtml(temperature.toLowerCase())}">`;
}

function clientHistory(clientId: number): ActivityEntry[] {
  return state.crm.activityLog
    .filter((entry) => entry.entityType === 'Cliente' && entry.entityId === clientId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 5);
}

function historyBlock(client: Client): string {
  const entries = clientHistory(client.id);
  if (!entries.length) return '';
  return `<details class="mvp-lead-history">
    <summary>Últimos movimientos (${entries.length})</summary>
    <div class="mvp-lead-history-list">${entries.map((entry) => {
      const date = new Date(entry.createdAt);
      const formatted = Number.isNaN(date.getTime()) ? entry.createdAt : activityFormatter.format(date);
      return `<article><strong>${escapeHtml(entry.action)}</strong><time>${escapeHtml(formatted)}</time><p>${escapeHtml(entry.detail)}</p></article>`;
    }).join('')}</div>
  </details>`;
}

function summaryValue(valueText: string | undefined, fallback = 'Sin definir'): string {
  return escapeHtml(valueText?.trim() || fallback);
}

function formattedLeadDate(valueText: string | undefined): string {
  if (!valueText) return 'Sin fecha';
  const date = new Date(`${valueText}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? valueText : dateFormatter.format(date);
}

function card(client: Client): string {
  const digits = client.phone.replace(/\D/g, '');
  const stage = commercialStage(client);
  const terminal = isTerminalClient(client);
  return `<article class="mvp-lead-card mvp-lead-card-with-matches${terminal ? ' terminal' : ''}">
    <div class="mvp-lead-card-main">
      <div class="mvp-lead-main-copy">
        <div class="mvp-lead-title-line">${tempIcon(client.temperature)}<h3>${escapeHtml(client.name)}</h3><span class="mvp-stage-badge${terminal ? ' terminal' : ''}">${escapeHtml(stage)}</span></div>
        <p>${client.interest ? `Busca ${escapeHtml(client.interest)}` : 'Sin interés definido'}</p>
        ${renderLeadSecondaryMeta(client)}
        <div class="mvp-lead-contact"><a class="mvp-contact-btn wa" href="https://wa.me/${digits}" target="_blank" rel="noopener noreferrer" title="WhatsApp · ${escapeHtml(formatPhone(client.phone))}" aria-label="Enviar WhatsApp">${appIcons.whatsapp}</a><a class="mvp-contact-btn call" href="tel:+${digits}" title="Llamar · ${escapeHtml(formatPhone(client.phone))}" aria-label="Llamar">${appIcons.phone}</a>${client.email ? `<a class="mvp-contact-btn mail" href="mailto:${escapeHtml(client.email)}" title="${escapeHtml(client.email)}" aria-label="Enviar email">${appIcons.mail}</a>` : `<span class="mvp-contact-btn mail" data-disabled title="Sin email cargado" aria-label="Sin email cargado">${appIcons.mail}</span>`}</div>
      </div>
      <div class="mvp-lead-primary-action"><button type="button" class="secondary mvp-auto-qualify-button" data-auto-qualify-client="${client.id}">Calificar automáticamente</button></div>
      <div class="mvp-lead-actions mvp-lead-secondary-actions"><button type="button" class="secondary mvp-icon-btn" data-edit-client="${client.id}" aria-controls="mvp-lead-form" title="Editar" aria-label="Editar ${escapeHtml(client.name)}">${appIcons.edit}</button><button type="button" class="delete mvp-icon-btn" data-delete="clients" data-id="${client.id}" title="Eliminar" aria-label="Eliminar ${escapeHtml(client.name)}">×</button></div>
    </div>
    <div class="mvp-lead-critical">
      <div><span>Próxima acción</span><strong>${terminal ? 'Operación cerrada' : summaryValue(client.nextAction, 'Sin próxima acción')}</strong></div>
      <div><span>Fecha</span><strong>${terminal ? '—' : escapeHtml(formattedLeadDate(client.nextFollowUp))}</strong></div>
      <div><span>Responsable</span><strong>${escapeHtml(memberName(client.assignedToId))}</strong></div>
    </div>
    ${renderLeadCommercialSummary(client)}
    ${renderLeadQualificationPanel(client)}
    ${historyBlock(client)}
    ${matchesForLead(client)}
  </article>`;
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
  container.querySelectorAll<HTMLButtonElement>('[data-auto-qualify-client]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const clientId = Number(button.dataset.autoQualifyClient);
      if (!clientId || !visibleClients().some((client) => client.id === clientId)) return;
      requestLeadQualification(clientId);
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
  visibleClients().forEach((client) => bindLeadQualificationPanel(container, client, () => renderMvpLeads(container)));
}

function updateLeadResults(container: HTMLElement): void {
  const leads = leadRows();
  const results = container.querySelector<HTMLElement>('#mvp-lead-results');
  const count = container.querySelector<HTMLElement>('#mvp-lead-count');
  if (results) results.innerHTML = leads.map(card).join('') || '<p class="empty-state">No hay leads para mostrar con estos filtros.</p>';
  if (count) count.textContent = `${leads.length} de ${visibleClients().length} leads`;
  bindLeadCardActions(container);
}

function stageOptions(current: CommercialStage): string {
  return COMMERCIAL_STAGES.map((stage) => `<option value="${stage}"${selected(current, stage)}>${stage}</option>`).join('');
}

function leadForm(editing: Client | null): string {
  const stage = editing ? commercialStage(editing) : 'Nuevo';
  return `<form id="mvp-lead-form" class="mvp-lead-form ${state.openForms.client ? '' : 'collapsed'}">
    <div class="mvp-form-heading"><h2>${editing ? `Editar ${escapeHtml(editing.name)}` : 'Nuevo lead'}</h2><button type="button" class="quiet-button" data-cancel-client-edit>Cerrar</button></div>
    <label>Nombre<input name="name" value="${value(editing, 'name')}" required></label>
    <label>Número de WhatsApp<input name="phone" value="${value(editing, 'phone')}" inputmode="tel" required></label>
    <label>Email<input name="email" type="email" value="${value(editing, 'email')}" placeholder="cliente@correo.com"></label>
    <label>Temperatura<select name="temperature">${(['Caliente', 'Tibio', 'Frío'] as Temperature[]).map((temperature) => `<option value="${temperature}"${selected(editing?.temperature ?? 'Tibio', temperature)}>${temperature}</option>`).join('')}</select></label>
    <label class="lead-form-wide">Lugar o propiedad de interés<input name="interest" value="${value(editing, 'interest')}" placeholder="Ej. Dúplex en Manantiales" required></label>
    <label>Etapa comercial<select name="pipeline" data-commercial-stage>${stageOptions(stage)}</select></label>
    <label>Próxima acción<input name="nextAction" value="${value(editing, 'nextAction')}" placeholder="Ej. Confirmar entrega y financiación"></label>
    <label>Fecha del próximo seguimiento<input name="nextFollowUp" type="date" value="${value(editing, 'nextFollowUp')}"></label>
    ${renderEssentialQualificationFields(editing)}
    ${renderSecondaryQualificationFields(editing)}
    <div data-lead-error class="form-error" hidden></div>
    <button type="submit">${editing ? 'Guardar cambios' : 'Guardar lead'}</button>
  </form>`;
}

function activeSecondaryFilters(): string[] {
  const active: string[] = [];
  if (filters.stage !== 'Todas') active.push(`Etapa: ${filters.stage}`);
  if (filters.temperature !== 'Todas') active.push(`Temperatura: ${filters.temperature}`);
  if (filters.overdueOnly) active.push('Vencidos');
  if (filters.missingNextActionOnly) active.push('Sin próxima acción');
  return active;
}

function filterPanel(): string {
  const visible = visibleClients();
  const counters = stageCounters(visible);
  const active = activeSecondaryFilters();
  const mobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 520px)').matches;
  const open = !mobile || active.length > 0;
  return `<div class="mvp-lead-filter-panel">
    <div class="mvp-lead-filter-primary">
      <label class="mvp-lead-search-field"><span>Buscar</span><input id="mvp-lead-search" type="search" value="${escapeHtml(filters.search)}" placeholder="Nombre, WhatsApp o interés"></label>
      <strong id="mvp-lead-count">${leadRows().length} de ${visible.length} leads</strong>
    </div>
    <details class="mvp-lead-more-filters"${open ? ' open' : ''}>
      <summary><span>Más filtros</span><small>${escapeHtml(active.length ? active.join(' · ') : 'Etapa, temperatura y seguimiento')}</small></summary>
      <div class="mvp-lead-filter-grid">
        <label><span>Etapa</span><select id="mvp-lead-stage-filter"><option value="Todas">Todas</option>${COMMERCIAL_STAGES.map((stage) => `<option value="${stage}"${selected(filters.stage, stage)}>${stage}</option>`).join('')}</select></label>
        <label><span>Temperatura</span><select id="mvp-lead-temperature-filter"><option value="Todas">Todas</option>${(['Caliente', 'Tibio', 'Frío'] as Temperature[]).map((temperature) => `<option value="${temperature}"${selected(filters.temperature, temperature)}>${temperature}</option>`).join('')}</select></label>
      </div>
      <div class="mvp-lead-filter-toggles"><label><input id="mvp-lead-overdue-filter" type="checkbox"${filters.overdueOnly ? ' checked' : ''}>Seguimientos vencidos</label><label><input id="mvp-lead-missing-action-filter" type="checkbox"${filters.missingNextActionOnly ? ' checked' : ''}>Sin próxima acción completa</label></div>
    </details>
    <div class="mvp-stage-counters" aria-label="Contadores por etapa"><button type="button" class="mvp-stage-counter${filters.stage === 'Todas' ? ' active' : ''}" data-stage-quick="Todas">Todos <b>${visible.length}</b></button>${COMMERCIAL_STAGES.map((stage) => `<button type="button" class="mvp-stage-counter${filters.stage === stage ? ' active' : ''}" data-stage-quick="${stage}">${stage} <b>${counters[stage]}</b></button>`).join('')}</div>
  </div>`;
}

function bindFilters(container: HTMLElement): void {
  container.querySelector<HTMLInputElement>('#mvp-lead-search')?.addEventListener('input', (event) => {
    filters.search = (event.currentTarget as HTMLInputElement).value;
    updateLeadResults(container);
  });
  container.querySelector<HTMLSelectElement>('#mvp-lead-stage-filter')?.addEventListener('change', (event) => {
    filters.stage = (event.currentTarget as HTMLSelectElement).value as LeadFilters['stage'];
    renderMvpLeads(container);
  });
  container.querySelector<HTMLSelectElement>('#mvp-lead-temperature-filter')?.addEventListener('change', (event) => {
    filters.temperature = (event.currentTarget as HTMLSelectElement).value as LeadFilters['temperature'];
    updateLeadResults(container);
  });
  container.querySelector<HTMLInputElement>('#mvp-lead-overdue-filter')?.addEventListener('change', (event) => {
    filters.overdueOnly = (event.currentTarget as HTMLInputElement).checked;
    updateLeadResults(container);
  });
  container.querySelector<HTMLInputElement>('#mvp-lead-missing-action-filter')?.addEventListener('change', (event) => {
    filters.missingNextActionOnly = (event.currentTarget as HTMLInputElement).checked;
    updateLeadResults(container);
  });
  container.querySelectorAll<HTMLButtonElement>('[data-stage-quick]').forEach((button) => {
    button.addEventListener('click', () => {
      filters.stage = button.dataset.stageQuick as LeadFilters['stage'];
      renderMvpLeads(container);
    });
  });
}

export function renderMvpLeads(container: HTMLElement): void {
  const editing = visibleClients().find((client) => client.id === state.editingClientId) ?? null;
  const leads = leadRows();
  container.innerHTML = `<div class="mvp-page-heading"><div><h1>Leads</h1><p>Calificá lo esencial, definí la próxima acción y avanzá cada oportunidad sin interrogatorios.</p></div><button type="button" data-toggle="client-form">Nuevo lead</button></div>${leadForm(editing)}${filterPanel()}<div id="mvp-lead-results" class="mvp-lead-list">${leads.map(card).join('') || '<p class="empty-state">No hay leads para mostrar con estos filtros.</p>'}</div>`;

  bindFilters(container);
  bindLeadCardActions(container);

  const stageSelect = container.querySelector<HTMLSelectElement>('[data-commercial-stage]');
  const actionInput = container.querySelector<HTMLInputElement>('input[name="nextAction"]');
  const dateInput = container.querySelector<HTMLInputElement>('input[name="nextFollowUp"]');
  const syncTerminalInputs = (): void => {
    const terminal = stageSelect?.value === 'Ganado' || stageSelect?.value === 'Perdido';
    if (actionInput) actionInput.disabled = terminal;
    if (dateInput) dateInput.disabled = terminal;
  };
  stageSelect?.addEventListener('change', syncTerminalInputs);
  syncTerminalInputs();

  container.querySelector<HTMLFormElement>('#mvp-lead-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const previous = editing ? structuredClone(editing) : null;
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
    if (!isTerminalClient(client) && Boolean(client.nextFollowUp) !== Boolean(client.nextAction?.trim())) {
      if (error) { error.textContent = 'La próxima acción necesita texto y fecha para aparecer correctamente en Agenda.'; error.hidden = false; }
      return;
    }
    if (!editing) { client.assignedToId = state.activeMemberId; client.createdById = state.activeMemberId; }
    state.crm.clients = upsertClient(state.crm.clients, client);
    activitiesForClientSave(previous, client).forEach(addActivity);
    state.editingClientId = null;
    state.openForms.client = false;
    saveData(editing ? `Lead actualizado: ${client.name}` : `Lead creado: ${client.name}`);
    document.dispatchEvent(new CustomEvent('trv-render'));
  });

  container.querySelector<HTMLElement>('[data-cancel-client-edit]')?.addEventListener('click', () => {
    state.editingClientId = null;
    state.openForms.client = false;
    renderMvpLeads(container);
  });
}

export function resetLeadFiltersForTests(): void {
  filters = { search: '', stage: 'Todas', temperature: 'Todas', overdueOnly: false, missingNextActionOnly: false };
}

export function overdueReferenceDateForTests(): string {
  return localIsoDate();
}
