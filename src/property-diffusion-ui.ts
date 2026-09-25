import { resolveTenantCommercialIdentity } from './configuration-domain.js';
import type { Property } from './models.js';
import {
  buildPropertyDiffusionMessage,
  latestPropertyDiffusion,
  propertyDiffusionContact,
  recordPropertyDiffusionResponse,
  recordPropertyDiffusionSent,
  type PropertyDiffusionChannel,
} from './property-diffusion.js';
import type { PropertyOpportunity } from './property-opportunities.js';
import { publishAndRememberPropertyFicha } from './mvp-properties-ui.js';
import { state } from './store.js';
import { assertTenantCrmScope } from './tenant-storage.js';
import {
  assertTenantRuntimeLeaseCurrent,
  captureTenantRuntimeLease,
  requireCurrentTenantScope,
  tenantRuntimeLeaseIsCurrent,
  TENANT_RUNTIME_STALE,
  type TenantRuntimeLease,
} from './tenant-runtime.js';
import type { TenantScope } from './active-organization.js';
import { escapeHtml } from './utils.js';

export interface PropertyDiffusionUiOptions {
  onRecorded: () => void;
  onFollowUp: (clientId: number) => void;
}

interface PreparedReview {
  scope: TenantScope;
  runtimeLease: TenantRuntimeLease;
  property: Property;
  opportunities: PropertyOpportunity[];
  message: string;
}

const dateTimeFormatter = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function formattedDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateTimeFormatter.format(date);
}

function assertPreparedReviewCurrent(review: PreparedReview): void {
  assertTenantRuntimeLeaseCurrent(review.runtimeLease);
  assertTenantCrmScope(review.scope, state.crm);
  const current = state.crm.properties.find((property) => property.id === review.property.id);
  if (!current) throw new Error(TENANT_RUNTIME_STALE);
}

function statusHtml(review: PreparedReview, opportunity: PropertyOpportunity): string {
  const latest = latestPropertyDiffusion(state.crm.activityLog, review.property, opportunity.match.client);
  if (!latest) return '<span class="diffusion-status pending">Pendiente · no enviado</span>';
  if (latest.status === 'RESPONDIO') {
    return `<span class="diffusion-status responded">Respondió · ${escapeHtml(formattedDateTime(latest.respondedAt || latest.sentAt))}</span>`;
  }
  return `<span class="diffusion-status sent">Ya enviada ${escapeHtml(formattedDateTime(latest.sentAt))}</span>`;
}

function reasonsHtml(opportunity: PropertyOpportunity): string {
  const reasons = opportunity.match.reasons.map((reason) => `<li>✓ ${escapeHtml(reason)}</li>`);
  const warnings = opportunity.match.warnings.map((warning) => `<li>⚠ ${escapeHtml(warning)}</li>`);
  return `<ul class="diffusion-reasons">${[...reasons, ...warnings].join('')}</ul>`;
}

function clientCard(review: PreparedReview, opportunity: PropertyOpportunity): string {
  const client = opportunity.match.client;
  const contact = propertyDiffusionContact(client, review.message, review.property.title);
  const latest = latestPropertyDiffusion(state.crm.activityLog, review.property, client);
  const reSend = latest ? 'Marcar reenvío como enviado' : 'Marcar como enviado';
  const whatsapp = contact.whatsappUrl
    ? `<div class="diffusion-channel"><div><strong>WhatsApp</strong><small>${escapeHtml(contact.whatsappDisplay)}</small></div><div class="diffusion-actions"><a class="diffusion-link" data-diffusion-open-whatsapp href="${escapeHtml(contact.whatsappUrl)}" target="_blank" rel="noopener noreferrer">Abrir WhatsApp</a><button type="button" data-diffusion-mark-sent="${client.id}" data-diffusion-channel="WhatsApp">${reSend}</button></div></div>`
    : `<div class="diffusion-channel unavailable"><div><strong>WhatsApp</strong><small>${escapeHtml(contact.whatsappReason || 'Sin teléfono válido')}</small></div></div>`;
  const email = contact.emailUrl
    ? `<div class="diffusion-channel"><div><strong>Email</strong><small>${escapeHtml(contact.email)}</small></div><div class="diffusion-actions"><a class="diffusion-link secondary" data-diffusion-open-email href="${escapeHtml(contact.emailUrl)}">Preparar email</a><button type="button" class="secondary" data-diffusion-mark-sent="${client.id}" data-diffusion-channel="Email">${reSend}</button></div></div>`
    : '';
  const postSend = latest
    ? `<div class="diffusion-post-send">${latest.status === 'ENVIADO' ? `<button type="button" class="secondary" data-diffusion-responded="${client.id}" data-diffusion-attempt="${escapeHtml(latest.attemptId)}">Respondió</button>` : ''}<button type="button" class="secondary" data-diffusion-followup="${client.id}">Agregar seguimiento</button></div>`
    : '';
  return `<article class="diffusion-client-card" data-diffusion-client="${client.id}">
    <div class="diffusion-client-heading"><div><strong>${escapeHtml(client.name)}</strong><span>${opportunity.match.score}% · ${escapeHtml(opportunity.match.level)}</span></div>${statusHtml(review, opportunity)}</div>
    <div class="diffusion-client-data"><span>${client.phone ? escapeHtml(client.phone) : 'Sin teléfono'}</span><span>${client.email ? escapeHtml(client.email) : 'Sin email'}</span></div>
    <div><strong>Por qué coincide</strong>${reasonsHtml(opportunity)}</div>
    <label class="diffusion-message"><span>Mensaje preparado</span><textarea readonly rows="5">${escapeHtml(review.message)}</textarea></label>
    <div class="diffusion-channels">${whatsapp}${email || (!contact.whatsappUrl ? '<p class="diffusion-no-channel">No hay un canal de contacto válido cargado.</p>' : '')}</div>
    ${postSend}
  </article>`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'No se pudo completar la acción. Volvé a intentarlo.';
}

function renderPreparedReview(
  container: HTMLElement,
  review: PreparedReview,
  options: PropertyDiffusionUiOptions,
): void {
  assertPreparedReviewCurrent(review);
  container.innerHTML = `<div class="diffusion-review" data-diffusion-review>
    <div class="diffusion-review-heading"><div><span>REVISIÓN</span><h3>Difusión asistida</h3><p>Revisá cada comprador. Abrir un canal no registra un envío: confirmalo sólo después de contactar.</p></div><strong>${review.opportunities.length} ${review.opportunities.length === 1 ? 'comprador' : 'compradores'}</strong></div>
    <div data-diffusion-error class="diffusion-error" hidden></div>
    <div class="diffusion-client-list">${review.opportunities.map((opportunity) => clientCard(review, opportunity)).join('')}</div>
  </div>`;

  const showError = (message: string): void => {
    const node = container.querySelector<HTMLElement>('[data-diffusion-error]');
    if (!node) return;
    node.textContent = message;
    node.hidden = false;
  };

  container.querySelectorAll<HTMLButtonElement>('[data-diffusion-mark-sent]').forEach((button) => {
    button.addEventListener('click', () => {
      const clientId = Number(button.dataset.diffusionMarkSent);
      const channel = button.dataset.diffusionChannel as PropertyDiffusionChannel;
      button.disabled = true;
      try {
        assertPreparedReviewCurrent(review);
        recordPropertyDiffusionSent({
          scope: review.scope,
          runtimeLease: review.runtimeLease,
          propertyId: review.property.id,
          clientId,
          channel,
        });
        options.onRecorded();
        renderPreparedReview(container, review, options);
      } catch (error) {
        if (tenantRuntimeLeaseIsCurrent(review.runtimeLease)) {
          button.disabled = false;
          showError(errorMessage(error));
        }
      }
    });
  });

  container.querySelectorAll<HTMLButtonElement>('[data-diffusion-responded]').forEach((button) => {
    button.addEventListener('click', () => {
      const clientId = Number(button.dataset.diffusionResponded);
      const attemptId = button.dataset.diffusionAttempt || '';
      button.disabled = true;
      try {
        assertPreparedReviewCurrent(review);
        const latest = latestPropertyDiffusion(
          state.crm.activityLog,
          review.property,
          review.opportunities.find(({ match }) => match.client.id === clientId)?.match.client!,
        );
        if (!latest || latest.attemptId !== attemptId) throw new Error('La difusión cambió. Volvé a revisar antes de registrar la respuesta.');
        recordPropertyDiffusionResponse({
          scope: review.scope,
          runtimeLease: review.runtimeLease,
          propertyId: review.property.id,
          clientId,
          channel: latest.channel,
          attemptId,
        });
        options.onRecorded();
        renderPreparedReview(container, review, options);
      } catch (error) {
        if (tenantRuntimeLeaseIsCurrent(review.runtimeLease)) {
          button.disabled = false;
          showError(errorMessage(error));
        }
      }
    });
  });

  container.querySelectorAll<HTMLButtonElement>('[data-diffusion-followup]').forEach((button) => {
    button.addEventListener('click', () => {
      assertPreparedReviewCurrent(review);
      const clientId = Number(button.dataset.diffusionFollowup);
      if (clientId) options.onFollowUp(clientId);
    });
  });
}

export async function prepareAndRenderPropertyDiffusion(
  container: HTMLElement,
  property: Property,
  opportunities: PropertyOpportunity[],
  options: PropertyDiffusionUiOptions,
): Promise<void> {
  if (!opportunities.length) return;
  const scope = requireCurrentTenantScope();
  const runtimeLease = captureTenantRuntimeLease(scope);
  assertTenantCrmScope(scope, state.crm);
  container.innerHTML = '<div class="diffusion-review loading" data-diffusion-review><strong>Preparando difusión…</strong><p>Generando o actualizando la ficha pública segura.</p></div>';
  try {
    const published = await publishAndRememberPropertyFicha(property, scope, runtimeLease);
    assertTenantRuntimeLeaseCurrent(runtimeLease);
    assertTenantCrmScope(scope, state.crm);
    const tenant = resolveTenantCommercialIdentity({ organization: state.crm.organization });
    if (tenant.organizationId !== scope.organizationId) throw new Error(TENANT_RUNTIME_STALE);
    const currentProperty = state.crm.properties.find((item) => item.id === property.id);
    if (!currentProperty) throw new Error(TENANT_RUNTIME_STALE);
    const selectedIds = new Set(opportunities.map(({ match }) => match.client.id));
    const currentOpportunities = opportunities.filter(({ match }) => (
      selectedIds.has(match.client.id)
      && state.crm.clients.some((client) => client.id === match.client.id)
    ));
    const review: PreparedReview = {
      scope,
      runtimeLease,
      property: currentProperty,
      opportunities: currentOpportunities,
      message: buildPropertyDiffusionMessage(currentProperty, tenant, published.url),
    };
    renderPreparedReview(container, review, options);
  } catch (error) {
    if (!tenantRuntimeLeaseIsCurrent(runtimeLease)) return;
    container.innerHTML = `<div class="diffusion-review error" data-diffusion-review><strong>No se pudo preparar la difusión</strong><p>${escapeHtml(errorMessage(error))}</p><p>No se registró ningún envío.</p></div>`;
  }
}
