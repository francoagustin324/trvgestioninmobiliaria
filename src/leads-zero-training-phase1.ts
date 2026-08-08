import { formatLeadBudget } from './lead-budget-display.js';
import { leadCardAttentionPresentation } from './lead-card-attention.js';
import { leadFollowUpDisplay } from './lead-list-priority.js';
import { requestLeadQualification } from './lead-qualification-ui.js';
import type { Client } from './models.js';
import { state } from './store.js';
import { visibleClients } from './team-access.js';
import { escapeHtml } from './utils.js';
import {
  addLocalDaysIso,
  dismissPendingWhatsAppAttempt,
  loadPendingWhatsAppAttemptResult,
  normalizeWhatsAppPhone,
  registerWhatsAppContact,
  scheduleWhatsAppFollowUp,
  suggestedFollowUp,
  type PendingWhatsAppAttempt,
} from './whatsapp-contact.js';
import { followUpDateForChoice, followUpPreview, localDateLabel } from './whatsapp-followup-selection.js';

interface ConfirmedContact {
  clientId: number;
  attempt: PendingWhatsAppAttempt;
  activityId: number;
  recommendedDate: string;
  recommendedDays: number | null;
}

const RETURN_PROMPT_DELAY_MS = 650;
let installed = false;
let patchQueued = false;
let confirmedContact: ConfirmedContact | null = null;
let whatsappPanelObserver: MutationObserver | null = null;
let whatsappRootObserver: MutationObserver | null = null;
let observedWhatsAppPanel: HTMLElement | null = null;
let returnPromptTimer: number | null = null;

function clientById(clientId: number): Client | null {
  return visibleClients().find((client) => client.id === clientId) ?? null;
}

function panel(): HTMLElement | null {
  return document.querySelector<HTMLElement>('#propcontrol-whatsapp-contact .whatsapp-contact-panel');
}

function overlay(): HTMLElement | null {
  return document.getElementById('propcontrol-whatsapp-contact');
}

function enterModalMode(): void {
  overlay()?.classList.remove('whatsapp-zero-done-overlay');
  panel()?.setAttribute('aria-modal', 'true');
  document.body.classList.add('whatsapp-contact-open');
}

function enterDoneMode(): void {
  overlay()?.classList.add('whatsapp-zero-done-overlay');
  panel()?.setAttribute('aria-modal', 'false');
  document.body.classList.remove('whatsapp-contact-open');
}

function clearReturnPromptTimer(): void {
  if (returnPromptTimer === null) return;
  window.clearTimeout(returnPromptTimer);
  returnPromptTimer = null;
}

function humanAction(client: Client): string {
  const action = leadCardAttentionPresentation(client).actionLabel.trim();
  if (/whatsapp/i.test(action) || action === 'Contactar por primera vez') return 'WhatsApp';
  if (action === 'Programar seguimiento') return 'Elegir próximo contacto';
  if (action === 'Definir acción' || action === 'Definir próxima acción') return 'Definir próximo paso';
  return action || 'Definir próximo paso';
}

function humanDate(client: Client): string {
  const label = leadFollowUpDisplay(client).dateLabel.trim();
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : '';
}

function budget(client: Client): string {
  const value = formatLeadBudget(client);
  return value === 'No confirmado' ? 'Sin confirmar' : value;
}

function ensureDetailTools(card: HTMLElement): HTMLElement | null {
  const content = card.querySelector<HTMLElement>('.mvp-lead-full-content');
  if (!content) return null;
  let tools = content.querySelector<HTMLElement>('.mvp-zero-detail-tools');
  if (!tools) {
    tools = document.createElement('div');
    tools.className = 'mvp-zero-detail-tools';
    content.prepend(tools);
  }
  return tools;
}

function moveSecondaryCardContent(card: HTMLElement): void {
  const tools = ensureDetailTools(card);
  const content = card.querySelector<HTMLElement>('.mvp-lead-full-content');
  if (!tools || !content) return;

  const summary = card.querySelector<HTMLElement>('[data-whatsapp-contact-summary]');
  if (summary && !content.contains(summary)) tools.append(summary);

  const followUpMenu = card.querySelector<HTMLElement>('.mvp-lead-next-action .mvp-lead-followup-menu');
  if (followUpMenu && !content.contains(followUpMenu)) tools.append(followUpMenu);
}

function renderCardActions(card: HTMLElement, client: Client): void {
  const actions = card.querySelector<HTMLElement>('.mvp-lead-quick-actions');
  if (!actions) return;
  if (actions.dataset.zeroTrainingActions === 'true') {
    const whatsapp = actions.querySelector<HTMLButtonElement>('[data-contact-whatsapp]');
    if (whatsapp && whatsapp.textContent !== 'WhatsApp') whatsapp.textContent = 'WhatsApp';
    return;
  }

  const secondaryLinks = Array.from(actions.querySelectorAll<HTMLAnchorElement>('a.mvp-contact-btn:not(.wa)'))
    .map((link) => link.outerHTML)
    .join('');
  const tools = ensureDetailTools(card);
  if (secondaryLinks && tools && !tools.querySelector('.mvp-zero-secondary-contact')) {
    const wrapper = document.createElement('div');
    wrapper.className = 'mvp-zero-secondary-contact';
    wrapper.innerHTML = secondaryLinks;
    tools.append(wrapper);
  }

  actions.dataset.zeroTrainingActions = 'true';
  actions.innerHTML = `<button type="button" class="mvp-whatsapp-contact-button mvp-zero-primary" data-contact-whatsapp="${client.id}">WhatsApp</button>
    <button type="button" class="secondary mvp-zero-edit" data-edit-client="${client.id}">Editar</button>
    <details class="mvp-lead-actions-menu">
      <summary aria-label="Más acciones de ${escapeHtml(client.name)}" title="Más acciones">•••</summary>
      <div class="mvp-lead-actions-popover">
        <button type="button" class="mvp-zero-menu-action" data-open-lead-details="${client.id}">Ver detalles</button>
        <button type="button" class="mvp-zero-menu-action" data-zero-auto-qualify="${client.id}">Completar datos con IA</button>
        <div class="mvp-zero-menu-danger">
          <button type="button" class="delete" data-delete="clients" data-id="${client.id}">Eliminar</button>
        </div>
      </div>
    </details>`;
}

function patchLeadCard(card: HTMLElement): void {
  const client = clientById(Number(card.dataset.clientId));
  if (!client) return;

  moveSecondaryCardContent(card);

  const interest = card.querySelector<HTMLElement>('.mvp-lead-interest');
  const wanted = client.interest?.trim() || 'Sin confirmar';
  if (interest && interest.dataset.zeroTraining !== wanted) {
    interest.dataset.zeroTraining = wanted;
    interest.innerHTML = `<span>Busca:</span><strong>${escapeHtml(wanted)}</strong>`;
  }

  const facts = card.querySelector<HTMLElement>('.mvp-lead-compact-facts');
  const budgetValue = budget(client);
  if (facts && facts.dataset.zeroTraining !== budgetValue) {
    facts.dataset.zeroTraining = budgetValue;
    facts.className = 'mvp-lead-compact-facts mvp-zero-main-facts';
    facts.innerHTML = `<div class="mvp-lead-fact" data-lead-fact="budget"><span>Presupuesto:</span><strong>${escapeHtml(budgetValue)}</strong></div>`;
  }

  const next = card.querySelector<HTMLElement>('.mvp-lead-next-action');
  if (next) {
    const action = humanAction(client);
    const date = humanDate(client);
    const signature = `${action}|${date}`;
    if (next.dataset.zeroTraining !== signature) {
      const menu = next.querySelector<HTMLElement>('.mvp-lead-followup-menu');
      const tools = ensureDetailTools(card);
      if (menu && tools) tools.append(menu);
      next.dataset.zeroTraining = signature;
      next.innerHTML = `<div class="mvp-zero-next-copy"><span>Próximo paso</span><strong>${escapeHtml(action)}</strong>${date ? `<small>${escapeHtml(date)}</small>` : ''}</div>`;
    }
  }

  const fullSheet = card.querySelector<HTMLDetailsElement>('[data-lead-full-sheet]');
  const fullLabel = fullSheet?.querySelector<HTMLElement>('summary > span');
  if (fullLabel && fullLabel.textContent !== 'Ver detalles') fullLabel.textContent = 'Ver detalles';

  renderCardActions(card, client);
  moveSecondaryCardContent(card);
}

function validPreparation(panelElement: HTMLElement): boolean {
  return Boolean(panelElement.querySelector('[data-whatsapp-open]') && panelElement.querySelector('[data-whatsapp-message]'));
}

function safetyMarkup(panelElement: HTMLElement, blocked: boolean): { contextNote: string; identityForm: string } {
  const originalIdentityForm = panelElement.querySelector<HTMLElement>('[data-whatsapp-identity-form]');
  let identityForm = '';
  if (originalIdentityForm) {
    const clone = originalIdentityForm.cloneNode(true) as HTMLElement;
    clone.querySelector('.whatsapp-context-note')?.remove();
    identityForm = clone.outerHTML;
  }
  const originalContextNote = panelElement.querySelector<HTMLElement>('[data-whatsapp-context-note]');
  return {
    contextNote: blocked && originalContextNote ? originalContextNote.outerHTML : '',
    identityForm,
  };
}

function patchPreparation(panelElement: HTMLElement): void {
  if (!validPreparation(panelElement) || panelElement.querySelector('[data-whatsapp-message-preview]')) return;
  const client = clientById(Number(panelElement.dataset.clientId));
  const oldPhone = panelElement.querySelector<HTMLInputElement>('[data-whatsapp-phone]');
  const oldMessage = panelElement.querySelector<HTMLTextAreaElement>('[data-whatsapp-message]');
  if (!client || !oldPhone || !oldMessage) return;

  const message = oldMessage.value;
  const phone = oldPhone.value;
  const normalized = normalizeWhatsAppPhone(phone);
  const blocked = panelElement.dataset.contactBlocked === 'true';
  const { contextNote, identityForm } = safetyMarkup(panelElement, blocked);
  const invalidPhone = !normalized.valid;
  const disabled = blocked || invalidPhone || !message.trim();

  enterModalMode();
  panelElement.dataset.zeroTrainingView = 'preparation';
  panelElement.innerHTML = `<header class="whatsapp-contact-heading whatsapp-zero-heading">
      <div><h2 id="whatsapp-contact-title">Mensaje para ${escapeHtml(client.name)}</h2></div>
      <button type="button" class="quiet-button" data-whatsapp-close aria-label="Cerrar">×</button>
    </header>
    ${contextNote}
    <section class="whatsapp-zero-message-card">
      <strong>${escapeHtml(client.name)}</strong>
      <p class="whatsapp-zero-message-preview" data-whatsapp-message-preview>${escapeHtml(message)}</p>
      <label class="whatsapp-contact-field whatsapp-zero-message-editor" data-whatsapp-message-editor hidden>Mensaje
        <textarea data-whatsapp-message rows="6"${blocked ? ' disabled' : ''}>${escapeHtml(message)}</textarea>
        <small data-whatsapp-message-status hidden></small>
      </label>
      <button type="button" class="secondary whatsapp-zero-edit-message" data-whatsapp-edit-message${blocked ? ' disabled' : ''}>Editar mensaje</button>
    </section>
    ${identityForm}
    ${invalidPhone ? `<label class="whatsapp-contact-field whatsapp-zero-phone-required">Número de WhatsApp
      <input data-whatsapp-phone value="${escapeHtml(phone)}" inputmode="tel" autocomplete="tel"${blocked ? ' disabled' : ''}>
      <small data-whatsapp-phone-preview><span class="whatsapp-phone-error">${escapeHtml(normalized.reason)}</span></small>
    </label>` : `<details class="whatsapp-zero-more-options"><summary>Más opciones</summary>
      <div class="whatsapp-zero-more-body">
        <label class="whatsapp-contact-field">Número de WhatsApp
          <input data-whatsapp-phone value="${escapeHtml(phone)}" inputmode="tel" autocomplete="tel"${blocked ? ' disabled' : ''}>
          <small data-whatsapp-phone-preview><span class="whatsapp-phone-valid">Se usará ${escapeHtml(normalized.display)}</span></small>
        </label>
        <label class="whatsapp-contact-update-phone" hidden><input type="checkbox" data-whatsapp-save-phone> Actualizar el teléfono del lead</label>
        <div class="whatsapp-contact-copy-row"><button type="button" class="secondary" data-whatsapp-copy${blocked ? ' disabled' : ''}>Copiar mensaje</button><span data-whatsapp-copy-status aria-live="polite"></span></div>
      </div>
    </details>`}
    ${invalidPhone ? '<label class="whatsapp-contact-update-phone" hidden><input type="checkbox" data-whatsapp-save-phone> Actualizar el teléfono del lead</label>' : ''}
    <footer class="whatsapp-contact-actions whatsapp-zero-single-action">
      <button type="button" data-whatsapp-open${disabled ? ' disabled' : ''}>Abrir WhatsApp</button>
    </footer>`;
}

function compactReturnMarkup(client: Client): string {
  return `<header class="whatsapp-contact-heading whatsapp-zero-return-heading">
      <div><h2 id="whatsapp-contact-title">¿Enviaste el mensaje a ${escapeHtml(client.name)}?</h2></div>
      <button type="button" class="quiet-button" data-whatsapp-not-yet aria-label="Cerrar">×</button>
    </header>
    <footer class="whatsapp-contact-actions whatsapp-zero-return-actions">
      <button type="button" class="secondary" data-whatsapp-not-yet>Todavía no</button>
      <button type="button" data-whatsapp-confirm-sent>Sí</button>
    </footer>`;
}

function showCompactReturn(attempt: PendingWhatsAppAttempt): void {
  const panelElement = panel();
  const root = overlay();
  const client = clientById(attempt.clientId);
  if (!panelElement || !root || !client || !attempt.openedAt) return;
  enterModalMode();
  root.hidden = false;
  panelElement.dataset.clientId = String(client.id);
  panelElement.dataset.contactBlocked = 'false';
  panelElement.dataset.identityFingerprint = attempt.identity.fingerprint;
  panelElement.dataset.zeroTrainingView = 'return';
  panelElement.innerHTML = compactReturnMarkup(client);
}

function patchReturn(panelElement: HTMLElement): void {
  if (!panelElement.querySelector('[data-whatsapp-confirm-sent]') || panelElement.querySelector('.whatsapp-zero-return-actions')) return;
  const client = clientById(Number(panelElement.dataset.clientId));
  if (!client) return;
  enterModalMode();
  panelElement.dataset.zeroTrainingView = 'return';
  panelElement.innerHTML = compactReturnMarkup(client);
}

function scheduleCompactReturnPrompt(): void {
  queueMicrotask(() => {
    const loaded = loadPendingWhatsAppAttemptResult();
    const attempt = loaded.attempt;
    if (!attempt?.openedAt) return;
    clearReturnPromptTimer();
    const expectedAttemptId = attempt.id;
    returnPromptTimer = window.setTimeout(() => {
      returnPromptTimer = null;
      const latest = loadPendingWhatsAppAttemptResult();
      if (!latest.attempt?.openedAt || latest.attempt.id !== expectedAttemptId) return;
      const view = panel()?.dataset.zeroTrainingView || '';
      if (view === 'done' || view === 'change') return;
      showCompactReturn(latest.attempt);
    }, RETURN_PROMPT_DELAY_MS);
  });
}

function dismissCompactReturn(): void {
  clearReturnPromptTimer();
  const loaded = loadPendingWhatsAppAttemptResult();
  if (loaded.attempt) dismissPendingWhatsAppAttempt(loaded.attempt);
  const root = overlay();
  if (root) root.hidden = true;
  document.body.classList.remove('whatsapp-contact-open');
}

function patchWhatsAppPanel(): void {
  const panelElement = panel();
  if (!panelElement || overlay()?.hidden) return;
  if (panelElement.querySelector('[data-whatsapp-confirm-sent]')) {
    patchReturn(panelElement);
    return;
  }
  if (panelElement.querySelector('[data-whatsapp-open]')) patchPreparation(panelElement);
}

function compactFollowUpLabel(days: number | null, date: string): string {
  if (days === 1) return 'Mañana';
  if (days && [3, 7, 14, 30].includes(days)) return `En ${days} días`;
  return localDateLabel(date);
}

function showContactResult(context: ConfirmedContact, date = context.recommendedDate, days = context.recommendedDays): void {
  const panelElement = panel();
  const client = clientById(context.clientId);
  if (!panelElement || !client) return;
  clearReturnPromptTimer();
  enterDoneMode();
  panelElement.dataset.zeroTrainingView = 'done';
  panelElement.dataset.clientId = String(client.id);
  panelElement.innerHTML = `<header class="whatsapp-contact-heading whatsapp-zero-done-heading">
      <div><h2 id="whatsapp-contact-title">${date ? `Listo. Próximo contacto: ${escapeHtml(compactFollowUpLabel(days, date))}` : 'Contacto registrado'}</h2></div>
      <button type="button" class="quiet-button" data-whatsapp-close aria-label="Cerrar">×</button>
    </header>
    <div class="whatsapp-zero-done-actions">
      <button type="button" class="secondary" ${date ? 'data-whatsapp-change-followup' : 'data-whatsapp-choose-followup'}>${date ? 'Cambiar' : 'Elegir próximo contacto'}</button>
    </div>`;
}

function emitError(message: string): void {
  document.dispatchEvent(new CustomEvent('propcontrol-cloud-status', { detail: { message, kind: 'error' } }));
}

function confirmWhatsAppSent(): void {
  clearReturnPromptTimer();
  const loaded = loadPendingWhatsAppAttemptResult();
  const attempt = loaded.attempt;
  if (!attempt?.openedAt) {
    emitError(loaded.reason || 'No hay un intento de WhatsApp válido para confirmar.');
    return;
  }
  const result = registerWhatsAppContact(attempt);
  if (!result) {
    emitError('No se pudo registrar el contacto porque el permiso, usuario o identidad ya no son válidos.');
    return;
  }

  const conversationOpen = state.crm.conversations.some((conversation) => conversation.clientId === result.client.id && conversation.mode !== 'Pausada');
  const suggestion = suggestedFollowUp(result.client, conversationOpen);
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(suggestion.date) ? suggestion.date : '';
  const context: ConfirmedContact = {
    clientId: result.client.id,
    attempt,
    activityId: result.activity.id,
    recommendedDate: validDate,
    recommendedDays: suggestion.days,
  };
  confirmedContact = context;

  if (validDate && !scheduleWhatsAppFollowUp(result.client.id, attempt, result.activity.id, validDate)) {
    context.recommendedDate = '';
    context.recommendedDays = null;
    emitError('El contacto quedó registrado, pero no se pudo programar el próximo contacto.');
  }

  document.dispatchEvent(new CustomEvent('trv-render'));
  queueMicrotask(() => showContactResult(context));
}

function followUpOptions(selectedDays: number | null): string {
  return ([[1, 'Mañana'], [3, 'En 3 días'], [7, 'En 7 días'], [14, 'En 14 días'], [30, 'En 30 días']] as const)
    .map(([days, label]) => `<label><input type="radio" name="follow-up-choice" value="${days}"${selectedDays === days ? ' checked' : ''}> <span>${label}</span></label>`)
    .join('');
}

function showFollowUpSelector(): void {
  const context = confirmedContact;
  const panelElement = panel();
  const client = context ? clientById(context.clientId) : null;
  if (!context || !panelElement || !client) return;
  enterModalMode();
  const selectedDays = context.recommendedDays && [1, 3, 7, 14, 30].includes(context.recommendedDays) ? context.recommendedDays : null;
  const selectedDate = context.recommendedDate || addLocalDaysIso(1);
  panelElement.dataset.zeroTrainingView = 'change';
  panelElement.innerHTML = `<header class="whatsapp-contact-heading">
      <div><h2 id="whatsapp-contact-title">Cambiar próximo contacto</h2><p>${escapeHtml(client.name)}</p></div>
      <button type="button" class="quiet-button" data-whatsapp-close aria-label="Cerrar">×</button>
    </header>
    <form class="whatsapp-followup-form" data-zero-followup-form>
      <div class="whatsapp-followup-options">${followUpOptions(selectedDays)}
        <label><input type="radio" name="follow-up-choice" value="custom"${selectedDays === null ? ' checked' : ''}> <span>Elegir fecha</span></label>
      </div>
      <label class="whatsapp-custom-date"${selectedDays === null ? '' : ' hidden'}>Fecha personalizada<input type="date" name="custom-date" value="${escapeHtml(selectedDate)}" min="${addLocalDaysIso(0)}"></label>
      <input type="hidden" name="selected-date" value="${escapeHtml(selectedDate)}">
      <p class="whatsapp-followup-preview" data-zero-followup-preview aria-live="polite">${escapeHtml(followUpPreview(selectedDate))}</p>
      <footer class="whatsapp-contact-actions"><button type="button" class="secondary" data-whatsapp-cancel-change>Cancelar</button><button type="submit">Guardar</button></footer>
    </form>`;
}

function synchronizeChangeSelection(form: HTMLFormElement, now = new Date()): void {
  const choice = form.querySelector<HTMLInputElement>('input[name="follow-up-choice"]:checked')?.value || '';
  const customInput = form.querySelector<HTMLInputElement>('input[name="custom-date"]');
  const date = followUpDateForChoice(choice, customInput?.value || '', now);
  const selected = form.querySelector<HTMLInputElement>('input[name="selected-date"]');
  if (selected) selected.value = date;
  const custom = form.querySelector<HTMLElement>('.whatsapp-custom-date');
  if (custom) custom.hidden = choice !== 'custom';
  const preview = form.querySelector<HTMLElement>('[data-zero-followup-preview]');
  if (preview) preview.textContent = followUpPreview(date);
}

function saveChangedFollowUp(form: HTMLFormElement): void {
  const context = confirmedContact;
  if (!context) return;
  const client = clientById(context.clientId);
  const selectedDate = form.querySelector<HTMLInputElement>('input[name="selected-date"]')?.value || '';
  const choice = form.querySelector<HTMLInputElement>('input[name="follow-up-choice"]:checked')?.value || '';
  if (!client || !/^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) {
    emitError('Elegí una fecha válida para el próximo contacto.');
    return;
  }
  if (!scheduleWhatsAppFollowUp(client.id, context.attempt, context.activityId, selectedDate)) {
    emitError('No se pudo cambiar el próximo contacto porque el permiso, usuario o identidad cambió.');
    return;
  }
  context.recommendedDate = selectedDate;
  context.recommendedDays = /^\d+$/.test(choice) ? Number(choice) : null;
  document.dispatchEvent(new CustomEvent('trv-render'));
  queueMicrotask(() => showContactResult(context, selectedDate, context.recommendedDays));
}

function openLeadDetails(button: HTMLElement): void {
  const card = button.closest<HTMLElement>('.mvp-lead-card');
  const sheet = card?.querySelector<HTMLDetailsElement>('[data-lead-full-sheet]');
  if (!sheet) return;
  sheet.open = true;
  button.closest<HTMLDetailsElement>('.mvp-lead-actions-menu')?.removeAttribute('open');
  sheet.querySelector<HTMLElement>('.mvp-lead-full-content')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function patchCloudNotice(event: Event): void {
  const detail = (event as CustomEvent<{ message?: string; kind?: string }>).detail;
  const notice = document.querySelector<HTMLElement>('#notice');
  if (!detail?.message || !notice) return;
  if (detail.kind === 'working') {
    notice.hidden = true;
    return;
  }
  if (detail.kind !== 'error' && detail.message === 'Guardado seguro en la nube.') {
    notice.textContent = '✓ Guardado';
    notice.classList.add('mvp-zero-save-notice');
    notice.hidden = false;
  } else if (detail.kind === 'error') {
    notice.classList.remove('mvp-zero-save-notice');
  }
}

function patchAll(): void {
  patchQueued = false;
  document.querySelectorAll<HTMLElement>('.mvp-lead-card[data-client-id]').forEach(patchLeadCard);
  patchWhatsAppPanel();
}

function queuePatch(): void {
  if (patchQueued) return;
  patchQueued = true;
  queueMicrotask(patchAll);
}

function observeWhatsAppPanel(): void {
  if (typeof MutationObserver === 'undefined') return;
  const panelElement = panel();
  if (!panelElement || observedWhatsAppPanel === panelElement) return;
  whatsappPanelObserver?.disconnect();
  observedWhatsAppPanel = panelElement;
  whatsappPanelObserver = new MutationObserver(() => queuePatch());
  whatsappPanelObserver.observe(panelElement, { childList: true });
  whatsappRootObserver?.disconnect();
  whatsappRootObserver = null;
  queuePatch();
}

function installWhatsAppPanelObserver(): void {
  if (typeof MutationObserver === 'undefined') return;
  observeWhatsAppPanel();
  if (observedWhatsAppPanel) return;
  whatsappRootObserver = new MutationObserver(() => observeWhatsAppPanel());
  whatsappRootObserver.observe(document.body, { childList: true });
}

function closeDonePanelForNavigation(target: HTMLElement): void {
  const panelElement = panel();
  if (panelElement?.dataset.zeroTrainingView !== 'done' || overlay()?.hidden || !target.closest('[data-module]')) return;
  panelElement.querySelector<HTMLButtonElement>('[data-whatsapp-close]')?.click();
}

function install(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;

  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;

    closeDonePanelForNavigation(target);

    const confirm = target.closest<HTMLElement>('[data-whatsapp-confirm-sent]');
    if (confirm) {
      event.preventDefault();
      event.stopImmediatePropagation();
      confirmWhatsAppSent();
      return;
    }

    const notYet = target.closest<HTMLElement>('[data-whatsapp-not-yet]');
    if (notYet) {
      event.preventDefault();
      event.stopImmediatePropagation();
      dismissCompactReturn();
      return;
    }

    if (target.closest('[data-contact-whatsapp], .mvp-contact-btn.wa')) {
      queueMicrotask(patchWhatsAppPanel);
    }

    if (target.closest('[data-whatsapp-open]')) {
      scheduleCompactReturnPrompt();
    }

    const editMessage = target.closest<HTMLElement>('[data-whatsapp-edit-message]');
    if (editMessage) {
      event.preventDefault();
      const editor = panel()?.querySelector<HTMLElement>('[data-whatsapp-message-editor]');
      const preview = panel()?.querySelector<HTMLElement>('[data-whatsapp-message-preview]');
      if (editor) editor.hidden = false;
      if (preview) preview.hidden = true;
      panel()?.querySelector<HTMLTextAreaElement>('[data-whatsapp-message]')?.focus({ preventScroll: true });
      return;
    }

    const details = target.closest<HTMLElement>('[data-open-lead-details]');
    if (details) {
      event.preventDefault();
      event.stopPropagation();
      openLeadDetails(details);
      return;
    }

    const qualify = target.closest<HTMLElement>('[data-zero-auto-qualify]');
    if (qualify) {
      event.preventDefault();
      event.stopPropagation();
      const clientId = Number(qualify.dataset.zeroAutoQualify);
      if (clientId) requestLeadQualification(clientId);
      return;
    }

    if (target.closest('[data-whatsapp-change-followup], [data-whatsapp-choose-followup]')) {
      event.preventDefault();
      showFollowUpSelector();
      return;
    }

    if (target.closest('[data-whatsapp-cancel-change]')) {
      event.preventDefault();
      if (confirmedContact) showContactResult(confirmedContact);
    }
  }, true);

  document.addEventListener('input', (event) => {
    const target = event.target as HTMLElement;
    if (target.matches('[data-whatsapp-message]')) {
      const preview = panel()?.querySelector<HTMLElement>('[data-whatsapp-message-preview]');
      const textarea = target as HTMLTextAreaElement;
      if (preview) preview.textContent = textarea.value;
    }
    const form = target.closest<HTMLFormElement>('[data-zero-followup-form]');
    if (form && target.matches('input[name="custom-date"]')) synchronizeChangeSelection(form);
  }, true);

  document.addEventListener('change', (event) => {
    const target = event.target as HTMLElement;
    const form = target.closest<HTMLFormElement>('[data-zero-followup-form]');
    if (form && target.matches('input[name="follow-up-choice"], input[name="custom-date"]')) synchronizeChangeSelection(form);
  }, true);

  document.addEventListener('submit', (event) => {
    const form = (event.target as HTMLElement).closest<HTMLFormElement>('[data-zero-followup-form]');
    if (!form) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    saveChangedFollowUp(form);
  }, true);

  document.addEventListener('propcontrol-cloud-status', (event) => {
    patchCloudNotice(event);
    queuePatch();
  });
  document.addEventListener('trv-render', queuePatch);
  document.addEventListener('propcontrol-leads-rendered', queuePatch);
  document.addEventListener('propcontrol-whatsapp-identity-changed', queuePatch);
  window.addEventListener('focus', queuePatch);
  window.addEventListener('pageshow', queuePatch);
  document.addEventListener('visibilitychange', queuePatch);
  installWhatsAppPanelObserver();
  queuePatch();
}

if (typeof document !== 'undefined') install();

export { compactFollowUpLabel, patchAll as applyZeroTrainingLeadUxForTests, synchronizeChangeSelection };