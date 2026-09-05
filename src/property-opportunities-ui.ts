import { commercialStage } from './lead-pipeline.js';
import type { ActivityEntry, Client, Property } from './models.js';
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
import { state } from './store.js';
import { visibleClients, visibleProperties } from './team-access.js';
import { escapeHtml } from './utils.js';

const usdFormatter = new Intl.NumberFormat('es-AR');
const dateFormatter = new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'short', year: 'numeric' });

let selectedPropertyId: number | null = null;
let filters: OpportunityFilters = { ...DEFAULT_OPPORTUNITY_FILTERS };
const selectedClientIds = new Set<number>();

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

function opportunityCard(
  opportunity: PropertyOpportunity,
  latestActivities: Map<number, ActivityEntry>,
): string {
  const { match } = opportunity;
  const client = match.client;
  const selected = selectedClientIds.has(client.id);
  const stage = commercialStage(client);
  return `<article class="property-opportunity-card" data-opportunity-client="${client.id}">
    <label class="opportunity-selector">
      <input type="checkbox" data-opportunity-select="${client.id}"${selected ? ' checked' : ''}>
      <span class="sr-only">Seleccionar ${escapeHtml(client.name)}</span>
    </label>
    <div class="opportunity-main">
      <div class="opportunity-heading">
        <div>
          <strong class="opportunity-client-name">${escapeHtml(client.name)}</strong>
          ${client.phone ? `<a class="opportunity-phone" href="tel:${escapeHtml(client.phone)}">${escapeHtml(client.phone)}</a>` : '<span class="opportunity-phone muted">Sin teléfono visible</span>'}
        </div>
        <div class="opportunity-badges">
          <span class="opportunity-stage">${escapeHtml(stage)}</span>
          <b class="match-score ${match.level.toLowerCase()}">${match.score}% · ${match.level}</b>
        </div>
      </div>
      <div class="opportunity-requirements">
        <div class="opportunity-requirements-title"><strong>Por qué coincide</strong><small>✓ Cumple · ⚠ A revisar / no cumple plenamente</small></div>
        ${propertyMatchReasonsHtml(match)}
      </div>
      <div class="opportunity-commercial-context">
        ${followUpHtml(client)}
        ${activityHtml(latestActivities.get(client.id))}
      </div>
      <div class="opportunity-card-actions">
        <button type="button" class="secondary" data-edit-client="${client.id}">Abrir cliente</button>
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
  return `<article class="opportunity-property-summary">
    <div><span>Propiedad seleccionada</span><strong>${escapeHtml(property.title)}</strong><p>${escapeHtml(property.address)} · ${escapeHtml(property.type)}${bedrooms}</p></div>
    <b>USD ${usdFormatter.format(property.price)}</b>
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

export function renderPropertyOpportunities(container: HTMLElement, onBack: () => void): void {
  const properties = visibleProperties();
  const clients = visibleClients();
  const visiblePropertyIds = new Set(properties.map((property) => property.id));
  if (selectedPropertyId !== null && !visiblePropertyIds.has(selectedPropertyId)) {
    selectedPropertyId = null;
    selectedClientIds.clear();
  }

  container.innerHTML = `<div class="property-opportunities" data-property-opportunities>
    <div class="opportunity-page-heading">
      <div><span class="opportunity-eyebrow">OPORTUNIDADES</span><h1>Propiedad → clientes</h1><p>Elegí una propiedad y revisá los clientes que el matching actual considera compatibles.</p></div>
      <button type="button" class="secondary" data-opportunities-back>Volver a propiedades</button>
    </div>
    ${properties.length ? `<section class="opportunity-property-picker">
      <label><span>Propiedad</span><select data-opportunity-property><option value="">Seleccionar propiedad</option>${properties.map(propertyOption).join('')}</select></label>
      <p>PropControl reutiliza el matching existente. Esta selección no envía mensajes ni modifica clientes.</p>
    </section>` : `<section class="opportunity-empty" data-opportunity-empty="no-properties"><strong>No hay propiedades disponibles</strong><p>Cargá o habilitá una propiedad visible antes de buscar oportunidades.</p></section>`}
    <div data-opportunity-workspace></div>
  </div>`;

  container.querySelector<HTMLElement>('[data-opportunities-back]')?.addEventListener('click', onBack);
  const propertySelect = container.querySelector<HTMLSelectElement>('[data-opportunity-property]');
  const workspace = container.querySelector<HTMLElement>('[data-opportunity-workspace]');
  if (!propertySelect || !workspace) return;

  let allOpportunities: PropertyOpportunity[] = [];
  let terminalClients: Client[] = [];
  const latestActivities = latestActivitiesByClient(state.crm.activityLog);

  const updateSelectionCount = (): void => {
    const counter = workspace.querySelector<HTMLElement>('[data-opportunity-selection-count]');
    if (counter) counter.textContent = selectionText();
  };

  const bindSelection = (): void => {
    workspace.querySelectorAll<HTMLInputElement>('[data-opportunity-select]').forEach((checkbox) => {
      checkbox.addEventListener('change', () => {
        const clientId = Number(checkbox.dataset.opportunitySelect);
        if (!clientId) return;
        if (checkbox.checked) selectedClientIds.add(clientId);
        else selectedClientIds.delete(clientId);
        updateSelectionCount();
      });
    });
  };

  const renderResults = (): void => {
    const results = workspace.querySelector<HTMLElement>('[data-opportunity-results]');
    const terminal = workspace.querySelector<HTMLElement>('[data-opportunity-terminal]');
    if (!results || !terminal) return;
    const filtered = filterPropertyOpportunities(allOpportunities, filters);
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

  const renderSelectedProperty = (): void => {
    const property = properties.find((item) => item.id === selectedPropertyId);
    if (!property) {
      workspace.innerHTML = '<section class="opportunity-empty" data-opportunity-empty="select-property"><strong>Seleccioná una propiedad</strong><p>El matching se ejecutará recién cuando elijas cuál querés trabajar.</p></section>';
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
        ${filtersHtml()}
        <div class="opportunity-results-summary"><strong>${allOpportunities.length} ${allOpportunities.length === 1 ? 'cliente compatible' : 'clientes compatibles'}</strong><span data-opportunity-selection-count>${selectionText()}</span></div>
        <div class="opportunity-results" data-opportunity-results></div>
        <div data-opportunity-terminal></div>
      </section>`;
    bindFilters();
    renderResults();
  };

  propertySelect.addEventListener('change', () => {
    const nextId = Number(propertySelect.value);
    selectedPropertyId = nextId || null;
    selectedClientIds.clear();
    filters = { ...DEFAULT_OPPORTUNITY_FILTERS };
    renderSelectedProperty();
  });

  renderSelectedProperty();
}
