import { PRODUCT_BRAND } from './branding.js';
import { resolveTenantCommercialIdentity } from './configuration-domain.js';
import { commercialStage } from './lead-pipeline.js';
import type { ActivityEntry, Client, Property, PropertyDiffusionChannel } from './models.js';
import { publishAndRememberPropertyFicha } from './mvp-properties-ui.js';
import {
  buildPropertyDiffusionMessage,
  latestPropertyDiffusionResponse,
  latestPropertyDiffusionSent,
  normalizedEmail,
  normalizedWhatsAppPhone,
  propertyDiffusionEmailUrl,
  propertyDiffusionWhatsAppUrl,
} from './property-diffusion.js';
import { recordPropertyDiffusionEvent } from './property-diffusion-store.js';
import type { PropertyDiffusionLedgerMoment } from './property-diffusion-ledger.js';
import {
  buildPropertyOpportunities,
  DEFAULT_OPPORTUNITY_FILTERS,
  filterPropertyOpportunities,
  propertyMatchingDataIssues,
  terminalClientsForOpportunities,
  type OpportunityFilters,
  type PropertyOpportunity,
} from './property-opportunities.js';
import { propertyMatchReasonsHtml } from './property-matching-ui.js';
import type { PropertyWithFicha } from './property-ficha.js';
import { clearReadEntityNavigation, openEntityReadOnly } from './entity-read-navigation.js';
import { authenticatedTenantMember, registerTransientStateReset, state } from './store.js';
import { visibleClients, visibleProperties } from './team-access.js';
import { assignmentVisible } from './team-policy.js';
import { assertTenantCrmScope } from './tenant-storage.js';
import {
  assertTenantRuntimeLeaseCurrent,
  captureTenantRuntimeLease,
  requireCurrentTenantScope,
  TENANT_RUNTIME_STALE,
  tenantRuntimeLeaseIsCurrent,
  type TenantRuntimeLease,
} from './tenant-runtime.js';
import { escapeHtml } from './utils.js';

const usdFormatter = new Intl.NumberFormat('es-AR');
const dateFormatter = new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'short', year: 'numeric' });

type PreparedDiffusion = {
  propertyId: number;
  propertyUid?: string;
  message: string;
};

let selectedPropertyId: number | null = null;
let filters: OpportunityFilters = { ...DEFAULT_OPPORTUNITY_FILTERS };
const selectedClientIds = new Set<number>();
let diffusionReviewOpen = false;
let diffusionPreparing = false;
let diffusionPrepareError = '';
let diffusionActionError = '';
let preparedDiffusion: PreparedDiffusion | null = null;

function resetDiffusionUi(closeReview = true): void {
  if (closeReview) diffusionReviewOpen = false;
  diffusionPreparing = false;
  diffusionPrepareError = '';
  diffusionActionError = '';
  preparedDiffusion = null;
}

registerTransientStateReset(() => {
  selectedPropertyId = null;
  filters = { ...DEFAULT_OPPORTUNITY_FILTERS };
  selectedClientIds.clear();
  resetDiffusionUi();
});

function propertyOption(property: Property): string {
  const selected = property.id === selectedPropertyId ? ' selected' : '';
  return `<option value="${property.id}"${selected}>${escapeHtml(property.title)} · ${escapeHtml(property.address)}</option>`;
}

function formattedDate(value: string | undefined): string {
  if (!value) return '';
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(date.getTime()) ? escapeHtml(value) : escapeHtml(dateFormatter.format(date));
}

function latestActivitiesByClient(entries: ActivityEntry[]): Map<number, ActivityEntry> {
  const latest = new Map<number, ActivityEntry>();
  entries.forEach((entry) => {
    if (entry.entityType !== 'Cliente' || !entry.entityId) return;
    const current = latest.get(entry.entityId);
    if (!current || entry.createdAt > current.createdAt) latest.set(entry.entityId, entry);
  });
  return latest;
}

function followUpHtml(client: Client): string {
  if (!client.nextAction && !client.nextFollowUp) {
    return '<div class="opportunity-followup is-missing"><span>Próximo seguimiento</span><strong>Sin próximo seguimiento</strong></div>';
  }
  return `<div class="opportunity-followup"><span>Próximo seguimiento</span>
    <strong>${client.nextFollowUp ? formattedDate(client.nextFollowUp) : 'Sin fecha'}</strong>
    ${client.nextAction ? `<small>${escapeHtml(client.nextAction)}</small>` : ''}
  </div>`;
}

function activityHtml(activity: ActivityEntry | undefined): string {
  if (!activity) return '<div class="opportunity-activity"><span>Última actividad</span><small>Sin actividad registrada</small></div>';
  return `<div class="opportunity-activity"><span>Última actividad</span><strong>${escapeHtml(activity.action)}</strong><small>${formattedDate(activity.createdAt)}</small></div>`;
}

function priorDiffusionHtml(property: Property, client: Client): string {
  const sent = latestPropertyDiffusionSent(client, property);
  if (!sent) return '<span class="opportunity-diffusion-state is-pending">No enviada</span>';
  return `<span class="opportunity-diffusion-state is-sent">✓ Ya difundida el ${formattedDate(sent.createdAt)} · ${escapeHtml(sent.diffusionChannel)}</span>`;
}

function opportunityCard(
  opportunity: PropertyOpportunity,
  latestActivities: Map<number, ActivityEntry>,
): string {
  const { match } = opportunity;
  const client = match.client;
  const selected = selectedClientIds.has(client.id);
  const stage = commercialStage(client);
  const email = normalizedEmail(client.email);
  return `<article class="property-opportunity-card" data-opportunity-client="${client.id}">
    <label class="opportunity-selector">
      <input type="checkbox" data-opportunity-select="${client.id}"${selected ? ' checked' : ''}>
      <span class="sr-only">Seleccionar ${escapeHtml(client.name)}</span>
    </label>
    <div class="opportunity-main">
      <div class="opportunity-heading">
        <div>
          <strong class="opportunity-client-name">${escapeHtml(client.name)}</strong>
          ${client.phone ? `<a class="opportunity-phone" href="tel:${escapeHtml(client.phone)}">${escapeHtml(client.phone)}</a>` : '<span class="opportunity-phone muted">Sin teléfono</span>'}
          ${email ? `<a class="opportunity-email" href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>` : ''}
        </div>
        <div class="opportunity-badges">
          <span class="opportunity-stage">${escapeHtml(stage)}</span>
          <b class="match-score ${match.level.toLowerCase()}">${match.score}% · ${match.level}</b>
        </div>
      </div>
      <div class="opportunity-diffusion-history">${priorDiffusionHtml(match.property, client)}</div>
      <div class="opportunity-requirements">
        <div class="opportunity-requirements-title"><strong>Por qué coincide</strong><small>✓ Cumple · ⚠ A revisar / no cumple plenamente</small></div>
        ${propertyMatchReasonsHtml(match)}
      </div>
      <div class="opportunity-commercial-context">
        ${followUpHtml(client)}
        ${activityHtml(latestActivities.get(client.id))}
      </div>
      <div class="opportunity-card-actions">
        <button type="button" class="secondary opportunity-open-client" data-open-opportunity-client="${client.id}">Abrir ficha</button>
      </div>
    </div>
  </article>`;
}

function terminalCard(client: Client): string {
  const stage = commercialStage(client);
  return `<article class="opportunity-terminal-card" data-terminal-client>
    <div><strong>${escapeHtml(client.name)}</strong>${client.phone ? `<span>${escapeHtml(client.phone)}</span>` : ''}</div>
    <span class="opportunity-terminal-stage">${escapeHtml(stage)}</span>
    <small>Fuera de acción comercial. El matching canónico no asigna compatibilidad a clientes Ganado/Perdido.</small>
  </article>`;
}

function propertySummary(property: Property): string {
  const bedrooms = property.bedrooms ? ` · ${property.bedrooms} dorm.` : '';
  return `<article class="opportunity-property-summary" aria-label="Propiedad seleccionada">
    <div class="opportunity-property-summary-copy">
      <span>Propiedad seleccionada</span>
      <strong>${escapeHtml(property.title)}</strong>
      <p>${escapeHtml(property.address)} · ${escapeHtml(property.type)}${bedrooms}</p>
    </div>
    <div class="opportunity-property-price"><span>Precio</span><b>USD ${usdFormatter.format(property.price)}</b><button type="button" class="secondary" data-open-opportunity-property="${property.id}">Abrir propiedad</button></div>
  </article>`;
}

function filtersHtml(): string {
  return `<div class="opportunity-filters" aria-label="Filtros de oportunidades">
    <label class="opportunity-search"><span>Buscar cliente</span><input type="search" data-opportunity-search value="${escapeHtml(filters.search)}" placeholder="Nombre, teléfono o requisito"></label>
    <label><span>Compatibilidad</span><select data-opportunity-compatibility>
      <option value="all"${filters.compatibility === 'all' ? ' selected' : ''}>Todos</option>
      <option value="high"${filters.compatibility === 'high' ? ' selected' : ''}>Alta compatibilidad</option>
    </select></label>
    <label><span>Seguimiento</span><select data-opportunity-followup>
      <option value="all"${filters.followUp === 'all' ? ' selected' : ''}>Todos</option>
      <option value="with"${filters.followUp === 'with' ? ' selected' : ''}>Con próximo seguimiento</option>
      <option value="without"${filters.followUp === 'without' ? ' selected' : ''}>Sin próximo seguimiento</option>
    </select></label>
    <label><span>Estado</span><select data-opportunity-status>
      <option value="active"${filters.status === 'active' ? ' selected' : ''}>Activos</option>
      <option value="all"${filters.status === 'all' ? ' selected' : ''}>Todos visibles</option>
    </select></label>
  </div>`;
}

function selectionText(): string {
  const count = selectedClientIds.size;
  return `${count} ${count === 1 ? 'cliente seleccionado' : 'clientes seleccionados'}`;
}

function responseAfterLatestSend(property: Property, client: Client): PropertyDiffusionLedgerMoment | null {
  const sent = latestPropertyDiffusionSent(client, property);
  if (!sent) return null;
  const response = latestPropertyDiffusionResponse(client, property);
  return response && response.createdAt >= sent.createdAt ? response : null;
}

function diffusionChannelRows(property: Property, client: Client, priorSent: PropertyDiffusionLedgerMoment | null): string {
  if (!preparedDiffusion || preparedDiffusion.propertyId !== property.id) return '';
  const whatsapp = propertyDiffusionWhatsAppUrl(client.phone, preparedDiffusion.message);
  const email = propertyDiffusionEmailUrl(client.email, property.title, preparedDiffusion.message);
  const markLabel = priorSent ? 'Marcar nuevo envío' : 'Marcar como enviado';
  const rows: string[] = [];

  if (whatsapp) {
    rows.push(`<div class="diffusion-channel-row" data-diffusion-channel-row="WhatsApp">
      <div><strong>WhatsApp</strong><small>${escapeHtml(client.phone)}</small></div>
      <div class="diffusion-channel-actions">
        <a class="secondary diffusion-open-channel" data-open-diffusion-whatsapp href="${escapeHtml(whatsapp)}" target="_blank" rel="noopener noreferrer">Abrir WhatsApp</a>
        <button type="button" data-mark-diffusion-sent="${client.id}" data-diffusion-channel="WhatsApp">${markLabel}</button>
      </div>
    </div>`);
  }

  if (email) {
    rows.push(`<div class="diffusion-channel-row" data-diffusion-channel-row="Email">
      <div><strong>Email</strong><small>${escapeHtml(normalizedEmail(client.email) ?? '')}</small></div>
      <div class="diffusion-channel-actions">
        <a class="secondary diffusion-open-channel" data-open-diffusion-email href="${escapeHtml(email)}">Preparar email</a>
        <button type="button" data-mark-diffusion-sent="${client.id}" data-diffusion-channel="Email">${markLabel}</button>
      </div>
    </div>`);
  }

  if (!rows.length) {
    rows.push('<p class="diffusion-no-channel">Este cliente no tiene teléfono válido para WhatsApp ni email válido. Completá un canal antes de contactar.</p>');
  }
  return `<div class="diffusion-channel-list">${rows.join('')}</div>`;
}

function diffusionReviewCard(opportunity: PropertyOpportunity, property: Property): string {
  const client = opportunity.match.client;
  const priorSent = latestPropertyDiffusionSent(client, property);
  const responded = responseAfterLatestSend(property, client);
  const validPhone = normalizedWhatsAppPhone(client.phone);
  const email = normalizedEmail(client.email);
  const contacts = [
    validPhone ? `WhatsApp: ${client.phone}` : '',
    email ? `Email: ${email}` : '',
  ].filter(Boolean).join(' · ') || 'Sin canal válido';
  return `<article class="diffusion-review-card" data-diffusion-client="${client.id}">
    <div class="diffusion-review-heading">
      <div>
        <strong>${escapeHtml(client.name)}</strong>
        <small>${escapeHtml(contacts)}</small>
      </div>
      <b class="match-score ${opportunity.match.level.toLowerCase()}">${opportunity.match.score}% · ${opportunity.match.level}</b>
    </div>
    <div class="diffusion-review-reasons">
      <strong>Por qué coincide</strong>
      ${propertyMatchReasonsHtml(opportunity.match)}
    </div>
    <div class="diffusion-review-history">
      ${priorSent
        ? `<span class="opportunity-diffusion-state is-sent">✓ Ya enviada el ${formattedDate(priorSent.createdAt)} · ${escapeHtml(priorSent.diffusionChannel)}</span>`
        : '<span class="opportunity-diffusion-state is-pending">Pendiente · no enviada</span>'}
      ${responded ? `<span class="opportunity-diffusion-state is-responded">Respondió el ${formattedDate(responded.createdAt)}</span>` : ''}
    </div>
    ${diffusionChannelRows(property, client, priorSent)}
    ${priorSent ? `<div class="diffusion-after-send-actions">
      ${responded
        ? '<span class="diffusion-response-confirmed">Respuesta registrada</span>'
        : `<button type="button" class="secondary" data-mark-diffusion-response="${client.id}" data-diffusion-channel="${escapeHtml(priorSent.diffusionChannel)}">Respondió</button>`}
      <button type="button" class="secondary" data-add-diffusion-followup="${client.id}">Agregar seguimiento</button>
    </div>` : ''}
  </article>`;
}

function diffusionReviewHtml(property: Property, opportunities: PropertyOpportunity[]): string {
  if (!diffusionReviewOpen) return '';
  const selected = opportunities.filter(({ match }) => selectedClientIds.has(match.client.id));
  if (!selected.length) return '';
  const preparation = diffusionPreparing
    ? '<div class="diffusion-preparation-state" data-diffusion-preparing>Preparando la ficha pública segura…</div>'
    : diffusionPrepareError
      ? `<div class="diffusion-preparation-state is-error" data-diffusion-prepare-error role="alert">${escapeHtml(diffusionPrepareError)}</div>`
      : preparedDiffusion
        ? '<div class="diffusion-preparation-state is-ready">Ficha pública y mensaje listos. El envío sigue siendo individual y manual.</div>'
        : '';
  const message = preparedDiffusion
    ? `<label class="diffusion-message-preview"><span>Mensaje preparado</span><textarea readonly rows="5">${escapeHtml(preparedDiffusion.message)}</textarea></label>`
    : '';
  return `<section class="diffusion-review" data-diffusion-review>
    <div class="opportunity-section-heading">
      <span>3</span>
      <div><strong>Revisá la difusión antes de contactar</strong><small>Seleccionaste ${selected.length}. Abrir un canal no registra un envío; confirmalo sólo después de realizarlo.</small></div>
    </div>
    ${preparation}
    ${diffusionActionError ? `<div class="diffusion-preparation-state is-error" data-diffusion-action-error role="alert">${escapeHtml(diffusionActionError)}</div>` : ''}
    ${message}
    <div class="diffusion-review-list">${selected.map((item) => diffusionReviewCard(item, property)).join('')}</div>
  </section>`;
}

export function renderPropertyOpportunities(container: HTMLElement, onBack: () => void): void {
  const properties = visibleProperties();
  const clients = visibleClients();
  const visiblePropertyIds = new Set(properties.map((property) => property.id));
  if (selectedPropertyId !== null && !visiblePropertyIds.has(selectedPropertyId)) {
    selectedPropertyId = null;
    selectedClientIds.clear();
    resetDiffusionUi();
  }

  container.innerHTML = `<div class="property-opportunities" data-property-opportunities>
    <div class="opportunity-page-heading">
      <div><span class="opportunity-eyebrow">OPORTUNIDADES</span><h1>Buscar clientes para una propiedad</h1><p>Elegí una propiedad y ${PRODUCT_BRAND.name} te muestra los clientes compatibles según el matching actual.</p></div>
      <button type="button" class="secondary opportunity-back" data-opportunities-back>Volver a propiedades</button>
    </div>
    ${properties.length ? `<section class="opportunity-property-picker" aria-labelledby="opportunity-property-step-title">
      <div class="opportunity-property-step">
        <span class="opportunity-step-kicker">PASO 1</span>
        <h2 id="opportunity-property-step-title">Elegí la propiedad que querés trabajar</h2>
      </div>
      <div class="opportunity-property-field">
        <label class="sr-only" for="opportunity-property-select">Seleccionar propiedad</label>
        <select id="opportunity-property-select" data-opportunity-property aria-describedby="opportunity-property-note"><option value="">Seleccioná una propiedad…</option>${properties.map(propertyOption).join('')}</select>
      </div>
      <p id="opportunity-property-note" class="opportunity-property-note">${PRODUCT_BRAND.name} reutiliza el matching existente. Elegir una propiedad o seleccionar clientes no envía mensajes ni modifica el CRM.</p>
    </section>` : `<section class="opportunity-empty" data-opportunity-empty="no-properties"><strong>No hay propiedades disponibles</strong><p>Cargá o habilitá una propiedad visible antes de buscar oportunidades.</p></section>`}
    <div class="opportunity-workspace" data-opportunity-workspace></div>
  </div>`;

  container.querySelector<HTMLElement>('[data-opportunities-back]')?.addEventListener('click', onBack);
  const propertySelect = container.querySelector<HTMLSelectElement>('[data-opportunity-property]');
  const workspaceNode = container.querySelector<HTMLElement>('[data-opportunity-workspace]');
  if (!propertySelect || !workspaceNode) return;
  const workspace: HTMLElement = workspaceNode;

  let allOpportunities: PropertyOpportunity[] = [];
  let terminalClients: Client[] = [];

  const updateSelectionCount = (): void => {
    const counter = workspace.querySelector<HTMLElement>('[data-opportunity-selection-count]');
    if (counter) counter.textContent = selectionText();
    const prepare = workspace.querySelector<HTMLButtonElement>('[data-prepare-diffusion]');
    if (prepare) prepare.disabled = selectedClientIds.size === 0 || diffusionPreparing;
  };

  const bindReadNavigation = (): void => {
    workspace.querySelectorAll<HTMLButtonElement>('[data-open-opportunity-client]').forEach((button) => {
      button.addEventListener('click', () => {
        const clientId = Number(button.dataset.openOpportunityClient);
        const propertyId = selectedPropertyId;
        if (!clientId || !propertyId || !clients.some((client) => client.id === clientId)) return;
        openEntityReadOnly(
          { entityType: 'lead', entityId: clientId },
          { returnTarget: { entityType: 'property', entityId: propertyId } },
        );
      });
    });
    workspace.querySelectorAll<HTMLButtonElement>('[data-open-opportunity-property]').forEach((button) => {
      button.addEventListener('click', () => {
        const propertyId = Number(button.dataset.openOpportunityProperty);
        if (!propertyId || !properties.some((property) => property.id === propertyId)) return;
        openEntityReadOnly({ entityType: 'property', entityId: propertyId });
      });
    });
  };

  const renderResults = (): void => {
    const results = workspace.querySelector<HTMLElement>('[data-opportunity-results]');
    const terminal = workspace.querySelector<HTMLElement>('[data-opportunity-terminal]');
    if (!results || !terminal) return;
    const filtered = filterPropertyOpportunities(allOpportunities, filters);
    const latestActivities = latestActivitiesByClient(state.crm.activityLog);
    if (!allOpportunities.length) {
      results.innerHTML = `<section class="opportunity-empty" data-opportunity-empty="no-matches"><strong>Esta propiedad todavía no tiene coincidencias claras</strong><p>Hay ${clients.filter((client) => !terminalClients.some((terminalClient) => terminalClient.id === client.id)).length} clientes activos visibles, pero el motor actual no encontró compatibilidad suficiente. Revisá presupuesto, zona, tipo y demás datos de búsqueda cuando estén incompletos.</p></section>`;
    } else if (!filtered.length) {
      results.innerHTML = '<section class="opportunity-empty" data-opportunity-empty="filtered"><strong>No hay resultados con estos filtros</strong><p>Probá limpiar la búsqueda o ampliar compatibilidad y seguimiento.</p></section>';
    } else {
      results.innerHTML = filtered.map((opportunity) => opportunityCard(opportunity, latestActivities)).join('');
    }
    terminal.innerHTML = filters.status === 'all' && terminalClients.length
      ? `<details class="opportunity-terminal" open><summary>Ganados / Perdidos fuera de acción (${terminalClients.length})</summary><div>${terminalClients.map(terminalCard).join('')}</div></details>`
      : '';
    bindSelection();
    bindReadNavigation();
  };

  const renderSelectedProperty = (): void => {
    const property = properties.find((item) => item.id === selectedPropertyId);
    if (!property) {
      workspace.innerHTML = '<section class="opportunity-empty" data-opportunity-empty="select-property"><strong>Seleccioná una propiedad para empezar</strong><p>El matching se ejecutará recién cuando elijas cuál querés trabajar.</p></section>';
      return;
    }
    const issues = propertyMatchingDataIssues(property);
    if (issues.length) {
      allOpportunities = [];
      terminalClients = [];
      workspace.innerHTML = `${propertySummary(property)}<section class="opportunity-empty" data-opportunity-empty="property-data"><strong>Faltan datos para evaluar esta propiedad</strong><p>Completá ${escapeHtml(issues.join(', '))} antes de buscar clientes compatibles.</p></section>`;
      return;
    }

    allOpportunities = buildPropertyOpportunities(property, clients);
    terminalClients = terminalClientsForOpportunities(clients);
    selectedClientIds.forEach((clientId) => {
      if (!allOpportunities.some(({ match }) => match.client.id === clientId)) selectedClientIds.delete(clientId);
    });
    workspace.innerHTML = `${propertySummary(property)}
      <section class="opportunity-review">
        <div class="opportunity-section-heading"><span>2</span><div><strong>Revisá los clientes compatibles</strong><small>Filtrá la lista, entendé por qué coinciden y seleccioná únicamente a quienes quieras contactar.</small></div></div>
        ${filtersHtml()}
        <div class="opportunity-results-summary">
          <strong>${allOpportunities.length} ${allOpportunities.length === 1 ? 'cliente compatible' : 'clientes compatibles'}</strong>
          <div class="opportunity-selection-actions">
            <span data-opportunity-selection-count>${selectionText()}</span>
            <button type="button" data-prepare-diffusion${selectedClientIds.size ? '' : ' disabled'}>Preparar difusión</button>
          </div>
        </div>
        <div class="opportunity-results" data-opportunity-results></div>
        <div data-opportunity-terminal></div>
      </section>
      ${diffusionReviewHtml(property, allOpportunities)}`;
    bindFilters();
    bindDiffusionActions(property);
    renderResults();
  };

  async function prepareSelectedDiffusion(property: Property): Promise<void> {
    if (!selectedClientIds.size || diffusionPreparing) return;
    diffusionReviewOpen = true;
    diffusionPreparing = true;
    diffusionPrepareError = '';
    diffusionActionError = '';
    preparedDiffusion = null;
    renderSelectedProperty();

    let runtimeLease: TenantRuntimeLease | null = null;
    try {
      const scope = requireCurrentTenantScope();
      runtimeLease = captureTenantRuntimeLease(scope);
      assertTenantRuntimeLeaseCurrent(runtimeLease);
      assertTenantCrmScope(scope, state.crm);
      const currentProperty = (state.crm.properties as PropertyWithFicha[])
        .find((item) => item.id === property.id && (!item.uid || !property.uid || item.uid === property.uid));
      const member = authenticatedTenantMember(scope);
      if (
        !currentProperty
        || !member
        || !assignmentVisible(member.role, member.id, currentProperty.assignedToId)
      ) {
        throw new Error(TENANT_RUNTIME_STALE);
      }
      const published = await publishAndRememberPropertyFicha(
        currentProperty,
        scope,
        runtimeLease,
        'Ficha pública preparada para difusión',
      );
      assertTenantRuntimeLeaseCurrent(runtimeLease);
      assertTenantCrmScope(scope, state.crm);
      const tenantIdentity = resolveTenantCommercialIdentity({ organization: state.crm.organization });
      if (tenantIdentity.organizationId !== scope.organizationId) throw new Error(TENANT_RUNTIME_STALE);
      preparedDiffusion = {
        propertyId: currentProperty.id,
        propertyUid: currentProperty.uid,
        message: buildPropertyDiffusionMessage(currentProperty, tenantIdentity, published.url),
      };
    } catch (error) {
      if (runtimeLease && !tenantRuntimeLeaseIsCurrent(runtimeLease)) return;
      diffusionPrepareError = error instanceof Error
        ? `No se pudo preparar la difusión: ${error.message}`
        : 'No se pudo preparar la difusión.';
      preparedDiffusion = null;
    } finally {
      if (runtimeLease && !tenantRuntimeLeaseIsCurrent(runtimeLease)) return;
      diffusionPreparing = false;
      renderSelectedProperty();
    }
  }

  function recordDiffusionStatus(
    property: Property,
    clientId: number,
    channel: PropertyDiffusionChannel,
    status: 'ENVIADO' | 'RESPONDIO',
  ): void {
    const client = clients.find((item) => item.id === clientId);
    if (!client) return;
    const scope = requireCurrentTenantScope();
    const runtimeLease = captureTenantRuntimeLease(scope);
    try {
      recordPropertyDiffusionEvent({ scope, runtimeLease, property, client, channel, status });
      diffusionActionError = '';
      renderSelectedProperty();
    } catch (error) {
      if (!tenantRuntimeLeaseIsCurrent(runtimeLease)) return;
      diffusionActionError = error instanceof Error
        ? `No se pudo registrar la difusión: ${error.message}. Podés reintentar.`
        : 'No se pudo registrar la difusión. Podés reintentar.';
      renderSelectedProperty();
    }
  }

  function bindDiffusionActions(property: Property): void {
    workspace.querySelector<HTMLButtonElement>('[data-prepare-diffusion]')?.addEventListener('click', () => {
      void prepareSelectedDiffusion(property);
    });
    workspace.querySelectorAll<HTMLButtonElement>('[data-mark-diffusion-sent]').forEach((button) => {
      button.addEventListener('click', () => {
        const clientId = Number(button.dataset.markDiffusionSent);
        const channel = button.dataset.diffusionChannel as PropertyDiffusionChannel;
        if (!clientId || (channel !== 'WhatsApp' && channel !== 'Email')) return;
        recordDiffusionStatus(property, clientId, channel, 'ENVIADO');
      });
    });
    workspace.querySelectorAll<HTMLButtonElement>('[data-mark-diffusion-response]').forEach((button) => {
      button.addEventListener('click', () => {
        const clientId = Number(button.dataset.markDiffusionResponse);
        const channel = button.dataset.diffusionChannel as PropertyDiffusionChannel;
        if (!clientId || (channel !== 'WhatsApp' && channel !== 'Email')) return;
        recordDiffusionStatus(property, clientId, channel, 'RESPONDIO');
      });
    });
    workspace.querySelectorAll<HTMLButtonElement>('[data-add-diffusion-followup]').forEach((button) => {
      button.addEventListener('click', () => {
        const clientId = Number(button.dataset.addDiffusionFollowup);
        if (!clientId || !clients.some((client) => client.id === clientId)) return;
        clearReadEntityNavigation();
        state.activeModule = 'crm';
        state.editingClientId = clientId;
        state.openForms.client = true;
        document.dispatchEvent(new CustomEvent('trv-render'));
      });
    });
  }

  const bindSelection = (): void => {
    workspace.querySelectorAll<HTMLInputElement>('[data-opportunity-select]').forEach((checkbox) => {
      checkbox.addEventListener('change', () => {
        const clientId = Number(checkbox.dataset.opportunitySelect);
        if (!clientId) return;
        if (checkbox.checked) selectedClientIds.add(clientId);
        else selectedClientIds.delete(clientId);
        if (diffusionReviewOpen || preparedDiffusion) {
          resetDiffusionUi();
          renderSelectedProperty();
          return;
        }
        updateSelectionCount();
      });
    });
  };

  const bindFilters = (): void => {
    workspace.querySelector<HTMLInputElement>('[data-opportunity-search]')?.addEventListener('input', (event) => {
      filters.search = (event.currentTarget as HTMLInputElement).value;
      renderResults();
    });
    workspace.querySelector<HTMLSelectElement>('[data-opportunity-compatibility]')?.addEventListener('change', (event) => {
      filters.compatibility = (event.currentTarget as HTMLSelectElement).value as OpportunityFilters['compatibility'];
      renderResults();
    });
    workspace.querySelector<HTMLSelectElement>('[data-opportunity-followup]')?.addEventListener('change', (event) => {
      filters.followUp = (event.currentTarget as HTMLSelectElement).value as OpportunityFilters['followUp'];
      renderResults();
    });
    workspace.querySelector<HTMLSelectElement>('[data-opportunity-status]')?.addEventListener('change', (event) => {
      filters.status = (event.currentTarget as HTMLSelectElement).value as OpportunityFilters['status'];
      renderResults();
    });
  };

  propertySelect.addEventListener('change', () => {
    const nextId = Number(propertySelect.value);
    selectedPropertyId = nextId || null;
    selectedClientIds.clear();
    filters = { ...DEFAULT_OPPORTUNITY_FILTERS };
    resetDiffusionUi();
    renderSelectedProperty();
  });

  renderSelectedProperty();
}
