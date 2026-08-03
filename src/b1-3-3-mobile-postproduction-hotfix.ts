const IDENTITY_PANEL_SELECTOR = '#propcontrol-whatsapp-contact .whatsapp-contact-panel';
let scheduled = false;

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
  normalizeWhatsAppIdentityPanel();
}

function scheduleSynchronize(): void {
  if (scheduled) return;
  scheduled = true;
  window.requestAnimationFrame(synchronize);
}

function install(): void {
  if (typeof document === 'undefined') return;
  document.addEventListener('trv-render', scheduleSynchronize);
  document.addEventListener('click', scheduleSynchronize, true);
  document.addEventListener('submit', scheduleSynchronize);
  scheduleSynchronize();
}

install();
