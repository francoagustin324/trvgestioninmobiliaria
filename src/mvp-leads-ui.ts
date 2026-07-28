import { clientFromFormValues, upsertClient } from './client-editor.js';
import {
  activitiesForClientSave,
  commercialStage,
  COMMERCIAL_STAGES,
  filterLeads,
  completeClientFollowUp,
  isTerminalClient,
  reprogramClientFollowUp,
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
import { followUpDisplay, primaryLeadAlert, readableResponsible, relativeCommercialDate, sortLeads, type LeadSort } from './lead-list-priority.js';
import { followUpDisplay, primaryLeadAlert, readableResponsible, relativeCommercialDate, sortLeads, type LeadSort } from './lead-list-priority.js';
import { followUpDisplay, primaryLeadAlert, readableResponsible, relativeCommercialDate, sortLeads, type LeadSort } from './lead-list-priority.js';
import { findDuplicateClient, formatPhone, isPlausiblePhone } from './phone-normalizer.js';
import { matchPropertiesForClient, type PropertyMatch } from './property-matching.js';
import { saveData, state } from './store.js';
import { addActivity, memberName, visibleClients, visibleProperties } from './team-access.js';
import { escapeHtml, formValues, nextId } from './utils.js';
import { appIcons } from './icons.js';

type ExtendedLeadFilters = LeadFilters & { assignedTo: number | 'Todos'; order: LeadSort };

let expandedClientId: number | null = null;

let filters: ExtendedLeadFilters = {
  search: '',
  stage: 'Todas',
  temperature: 'Todas',
  overdueOnly: false,
  missingNextActionOnly: false,
  assignedTo: 'Todos',
  order: 'priority',
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
  const filtered = filterLeads(visibleClients(), filters)
    .filter((client) => filters.assignedTo === 'Todos' || client.assignedToId === filters.assignedTo);
  return sortLeads(filtered, filters.order);
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

function expandedDetails(client: Client): string {
  const updated = client.qualificationUpdatedAt ? new Date(client.qualificationUpdatedAt) : null;
  const updatedText = updated && !Number.isNaN(updated.getTime()) ? activityFormatter.format(updated) : 'Sin fecha registrada';
  const responsible = readableResponsible(client, state.crm.teamMembers, state.crm.settings.profileName, state.crm.settings.profileEmail);
  const optional = [
    ['Zona', client.zones], ['Finalidad', client.purpose], ['Puede avanzar', client.canMoveForward],
    ['Conoce la zona', client.knowsArea], ['Crédito', client.creditPossible], ['Monto aprobado', client.creditApprovedAmount],
    ['Preferencias', client.preferences], ['Características', client.features], ['Objeciones', client.objections], ['Notas', client.notes],
  ].filter(([, item]) => String(item || '').trim());
  return `<div class="compact-lead-expanded" data-lead-expanded="${client.id}"${expandedClientId === client.id ? '' : ' hidden'}>
    ${renderLeadSecondaryMeta(client)}
    <div class="compact-detail-grid">${optional.map(([label, item]) => `<div><span>${escapeHtml(String(label))}</span><strong>${escapeHtml(String(item))}</strong></div>`).join('') || '<p>Sin información adicional cargada.</p>'}<div><span>Responsable</span><strong>${escapeHtml(responsible)}</strong></div><div><span>Última actualización</span><strong>${escapeHtml(updatedText)}</strong></div></div>
    ${renderLeadCommercialSummary(client)}
    ${historyBlock(client)}
    ${matchesForLead(client)}
    <p class="mvp-match-empty">Evolución futura: las propiedades compatibles podrán marcarse como Enviar, Ya enviada, Le interesó, No le interesó o Quiere visita sin improvisar persistencia en esta fase.</p>
  </div>`;
}

function expandedDetails(client: Client): string {
  const updated = client.qualificationUpdatedAt ? new Date(client.qualificationUpdatedAt) : null;
  const updatedText = updated && !Number.isNaN(updated.getTime()) ? activityFormatter.format(updated) : 'Sin fecha registrada';
  const responsible = readableResponsible(client, state.crm.teamMembers, state.crm.settings.profileName, state.crm.settings.profileEmail);
  const optional = [
    ['Zona', client.zones], ['Finalidad', client.purpose], ['Puede avanzar', client.canMoveForward],
    ['Conoce la zona', client.knowsArea], ['Crédito', client.creditPossible], ['Monto aprobado', client.creditApprovedAmount],
    ['Preferencias', client.preferences], ['Características', client.features], ['Objeciones', client.objections], ['Notas', client.notes],
  ].filter(([, item]) => String(item || '').trim());
  return `<div class="compact-lead-expanded" data-lead-expanded="${client.id}"${expandedClientId === client.id ? '' : ' hidden'}>
    ${renderLeadSecondaryMeta(client)}
    <div class="compact-detail-grid">${optional.map(([label, item]) => `<div><span>${escapeHtml(String(label))}</span><strong>${escapeHtml(String(item))}</strong></div>`).join('') || '<p>Sin información adicional cargada.</p>'}<div><span>Responsable</span><strong>${escapeHtml(responsible)}</strong></div><div><span>Última actualización</span><strong>${escapeHtml(updatedText)}</strong></div></div>
    ${renderLeadCommercialSummary(client)}
    ${historyBlock(client)}
    ${matchesForLead(client)}
    <p class="mvp-match-empty">Evolución futura: las propiedades compatibles podrán marcarse como Enviar, Ya enviada, Le interesó, No le interesó o Quiere visita sin improvisar persistencia en esta fase.</p>
  </div>`;
}

function expandedDetails(client: Client): string {
  const updated = client.qualificationUpdatedAt ? new Date(client.qualificationUpdatedAt) : null;
  const updatedText = updated && !Number.isNaN(updated.getTime()) ? activityFormatter.format(updated) : 'Sin fecha registrada';
  const responsible = readableResponsible(client, state.crm.teamMembers, state.crm.settings.profileName, state.crm.settings.profileEmail);
  const optional = [
    ['Zona', client.zones], ['Finalidad', client.purpose], ['Puede avanzar', client.canMoveForward],
    ['Conoce la zona', client.knowsArea], ['Crédito', client.creditPossible], ['Monto aprobado', client.creditApprovedAmount],
    ['Preferencias', client.preferences], ['Características', client.features], ['Objeciones', client.objections], ['Notas', client.notes],
  ].filter(([, item]) => String(item || '').trim());
  return `<div class="compact-lead-expanded" data-lead-expanded="${client.id}"${expandedClientId === client.id ? '' : ' hidden'}>
    ${renderLeadSecondaryMeta(client)}
    <div class="compact-detail-grid">${optional.map(([label, item]) => `<div><span>${escapeHtml(String(label))}</span><strong>${escapeHtml(String(item))}</strong></div>`).join('') || '<p>Sin información adicional cargada.</p>'}<div><span>Responsable</span><strong>${escapeHtml(responsible)}</strong></div><div><span>Última actualización</span><strong>${escapeHtml(updatedText)}</strong></div></div>
    ${renderLeadCommercialSummary(client)}
    ${historyBlock(client)}
    ${matchesForLead(client)}
    <p class="mvp-match-empty">Evolución futura: las propiedades compatibles podrán marcarse como Enviar, Ya enviada, Le interesó, No le interesó o Quiere visita sin improvisar persistencia en esta fase.</p>
  </div>`;
}

function card(client: Client): string {
  const digits = client.phone.replace(/\D/g, '');
  const stage = commercialStage(client);
  const terminal = isTerminalClient(client);
  const alert = primaryLeadAlert(client);
  const followUp = followUpDisplay(client);
  const payment = client.creditPossible?.trim() && client.paymentMethod?.includes('Crédito')
    ? `${client.paymentMethod} · ${client.creditPossible}` : client.paymentMethod?.trim() || client.creditPossible?.trim() || 'No confirmado';
  const urgency = [client.purchaseTimeframe, client.urgency].filter(Boolean).join(' · ') || 'No confirmado';
  return `<article class="mvp-lead-card compact-lead-card${terminal ? ' terminal' : ''}" data-client-id="${client.id}">
    <div class="compact-lead-head"><div class="compact-lead-identity"><div class="mvp-lead-title-line">${tempIcon(client.temperature)}<h3>${escapeHtml(client.name)}</h3></div><span class="mvp-stage-badge${terminal ? ' terminal' : ''}">${escapeHtml(stage)}</span></div><span class="compact-lead-alert ${alert.kind}">${escapeHtml(alert.label)}</span></div>
    <p class="compact-lead-interest">${client.interest ? escapeHtml(client.interest) : 'Sin búsqueda definida'}</p>
    <div class="compact-lead-facts"><div><span>Presupuesto</span><strong>${summaryValue(client.budget, 'No confirmado')}</strong></div><div><span>Pago / crédito</span><strong>${escapeHtml(payment)}</strong></div><div><span>Plazo / urgencia</span><strong>${escapeHtml(urgency)}</strong></div></div>
    ${terminal ? '' : `<div class="compact-followup"><div><span>Próxima acción</span><strong>${escapeHtml(followUp.action)}</strong></div><strong class="compact-followup-time">${escapeHtml(followUp.date)}</strong></div>`}
    <div class="compact-lead-actions"><a class="mvp-contact-btn wa" href="https://wa.me/${digits}" target="_blank" rel="noopener noreferrer" title="WhatsApp · ${escapeHtml(formatPhone(client.phone))}" aria-label="Enviar WhatsApp">${appIcons.whatsapp}</a><a class="mvp-contact-btn call" href="tel:+${digits}" title="Llamar · ${escapeHtml(formatPhone(client.phone))}" aria-label="Llamar">${appIcons.phone}</a>${client.email ? `<a class="mvp-contact-btn mail" href="mailto:${escapeHtml(client.email)}" title="${escapeHtml(client.email)}" aria-label="Enviar email">${appIcons.mail}</a>` : '<span class="mvp-contact-btn mail" data-disabled aria-label="Sin email cargado">' + appIcons.mail + '</span>'}<button type="button" class="secondary mvp-auto-qualify-button" data-auto-qualify-client="${client.id}">Calificar automáticamente</button><div class="compact-lead-secondary"><button type="button" class="secondary mvp-icon-btn" data-edit-client="${client.id}" title="Editar" aria-label="Editar ${escapeHtml(client.name)}">${appIcons.edit}</button><button type="button" class="delete mvp-icon-btn" data-delete="clients" data-id="${client.id}" title="Eliminar" aria-label="Eliminar ${escapeHtml(client.name)}">×</button></div></div>
    ${!terminal && followUp.pending ? `<details class="compact-followup-menu"><summary>Gestionar seguimiento</summary><div class="compact-followup-controls"><button type="button" class="secondary" data-complete-followup="${client.id}">Completar seguimiento</button><label>Nueva fecha<input type="date" data-reprogram-date="${client.id}" value="${escapeHtml(client.nextFollowUp || '')}"></label><button type="button" class="secondary" data-reprogram-followup="${client.id}">Reprogramar</button></div></details>` : ''}
    <button type="button" class="secondary compact-lead-toggle" data-toggle-lead-details="${client.id}">${expandedClientId === client.id ? 'Ocultar ficha' : 'Ver ficha completa'}</button>
    ${expandedDetails(client)}
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
  container.querySelectorAll<HTMLButtonElement>('[data-toggle-lead-details]').forEach((button) => {
    button.addEventListener('click', () => {
      const clientId = Number(button.dataset.toggleLeadDetails);
      expandedClientId = expandedClientId === clientId ? null : clientId;
      renderMvpLeads(container);
      if (expandedClientId) window.requestAnimationFrame(() => container.querySelector(`[data-client-id="${expandedClientId}"]`)?.scrollIntoView({ block: 'nearest' }));
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
      const input = container.querySelector<HTMLInputElement>(`[data-reprogram-date="${clientId}"]`);
      if (!client || !input?.value) return;
      const reprogrammed = reprogramClientFollowUp(client, input.value);
      state.crm.clients = upsertClient(state.crm.clients, reprogrammed.client);
      addActivity(reprogrammed.activity);
      saveData(`Seguimiento reprogramado: ${client.name}`);
      renderMvpLeads(container);
    });
  });
  container.querySelectorAll<HTMLButtonElement>('[data-toggle-lead-details]').forEach((button) => {
    button.addEventListener('click', () => {
      const clientId = Number(button.dataset.toggleLeadDetails);
      expandedClientId = expandedClientId === clientId ? null : clientId;
      renderMvpLeads(container);
      if (expandedClientId) window.requestAnimationFrame(() => container.querySelector(`[data-client-id="${expandedClientId}"]`)?.scrollIntoView({ block: 'nearest' }));
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
      const input = container.querySelector<HTMLInputElement>(`[data-reprogram-date="${clientId}"]`);
      if (!client || !input?.value) return;
      const reprogrammed = reprogramClientFollowUp(client, input.value);
      state.crm.clients = upsertClient(state.crm.clients, reprogrammed.client);
      addActivity(reprogrammed.activity);
      saveData(`Seguimiento reprogramado: ${client.name}`);
      renderMvpLeads(container);
    });
  });
  container.querySelectorAll<HTMLButtonElement>('[data-toggle-lead-details]').forEach((button) => {
    button.addEventListener('click', () => {
      const clientId = Number(button.dataset.toggleLeadDetails);
      expandedClientId = expandedClientId === clientId ? null : clientId;
      renderMvpLeads(container);
      if (expandedClientId) window.requestAnimationFrame(() => container.querySelector(`[data-client-id="${expandedClientId}"]`)?.scrollIntoView({ block: 'nearest' }));
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
      const input = container.querySelector<HTMLInputElement>(`[data-reprogram-date="${clientId}"]`);
      if (!client || !input?.value) return;
      const reprogrammed = reprogramClientFollowUp(client, input.value);
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
  if (filters.assignedTo !== 'Todos') active.push(`Responsable: ${readableResponsible({ assignedToId: filters.assignedTo } as Client, state.crm.teamMembers, state.crm.settings.profileName, state.crm.settings.profileEmail)}`);
  if (filters.order !== 'priority') active.push(`Orden: ${filters.order}`);
  if (filters.assignedTo !== 'Todos') active.push(`Responsable: ${readableResponsible({ assignedToId: filters.assignedTo } as Client, state.crm.teamMembers, state.crm.settings.profileName, state.crm.settings.profileEmail)}`);
  if (filters.order !== 'priority') active.push(`Orden: ${filters.order}`);
  if (filters.assignedTo !== 'Todos') active.push(`Responsable: ${readableResponsible({ assignedToId: filters.assignedTo } as Client, state.crm.teamMembers, state.crm.settings.profileName, state.crm.settings.profileEmail)}`);
  if (filters.order !== 'priority') active.push(`Orden: ${filters.order}`);
  return active;
}

function filterPanel(): string {
  const visible = visibleClients();
  const counters = stageCounters(visible);
  const active = activeSecondaryFilters();
  const mobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 520px)').matches;
  const open = !mobile || active.length > 0;
  const members = state.crm.teamMembers.filter((member) => member.status === 'Activo');
  return `<div class="mvp-lead-filter-panel">
    <div class="mvp-lead-filter-primary"><label class="mvp-lead-search-field"><span>Buscar</span><input id="mvp-lead-search" type="search" value="${escapeHtml(filters.search)}" placeholder="Nombre, WhatsApp o interés"></label><strong id="mvp-lead-count">${leadRows().length} de ${visible.length} leads</strong></div>
    ${active.length ? `<div class="mvp-filter-active-summary"><b>${active.length} filtros activos</b><span>${escapeHtml(active.join(' · '))}</span><button type="button" class="secondary mvp-filter-clear" data-clear-lead-filters>Limpiar</button></div>` : ''}
    <details class="mvp-lead-more-filters"${open ? ' open' : ''}><summary><span>Más filtros</span><small>${escapeHtml(active.length ? active.join(' · ') : 'Etapa, temperatura, responsable y orden')}</small></summary><div class="mvp-lead-filter-grid">
      <label><span>Etapa</span><select id="mvp-lead-stage-filter"><option value="Todas">Todas</option>${COMMERCIAL_STAGES.map((stage) => `<option value="${stage}"${selected(filters.stage, stage)}>${stage}</option>`).join('')}</select></label>
      <label><span>Temperatura</span><select id="mvp-lead-temperature-filter"><option value="Todas">Todas</option>${(['Caliente', 'Tibio', 'Frío'] as Temperature[]).map((temperature) => `<option value="${temperature}"${selected(filters.temperature, temperature)}>${temperature}</option>`).join('')}</select></label>
      ${members.length > 1 ? `<label><span>Responsable</span><select id="mvp-lead-assigned-filter"><option value="Todos">Todos</option>${members.map((member) => `<option value="${member.id}"${filters.assignedTo === member.id ? ' selected' : ''}>${escapeHtml(member.name || member.email)}</option>`).join('')}</select></label>` : ''}
      <label><span>Ordenar por</span><select id="mvp-lead-order" class="mvp-result-order"><option value="priority"${selected(filters.order, 'priority')}>Prioridad</option><option value="followup"${selected(filters.order, 'followup')}>Seguimiento</option><option value="recent"${selected(filters.order, 'recent')}>Más recientes</option><option value="name"${selected(filters.order, 'name')}>Nombre</option></select></label>
    </div><div class="mvp-lead-filter-toggles"><label><input id="mvp-lead-overdue-filter" type="checkbox"${filters.overdueOnly ? ' checked' : ''}>Seguimientos vencidos</label><label><input id="mvp-lead-missing-action-filter" type="checkbox"${filters.missingNextActionOnly ? ' checked' : ''}>Sin próxima acción completa</label></div></details>
    <div class="mvp-stage-counters" aria-label="Contadores por etapa"><button type="button" class="mvp-stage-counter${filters.stage === 'Todas' ? ' active' : ''}" data-stage-quick="Todas">Todos <b>${visible.length}</b></button>${COMMERCIAL_STAGES.map((stage) => `<button type="button" class="mvp-stage-counter${filters.stage === stage ? ' active' : ''}" data-stage-quick="${stage}">${stage} <b>${counters[stage]}</b></button>`).join('')}</div>
  </div>`;
}

function bindFilters(container: HTMLElement): void {
  container.querySelector<HTMLSelectElement>('#mvp-lead-assigned-filter')?.addEventListener('change', (event) => {
    const value = (event.currentTarget as HTMLSelectElement).value;
    filters.assignedTo = value === 'Todos' ? 'Todos' : Number(value);
    renderMvpLeads(container);
  });
  container.querySelector<HTMLSelectElement>('#mvp-lead-order')?.addEventListener('change', (event) => {
    filters.order = (event.currentTarget as HTMLSelectElement).value as LeadSort;
    renderMvpLeads(container);
  });
  container.querySelector<HTMLButtonElement>('[data-clear-lead-filters]')?.addEventListener('click', () => {
    filters = { search: '', stage: 'Todas', temperature: 'Todas', overdueOnly: false, missingNextActionOnly: false, assignedTo: 'Todos', order: 'priority' };
    renderMvpLeads(container);
  });
  const pipeline = container.querySelector<HTMLElement>('.mvp-stage-counters');
  const updatePipelineEdges = (): void => {
    if (!pipeline) return;
    pipeline.classList.toggle('can-scroll-left', pipeline.scrollLeft > 2);
    pipeline.classList.toggle('can-scroll-right', pipeline.scrollLeft + pipeline.clientWidth < pipeline.scrollWidth - 2);
  };
  pipeline?.addEventListener('scroll', updatePipelineEdges, { passive: true });
  updatePipelineEdges();
  container.querySelector<HTMLSelectElement>('#mvp-lead-assigned-filter')?.addEventListener('change', (event) => {
    const value = (event.currentTarget as HTMLSelectElement).value;
    filters.assignedTo = value === 'Todos' ? 'Todos' : Number(value);
    renderMvpLeads(container);
  });
  container.querySelector<HTMLSelectElement>('#mvp-lead-order')?.addEventListener('change', (event) => {
    filters.order = (event.currentTarget as HTMLSelectElement).value as LeadSort;
    renderMvpLeads(container);
  });
  container.querySelector<HTMLButtonElement>('[data-clear-lead-filters]')?.addEventListener('click', () => {
    filters = { search: '', stage: 'Todas', temperature: 'Todas', overdueOnly: false, missingNextActionOnly: false, assignedTo: 'Todos', order: 'priority' };
    renderMvpLeads(container);
  });
  const pipeline = container.querySelector<HTMLElement>('.mvp-stage-counters');
  const updatePipelineEdges = (): void => {
    if (!pipeline) return;
    pipeline.classList.toggle('can-scroll-left', pipeline.scrollLeft > 2);
    pipeline.classList.toggle('can-scroll-right', pipeline.scrollLeft + pipeline.clientWidth < pipeline.scrollWidth - 2);
  };
  pipeline?.addEventListener('scroll', updatePipelineEdges, { passive: true });
  updatePipelineEdges();
  container.querySelector<HTMLSelectElement>('#mvp-lead-assigned-filter')?.addEventListener('change', (event) => {
    const value = (event.currentTarget as HTMLSelectElement).value;
    filters.assignedTo = value === 'Todos' ? 'Todos' : Number(value);
    renderMvpLeads(container);
  });
  container.querySelector<HTMLSelectElement>('#mvp-lead-order')?.addEventListener('change', (event) => {
    filters.order = (event.currentTarget as HTMLSelectElement).value as LeadSort;
    renderMvpLeads(container);
  });
  container.querySelector<HTMLButtonElement>('[data-clear-lead-filters]')?.addEventListener('click', () => {
    filters = { search: '', stage: 'Todas', temperature: 'Todas', overdueOnly: false, missingNextActionOnly: false, assignedTo: 'Todos', order: 'priority' };
    renderMvpLeads(container);
  });
  const pipeline = container.querySelector<HTMLElement>('.mvp-stage-counters');
  const updatePipelineEdges = (): void => {
    if (!pipeline) return;
    pipeline.classList.toggle('can-scroll-left', pipeline.scrollLeft > 2);
    pipeline.classList.toggle('can-scroll-right', pipeline.scrollLeft + pipeline.clientWidth < pipeline.scrollWidth - 2);
  };
  pipeline?.addEventListener('scroll', updatePipelineEdges, { passive: true });
  updatePipelineEdges();
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
      window.requestAnimationFrame(() => container.querySelector<HTMLElement>('.mvp-stage-counter.active')?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' }));
    });
  });
}

export function renderMvpLeads(container: HTMLElement): void {
  const editing = visibleClients().find((client) => client.id === state.editingClientId) ?? null;
  const leads = leadRows();
  if (expandedClientId && !leads.some((client) => client.id === expandedClientId)) expandedClientId = null;
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
  filters = { search: '', stage: 'Todas', temperature: 'Todas', overdueOnly: false, missingNextActionOnly: false, assignedTo: 'Todos', order: 'priority' };
  expandedClientId = null;
}

export function overdueReferenceDateForTests(): string {
  return localIsoDate();
}
