const MOBILE_QUERY = '(max-width: 720px)';
const INSTALL_FLAG = '__pcLeadsBlockingFixInstalled';
const boundFilterDetails = new WeakSet<HTMLDetailsElement>();

let filterPanelOpen = false;
let synchronizationScheduled = false;
let initialPreparationFrame: number | null = null;
let initialEnhancementSignalSent = false;

interface BlockingFixWindow extends Window {
  [INSTALL_FLAG]?: boolean;
}

function isMobile(): boolean {
  return window.matchMedia(MOBILE_QUERY).matches;
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

function synchronizeFilterPanel(crm: HTMLElement): void {
  const details = crm.querySelector<HTMLDetailsElement>('.mvp-lead-more-filters');
  if (!details) return;

  if (!boundFilterDetails.has(details)) {
    boundFilterDetails.add(details);
    details.addEventListener('toggle', () => {
      if (!details.isConnected) return;
      if (isMobile()) filterPanelOpen = details.open;
      applyFilterInteractionState(details, !isMobile() || details.open);
    });
  }

  if (!isMobile()) {
    filterPanelOpen = false;
    details.open = true;
    applyFilterInteractionState(details, true);
    return;
  }

  if (details.open !== filterPanelOpen) details.open = filterPanelOpen;
  applyFilterInteractionState(details, details.open);
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
  window.requestAnimationFrame(synchronizeRedesign);
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
    if (crm.querySelector('[data-pc-attention-section]')) return;
  } else if (location.pathname !== '/' && location.pathname !== '') {
    return;
  }
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

function install(): void {
  if (typeof document === 'undefined') return;
  const globalWindow = window as BlockingFixWindow;
  if (globalWindow[INSTALL_FLAG]) return;
  globalWindow[INSTALL_FLAG] = true;

  document.addEventListener('trv-render', scheduleSynchronization);
  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('[data-account-toggle], [data-pc-apply-filters]')) closeMobileFilters();
  }, true);
  document.addEventListener('change', scheduleSynchronization);
  document.addEventListener('input', scheduleSynchronization);
  window.addEventListener('resize', scheduleSynchronization);
  window.matchMedia(MOBILE_QUERY).addEventListener('change', () => {
    filterPanelOpen = false;
    scheduleSynchronization();
  });

  if (initialPreparationFrame === null) {
    initialPreparationFrame = window.requestAnimationFrame(prepareInitialLeadsBeforePaint);
  }
}

install();
