import {
  calculateCommissionAmount,
  commercialCloseSummary,
  formatCommercialMoney,
  hasStructuredClose,
  localTodayIso,
  LOST_REASONS,
  REOPEN_STAGES,
  suggestedClosePropertyId,
  validateLostCloseValues,
  validateWonCloseValues,
} from './commercial-close.js';
import type { Client, CommercialStage, Property } from './models.js';
import { state } from './store.js';
import { visibleClients, visibleProperties } from './team-access.js';
import { escapeHtml } from './utils.js';

const STYLE_ID = 'propcontrol-commercial-close-styles';
const BOUND = 'commercialCloseBound';
let pendingReopenClientId: number | null = null;
let documentBound = false;
let observedCrm: HTMLElement | null = null;
let observer: MutationObserver | null = null;
let enhancementQueued = false;

function installStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const link = document.createElement('link');
  link.id = STYLE_ID;
  link.rel = 'stylesheet';
  link.href = '/src/commercial-close.css?v=20260903-p1-2-a1';
  document.head.append(link);
}

function normalized(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function stageForClient(client: Client): 'Ganado' | 'Perdido' | 'Activo' {
  if (client.outcome === 'won') return 'Ganado';
  if (client.outcome === 'lost') return 'Perdido';
  const stage = normalized(client.pipeline);
  if (['ganado', 'ganada', 'operacion ganada', 'cerrado', 'cerrada'].includes(stage)) return 'Ganado';
  if (['perdido', 'perdida', 'operacion perdida'].includes(stage)) return 'Perdido';
  return 'Activo';
}

function clientById(clientId: number): Client | undefined {
  return visibleClients().find((client) => client.id === clientId);
}

function linkedProperty(client: Client): Property | undefined {
  if (!client.dealPropertyId) return undefined;
  return visibleProperties().find((property) => property.id === client.dealPropertyId);
}

function readableDate(value: string | undefined): string {
  if (!value) return 'Sin fecha estructurada';
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}

function renderCloseBlock(client: Client): string {
  const stage = stageForClient(client);
  if (stage === 'Activo') return '';
  const structured = hasStructuredClose(client);
  if (stage === 'Ganado') {
    if (!structured) {
      return `<section class="pc-commercial-close-card historical" data-commercial-close-card>
        <div><span>Operación cerrada</span><strong>Ganada · registro histórico</strong></div>
        <p>Este lead ya estaba en Ganado antes del cierre estructurado. No se inventaron precio, comisión ni propiedad.</p>
      </section>`;
    }
    const property = linkedProperty(client);
    const propertyLabel = client.dealPropertyLabel?.trim()
      || property?.title?.trim()
      || (client.dealPropertyId ? `Propiedad #${client.dealPropertyId}` : 'Sin propiedad vinculada');
    return `<section class="pc-commercial-close-card won" data-commercial-close-card>
      <header><div><span>Operación cerrada</span><strong>Ganada</strong></div><time>${escapeHtml(readableDate(client.closedAt))}</time></header>
      <dl>
        <div><dt>Propiedad</dt><dd>${escapeHtml(propertyLabel)}</dd></div>
        <div><dt>Precio final</dt><dd>${escapeHtml(formatCommercialMoney(client.dealAmount!, client.dealCurrency!))}</dd></div>
        <div><dt>Comisión esperada</dt><dd>${escapeHtml(formatCommercialMoney(client.commissionAmount!, client.commissionCurrency!))}</dd></div>
      </dl>
      ${client.closeNote?.trim() ? `<p>${escapeHtml(client.closeNote.trim())}</p>` : ''}
    </section>`;
  }
  if (!structured) {
    return `<section class="pc-commercial-close-card historical" data-commercial-close-card>
      <div><span>Operación perdida</span><strong>Registro histórico</strong></div>
      <p>Este lead ya estaba en Perdido antes del cierre estructurado. No se inventó un motivo.</p>
    </section>`;
  }
  const detail = client.lostReasonDetail?.trim();
  return `<section class="pc-commercial-close-card lost" data-commercial-close-card>
    <header><div><span>Operación perdida</span><strong>${escapeHtml(client.lostReason || 'Sin motivo')}</strong></div><time>${escapeHtml(readableDate(client.closedAt))}</time></header>
    ${detail ? `<p><strong>Detalle:</strong> ${escapeHtml(detail)}</p>` : ''}
    ${client.closeNote?.trim() ? `<p>${escapeHtml(client.closeNote.trim())}</p>` : ''}
  </section>`;
}

function injectCloseCards(container: HTMLElement): void {
  visibleClients().forEach((client) => {
    const stage = stageForClient(client);
    if (stage === 'Activo') return;
    const card = container.querySelector<HTMLElement>(`.mvp-lead-card[data-client-id="${client.id}"]`);
    const content = card?.querySelector<HTMLElement>('.mvp-lead-full-content');
    const actions = card?.querySelector<HTMLElement>('.mvp-lead-full-actions');
    if (!card || !content || !actions) return;
    if (!content.querySelector('[data-commercial-close-card]')) {
      const history = content.querySelector('.mvp-lead-history');
      if (history) history.insertAdjacentHTML('beforebegin', renderCloseBlock(client));
      else content.insertAdjacentHTML('afterbegin', renderCloseBlock(client));
    }
    if (!actions.querySelector('[data-reopen-operation]')) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary pc-reopen-operation';
      button.dataset.reopenOperation = String(client.id);
      button.textContent = 'Reabrir operación';
      actions.prepend(button);
    }
  });
}

function renderSummaryMarkup(): string {
  const summary = commercialCloseSummary(visibleClients());
  const moneyRows = (['USD', 'ARS'] as const)
    .map((currency) => {
      const totals = summary.byCurrency[currency];
      if (!totals) return '';
      return `<div class="pc-commercial-summary-money"><span>${currency}</span><strong>Ventas cerradas: ${escapeHtml(formatCommercialMoney(totals.dealAmount, currency))}</strong><small>Comisión: ${escapeHtml(formatCommercialMoney(totals.commissionAmount, currency))}</small></div>`;
    })
    .filter(Boolean)
    .join('');
  return `<section class="pc-commercial-summary" data-commercial-close-summary aria-label="Resumen comercial">
    <div class="pc-commercial-summary-counts"><strong>${summary.wonCount} ganadas</strong><span>${summary.lostCount} perdidas</span></div>
    ${moneyRows || '<small class="pc-commercial-summary-empty">Todavía no hay importes de cierre estructurados.</small>'}
  </section>`;
}

function injectCommercialSummary(container: HTMLElement): void {
  const filter = container.querySelector<HTMLElement>('.mvp-lead-filter-panel');
  const primary = filter?.querySelector<HTMLElement>('.mvp-lead-filter-primary');
  if (!filter || !primary || filter.querySelector('[data-commercial-close-summary]')) return;
  primary.insertAdjacentHTML('afterend', renderSummaryMarkup());
}

function showFormError(form: HTMLFormElement, message: string): void {
  const node = form.querySelector<HTMLElement>('[data-lead-error]');
  if (node) {
    node.textContent = message;
    node.hidden = false;
  }
}

function dialogElement(form: HTMLFormElement): HTMLDialogElement {
  let dialog = form.querySelector<HTMLDialogElement>('[data-commercial-close-dialog]');
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.className = 'pc-commercial-close-dialog';
  dialog.dataset.commercialCloseDialog = '';
  form.append(dialog);
  return dialog;
}

function closeDialog(dialog: HTMLDialogElement): void {
  if (dialog.open && typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
}

function cancelDialog(dialog: HTMLDialogElement): void {
  closeDialog(dialog);
  dialog.remove();
}

function showDialog(dialog: HTMLDialogElement): void {
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
  window.requestAnimationFrame(() => {
    dialog.querySelector<HTMLElement>('input:not([type="hidden"]), select, textarea')?.focus();
  });
}

function formValues(form: HTMLFormElement): Record<string, string> {
  return Object.fromEntries(new FormData(form).entries()) as Record<string, string>;
}

function modalError(dialog: HTMLDialogElement, message = ''): void {
  const node = dialog.querySelector<HTMLElement>('[data-commercial-close-error]');
  if (!node) return;
  node.textContent = message;
  node.hidden = !message;
}

function propertyOptions(client: Client): string {
  const properties = visibleProperties();
  const allowed = properties.map((property) => property.id);
  const suggestedId = client.dealPropertyId && allowed.includes(client.dealPropertyId)
    ? client.dealPropertyId
    : suggestedClosePropertyId(client.id, state.crm.offers, state.crm.reservations, state.crm.visits, allowed);
  const options = properties.map((property) => {
    const label = property.title?.trim() || property.address?.trim() || `Propiedad #${property.id}`;
    return `<option value="${property.id}" data-property-uid="${escapeHtml(property.uid || '')}" data-property-label="${escapeHtml(label)}"${property.id === suggestedId ? ' selected' : ''}>${escapeHtml(label)}</option>`;
  }).join('');
  return `<option value="">Sin propiedad vinculada</option>${options}`;
}

function syncCommission(dialog: HTMLDialogElement): void {
  const amount = dialog.querySelector<HTMLInputElement>('[name="dealAmount"]');
  const mode = dialog.querySelector<HTMLSelectElement>('[name="commissionMode"]');
  const percentage = dialog.querySelector<HTMLInputElement>('[name="commissionPercentage"]');
  const commission = dialog.querySelector<HTMLInputElement>('[name="commissionAmount"]');
  const label = dialog.querySelector<HTMLElement>('[data-commission-calculated]');
  if (!amount || !mode || !percentage || !commission || !label) return;
  const percentageMode = mode.value === 'percentage';
  percentage.disabled = !percentageMode;
  commission.readOnly = percentageMode;
  if (percentageMode) {
    const dealAmount = Number(amount.value);
    const percent = Number(percentage.value);
    const calculated = calculateCommissionAmount(dealAmount, percent);
    commission.value = calculated > 0 ? String(calculated) : '';
  }
  const currencyValue = dialog.querySelector<HTMLSelectElement>('[name="dealCurrency"]')?.value;
  const commissionValue = Number(commission.value);
  label.textContent = (currencyValue === 'USD' || currencyValue === 'ARS') && Number.isFinite(commissionValue) && commissionValue > 0
    ? `Comisión esperada: ${formatCommercialMoney(commissionValue, currencyValue)}`
    : 'La comisión final quedará guardada como monto explícito.';
}

function wonDialogMarkup(client: Client): string {
  const mode = client.commissionMode || 'percentage';
  const percentage = client.commissionPercentage ?? '';
  const amount = client.commissionAmount ?? '';
  return `<div class="pc-close-modal-form" data-commercial-close-modal-form="won">
    <header><div><small>Cierre comercial</small><h3>Cerrar como ganada</h3></div><button type="button" class="quiet-button" data-commercial-close-cancel aria-label="Cancelar cierre">×</button></header>
    <div class="pc-close-grid">
      <label>Fecha de cierre<input type="date" name="closedAt" value="${escapeHtml(client.closedAt || localTodayIso())}" required></label>
      <label>Precio final<input type="number" name="dealAmount" min="0.01" step="0.01" inputmode="decimal" value="${client.dealAmount ?? ''}" required></label>
      <label>Moneda<select name="dealCurrency" required><option value="">Elegir</option><option value="USD"${client.dealCurrency === 'USD' ? ' selected' : ''}>USD</option><option value="ARS"${client.dealCurrency === 'ARS' ? ' selected' : ''}>ARS</option></select></label>
      <label class="pc-close-wide">Propiedad<select name="dealPropertyId">${propertyOptions(client)}</select><small>Podés cerrar sin vincular una Property.</small></label>
      <label>Comisión<select name="commissionMode"><option value="percentage"${mode === 'percentage' ? ' selected' : ''}>Porcentaje</option><option value="fixed"${mode === 'fixed' ? ' selected' : ''}>Monto fijo</option></select></label>
      <label>Porcentaje<input type="number" name="commissionPercentage" min="0.01" max="100" step="0.01" inputmode="decimal" value="${percentage}"></label>
      <label class="pc-close-wide">Monto de comisión<input type="number" name="commissionAmount" min="0.01" step="0.01" inputmode="decimal" value="${amount}" required><strong class="pc-commission-calculated" data-commission-calculated></strong></label>
      <label class="pc-close-wide">Nota de cierre<textarea name="closeNote" rows="2" placeholder="Opcional">${escapeHtml(client.closeNote || '')}</textarea></label>
      <input type="hidden" name="dealPropertyUid" value="${escapeHtml(client.dealPropertyUid || '')}">
      <input type="hidden" name="dealPropertyLabel" value="${escapeHtml(client.dealPropertyLabel || '')}">
    </div>
    <p class="form-error" data-commercial-close-error hidden></p>
    <footer><button type="button" class="secondary" data-commercial-close-cancel>Cancelar</button><button type="button" data-commercial-close-confirm="Ganado">Cerrar como ganada</button></footer>
  </div>`;
}

function lostDialogMarkup(client: Client): string {
  const reasons = LOST_REASONS.map((reason) => `<option value="${escapeHtml(reason)}"${client.lostReason === reason ? ' selected' : ''}>${escapeHtml(reason)}</option>`).join('');
  return `<div class="pc-close-modal-form" data-commercial-close-modal-form="lost">
    <header><div><small>Cierre comercial</small><h3>Cerrar como perdida</h3></div><button type="button" class="quiet-button" data-commercial-close-cancel aria-label="Cancelar cierre">×</button></header>
    <div class="pc-close-grid">
      <label>Fecha<input type="date" name="closedAt" value="${escapeHtml(client.closedAt || localTodayIso())}" required></label>
      <label>Motivo<select name="lostReason" required><option value="">Elegir motivo</option>${reasons}</select></label>
      <label class="pc-close-wide" data-lost-other-detail>Detalle de “Otro”<input name="lostReasonDetail" value="${escapeHtml(client.lostReasonDetail || '')}" placeholder="Obligatorio si elegís Otro"></label>
      <label class="pc-close-wide">Nota adicional<textarea name="closeNote" rows="2" placeholder="Opcional">${escapeHtml(client.closeNote || '')}</textarea></label>
    </div>
    <p class="form-error" data-commercial-close-error hidden></p>
    <footer><button type="button" class="secondary" data-commercial-close-cancel>Cancelar</button><button type="button" data-commercial-close-confirm="Perdido">Cerrar como perdida</button></footer>
  </div>`;
}

function reopenDialogMarkup(client: Client): string {
  const options = REOPEN_STAGES.map((stage) => `<option value="${escapeHtml(stage)}"${stage === 'Negociación' ? ' selected' : ''}>${escapeHtml(stage)}</option>`).join('');
  return `<div class="pc-close-modal-form" data-commercial-close-modal-form="reopen">
    <header><div><small>${escapeHtml(client.name)}</small><h3>Reabrir operación</h3></div><button type="button" class="quiet-button" data-commercial-close-cancel aria-label="Cancelar reapertura">×</button></header>
    <p>El cierre actual quedará en el historial. Los datos estructurados de cierre dejarán de representar el estado vigente.</p>
    <label>Etapa activa de destino<select name="reopenStage">${options}</select></label>
    <p class="form-error" data-commercial-close-error hidden></p>
    <footer><button type="button" class="secondary" data-commercial-close-cancel>Cancelar</button><button type="button" data-commercial-reopen-confirm>Reabrir operación</button></footer>
  </div>`;
}

function bindDialogControls(form: HTMLFormElement, dialog: HTMLDialogElement, initialStage: string): void {
  dialog.querySelectorAll<HTMLElement>('[data-commercial-close-cancel]').forEach((button) => {
    button.addEventListener('click', () => {
      form.dataset.commercialCloseConfirmed = '';
      form.dataset.commercialReopenConfirmed = '';
      const stage = form.elements.namedItem('pipeline');
      if (stage instanceof HTMLSelectElement) {
        stage.value = initialStage;
        stage.dispatchEvent(new Event('change', { bubbles: true }));
      }
      cancelDialog(dialog);
    });
  });

  const wonForm = dialog.querySelector<HTMLElement>('[data-commercial-close-modal-form="won"]');
  if (wonForm) {
    ['input', 'change'].forEach((eventName) => wonForm.addEventListener(eventName, () => syncCommission(dialog)));
    syncCommission(dialog);
    const property = dialog.querySelector<HTMLSelectElement>('[name="dealPropertyId"]');
    property?.addEventListener('change', () => {
      const selectedOption = property.selectedOptions[0];
      const uid = dialog.querySelector<HTMLInputElement>('[name="dealPropertyUid"]');
      const label = dialog.querySelector<HTMLInputElement>('[name="dealPropertyLabel"]');
      if (uid) uid.value = selectedOption?.dataset.propertyUid || '';
      if (label) label.value = selectedOption?.dataset.propertyLabel || '';
    });
    property?.dispatchEvent(new Event('change'));
  }

  const lostReason = dialog.querySelector<HTMLSelectElement>('[name="lostReason"]');
  const syncLostReason = (): void => {
    const detail = dialog.querySelector<HTMLInputElement>('[name="lostReasonDetail"]');
    if (detail) detail.required = lostReason?.value === 'Otro';
  };
  lostReason?.addEventListener('change', syncLostReason);
  syncLostReason();

  dialog.querySelectorAll<HTMLButtonElement>('[data-commercial-close-confirm]').forEach((button) => {
    button.addEventListener('click', () => {
      modalError(dialog);
      syncCommission(dialog);
      const values = formValues(form);
      const target = button.dataset.commercialCloseConfirm;
      const validation = target === 'Ganado' ? validateWonCloseValues(values) : validateLostCloseValues(values);
      if (!validation.ok) {
        modalError(dialog, validation.message || 'Revisá los datos del cierre.');
        const field = validation.field ? dialog.querySelector<HTMLElement>(`[name="${validation.field}"]`) : null;
        field?.focus();
        return;
      }
      form.dataset.commercialCloseConfirmed = target || '';
      closeDialog(dialog);
      form.requestSubmit();
    });
  });

  dialog.querySelector<HTMLButtonElement>('[data-commercial-reopen-confirm]')?.addEventListener('click', () => {
    const target = dialog.querySelector<HTMLSelectElement>('[name="reopenStage"]')?.value as CommercialStage | undefined;
    if (!target || !REOPEN_STAGES.includes(target)) {
      modalError(dialog, 'Elegí una etapa activa para reabrir la operación.');
      return;
    }
    form.dataset.commercialReopenConfirmed = 'true';
    const stage = form.elements.namedItem('pipeline');
    if (stage instanceof HTMLSelectElement) {
      stage.value = target;
      stage.dispatchEvent(new Event('change', { bubbles: true }));
    }
    closeDialog(dialog);
    form.requestSubmit();
  });
}

function openCloseDialog(form: HTMLFormElement, targetStage: 'Ganado' | 'Perdido', initialStage: string): void {
  const client = state.editingClientId === null
    ? ({ id: 0, name: 'Nuevo lead', phone: '', interest: '', status: 'Lead', temperature: 'Tibio', pipeline: initialStage } satisfies Client)
    : clientById(state.editingClientId);
  if (!client) return;
  const dialog = dialogElement(form);
  dialog.innerHTML = targetStage === 'Ganado' ? wonDialogMarkup(client) : lostDialogMarkup(client);
  bindDialogControls(form, dialog, initialStage);
  showDialog(dialog);
}

function openReopenDialog(form: HTMLFormElement, client: Client, initialStage: string): void {
  const dialog = dialogElement(form);
  dialog.innerHTML = reopenDialogMarkup(client);
  bindDialogControls(form, dialog, initialStage);
  showDialog(dialog);
}

function validateCapturedSubmit(event: SubmitEvent, form: HTMLFormElement, initialStage: string): void {
  const stage = form.elements.namedItem('pipeline');
  if (!(stage instanceof HTMLSelectElement)) return;
  const target = stage.value;
  const previous = state.editingClientId === null ? undefined : clientById(state.editingClientId);
  const previousStage = previous ? stageForClient(previous) : 'Activo';

  if ((target === 'Ganado' || target === 'Perdido') && previousStage !== target) {
    const values = formValues(form);
    const validation = target === 'Ganado' ? validateWonCloseValues(values) : validateLostCloseValues(values);
    if (form.dataset.commercialCloseConfirmed !== target || !validation.ok) {
      event.preventDefault();
      event.stopImmediatePropagation();
      showFormError(form, validation.message || 'Completá el cierre comercial antes de guardar una etapa terminal.');
      openCloseDialog(form, target, initialStage);
    }
    return;
  }

  if (previousStage !== 'Activo' && target !== 'Ganado' && target !== 'Perdido') {
    if (form.dataset.commercialReopenConfirmed !== 'true') {
      event.preventDefault();
      event.stopImmediatePropagation();
      showFormError(form, 'Confirmá la reapertura y elegí una etapa activa.');
      if (previous) openReopenDialog(form, previous, initialStage);
    }
  }
}

function bindLeadForm(form: HTMLFormElement): void {
  if (form.dataset[BOUND] === 'true') return;
  const stage = form.elements.namedItem('pipeline');
  if (!(stage instanceof HTMLSelectElement)) return;
  form.dataset[BOUND] = 'true';
  const initialStage = stage.value;
  form.dataset.commercialCloseInitialStage = initialStage;

  stage.addEventListener('change', () => {
    const target = stage.value;
    const initialTerminal = initialStage === 'Ganado' || initialStage === 'Perdido';
    if (target === 'Ganado' || target === 'Perdido') {
      if (target === initialStage && initialTerminal) return;
      form.dataset.commercialCloseConfirmed = '';
      openCloseDialog(form, target, initialStage);
      return;
    }
    if (initialTerminal && form.dataset.commercialReopenConfirmed !== 'true') {
      stage.value = initialStage;
      stage.dispatchEvent(new Event('change', { bubbles: true }));
      const client = state.editingClientId === null ? undefined : clientById(state.editingClientId);
      if (client) openReopenDialog(form, client, initialStage);
    }
  });

  form.addEventListener('submit', (event) => validateCapturedSubmit(event as SubmitEvent, form, initialStage), { capture: true });

  if (pendingReopenClientId !== null && pendingReopenClientId === state.editingClientId) {
    pendingReopenClientId = null;
    const client = clientById(state.editingClientId!);
    if (client) window.requestAnimationFrame(() => openReopenDialog(form, client, initialStage));
  }
}

function bindDocumentActions(): void {
  if (typeof document === 'undefined' || documentBound) return;
  documentBound = true;
  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const button = target.closest<HTMLButtonElement>('[data-reopen-operation]');
    if (!button) return;
    const clientId = Number(button.dataset.reopenOperation);
    if (!clientId || !clientById(clientId)) return;
    event.preventDefault();
    event.stopPropagation();
    pendingReopenClientId = clientId;
    const card = button.closest<HTMLElement>('.mvp-lead-card');
    card?.querySelector<HTMLButtonElement>('[data-edit-client]')?.click();
  });
}

function bindCrmObserver(): void {
  const crm = document.querySelector<HTMLElement>('#crm');
  if (!crm || observedCrm === crm) return;
  observer?.disconnect();
  observedCrm = crm;
  observer = new MutationObserver(() => scheduleEnhancement());
  observer.observe(crm, { childList: true, subtree: true });
}

export function enhanceCommercialCloseUi(): void {
  if (typeof document === 'undefined') return;
  installStyles();
  bindDocumentActions();
  bindCrmObserver();
  const container = document.querySelector<HTMLElement>('#crm');
  if (container) {
    injectCommercialSummary(container);
    injectCloseCards(container);
  }
  const form = document.querySelector<HTMLFormElement>('#mvp-lead-form:not(.collapsed)');
  if (form) bindLeadForm(form);
}

function scheduleEnhancement(): void {
  if (enhancementQueued) return;
  enhancementQueued = true;
  queueMicrotask(() => {
    enhancementQueued = false;
    enhanceCommercialCloseUi();
  });
}

if (typeof document !== 'undefined') {
  installStyles();
  bindDocumentActions();
  document.addEventListener('trv-render', scheduleEnhancement);
  document.addEventListener('DOMContentLoaded', scheduleEnhancement, { once: true });
  window.addEventListener('pageshow', scheduleEnhancement);
  requestAnimationFrame(scheduleEnhancement);
}
