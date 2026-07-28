import { clientFromFormValues, upsertClient } from './client-editor.js';
import {
  activitiesForClientSave,
  commercialStage,
  COMMERCIAL_STAGES,
  completeClientFollowUp,
  filterLeads,
  isTerminalClient,
  localIsoDate,
  reprogramClientFollowUp,
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
  renderSecondaryQualificationFields,
} from './lead-essential-ui.js';
import { renderCompactLeadCard } from './lead-card-compact-ui.js';
import {
  readableLeadAssignee,
  sortLeads,
  type LeadOrder,
} from './lead-list-priority.js';
import type { ActivityEntry, Client, CommercialStage, Temperature } from './models.js';
import { findDuplicateClient, isPlausiblePhone } from './phone-normalizer.js';
import { matchPropertiesForClient, type PropertyMatch } from './property-matching.js';
import { saveData, state } from './store.js';
import { addActivity, memberName, visibleClients, visibleProperties } from './team-access.js';
import { escapeHtml, formValues, nextId } from './utils.js';

interface LeadListFilters extends LeadFilters {
  assignee: number | 'Todos';
  order: LeadOrder;
}

let filters: LeadListFilters = {
  search: '',
  stage: 'Todas',
  temperature: 'Todas',
  overdueOnly: false,
  missingNextActionOnly: false,
  assignee: 'Todos',
  order: 'priority',
};
let expandedClientId: number | null = null;

const priceFormatter = new Intl.NumberFormat('es-AR');
const activityFormatter = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

function value(client: Client | null, key: keyof Client): string {
  const current = client?.[key];
  if (typeof current === 'number') return escapeHtml(String(current));
  return escapeHtml(typeof current === 'string' ? current : '');
}

function selected(current: string | number | undefined, expected: string | number): string {
  return current === expected ? ' selected' : '';
}

function leadRows(): Client[] {
  const filtered = filterLeads(visibleClients(), filters);
  const assigned = filters.assignee === 'Todos'
    ? filtered
    : filtered.filter((client) => client.assignedToId === filters.assignee);
  return sortLeads(assigned, filters.order);
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
      <label class="mvp-match-client-future">Seguimiento con cliente
        <select disabled title="Se habilitará en una fase posterior" aria-label="Estado futuro de la propiedad con el cliente">
          <option>Enviar al cliente</option>
          <option>Ya enviada</option>
          <option>Le interesó</option>
          <option>No le interesó</option>
          <option>Quiere visita</option>
        </select>
        <small>Interfaz preparada; todavía no guarda estados nuevos.</small>
      </label>
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

function clientHistory(clientId: number): ActivityEntry[] {
  return state.crm.activityLog
    .filter((entry) => entry.entityType === 'Cliente' && entry.entityId === clientId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 5);
}

function historyBlock(client: Client): string {
  const entries = clientHistory(client.id);
  if (!entries.length) return '<p class="mvp-lead-full-empty">Sin movimientos comerciales registrados.</p>';
  return `<details class="mvp-lead-history">
    <summary>Últimos movimientos (${entries.length})</summary>
    <div class="mvp-lead-history-list">${entries.map((entry) => {
      const date = new Date(entry.createdAt);
      const formatted = Number.isNaN(date.getTime()) ? entry.createdAt : activityFormatter.format(date);
      return `<article><strong>${escapeHtml(entry.action)}</strong><time>${escapeHtml(formatted)}</time><p>${escapeHtml(entry.detail)}</p></article>`;
    }).join('')}</div>
  </details>`;
}

function card(client: Client): string {
  const responsible = readableLeadAssignee(
    client,
    state.crm.teamMembers,
    state.crm.settings.profileName,
    state.crm.settings.profileEmail,
  );
  return renderCompactLeadCard(client, {
    expanded: expandedClientId === client.id,
    responsible,
    qualificationPanel: renderLeadQualificationPanel(client),
    history: historyBlock(client),
    matches: matchesForLead(client),
  });
}

function focusLeadForm(container: HTMLElement): void {
  window.requestAnimationFrame(() => {
    const form = container.querySelector<HTMLFormElement>('#mvp-lead-form:not(.collapsed)');
    if (!form) return;
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    form.querySelector<HTMLInputElement>('input[name="name"]')?.focus({ preventScroll: true });
  });
}

function saveLeadFollowUp(reason: string, container: HTMLElement): void {
  saveData(reason);
  renderMvpLeads(container);
  queueMicrotask(() => document.dispatchEvent(new CustomEvent('trv-render')));
}

function bindFullSheets(container: HTMLElement): void {
  container.querySelectorAll<HTMLDetailsElement>('[data-lead-full-sheet]').forEach((details) => {
    details.addEventListener('toggle', () => {
      const clientId = Number(details.dataset.leadFullSheet);
      if (!clientId) return;
      if (details.open) {
        container.querySelectorAll<HTMLDetailsElement>('[data-lead-full-sheet]').forEach((other) => {
          if (other !== details && other.open) other.open = false;
        });
        expandedClientId = clientId;
      } else if (expandedClientId === clientId) {
        expandedClientId = null;
      }
      const label = details.querySelector<HTMLElement>('summary > span');
      if (label) label.textContent = details.open ? 'Ocultar ficha' : 'Ver ficha completa';
      details.querySelector('summary')?.setAttribute('aria-expanded', String(details.open));
    });
  });
}

const followUpActionContainers = new WeakSet<HTMLElement>();

function bindDelegatedFollowUpActions(container: HTMLElement): void {
  if (followUpActionContainers.has(container)) return;
  followUpActionContainers.add(container);
  container.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const followUpSummary = target.closest<HTMLElement>('.mvp-lead-followup-menu > summary');
    if (followUpSummary && container.contains(followUpSummary)) {
      const details = followUpSummary.closest<HTMLDetailsElement>('.mvp-lead-followup-menu');
      window.requestAnimationFrame(() => {
        if (details?.open) details.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'nearest' });
      });
      return;
    }
    const button = target.closest<HTMLButtonElement>('[data-complete-client-follow-up]');
    if (!button || !container.contains(button)) return;
    event.preventDefault();
    event.stopPropagation();
    const client = visibleClients().find((item) => item.id === Number(button.dataset.completeClientFollowUp));
    if (!client || isTerminalClient(client)) return;
    const result = completeClientFollowUp(client);
    Object.assign(client, result.client);
    addActivity(result.activity);
    saveLeadFollowUp(`Seguimiento de lead completado: ${client.name}`, container);
  });
  container.addEventListener('submit', (event) => {
    const form = (event.target as HTMLElement).closest<HTMLFormElement>('[data-reprogram-client-follow-up]');
    if (!form || !container.contains(form)) return;
    event.preventDefault();
    const client = visibleClients().find((item) => item.id === Number(form.dataset.reprogramClientFollowUp));
    const date = new FormData(form).get('date')?.toString() || '';
    if (!client || !date || isTerminalClient(client)) return;
    const result = reprogramClientFollowUp(client, date);
    Object.assign(client, result.client);
    addActivity(result.activity);
    saveLeadFollowUp(`Seguimiento reprogramado: ${client.name}`, container);
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
  bindDelegatedFollowUpActions(container);
  bindFullSheets(container);
  visibleClients().forEach((client) => bindLeadQualificationPanel(container, client, () => renderMvpLeads(container)));
}

function updateStageOverflow(container: HTMLElement, centerSelected = false): void {
  const counters = container.querySelector<HTMLElement>('.mvp-stage-counters');
  const shell = container.querySelector<HTMLElement>('[data-stage-shell]');
  if (!counters || !shell) return;
  const update = (): void => {
    shell.dataset.overflowLeft = String(counters.scrollLeft > 2);
    shell.dataset.overflowRight = String(counters.scrollLeft + counters.clientWidth < counters.scrollWidth - 2);
  };
  counters.addEventListener('scroll', update, { passive: true });
  window.requestAnimationFrame(() => {
    if (centerSelected) counters.querySelector<HTMLElement>('.mvp-stage-counter.active')?.scrollIntoView({ block: 'nearest', inline: 'center' });
    update();
  });
}

function updateLeadResults(container: HTMLElement): void {
  const leads = leadRows();
  if (expandedClientId !== null && !leads.some((client) => client.id === expandedClientId)) expandedClientId = null;
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

function activeAssignees(): Array<{ id: number; name: string }> {
  return state.crm.teamMembers
    .filter((member) => member.status === 'Activo')
    .map((member) => ({ id: member.id, name: memberName(member.id) }));
}

function activeSecondaryFilters(): string[] {
  const active: string[] = [];
  if (filters.search.trim()) active.push(`Búsqueda: ${filters.search.trim()}`);
  if (filters.stage !== 'Todas') active.push(`Etapa: ${filters.stage}`);
  if (filters.temperature !== 'Todas') active.push(`Temperatura: ${filters.temperature}`);
  if (filters.overdueOnly) active.push('Vencidos');
  if (filters.missingNextActionOnly) active.push('Sin próxima acción');
  if (filters.assignee !== 'Todos') active.push(`Responsable: ${memberName(filters.assignee)}`);
  return active;
}

function filterPanel(): string {
  const visible = visibleClients();
  const counters = stageCounters(visible);
  const active = activeSecondaryFilters();
  const assignees = activeAssignees();
  const mobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 520px)').matches;
  const open = !mobile || active.length > 0;
  return `<div class="mvp-lead-filter-panel">
    <div class="mvp-lead-filter-primary">
      <label class="mvp-lead-search-field"><span>Buscar</span><input id="mvp-lead-search" type="search" value="${escapeHtml(filters.search)}" placeholder="Nombre, WhatsApp o interés"></label>
      <strong id="mvp-lead-count">${leadRows().length} de ${visible.length} leads</strong>
    </div>
    ${active.length ? `<div class="mvp-lead-active-filters"><div><strong>${active.length} ${active.length === 1 ? 'filtro activo' : 'filtros activos'}</strong><span>${escapeHtml(active.join(' · '))}</span></div><button type="button" class="quiet-button" data-clear-lead-filters>Limpiar</button></div>` : ''}
    <details class="mvp-lead-more-filters"${open ? ' open' : ''}>
      <summary><span>Más filtros</span><small>${escapeHtml(active.length ? active.join(' · ') : 'Etapa, temperatura, responsable y orden')}</small></summary>
      <div class="mvp-lead-filter-grid">
        <label><span>Etapa</span><select id="mvp-lead-stage-filter"><option value="Todas">Todas</option>${COMMERCIAL_STAGES.map((stage) => `<option value="${stage}"${selected(filters.stage, stage)}>${stage}</option>`).join('')}</select></label>
        <label><span>Temperatura</span><select id="mvp-lead-temperature-filter"><option value="Todas">Todas</option>${(['Caliente', 'Tibio', 'Frío'] as Temperature[]).map((temperature) => `<option value="${temperature}"${selected(filters.temperature, temperature)}>${temperature}</option>`).join('')}</select></label>
        ${assignees.length > 1 ? `<label><span>Responsable</span><select id="mvp-lead-assignee-filter"><option value="Todos">Todos</option>${assignees.map((member) => `<option value="${member.id}"${selected(filters.assignee, member.id)}>${escapeHtml(member.name)}</option>`).join('')}</select></label>` : ''}
        <label><span>Ordenar por</span><select id="mvp-lead-order"><option value="priority"${selected(filters.order, 'priority')}>Prioridad</option><option value="follow-up"${selected(filters.order, 'follow-up')}>Seguimiento</option><option value="recent"${selected(filters.order, 'recent')}>Más recientes</option><option value="name"${selected(filters.order, 'name')}>Nombre</option></select></label>
      </div>
      <div class="mvp-lead-filter-toggles"><label><input id="mvp-lead-overdue-filter" type="checkbox"${filters.overdueOnly ? ' checked' : ''}>Seguimientos vencidos</label><label><input id="mvp-lead-missing-action-filter" type="checkbox"${filters.missingNextActionOnly ? ' checked' : ''}>Sin próxima acción</label></div>
    </details>
    <div class="mvp-stage-counters-shell" data-stage-shell data-overflow-left="false" data-overflow-right="false"><div class="mvp-stage-counters" aria-label="Contadores por etapa"><button type="button" class="mvp-stage-counter${filters.stage === 'Todas' ? ' active' : ''}" data-stage-quick="Todas">Todos <b>${visible.length}</b></button>${COMMERCIAL_STAGES.map((stage) => `<button type="button" class="mvp-stage-counter${filters.stage === stage ? ' active' : ''}" data-stage-quick="${stage}">${stage} <b>${counters[stage]}</b></button>`).join('')}</div></div>
  </div>`;
}

function resetFilters(): void {
  filters = {
    search: '',
    stage: 'Todas',
    temperature: 'Todas',
    overdueOnly: false,
    missingNextActionOnly: false,
    assignee: 'Todos',
    order: 'priority',
  };
}

function bindFilters(container: HTMLElement): void {
  container.querySelector<HTMLInputElement>('#mvp-lead-search')?.addEventListener('input', (event) => {
    filters.search = (event.currentTarget as HTMLInputElement).value;
    updateLeadResults(container);
  });
  container.querySelector<HTMLSelectElement>('#mvp-lead-stage-filter')?.addEventListener('change', (event) => {
    filters.stage = (event.currentTarget as HTMLSelectElement).value as LeadFilters['stage'];
    renderMvpLeads(container, true);
  });
  container.querySelector<HTMLSelectElement>('#mvp-lead-temperature-filter')?.addEventListener('change', (event) => {
    filters.temperature = (event.currentTarget as HTMLSelectElement).value as LeadFilters['temperature'];
    updateLeadResults(container);
  });
  container.querySelector<HTMLSelectElement>('#mvp-lead-assignee-filter')?.addEventListener('change', (event) => {
    const value = (event.currentTarget as HTMLSelectElement).value;
    filters.assignee = value === 'Todos' ? 'Todos' : Number(value);
    renderMvpLeads(container);
  });
  container.querySelector<HTMLSelectElement>('#mvp-lead-order')?.addEventListener('change', (event) => {
    filters.order = (event.currentTarget as HTMLSelectElement).value as LeadOrder;
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
  container.querySelector<HTMLButtonElement>('[data-clear-lead-filters]')?.addEventListener('click', () => {
    resetFilters();
    renderMvpLeads(container);
  });
  container.querySelectorAll<HTMLButtonElement>('[data-stage-quick]').forEach((button) => {
    button.addEventListener('click', () => {
      filters.stage = button.dataset.stageQuick as LeadFilters['stage'];
      renderMvpLeads(container, true);
    });
  });
}

export function renderMvpLeads(container: HTMLElement, centerSelectedStage = false): void {
  const editing = visibleClients().find((client) => client.id === state.editingClientId) ?? null;
  const leads = leadRows();
  if (expandedClientId !== null && !leads.some((client) => client.id === expandedClientId)) expandedClientId = null;
  container.innerHTML = `<div class="mvp-page-heading"><div><h1>Leads</h1><p>Priorizá a quién contactar, resolvé la próxima acción y abrí la ficha completa solo cuando haga falta.</p></div><button type="button" data-toggle="client-form">Nuevo lead</button></div>${leadForm(editing)}${filterPanel()}<div id="mvp-lead-results" class="mvp-lead-list">${leads.map(card).join('') || '<p class="empty-state">No hay leads para mostrar con estos filtros.</p>'}</div>`;

  bindFilters(container);
  bindLeadCardActions(container);
  updateStageOverflow(container, centerSelectedStage);

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
  resetFilters();
  expandedClientId = null;
}

export function overdueReferenceDateForTests(): string {
  return localIsoDate();
}
