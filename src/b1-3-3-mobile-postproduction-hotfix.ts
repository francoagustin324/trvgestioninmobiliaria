const LEAD_FORM_SELECTOR = '#mvp-lead-form.b131-lead-form:not(.collapsed)';
const IDENTITY_PANEL_SELECTOR = '#propcontrol-whatsapp-contact .whatsapp-contact-panel';
let scheduled = false;

function syncVisualViewport(): void {
  const viewport = window.visualViewport;
  const height = viewport?.height ?? window.innerHeight;
  const offsetTop = viewport?.offsetTop ?? 0;
  document.documentElement.style.setProperty('--pc-visual-viewport-height', `${Math.max(320, Math.round(height))}px`);
  document.documentElement.style.setProperty('--pc-visual-viewport-offset-top', `${Math.max(0, Math.round(offsetTop))}px`);
}

function normalizeLeadModal(): void {
  const form = document.querySelector<HTMLFormElement>(LEAD_FORM_SELECTOR);
  if (!form) return;

  const heading = form.querySelector<HTMLElement>('.mvp-form-heading');
  const close = heading?.querySelector<HTMLButtonElement>('[data-cancel-client-edit]');
  if (!close) return;

  close.textContent = '×';
  close.classList.add('b133-postproduction-modal-close');
  close.setAttribute('aria-label', 'Cerrar formulario de lead');
  close.title = 'Cerrar';
}

function normalizeWhatsAppIdentityPanel(): void {
  const panel = document.querySelector<HTMLElement>(IDENTITY_PANEL_SELECTOR);
  const form = panel?.querySelector<HTMLFormElement>('[data-whatsapp-identity-form]');
  if (!panel || !form) return;

  form.querySelector<HTMLElement>('.whatsapp-context-note')?.remove();
  const note = panel.querySelector<HTMLElement>('[data-whatsapp-context-note]');
  const title = note?.querySelector<HTMLElement>('strong');
  if (title) title.textContent = 'Configuración personal requerida';
}

function synchronize(): void {
  scheduled = false;
  syncVisualViewport();
  normalizeLeadModal();
  normalizeWhatsAppIdentityPanel();
}

function scheduleSynchronize(): void {
  if (scheduled) return;
  scheduled = true;
  window.requestAnimationFrame(synchronize);
}

function install(): void {
  if (typeof document === 'undefined') return;
  syncVisualViewport();
  new MutationObserver(scheduleSynchronize).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  document.addEventListener('trv-render', scheduleSynchronize);
  window.addEventListener('resize', scheduleSynchronize);
  window.visualViewport?.addEventListener('resize', scheduleSynchronize);
  window.visualViewport?.addEventListener('scroll', scheduleSynchronize);
  scheduleSynchronize();
}

install();
