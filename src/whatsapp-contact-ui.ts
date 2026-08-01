import type { Client } from './models.js';
import { saveData, state } from './store.js';
import { visibleClients } from './team-access.js';
import { escapeHtml } from './utils.js';
import {
  addLocalDaysIso,
  createPendingWhatsAppAttempt,
  dismissPendingWhatsAppAttempt,
  loadPendingWhatsAppAttempt,
  markPendingAttemptOpened,
  normalizeWhatsAppPhone,
  registerWhatsAppContact,
  savePendingWhatsAppAttempt,
  scheduleWhatsAppFollowUp,
  suggestedFollowUp,
  suggestedWhatsAppMessage,
  whatsappContactSummary,
  whatsappUrl,
  type PendingWhatsAppAttempt,
} from './whatsapp-contact.js';

const PANEL_ID = 'propcontrol-whatsapp-contact';
const RETURN_DELAY_MS = 650;
let installed = false;
let promptedAttemptId = '';
let currentAttempt: PendingWhatsAppAttempt | null = null;

function activeClient(clientId: number): Client | null {
  return visibleClients().find((client) => client.id === clientId) ?? null;
}

function notify(message: string): void {
  document.dispatchEvent(new CustomEvent('propcontrol-cloud-status', {
    detail: { message, kind: 'success' },
  }));
}

function overlay(): HTMLElement {
  let element = document.getElementById(PANEL_ID);
  if (!element) {
    element = document.createElement('div');
    element.id = PANEL_ID;
    element.className = 'whatsapp-contact-overlay';
    element.hidden = true;
    element.innerHTML = '<div class="whatsapp-contact-backdrop" data-whatsapp-close></div><section class="whatsapp-contact-panel" role="dialog" aria-modal="true" aria-labelledby="whatsapp-contact-title"></section>';
    document.body.append(element);
  }
  return element;
}

function panel(): HTMLElement {
  return overlay().querySelector<HTMLElement>('.whatsapp-contact-panel')!;
}

function openOverlay(): void {
  const root = overlay();
  root.hidden = false;
  document.body.classList.add('whatsapp-contact-open');
}

function closeOverlay(): void {
  const root = overlay();
  root.hidden = true;
  document.body.classList.remove('whatsapp-contact-open');
  currentAttempt = null;
}

function responsibleName(): string {
  const member = state.crm.teamMembers.find((item) => item.id === state.activeMemberId);
  return member?.name?.trim() || state.crm.settings.profileName.trim();
}

function agencyName(): string {
  return state.crm.settings.agencyName.trim() || state.crm.organization.name.trim();
}

function phonePreviewMarkup(value: string): string {
  const result = normalizeWhatsAppPhone(value);
  return result.valid
    ? `<span class="whatsapp-phone-valid">Se usará ${escapeHtml(result.display)}</span>`
    : `<span class="whatsapp-phone-error">${escapeHtml(result.reason)}</span>`;
}

function contactPanelMarkup(client: Client, number = client.phone, message?: string): string {
  const suggested = message ?? suggestedWhatsAppMessage(client, responsibleName(), agencyName());
  return `<header class="whatsapp-contact-heading">
      <div><span class="eyebrow">Contacto asistido</span><h2 id="whatsapp-contact-title">Contactar por WhatsApp</h2><p>Revisá el número y el mensaje antes de abrir WhatsApp.</p></div>
      <button type="button" class="quiet-button" data-whatsapp-close aria-label="Cerrar">×</button>
    </header>
    <div class="whatsapp-contact-lead"><span>Lead</span><strong>${escapeHtml(client.name)}</strong><small>${escapeHtml(client.interest || 'Consulta inmobiliaria')}</small></div>
    <label class="whatsapp-contact-field">Teléfono registrado
      <input data-whatsapp-phone value="${escapeHtml(number)}" inputmode="tel" autocomplete="tel">
      <small data-whatsapp-phone-preview>${phonePreviewMarkup(number)}</small>
    </label>
    <label class="whatsapp-contact-update-phone" hidden><input type="checkbox" data-whatsapp-save-phone> Actualizar el teléfono del lead con este número</label>
    <label class="whatsapp-contact-field whatsapp-message-field">Mensaje sugerido editable
      <textarea data-whatsapp-message rows="6">${escapeHtml(suggested)}</textarea>
      <small data-whatsapp-message-status>${suggested.trim() ? `${suggested.length} caracteres` : 'El mensaje está vacío.'}</small>
    </label>
    <div class="whatsapp-contact-copy-row"><button type="button" class="secondary" data-whatsapp-copy>Copiar mensaje</button><span data-whatsapp-copy-status aria-live="polite"></span></div>
    <footer class="whatsapp-contact-actions">
      <button type="button" class="secondary" data-whatsapp-manual-register>Ya lo envié, registrar</button>
      <button type="button" data-whatsapp-open>Abrir WhatsApp</button>
    </footer>`;
}

function renderContactPanel(client: Client, number = client.phone, message?: string): void {
  openOverlay();
  panel().innerHTML = contactPanelMarkup(client, number, message);
  panel().dataset.clientId = String(client.id);
  updateContactValidation();
  queueMicrotask(() => panel().querySelector<HTMLTextAreaElement>('[data-whatsapp-message]')?.focus({ preventScroll: true }));
}

function contactInputs(): { client: Client | null; phone: HTMLInputElement | null; message: HTMLTextAreaElement | null } {
  const clientId = Number(panel().dataset.clientId);
  return {
    client: activeClient(clientId),
    phone: panel().querySelector<HTMLInputElement>('[data-whatsapp-phone]'),
    message: panel().querySelector<HTMLTextAreaElement>('[data-whatsapp-message]'),
  };
}

function updateContactValidation(): void {
  const { client, phone, message } = contactInputs();
  if (!client || !phone || !message) return;
  const result = normalizeWhatsAppPhone(phone.value);
  const preview = panel().querySelector<HTMLElement>('[data-whatsapp-phone-preview]');
  if (preview) preview.innerHTML = phonePreviewMarkup(phone.value);
  const messageStatus = panel().querySelector<HTMLElement>('[data-whatsapp-message-status]');
  if (messageStatus) messageStatus.textContent = message.value.trim()
    ? `${message.value.length} caracteres`
    : 'El mensaje está vacío.';
  const changed = phone.value.trim() !== client.phone.trim();
  const saveLabel = panel().querySelector<HTMLElement>('.whatsapp-contact-update-phone');
  if (saveLabel) saveLabel.hidden = !changed;
  panel().querySelectorAll<HTMLButtonElement>('[data-whatsapp-open], [data-whatsapp-manual-register]')
    .forEach((button) => { button.disabled = !result.valid || !message.value.trim(); });
}

function explicitlyUpdatePhone(client: Client, rawPhone: string): void {
  const savePhone = panel().querySelector<HTMLInputElement>('[data-whatsapp-save-phone]')?.checked;
  if (!savePhone || rawPhone.trim() === client.phone.trim()) return;
  client.phone = rawPhone.trim();
  saveData(`Teléfono de lead actualizado: ${client.name}`);
}

function attemptFromPanel(): PendingWhatsAppAttempt | null {
  const { client, phone, message } = contactInputs();
  if (!client || !phone || !message) return null;
  const phoneResult = normalizeWhatsAppPhone(phone.value);
  const text = message.value.trim();
  if (!phoneResult.valid || !text) {
    updateContactValidation();
    return null;
  }
  explicitlyUpdatePhone(client, phone.value);
  const attempt = createPendingWhatsAppAttempt(client, phoneResult.normalized, text);
  savePendingWhatsAppAttempt(attempt);
  return attempt;
}

async function copyMessage(): Promise<void> {
  const message = panel().querySelector<HTMLTextAreaElement>('[data-whatsapp-message]')?.value || '';
  const status = panel().querySelector<HTMLElement>('[data-whatsapp-copy-status]');
  if (!message.trim()) return;
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(message);
    else {
      const helper = document.createElement('textarea');
      helper.value = message;
      helper.style.position = 'fixed';
      helper.style.opacity = '0';
      document.body.append(helper);
      helper.select();
      document.execCommand('copy');
      helper.remove();
    }
    if (status) status.textContent = 'Mensaje copiado.';
  } catch {
    if (status) status.textContent = 'No se pudo copiar. Seleccioná el texto manualmente.';
  }
}

function openWhatsAppChannel(): void {
  const attempt = attemptFromPanel();
  if (!attempt) return;
  currentAttempt = markPendingAttemptOpened(attempt);
  promptedAttemptId = '';
  window.open(whatsappUrl(currentAttempt.phone, currentAttempt.message), '_blank', 'noopener,noreferrer');
  closeOverlay();
}

function registerAndContinue(attempt: PendingWhatsAppAttempt): void {
  const result = registerWhatsAppContact(attempt);
  if (!result) {
    dismissPendingWhatsAppAttempt(attempt);
    closeOverlay();
    notify('No se pudo registrar el contacto porque el permiso o el intento ya no son válidos.');
    return;
  }
  currentAttempt = attempt;
  renderFollowUpPanel(result.client, attempt, result.activity.id);
  document.dispatchEvent(new CustomEvent('trv-render'));
}

function manualRegister(): void {
  const attempt = attemptFromPanel();
  if (!attempt) return;
  registerAndContinue(attempt);
}

function returnConfirmationMarkup(client: Client, attempt: PendingWhatsAppAttempt): string {
  return `<header class="whatsapp-contact-heading">
      <div><span class="eyebrow">Confirmación</span><h2 id="whatsapp-contact-title">¿Enviaste el mensaje a ${escapeHtml(client.name)}?</h2><p>PropControl nunca lo registra automáticamente.</p></div>
      <button type="button" class="quiet-button" data-whatsapp-not-yet aria-label="Cerrar">×</button>
    </header>
    <div class="whatsapp-return-summary"><span>WhatsApp abierto</span><strong>${escapeHtml(attempt.phone)}</strong><p>${escapeHtml(attempt.message)}</p></div>
    <footer class="whatsapp-contact-actions">
      <button type="button" class="secondary" data-whatsapp-not-yet>Todavía no</button>
      <button type="button" data-whatsapp-confirm-sent>Sí, registrar</button>
    </footer>`;
}

function showReturnConfirmation(attempt: PendingWhatsAppAttempt): void {
  const client = activeClient(attempt.clientId);
  if (!client) {
    dismissPendingWhatsAppAttempt(attempt);
    return;
  }
  currentAttempt = attempt;
  promptedAttemptId = attempt.id;
  openOverlay();
  panel().dataset.clientId = String(client.id);
  panel().innerHTML = returnConfirmationMarkup(client, attempt);
  queueMicrotask(() => panel().querySelector<HTMLButtonElement>('[data-whatsapp-confirm-sent]')?.focus({ preventScroll: true }));
}

function maybeConfirmReturn(): void {
  if (document.visibilityState === 'hidden') return;
  const attempt = loadPendingWhatsAppAttempt();
  if (!attempt?.openedAt || promptedAttemptId === attempt.id) return;
  if (Date.now() - Date.parse(attempt.openedAt) < RETURN_DELAY_MS) return;
  showReturnConfirmation(attempt);
}

function followUpOptions(selectedDays: number | null): string {
  const options = [
    [1, 'Mañana'],
    [3, 'En 3 días'],
    [7, 'En 7 días'],
    [14, 'En 14 días'],
    [30, 'En 30 días'],
  ] as const;
  return options.map(([days, label]) => `<label><input type="radio" name="follow-up-choice" value="${days}"${selectedDays === days ? ' checked' : ''}> <span>${label}</span></label>`).join('');
}

function renderFollowUpPanel(client: Client, attempt: PendingWhatsAppAttempt, activityId: number): void {
  const hasOpenConversation = state.crm.conversations.some((conversation) => conversation.clientId === client.id && conversation.mode !== 'Pausada');
  const suggestion = suggestedFollowUp(client, hasOpenConversation);
  const customSelected = suggestion.days === null;
  openOverlay();
  panel().dataset.clientId = String(client.id);
  panel().dataset.attemptId = attempt.id;
  panel().dataset.activityId = String(activityId);
  panel().innerHTML = `<header class="whatsapp-contact-heading">
      <div><span class="eyebrow">Próximo paso</span><h2 id="whatsapp-contact-title">¿Cuándo querés volver a contactar a ${escapeHtml(client.name)}?</h2><p>La fecha es sugerida; podés cambiarla o continuar sin seguimiento.</p></div>
      <button type="button" class="quiet-button" data-whatsapp-close aria-label="Cerrar">×</button>
    </header>
    <p class="whatsapp-followup-reason">${escapeHtml(suggestion.reason)}</p>
    <form class="whatsapp-followup-form" data-whatsapp-followup-form>
      <div class="whatsapp-followup-options">${followUpOptions(suggestion.days)}
        <label><input type="radio" name="follow-up-choice" value="custom"${customSelected ? ' checked' : ''}> <span>Elegir fecha</span></label>
        <label><input type="radio" name="follow-up-choice" value="none"> <span>Sin seguimiento por ahora</span></label>
      </div>
      <label class="whatsapp-custom-date"${customSelected ? '' : ' hidden'}>Fecha personalizada<input type="date" name="custom-date" value="${escapeHtml(suggestion.date)}" min="${addLocalDaysIso(0)}"></label>
      <footer class="whatsapp-contact-actions"><button type="button" class="secondary" data-whatsapp-close>Cancelar</button><button type="submit">Guardar seguimiento</button></footer>
    </form>`;
  queueMicrotask(() => panel().querySelector<HTMLInputElement>('input[name="follow-up-choice"]:checked')?.focus({ preventScroll: true }));
}

function saveFollowUp(form: HTMLFormElement): void {
  const clientId = Number(panel().dataset.clientId);
  const attemptId = panel().dataset.attemptId || '';
  const activityId = Number(panel().dataset.activityId);
  const client = activeClient(clientId);
  const choice = new FormData(form).get('follow-up-choice')?.toString() || '';
  if (!client || !attemptId || !activityId) {
    closeOverlay();
    return;
  }
  if (choice === 'none') {
    closeOverlay();
    notify(`Contacto con ${client.name} registrado sin próximo seguimiento.`);
    document.dispatchEvent(new CustomEvent('trv-render'));
    return;
  }
  const days = Number(choice);
  const date = choice === 'custom'
    ? new FormData(form).get('custom-date')?.toString() || ''
    : Number.isFinite(days) ? addLocalDaysIso(days) : '';
  if (!date) return;
  const result = scheduleWhatsAppFollowUp(client.id, attemptId, activityId, date);
  if (!result) {
    notify('No se pudo programar el seguimiento porque el permiso cambió.');
    closeOverlay();
    return;
  }
  closeOverlay();
  notify(`Seguimiento de ${client.name} programado para ${date}.`);
  document.dispatchEvent(new CustomEvent('trv-render'));
}

function contactStatusMarkup(client: Client): string {
  const summary = whatsappContactSummary(client);
  const lastDate = summary.lastContactAt ? new Date(summary.lastContactAt) : null;
  const lastLabel = lastDate && !Number.isNaN(lastDate.getTime())
    ? new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(lastDate)
    : 'Sin contacto registrado';
  const followUpLabel = summary.followUpState === 'today'
    ? 'Hoy'
    : summary.followUpState === 'overdue'
      ? 'Vencido'
      : summary.followUpState === 'upcoming'
        ? 'Próximo'
        : 'Sin seguimiento';
  const dateLabel = summary.nextFollowUp
    ? new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${summary.nextFollowUp}T12:00:00`))
    : '';
  return `<div class="mvp-whatsapp-contact-summary" data-whatsapp-contact-summary>
    <div><span>Último WhatsApp</span><strong>${escapeHtml(lastLabel)}</strong>${summary.responsible ? `<small>${escapeHtml(summary.responsible)}</small>` : ''}</div>
    <div class="state-${summary.followUpState}"><span>Seguimiento</span><strong>${followUpLabel}</strong>${dateLabel ? `<small>${escapeHtml(dateLabel)}</small>` : ''}</div>
  </div>`;
}

export function enhanceWhatsAppContactFlow(): void {
  document.querySelectorAll<HTMLElement>('.mvp-lead-card[data-client-id]').forEach((card) => {
    const client = activeClient(Number(card.dataset.clientId));
    if (!client) return;
    const actions = card.querySelector<HTMLElement>('.mvp-lead-quick-actions');
    if (actions && !actions.querySelector('[data-contact-whatsapp]')) {
      actions.querySelector('.mvp-contact-btn.wa')?.remove();
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'mvp-whatsapp-contact-button';
      button.dataset.contactWhatsapp = String(client.id);
      button.textContent = 'Contactar por WhatsApp';
      actions.prepend(button);
    }
    const existingSummary = card.querySelector<HTMLElement>('[data-whatsapp-contact-summary]');
    const summaryHtml = contactStatusMarkup(client);
    if (existingSummary) existingSummary.outerHTML = summaryHtml;
    else actions?.insertAdjacentHTML('beforebegin', summaryHtml);
  });

  document.querySelectorAll<HTMLElement>('.agenda-card').forEach((card) => {
    const clientId = Number(card.querySelector<HTMLElement>('[data-edit-client]')?.dataset.editClient);
    const client = activeClient(clientId);
    const actions = card.querySelector<HTMLElement>('.agenda-more-actions-panel');
    if (!client || !actions || actions.querySelector('[data-contact-whatsapp]')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary agenda-contact-whatsapp';
    button.dataset.contactWhatsapp = String(client.id);
    button.textContent = 'Contactar por WhatsApp';
    actions.prepend(button);
  });
}

function bindPanelEvents(): void {
  const root = overlay();
  root.addEventListener('input', (event) => {
    const target = event.target as HTMLElement;
    if (target.matches('[data-whatsapp-phone], [data-whatsapp-message]')) updateContactValidation();
  });
  root.addEventListener('change', (event) => {
    const target = event.target as HTMLInputElement;
    if (target.name !== 'follow-up-choice') return;
    const custom = panel().querySelector<HTMLElement>('.whatsapp-custom-date');
    if (custom) custom.hidden = target.value !== 'custom';
  });
  root.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('[data-whatsapp-close]')) { closeOverlay(); return; }
    if (target.closest('[data-whatsapp-copy]')) { void copyMessage(); return; }
    if (target.closest('[data-whatsapp-open]')) { openWhatsAppChannel(); return; }
    if (target.closest('[data-whatsapp-manual-register]')) { manualRegister(); return; }
    if (target.closest('[data-whatsapp-confirm-sent]') && currentAttempt) { registerAndContinue(currentAttempt); return; }
    if (target.closest('[data-whatsapp-not-yet]')) {
      if (currentAttempt) dismissPendingWhatsAppAttempt(currentAttempt);
      promptedAttemptId = currentAttempt?.id || promptedAttemptId;
      closeOverlay();
    }
  });
  root.addEventListener('submit', (event) => {
    const form = (event.target as HTMLElement).closest<HTMLFormElement>('[data-whatsapp-followup-form]');
    if (!form) return;
    event.preventDefault();
    saveFollowUp(form);
  });
}

function bindGlobalEvents(): void {
  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const trigger = target.closest<HTMLElement>('[data-contact-whatsapp], .mvp-contact-btn.wa');
    if (!trigger) return;
    event.preventDefault();
    event.stopPropagation();
    const cardId = Number(trigger.dataset.contactWhatsapp || trigger.closest<HTMLElement>('[data-client-id]')?.dataset.clientId);
    const client = activeClient(cardId);
    if (!client) {
      trigger.remove();
      notify('No tenés permiso para operar sobre este lead.');
      return;
    }
    renderContactPanel(client);
  }, true);
  document.addEventListener('trv-render', () => queueMicrotask(enhanceWhatsAppContactFlow));
  document.addEventListener('propcontrol-cloud-status', () => queueMicrotask(enhanceWhatsAppContactFlow));
  window.addEventListener('focus', maybeConfirmReturn);
  window.addEventListener('pageshow', maybeConfirmReturn);
  document.addEventListener('visibilitychange', maybeConfirmReturn);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !overlay().hidden) closeOverlay();
  });
  const observer = new MutationObserver(() => queueMicrotask(enhanceWhatsAppContactFlow));
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

export function installWhatsAppContactFlow(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  bindPanelEvents();
  bindGlobalEvents();
  queueMicrotask(() => {
    enhanceWhatsAppContactFlow();
    maybeConfirmReturn();
  });
}

installWhatsAppContactFlow();
