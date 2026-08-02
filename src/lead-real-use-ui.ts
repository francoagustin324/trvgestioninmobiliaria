import { setLeadActivitySource, sortLeads } from './lead-list-priority.js';
import { state } from './store.js';
import { visibleClients } from './team-access.js';

let installed = false;
let baselineEstablished = false;
let manualOrderSelected = false;
let knownClientIds = new Set<number>();
let pendingRevealId: number | null = null;
let highlightTimer = 0;
let pendingNoticeTimer = 0;
let observedResults: HTMLElement | null = null;
let resultsObserver: MutationObserver | null = null;
let reordering = false;
const boundOrderSelectors = new WeakSet<HTMLSelectElement>();

function visibleCard(clientId: number): HTMLElement | null {
  return document.querySelector<HTMLElement>(`#crm.active [data-client-id="${clientId}"]`);
}

function notifyLeadsRendered(): void {
  document.dispatchEvent(new CustomEvent('propcontrol-leads-rendered'));
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

function bindOrderPreference(order: HTMLSelectElement): void {
  if (boundOrderSelectors.has(order)) return;
  boundOrderSelectors.add(order);
  order.addEventListener('change', () => {
    manualOrderSelected = true;
    queueMicrotask(() => {
      notifyLeadsRendered();
      revealPendingLead();
    });
  });
}

function applyRecentDomOrder(): boolean {
  if (state.activeModule !== 'crm') return false;
  const order = document.querySelector<HTMLSelectElement>('#crm.active #mvp-lead-order');
  const results = document.querySelector<HTMLElement>('#crm.active #mvp-lead-results');
  if (!order || !results) return false;
  bindOrderPreference(order);
  if (manualOrderSelected) return true;

  order.value = 'recent';
  const cards = new Map(
    [...results.querySelectorAll<HTMLElement>('[data-client-id]')]
      .map((card) => [Number(card.dataset.clientId), card] as const),
  );
  reordering = true;
  sortLeads(visibleClients(), 'recent').forEach((client) => {
    const card = cards.get(client.id);
    if (card) results.append(card);
  });
  queueMicrotask(() => { reordering = false; });
  return true;
}

function ensureResultsObserver(): void {
  const results = document.querySelector<HTMLElement>('#crm #mvp-lead-results');
  if (!results || results === observedResults) return;
  resultsObserver?.disconnect();
  observedResults = results;
  resultsObserver = new MutationObserver(() => {
    if (reordering) return;
    queueMicrotask(synchronizeUi);
  });
  resultsObserver.observe(results, { childList: true });
}

function bootstrapRecentOrder(attempt = 0): void {
  if (applyRecentDomOrder() || attempt >= 120) {
    ensureResultsObserver();
    notifyLeadsRendered();
    revealPendingLead();
    return;
  }
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
  if (!baselineEstablished) {
    knownClientIds = currentIds;
    baselineEstablished = true;
    return;
  }
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
  applyRecentDomOrder();
  ensureResultsObserver();
  notifyLeadsRendered();
  window.requestAnimationFrame(revealPendingLead);
}

function install(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  setLeadActivitySource(() => state.crm.activityLog);
  document.addEventListener('trv-render', () => queueMicrotask(synchronizeUi));
  document.addEventListener('propcontrol-cloud-status', (event) => {
    const message = (event as CustomEvent<{ message?: string }>).detail?.message || '';
    keepPendingNoticeVisible(message);
    queueMicrotask(synchronizeUi);
  });
  window.addEventListener('pageshow', () => queueMicrotask(synchronizeUi));
  queueMicrotask(synchronizeUi);
  bootstrapRecentOrder();
}

install();
