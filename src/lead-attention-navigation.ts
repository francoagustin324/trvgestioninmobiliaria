import type { LeadAttentionRecommendation } from './lead-attention-queue.js';

export const ATTENTION_HIDDEN_BY_FILTERS_MESSAGE = 'Este lead está oculto por los filtros actuales. Ajustá o limpiá los filtros para verlo.';

const attentionNavigationBindings = new WeakSet<HTMLElement>();

function navigationStatus(container: HTMLElement): HTMLElement {
  let status = container.querySelector<HTMLElement>('[data-attention-navigation-status]');
  if (!status) {
    status = document.createElement('p');
    status.className = 'pc-supervised-attention-status';
    status.dataset.attentionNavigationStatus = '';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.hidden = true;
  }
  const queue = container.querySelector<HTMLElement>('[data-supervised-attention-queue]');
  if (queue && status.previousElementSibling !== queue) queue.insertAdjacentElement('afterend', status);
  return status;
}

function setNavigationStatus(container: HTMLElement, message: string): void {
  const status = navigationStatus(container);
  status.textContent = message;
  status.hidden = !message;
}

function visibleLeadCard(card: HTMLElement): boolean {
  if (card.hidden) return false;
  const computedStyle = getComputedStyle(card);
  return computedStyle.display !== 'none'
    && computedStyle.visibility !== 'hidden'
    && card.getClientRects().length > 0;
}

export type AttentionLeadNavigationResult = 'opened' | 'hidden-by-filters' | 'not-found';

export function openSupervisedAttentionLead(
  container: HTMLElement,
  clientId: LeadAttentionRecommendation['clientId'],
): AttentionLeadNavigationResult {
  const card = container.querySelector<HTMLElement>(`.mvp-lead-card[data-client-id="${clientId}"]`);
  if (!card) {
    setNavigationStatus(container, ATTENTION_HIDDEN_BY_FILTERS_MESSAGE);
    return 'not-found';
  }
  if (!visibleLeadCard(card)) {
    setNavigationStatus(container, ATTENTION_HIDDEN_BY_FILTERS_MESSAGE);
    return 'hidden-by-filters';
  }

  const details = card.querySelector<HTMLDetailsElement>(`details[data-lead-full-sheet="${clientId}"]`);
  if (!details) {
    setNavigationStatus(container, 'No se pudo abrir la ficha completa de este lead.');
    return 'not-found';
  }

  details.open = true;
  container.querySelectorAll<HTMLElement>('.mvp-lead-card.pc-attention-focus-target')
    .forEach((item) => item.classList.remove('pc-attention-focus-target'));
  card.classList.add('pc-attention-focus-target');
  card.tabIndex = -1;
  card.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
  card.focus({ preventScroll: true });
  setNavigationStatus(container, '');
  return 'opened';
}

export function bindSupervisedAttentionLeadNavigation(container: HTMLElement): void {
  if (attentionNavigationBindings.has(container)) return;
  attentionNavigationBindings.add(container);
  container.addEventListener('click', (event) => {
    const origin = event.target instanceof Element ? event.target : null;
    const trigger = origin?.closest<HTMLButtonElement>('.pc-supervised-attention-item[data-attention-client-id]');
    if (!trigger || !container.contains(trigger)) return;
    const clientId = Number(trigger.dataset.attentionClientId || 0);
    if (!Number.isFinite(clientId) || clientId <= 0) return;
    openSupervisedAttentionLead(container, clientId);
  });
}
