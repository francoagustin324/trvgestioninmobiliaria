type AttentionFilter = 'all' | 'overdue' | 'missing-action' | 'new-uncontacted' | 'today';

const MOBILE_QUERY = '(max-width: 720px)';
const DESKTOP_QUERY = '(min-width: 901px)';
const LEAD_CARD_SELECTOR = '#mvp-lead-results .mvp-lead-card';
let attentionFilter: AttentionFilter = 'all';
let stagesExpanded = false;
let scheduled = false;

function isMobile(): boolean {
  return window.matchMedia(MOBILE_QUERY).matches;
}

function isDesktop(): boolean {
  return window.matchMedia(DESKTOP_QUERY).matches;
}

function text(element: Element | null, value: string): void {
  if (element && element.textContent !== value) element.textContent = value;
}

function formField(fields: HTMLElement, name: string): HTMLLabelElement | null {
  return fields.querySelector<HTMLElement>(`[name="${name}"]`)?.closest('label') ?? null;
}

function createFormSection(title: string, className: string): HTMLElement {
  const section = document.createElement('section');
  section.className = `pc-lead-form-section ${className}`;
  const heading = document.createElement('h3');
  heading.textContent = title;
  const grid = document.createElement('div');
  grid.className = 'pc-lead-form-section-grid';
  section.append(heading, grid);
  return section;
}

function appendFields(section: HTMLElement, fields: HTMLElement, names: string[]): void {
  const grid = section.querySelector<HTMLElement>('.pc-lead-form-section-grid');
  if (!grid) return;
  names.forEach((name) => {
    const label = formField(fields, name);
    if (label) grid.append(label);
  });
}

function organizeLeadForm(): void {
  const form = document.querySelector<HTMLFormElement>('#mvp-lead-form.b131-lead-form:not(.collapsed)');
  if (!form) return;

  form.classList.add('pc-lead-dialog');
  form.setAttribute('role', 'dialog');
  form.setAttribute('aria-modal', 'true');
  form.setAttribute('aria-labelledby', 'pc-lead-dialog-title');

  const heading = form.querySelector<HTMLElement>('.mvp-form-heading');
  const headingTitle = heading?.querySelector<HTMLElement>('h2');
  if (headingTitle) headingTitle.id = 'pc-lead-dialog-title';
  const close = heading?.querySelector<HTMLButtonElement>('[data-cancel-client-edit]');
  if (close) {
    close.textContent = '×';
    close.classList.add('pc-lead-dialog-close');
    close.setAttribute('aria-label', 'Cerrar formulario');
    close.title = 'Cerrar formulario';
  }

  const fields = form.querySelector<HTMLElement>('.b131-lead-form-fields');
  if (!fields || fields.dataset.pcOrganized === 'true') return;
  fields.dataset.pcOrganized = 'true';
  fields.setAttribute('aria-label', 'Campos del lead');

  const primary = createFormSection('Datos principales', 'pc-lead-form-primary');
  const commercial = createFormSection('Estado comercial', 'pc-lead-form-commercial');
  appendFields(primary, fields, ['name', 'phone', 'email', 'interest']);
  appendFields(commercial, fields, ['temperature', 'pipeline', 'nextAction', 'nextFollowUp']);

  const qualification = fields.querySelector<HTMLDetailsElement>('.lead-form-essential');
  if (qualification) {
    qualification.classList.add('pc-lead-form-section', 'pc-lead-form-qualification');
    qualification.open = true;
    text(qualification.querySelector('summary'), 'Calificación comercial');
  }

  const optional = fields.querySelector<HTMLDetailsElement>('.lead-form-secondary');
  if (optional) {
    optional.classList.add('pc-lead-form-section', 'pc-lead-form-optional');
    optional.open = false;
    const summary = optional.querySelector<HTMLElement>('summary');
    if (summary) {
      summary.textContent = '';
      const label = document.createElement('span');
      label.textContent = 'Preferencias y datos opcionales';
      const badge = document.createElement('small');
      badge.textContent = 'Opcional';
      summary.append(label, badge);
    }
  }

  fields.prepend(primary, commercial);
  if (qualification) fields.append(qualification);
  if (optional) fields.append(optional);
}

function activeFilterCount(container: HTMLElement): number {
  let count = 0;
  const search = container.querySelector<HTMLInputElement>('#mvp-lead-search')?.value.trim();
  const stage = container.querySelector<HTMLSelectElement>('#mvp-lead-stage-filter')?.value;
  const temperature = container.querySelector<HTMLSelectElement>('#mvp-lead-temperature-filter')?.value;
  const assignee = container.querySelector<HTMLSelectElement>('#mvp-lead-assignee-filter')?.value;
  if (search) count += 1;
  if (stage && stage !== 'Todas') count += 1;
  if (temperature && temperature !== 'Todas') count += 1;
  if (assignee && assignee !== 'Todos') count += 1;
  if (attentionFilter !== 'all') count += 1;
  return count;
}

function cardMatchesAttention(card: HTMLElement): boolean {
  if (attentionFilter === 'all') return true;
  const alert = card.querySelector<HTMLElement>('[data-lead-alert-kind]')?.dataset.leadAlertKind ?? 'none';
  if (attentionFilter === 'overdue') return alert === 'overdue';
  if (attentionFilter === 'missing-action') return alert === 'no-follow-up' || alert === 'no-action';
  if (attentionFilter === 'new-uncontacted') return alert === 'new-uncontacted';
  return alert === 'due-today' || alert === 'visit-today';
}

function totalLeadCount(container: HTMLElement): number {
  const value = container.querySelector<HTMLElement>('[data-stage-quick="Todas"] b')?.textContent;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : container.querySelectorAll(LEAD_CARD_SELECTOR).length;
}

function visibleLeadCount(container: HTMLElement): number {
  return Array.from(container.querySelectorAll<HTMLElement>(LEAD_CARD_SELECTOR))
    .filter((card) => !card.hidden).length;
}

function updateCounter(container: HTMLElement): void {
  const count = container.querySelector<HTMLElement>('#mvp-lead-count');
  if (!count) return;
  const total = totalLeadCount(container);
  const visible = visibleLeadCount(container);
  count.textContent = activeFilterCount(container) === 0 ? `${total} leads` : `${visible} de ${total} leads`;
}

function attentionCount(container: HTMLElement, filter: AttentionFilter): number {
  const previous = attentionFilter;
  attentionFilter = filter;
  const count = Array.from(container.querySelectorAll<HTMLElement>(LEAD_CARD_SELECTOR))
    .filter(cardMatchesAttention).length;
  attentionFilter = previous;
  return count;
}

function renderAttentionSection(container: HTMLElement): void {
  const filterPanel = container.querySelector<HTMLElement>('.mvp-lead-filter-panel');
  const stageShell = container.querySelector<HTMLElement>('.mvp-stage-counters-shell');
  if (!filterPanel || !stageShell) return;

  let section = filterPanel.querySelector<HTMLElement>('[data-pc-attention-section]');
  if (!section) {
    section = document.createElement('section');
    section.dataset.pcAttentionSection = '';
    section.className = 'pc-attention-section';
    section.innerHTML = '<div class="pc-section-heading"><div><span>Prioridades comerciales</span><h2>Atención requerida</h2></div></div><div class="pc-attention-grid" role="group" aria-label="Filtros rápidos de atención"></div>';
    stageShell.before(section);
  }

  const definitions: Array<{ id: AttentionFilter; label: string }> = [
    { id: 'overdue', label: 'Seguimientos vencidos' },
    { id: 'today', label: 'Seguimientos para hoy' },
    { id: 'new-uncontacted', label: 'Nuevos sin contactar' },
    { id: 'missing-action', label: 'Sin próxima acción' },
  ];
  const grid = section.querySelector<HTMLElement>('.pc-attention-grid');
  if (!grid) return;
  grid.innerHTML = definitions.map(({ id, label }) => {
    const active = attentionFilter === id;
    return `<button type="button" class="pc-attention-chip${active ? ' active' : ''}" data-pc-attention="${id}" aria-pressed="${active}"><span>${label}</span><b>${attentionCount(container, id)}</b></button>`;
  }).join('');
}

function applyAttention(container: HTMLElement): void {
  const cards = Array.from(container.querySelectorAll<HTMLElement>(LEAD_CARD_SELECTOR));
  cards.forEach((card) => { card.hidden = !cardMatchesAttention(card); });

  let empty = container.querySelector<HTMLElement>('[data-pc-attention-empty]');
  if (!empty) {
    empty = document.createElement('p');
    empty.dataset.pcAttentionEmpty = '';
    empty.className = 'empty-state pc-attention-empty';
    empty.textContent = 'No hay leads para mostrar con esta prioridad.';
    container.querySelector('#mvp-lead-results')?.append(empty);
  }
  empty.hidden = visibleLeadCount(container) > 0 || attentionFilter === 'all';
  updateCounter(container);
}

function enhanceFilterPanel(container: HTMLElement): void {
  const panel = container.querySelector<HTMLElement>('.mvp-lead-filter-panel');
  if (!panel) return;
  panel.classList.add('pc-lead-controls');

  const search = panel.querySelector<HTMLInputElement>('#mvp-lead-search');
  if (search) {
    search.placeholder = 'Buscar por nombre, WhatsApp o interés';
    search.setAttribute('aria-label', 'Buscar por nombre, WhatsApp o interés');
  }

  const details = panel.querySelector<HTMLDetailsElement>('.mvp-lead-more-filters');
  const summary = details?.querySelector<HTMLElement>('summary');
  const active = activeFilterCount(container);
  if (summary && !isDesktop()) {
    const label = summary.querySelector<HTMLElement>('span');
    text(label, active ? `Filtros (${active})` : 'Filtros');
    summary.setAttribute('aria-label', active ? `Abrir filtros. ${active} activos` : 'Abrir filtros');
  }

  if (details && !details.querySelector('[data-pc-filter-actions]')) {
    const actions = document.createElement('div');
    actions.dataset.pcFilterActions = '';
    actions.className = 'pc-filter-actions';
    actions.innerHTML = '<button type="button" class="quiet-button" data-pc-clear-filters>Limpiar</button><button type="button" data-pc-apply-filters>Aplicar filtros</button>';
    details.append(actions);
  }

  renderAttentionSection(container);
}

function enhanceStageSummary(container: HTMLElement): void {
  const shell = container.querySelector<HTMLElement>('.mvp-stage-counters-shell');
  const counters = shell?.querySelector<HTMLElement>('.mvp-stage-counters');
  if (!shell || !counters) return;
  shell.classList.add('pc-stage-summary');
  shell.dataset.expanded = String(stagesExpanded);

  if (!shell.querySelector('[data-pc-stage-heading]')) {
    const heading = document.createElement('div');
    heading.dataset.pcStageHeading = '';
    heading.className = 'pc-section-heading pc-stage-heading';
    heading.innerHTML = '<div><span>Pipeline comercial</span><h2>Resumen por etapa</h2></div><button type="button" class="quiet-button" data-pc-toggle-stages aria-expanded="false">Ver todas las etapas</button>';
    shell.prepend(heading);
  }

  const initiallyVisibleStages = new Set(['Todas', 'Nuevo', 'Contactado', 'Visita coordinada']);
  const buttons = Array.from(counters.querySelectorAll<HTMLButtonElement>('[data-stage-quick]'));
  buttons.forEach((button) => {
    const stage = button.dataset.stageQuick ?? '';
    button.toggleAttribute('data-pc-secondary-stage', !initiallyVisibleStages.has(stage));
    button.setAttribute('aria-pressed', String(button.classList.contains('active')));
  });

  const standardOrder = ['Todas', 'Nuevo', 'Contactado', 'Calificado', 'Visita coordinada', 'Negociación', 'Reservado', 'Ganado', 'Perdido'];
  const collapsedOrder = ['Todas', 'Nuevo', 'Contactado', 'Visita coordinada', 'Calificado', 'Negociación', 'Reservado', 'Ganado', 'Perdido'];
  const desiredOrder = isMobile() && !stagesExpanded ? collapsedOrder : standardOrder;
  const buttonByStage = new Map(buttons.map((button) => [button.dataset.stageQuick ?? '', button]));
  desiredOrder.forEach((stage) => {
    const button = buttonByStage.get(stage);
    if (button && button.parentElement === counters) counters.append(button);
  });

  const activeStage = counters.querySelector<HTMLElement>('.mvp-stage-counter.active, [aria-pressed="true"]');
  const selectedStage = activeStage?.dataset.stageQuick ?? 'Todas';
  if (shell.dataset.pcSelectedStage !== selectedStage) {
    shell.dataset.pcSelectedStage = selectedStage;
    if (activeStage) {
      const counterRect = counters.getBoundingClientRect();
      const activeRect = activeStage.getBoundingClientRect();
      if (activeRect.left < counterRect.left || activeRect.right > counterRect.right) {
        const centeredLeft = activeStage.offsetLeft - ((counters.clientWidth - activeStage.offsetWidth) / 2);
        counters.scrollLeft = Math.max(0, centeredLeft);
      }
    }
  }

  const toggle = shell.querySelector<HTMLButtonElement>('[data-pc-toggle-stages]');
  if (toggle) {
    toggle.hidden = !(isMobile() || isDesktop());
    toggle.textContent = stagesExpanded ? 'Ver menos etapas' : 'Ver todas las etapas';
    toggle.setAttribute('aria-expanded', String(stagesExpanded));
  }
}

function enhanceHeading(container: HTMLElement): void {
  const heading = container.querySelector<HTMLElement>('.mvp-page-heading');
  if (!heading) return;
  heading.classList.add('pc-leads-heading');
  text(heading.querySelector('h1'), 'Leads');
  text(heading.querySelector('p'), 'Contactá primero a los leads que requieren atención.');
  const create = container.querySelector<HTMLButtonElement>('[data-toggle="client-form"]');
  if (create && !create.closest('#mvp-lead-form')) {
    const formOpen = Boolean(container.querySelector('#mvp-lead-form:not(.collapsed)'));
    create.textContent = 'Nuevo lead';
    create.setAttribute('aria-label', formOpen ? 'Cerrar formulario' : 'Crear nuevo lead');
    create.title = formOpen ? 'Cerrar formulario' : 'Nuevo lead';
  }
}

function enhanceLeadCards(container: HTMLElement): void {
  container.querySelectorAll<HTMLElement>(LEAD_CARD_SELECTOR).forEach((card) => {
    card.classList.add('pc-professional-lead-card');
    card.querySelectorAll<HTMLElement>('a, button, summary').forEach((control) => {
      if (!control.hasAttribute('tabindex')) control.setAttribute('tabindex', '0');
    });
  });
}

export function enhanceLeadsProfessionalRedesign(container: HTMLElement): void {
  container.classList.add('pc-leads-redesign');
  enhanceHeading(container);
  enhanceFilterPanel(container);
  enhanceStageSummary(container);
  enhanceLeadCards(container);
  organizeLeadForm();
  applyAttention(container);
}

function enhanceLeads(): void {
  scheduled = false;
  const container = document.querySelector<HTMLElement>('#crm');
  if (!container) return;
  enhanceLeadsProfessionalRedesign(container);
}

function scheduleEnhance(): void {
  if (scheduled) return;
  scheduled = true;
  window.requestAnimationFrame(enhanceLeads);
}

function clearCoreFilters(container: HTMLElement): void {
  const coreClear = container.querySelector<HTMLButtonElement>('[data-clear-lead-filters]');
  if (coreClear) {
    coreClear.click();
    return;
  }
  const search = container.querySelector<HTMLInputElement>('#mvp-lead-search');
  if (search?.value) {
    search.value = '';
    search.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

function install(): void {
  if (typeof document === 'undefined') return;

  document.addEventListener('trv-render', scheduleEnhance);
  document.addEventListener('input', scheduleEnhance);
  document.addEventListener('change', scheduleEnhance);
  document.addEventListener('submit', scheduleEnhance);
  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const container = target.closest<HTMLElement>('#crm') ?? document.querySelector<HTMLElement>('#crm');
    if (!container) return;

    const attention = target.closest<HTMLButtonElement>('[data-pc-attention]');
    if (attention) {
      const requested = attention.dataset.pcAttention as AttentionFilter;
      attentionFilter = attentionFilter === requested ? 'all' : requested;
      scheduleEnhance();
      return;
    }

    if (target.closest('[data-pc-toggle-stages]')) {
      stagesExpanded = !stagesExpanded;
      scheduleEnhance();
      return;
    }

    if (target.closest('[data-pc-apply-filters]')) {
      const details = container.querySelector<HTMLDetailsElement>('.mvp-lead-more-filters');
      if (details) details.open = false;
      details?.querySelector<HTMLElement>('summary')?.focus();
      scheduleEnhance();
      return;
    }

    if (target.closest('[data-pc-clear-filters]')) {
      attentionFilter = 'all';
      clearCoreFilters(container);
      scheduleEnhance();
      return;
    }

    scheduleEnhance();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const form = document.querySelector<HTMLFormElement>('#mvp-lead-form.b131-lead-form:not(.collapsed)');
    if (!form) return;
    event.preventDefault();
    form.querySelector<HTMLButtonElement>('[data-cancel-client-edit]')?.click();
  });

  window.matchMedia(MOBILE_QUERY).addEventListener('change', scheduleEnhance);
  window.matchMedia(DESKTOP_QUERY).addEventListener('change', scheduleEnhance);
  scheduleEnhance();
}

install();