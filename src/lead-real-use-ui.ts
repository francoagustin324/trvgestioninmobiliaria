import { setLeadActivitySource } from './lead-list-priority.js';
import { state } from './store.js';

let installed = false;
let defaultOrderApplied = false;
let knownClientIds = new Set<number>();
let pendingRevealId: number | null = null;
let highlightTimer = 0;

function visibleCard(clientId: number): HTMLElement | null {
  return document.querySelector<HTMLElement>(`#crm.active [data-client-id="${clientId}"]`);
}

function revealPendingLead(): void {
  if (!pendingRevealId || state.activeModule !== 'crm') return;
  const card = visibleCard(pendingRevealId);
  if (!card) return;
  card.classList.add('b133-new-lead-highlight');
  card.setAttribute('data-new-lead-visible', 'true');
  card.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
  window.clearTimeout(highlightTimer);
  highlightTimer = window.setTimeout(() => {
    card.classList.remove('b133-new-lead-highlight');
    card.removeAttribute('data-new-lead-visible');
  }, 4_500);
  pendingRevealId = null;
}

function applyDefaultRecentOrder(): void {
  if (defaultOrderApplied || state.activeModule !== 'crm') return;
  const order = document.querySelector<HTMLSelectElement>('#crm.active #mvp-lead-order');
  if (!order) return;
  defaultOrderApplied = true;
  if (order.value !== 'recent') {
    order.value = 'recent';
    order.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

function detectNewClients(): void {
  const currentIds = new Set(state.crm.clients.map((client) => client.id));
  const additions = [...currentIds].filter((id) => !knownClientIds.has(id));
  knownClientIds = currentIds;
  if (additions.length) pendingRevealId = Math.max(...additions);
}

function synchronizeUi(): void {
  detectNewClients();
  applyDefaultRecentOrder();
  window.requestAnimationFrame(revealPendingLead);
}

function install(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  knownClientIds = new Set(state.crm.clients.map((client) => client.id));
  setLeadActivitySource(() => state.crm.activityLog);
  document.addEventListener('trv-render', () => queueMicrotask(synchronizeUi));
  document.addEventListener('propcontrol-cloud-status', () => queueMicrotask(revealPendingLead));
  window.addEventListener('pageshow', () => queueMicrotask(synchronizeUi));
  queueMicrotask(synchronizeUi);
}

install();
