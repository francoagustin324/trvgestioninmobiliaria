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
  renderLeadCommercialSummary,
  renderLeadSecondaryMeta,
  renderSecondaryQualificationFields,
} from './lead-essential-ui.js';
import type { ActivityEntry, Client, CommercialStage, Temperature } from './models.js';
import {
  leadCompactPayment,
  leadCompactTimeframe,
  leadFollowUpPresentation,
  leadPrimaryAlert,
  sortLeadsForDailyWork,
  type LeadOrder,
} from './lead-daily-priority.js';
import { findDuplicateClient, formatPhone, isPlausiblePhone } from './phone-normalizer.js';
import { matchPropertiesForClient, type PropertyMatch } from './property-matching.js';
import { saveData, state } from './store.js';
import { addActivity, memberName, visibleClients, visibleProperties } from './team-access.js';
import { escapeHtml, formValues, nextId } from './utils.js';
import { appIcons } from './icons.js';

interface LeadUiFilters extends LeadFilters {
  assigneeId: number | 'Todos';
  order: LeadOrder;
}

let filters: LeadUiFilters = {
  search: '',
  stage: 'Todas',
  temperature: 'Todas',
  overdueOnly: false,
  missingNextActionOnly: false,
  assigneeId: 'Todos',
  order: 'Prioridad',
};
let expandedLeadId: number | null = null;

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
  const filtered = filterLeads(visibleClients(), filters)
    .filter((client) => filters.assigneeId === 'Todos' || client.assignedToId === filters.assigneeId);
  return sortLeadsForDailyWork(filtered, filters.order);
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

function qualificationUpdated(client: Client): string {
  if (!client.qualificationUpdatedAt) return 'Sin actualización registrada';
  const date = new Date(client.qualificationUpdatedAt);
  return Number.isNaN(date.getTime()) ? client.qualificationUpdatedAt : activityFormatter.format(date);
}

function detailValue(label: string, valueText: string | number | undefined, fallback = 'No confirmado'): string {
  return `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(valueText ?? '').trim() || fallback)}</strong></div>`;
}

function fullProfile(client: Client): string {
  const credit = [client.creditPossible?.trim(), client.creditApprovedAmount?.trim()].filter(Boolean).join(' · ') || 'No confirmado';
  return `<section class="mvp-lead-full-profile" data-full-profile="${client.id}">
    <div class="mvp-lead-full-grid">
      ${detailValue('Zona', client.zones)}
      ${detailValue('Finalidad', client.purpose)}
      ${detailValue('Puede avanzar', client.canMoveForward)}
      ${detailValue('Conoce la zona', client.knowsArea, 'Dato adicional no confirmado')}
      ${detailValue('Crédito', credit)}
      ${detailValue('Responsable', memberName(client.assignedToId), 'Sin asignar')}
      ${detailValue('Preferencias', client.preferences)}
      ${detailValue('Características', client.features)}
      ${detailValue('Objeciones', client.objections)}
      ${detailValue('Notas', client.notes)}
      ${detailValue('Actualización', qualificationUpdated(client))}
    </div>
    ${renderLeadSecondaryMeta(client)}
    ${renderLeadCommercialSummary(client)}
    ${historyBlock(client)}
    ${matchesForLead(client)}
    <aside class="mvp-buyer-evolution-note"><strong>Próxima fase</strong><span>Las propiedades compatibles podrán registrar Enviar al cliente, Ya enviada, Le interesó, No le interesó y Quiere visita sin improvisar estados en este PR.</span></aside>
  </section>`;
}

function compactBudget(client: Client): string {
  const budget = client.budget?.trim() || 'Sin presupuesto';
  if (!client.currency?.trim() || /\b(?:USD|ARS|EUR|US\$|d[oó]lares?|pesos?)\b/i.test(budget)) return budget;
  return `${client.currency.trim()} ${budget}`;
}

function quickFollowUpActions(client: Client): string {
  if (isTerminalClient(client)) return '';
  if (!client.nextAction?.trim() && !client.nextFollowUp) return '';
  return `<div class="mvp-lead-followup-actions">
    ${client.nextAction?.trim() && client.nextFollowUp ? `<button type="button" class="secondary mvp-compact-action" data-complete-followup="${client.id}">Completar</button>` : ''}
    <button type="button" class="secondary mvp-compact-action" data-reprogram-followup="${client.id}">Reprogramar</button>
  </div>`;
}

function card(client: Client): string {
  const digits = client.phone.replace(/\D/g, '');
  const stage = commercialStage(client);
  const terminal = isTerminalClient(client);
  const alert = leadPrimaryAlert(client);
  const followUp = leadFollowUpPresentation(client);
  const expanded = expandedLeadId === client.id;
  return `<article class="mvp-lead-card mvp-lead-card-with-matches mvp-lead-daily-card${terminal ? ' terminal' : ''}${expanded ? ' expanded' : ''}" data-lead-card="${client.id}">
    <div class="mvp-lead-compact-head">
      <div class="mvp-lead-title-line">${tempIcon(client.temperature)}<h3>${escapeHtml(client.name)}</h3><span class="mvp-stage-badge${terminal ? ' terminal' : ''}">${escapeHtml(stage)}</span></div>
      <span class="mvp-lead-alert ${alert.kind}">${escapeHtml(alert.label)}</span>
    </div>
    <p class="mvp-lead-interest">${client.interest ? escapeHtml(client.interest) : 'Sin interés definido'}</p>
    <div class="mvp-lead-compact-grid">
      <div><span>Presupuesto</span><strong>${escapeHtml(compactBudget(client))}</strong></div>
      <div><span>Pago / crédito</span><strong>${escapeHtml(leadCompactPayment(client))}</strong></div>
      <div><span>Plazo / urgencia</span><strong>${escapeHtml(leadCompactTimeframe(client))}</strong></div>
    </div>
    ${followUp ? `<div class="mvp-lead-next${followUp.overdue ? ' overdue' : ''}"><span>Próxima acción</span><strong>${escapeHtml(followUp.action)}</strong>${followUp.date ? `<small>${escapeHtml(followUp.date)}</small>` : ''}</div>` : ''}
    <div class="mvp-lead-quick-row">
      <div class="mvp-lead-contact"><a class="mvp-contact-btn wa" href="https://wa.me/${digits}" target="_blank" rel="noopener noreferrer" title="WhatsApp · ${escapeHtml(formatPhone(client.phone))}" aria-label="Enviar WhatsApp">${appIcons.whatsapp}</a><a class="mvp-contact-btn call" href="tel:+${digits}" title="Llamar · ${escapeHtml(formatPhone(client.phone))}" aria-label="Llamar">${appIcons.phone}</a>${client.email ? `<a class="mvp-contact-btn mail" href="mailto:${escapeHtml(client.email)}" title="${escapeHtml(client.email)}" aria-label="Enviar email">${appIcons.mail}</a>` : ''}</div>
      <button type="button" class="secondary mvp-auto-qualify-button" data-auto-qualify-client="${client.id}">Calificar automáticamente</button>
    </div>
    ${quickFollowUpActions(client)}
    <div class="mvp-lead-disclosure-row">
      <button type="button" class="secondary mvp-lead-toggle" data-toggle-lead-full="${client.id}" aria-expanded="${expanded}">${expanded ? 'Ocultar ficha' : 'Ver ficha completa'}</button>
      <details class="mvp-lead-card-menu"><summary aria-label="Más acciones">•••</summary><div><button type="button" class="secondary mvp-icon-btn" data-edit-client="${client.id}" aria-controls="mvp-lead-form" title="Editar" aria-label="Editar ${escapeHtml(client.name)}">${appIcons.edit}</button><button type="button" class="delete mvp-icon-btn" data-delete="clients" data-id="${client.id}" title="Eliminar" aria-label="Eliminar ${escapeHtml(client.name)}">×</button></div></details>
    </div>
    ${expanded ? fullProfile(client) : ''}
    ${renderLeadQualificationPanel(client)}
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
  container.querySelectorAll<HTMLButtonElement>('[data-toggle-lead-full]').forEach((button) => {
    button.addEventListener('click', () => {
      const clientId = Number(button.dataset.toggleLeadFull);
      if (!clientId || !visibleClients().some((client) => client.id === clientId)) return;
      expandedLeadId = expandedLeadId === clientId ? null : clientId;
      renderMvpLeads(container);
      if (expandedLeadId) window.requestAnimationFrame(() => container.querySelector(`[data-lead-card="${expandedLeadId}"]`)?.scrollIntoView({ block: 'nearest' }));
    });
  });
  container.querySelectorAll<HTMLButtonElement>('[data-complete-followup]').forEach((button) => {
    button.addEventListener('click', () => {
      const clientId = Number(button.dataset.completeFollowup);
      const client = visibleClients().find((item) => item.id === clientId);
      if (!client) return;
      const completed = completeClientFollowUp(client);
      state.crm.clients = upsertClient(state.crm.clients, completed.client);
      addActivity(completed.activity);
      saveData(`Seguimiento completado: ${client.name}`);
      renderMvpLeads(container);
    });
  });
  container.querySelectorAll<HTMLButtonElement>('[data-reprogram-followup]').forEach((button) => {
    button.addEventListener('click', () => {
      const clientId = Number(button.dataset.reprogramFollowup);
      const client = visibleClients().find((item) => item.id === clientId);
      if (!client) return;
      const date = window.prompt('Nueva fecha de seguimiento (AAAA-MM-DD)', client.nextFollowUp || localIsoDate());
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
      const reprogrammed = reprogramClientFollowUp(client, date);
      state.crm.clients = upsertClient(state.crm.clients, reprogrammed.client);
      addActivity(reprogrammed.activity);
      saveData(`Seguimiento reprogramado: ${client.name}`);
      renderMvpLeads(container);
    });
  });
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
  if (expandedLeadId && !leads.some((client) => client.id === expandedLeadId)) expandedLeadId = null;
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

function availableAssignees(): Array<{ id: number; name: string }> {
  const visibleIds = new Set(visibleClients().map((client) => client.assignedToId).filter((id): id is number => Boolean(id)));
  return state.crm.teamMembers
    .filter((member) => member.status === 'Activo' && visibleIds.has(member.id))
    .map((member) => ({ id: member.id, name: memberName(member.id) }));
}

function activeSecondaryFilters(): string[] {
  const active: string[] = [];
  if (filters.stage !== 'Todas') active.push(`Etapa: ${filters.stage}`);
  if (filters.temperature !== 'Todas') active.push(`Temperatura: ${filters.temperature}`);
  if (filters.overdueOnly) active.push('Vencidos');
  if (filters.missingNextActionOnly) active.push('Sin próxima acción');
  if (filters.assigneeId !== 'Todos') active.push(`Responsable: ${memberName(filters.assigneeId)}`);
  if (filters.order !== 'Prioridad') active.push(`Orden: ${filters.order}`);
  return active;
}

function filterPanel(): string {
  const visible = visibleClients();
  const counters = stageCounters(visible);
  const active = activeSecondaryFilters();
  const assignees = availableAssignees();
  const mobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 520px)').matches;
  const open = !mobile || active.length > 0;
  return `<div class="mvp-lead-filter-panel">
    <div class="mvp-lead-filter-primary">
      <label class="mvp-lead-search-field"><span>Buscar</span><input id="mvp-lead-search" type="search" value="${escapeHtml(filters.search)}" placeholder="Nombre, WhatsApp o interés"></label>
      <strong id="mvp-lead-count">${leadRows().length} de ${visible.length} leads</strong>
    </div>
    <details class="mvp-lead-more-filters"${open ? ' open' : ''}>
      <summary><span>Más filtros${active.length ? ` · ${active.length}` : ''}</span><small>${escapeHtml(active.length ? active.join(' · ') : 'Etapa, temperatura, responsable y orden')}</small></summary>
      <div class="mvp-lead-filter-grid">
        <label><span>Etapa</span><select id="mvp-lead-stage-filter"><option value="Todas">Todas</option>${COMMERCIAL_STAGES.map((stage) => `<option value="${stage}"${selected(filters.stage, stage)}>${stage}</option>`).join('')}</select></label>
        <label><span>Temperatura</span><select id="mvp-lead-temperature-filter"><option value="Todas">Todas</option>${(['Caliente', 'Tibio', 'Frío'] as Temperature[]).map((temperature) => `<option value="${temperature}"${selected(filters.temperature, temperature)}>${temperature}</option>`).join('')}</select></label>
        ${assignees.length > 1 ? `<label><span>Responsable</span><select id="mvp-lead-assignee-filter"><option value="Todos">Todos</option>${assignees.map((member) => `<option value="${member.id}"${filters.assigneeId === member.id ? ' selected' : ''}>${escapeHtml(member.name)}</option>`).join('')}</select></label>` : ''}
        <label><span>Ordenar por</span><select id="mvp-lead-order"><option value="Prioridad"${selected(filters.order, 'Prioridad')}>Prioridad</option><option value="Seguimiento"${selected(filters.order, 'Seguimiento')}>Seguimiento</option><option value="Más recientes"${selected(filters.order, 'Más recientes')}>Más recientes</option><option value="Nombre"${selected(filters.order, 'Nombre')}>Nombre</option></select></label>
      </div>
      <div class="mvp-lead-filter-toggles"><label><input id="mvp-lead-overdue-filter" type="checkbox"${filters.overdueOnly ? ' checked' : ''}>Seguimientos vencidos</label><label><input id="mvp-lead-missing-action-filter" type="checkbox"${filters.missingNextActionOnly ? ' checked' : ''}>Sin próxima acción</label>${active.length ? '<button type="button" class="secondary mvp-clear-lead-filters" data-clear-lead-filters>Limpiar</button>' : ''}</div>
    </details>
    <div class="mvp-stage-counters-shell" data-pipeline-shell><div class="mvp-stage-counters" aria-label="Contadores por etapa"><button type="button" class="mvp-stage-counter${filters.stage === 'Todas' ? ' active' : ''}" data-stage-quick="Todas">Todos <b>${visible.length}</b></button>${COMMERCIAL_STAGES.map((stage) => `<button type="button" class="mvp-stage-counter${filters.stage === stage ? ' active' : ''}" data-stage-quick="${stage}">${stage} <b>${counters[stage]}</b></button>`).join('')}</div></div>
  </div>`;
}

function bindPipelineScroll(container: HTMLElement): void {
  const shell = container.querySelector<HTMLElement>('[data-pipeline-shell]');
  const pipeline = shell?.querySelector<HTMLElement>('.mvp-stage-counters');
  if (!shell || !pipeline) return;
  const update = (): void => {
    shell.classList.toggle('has-left', pipeline.scrollLeft > 2);
    shell.classList.toggle('has-right', pipeline.scrollLeft + pipeline.clientWidth < pipeline.scrollWidth - 2);
  };
  pipeline.addEventListener('scroll', update, { passive: true });
  const selectedChip = pipeline.querySelector<HTMLElement>('.mvp-stage-counter.active');
  selectedChip?.scrollIntoView({ block: 'nearest', inline: 'center' });
  window.requestAnimationFrame(update);
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
  container.querySelector<HTMLSelectElement>('#mvp-lead-assignee-filter')?.addEventListener('change', (event) => {
    const current = (event.currentTarget as HTMLSelectElement).value;
    filters.assigneeId = current === 'Todos' ? 'Todos' : Number(current);
    updateLeadResults(container);
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
  container.querySelector<HTMLElement>('[data-clear-lead-filters]')?.addEventListener('click', () => {
    filters = { search: '', stage: 'Todas', temperature: 'Todas', overdueOnly: false, missingNextActionOnly: false, assigneeId: 'Todos', order: 'Prioridad' };
    renderMvpLeads(container);
  });
  container.querySelectorAll<HTMLButtonElement>('[data-stage-quick]').forEach((button) => {
    button.addEventListener('click', () => {
      filters.stage = button.dataset.stageQuick as LeadFilters['stage'];
      renderMvpLeads(container);
    });
  });
  bindPipelineScroll(container);
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
  filters = { search: '', stage: 'Todas', temperature: 'Todas', overdueOnly: false, missingNextActionOnly: false, assigneeId: 'Todos', order: 'Prioridad' };
  expandedLeadId = null;
}

export function overdueReferenceDateForTests(): string {
  return localIsoDate();
}
