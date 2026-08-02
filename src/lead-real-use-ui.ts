import { setLeadActivitySource } from './lead-list-priority.js';
import { state } from './store.js';

let installed = false;
let defaultOrderApplied = false;
let knownClientIds = new Set<number>();
let pendingRevealId: number | null = null;
let highlightTimer = 0;
let pendingNoticeTimer = 0;

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

function applyDefaultRecentOrder(): boolean {
  if (defaultOrderApplied) return true;
  if (state.activeModule !== 'crm') return false;
  const order = document.querySelector<HTMLSelectElement>('#crm.active #mvp-lead-order');
  if (!order) return false;
  defaultOrderApplied = true;
  if (order.value !== 'recent') {
    order.value = 'recent';
    order.dispatchEvent(new Event('change', { bubbles: true }));
  }
  return true;
}

function bootstrapRecentOrder(attempt = 0): void {
  if (applyDefaultRecentOrder() || attempt >= 120) return;
  window.requestAnimationFrame(() => bootstrapRecentOrder(attempt + 1));
}

function recentlyCreated(clientId: number): boolean {
  const now = Date.now();
  return state.crm.activityLog.some((entry) => {
    if (entry.entityType !== 'Cliente' || entry.entityId !== clientId || entry.action !== 'Lead creado') return false;
    const createdAt = Date.parse(entry.createdAt);
    return Number.isFinite(createdAt) && Math.abs(now - createdAt) <= 15_000;
  });
}

function detectNewClients(): void {
  const currentIds = new Set(state.crm.clients.map((client) => client.id));
  const additions = [...currentIds].filter((id) => !knownClientIds.has(id) && recentlyCreated(id));
  knownClientIds = currentIds;
  if (additions.length) pendingRevealId = Math.max(...additions);
}

function keepPendingNoticeVisible(message: string): void {
  if (!/guardado localmente, sincronizaci[oó]n pendiente/i.test(message)) return;
  const notice = document.querySelector<HTMLElement>('#notice');
  if (!notice) return;
  const until = Date.now() + 12_000;
  window.clearInterval(pendingNoticeTimer);
  pendingNoticeTimer = window.setInterval(() => {
    const current = document.querySelector<HTMLElement>('#notice');
    if (!current || Date.now() >= until) {
      window.clearInterval(pendingNoticeTimer);
      return;
    }
    current.textContent = message;
    current.hidden = false;
  }, 250);
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
  document.addEventListener('propcontrol-cloud-status', (event) => {
    const message = (event as CustomEvent<{ message?: string }>).detail?.message || '';
    keepPendingNoticeVisible(message);
    queueMicrotask(revealPendingLead);
  });
  window.addEventListener('pageshow', () => queueMicrotask(synchronizeUi));
  queueMicrotask(synchronizeUi);
  bootstrapRecentOrder();
}

install();
