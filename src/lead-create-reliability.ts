import type { TenantScope } from './active-organization.js';
import { queueCloudSave } from './cloud-api-compatible.js';
import { clientFromFormValues, upsertClient } from './client-editor.js';
import { resolveLeadSchedule } from './lead-create-schedule.js';
import { activitiesForClientSave, localIsoDate } from './lead-pipeline.js';
import type { Client, TeamMember } from './models.js';
import { findDuplicateClient, isPlausiblePhone } from './phone-normalizer.js';
import { authenticatedTenantMember, state } from './store.js';
import {
  assertTenantCrmScope,
  readTenantSnapshot,
  writeTenantSnapshot,
} from './tenant-storage.js';
import {
  assertTenantRuntimeLeaseCurrent,
  captureTenantRuntimeLease,
  requireCurrentTenantScope,
  tenantRuntimeLeaseIsCurrent,
  type TenantRuntimeLease,
} from './tenant-runtime.js';
import {
  addActivityForAuthenticatedTenant,
  canAccessModule,
  visibleClients,
} from './team-access.js';
import { formValues, nextId, setNotice } from './utils.js';

const submittingForms = new WeakSet<HTMLFormElement>();
const formTenantContexts = new WeakMap<HTMLFormElement, LeadFormTenantContext>();
const ENHANCED = 'b131Enhanced';
const EDITING = 'b131Editing';
const DUPLICATE = 'b132DuplicateClientId';
const SAVE_DELAY_MS = 120;

type FeedbackKind = 'idle' | 'working' | 'success' | 'error' | 'duplicate';

interface LeadFormTenantContext {
  scope: TenantScope;
  runtimeLease: TenantRuntimeLease;
  viewMemberId: number;
}

function formError(form: HTMLFormElement): HTMLElement | null {
  return form.querySelector<HTMLElement>('[data-lead-error]');
}

function formStatus(form: HTMLFormElement): HTMLElement | null {
  return form.querySelector<HTMLElement>('[data-lead-status]');
}

function clearDuplicateActions(form: HTMLFormElement): void {
  delete form.dataset[DUPLICATE];
  form.querySelector<HTMLElement>('[data-lead-duplicate-actions]')?.remove();
}

function setStatus(form: HTMLFormElement, message: string, kind: FeedbackKind): void {
  const node = formStatus(form);
  if (!node) return;
  node.textContent = message;
  node.dataset.kind = kind;
  node.hidden = !message;
}

function clearFeedback(form: HTMLFormElement): void {
  const node = formError(form);
  if (node) {
    node.hidden = true;
    node.textContent = '';
  }
  setStatus(form, '', 'idle');
  clearDuplicateActions(form);
  form.querySelectorAll<HTMLElement>('[aria-invalid="true"]').forEach((field) => field.removeAttribute('aria-invalid'));
}

function focusField(field: HTMLInputElement | HTMLSelectElement | null | undefined): void {
  if (!field) return;
  field.setAttribute('aria-invalid', 'true');
  field.focus({ preventScroll: true });
  field.scrollIntoView({ block: 'center', behavior: 'auto' });
}

function showError(
  form: HTMLFormElement,
  message: string,
  field?: HTMLInputElement | HTMLSelectElement | null,
): void {
  const node = formError(form);
  if (node) {
    node.textContent = message;
    node.hidden = false;
  }
  setStatus(form, message, 'error');
  focusField(field);
}

function showDuplicate(form: HTMLFormElement, duplicate: Client, phoneField: HTMLInputElement | null): void {
  clearDuplicateActions(form);
  form.dataset[DUPLICATE] = String(duplicate.id);
  const message = `Este WhatsApp ya pertenece al lead ${duplicate.name}.`;
  const error = formError(form);
  if (error) {
    error.textContent = message;
    error.hidden = false;
  }
  setStatus(form, message, 'duplicate');
  focusField(phoneField);

  const actions = document.createElement('div');
  actions.dataset.leadDuplicateActions = '';
  actions.className = 'b132-duplicate-actions';

  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'secondary';
  open.dataset.openExistingLead = String(duplicate.id);
  open.textContent = 'Abrir lead existente';

  const correct = document.createElement('button');
  correct.type = 'button';
  correct.className = 'secondary';
  correct.dataset.correctDuplicatePhone = '';
  correct.textContent = 'Corregir número';

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'quiet-button';
  cancel.dataset.cancelDuplicateLead = '';
  cancel.textContent = 'Cancelar';

  actions.append(open, correct, cancel);
  formStatus(form)?.after(actions);
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

function leadFormTenantContext(form: HTMLFormElement): LeadFormTenantContext | null {
  return formTenantContexts.get(form) ?? null;
}

function captureLeadFormTenantContext(form: HTMLFormElement): LeadFormTenantContext {
  const existing = leadFormTenantContext(form);
  if (existing) return existing;
  const scope = requireCurrentTenantScope();
  assertTenantCrmScope(scope, state.crm);
  const context = Object.freeze({
    scope: Object.freeze({ ...scope }),
    runtimeLease: captureTenantRuntimeLease(scope),
    viewMemberId: state.activeMemberId,
  });
  formTenantContexts.set(form, context);
  return context;
}

function assertLeadFormTenantCurrent(context: LeadFormTenantContext): void {
  assertTenantRuntimeLeaseCurrent(context.runtimeLease);
  assertTenantCrmScope(context.scope, state.crm);
}

function authenticatedWriteMember(scope: TenantScope): TeamMember {
  const member = authenticatedTenantMember(scope);
  const matches = state.crm.teamMembers.filter((candidate) => (
    candidate.userId === scope.userId && candidate.status === 'Activo'
  ));
  if (!member || matches.length !== 1 || matches[0]?.id !== member.id) {
    throw new Error('AUTHENTICATED_TENANT_MEMBER_REQUIRED');
  }
  return member;
}

function formStillAuthorized(form: HTMLFormElement): boolean {
  const context = leadFormTenantContext(form);
  const editingId = capturedEditingId(form);
  if (!context || !form.isConnected || !tenantRuntimeLeaseIsCurrent(context.runtimeLease)) return false;
  // activeMemberId remains a view preference only. A change invalidates the old visual form,
  // but this value is never used as tenant authority, creator, assignee or activity actor.
  if (state.activeMemberId !== context.viewMemberId) return false;
  if (!canAccessModule('crm') || state.activeModule !== 'crm' || !state.openForms.client) return false;
  if (currentEditingId() !== editingId) return false;
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

function createStatus(): HTMLElement {
  const status = document.createElement('div');
  status.dataset.leadStatus = '';
  status.className = 'b132-lead-save-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-atomic', 'true');
  status.hidden = true;
  return status;
}

function createFooter(form: HTMLFormElement, submit: HTMLButtonElement, error: HTMLElement | null): HTMLElement {
  const footer = document.createElement('footer');
  footer.className = 'b131-lead-form-footer';
  footer.setAttribute('aria-label', 'Acciones del formulario');

  footer.append(createStatus());
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

function openExistingLead(form: HTMLFormElement, clientId: number): void {
  const duplicate = visibleClients().find((client) => client.id === clientId);
  if (!duplicate || !formStillAuthorized(form)) {
    showError(form, 'El lead existente ya no está disponible para este usuario.');
    return;
  }
  state.editingClientId = null;
  state.openForms.client = false;
  document.dispatchEvent(new CustomEvent('trv-render'));
  window.requestAnimationFrame(() => {
    const details = document.querySelector<HTMLDetailsElement>(`[data-lead-full-sheet="${clientId}"]`);
    if (!details) return;
    details.open = true;
    details.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
}

function bindDuplicateActions(form: HTMLFormElement): void {
  form.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const open = target.closest<HTMLButtonElement>('[data-open-existing-lead]');
    if (open && form.contains(open)) {
      event.preventDefault();
      openExistingLead(form, Number(open.dataset.openExistingLead));
      return;
    }
    if (target.closest('[data-correct-duplicate-phone]')) {
      event.preventDefault();
      clearDuplicateActions(form);
      const error = formError(form);
      if (error) { error.hidden = true; error.textContent = ''; }
      setStatus(form, 'Corregí el número y volvé a guardar.', 'idle');
      const phone = form.elements.namedItem('phone');
      if (phone instanceof HTMLInputElement) {
        phone.removeAttribute('aria-invalid');
        phone.focus({ preventScroll: false });
        phone.select();
      }
      return;
    }
    if (target.closest('[data-cancel-duplicate-lead]')) {
      event.preventDefault();
      form.querySelector<HTMLButtonElement>('[data-cancel-client-edit]')?.click();
    }
  });
}

export function enhanceLeadForm(): void {
  const form = document.querySelector<HTMLFormElement>('#mvp-lead-form:not(.collapsed)');
  if (!form || form.dataset[ENHANCED] === 'true') return;
  const heading = form.querySelector<HTMLElement>('.mvp-form-heading');
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!heading || !submit) return;

  try {
    captureLeadFormTenantContext(form);
  } catch {
    showError(form, 'No se pudo fijar el tenant de este formulario. Volvé a abrir Nuevo lead.');
    submit.disabled = true;
    return;
  }

  form.dataset[ENHANCED] = 'true';
  form.dataset[EDITING] = currentEditingId() === null ? '' : String(currentEditingId());
  form.classList.add('b131-lead-form');
  form.noValidate = true;

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
  bindDuplicateActions(form);
  updateSuggestedSchedule(form);

  requestAnimationFrame(() => {
    if (form.isConnected) form.scrollIntoView({ block: 'start', behavior: 'auto' });
  });
}

function restoreSubmit(form: HTMLFormElement): void {
  submittingForms.delete(form);
  const submit = form.querySelector<HTMLButtonElement>('[data-save-lead]');
  if (submit) {
    submit.disabled = false;
    submit.removeAttribute('aria-busy');
    submit.textContent = capturedEditingId(form) === null ? 'Guardar lead' : 'Guardar cambios';
  }
}

function invalidControl(form: HTMLFormElement): HTMLInputElement | HTMLSelectElement | null {
  return Array.from(form.elements).find((field): field is HTMLInputElement | HTMLSelectElement => (
    (field instanceof HTMLInputElement || field instanceof HTMLSelectElement)
    && !field.disabled
    && !field.checkValidity()
  )) ?? null;
}

function validationMessage(field: HTMLInputElement | HTMLSelectElement): string {
  if (field.validity.valueMissing) return 'Completá este campo obligatorio.';
  if (field instanceof HTMLInputElement && field.name === 'nextFollowUp' && field.validity.rangeUnderflow) {
    return 'La fecha de seguimiento no puede estar en el pasado.';
  }
  if (field instanceof HTMLInputElement && field.type === 'email' && field.validity.typeMismatch) {
    return 'Ingresá un email válido o dejá el campo vacío.';
  }
  return field.validationMessage || 'Revisá este campo antes de guardar.';
}

function validateAndResolveSchedule(
  form: HTMLFormElement,
  values: Record<string, string>,
  editingId: number | null,
): boolean {
  const terminal = values.pipeline === 'Ganado' || values.pipeline === 'Perdido';
  if (terminal) return true;

  const action = values.nextAction?.trim() || '';
  const date = values.nextFollowUp?.trim() || '';
  if (editingId !== null && !action && !date) return true;
  if (editingId !== null && Boolean(action) !== Boolean(date)) {
    const target = action ? form.elements.namedItem('nextFollowUp') : form.elements.namedItem('nextAction');
    showError(
      form,
      'Completá la próxima acción y su fecha, o dejá ambos campos vacíos.',
      target instanceof HTMLInputElement ? target : null,
    );
    return false;
  }

  const schedule = resolveLeadSchedule({
    nextAction: values.nextAction,
    nextFollowUp: values.nextFollowUp,
    phone: values.phone,
    today: localIsoDate(),
  });
  if (schedule.error) {
    const dateField = form.elements.namedItem('nextFollowUp');
    showError(form, schedule.error, dateField instanceof HTMLInputElement ? dateField : null);
    return false;
  }
  values.nextAction = schedule.nextAction;
  values.nextFollowUp = schedule.nextFollowUp;
  return true;
}

function tenantSnapshotContainsClient(
  context: LeadFormTenantContext,
  client: Client,
): boolean {
  assertLeadFormTenantCurrent(context);
  const snapshot = readTenantSnapshot(context.scope);
  return Boolean(snapshot?.clients.some((item) => item.id === client.id && item.phone === client.phone));
}

function rollbackTenantState(
  context: LeadFormTenantContext,
  previousCrm: typeof state.crm,
): void {
  if (!tenantRuntimeLeaseIsCurrent(context.runtimeLease)) return;
  try {
    assertTenantRuntimeLeaseCurrent(context.runtimeLease);
    assertTenantCrmScope(context.scope, previousCrm);
    state.crm = previousCrm;
    assertTenantCrmScope(context.scope, state.crm);
    assertTenantRuntimeLeaseCurrent(context.runtimeLease);
    writeTenantSnapshot(context.scope, previousCrm, {
      markDirty: true,
      reason: 'Reversión de guardado incompleto',
      backup: false,
    });
  } catch {
    // Nunca se cruza a otro tenant para intentar completar un rollback fallido.
  }
}

function persistLead(
  form: HTMLFormElement,
  values: Record<string, string>,
  editingId: number | null,
  previous: Client | null,
): void {
  const context = leadFormTenantContext(form);
  if (!context || !formStillAuthorized(form)) {
    showError(form, 'El tenant o runtime activo cambió. Volvé a abrir el formulario antes de guardar.');
    restoreSubmit(form);
    return;
  }

  const phoneField = form.elements.namedItem('phone');
  const phoneInput = phoneField instanceof HTMLInputElement ? phoneField : null;
  const duplicate = findDuplicateClient(state.crm.clients, values.phone || '', editingId);
  if (duplicate) {
    showDuplicate(form, duplicate, phoneInput);
    restoreSubmit(form);
    return;
  }

  let previousCrm: typeof state.crm | null = null;
  try {
    assertLeadFormTenantCurrent(context);
    const member = authenticatedWriteMember(context.scope);
    previousCrm = structuredClone(state.crm);
    assertTenantCrmScope(context.scope, previousCrm);

    const id = editingId ?? nextId(state.crm.clients);
    const client = clientFromFormValues(id, values, previous);
    client.assignedToId = previous?.assignedToId ?? member.id;
    client.createdById = previous?.createdById ?? member.id;

    assertLeadFormTenantCurrent(context);
    state.crm.clients = upsertClient(state.crm.clients, client);
    activitiesForClientSave(previous, client).forEach((activity) => (
      addActivityForAuthenticatedTenant(context.scope, activity)
    ));

    assertLeadFormTenantCurrent(context);
    assertTenantCrmScope(context.scope, state.crm);
    writeTenantSnapshot(context.scope, state.crm, {
      markDirty: true,
      reason: previous ? `Lead actualizado: ${client.name}` : `Lead creado: ${client.name}`,
    });
    if (!tenantSnapshotContainsClient(context, client)) {
      throw new Error('No se pudo verificar la copia tenant del lead.');
    }

    assertLeadFormTenantCurrent(context);
    queueCloudSave(context.scope, state.crm);
    assertLeadFormTenantCurrent(context);
    state.editingClientId = null;
    state.openForms.client = false;
    document.dispatchEvent(new CustomEvent('trv-render'));
    setNotice(previous
      ? `Lead actualizado correctamente. ${client.name} fue actualizado correctamente.`
      : `Lead guardado correctamente. ${client.name} fue creado correctamente.`);
  } catch {
    if (previousCrm) rollbackTenantState(context, previousCrm);
    showError(form, 'No se pudo guardar el lead. Tus datos siguen en el formulario.');
    restoreSubmit(form);
  }
}

export function submitLeadForm(event: SubmitEvent): void {
  const form = event.currentTarget;
  if (!(form instanceof HTMLFormElement) || form.id !== 'mvp-lead-form') return;

  event.preventDefault();
  if (submittingForms.has(form)) return;
  clearFeedback(form);

  if (!formStillAuthorized(form)) {
    showError(form, 'Este formulario ya no tiene autorización tenant. Volvé a abrir Nuevo lead.');
    return;
  }

  const context = leadFormTenantContext(form);
  if (!context) {
    showError(form, 'Este formulario no tiene un tenant capturado. Volvé a abrir Nuevo lead.');
    return;
  }

  try {
    assertLeadFormTenantCurrent(context);
    authenticatedWriteMember(context.scope);
  } catch {
    showError(form, 'La identidad autenticada ya no puede escribir este Lead. Volvé a abrir el formulario.');
    return;
  }

  const invalid = invalidControl(form);
  if (invalid) {
    showError(form, validationMessage(invalid), invalid);
    return;
  }

  const values = formValues(form);
  const editingId = capturedEditingId(form);
  const phoneField = form.elements.namedItem('phone');
  const phoneInput = phoneField instanceof HTMLInputElement ? phoneField : null;
  if (!isPlausiblePhone(values.phone || '')) {
    showError(form, 'Ingresá un WhatsApp válido con código de área.', phoneInput);
    return;
  }

  const duplicate = findDuplicateClient(state.crm.clients, values.phone || '', editingId);
  if (duplicate) {
    showDuplicate(form, duplicate, phoneInput);
    return;
  }

  if (!validateAndResolveSchedule(form, values, editingId)) return;
  if (!formStillAuthorized(form)) {
    showError(form, 'El tenant o runtime activo cambió. Volvé a abrir el formulario antes de guardar.');
    return;
  }

  const previous = editingId === null
    ? null
    : visibleClients().find((client) => client.id === editingId) ?? null;
  if (editingId !== null && !previous) {
    showError(form, 'El lead ya no está disponible para este usuario.');
    return;
  }

  const submit = form.querySelector<HTMLButtonElement>('[data-save-lead]');
  submittingForms.add(form);
  if (submit) {
    submit.disabled = true;
    submit.setAttribute('aria-busy', 'true');
    submit.textContent = 'Guardando…';
  }
  setStatus(form, 'Guardando…', 'working');

  window.setTimeout(() => persistLead(form, values, editingId, previous), SAVE_DELAY_MS);
}

function scheduleEnhancement(): void {
  queueMicrotask(enhanceLeadForm);
}

document.addEventListener('trv-render', scheduleEnhancement);
document.addEventListener('DOMContentLoaded', scheduleEnhancement, { once: true });
window.addEventListener('pageshow', scheduleEnhancement);
requestAnimationFrame(scheduleEnhancement);