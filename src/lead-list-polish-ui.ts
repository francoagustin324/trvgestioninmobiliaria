const desktopQuery = '(min-width: 901px)';
let scheduled = false;

function scheduleEnhancement(): void {
  if (scheduled) return;
  scheduled = true;
  window.requestAnimationFrame(() => {
    scheduled = false;
    enhanceLeadList();
  });
}

function placeNewLeadButton(): void {
  const crm = document.querySelector<HTMLElement>('#crm');
  const heading = crm?.querySelector<HTMLElement>('.mvp-page-heading');
  const primary = crm?.querySelector<HTMLElement>('.mvp-lead-filter-primary');
  const button = crm?.querySelector<HTMLButtonElement>('[data-toggle="client-form"]');
  if (!heading || !primary || !button) return;
  button.classList.add('mvp-lead-new-button');
  const destination = window.matchMedia(desktopQuery).matches ? primary : heading;
  if (button.parentElement !== destination) destination.append(button);
}

function syncFilterDetails(): void {
  document.querySelectorAll<HTMLDetailsElement>('#crm .mvp-lead-more-filters').forEach((details) => {
    const summary = details.querySelector<HTMLElement>(':scope > summary');
    if (!summary) return;
    summary.setAttribute('aria-expanded', String(details.open));
    if (summary.dataset.b124Bound === 'true') return;
    summary.dataset.b124Bound = 'true';
    details.addEventListener('toggle', () => {
      summary.setAttribute('aria-expanded', String(details.open));
      if (details.open) window.requestAnimationFrame(() => details.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
    });
  });
}

function updateOverflow(counters: HTMLElement, shell: HTMLElement): void {
  shell.dataset.overflowLeft = String(counters.scrollLeft > 2);
  shell.dataset.overflowRight = String(counters.scrollLeft + counters.clientWidth < counters.scrollWidth - 2);
}

function focusStage(counters: HTMLElement, direction: 1 | -1): void {
  const buttons = [...counters.querySelectorAll<HTMLButtonElement>('.mvp-stage-counter')];
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
  if (counters.dataset.b124Bound === 'true') return;
  counters.dataset.b124Bound = 'true';
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
      counters.querySelector<HTMLButtonElement>('.mvp-stage-counter')?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      counters.scrollTo({ left: counters.scrollWidth, behavior: 'smooth' });
      const buttons = counters.querySelectorAll<HTMLButtonElement>('.mvp-stage-counter');
      buttons.item(buttons.length - 1)?.focus();
    }
  });
}

function enhancePipelines(): void {
  document.querySelectorAll<HTMLElement>('#crm [data-stage-shell]').forEach((shell) => {
    const counters = shell.querySelector<HTMLElement>('.mvp-stage-counters');
    if (counters) bindPipeline(counters, shell);
  });
}

function enhanceLeadList(): void {
  placeNewLeadButton();
  syncFilterDetails();
  enhancePipelines();
}

function install(): void {
  const root = document.querySelector<HTMLElement>('#root');
  if (!root) return;
  const observer = new MutationObserver(scheduleEnhancement);
  observer.observe(root, { childList: true, subtree: true });
  document.addEventListener('trv-render', scheduleEnhancement);
  window.addEventListener('resize', scheduleEnhancement, { passive: true });
  scheduleEnhancement();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
else install();

export { enhanceLeadList };
