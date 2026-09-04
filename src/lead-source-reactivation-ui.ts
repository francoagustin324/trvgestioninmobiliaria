import { activitiesForClientSave, localIsoDate } from './lead-pipeline.js';
import {
  applyLeadSourceMetadata,
  LEAD_SOURCES,
  leadSourceChangeActivity,
  leadSourceDisplay,
  leadSourceMatchesFilter,
  leadSourceSignature,
  leadSourceSummary,
  type LeadSourceFilter,
} from './lead-source.js';
import type { Client, DealCurrency } from './models.js';
import {
  addIsoDays,
  reactivationCandidates,
  snoozeReactivation,
  type ReactivationCandidate,
  type ReactivationSnoozeDays,
} from './reactivation-engine.js';
import { saveData, state } from './store.js';
import { addActivity, visibleClients } from './team-access.js';
import { escapeHtml } from './utils.js';

const STYLE_ID = 'propcontrol-lead-source-reactivation-styles';
const SOURCE_FILTER_ID = 'pc-lead-source-filter';
const VERSION = '20260903-p1-3-a1';
let sourceFilter: LeadSourceFilter = 'Todas';
let showAllReactivation = false;
let enhancementQueued = false;
let installed = false;

interface PendingSourceActivity {
  clientId: number;
  desiredSignature: string;
  activity: NonNullable<ReturnType<typeof leadSourceChangeActivity>>;
  expiresAt: number;
}

let pendingSourceActivity: PendingSourceActivity | null = null;

const moneyFormatter = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });

function installStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const link = document.createElement('link');
  link.id = STYLE_ID;
  link.rel = 'stylesheet';
  link.href = `/src/lead-source-reactivation.css?v=${VERSION}`;
  document.head.append(link);
}

function formValues(form: HTMLFormElement): Record<string, string> {
  return Object.fromEntries(new FormData(form).entries()) as Record<string, string>;
}

function sourceOptions(current: string | undefined, allowMissing: boolean): string {
  const missingLabel = allowMissing ? 'Origen no informado' : 'Elegir origen';
  const first = `<option value=""${current ? '' : ' selected'}>${missingLabel}</option>`;
  return first + LEAD_SOURCES.map((source) => (
    `<option value="${escapeHtml(source)}"${current === source ? ' selected' : ''}>${escapeHtml(source)}</option>`
  )).join('');
}

function syncOtherDetailRequirement(form: HTMLFormElement): void {
  const source = form.elements.namedItem('leadSource');
  const detail = form.elements.namedItem('leadSourceDetail');
  if (!(source instanceof HTMLSelectElement) || !(detail instanceof HTMLInputElement)) return;
  detail.required = source.value === 'Otro';
  detail.placeholder = source.value === 'Referido'
    ? 'Ej. Juan Pérez'
    : source.value === 'Zonaprop'
      ? 'Ej. propiedad o publicación'
      : source.value === 'Otro'
        ? 'Describí el origen'
        : 'Contexto opcional';
}

function enhanceLeadForm(container: HTMLElement): void {
  const form = container.querySelector<HTMLFormElement>('#mvp-lead-form:not(.collapsed)');
  if (!form) return;
  if (form.querySelector('[data-lead-source-fields]')) {
    syncOtherDetailRequirement(form);
    return;
  }
  const editing = visibleClients().find((client) => client.id === state.editingClientId) ?? null;
  const wrapper = document.createElement('div');
  wrapper.className = 'pc-lead-source-fields';
  wrapper.dataset.leadSourceFields = '';
  wrapper.innerHTML = `<label><span>Origen</span><select name="leadSource"${editing ? '' : ' required'}>${sourceOptions(editing?.leadSource, Boolean(editing))}</select></label>
    <label><span>Detalle</span><input name="leadSourceDetail" maxlength="120" value="${escapeHtml(editing?.leadSourceDetail || '')}" placeholder="Contexto opcional"></label>
    <label><span>Campaña</span><input name="leadCampaign" maxlength="100" value="${escapeHtml(editing?.leadCampaign || '')}" placeholder="Ej. Docta Septiembre"></label>`;
  const stage = form.querySelector<HTMLElement>('[name="pipeline"]')?.closest('label');
  if (stage) stage.before(wrapper);
  else form.querySelector('.b131-lead-form-fields')?.append(wrapper);
  syncOtherDetailRequirement(form);
}

function filterOptions(): string {
  return [
    '<option value="Todas">Todos los orígenes</option>',
    ...LEAD_SOURCES.map((source) => `<option value="${escapeHtml(source)}">${escapeHtml(source)}</option>`),
    '<option value="Origen no informado">Origen no informado</option>',
  ].join('');
}

function injectSourceFilter(container: HTMLElement): void {
  const grid = container.querySelector<HTMLElement>('.mvp-lead-filter-grid');
  if (!grid || grid.querySelector(`#${SOURCE_FILTER_ID}`)) return;
  const label = document.createElement('label');
  label.className = 'pc-source-filter-field';
  label.innerHTML = `<span>Origen</span><select id="${SOURCE_FILTER_ID}">${filterOptions()}</select>`;
  grid.append(label);
  const select = label.querySelector<HTMLSelectElement>('select');
  if (select) select.value = sourceFilter;
}

function applySourceFilter(container: HTMLElement): void {
  const clients = visibleClients();
  const byId = new Map(clients.map((client) => [client.id, client]));
  const cards = [...container.querySelectorAll<HTMLElement>('.mvp-lead-card[data-client-id]')];
  let shown = 0;
  cards.forEach((card) => {
    const client = byId.get(Number(card.dataset.clientId));
    const matches = Boolean(client && leadSourceMatchesFilter(client, sourceFilter));
    card.classList.toggle('pc-source-filter-hidden', !matches);
    if (matches) shown += 1;
  });
  const select = container.querySelector<HTMLSelectElement>(`#${SOURCE_FILTER_ID}`);
  if (select && select.value !== sourceFilter) select.value = sourceFilter;
  const count = container.querySelector<HTMLElement>('#mvp-lead-count');
  if (count) {
    count.textContent = sourceFilter === 'Todas'
      ? `${cards.length} de ${clients.length} leads`
      : `${shown} por origen · ${cards.length} en filtros actuales`;
  }
}

function injectSourcePresentation(container: HTMLElement): void {
  const clients = new Map(visibleClients().map((client) => [client.id, client]));
  container.querySelectorAll<HTMLElement>('.mvp-lead-card[data-client-id]').forEach((card) => {
    const client = clients.get(Number(card.dataset.clientId));
    if (!client) return;
    if (!card.querySelector('[data-lead-source-meta]')) {
      const interest = card.querySelector('.mvp-lead-interest');
      interest?.insertAdjacentHTML('afterend', `<p class="pc-lead-source-meta" data-lead-source-meta>${escapeHtml(leadSourceDisplay(client))}</p>`);
    }
    const grid = card.querySelector<HTMLElement>('.mvp-lead-full-grid');
    if (grid && !grid.querySelector('[data-lead-source-full]')) {
      grid.insertAdjacentHTML('beforeend', `<div data-lead-source-full><span>Origen</span><strong>${escapeHtml(leadSourceDisplay(client))}</strong></div>`);
    }
  });
}

function money(value: number | undefined, currency: DealCurrency): string {
  return `${currency} ${moneyFormatter.format(value || 0)}`;
}

function sourceMoneyMarkup(
  closed: Partial<Record<DealCurrency, number>>,
  commission: Partial<Record<DealCurrency, number>>,
): string {
  return (['USD', 'ARS'] as DealCurrency[]).map((currency) => {
    const closedValue = closed[currency];
    const commissionValue = commission[currency];
    if (!closedValue && !commissionValue) return '';
    return `<small><b>${currency}</b>${closedValue ? ` · Cerrado ${escapeHtml(money(closedValue, currency))}` : ''}${commissionValue ? ` · Comisión ${escapeHtml(money(commissionValue, currency))}` : ''}</small>`;
  }).filter(Boolean).join('');
}

function renderSourceSummary(container: HTMLElement): void {
  const rows = leadSourceSummary(visibleClients());
  const signature = JSON.stringify(rows);
  const existing = container.querySelector<HTMLElement>('[data-lead-source-summary]');
  if (existing?.dataset.signature === signature) return;
  const mobile = window.matchMedia('(max-width: 620px)').matches;
  const html = `<details class="pc-source-summary" data-lead-source-summary data-signature="${escapeHtml(signature)}"${mobile ? '' : ' open'}>
    <summary><span>Origen de los leads</span><small>Qué fuentes generan oportunidades y cierres</small></summary>
    <div class="pc-source-summary-grid">${rows.length ? rows.map((row) => `<article>
      <header><strong>${escapeHtml(row.source)}</strong><span>${row.leads} leads</span></header>
      <p><b>${row.won}</b> ganados · <b>${row.lost}</b> perdidos</p>
      <div>${sourceMoneyMarkup(row.closedValueByCurrency, row.commissionByCurrency) || '<small>Sin cierres monetarios estructurados</small>'}</div>
    </article>`).join('') : '<p class="pc-empty">Todavía no hay leads para resumir.</p>'}</div>
  </details>`;
  if (existing) existing.outerHTML = html;
  else container.querySelector('#mvp-lead-results')?.insertAdjacentHTML('beforebegin', html);
}

function visibleCommercialArrays(): {
  clients: Client[];
  activities: typeof state.crm.activityLog;
  visits: typeof state.crm.visits;
  offers: typeof state.crm.offers;
  reservations: typeof state.crm.reservations;
} {
  const clients = visibleClients();
  const ids = new Set(clients.map((client) => client.id));
  const uids = new Set(clients.map((client) => client.uid).filter(Boolean));
  return {
    clients,
    activities: state.crm.activityLog.filter((entry) => (
      entry.entityType === 'Cliente' && (ids.has(Number(entry.entityId)) || Boolean(entry.entityUid && uids.has(entry.entityUid)))
    )),
    visits: state.crm.visits.filter((visit) => ids.has(visit.clientId)),
    offers: state.crm.offers.filter((offer) => ids.has(offer.clientId)),
    reservations: state.crm.reservations.filter((reservation) => ids.has(reservation.clientId)),
  };
}

function reactivationCard(candidate: ReactivationCandidate, client: Client): string {
  const supporting = candidate.supportingReasons.length
    ? `<ul>${candidate.supportingReasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join('')}</ul>`
    : '';
  const tomorrow = addIsoDays(localIsoDate(), 1);
  return `<article class="pc-reactivation-card priority-${candidate.priority.toLowerCase()}" data-reactivation-client="${client.id}">
    <header><div><span class="pc-reactivation-priority">${escapeHtml(candidate.priority)}</span><h3>${escapeHtml(client.name)}</h3></div><small>${escapeHtml(leadSourceDisplay(client))}</small></header>
    <p class="pc-reactivation-reason">${escapeHtml(candidate.reason)}</p>
    ${supporting}
    <p class="pc-reactivation-milestone"><span>Último hito útil</span><strong>${escapeHtml(candidate.lastMilestone)}</strong></p>
    <p class="pc-reactivation-suggested"><span>Acción inmediata</span><strong>${escapeHtml(candidate.suggestedAction)}</strong></p>
    <div class="pc-reactivation-actions">
      <button type="button" data-contact-whatsapp="${client.id}">Contactar</button>
      <button type="button" class="secondary" data-reactivation-schedule="${client.id}">Programar seguimiento</button>
      <details class="pc-reactivation-snooze"><summary>Descartar por ahora</summary><div><button type="button" class="secondary" data-reactivation-snooze="${client.id}" data-days="7">7 días</button><button type="button" class="secondary" data-reactivation-snooze="${client.id}" data-days="30">30 días</button><button type="button" class="secondary" data-reactivation-snooze="${client.id}" data-days="60">60 días</button></div></details>
    </div>
    <form class="pc-reactivation-followup" data-reactivation-followup="${client.id}" hidden>
      <label>Fecha de seguimiento<input type="date" name="date" value="${tomorrow}" min="${localIsoDate()}" required></label>
      <div><button type="button" class="quiet-button" data-reactivation-schedule-cancel="${client.id}">Cancelar</button><button type="submit">Guardar seguimiento</button></div>
    </form>
  </article>`;
}

function renderReactivation(container: HTMLElement): void {
  const data = visibleCommercialArrays();
  const candidates = reactivationCandidates(data.clients, data.activities, {
    visits: data.visits,
    offers: data.offers,
    reservations: data.reservations,
  });
  const byId = new Map(data.clients.map((client) => [client.id, client]));
  const visible = showAllReactivation ? candidates : candidates.slice(0, 5);
  const signature = JSON.stringify({
    showAllReactivation,
    candidates: candidates.map((candidate) => [candidate.clientId, candidate.priority, candidate.reason, candidate.lastMilestone]),
    sources: data.clients.map((client) => [client.id, leadSourceSignature(client), client.reactivationSnoozedUntil || '']),
  });
  const existing = container.querySelector<HTMLElement>('[data-reactivation-section]');
  if (existing?.dataset.signature === signature) return;
  const html = `<section class="pc-reactivation-section" data-reactivation-section data-signature="${escapeHtml(signature)}" aria-labelledby="pc-reactivation-title">
    <header class="pc-reactivation-heading"><div><span>Para reactivar</span><h2 id="pc-reactivation-title">¿A quién debería llamar hoy?</h2><p>Prioridad determinística basada en seguimiento, actividad e hitos comerciales. La Agenda conserva autoridad sobre seguimientos vigentes.</p></div><strong>${candidates.length}</strong></header>
    <div class="pc-reactivation-list">${visible.length ? visible.map((candidate) => {
      const client = byId.get(candidate.clientId);
      return client ? reactivationCard(candidate, client) : '';
    }).join('') : '<p class="pc-empty">No hay leads para reactivar ahora. Los seguimientos vigentes siguen en Agenda.</p>'}</div>
    ${candidates.length > 5 ? `<button type="button" class="secondary pc-reactivation-more" data-reactivation-show-all>${showAllReactivation ? 'Ver menos' : `Ver todos (${candidates.length})`}</button>` : ''}
  </section>`;
  if (existing) existing.outerHTML = html;
  else container.querySelector('.mvp-lead-filter-panel')?.insertAdjacentHTML('beforebegin', html);
}

function capturePendingSourceActivity(event: Event): void {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || form.id !== 'mvp-lead-form') return;
  const clientId = state.editingClientId;
  if (!clientId) {
    pendingSourceActivity = null;
    return;
  }
  const previous = visibleClients().find((client) => client.id === clientId);
  if (!previous) return;
  try {
    const next = applyLeadSourceMetadata({ ...previous }, formValues(form), previous);
    const activity = leadSourceChangeActivity(previous, next);
    pendingSourceActivity = activity ? {
      clientId,
      desiredSignature: leadSourceSignature(next),
      activity,
      expiresAt: Date.now() + 15_000,
    } : null;
  } catch {
    pendingSourceActivity = null;
  }
}

function processPendingSourceActivity(): void {
  const pending = pendingSourceActivity;
  if (!pending) return;
  if (Date.now() > pending.expiresAt) {
    pendingSourceActivity = null;
    return;
  }
  const client = visibleClients().find((item) => item.id === pending.clientId);
  if (!client || leadSourceSignature(client) !== pending.desiredSignature) return;
  pendingSourceActivity = null;
  addActivity(pending.activity);
  saveData(`Origen de lead actualizado: ${client.name}`);
  queueMicrotask(() => document.dispatchEvent(new CustomEvent('trv-render')));
}

function scheduleClientFollowUp(form: HTMLFormElement): void {
  const clientId = Number(form.dataset.reactivationFollowup);
  const client = visibleClients().find((item) => item.id === clientId);
  const date = new FormData(form).get('date')?.toString() || '';
  if (!client || !date || date < localIsoDate()) return;
  const previous = structuredClone(client);
  client.nextAction = client.nextAction?.trim() || 'Contactar para reactivar oportunidad';
  client.nextFollowUp = date;
  client.reactivationSnoozedUntil = undefined;
  activitiesForClientSave(previous, client).forEach((activity) => addActivity(activity));
  saveData(`Seguimiento de reactivación programado: ${client.name}`);
  document.dispatchEvent(new CustomEvent('trv-render'));
}

function snoozeClient(clientId: number, days: ReactivationSnoozeDays): void {
  const client = visibleClients().find((item) => item.id === clientId);
  if (!client) return;
  const result = snoozeReactivation(client, days);
  Object.assign(client, result.client);
  addActivity(result.activity);
  saveData(`Reactivación postergada: ${client.name}`);
  document.dispatchEvent(new CustomEvent('trv-render'));
}

function bindGlobalEvents(): void {
  document.addEventListener('submit', capturePendingSourceActivity, true);
  document.addEventListener('change', (event) => {
    const target = event.target as HTMLElement;
    if (target.id === SOURCE_FILTER_ID && target instanceof HTMLSelectElement) {
      sourceFilter = target.value as LeadSourceFilter;
      const container = document.querySelector<HTMLElement>('#crm.active');
      if (container) applySourceFilter(container);
      return;
    }
    if (target.matches('#mvp-lead-form [name="leadSource"]')) {
      const form = target.closest<HTMLFormElement>('#mvp-lead-form');
      if (form) syncOtherDetailRequirement(form);
    }
  });
  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('[data-clear-lead-filters]')) {
      sourceFilter = 'Todas';
      return;
    }
    if (target.closest('[data-reactivation-show-all]')) {
      showAllReactivation = !showAllReactivation;
      scheduleEnhancement();
      return;
    }
    const schedule = target.closest<HTMLButtonElement>('[data-reactivation-schedule]');
    if (schedule) {
      const form = document.querySelector<HTMLFormElement>(`[data-reactivation-followup="${schedule.dataset.reactivationSchedule}"]`);
      if (form) {
        form.hidden = false;
        form.querySelector<HTMLInputElement>('input[name="date"]')?.focus({ preventScroll: false });
      }
      return;
    }
    const cancel = target.closest<HTMLButtonElement>('[data-reactivation-schedule-cancel]');
    if (cancel) {
      const form = document.querySelector<HTMLFormElement>(`[data-reactivation-followup="${cancel.dataset.reactivationScheduleCancel}"]`);
      if (form) form.hidden = true;
      return;
    }
    const snooze = target.closest<HTMLButtonElement>('[data-reactivation-snooze]');
    if (snooze) {
      const days = Number(snooze.dataset.days);
      if (days === 7 || days === 30 || days === 60) snoozeClient(Number(snooze.dataset.reactivationSnooze), days);
    }
  });
  document.addEventListener('submit', (event) => {
    const form = (event.target as HTMLElement).closest<HTMLFormElement>('[data-reactivation-followup]');
    if (!form) return;
    event.preventDefault();
    scheduleClientFollowUp(form);
  });
  document.addEventListener('trv-render', scheduleEnhancement);
  document.addEventListener('DOMContentLoaded', scheduleEnhancement, { once: true });
  window.addEventListener('pageshow', scheduleEnhancement);
}

function enhance(): void {
  processPendingSourceActivity();
  const container = document.querySelector<HTMLElement>('#crm.active');
  if (!container) return;
  enhanceLeadForm(container);
  injectSourceFilter(container);
  injectSourcePresentation(container);
  renderReactivation(container);
  renderSourceSummary(container);
  applySourceFilter(container);
}

function scheduleEnhancement(): void {
  if (enhancementQueued) return;
  enhancementQueued = true;
  queueMicrotask(() => {
    enhancementQueued = false;
    enhance();
  });
}

export function installLeadSourceReactivationUi(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  installStyles();
  bindGlobalEvents();
  const observer = new MutationObserver(scheduleEnhancement);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  scheduleEnhancement();
}

installLeadSourceReactivationUi();
