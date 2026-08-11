const desktopQuery = '(min-width: 901px)';

interface LeadListEnhancementOptions {
  centerSelectedStage?: boolean;
}

let activeLeadContainer: HTMLElement | null = null;
let desktopMedia: MediaQueryList | null = null;
let pendingPipelineFrame: number | null = null;
let desktopFilterOpenPreference: boolean | null = null;
let globalRefreshInstalled = false;
const filterDetailsBindings = new WeakSet<HTMLDetailsElement>();
const pipelineBindings = new WeakSet<HTMLElement>();

function placeNewLeadButton(container: HTMLElement): void {
  const heading = container.querySelector<HTMLElement>('.mvp-page-heading');
  const button = container.querySelector<HTMLButtonElement>('[data-toggle="client-form"]');
  if (!heading || !button) return;
  button.classList.add('mvp-lead-new-button');
  if (button.parentElement !== heading) heading.append(button);
}

function desktopSecondaryFilterCount(container: HTMLElement): number {
  let count = 0;
  const stage = container.querySelector<HTMLSelectElement>('#mvp-lead-stage-filter')?.value;
  const temperature = container.querySelector<HTMLSelectElement>('#mvp-lead-temperature-filter')?.value;
  const assignee = container.querySelector<HTMLSelectElement>('#mvp-lead-assignee-filter')?.value;
  const order = container.querySelector<HTMLSelectElement>('#mvp-lead-order')?.value;
  if (stage && stage !== 'Todas') count += 1;
  if (temperature && temperature !== 'Todas') count += 1;
  if (assignee && assignee !== 'Todos') count += 1;
  if (order && order !== 'priority') count += 1;
  if (container.querySelector<HTMLInputElement>('#mvp-lead-overdue-filter')?.checked) count += 1;
  if (container.querySelector<HTMLInputElement>('#mvp-lead-missing-action-filter')?.checked) count += 1;
  return count;
}

function syncDesktopFilterSummary(container: HTMLElement, details: HTMLDetailsElement, summary: HTMLElement): void {
  if (!desktopBreakpoint().matches) return;
  const active = desktopSecondaryFilterCount(container);
  const label = summary.querySelector<HTMLElement>('span');
  const helper = summary.querySelector<HTMLElement>('small');
  if (label) label.textContent = active ? `Filtros (${active})` : 'Filtros';
  if (helper) helper.textContent = active ? 'Revisá o ajustá los filtros activos' : 'Etapa, temperatura, responsable y orden';
  summary.setAttribute('aria-label', active ? `Filtros. ${active} activos` : 'Filtros');
  const desiredOpen = active > 0 || desktopFilterOpenPreference === true;
  if (details.open !== desiredOpen) details.open = desiredOpen;
}

function syncFilterDetails(container: HTMLElement): void {
  container.querySelectorAll<HTMLDetailsElement>('.mvp-lead-more-filters').forEach((details) => {
    const summary = details.querySelector<HTMLElement>(':scope > summary');
    if (!summary) return;
    syncDesktopFilterSummary(container, details, summary);
    summary.setAttribute('aria-expanded', String(details.open));
    if (filterDetailsBindings.has(details)) return;
    filterDetailsBindings.add(details);
    details.addEventListener('toggle', () => {
      summary.setAttribute('aria-expanded', String(details.open));
      if (desktopBreakpoint().matches) desktopFilterOpenPreference = details.open;
      if (details.open) details.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  });
}

function updateOverflow(counters: HTMLElement, shell: HTMLElement): void {
  if (desktopBreakpoint().matches && shell.dataset.expanded !== 'true') {
    counters.scrollLeft = 0;
    shell.dataset.overflowLeft = 'false';
    shell.dataset.overflowRight = 'false';
    return;
  }
  shell.dataset.overflowLeft = String(counters.scrollLeft > 2);
  shell.dataset.overflowRight = String(counters.scrollLeft + counters.clientWidth < counters.scrollWidth - 2);
}

function visibleStageButtons(counters: HTMLElement): HTMLButtonElement[] {
  return [...counters.querySelectorAll<HTMLButtonElement>('.mvp-stage-counter')]
    .filter((button) => getComputedStyle(button).display !== 'none' && button.getClientRects().length > 0);
}

function focusStage(counters: HTMLElement, direction: 1 | -1): void {
  const buttons = visibleStageButtons(counters);
  if (!buttons.length) return;
  const active = document.activeElement instanceof HTMLButtonElement
    ? buttons.indexOf(document.activeElement)
    : buttons.findIndex((button) => button.classList.contains('active'));
  const next = buttons[Math.min(buttons.length - 1, Math.max(0, (active < 0 ? 0 : active) + direction))];
  next?.focus();
  next?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
}

function bindPipeline(counters: HTMLElement, shell: HTMLElement): void {
  counters.tabIndex = 0;
  counters.setAttribute('role', 'group');
  counters.setAttribute('aria-label', 'Filtrar Leads por etapa. Usá las flechas para recorrer las etapas.');
  updateOverflow(counters, shell);
  if (pipelineBindings.has(counters)) return;
  pipelineBindings.add(counters);
  counters.addEventListener('scroll', () => updateOverflow(counters, shell), { passive: true });
  counters.addEventListener('wheel', (event) => {
    if (counters.scrollWidth <= counters.clientWidth + 2) return;
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (!delta) return;
    event.preventDefault();
    counters.scrollBy({ left: delta, behavior: 'auto' });
  }, { passive: false });
  counters.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      focusStage(counters, 1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      focusStage(counters, -1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      counters.scrollTo({ left: 0, behavior: 'smooth' });
      visibleStageButtons(counters)[0]?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      counters.scrollTo({ left: counters.scrollWidth, behavior: 'smooth' });
      const buttons = visibleStageButtons(counters);
      buttons.at(-1)?.focus();
    }
  });
}

function syncDesktopPipeline(shell: HTMLElement): void {
  const desktop = desktopBreakpoint().matches;
  const toggle = shell.querySelector<HTMLButtonElement>('[data-pc-toggle-stages]');
  if (toggle && desktop) toggle.hidden = false;

  const priorityHeading = shell.previousElementSibling?.matches('[data-pc-attention-section]')
    ? shell.previousElementSibling.querySelector<HTMLElement>('.pc-section-heading > div > span')
    : null;
  if (priorityHeading) priorityHeading.textContent = desktop ? 'Prioridades' : 'Prioridades comerciales';
  const pipelineHeading = shell.querySelector<HTMLElement>('[data-pc-stage-heading] > div > span');
  if (pipelineHeading) pipelineHeading.textContent = desktop ? 'Pipeline' : 'Pipeline comercial';
}

function syncAttentionPresentation(container: HTMLElement): void {
  container.querySelectorAll<HTMLButtonElement>('[data-pc-attention]').forEach((button) => {
    const count = Number(button.querySelector('b')?.textContent?.trim() ?? '0');
    button.dataset.pcActionable = String(Number.isFinite(count) && count > 0);
  });
}

function enhancePipelines(container: HTMLElement, centerSelectedStage: boolean): void {
  container.querySelectorAll<HTMLElement>('[data-stage-shell]').forEach((shell) => {
    const counters = shell.querySelector<HTMLElement>('.mvp-stage-counters');
    if (!counters) return;
    bindPipeline(counters, shell);
    syncDesktopPipeline(shell);
    if (centerSelectedStage) {
      counters.querySelector<HTMLElement>('.mvp-stage-counter.active')?.scrollIntoView({ block: 'nearest', inline: 'center' });
    }
    updateOverflow(counters, shell);
  });
}

function refreshActiveLeadPresentation(container: HTMLElement): void {
  if (activeLeadContainer !== container || !container.isConnected) return;
  placeNewLeadButton(container);
  syncFilterDetails(container);
  syncAttentionPresentation(container);
  enhancePipelines(container, false);
}

function schedulePipelineGeometryRefresh(container: HTMLElement): void {
  if (pendingPipelineFrame !== null) window.cancelAnimationFrame(pendingPipelineFrame);
  pendingPipelineFrame = window.requestAnimationFrame(() => {
    pendingPipelineFrame = null;
    refreshActiveLeadPresentation(container);
  });
}

function handleDesktopChange(): void {
  desktopFilterOpenPreference = null;
  const container = activeLeadContainer;
  if (!container?.isConnected) {
    activeLeadContainer = null;
    return;
  }
  schedulePipelineGeometryRefresh(container);
}

function desktopBreakpoint(): MediaQueryList {
  if (desktopMedia) return desktopMedia;
  desktopMedia = window.matchMedia(desktopQuery);
  desktopMedia.addEventListener('change', handleDesktopChange);
  return desktopMedia;
}

function scheduleActiveLeadRefresh(): void {
  const container = activeLeadContainer;
  if (!container?.isConnected) return;
  schedulePipelineGeometryRefresh(container);
}

function handleGlobalClick(event: MouseEvent): void {
  const target = event.target as HTMLElement | null;
  if (desktopBreakpoint().matches && target?.closest('[data-pc-clear-filters], [data-clear-lead-filters]')) {
    desktopFilterOpenPreference = false;
  }
  scheduleActiveLeadRefresh();
}

function installGlobalRefresh(): void {
  if (globalRefreshInstalled || typeof document === 'undefined') return;
  globalRefreshInstalled = true;
  document.addEventListener('trv-render', scheduleActiveLeadRefresh);
  document.addEventListener('input', scheduleActiveLeadRefresh);
  document.addEventListener('change', scheduleActiveLeadRefresh);
  document.addEventListener('click', handleGlobalClick);
  window.addEventListener('resize', scheduleActiveLeadRefresh);
}

export function enhanceLeadList(container: HTMLElement, options: LeadListEnhancementOptions = {}): void {
  installGlobalRefresh();
  activeLeadContainer = container;
  desktopBreakpoint();
  placeNewLeadButton(container);
  syncFilterDetails(container);
  enhancePipelines(container, options.centerSelectedStage === true);
  schedulePipelineGeometryRefresh(container);
}
