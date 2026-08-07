import { persistFollowUpSelection } from './followup-persistence.js';
import {
  canonicalFollowUpPayload,
  followUpDateForChoice,
  followUpPreview,
  localDateLabel,
} from './followup-selection.js';

const INSTALL_FLAG = '__propControlFollowUpSaveInstalled';
const savingForms = new WeakSet<HTMLFormElement>();

interface FollowUpWindow extends Window {
  [INSTALL_FLAG]?: boolean;
}

interface CanonicalSelection {
  choice: string;
  date: string | null;
}

function selectedChoice(form: HTMLFormElement): string {
  return form.querySelector<HTMLInputElement>('input[name="follow-up-choice"]:checked')?.value || '';
}

function errorNode(form: HTMLFormElement): HTMLElement {
  let node = form.querySelector<HTMLElement>('[data-followup-save-error]');
  if (node) return node;
  node = document.createElement('p');
  node.dataset.followupSaveError = '';
  node.className = 'whatsapp-phone-error';
  node.setAttribute('role', 'alert');
  node.setAttribute('aria-live', 'assertive');
  node.hidden = true;
  form.querySelector('.whatsapp-contact-actions')?.before(node);
  return node;
}

function showError(form: HTMLFormElement, message: string): void {
  const node = errorNode(form);
  if (node.textContent !== message) node.textContent = message;
  node.hidden = false;
}

function clearError(form: HTMLFormElement): void {
  const node = form.querySelector<HTMLElement>('[data-followup-save-error]');
  if (!node) return;
  if (node.textContent) node.textContent = '';
  node.hidden = true;
}

function synchronizeSelection(form: HTMLFormElement, now = new Date()): string {
  const choice = selectedChoice(form);
  const customInput = form.querySelector<HTMLInputElement>('input[name="custom-date"]');
  const date = followUpDateForChoice(choice, customInput?.value || '', now);
  const selected = form.querySelector<HTMLInputElement>('input[name="selected-date"]');
  if (selected && selected.value !== date) selected.value = date;
  form.dataset.followupSelectedDate = date;
  form.dataset.followupSelectedChoice = choice;
  form.dataset.followupCanonicalInitialized = 'true';

  const custom = form.querySelector<HTMLElement>('.whatsapp-custom-date');
  if (custom) custom.hidden = choice !== 'custom';
  const preview = form.querySelector<HTMLElement>('[data-whatsapp-followup-preview]');
  if (preview) {
    const message = followUpPreview(date);
    if (preview.textContent !== message) preview.textContent = message;
    preview.dataset.followupPreviewDate = date;
  }
  return date;
}

function initializeForm(form: HTMLFormElement, force = false): void {
  if (!force && form.dataset.followupCanonicalInitialized === 'true') return;
  synchronizeSelection(form);
}

function initializeVisibleForms(force = false): void {
  document.querySelectorAll<HTMLFormElement>('[data-whatsapp-followup-form]')
    .forEach((form) => initializeForm(form, force));
}

function synchronizeAfterCurrentEvent(form: HTMLFormElement | null): void {
  if (!form) return;
  queueMicrotask(() => {
    if (form.isConnected) synchronizeSelection(form);
  });
}

function readCanonicalSelection(form: HTMLFormElement): CanonicalSelection {
  const choice = selectedChoice(form);
  const selected = form.querySelector<HTMLInputElement>('input[name="selected-date"]');
  const custom = form.querySelector<HTMLInputElement>('input[name="custom-date"]');
  const preview = form.querySelector<HTMLElement>('[data-whatsapp-followup-preview]');
  const date = canonicalFollowUpPayload({
    checkedChoice: choice,
    selectedChoice: form.dataset.followupSelectedChoice || '',
    selectedDate: form.dataset.followupSelectedDate || '',
    hiddenDate: selected?.value || '',
    previewDate: preview?.dataset.followupPreviewDate || '',
    previewText: preview?.textContent || '',
    customDate: custom?.value || '',
  });
  return { choice, date };
}

function setSaving(form: HTMLFormElement, saving: boolean): void {
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!submit) return;
  submit.disabled = saving;
  submit.setAttribute('aria-busy', String(saving));
  const label = saving ? 'Guardando…' : 'Guardar seguimiento';
  if (submit.textContent !== label) submit.textContent = label;
}

function notify(message: string): void {
  document.dispatchEvent(new CustomEvent('propcontrol-cloud-status', {
    detail: { message, kind: 'success' },
  }));
}

function closeAfterSuccess(form: HTMLFormElement): void {
  form.querySelector<HTMLButtonElement>('[data-whatsapp-close]')?.click();
}

function saveFollowUp(event: SubmitEvent, form: HTMLFormElement): void {
  event.preventDefault();
  event.stopImmediatePropagation();
  if (savingForms.has(form)) return;

  clearError(form);
  let selection: CanonicalSelection;
  try {
    selection = readCanonicalSelection(form);
  } catch (error) {
    showError(
      form,
      error instanceof Error
        ? error.message
        : 'La fecha visible no pudo validarse. Volvé a elegir el seguimiento.',
    );
    return;
  }

  const overlay = form.closest<HTMLElement>('#propcontrol-whatsapp-contact');
  const contactPanel = overlay?.querySelector<HTMLElement>('.whatsapp-contact-panel');
  const clientId = Number(contactPanel?.dataset.clientId);
  const attemptId = contactPanel?.dataset.attemptId || '';
  const activityId = Number(contactPanel?.dataset.activityId);
  savingForms.add(form);
  setSaving(form, true);

  try {
    const result = persistFollowUpSelection({
      clientId,
      attemptId,
      activityId,
      date: selection.date,
    });
    closeAfterSuccess(form);
    document.dispatchEvent(new CustomEvent('trv-render'));
    notify(result.date
      ? `Seguimiento de ${result.client.name} programado para ${localDateLabel(result.date)} (${result.date}).`
      : `Contacto con ${result.client.name} registrado sin próximo seguimiento.`);
  } catch (error) {
    savingForms.delete(form);
    setSaving(form, false);
    showError(
      form,
      error instanceof Error
        ? error.message
        : 'No se pudo guardar. Revisá la conexión y volvé a intentarlo.',
    );
  }
}

function install(): void {
  if (typeof document === 'undefined') return;
  const globalWindow = window as FollowUpWindow;
  if (globalWindow[INSTALL_FLAG]) return;
  globalWindow[INSTALL_FLAG] = true;

  document.addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement;
    if (input.name !== 'follow-up-choice' && input.name !== 'custom-date') return;
    synchronizeAfterCurrentEvent(input.closest<HTMLFormElement>('[data-whatsapp-followup-form]'));
  });
  document.addEventListener('input', (event) => {
    const input = event.target as HTMLInputElement;
    if (input.name !== 'custom-date') return;
    synchronizeAfterCurrentEvent(input.closest<HTMLFormElement>('[data-whatsapp-followup-form]'));
  });
  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (!target.closest('[data-whatsapp-confirm-sent], [data-whatsapp-manual-register]')) return;
    queueMicrotask(() => initializeVisibleForms(true));
  });
  document.addEventListener('submit', (event) => {
    const form = (event.target as HTMLElement).closest<HTMLFormElement>('[data-whatsapp-followup-form]');
    if (form) saveFollowUp(event, form);
  }, true);
  document.addEventListener('trv-render', () => queueMicrotask(() => initializeVisibleForms()));
  window.addEventListener('pageshow', () => queueMicrotask(() => initializeVisibleForms()));
  queueMicrotask(() => initializeVisibleForms());
}

install();
