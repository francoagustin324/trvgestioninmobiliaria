let scheduled = false;

function hasCoreFilters(crm: HTMLElement): boolean {
  const search = crm.querySelector<HTMLInputElement>('#mvp-lead-search')?.value.trim();
  const stage = crm.querySelector<HTMLSelectElement>('#mvp-lead-stage-filter')?.value;
  const temperature = crm.querySelector<HTMLSelectElement>('#mvp-lead-temperature-filter')?.value;
  const assignee = crm.querySelector<HTMLSelectElement>('#mvp-lead-assignee-filter')?.value;
  return Boolean(
    search
    || (stage && stage !== 'Todas')
    || (temperature && temperature !== 'Todas')
    || (assignee && assignee !== 'Todos')
  );
}

function setInputValue(input: HTMLInputElement | null, value: string): void {
  if (!input || input.value === value) return;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function setSelectValue(select: HTMLSelectElement | null, value: string): void {
  if (!select || select.value === value) return;
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

function clearCoreFiltersFallback(crm: HTMLElement): void {
  setInputValue(crm.querySelector<HTMLInputElement>('#mvp-lead-search'), '');
  setSelectValue(crm.querySelector<HTMLSelectElement>('#mvp-lead-temperature-filter'), 'Todas');
  setSelectValue(crm.querySelector<HTMLSelectElement>('#mvp-lead-order'), 'priority');
  setSelectValue(crm.querySelector<HTMLSelectElement>('#mvp-lead-assignee-filter'), 'Todos');
  const currentCrm = document.querySelector<HTMLElement>('#crm.pc-leads-redesign') ?? crm;
  setSelectValue(currentCrm.querySelector<HTMLSelectElement>('#mvp-lead-stage-filter'), 'Todas');
}

function rebuildOptionalSummary(summary: HTMLElement): void {
  summary.textContent = '';
  const label = document.createElement('span');
  label.textContent = 'Preferencias y datos opcionales';
  const badge = document.createElement('small');
  badge.textContent = 'Opcional';
  summary.append(label, badge);
}

function normalizeFormSections(crm: HTMLElement): void {
  const fields = crm.querySelector<HTMLElement>('#mvp-lead-form.pc-lead-dialog:not(.collapsed) .b131-lead-form-fields');
  if (!fields) return;

  const qualification = fields.querySelector<HTMLDetailsElement>('details.lead-form-essential:not(.lead-form-secondary)');
  const optional = fields.querySelector<HTMLDetailsElement>('details.lead-form-secondary');

  if (qualification) {
    qualification.classList.remove('pc-lead-form-optional');
    qualification.classList.add('pc-lead-form-section', 'pc-lead-form-qualification');
    qualification.open = true;
    const summary = qualification.querySelector<HTMLElement>(':scope > summary');
    if (summary) summary.textContent = 'Calificación comercial';
  }

  if (optional) {
    optional.classList.remove('pc-lead-form-qualification');
    optional.classList.add('pc-lead-form-section', 'pc-lead-form-optional');
    const summary = optional.querySelector<HTMLElement>(':scope > summary');
    if (summary && summary.querySelector('small')?.textContent !== 'Opcional') rebuildOptionalSummary(summary);
  }
}

function synchronizeLeadRedesignState(): void {
  scheduled = false;
  const crm = document.querySelector<HTMLElement>('#crm.pc-leads-redesign');
  if (!crm) return;

  normalizeFormSections(crm);

  const activeCoreFilters = hasCoreFilters(crm);
  const activeAttention = Boolean(crm.querySelector('.pc-attention-chip.active'));
  const clear = crm.querySelector<HTMLButtonElement>('[data-pc-clear-filters]');
  if (clear) clear.hidden = !activeCoreFilters && !activeAttention;

  const formOpen = Boolean(crm.querySelector('#mvp-lead-form.pc-lead-dialog:not(.collapsed)'));
  const pageAction = crm.querySelector<HTMLButtonElement>('.pc-leads-heading > [data-toggle="client-form"]');
  if (pageAction) {
    pageAction.setAttribute('aria-label', formOpen ? 'Cerrar formulario' : 'Crear nuevo lead');
    pageAction.title = formOpen ? 'Cerrar formulario' : 'Nuevo lead';
  }
}

function scheduleSynchronize(): void {
  if (scheduled) return;
  scheduled = true;
  window.requestAnimationFrame(synchronizeLeadRedesignState);
}

function install(): void {
  if (typeof document === 'undefined') return;
  document.addEventListener('trv-render', scheduleSynchronize);
  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (!target.closest('[data-pc-clear-filters]')) return;
    const crm = target.closest<HTMLElement>('#crm.pc-leads-redesign');
    if (crm && !crm.querySelector('[data-clear-lead-filters]')) clearCoreFiltersFallback(crm);
  }, true);
  document.addEventListener('click', scheduleSynchronize, true);
  document.addEventListener('input', scheduleSynchronize);
  document.addEventListener('change', scheduleSynchronize);
  window.addEventListener('resize', scheduleSynchronize);
  scheduleSynchronize();
}

install();
