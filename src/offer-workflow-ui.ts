import { isTerminalClient, localIsoDate } from './lead-pipeline.js';
import type { Client, Offer, OfferCurrency, OfferOrigin, OfferStatus, Property } from './models.js';
import { saveData, state } from './store.js';
import { activeMember, visibleProperties } from './team-access.js';
import { assignmentVisible } from './team-policy.js';
import { escapeHtml } from './utils.js';
import {
  offersForClient,
  registerCounterOffer,
  registerOffer,
  resolveOffer,
} from './offer-workflow.js';

const SECTION_SELECTOR = '[data-lead-offers]';
let observerInstalled = false;
let enhancementQueued = false;

const dateFormatter = new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium' });
const moneyFormatter = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });

function propertyLabel(property: Property | undefined, propertyId: number): string {
  if (!property) return `Propiedad #${propertyId}`;
  return property.title?.trim() || property.address?.trim() || `Propiedad #${propertyId}`;
}

function visibleOffers(clientId: number): Offer[] {
  const actor = activeMember();
  return offersForClient(
    state.crm.offers.filter((offer) => assignmentVisible(actor.role, actor.id, offer.assignedToId)),
    clientId,
  );
}

function propertyOptions(): string {
  return visibleProperties()
    .slice()
    .sort((left, right) => propertyLabel(left, left.id).localeCompare(propertyLabel(right, right.id), 'es'))
    .map((property) => `<option value="${property.id}">${escapeHtml(propertyLabel(property, property.id))}</option>`)
    .join('');
}

function optionalFields(prefix = ''): string {
  return `<label>Forma / condiciones de pago
    <input name="paymentTerms" maxlength="160" placeholder="Opcional">
  </label>
  <label>Condiciones adicionales
    <textarea name="conditions" rows="2" maxlength="280" placeholder="Opcional"></textarea>
  </label>
  <label>Vigencia
    <input type="date" name="validUntil">
  </label>
  <div class="pc-offer-next-step">
    <strong>Próximo paso</strong>
    <label>Próxima acción
      <input name="nextAction" maxlength="120" placeholder="Ej. ${escapeHtml(prefix || 'Presentar oferta al propietario')}" required>
    </label>
    <label>Próxima fecha
      <input type="date" name="nextFollowUp" min="${localIsoDate()}" required>
    </label>
  </div>`;
}

function offerFields(includeProperty: boolean, nextHint: string): string {
  const options = propertyOptions();
  return `${includeProperty ? `<label>Propiedad
      <select name="propertyId" required>
        <option value="">Seleccionar propiedad</option>
        ${options}
      </select>
    </label>` : ''}
    <div class="pc-offer-amount-row">
      <label>Monto<input type="number" name="amount" min="0.01" step="0.01" inputmode="decimal" required></label>
      <label>Moneda<select name="currency" required><option value="USD">USD</option><option value="ARS">ARS</option></select></label>
    </div>
    <label>Origen<select name="origin" required><option value="Cliente">Cliente</option><option value="Propietario">Propietario</option></select></label>
    ${optionalFields(nextHint)}`;
}

function registerBlock(client: Client): string {
  if (isTerminalClient(client)) return '<p class="pc-offer-empty">Lead cerrado: no se pueden registrar ofertas nuevas.</p>';
  if (!propertyOptions()) return '<p class="pc-offer-empty">No hay propiedades visibles disponibles para registrar una oferta.</p>';
  return `<details class="pc-offer-disclosure" data-offer-register-disclosure="${client.id}">
    <summary>Registrar oferta</summary>
    <div data-offer-register-body></div>
  </details>`;
}

function registerForm(client: Client): string {
  return `<form class="pc-offer-form" data-register-offer="${client.id}">
    ${offerFields(true, 'Presentar oferta al propietario')}
    <p class="pc-offer-form-error" data-offer-form-error role="alert" hidden></p>
    <button type="submit">Guardar oferta</button>
  </form>`;
}

function counterForm(offer: Offer): string {
  return `<form class="pc-offer-form" data-register-counteroffer="${offer.id}">
    ${offerFields(false, 'Presentar contraoferta al cliente')}
    <p class="pc-offer-form-error" data-offer-form-error role="alert" hidden></p>
    <button type="submit">Guardar contraoferta</button>
  </form>`;
}

function resolveForm(client: Client, offer: Offer): string {
  const terminal = isTerminalClient(client);
  return `<form class="pc-offer-form" data-resolve-offer="${offer.id}" data-client-id="${client.id}">
    <label>Resultado
      <select name="status" required>
        <option value="">Seleccionar</option>
        <option value="Aceptada">Aceptada</option>
        <option value="Rechazada">Rechazada</option>
        <option value="Retirada">Retirada</option>
      </select>
    </label>
    ${terminal ? '' : `<div class="pc-offer-next-step">
      <strong>Próximo paso</strong>
      <p class="pc-offer-suggestion" data-offer-resolution-suggestion>Definí el siguiente compromiso comercial.</p>
      <label>Próxima acción<input name="nextAction" maxlength="120" placeholder="Ej. Formalizar reserva" required></label>
      <label>Próxima fecha<input type="date" name="nextFollowUp" min="${localIsoDate()}" required></label>
    </div>`}
    <p class="pc-offer-form-error" data-offer-form-error role="alert" hidden></p>
    <button type="submit">Guardar estado</button>
  </form>`;
}

function statusClass(status: OfferStatus): string {
  return status.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '-');
}

function formattedDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateFormatter.format(date);
}

function offerRow(client: Client, offer: Offer): string {
  const property = state.crm.properties.find((item) => item.id === offer.propertyId);
  const parent = offer.parentOfferId ? state.crm.offers.find((item) => item.id === offer.parentOfferId) : undefined;
  const pending = offer.status === 'Pendiente';
  const details = [
    offer.paymentTerms ? `<span><b>Pago:</b> ${escapeHtml(offer.paymentTerms)}</span>` : '',
    offer.conditions ? `<span><b>Condiciones:</b> ${escapeHtml(offer.conditions)}</span>` : '',
    offer.validUntil ? `<span><b>Vigencia:</b> ${escapeHtml(offer.validUntil)}</span>` : '',
  ].filter(Boolean).join('');
  return `<article class="pc-offer-row" data-offer-id="${offer.id}">
    <div class="pc-offer-row-head">
      <div>
        <strong>${escapeHtml(propertyLabel(property, offer.propertyId))}</strong>
        ${parent ? `<span class="pc-offer-parent">↳ Contraoferta de propuesta #${parent.id}</span>` : ''}
      </div>
      <span class="pc-offer-status status-${statusClass(offer.status)}">${escapeHtml(offer.status)}</span>
    </div>
    <div class="pc-offer-primary">
      <strong>${escapeHtml(offer.currency)} ${escapeHtml(moneyFormatter.format(offer.amount))}</strong>
      <span>${escapeHtml(offer.origin)} · ${escapeHtml(formattedDate(offer.createdAt))}</span>
    </div>
    ${details ? `<div class="pc-offer-meta">${details}</div>` : ''}
    ${pending ? `<div class="pc-offer-actions">
      <details class="pc-offer-disclosure" data-counteroffer-disclosure="${offer.id}"><summary>Registrar contraoferta</summary><div data-counteroffer-body></div></details>
      <details class="pc-offer-disclosure" data-resolve-offer-disclosure="${offer.id}"><summary>Marcar estado</summary><div data-resolve-offer-body></div></details>
    </div>` : ''}
  </article>`;
}

function renderSection(client: Client): string {
  const offers = visibleOffers(client.id);
  return `<section class="pc-lead-offers" data-lead-offers="${client.id}" aria-label="Ofertas y negociación de ${escapeHtml(client.name)}">
    <div class="pc-lead-offers-head">
      <div><strong>Ofertas / Negociación</strong><span>${offers.length ? `${offers.length} ${offers.length === 1 ? 'propuesta' : 'propuestas'}` : 'Sin ofertas registradas'}</span></div>
      ${registerBlock(client)}
    </div>
    ${offers.length ? `<div class="pc-offer-list">${offers.map((offer) => offerRow(client, offer)).join('')}</div>` : '<p class="pc-offer-empty">Todavía no hay ofertas para este lead.</p>'}
  </section>`;
}

function bindDeferredForms(section: HTMLElement, client: Client): void {
  const register = section.querySelector<HTMLDetailsElement>('[data-offer-register-disclosure]');
  if (register) {
    const body = register.querySelector<HTMLElement>('[data-offer-register-body]');
    const sync = (): void => {
      if (!body) return;
      if (!register.open) { body.replaceChildren(); return; }
      if (!body.querySelector('[data-register-offer]')) body.innerHTML = registerForm(client);
    };
    register.addEventListener('toggle', sync);
    sync();
  }
  section.querySelectorAll<HTMLDetailsElement>('[data-counteroffer-disclosure]').forEach((details) => {
    const id = Number(details.dataset.counterofferDisclosure);
    const body = details.querySelector<HTMLElement>('[data-counteroffer-body]');
    const sync = (): void => {
      if (!body) return;
      if (!details.open) { body.replaceChildren(); return; }
      const offer = state.crm.offers.find((item) => item.id === id && item.clientId === client.id);
      if (!offer || offer.status !== 'Pendiente') { body.replaceChildren(); return; }
      if (!body.querySelector('[data-register-counteroffer]')) body.innerHTML = counterForm(offer);
    };
    details.addEventListener('toggle', sync);
    sync();
  });
  section.querySelectorAll<HTMLDetailsElement>('[data-resolve-offer-disclosure]').forEach((details) => {
    const id = Number(details.dataset.resolveOfferDisclosure);
    const body = details.querySelector<HTMLElement>('[data-resolve-offer-body]');
    const sync = (): void => {
      if (!body) return;
      if (!details.open) { body.replaceChildren(); return; }
      const offer = state.crm.offers.find((item) => item.id === id && item.clientId === client.id);
      if (!offer || offer.status !== 'Pendiente') { body.replaceChildren(); return; }
      if (!body.querySelector('[data-resolve-offer]')) body.innerHTML = resolveForm(client, offer);
    };
    details.addEventListener('toggle', sync);
    sync();
  });
}

function insertOfferSection(card: HTMLElement, client: Client): void {
  if (card.querySelector(SECTION_SELECTOR)) return;
  const host = card.querySelector<HTMLElement>('.mvp-lead-full-content');
  if (!host) return;
  const wrapper = document.createElement('div');
  wrapper.innerHTML = renderSection(client);
  const section = wrapper.firstElementChild;
  if (!(section instanceof HTMLElement)) return;
  const visits = host.querySelector('[data-lead-visits]');
  const anchor = visits?.nextSibling ?? host.querySelector('.mvp-lead-history, .mvp-lead-matches, .mvp-lead-full-actions');
  host.insertBefore(section, anchor);
  bindDeferredForms(section, client);
}

export function enhanceLeadOffers(): void {
  document.querySelectorAll<HTMLElement>('.mvp-lead-card[data-client-id]').forEach((card) => {
    const id = Number(card.dataset.clientId);
    const client = state.crm.clients.find((item) => item.id === id);
    if (client) insertOfferSection(card, client);
  });
}

function queueEnhancement(): void {
  if (enhancementQueued) return;
  enhancementQueued = true;
  queueMicrotask(() => { enhancementQueued = false; enhanceLeadOffers(); });
}

function formBusy(form: HTMLFormElement, busy: boolean): void {
  form.dataset.submitting = busy ? 'true' : 'false';
  form.querySelectorAll<HTMLButtonElement>('button[type="submit"]').forEach((button) => { button.disabled = busy; });
}

function formError(form: HTMLFormElement, error: unknown): void {
  const output = form.querySelector<HTMLElement>('[data-offer-form-error]');
  if (!output) return;
  output.textContent = error instanceof Error ? error.message : 'No se pudo guardar la negociación.';
  output.hidden = false;
}

function actor() {
  const member = activeMember();
  return { id: member.id, role: member.role };
}

function applyResult(result: { crm: typeof state.crm }): void {
  state.crm = result.crm;
  saveData('Flujo comercial de ofertas');
  document.dispatchEvent(new CustomEvent('trv-render'));
}

function readOfferFields(data: FormData) {
  return {
    amount: Number(data.get('amount')),
    currency: String(data.get('currency') || '') as OfferCurrency,
    origin: String(data.get('origin') || '') as OfferOrigin,
    paymentTerms: String(data.get('paymentTerms') || ''),
    conditions: String(data.get('conditions') || ''),
    validUntil: String(data.get('validUntil') || ''),
    nextAction: String(data.get('nextAction') || ''),
    nextFollowUp: String(data.get('nextFollowUp') || ''),
  };
}

function submitRegister(form: HTMLFormElement): void {
  if (form.dataset.submitting === 'true') return;
  formBusy(form, true);
  try {
    const data = new FormData(form);
    const clientId = Number(form.dataset.registerOffer);
    const result = registerOffer(state.crm, actor(), {
      clientId,
      propertyId: Number(data.get('propertyId')),
      ...readOfferFields(data),
    });
    applyResult(result);
  } catch (error) { formBusy(form, false); formError(form, error); }
}

function submitCounter(form: HTMLFormElement): void {
  if (form.dataset.submitting === 'true') return;
  formBusy(form, true);
  try {
    const data = new FormData(form);
    const result = registerCounterOffer(state.crm, actor(), {
      parentOfferId: Number(form.dataset.registerCounteroffer),
      ...readOfferFields(data),
    });
    applyResult(result);
  } catch (error) { formBusy(form, false); formError(form, error); }
}

function submitResolution(form: HTMLFormElement): void {
  if (form.dataset.submitting === 'true') return;
  formBusy(form, true);
  try {
    const data = new FormData(form);
    const result = resolveOffer(state.crm, actor(), {
      offerId: Number(form.dataset.resolveOffer),
      status: String(data.get('status') || ''),
      nextAction: String(data.get('nextAction') || ''),
      nextFollowUp: String(data.get('nextFollowUp') || ''),
    });
    applyResult(result);
  } catch (error) { formBusy(form, false); formError(form, error); }
}

function bindEvents(): void {
  document.addEventListener('submit', (event) => {
    const form = event.target as HTMLFormElement;
    if (!(form instanceof HTMLFormElement)) return;
    if (form.matches('[data-register-offer]')) { event.preventDefault(); submitRegister(form); return; }
    if (form.matches('[data-register-counteroffer]')) { event.preventDefault(); submitCounter(form); return; }
    if (form.matches('[data-resolve-offer]')) { event.preventDefault(); submitResolution(form); }
  });
  document.addEventListener('change', (event) => {
    const select = (event.target as HTMLElement).closest<HTMLSelectElement>('[data-resolve-offer] select[name="status"]');
    if (!select) return;
    const form = select.closest<HTMLFormElement>('[data-resolve-offer]');
    const hint = form?.querySelector<HTMLElement>('[data-offer-resolution-suggestion]');
    const action = form?.querySelector<HTMLInputElement>('input[name="nextAction"]');
    if (!hint || !action) return;
    const suggested = select.value === 'Aceptada' ? 'Formalizar reserva' : select.value === 'Rechazada' ? 'Enviar alternativas' : 'Retomar búsqueda';
    hint.textContent = `Sugerencia: ${suggested}.`;
    if (!action.value.trim()) action.placeholder = `Ej. ${suggested}`;
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
