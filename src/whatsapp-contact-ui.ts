import { resolveHumanIdentity, safeOrganizationName } from './human-identity.js';
import type { Client, WhatsAppConversation } from './models.js';
import { saveData, state } from './store.js';
import { visibleClients, visibleConversations } from './team-access.js';
import { escapeHtml } from './utils.js';
import { buildContextualWhatsAppMessage } from './whatsapp-message-context.js';
import {
  followUpDateForChoice,
  followUpPreview,
} from './whatsapp-followup-selection.js';
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
  whatsappContactSummary,
  whatsappUrl,
  type PendingWhatsAppAttempt,
} from './whatsapp-contact.js';

const PANEL_ID = 'propcontrol-whatsapp-contact';
const RETURN_DELAY_MS = 650;
let installed = false;
let promptedAttemptId = '';
let currentAttempt: PendingWhatsAppAttempt | null = null;

function clientById(clientId: number): Client | null {
  return visibleClients().find((client) => client.id === clientId) ?? null;
}

function conversationForClient(clientId: number): WhatsAppConversation | null {
  return visibleConversations()
    .filter((conversation) => conversation.clientId === clientId)
    .sort((left, right) => right.lastActivity.localeCompare(left.lastActivity))[0] ?? null;
}

function notify(message: string): void {
  document.dispatchEvent(new CustomEvent('propcontrol-cloud-status', { detail: { message, kind: 'success' } }));
}

function root(): HTMLElement {
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
  return root().querySelector<HTMLElement>('.whatsapp-contact-panel')!;
}

function show(): void {
  root().hidden = false;
  document.body.classList.add('whatsapp-contact-open');
}

function close(): void {
  root().hidden = true;
  document.body.classList.remove('whatsapp-contact-open');
  currentAttempt = null;
}

function identity() {
  const member = state.crm.teamMembers.find((item) => item.id === state.activeMemberId);
  return resolveHumanIdentity({
    member,
    profileName: state.crm.settings.profileName,
    profileEmail: state.crm.settings.profileEmail,
    organizationName: state.crm.organization.name,
    organizationId: state.crm.organization.id,
  });
}

function agency(): string {
  return safeOrganizationName(state.crm.settings.agencyName.trim() || state.crm.organization.name.trim());
}

function phonePreview(value: string): string {
  const result = normalizeWhatsAppPhone(value);
  return result.valid
    ? `<span class="whatsapp-phone-valid">Se usará ${escapeHtml(result.display)}</span>`
    : `<span class="whatsapp-phone-error">${escapeHtml(result.reason)}</span>`;
}

function renderContact(client: Client, phone = client.phone, message?: string): void {
  const human = identity();
  const context = human.valid
    ? buildContextualWhatsAppMessage({
      client,
      responsibleFirstName: human.firstName,
      agency: agency(),
      conversation: conversationForClient(client.id),
    })
    : {
      message: '',
      question: '',
      contextNote: 'No se generó un mensaje porque falta una identidad humana válida.',
      blocked: true,
      reason: human.reason,
      source: 'fallback' as const,
    };
  const text = message ?? context.message;
  const blocked = context.blocked;

  show();
  panel().dataset.clientId = String(client.id);
  panel().dataset.contactBlocked = String(blocked);
  panel().innerHTML = `<header class="whatsapp-contact-heading">
      <div><span class="eyebrow">Contacto asistido</span><h2 id="whatsapp-contact-title">Contactar por WhatsApp</h2><p>Revisá el número y el mensaje antes de abrir WhatsApp.</p></div>
      <button type="button" class="quiet-button" data-whatsapp-close aria-label="Cerrar">×</button>
    </header>
    <div class="whatsapp-contact-lead"><span>Lead</span><strong>${escapeHtml(client.name)}</strong><small>${escapeHtml(client.interest || 'Consulta inmobiliaria')}</small></div>
    <div class="whatsapp-context-note${blocked ? ' blocked' : ''}" data-whatsapp-context-note role="${blocked ? 'alert' : 'note'}">
      <strong>${blocked ? 'Contacto bloqueado para revisión' : context.source === 'conversation' ? 'Contexto disponible' : 'Sin historial disponible'}</strong>
      <p>${escapeHtml(blocked ? context.reason : context.contextNote)}</p>
    </div>
    <label class="whatsapp-contact-field">Teléfono registrado
      <input data-whatsapp-phone value="${escapeHtml(phone)}" inputmode="tel" autocomplete="tel"${blocked ? ' disabled' : ''}>
      <small data-whatsapp-phone-preview>${phonePreview(phone)}</small>
    </label>
    <label class="whatsapp-contact-update-phone" hidden><input type="checkbox" data-whatsapp-save-phone> Actualizar el teléfono del lead con este número</label>
    <label class="whatsapp-contact-field whatsapp-message-field">Mensaje sugerido editable
      <textarea data-whatsapp-message rows="6"${blocked ? ' disabled' : ''}>${escapeHtml(text)}</textarea>
      <small data-whatsapp-message-status></small>
    </label>
    <div class="whatsapp-contact-copy-row"><button type="button" class="secondary" data-whatsapp-copy${blocked ? ' disabled' : ''}>Copiar mensaje</button><span data-whatsapp-copy-status aria-live="polite"></span></div>
    <footer class="whatsapp-contact-actions">
      <button type="button" class="secondary" data-whatsapp-manual-register${blocked ? ' disabled' : ''}>Ya lo envié, registrar</button>
      <button type="button" data-whatsapp-open${blocked ? ' disabled' : ''}>Abrir WhatsApp</button>
    </footer>`;
  validateContact();
  queueMicrotask(() => {
    if (blocked) panel().querySelector<HTMLButtonElement>('[data-whatsapp-close]')?.focus({ preventScroll: true });
    else panel().querySelector<HTMLTextAreaElement>('[data-whatsapp-message]')?.focus({ preventScroll: true });
  });
}

function contactFields(): { client: Client | null; phone: HTMLInputElement | null; message: HTMLTextAreaElement | null } {
  return {
    client: clientById(Number(panel().dataset.clientId)),
    phone: panel().querySelector<HTMLInputElement>('[data-whatsapp-phone]'),
    message: panel().querySelector<HTMLTextAreaElement>('[data-whatsapp-message]'),
  };
}

function validateContact(): void {
  const { client, phone, message } = contactFields();
  if (!client || !phone || !message) return;
  const blocked = panel().dataset.contactBlocked === 'true';
  const normalized = normalizeWhatsAppPhone(phone.value);
  const preview = panel().querySelector<HTMLElement>('[data-whatsapp-phone-preview]');
  if (preview) preview.innerHTML = phonePreview(phone.value);
  const status = panel().querySelector<HTMLElement>('[data-whatsapp-message-status]');
  if (status) status.textContent = blocked
    ? 'El contacto requiere revisión humana.'
    : message.value.trim() ? `${message.value.length} caracteres` : 'El mensaje está vacío.';
  const updatePhone = panel().querySelector<HTMLElement>('.whatsapp-contact-update-phone');
  if (updatePhone) updatePhone.hidden = blocked || phone.value.trim() === client.phone.trim();
  panel().querySelectorAll<HTMLButtonElement>('[data-whatsapp-open], [data-whatsapp-manual-register], [data-whatsapp-copy]')
    .forEach((button) => { button.disabled = blocked || !normalized.valid || !message.value.trim(); });
}

function attemptFromPanel(): PendingWhatsAppAttempt | null {
  if (panel().dataset.contactBlocked === 'true') return null;
  const { client, phone, message } = contactFields();
  if (!client || !phone || !message) return null;
  const normalized = normalizeWhatsAppPhone(phone.value);
  const text = message.value.trim();
  if (!normalized.valid || !text) {
    validateContact();
    return null;
  }
  if (panel().querySelector<HTMLInputElement>('[data-whatsapp-save-phone]')?.checked && phone.value.trim() !== client.phone.trim()) {
    client.phone = phone.value.trim();
    saveData(`Teléfono de lead actualizado: ${client.name}`);
  }
  const attempt = createPendingWhatsAppAttempt(client, normalized.normalized, text);
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

function openChannel(): void {
  const attempt = attemptFromPanel();
  if (!attempt) return;
  const opened = markPendingAttemptOpened(attempt);
  promptedAttemptId = '';
  window.open(whatsappUrl(opened.phone, opened.message), '_blank', 'noopener,noreferrer');
  close();
}

function register(attempt: PendingWhatsAppAttempt): void {
  const result = registerWhatsAppContact(attempt);
  if (!result) {
    dismissPendingWhatsAppAttempt(attempt);
    close();
    notify('No se pudo registrar el contacto porque el permiso o el intento ya no son válidos.');
    return;
  }
  renderFollowUp(result.client, attempt, result.activity.id);
  document.dispatchEvent(new CustomEvent('trv-render'));
}

function renderConfirmation(attempt: PendingWhatsAppAttempt): void {
  const client = clientById(attempt.clientId);
  if (!client) {
    dismissPendingWhatsAppAttempt(attempt);
    return;
  }
  currentAttempt = attempt;
  promptedAttemptId = attempt.id;
  show();
  panel().dataset.clientId = String(client.id);
  panel().innerHTML = `<header class="whatsapp-contact-heading">
      <div><span class="eyebrow">Confirmación</span><h2 id="whatsapp-contact-title">¿Enviaste el mensaje a ${escapeHtml(client.name)}?</h2><p>PropControl nunca lo registra automáticamente.</p></div>
      <button type="button" class="quiet-button" data-whatsapp-not-yet aria-label="Cerrar">×</button>
    </header>
    <div class="whatsapp-return-summary"><span>WhatsApp abierto</span><strong>${escapeHtml(attempt.phone)}</strong><p>${escapeHtml(attempt.message)}</p></div>
    <footer class="whatsapp-contact-actions"><button type="button" class="secondary" data-whatsapp-not-yet>Todavía no</button><button type="button" data-whatsapp-confirm-sent>Sí, registrar</button></footer>`;
  queueMicrotask(() => panel().querySelector<HTMLButtonElement>('[data-whatsapp-confirm-sent]')?.focus({ preventScroll: true }));
}

function maybeConfirmReturn(): void {
  if (document.visibilityState === 'hidden') return;
  const attempt = loadPendingWhatsAppAttempt();
  if (!attempt?.openedAt || promptedAttemptId === attempt.id) return;
  if (Date.now() - Date.parse(attempt.openedAt) < RETURN_DELAY_MS) return;
  renderConfirmation(attempt);
}

function followUpOptions(selectedDays: number | null): string {
  return ([[1, 'Mañana'], [3, 'En 3 días'], [7, 'En 7 días'], [14, 'En 14 días'], [30, 'En 30 días']] as const)
    .map(([days, label]) => `<label><input type="radio" name="follow-up-choice" value="${days}"${selectedDays === days ? ' checked' : ''}> <span>${label}</span></label>`)
    .join('');
}

function updateFollowUpSelection(): void {
  const form = panel().querySelector<HTMLFormElement>('[data-whatsapp-followup-form]');
  if (!form) return;
  const choice = form.querySelector<HTMLInputElement>('input[name="follow-up-choice"]:checked')?.value || '';
  const customInput = form.querySelector<HTMLInputElement>('input[name="custom-date"]');
  const date = followUpDateForChoice(choice, customInput?.value || '');
  const selected = form.querySelector<HTMLInputElement>('input[name="selected-date"]');
  if (selected) selected.value = date;
  const custom = form.querySelector<HTMLElement>('.whatsapp-custom-date');
  if (custom) custom.hidden = choice !== 'custom';
  const preview = form.querySelector<HTMLElement>('[data-whatsapp-followup-preview]');
  if (preview) preview.textContent = followUpPreview(date);
}

function renderFollowUp(client: Client, attempt: PendingWhatsAppAttempt, activityId: number): void {
  const conversationOpen = state.crm.conversations.some((conversation) => conversation.clientId === client.id && conversation.mode !== 'Pausada');
  const suggestion = suggestedFollowUp(client, conversationOpen);
  show();
  panel().dataset.clientId = String(client.id);
  panel().dataset.attemptId = attempt.id;
  panel().dataset.activityId = String(activityId);
  panel().innerHTML = `<header class="whatsapp-contact-heading">
      <div><span class="eyebrow">Próximo paso</span><h2 id="whatsapp-contact-title">¿Cuándo querés volver a contactar a ${escapeHtml(client.name)}?</h2><p>La fecha visible será exactamente la fecha guardada.</p></div>
      <button type="button" class="quiet-button" data-whatsapp-close aria-label="Cerrar">×</button>
    </header>
    <p class="whatsapp-followup-reason">${escapeHtml(suggestion.reason)}</p>
    <form class="whatsapp-followup-form" data-whatsapp-followup-form>
      <div class="whatsapp-followup-options">${followUpOptions(suggestion.days)}
        <label><input type="radio" name="follow-up-choice" value="custom"${suggestion.days === null ? ' checked' : ''}> <span>Elegir fecha</span></label>
        <label><input type="radio" name="follow-up-choice" value="none"> <span>Sin seguimiento por ahora</span></label>
      </div>
      <label class="whatsapp-custom-date"${suggestion.days === null ? '' : ' hidden'}>Fecha personalizada<input type="date" name="custom-date" value="${escapeHtml(suggestion.date)}" min="${addLocalDaysIso(0)}"></label>
      <input type="hidden" name="selected-date" value="${escapeHtml(suggestion.date)}">
      <p class="whatsapp-followup-preview" data-whatsapp-followup-preview aria-live="polite">${escapeHtml(followUpPreview(suggestion.date))}</p>
      <footer class="whatsapp-contact-actions"><button type="button" class="secondary" data-whatsapp-close>Cancelar</button><button type="submit">Guardar seguimiento</button></footer>
    </form>`;
}

function saveFollowUp(form: HTMLFormElement): void {
  const client = clientById(Number(panel().dataset.clientId));
  const attemptId = panel().dataset.attemptId || '';
  const activityId = Number(panel().dataset.activityId);
  const data = new FormData(form);
  const choice = data.get('follow-up-choice')?.toString() || '';
  if (!client || !attemptId || !activityId) {
    close();
    return;
  }
  if (choice === 'none') {
    close();
    notify(`Contacto con ${client.name} registrado sin próximo seguimiento.`);
    document.dispatchEvent(new CustomEvent('trv-render'));
    return;
  }
  const date = data.get('selected-date')?.toString() || '';
  if (!date) return;
  if (!scheduleWhatsAppFollowUp(client.id, attemptId, activityId, date)) {
    close();
    notify('No se pudo programar el seguimiento porque el permiso cambió.');
    return;
  }
  close();
  notify(`Seguimiento de ${client.name} programado para ${date}.`);
  document.dispatchEvent(new CustomEvent('trv-render'));
}

function statusPresentation(client: Client): { signature: string; html: string } {
  const summary = whatsappContactSummary(client);
  const lastDate = summary.lastContactAt ? new Date(summary.lastContactAt) : null;
  const last = lastDate && !Number.isNaN(lastDate.getTime())
    ? new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(lastDate)
    : 'Sin contacto registrado';
  const stateLabel = summary.followUpState === 'today' ? 'Hoy'
    : summary.followUpState === 'overdue' ? 'Vencido'
      : summary.followUpState === 'upcoming' ? 'Próximo' : 'Sin seguimiento';
  const date = summary.nextFollowUp
    ? new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${summary.nextFollowUp}T12:00:00`))
    : '';
  const signature = [summary.lastContactAt, summary.responsible, summary.nextFollowUp, summary.followUpState].join('|');
  return {
    signature,
    html: `<div class="mvp-whatsapp-contact-summary" data-whatsapp-contact-summary data-contact-signature="${escapeHtml(signature)}">
      <div><span>Último WhatsApp</span><strong>${escapeHtml(last)}</strong>${summary.responsible ? `<small>${escapeHtml(summary.responsible)}</small>` : ''}</div>
      <div class="state-${summary.followUpState}"><span>Seguimiento</span><strong>${stateLabel}</strong>${date ? `<small>${escapeHtml(date)}</small>` : ''}</div>
    </div>`,
  };
}

export function enhanceWhatsAppContactFlow(): void {
  document.querySelectorAll<HTMLElement>('.mvp-lead-card[data-client-id]').forEach((card) => {
    const client = clientById(Number(card.dataset.clientId));
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
    const presentation = statusPresentation(client);
    const summary = card.querySelector<HTMLElement>('[data-whatsapp-contact-summary]');
    if (!summary) actions?.insertAdjacentHTML('beforebegin', presentation.html);
    else if (summary.dataset.contactSignature !== presentation.signature) summary.outerHTML = presentation.html;
  });

  document.querySelectorAll<HTMLElement>('.agenda-card').forEach((card) => {
    const clientId = Number(card.querySelector<HTMLElement>('[data-edit-client]')?.dataset.editClient);
    const actions = card.querySelector<HTMLElement>('.agenda-more-actions-panel');
    if (!clientById(clientId) || !actions || actions.querySelector('[data-contact-whatsapp]')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary agenda-contact-whatsapp';
    button.dataset.contactWhatsapp = String(clientId);
    button.textContent = 'Contactar por WhatsApp';
    actions.prepend(button);
  });
}

function bindPanelEvents(): void {
  const element = root();
  element.addEventListener('input', (event) => {
    const target = event.target as HTMLElement;
    if (target.matches('[data-whatsapp-phone], [data-whatsapp-message]')) validateContact();
    if (target.matches('input[name="custom-date"]')) updateFollowUpSelection();
  });
  element.addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement;
    if (input.name === 'follow-up-choice' || input.name === 'custom-date') updateFollowUpSelection();
  });
  element.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('[data-whatsapp-close]')) { close(); return; }
    if (target.closest('[data-whatsapp-copy]')) { void copyMessage(); return; }
    if (target.closest('[data-whatsapp-open]')) { openChannel(); return; }
    if (target.closest('[data-whatsapp-manual-register]')) {
      const attempt = attemptFromPanel();
      if (attempt) register(attempt);
      return;
    }
    if (target.closest('[data-whatsapp-confirm-sent]') && currentAttempt) { register(currentAttempt); return; }
    if (target.closest('[data-whatsapp-not-yet]')) {
      if (currentAttempt) dismissPendingWhatsAppAttempt(currentAttempt);
      promptedAttemptId = currentAttempt?.id || promptedAttemptId;
      close();
    }
  });
  element.addEventListener('submit', (event) => {
    const form = (event.target as HTMLElement).closest<HTMLFormElement>('[data-whatsapp-followup-form]');
    if (!form) return;
    event.preventDefault();
    saveFollowUp(form);
  });
}

function bindGlobalEvents(): void {
  document.addEventListener('click', (event) => {
    const trigger = (event.target as HTMLElement).closest<HTMLElement>('[data-contact-whatsapp], .mvp-contact-btn.wa');
    if (!trigger) return;
    event.preventDefault();
    event.stopPropagation();
    const clientId = Number(trigger.dataset.contactWhatsapp || trigger.closest<HTMLElement>('[data-client-id]')?.dataset.clientId);
    const client = clientById(clientId);
    if (!client) {
      trigger.remove();
      notify('No tenés permiso para operar sobre este lead.');
      return;
    }
    renderContact(client);
  }, true);
  document.addEventListener('trv-render', () => queueMicrotask(enhanceWhatsAppContactFlow));
  document.addEventListener('propcontrol-cloud-status', () => queueMicrotask(enhanceWhatsAppContactFlow));
  window.addEventListener('focus', maybeConfirmReturn);
  window.addEventListener('pageshow', maybeConfirmReturn);
  document.addEventListener('visibilitychange', maybeConfirmReturn);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !root().hidden) close();
  });

  const initialObserver = new MutationObserver(() => {
    if (!document.querySelector('.mvp-lead-card')) return;
    initialObserver.disconnect();
    queueMicrotask(enhanceWhatsAppContactFlow);
  });
  initialObserver.observe(document.documentElement, { childList: true, subtree: true });
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
