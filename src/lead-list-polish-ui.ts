import { renderSupervisedAttentionQueue } from './lead-attention-queue.js';
import { visibleClients } from './team-access.js';

const desktopQuery = '(min-width: 901px)';

interface LeadListEnhancementOptions {
  centerSelectedStage?: boolean;
}

let activeLeadContainer: HTMLElement | null = null;
let desktopMedia: MediaQueryList | null = null;
let pendingPipelineFrame: number | null = null;
const filterDetailsBindings = new WeakSet<HTMLDetailsElement>();
const pipelineBindings = new WeakSet<HTMLElement>();

function placeNewLeadButton(container: HTMLElement, desktop: boolean): void {
  const heading = container.querySelector<HTMLElement>('.mvp-page-heading');
  const primary = container.querySelector<HTMLElement>('.mvp-lead-filter-primary');
  const button = container.querySelector<HTMLButtonElement>('[data-toggle="client-form"]');
  if (!heading || !primary || !button) return;
  button.classList.add('mvp-lead-new-button');
  const destination = desktop ? primary : heading;
  if (button.parentElement !== destination) destination.append(button);
}

function handleDesktopChange(event: MediaQueryListEvent): void {
  const container = activeLeadContainer;
  if (!container?.isConnected) {
    activeLeadContainer = null;
    return;
  }
  placeNewLeadButton(container, event.matches);
}

function desktopBreakpoint(): MediaQueryList {
  if (desktopMedia) return desktopMedia;
  desktopMedia = window.matchMedia(desktopQuery);
  desktopMedia.addEventListener('change', handleDesktopChange);
  return desktopMedia;
}

function syncFilterDetails(container: HTMLElement): void {
  container.querySelectorAll<HTMLDetailsElement>('.mvp-lead-more-filters').forEach((details) => {
    const summary = details.querySelector<HTMLElement>(':scope > summary');
    if (!summary) return;
    summary.setAttribute('aria-expanded', String(details.open));
    if (filterDetailsBindings.has(details)) return;
    filterDetailsBindings.add(details);
    details.addEventListener('toggle', () => {
      summary.setAttribute('aria-expanded', String(details.open));
      if (details.open) details.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  });
}

function updateOverflow(counters: HTMLElement, shell: HTMLElement): void {
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

function enhancePipelines(container: HTMLElement, centerSelectedStage: boolean): void {
  container.querySelectorAll<HTMLElement>('[data-stage-shell]').forEach((shell) => {
    const counters = shell.querySelector<HTMLElement>('.mvp-stage-counters');
    if (!counters) return;
    bindPipeline(counters, shell);
    if (centerSelectedStage) {
      counters.querySelector<HTMLElement>('.mvp-stage-counter.active')?.scrollIntoView({ block: 'nearest', inline: 'center' });
    }
    updateOverflow(counters, shell);
  });
}

function schedulePipelineGeometryRefresh(container: HTMLElement): void {
  if (pendingPipelineFrame !== null) window.cancelAnimationFrame(pendingPipelineFrame);
  pendingPipelineFrame = window.requestAnimationFrame(() => {
    pendingPipelineFrame = null;
    if (activeLeadContainer !== container || !container.isConnected) return;
    enhancePipelines(container, false);
  });
}

function renderAttentionQueue(container: HTMLElement): void {
  const results = container.querySelector<HTMLElement>('#mvp-lead-results');
  if (!results) return;
  container.querySelector<HTMLElement>('[data-supervised-attention-queue]')?.remove();
  results.insertAdjacentHTML('beforebegin', renderSupervisedAttentionQueue(visibleClients()));
}

export function enhanceLeadList(container: HTMLElement, options: LeadListEnhancementOptions = {}): void {
  activeLeadContainer = container;
  const breakpoint = desktopBreakpoint();
  placeNewLeadButton(container, breakpoint.matches);
  syncFilterDetails(container);
  enhancePipelines(container, options.centerSelectedStage === true);
  renderAttentionQueue(container);
  schedulePipelineGeometryRefresh(container);
}
