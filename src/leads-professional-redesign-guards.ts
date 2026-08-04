let scheduled = false;

function synchronizeLeadRedesignState(): void {
  scheduled = false;
  const crm = document.querySelector<HTMLElement>('#crm.pc-leads-redesign');
  if (!crm) return;

  const activeCoreFilters = Boolean(crm.querySelector('.mvp-lead-active-filters'));
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
  document.addEventListener('click', scheduleSynchronize, true);
  document.addEventListener('input', scheduleSynchronize);
  document.addEventListener('change', scheduleSynchronize);
  window.addEventListener('resize', scheduleSynchronize);
  scheduleSynchronize();
}

install();
