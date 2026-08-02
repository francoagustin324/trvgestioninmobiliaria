import { enhanceWhatsAppContactFlow } from './whatsapp-contact-ui.js';

const MODULE_SELECTOR = '#crm, #agenda, #whatsapp, #propiedades, #equipo';
const ACTIVE_MODULE_SELECTOR = '#crm.active, #agenda.active, #whatsapp.active, #propiedades.active, #equipo.active';

function scopeActionsToActiveModule(): void {
  const activeModule = document.querySelector<HTMLElement>(ACTIVE_MODULE_SELECTOR);
  if (!activeModule) return;

  document.querySelectorAll<HTMLElement>('[data-contact-whatsapp]').forEach((action) => {
    const ownerModule = action.closest<HTMLElement>(MODULE_SELECTOR);
    if (ownerModule && ownerModule !== activeModule) action.remove();
  });

  document.querySelectorAll<HTMLElement>('.agenda-open-client[data-edit-client]').forEach((action) => {
    const ownerModule = action.closest<HTMLElement>(MODULE_SELECTOR);
    if (ownerModule && ownerModule !== activeModule) action.remove();
  });
}

function scheduleScopeUpdate(): void {
  queueMicrotask(scopeActionsToActiveModule);
}

function refreshLeadActions(): void {
  enhanceWhatsAppContactFlow();
  scheduleScopeUpdate();
}

document.addEventListener('trv-render', scheduleScopeUpdate);
document.addEventListener('propcontrol-cloud-status', scheduleScopeUpdate);
document.addEventListener('propcontrol-leads-rendered', refreshLeadActions);
document.addEventListener('DOMContentLoaded', scheduleScopeUpdate, { once: true });
window.addEventListener('pageshow', scheduleScopeUpdate);
requestAnimationFrame(scheduleScopeUpdate);

export { scopeActionsToActiveModule, scopeActionsToActiveModule as removeInactiveWhatsAppActions };
