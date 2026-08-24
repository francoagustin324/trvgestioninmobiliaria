import { isTerminalClient, localIsoDate } from './lead-pipeline.js';
import type { Client, Property, Visit, VisitInterest, VisitStatus } from './models.js';
import { saveData, state } from './store.js';
import { activeMember, addActivity, visibleProperties } from './team-access.js';
import { assignmentVisible } from './team-policy.js';
import { escapeHtml } from './utils.js';
import {
  coordinateVisit,
  registerVisitResult,
  visitPropertyLabel,
  visitsForClient,
} from './visit-workflow.js';

const SECTION_SELECTOR = '[data-lead-visits]';
let observerInstalled = false;
let enhancementQueued = false;

const dateTimeFormatter = new Intl.DateTimeFormat('es-AR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function propertyForVisit(visit: Visit): Property | undefined {
  return state.crm.properties.find((property) => property.id === visit.propertyId);
}

function statusClass(status: VisitStatus): string {
  if (status === 'Realizada') return 'realizada';
  if (status === 'Cancelada') return 'cancelada';
  if (status === 'No asistió') return 'no-asistio';
  return 'coordinada';
}

function formatScheduledAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateTimeFormatter.format(date);
}

function visibleVisits(clientId: number): Visit[] {
  const actor = activeMember();
  return visitsForClient(
    state.crm.visits.filter((visit) => assignmentVisible(actor.role, actor.id, visit.assignedToId)),
    clientId,
  );
}

function propertyOptions(): string {
  return visibleProperties()
    .slice()
    .sort((left, right) => visitPropertyLabel(left).localeCompare(visitPropertyLabel(right), 'es'))
    .map((property) => `<option value="${property.id}">${escapeHtml(visitPropertyLabel(property))}</option>`)
    .join('');
}

function coordinateForm(client: Client): string {
  const options = propertyOptions();
  return `<form class="pc-visit-form" data-coordinate-visit="${client.id}">
    <label>Propiedad
      <select name="propertyId" required>
        <option value="">Seleccionar propiedad</option>
        ${options}
      </select>
    </label>
    <div class="pc-visit-date-row">
      <label>Fecha<input type="date" name="date" min="${localIsoDate()}" required></label>
      <label>Hora<input type="time" name="time" required></label>
    </div>
    <p class="pc-visit-form-error" data-visit-form-error role="alert" hidden></p>
    <button type="submit">Guardar visita</button>
  </form>`;
}

function coordinateBlock(client: Client): string {
  if (isTerminalClient(client)) {
    return '<p class="pc-visit-terminal-note">Lead cerrado: no se pueden coordinar nuevas visitas.</p>';
  }
  const options = propertyOptions();
  if (!options) {
    return '<p class="pc-visit-empty">No hay propiedades visibles disponibles para coordinar una visita.</p>';
  }
  return `<details class="pc-visit-coordinate" data-visit-coordinate-disclosure="${client.id}">
    <summary>Coordinar visita</summary>
    <div data-visit-coordinate-body></div>
  </details>`;
}

function outcomeForm(client: Client, visit: Visit): string {
  const terminal = isTerminalClient(client);
  return `<form class="pc-visit-form" data-register-visit-result="${visit.id}" data-client-id="${client.id}">
    <label>Resultado
      <select name="status" required>
        <option value="">Seleccionar resultado</option>
        <option value="Realizada">Realizada</option>
        <option value="Cancelada">Cancelada</option>
        <option value="No asistió">No asistió</option>
      </select>
    </label>
    <label data-visit-interest-field>Interés
      <select name="interest" disabled>
        <option value="">Seleccionar interés</option>
        <option value="Alto">Alto</option>
        <option value="Medio">Medio</option>
        <option value="Bajo">Bajo</option>
      </select>
    </label>
    <label>Objeción / comentario
      <textarea name="objection" rows="2" maxlength="240" placeholder="Opcional"></textarea>
    </label>
    ${terminal ? '' : `<div class="pc-visit-next-step">
      <strong>Próximo paso</strong>
      <label>Próxima acción<input name="nextAction" maxlength="88" placeholder="Ej. Enviar propuesta" required></label>
      <label>Próxima fecha<input type="date" name="nextFollowUp" min="${localIsoDate()}" required></label>
    </div>`}
    <p class="pc-visit-form-error" data-visit-form-error role="alert" hidden></p>
    <button type="submit">Guardar resultado</button>
  </form>`;
}

function outcomeBlock(client: Client, visit: Visit): string {
  if (visit.status !== 'Coordinada') return '';
  return `<details class="pc-visit-result" data-visit-result-disclosure="${visit.id}" data-client-id="${client.id}">
    <summary>Registrar resultado</summary>
    <div data-visit-result-body></div>
  </details>`;
}

function visitRow(client: Client, visit: Visit): string {
  const property = propertyForVisit(visit);
  const propertyLabel = property ? visitPropertyLabel(property) : `Propiedad #${visit.propertyId}`;
  return `<article class="pc-visit-row" data-visit-id="${visit.id}">
    <div class="pc-visit-row-head">
      <div><strong>${escapeHtml(propertyLabel)}</strong><time>${escapeHtml(formatScheduledAt(visit.scheduledAt))}</time></div>
      <span class="pc-visit-status status-${statusClass(visit.status)}">${escapeHtml(visit.status)}</span>
    </div>
    ${visit.interest ? `<p class="pc-visit-interest"><span>Interés</span><strong>${escapeHtml(visit.interest)}</strong></p>` : ''}
    ${visit.objection ? `<p class="pc-visit-objection">${escapeHtml(visit.objection)}</p>` : ''}
    ${outcomeBlock(client, visit)}
  </article>`;
}

function renderSection(client: Client): string {
  const visits = visibleVisits(client.id);
  return `<section class="pc-lead-visits" data-lead-visits="${client.id}" aria-label="Visitas de ${escapeHtml(client.name)}">
    <div class="pc-lead-visits-head">
      <div><strong>Visitas</strong><span>${visits.length ? `${visits.length} ${visits.length === 1 ? 'registro' : 'registros'}` : 'Sin visitas registradas'}</span></div>
      ${coordinateBlock(client)}
    </div>
    ${visits.length
      ? `<div class="pc-visit-list">${visits.map((visit) => visitRow(client, visit)).join('')}</div>`
      : '<p class="pc-visit-empty">Todavía no hay visitas para este lead.</p>'}
  </section>`;
}

function bindDeferredForms(section: HTMLElement, client: Client): void {
  const coordinateDisclosure = section.querySelector<HTMLDetailsElement>('[data-visit-coordinate-disclosure]');
  if (coordinateDisclosure) {
    const body = coordinateDisclosure.querySelector<HTMLElement>('[data-visit-coordinate-body]');
    const syncCoordinateForm = (): void => {
      if (!body) return;
      if (!coordinateDisclosure.open) {
        body.replaceChildren();
        return;
      }
      if (!body.querySelector('[data-coordinate-visit]')) body.innerHTML = coordinateForm(client);
    };
    coordinateDisclosure.addEventListener('toggle', syncCoordinateForm);
    syncCoordinateForm();
  }

  section.querySelectorAll<HTMLDetailsElement>('[data-visit-result-disclosure]').forEach((resultDisclosure) => {
    const body = resultDisclosure.querySelector<HTMLElement>('[data-visit-result-body]');
    const visitId = Number(resultDisclosure.dataset.visitResultDisclosure);
    const syncOutcomeForm = (): void => {
      if (!body) return;
      if (!resultDisclosure.open) {
        body.replaceChildren();
        return;
      }
      if (body.querySelector('[data-register-visit-result]')) return;
      const visit = state.crm.visits.find((item) => item.id === visitId && item.clientId === client.id);
      if (!visit || visit.status !== 'Coordinada') {
        body.replaceChildren();
        return;
      }
      body.innerHTML = outcomeForm(client, visit);
    };
    resultDisclosure.addEventListener('toggle', syncOutcomeForm);
    syncOutcomeForm();
  });
}

function sectionHost(card: HTMLElement): HTMLElement | null {
  return card.querySelector<HTMLElement>('.mvp-lead-full-content');
}

function insertVisitSection(card: HTMLElement, client: Client): void {
  if (card.querySelector(SECTION_SELECTOR)) return;
  const host = sectionHost(card);
  if (!host) return;
  const wrapper = document.createElement('div');
  wrapper.innerHTML = renderSection(client);
  const section = wrapper.firstElementChild;
  if (!(section instanceof HTMLElement)) return;
  const anchor = host.querySelector('.mvp-lead-history, .mvp-lead-matches, .mvp-lead-full-actions');
  host.insertBefore(section, anchor);
  bindDeferredForms(section, client);
}

export function enhanceLeadVisits(): void {
  document.querySelectorAll<HTMLElement>('.mvp-lead-card[data-client-id]').forEach((card) => {
    const clientId = Number(card.dataset.clientId);
    if (!Number.isFinite(clientId)) return;
    const client = state.crm.clients.find((item) => item.id === clientId);
    if (client) insertVisitSection(card, client);
  });
}

function queueEnhancement(): void {
  if (enhancementQueued) return;
  enhancementQueued = true;
  queueMicrotask(() => {
    enhancementQueued = false;
    enhanceLeadVisits();
  });
}

function formError(form: HTMLFormElement, message: string): void {
  const output = form.querySelector<HTMLElement>('[data-visit-form-error]');
  if (!output) return;
  output.textContent = message;
  output.hidden = false;
}

function formBusy(form: HTMLFormElement, busy: boolean): void {
  form.dataset.submitting = busy ? 'true' : 'false';
  form.querySelectorAll<HTMLButtonElement>('button[type="submit"]').forEach((button) => {
    button.disabled = busy;
  });
}

function replaceClient(next: Client): void {
  const index = state.crm.clients.findIndex((client) => client.id === next.id);
  if (index < 0) throw new Error('El lead ya no está disponible.');
  state.crm.clients[index] = next;
}

function coordinateFromForm(form: HTMLFormElement): void {
  if (form.dataset.submitting === 'true') return;
  formBusy(form, true);
  try {
    const clientId = Number(form.dataset.coordinateVisit);
    const client = state.crm.clients.find((item) => item.id === clientId);
    if (!client) throw new Error('El lead ya no está disponible.');
    const data = new FormData(form);
    const propertyId = Number(data.get('propertyId'));
    const property = visibleProperties().find((item) => item.id === propertyId);
    if (!property) throw new Error('Seleccioná una propiedad disponible.');
    const actor = activeMember();
    const result = coordinateVisit({
      visits: state.crm.visits,
      client,
      property,
      actor: { id: actor.id, role: actor.role },
      localDate: String(data.get('date') || ''),
      localTime: String(data.get('time') || ''),
    });

    replaceClient(result.client);
    state.crm.visits.push(result.visit);
    addActivity(result.activity);
    saveData('Visita coordinada');
    document.dispatchEvent(new CustomEvent('trv-render'));
  } catch (error) {
    formBusy(form, false);
    formError(form, error instanceof Error ? error.message : 'No se pudo coordinar la visita.');
  }
}

function registerResultFromForm(form: HTMLFormElement): void {
  if (form.dataset.submitting === 'true') return;
  formBusy(form, true);
  try {
    const visitId = Number(form.dataset.registerVisitResult);
    const clientId = Number(form.dataset.clientId);
    const visitIndex = state.crm.visits.findIndex((item) => item.id === visitId);
    const visit = state.crm.visits[visitIndex];
    const client = state.crm.clients.find((item) => item.id === clientId);
    if (!visit || visitIndex < 0) throw new Error('La visita ya no está disponible.');
    if (!client) throw new Error('El lead ya no está disponible.');
    const data = new FormData(form);
    const status = String(data.get('status') || '') as VisitStatus;
    const rawInterest = String(data.get('interest') || '');
    const interest = rawInterest ? rawInterest as VisitInterest : undefined;
    const property = propertyForVisit(visit);
    const actor = activeMember();
    const result = registerVisitResult({
      visit,
      client,
      property,
      actor: { id: actor.id, role: actor.role },
      status,
      interest,
      objection: String(data.get('objection') || ''),
      nextAction: String(data.get('nextAction') || ''),
      nextFollowUp: String(data.get('nextFollowUp') || ''),
    });

    replaceClient(result.client);
    state.crm.visits[visitIndex] = result.visit;
    addActivity(result.activity);
    saveData(`Resultado de visita: ${result.visit.status}`);
    document.dispatchEvent(new CustomEvent('trv-render'));
  } catch (error) {
    formBusy(form, false);
    formError(form, error instanceof Error ? error.message : 'No se pudo registrar el resultado.');
  }
}

function bindEvents(): void {
  document.addEventListener('submit', (event) => {
    const form = event.target as HTMLFormElement;
    if (!(form instanceof HTMLFormElement)) return;
    if (form.matches('[data-coordinate-visit]')) {
      event.preventDefault();
      coordinateFromForm(form);
      return;
    }
    if (form.matches('[data-register-visit-result]')) {
      event.preventDefault();
      registerResultFromForm(form);
    }
  });

  document.addEventListener('change', (event) => {
    const select = (event.target as HTMLElement).closest<HTMLSelectElement>('[data-register-visit-result] select[name="status"]');
    if (!select) return;
    const form = select.closest<HTMLFormElement>('[data-register-visit-result]');
    const interest = form?.querySelector<HTMLSelectElement>('select[name="interest"]');
    if (!interest) return;
    const required = select.value === 'Realizada';
    interest.disabled = !required;
    interest.required = required;
    if (!required) interest.value = '';
  });

  document.addEventListener('trv-render', queueEnhancement);
}

function installObserver(): void {
  if (observerInstalled) return;
  const root = document.querySelector('#root');
  if (!root) return;
  observerInstalled = true;
  new MutationObserver(queueEnhancement).observe(root, { childList: true, subtree: true });
}

bindEvents();
installObserver();
queueEnhancement();
