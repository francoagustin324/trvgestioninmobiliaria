export type MobileAttentionPriorityId = 'overdue' | 'today' | 'new-uncontacted' | 'missing-action';

export interface MobileAttentionPriority {
  id: MobileAttentionPriorityId;
  count: number;
}

const COMPACT_MOBILE_QUERY = '(max-width: 520px)';
const PRIORITY_RANK: Record<MobileAttentionPriorityId, number> = {
  overdue: 0,
  today: 1,
  'new-uncontacted': 2,
  'missing-action': 3,
};
let scheduled = false;

export function prioritizeActionableMobileAttention<T extends MobileAttentionPriority>(items: T[]): T[] {
  return items
    .filter((item) => Number.isFinite(item.count) && item.count > 0)
    .sort((left, right) => PRIORITY_RANK[left.id] - PRIORITY_RANK[right.id]);
}

function priorityId(button: HTMLButtonElement): MobileAttentionPriorityId | null {
  const value = button.dataset.pcAttention;
  if (value === 'overdue' || value === 'today' || value === 'new-uncontacted' || value === 'missing-action') return value;
  return null;
}

function priorityCount(button: HTMLButtonElement): number {
  const value = Number(button.querySelector('b')?.textContent?.trim() ?? '0');
  return Number.isFinite(value) ? value : 0;
}

function headingLabel(section: HTMLElement): HTMLElement | null {
  return section.querySelector<HTMLElement>('.pc-section-heading > div > span');
}

function setVisible(button: HTMLButtonElement, visible: boolean): void {
  button.hidden = !visible;
  if (visible) button.style.removeProperty('display');
  else button.style.display = 'none';
}

function setCompactSizing(button: HTMLButtonElement, compact: boolean): void {
  if (compact) {
    button.style.flex = '0 0 calc(50% - 3px)';
    button.style.maxWidth = '168px';
  } else {
    button.style.removeProperty('flex');
    button.style.removeProperty('max-width');
  }
}

export function applyMobilePriorityOrder(root: ParentNode = document): void {
  const section = root.querySelector<HTMLElement>('#crm [data-pc-attention-section]');
  const grid = section?.querySelector<HTMLElement>('.pc-attention-grid');
  if (!section || !grid) return;

  const label = headingLabel(section);
  const buttons = Array.from(grid.querySelectorAll<HTMLButtonElement>('[data-pc-attention]'));
  grid.querySelector<HTMLElement>('[data-pc-attention-clear]')?.remove();

  const compactMobile = typeof window !== 'undefined' && window.matchMedia(COMPACT_MOBILE_QUERY).matches;
  buttons.forEach((button) => setCompactSizing(button, compactMobile));
  if (!compactMobile) {
    buttons.forEach((button) => setVisible(button, true));
    if (label) label.textContent = 'Prioridades comerciales';
    grid.setAttribute('aria-label', 'Filtros rápidos de atención');
    section.removeAttribute('data-pc-priority-overflow');
    return;
  }

  const entries = buttons.flatMap((button) => {
    const id = priorityId(button);
    if (!id) return [];
    return [{ id, count: priorityCount(button), button, active: button.classList.contains('active') || button.getAttribute('aria-pressed') === 'true' }];
  });
  const actionable = prioritizeActionableMobileAttention(entries);
  const actionableIds = new Set(actionable.map((entry) => entry.id));
  const activeZero = entries.filter((entry) => entry.active && entry.count <= 0 && !actionableIds.has(entry.id));

  entries.forEach((entry) => setVisible(entry.button, actionableIds.has(entry.id) || activeZero.includes(entry)));
  [...actionable, ...activeZero].forEach((entry) => grid.append(entry.button));

  if (actionable.length === 0 && activeZero.length === 0) {
    const clear = document.createElement('div');
    clear.dataset.pcAttentionClear = '';
    clear.className = 'pc-attention-chip pc-attention-clear';
    clear.setAttribute('role', 'status');
    clear.setAttribute('aria-live', 'polite');
    clear.innerHTML = '<span>Sin pendientes</span>';
    grid.prepend(clear);
    grid.setAttribute('aria-label', 'Prioridades comerciales: sin pendientes');
  } else {
    grid.setAttribute('aria-label', 'Prioridades comerciales accionables');
  }

  const overflowing = grid.scrollWidth > grid.clientWidth + 1;
  section.dataset.pcPriorityOverflow = String(overflowing);
  if (label) label.textContent = overflowing ? 'Prioridades comerciales · Más →' : 'Prioridades comerciales';
}

function schedulePriorityOrder(): void {
  if (scheduled || typeof window === 'undefined') return;
  scheduled = true;
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      scheduled = false;
      applyMobilePriorityOrder(document);
    });
  });
}

function install(): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  document.addEventListener('trv-render', schedulePriorityOrder);
  document.addEventListener('click', schedulePriorityOrder);
  document.addEventListener('input', schedulePriorityOrder);
  document.addEventListener('change', schedulePriorityOrder);
  window.addEventListener('resize', schedulePriorityOrder);
  window.matchMedia(COMPACT_MOBILE_QUERY).addEventListener('change', schedulePriorityOrder);
  schedulePriorityOrder();
}

install();
