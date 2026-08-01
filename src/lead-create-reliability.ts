import { clientFromFormValues, upsertClient } from './client-editor.js';
import { resolveLeadSchedule } from './lead-create-schedule.js';
import { activitiesForClientSave, isTerminalClient, localIsoDate } from './lead-pipeline.js';
import { findDuplicateClient, isPlausiblePhone } from './phone-normalizer.js';
import { saveData, state } from './store.js';
import { activeMember, addActivity, canAccessModule, visibleClients } from './team-access.js';
import { formValues, nextId, setNotice } from './utils.js';

const submittingForms = new WeakSet<HTMLFormElement>();
const ENHANCED = 'b131Enhanced';
const ACTOR = 'b131Actor';
const EDITING = 'b131Editing';

function formError(form: HTMLFormElement): HTMLElement | null {
  return form.querySelector<HTMLElement>('[data-lead-error]');
}

function clearError(form: HTMLFormElement): void {
  const node = formError(form);
  if (node) {
    node.hidden = true;
    node.textContent = '';
  }
  form.querySelectorAll<HTMLElement>('[aria-invalid="true"]').forEach((field) => field.removeAttribute('aria-invalid'));
}

function showError(form: HTMLFormElement, message: string, field?: HTMLInputElement | HTMLSelectElement | null): void {
  const node = formError(form);
  if (node) {
    node.textContent = message;
    node.hidden = false;
  }
  if (field) {
    field.setAttribute('aria-invalid', 'true');
    field.focus({ preventScroll: true });
    field.scrollIntoView({ block: 'center', behavior: 'auto' });
  }
}

function currentEditingId(): number | null {
  return Number.isFinite(state.editingClientId) ? state.editingClientId : null;
}

function capturedEditingId(form: HTMLFormElement): number | null {
  const value = form.dataset[EDITING];
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formStillAuthorized(form: HTMLFormElement): boolean {
  const member = activeMember();
  const actorId = Number(form.dataset[ACTOR]);
  const editingId = capturedEditingId(form);
  if (!form.isConnected || !member || member.status !== 'Activo') return false;
  if (!canAccessModule('crm') || state.activeModule !== 'crm' || !state.openForms.client) return false;
  if (member.id !== actorId || currentEditingId() !== editingId) return false;
  if (editingId !== null && !visibleClients().some((client) => client.id === editingId)) return false;
  return true;
}

function updateSuggestedSchedule(form: HTMLFormElement): void {
  if (capturedEditingId(form) !== null) return;
  const phone = form.elements.namedItem('phone');
  const action = form.elements.namedItem('nextAction');
  const date = form.elements.namedItem('nextFollowUp');
  if (!(phone instanceof HTMLInputElement)
    || !(action instanceof HTMLInputElement)
    || !(date instanceof HTMLInputElement)) return;

  date.min = localIsoDate();
  if (date.dataset.b131Manual !== 'true' && (!date.value || date.dataset.b131Suggested === 'true')) {
    date.value = localIsoDate();
    date.dataset.b131Suggested = 'true';
  }
  if (action.dataset.b131Manual !== 'true' && (!action.value || action.dataset.b131Suggested === 'true')) {
    action.value = isPlausiblePhone(phone.value) ? 'Contactar por WhatsApp' : 'Contactar por primera vez';
    action.dataset.b131Suggested = 'true';
  }
}

function markManualInput(event: Event): void {
  const field = event.target;
  if (!(field instanceof HTMLInputElement)) return;
  if (field.name !== 'nextAction' && field.name !== 'nextFollowUp') return;
  field.dataset.b131Manual = 'true';
  delete field.dataset.b131Suggested;
}

function createFooter(form: HTMLFormElement, submit: HTMLButtonElement, error: HTMLElement | null): HTMLElement {
  const footer = document.createElement('footer');
  footer.className = 'b131-lead-form-footer';
  footer.setAttribute('aria-label', 'Acciones del formulario');

  if (error) footer.append(error);
  const actions = document.createElement('div');
  actions.className = 'b131-lead-form-actions';

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'secondary';
  cancel.dataset.cancelClientEdit = '';
  cancel.textContent = 'Cancelar';

  submit.classList.add('b131-save-lead');
  submit.dataset.saveLead = '';
  submit.textContent = currentEditingId() === null ? 'Guardar lead' : 'Guardar cambios';

  actions.append(cancel, submit);
  footer.append(actions);
  return footer;
}

function enhanceLeadForm(): void {
  const form = document.querySelector<HTMLFormElement>('#mvp-lead-form:not(.collapsed)');
  if (!form || form.dataset[ENHANCED] === 'true') return;
  const member = activeMember();
  const heading = form.querySelector<HTMLElement>('.mvp-form-heading');
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!member || !heading || !submit) return;

  form.dataset[ENHANCED] = 'true';
  form.dataset[ACTOR] = String(member.id);
  form.dataset[EDITING] = currentEditingId() === null ? '' : String(currentEditingId());
  form.classList.add('b131-lead-form');

  const error = formError(form);
  const fields = document.createElement('div');
  fields.className = 'b131-lead-form-fields';
  Array.from(form.children).forEach((child) => {
    if (child !== heading && child !== submit && child !== error) fields.append(child);
  });
  heading.after(fields);
  form.append(createFooter(form, submit, error));

  const backdrop = document.createElement('div');
  backdrop.className = 'b131-lead-form-backdrop';
  backdrop.setAttribute('aria-hidden', 'true');
  backdrop.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  form.before(backdrop);

  const phone = form.elements.namedItem('phone');
  if (phone instanceof HTMLInputElement) phone.addEventListener('input', () => updateSuggestedSchedule(form));
  form.addEventListener('input', markManualInput);
  updateSuggestedSchedule(form);

  requestAnimationFrame(() => {
    if (form.isConnected) form.scrollIntoView({ block: 'start', behavior: 'auto' });
  });
}

function scheduleEnhancement(): void {
  queueMicrotask(enhanceLeadForm);
}

function restoreSubmit(form: HTMLFormElement): void {
  submittingForms.delete(form);
  const submit = form.querySelector<HTMLButtonElement>('[data-save-lead]');
  if (submit) {
    submit.disabled = false;
    submit.removeAttribute('aria-busy');
  }
}

function submitLead(event: SubmitEvent): void {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || form.id !== 'mvp-lead-form') return;

  event.preventDefault();
  event.stopImmediatePropagation();
  if (submittingForms.has(form)) return;
  clearError(form);

  if (!formStillAuthorized(form)) {
    showError(form, 'Este formulario ya no tiene autorización. Volvé a abrir Nuevo lead.');
    return;
  }

  if (!form.reportValidity()) {
    showError(form, 'Revisá los campos obligatorios antes de guardar.');
    return;
  }

  const submit = form.querySelector<HTMLButtonElement>('[data-save-lead]');
  submittingForms.add(form);
  if (submit) {
    submit.disabled = true;
    submit.setAttribute('aria-busy', 'true');
  }

  try {
    const values = formValues(form);
    const editingId = capturedEditingId(form);
    const previous = editingId === null
      ? null
      : visibleClients().find((client) => client.id === editingId) ?? null;
    if (editingId !== null && !previous) {
      showError(form, 'El lead ya no está disponible para este usuario.');
      restoreSubmit(form);
      return;
    }

    const phoneField = form.elements.namedItem('phone');
    if (!isPlausiblePhone(values.phone || '')) {
      showError(form, 'Ingresá un WhatsApp válido con código de área.', phoneField instanceof HTMLInputElement ? phoneField : null);
      restoreSubmit(form);
      return;
    }

    const duplicate = findDuplicateClient(state.crm.clients, values.phone || '', editingId);
    if (duplicate) {
      showError(form, `Ya existe un lead con ese WhatsApp: ${duplicate.name}.`, phoneField instanceof HTMLInputElement ? phoneField : null);
      restoreSubmit(form);
      return;
    }

    const terminal = values.pipeline === 'Ganado' || values.pipeline === 'Perdido';
    if (!terminal) {
      const schedule = resolveLeadSchedule({
        nextAction: values.nextAction,
        nextFollowUp: values.nextFollowUp,
        phone: values.phone,
        today: localIsoDate(),
      });
      if (schedule.error) {
        const dateField = form.elements.namedItem('nextFollowUp');
        showError(form, schedule.error, dateField instanceof HTMLInputElement ? dateField : null);
        restoreSubmit(form);
        return;
      }
      values.nextAction = schedule.nextAction;
      values.nextFollowUp = schedule.nextFollowUp;
    }

    if (!formStillAuthorized(form)) {
      showError(form, 'El usuario activo cambió. Volvé a abrir el formulario antes de guardar.');
      restoreSubmit(form);
      return;
    }

    const member = activeMember();
    if (!member) {
      showError(form, 'No se pudo identificar al usuario activo.');
      restoreSubmit(form);
      return;
    }

    const id = editingId ?? nextId(state.crm.clients);
    const client = clientFromFormValues(id, values, previous);
    client.assignedToId = previous?.assignedToId ?? member.id;
    client.createdById = previous?.createdById ?? member.id;

    state.crm.clients = upsertClient(state.crm.clients, client);
    activitiesForClientSave(previous, client).forEach((activity) => addActivity(activity));
    state.editingClientId = null;
    state.openForms.client = false;
    saveData(previous ? 'Lead actualizado' : 'Lead creado');
    document.dispatchEvent(new CustomEvent('trv-render'));
    setNotice(previous
      ? 'Lead actualizado correctamente.'
      : `Lead creado. Próxima acción: ${client.nextAction ?? 'sin acción'}.`);
  } catch (error) {
    showError(form, error instanceof Error ? error.message : 'No se pudo guardar el lead.');
    restoreSubmit(form);
  }
}

document.addEventListener('submit', submitLead, true);
document.addEventListener('trv-render', scheduleEnhancement);
document.addEventListener('DOMContentLoaded', scheduleEnhancement, { once: true });
window.addEventListener('pageshow', scheduleEnhancement);
requestAnimationFrame(scheduleEnhancement);

export { enhanceLeadForm };
