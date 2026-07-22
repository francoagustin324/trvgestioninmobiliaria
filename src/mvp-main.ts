import type { ModuleId } from './models.js';
import { modules } from './models.js';
import { PRODUCT_BRAND } from './branding.js';
import { renderAgenda } from './agenda-ui.js';
import { decodePublicFicha, renderPublicMode } from './public-ficha.js';
import { loadPublicPropertyFicha } from './public-property-share.js';
import { renderMvpLeads } from './mvp-leads-ui.js';
import { renderMvpProperties } from './mvp-properties-ui.js';
import { renderMvpUsers } from './mvp-users-ui.js';
import { renderMvpConversations } from './mvp-conversations-ui.js';
import { installPropertyPhotoUxGuard } from './property-photo-ux.js';
import { isInvitationPage, renderInvitationAuth } from './mvp-invitation-auth.js';
import { appIcons } from './icons.js';
import {
  hasAuthenticatedSession,
  hydrateAuthenticatedSession,
  isLoginPage,
  isRegisterPage,
  renderAccountMenu,
  renderPublicAuth,
} from './mvp-auth.js';
import { canAccessModule } from './team-access.js';
import { saveData, state } from './store.js';
import { qs } from './utils.js';

const root = qs<HTMLElement>('#root');
let eventsBound = false;

const moduleIcons: Partial<Record<ModuleId, string>> = {
  crm: appIcons.leads,
  whatsapp: appIcons.conversaciones,
  agenda: appIcons.seguimientos,
  propiedades: appIcons.propiedades,
  equipo: appIcons.usuarios,
};

function renderShell(): void {
  root.innerHTML = `<main class="premium-shell mvp-shell">
    <div class="sidebar-backdrop" data-mobile-nav-close hidden></div>
    <aside class="premium-sidebar mvp-sidebar" id="app-sidebar" aria-label="Navegación principal">
      <div class="sidebar-mobile-head"><span>Menú</span><button type="button" class="sidebar-close" data-mobile-nav-close aria-label="Cerrar menú">×</button></div>
      <div class="mvp-product-brand" aria-label="${PRODUCT_BRAND.name}">
        <span class="mvp-product-logo"><img src="${PRODUCT_BRAND.logo}" alt=""></span>
        <span class="mvp-product-copy"><strong>${PRODUCT_BRAND.name}</strong><small>CRM inmobiliario</small></span>
      </div>
      <nav>${modules.map(([id, label]) => `<button type="button" class="nav-button" data-module="${id}" title="${label}"><span class="nav-icon" aria-hidden="true">${moduleIcons[id] ?? ''}</span><span class="nav-label">${label}</span></button>`).join('')}</nav>
    </aside>
    <section class="premium-content mvp-content">
      <header class="topbar mvp-topbar">
        <button type="button" class="mobile-nav-trigger" data-mobile-nav-toggle aria-controls="app-sidebar" aria-expanded="false"><span>Menú</span></button>
        <div class="mvp-topbar-spacer" aria-hidden="true"></div>
        <div id="cloud-account"></div>
      </header>
      <div id="notice" class="notice" hidden></div>
      <section class="module-panel" id="crm"></section>
      <section class="module-panel" id="whatsapp"></section>
      <section class="module-panel" id="agenda"></section>
      <section class="module-panel" id="propiedades"></section>
      <section class="module-panel" id="equipo"></section>
    </section>
  </main>`;
}

function setMobileNavigation(open: boolean): void {
  document.body.classList.toggle('mobile-nav-open', open);
  document.querySelector<HTMLButtonElement>('[data-mobile-nav-toggle]')?.setAttribute('aria-expanded', String(open));
  const backdrop = document.querySelector<HTMLElement>('.sidebar-backdrop');
  if (backdrop) backdrop.hidden = !open;
}

function showNotice(message: string): void {
  const notice = document.querySelector<HTMLElement>('#notice');
  if (!notice) return;
  notice.textContent = message;
  notice.hidden = false;
  window.setTimeout(() => { notice.hidden = true; }, 4500);
}

function allowedModules(): ModuleId[] {
  return modules.map(([id]) => id).filter((id) => canAccessModule(id));
}

function ensureActiveModule(): void {
  const allowed = allowedModules();
  if (!allowed.includes(state.activeModule)) state.activeModule = allowed[0] ?? 'crm';
}

function render(): void {
  ensureActiveModule();
  renderMvpLeads(qs<HTMLElement>('#crm'));
  renderMvpConversations(qs<HTMLElement>('#whatsapp'));
  renderAgenda(qs<HTMLElement>('#agenda'));
  renderMvpProperties(qs<HTMLElement>('#propiedades'));
  renderMvpUsers(qs<HTMLElement>('#equipo'));
  renderAccountMenu();
  modules.forEach(([id]) => {
    const allowed = canAccessModule(id);
    const panel = qs<HTMLElement>(`#${id}`);
    const button = document.querySelector<HTMLButtonElement>(`[data-module="${id}"]`);
    button?.toggleAttribute('hidden', !allowed);
    panel.classList.toggle('active', allowed && id === state.activeModule);
    button?.classList.toggle('active', allowed && id === state.activeModule);
    if (allowed && id === state.activeModule) button?.setAttribute('aria-current', 'page');
    else button?.removeAttribute('aria-current');
  });
}

function removeItem(collection: string, id: number): void {
  if (collection === 'clients') {
    state.crm.clients = state.crm.clients.filter((item) => item.id !== id);
    state.crm.conversations = state.crm.conversations.filter((item) => item.clientId !== id);
  }
  if (collection === 'properties') {
    state.crm.properties = state.crm.properties.filter((item) => item.id !== id);
    if (state.editingPropertyId === id) state.editingPropertyId = null;
  }
  if (collection === 'reminders') state.crm.reminders = state.crm.reminders.filter((item) => item.id !== id);
  saveData(`Eliminación de ${collection}`);
  render();
}

function bindEvents(): void {
  if (eventsBound) return;
  eventsBound = true;
  installPropertyPhotoUxGuard();
  document.addEventListener('trv-render', render);
  document.addEventListener('propcontrol-cloud-status', (event) => {
    const detail = (event as CustomEvent<{ message?: string }>).detail;
    if (detail?.message) showNotice(detail.message);
    renderAccountMenu();
  });
  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('[data-mobile-nav-toggle]')) { setMobileNavigation(!document.body.classList.contains('mobile-nav-open')); return; }
    if (target.closest('[data-mobile-nav-close]')) { setMobileNavigation(false); return; }
    const module = target.closest<HTMLElement>('[data-module]')?.dataset.module as ModuleId | undefined;
    if (module && canAccessModule(module)) { state.activeModule = module; render(); setMobileNavigation(false); return; }
    const editId = Number(target.closest<HTMLElement>('[data-edit-client]')?.dataset.editClient);
    if (editId) { state.activeModule = 'crm'; state.editingClientId = editId; state.openForms.client = true; render(); return; }
    if (target.closest('[data-cancel-client-edit]')) { state.editingClientId = null; state.openForms.client = false; render(); return; }
    const toggle = target.closest<HTMLElement>('[data-toggle]')?.dataset.toggle;
    if (toggle === 'client-form') { state.editingClientId = null; state.openForms.client = !state.openForms.client; render(); return; }
    if (toggle === 'property-form') { state.editingPropertyId = null; state.openForms.property = !state.openForms.property; render(); return; }
    if (toggle === 'reminder-form') { state.openForms.reminder = !state.openForms.reminder; render(); return; }
    const deleteButton = target.closest<HTMLElement>('[data-delete]');
    const collection = deleteButton?.dataset.delete;
    const id = Number(deleteButton?.dataset.id);
    if (collection && id && window.confirm('¿Eliminar este registro? PropControl guardará una copia local anterior.')) removeItem(collection, id);
  });
  window.addEventListener('resize', () => { if (window.innerWidth > 980) setMobileNavigation(false); });
}

async function bootstrap(): Promise<void> {
  if (isInvitationPage()) {
    await renderInvitationAuth(root);
    return;
  }
  const shortFichaMatch = location.pathname.match(/^\/ficha\/([a-z0-9-]+)\/?$/i);
  if (shortFichaMatch?.[1]) {
    document.title = 'Ficha de propiedad | PropControl';
    root.innerHTML = '<main class="public-page"><div class="public-error"><h1>Cargando ficha…</h1><p>Un momento.</p></div></main>';
    try {
      renderPublicMode(root, await loadPublicPropertyFicha(shortFichaMatch[1].toLowerCase()));
    } catch {
      renderPublicMode(root, null);
    }
    return;
  }
  if (location.hash.startsWith('#public=')) {
    renderPublicMode(root, decodePublicFicha(location.hash.slice('#public='.length)));
    return;
  }
  if (!hasAuthenticatedSession()) {
    if (!isLoginPage() && !isRegisterPage()) history.replaceState(null, '', '/login');
    renderPublicAuth(root);
    return;
  }
  if (isLoginPage() || isRegisterPage()) history.replaceState(null, '', '/');
  try {
    await hydrateAuthenticatedSession();
    renderShell();
    bindEvents();
    render();
  } catch (error) {
    renderShell();
    bindEvents();
    render();
    showNotice(error instanceof Error ? error.message : 'No se pudo cargar la cuenta.');
  }
}

void bootstrap();
