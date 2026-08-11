const MOBILE_QUERY = '(max-width: 720px)';
const DESKTOP_QUERY = '(min-width: 901px)';
const INSTALL_FLAG = '__pcLeadsBlockingFixInstalled';
const boundFilterDetails = new WeakSet<HTMLDetailsElement>();

let filterPanelOpen = false;
let desktopFilterPanelOpen = false;
let synchronizationScheduled = false;
let initialPreparationFrame: number | null = null;
let initialEnhancementSignalSent = false;

interface BlockingFixWindow extends Window {
  [INSTALL_FLAG]?: boolean;
}

function isMobile(): boolean {
  return window.matchMedia(MOBILE_QUERY).matches;
}

function isDesktop(): boolean {
  return window.matchMedia(DESKTOP_QUERY).matches;
}

function setInteractiveRegion(element: HTMLElement | null, enabled: boolean): void {
  if (!element) return;
  element.hidden = !enabled;
  element.toggleAttribute('aria-hidden', !enabled);
  (element as HTMLElement & { inert: boolean }).inert = !enabled;
}

function applyFilterInteractionState(details: HTMLDetailsElement, enabled: boolean): void {
  setInteractiveRegion(details.querySelector<HTMLElement>('.mvp-lead-filter-grid'), enabled);
  setInteractiveRegion(details.querySelector<HTMLElement>('.mvp-lead-filter-toggles'), enabled);
  setInteractiveRegion(details.querySelector<HTMLElement>('[data-pc-filter-actions]'), enabled);
  details.classList.toggle('pc-filter-panel-open', isMobile() && enabled);
  details.querySelector<HTMLElement>(':scope > summary')?.setAttribute('aria-expanded', String(enabled));
}

function activeDesktopFilterCount(crm: HTMLElement): number {
  let count = 0;
  const stage = crm.querySelector<HTMLSelectElement>('#mvp-lead-stage-filter')?.value;
  const temperature = crm.querySelector<HTMLSelectElement>('#mvp-lead-temperature-filter')?.value;
  const assignee = crm.querySelector<HTMLSelectElement>('#mvp-lead-assignee-filter')?.value;
  const order = crm.querySelector<HTMLSelectElement>('#mvp-lead-order')?.value;
  if (stage && stage !== 'Todas') count += 1;
  if (temperature && temperature !== 'Todas') count += 1;
  if (assignee && assignee !== 'Todos') count += 1;
  if (order && order !== 'priority') count += 1;
  if (crm.querySelector<HTMLInputElement>('#mvp-lead-overdue-filter')?.checked) count += 1;
  if (crm.querySelector<HTMLInputElement>('#mvp-lead-missing-action-filter')?.checked) count += 1;
  return count;
}

function synchronizeDesktopFilterSummary(details: HTMLDetailsElement, active: number): void {
  const summary = details.querySelector<HTMLElement>(':scope > summary');
  if (!summary) return;
  const label = summary.querySelector<HTMLElement>('span');
  const helper = summary.querySelector<HTMLElement>('small');
  if (label) label.textContent = active ? `Filtros (${active})` : 'Filtros';
  if (helper) helper.textContent = active ? 'Revisá o ajustá los filtros activos' : 'Etapa, temperatura, responsable y orden';
  summary.setAttribute('aria-label', active ? `Filtros. ${active} activos` : 'Filtros');
}

function bindFilterDisclosure(details: HTMLDetailsElement): void {
  if (boundFilterDetails.has(details)) return;
  boundFilterDetails.add(details);
  const summary = details.querySelector<HTMLElement>(':scope > summary');
  summary?.addEventListener('click', (event) => {
    if (event.defaultPrevented) return;
    const requestedOpen = !details.open;
    if (isMobile()) filterPanelOpen = requestedOpen;
    else if (isDesktop()) desktopFilterPanelOpen = requestedOpen;
  });
  details.addEventListener('toggle', () => {
    if (!details.isConnected) return;
    if (!details.open) {
      if (isMobile()) filterPanelOpen = false;
      if (isDesktop()) desktopFilterPanelOpen = false;
    }
    applyFilterInteractionState(details, (!isMobile() && !isDesktop()) || details.open);
  });
}

function synchronizeFilterPanel(crm: HTMLElement): void {
  const details = crm.querySelector<HTMLDetailsElement>('.mvp-lead-more-filters');
  if (!details) return;
  bindFilterDisclosure(details);

  if (isMobile()) {
    desktopFilterPanelOpen = false;
    if (details.open !== filterPanelOpen) details.open = filterPanelOpen;
    applyFilterInteractionState(details, details.open);
    return;
  }

  if (isDesktop()) {
    filterPanelOpen = false;
    const active = activeDesktopFilterCount(crm);
    synchronizeDesktopFilterSummary(details, active);
    if (details.open !== desktopFilterPanelOpen) details.open = desktopFilterPanelOpen;
    applyFilterInteractionState(details, desktopFilterPanelOpen);
    return;
  }

  filterPanelOpen = false;
  desktopFilterPanelOpen = false;
  details.open = true;
  applyFilterInteractionState(details, true);
}

function synchronizeSelectedStage(crm: HTMLElement): void {
  const stageSelect = crm.querySelector<HTMLSelectElement>('#mvp-lead-stage-filter');
  const selectedStage = stageSelect?.value ?? 'Todas';
  crm.querySelectorAll<HTMLButtonElement>('[data-stage-quick]').forEach((button) => {
    const active = button.dataset.stageQuick === selectedStage || button.classList.contains('active');
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
    button.classList.toggle('pc-selected-stage', active);
    if (active) button.hidden = false;
  });
}

function synchronizeDesktopPriorities(crm: HTMLElement): void {
  crm.querySelectorAll<HTMLButtonElement>('[data-pc-attention]').forEach((button) => {
    const count = Number(button.querySelector('b')?.textContent?.trim() ?? '0');
    button.dataset.pcActionable = String(Number.isFinite(count) && count > 0);
  });
}

function synchronizeDesktopStageSummary(crm: HTMLElement): void {
  const desktop = isDesktop();
  const attentionLabel = crm.querySelector<HTMLElement>('[data-pc-attention-section] .pc-section-heading > div > span');
  const pipelineLabel = crm.querySelector<HTMLElement>('[data-pc-stage-heading] > div > span');
  if (attentionLabel) attentionLabel.textContent = desktop ? 'Prioridades' : 'Prioridades comerciales';
  if (pipelineLabel) pipelineLabel.textContent = desktop ? 'Pipeline' : 'Pipeline comercial';
  if (!desktop) return;

  const shell = crm.querySelector<HTMLElement>('[data-stage-shell]');
  const counters = shell?.querySelector<HTMLElement>('.mvp-stage-counters');
  if (!shell || !counters) return;

  if (shell.dataset.expanded === 'true') return;
  const collapsedOrder = ['Todas', 'Nuevo', 'Contactado', 'Visita coordinada', 'Calificado', 'Negociación', 'Reservado', 'Ganado', 'Perdido'];
  const byStage = new Map(Array.from(counters.querySelectorAll<HTMLButtonElement>('[data-stage-quick]'))
    .map((button) => [button.dataset.stageQuick ?? '', button]));
  collapsedOrder.forEach((stage) => {
    const button = byStage.get(stage);
    if (button?.parentElement === counters) counters.append(button);
  });
  counters.scrollLeft = 0;
}

function synchronizeFormGeometry(crm: HTMLElement): void {
  const form = crm.querySelector<HTMLFormElement>('#mvp-lead-form');
  if (!form) return;
  const open = !form.classList.contains('collapsed');
  form.toggleAttribute('aria-hidden', !open);
  (form as HTMLFormElement & { inert: boolean }).inert = !open;
  if (!open) return;

  form.classList.add('pc-lead-dialog');
  form.setAttribute('role', 'dialog');
  form.setAttribute('aria-modal', 'true');
  form.querySelector<HTMLElement>('.b131-lead-form-fields')?.setAttribute('tabindex', '-1');
}

export function prepareLeadsProfessionalRedesign(crm: HTMLElement): void {
  if (!crm.querySelector('#mvp-lead-results')) return;
  crm.classList.add('pc-leads-redesign');
  synchronizeFilterPanel(crm);
  synchronizeSelectedStage(crm);
  synchronizeDesktopPriorities(crm);
  synchronizeDesktopStageSummary(crm);
  synchronizeFormGeometry(crm);
}

function synchronizeRedesign(): boolean {
  synchronizationScheduled = false;
  const crm = document.querySelector<HTMLElement>('#crm');
  if (!crm?.querySelector('#mvp-lead-results')) return false;
  prepareLeadsProfessionalRedesign(crm);
  return true;
}

function scheduleSynchronization(): void {
  if (synchronizationScheduled) return;
  synchronizationScheduled = true;
  window.requestAnimationFrame(() => window.requestAnimationFrame(synchronizeRedesign));
}

function scheduleSynchronizationAfterCurrentEvent(): void {
  queueMicrotask(scheduleSynchronization);
}

function prepareInitialLeadsBeforePaint(): void {
  initialPreparationFrame = null;
  const crm = document.querySelector<HTMLElement>('#crm');
  if (crm?.querySelector('#mvp-lead-results')) {
    prepareLeadsProfessionalRedesign(crm);
    if (!initialEnhancementSignalSent) {
      initialEnhancementSignalSent = true;
      document.dispatchEvent(new CustomEvent('trv-render'));
    }
    scheduleSynchronization();
    return;
  }
  if (location.pathname !== '/' && location.pathname !== '') return;
  initialPreparationFrame = window.requestAnimationFrame(prepareInitialLeadsBeforePaint);
}

function closeMobileFilters(): void {
  if (!isMobile()) return;
  filterPanelOpen = false;
  const details = document.querySelector<HTMLDetailsElement>('#crm .mvp-lead-more-filters');
  if (!details) return;
  details.open = false;
  applyFilterInteractionState(details, false);
}

function closeDesktopFilters(): void {
  if (!isDesktop()) return;
  desktopFilterPanelOpen = false;
  const details = document.querySelector<HTMLDetailsElement>('#crm .mvp-lead-more-filters');
  if (!details) return;
  details.open = false;
  applyFilterInteractionState(details, false);
}

function install(): void {
  if (typeof document === 'undefined') return;
  const globalWindow = window as BlockingFixWindow;
  if (globalWindow[INSTALL_FLAG]) return;
  globalWindow[INSTALL_FLAG] = true;

  document.addEventListener('trv-render', scheduleSynchronization);
  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('[data-account-toggle]')) closeMobileFilters();
    if (target.closest('[data-pc-apply-filters]')) {
      closeMobileFilters();
      closeDesktopFilters();
    }
    if (isDesktop() && target.closest('[data-pc-clear-filters], [data-clear-lead-filters]')) closeDesktopFilters();
    if (target.closest('#crm')) scheduleSynchronizationAfterCurrentEvent();
  }, true);
  document.addEventListener('change', scheduleSynchronization);
  document.addEventListener('input', scheduleSynchronization);
  window.addEventListener('resize', scheduleSynchronization);
  window.matchMedia(MOBILE_QUERY).addEventListener('change', () => {
    filterPanelOpen = false;
    scheduleSynchronization();
  });
  window.matchMedia(DESKTOP_QUERY).addEventListener('change', () => {
    desktopFilterPanelOpen = false;
    scheduleSynchronization();
  });

  if (initialPreparationFrame === null) initialPreparationFrame = window.requestAnimationFrame(prepareInitialLeadsBeforePaint);
}

install();