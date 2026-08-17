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
let observedCrm: HTMLElement | null = null;
let crmObserver: MutationObserver | null = null;
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

function clearVisualOrder(results: HTMLElement): void {
  results.querySelectorAll<HTMLElement>(':scope > [data-client-id]').forEach((card) => {
    card.style.removeProperty('order');
  });
}

function bindOrderPreference(order: HTMLSelectElement, results: HTMLElement): void {
  if (boundOrderSelectors.has(order)) return;
  boundOrderSelectors.add(order);
  order.addEventListener('change', () => {
    manualOrderSelected = true;
    clearVisualOrder(results);
    queueMicrotask(() => {
      notifyLeadsRendered();
      revealPendingLead();
    });
  });
}

function applyRecentVisualOrder(): boolean {
  if (state.activeModule !== 'crm') return false;
  const order = document.querySelector<HTMLSelectElement>('#crm.active #mvp-lead-order');
  const results = document.querySelector<HTMLElement>('#crm.active #mvp-lead-results');
  if (!order || !results) return false;
  bindOrderPreference(order, results);
  if (manualOrderSelected) return true;

  const rank = new Map(sortLeads(visibleClients(), 'recent').map((client, index) => [client.id, index] as const));
  results.querySelectorAll<HTMLElement>(':scope > [data-client-id]').forEach((card) => {
    const position = rank.get(Number(card.dataset.clientId));
    if (position === undefined) card.style.removeProperty('order');
    else card.style.order = String(position);
  });
  return true;
}

function ensureResultsObserver(): void {
  const results = document.querySelector<HTMLElement>('#crm #mvp-lead-results');
  if (!results || results === observedResults) return;
  resultsObserver?.disconnect();
  observedResults = results;
  resultsObserver = new MutationObserver(() => queueMicrotask(synchronizeUi));
  resultsObserver.observe(results, { childList: true });
}

function ensureCrmObserver(): void {
  const crm = document.querySelector<HTMLElement>('#crm');
  if (!crm || crm === observedCrm) return;
  crmObserver?.disconnect();
  observedCrm = crm;
  crmObserver = new MutationObserver(() => queueMicrotask(synchronizeUi));
  crmObserver.observe(crm, { childList: true });
}

function bootstrapRecentOrder(attempt = 0): void {
  if (applyRecentVisualOrder() || attempt >= 120) {
    ensureResultsObserver();
    ensureCrmObserver();
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
  applyRecentVisualOrder();
  ensureResultsObserver();
  ensureCrmObserver();
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
