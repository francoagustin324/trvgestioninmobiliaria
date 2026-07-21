import { matchClientsForProperty, type PropertyMatch } from './property-matching.js';
import { state } from './store.js';
import { visibleClients, visibleProperties } from './team-access.js';
import { escapeHtml } from './utils.js';

let enhancementQueued = false;
let observer: MutationObserver | null = null;

function matchRow(match: PropertyMatch): string {
  const reasons = match.reasons.slice(0, 3);
  const warning = match.warnings[0];
  return `<article class="mvp-buyer-match-row">
    <div class="mvp-buyer-match-main">
      <div class="mvp-buyer-match-title"><strong>${escapeHtml(match.client.name)}</strong><span>${escapeHtml(match.client.budget || 'Sin presupuesto')}</span></div>
      <p>${escapeHtml(match.client.interest || 'Sin búsqueda definida')}</p>
      <div class="mvp-property-meta">${reasons.map((reason) => `<span>${escapeHtml(reason)}</span>`).join('')}</div>
      ${warning ? `<small>${escapeHtml(warning)}</small>` : ''}
    </div>
    <div class="mvp-buyer-match-actions">
      <b class="mvp-match-score ${match.level.toLowerCase()}">${match.score}%</b>
      <button type="button" class="secondary" data-open-match-client="${match.client.id}">Abrir lead</button>
    </div>
  </article>`;
}

function buyersForProperty(propertyId: number): string {
  const property = visibleProperties().find((item) => item.id === propertyId);
  if (!property) return '';
  const clients = visibleClients();
  if (!clients.length) return '<p class="mvp-buyer-match-empty">Todavía no hay leads visibles para comparar.</p>';
  const matches = matchClientsForProperty(property, clients).slice(0, 3);
  if (!matches.length) return '<p class="mvp-buyer-match-empty">No hay compradores claramente compatibles.</p>';
  const best = matches[0]!;
  return `<details class="mvp-property-buyers" data-property-buyers>
    <summary><span>${matches.length} ${matches.length === 1 ? 'comprador compatible' : 'compradores compatibles'}</span><strong>${best.score}% mejor coincidencia</strong></summary>
    <div class="mvp-buyer-match-list">${matches.map(matchRow).join('')}</div>
  </details>`;
}

function propertyIdFromCard(card: HTMLElement): number | null {
  const source = card.querySelector<HTMLElement>('[data-edit-property]');
  const propertyId = Number(source?.dataset.editProperty);
  return Number.isInteger(propertyId) && propertyId > 0 ? propertyId : null;
}

function enhancePropertyCards(): void {
  document.querySelectorAll<HTMLElement>('.mvp-property-card').forEach((card) => {
    if (card.querySelector('[data-property-buyers], .mvp-buyer-match-empty')) return;
    const propertyId = propertyIdFromCard(card);
    if (!propertyId) return;
    const html = buyersForProperty(propertyId);
    if (!html) return;
    card.insertAdjacentHTML('beforeend', html);
  });
}

function scheduleEnhancement(): void {
  if (enhancementQueued) return;
  enhancementQueued = true;
  window.requestAnimationFrame(() => {
    enhancementQueued = false;
    enhancePropertyCards();
  });
}

function openMatchedLead(clientId: number): void {
  if (!visibleClients().some((client) => client.id === clientId)) return;
  state.activeModule = 'crm';
  state.editingClientId = clientId;
  state.openForms.client = true;
  document.dispatchEvent(new CustomEvent('trv-render'));
  window.requestAnimationFrame(() => document.querySelector('#mvp-lead-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

function setup(): void {
  const root = document.querySelector('#root');
  if (root && !observer) {
    observer = new MutationObserver(scheduleEnhancement);
    observer.observe(root, { childList: true, subtree: true });
  }
  document.addEventListener('trv-render', scheduleEnhancement);
  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-open-match-client]') : null;
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    openMatchedLead(Number(target.dataset.openMatchClient));
  });
  scheduleEnhancement();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup, { once: true });
else setup();
