const PANEL_SELECTOR = '#propcontrol-whatsapp-contact .whatsapp-contact-panel';

function panel(): HTMLElement | null {
  return document.querySelector<HTMLElement>(PANEL_SELECTOR);
}

function ensureSafetyNote(): void {
  const element = panel();
  if (!element || document.getElementById('propcontrol-whatsapp-contact')?.hidden) return;
  let note = element.querySelector<HTMLElement>('[data-whatsapp-context-note]');
  if (!note) {
    note = document.createElement('div');
    note.className = 'whatsapp-context-note whatsapp-zero-safety-note';
    note.dataset.whatsappContextNote = '';
    note.setAttribute('role', 'note');
    const identityBlock = element.querySelector<HTMLElement>('[data-whatsapp-identity-form] .whatsapp-context-note.blocked');
    if (identityBlock) {
      note.classList.add('blocked');
      note.setAttribute('role', 'alert');
      note.innerHTML = identityBlock.innerHTML;
    }
    element.querySelector('.whatsapp-zero-message-card, .whatsapp-contact-field, footer')?.before(note);
  }
  const blocked = element.dataset.contactBlocked === 'true' || note.classList.contains('blocked');
  note.hidden = !blocked;
}

function queueSafetyNote(): void {
  queueMicrotask(ensureSafetyNote);
}

if (typeof document !== 'undefined') {
  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('[data-contact-whatsapp], .mvp-contact-btn.wa, .agenda-contact-whatsapp')) queueSafetyNote();
  }, true);
  document.addEventListener('trv-render', queueSafetyNote);
  document.addEventListener('propcontrol-whatsapp-identity-changed', queueSafetyNote);
  document.addEventListener('visibilitychange', queueSafetyNote);
  window.addEventListener('focus', queueSafetyNote);
  window.addEventListener('pageshow', queueSafetyNote);
  queueSafetyNote();
}

export { ensureSafetyNote };
