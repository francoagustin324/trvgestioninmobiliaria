import { FichaMode, ModuleId, modules } from './models.js';
import { AGENCY_BRAND, PRODUCT_BRAND } from './branding.js';
import { authShellHtml, bindAuthUi, initializeCloudSession, renderCloudAccount } from './auth-ui.js';
import { renderHome, renderClients, renderProperties } from './crm-ui.js';
import { handleFichaAction, renderFichas, setFichaMode } from './fichas-ui.js';
import { decodePublicFicha, renderPublicMode } from './public-ficha.js';
import { consumeExtensionImport } from './extension-import-ui.js';
import { renderExtensionInstallHelp } from './extension-install-ui.js';
import { saveData, state } from './store.js';
import { escapeHtml, field, formValues, nextId, qs } from './utils.js';

const root = qs<HTMLElement>('#root');

function renderShell(): void {
  root.innerHTML = `<main class="premium-shell"><aside class="premium-sidebar"><div class="brand"><img class="product-brand-mark" src="${PRODUCT_BRAND.logo}" alt="${PRODUCT_BRAND.name}"><div><strong>${PRODUCT_BRAND.name}</strong><span>${PRODUCT_BRAND.tagline}</span></div></div><nav>${modules.map(([id, label]) => `<button class="nav-button" data-module="${id}">${label}</button>`).join('')}</nav><div class="sidebar-card"><b>${PRODUCT_BRAND.phrase}</b><p>Organizá leads, propiedades, fichas y seguimientos desde un solo lugar.</p></div></aside><section class="premium-content"><header class="topbar"><div class="topbar-brand"><img class="topbar-product-mark" src="${PRODUCT_BRAND.logo}" alt=""><div><span class="eyebrow">${PRODUCT_BRAND.name}</span><h1 id="module-title">Inicio</h1><span class="product-tagline">${PRODUCT_BRAND.tagline}</span></div></div><div id="cloud-account"></div></header><div id="notice" class="notice" hidden></div><section class="module-panel" id="inicio"></section><section class="module-panel" id="crm"></section><section class="module-panel" id="propiedades"></section><section class="module-panel" id="fichas"></section><section class="module-panel" id="whatsapp"></section><section class="module-panel" id="agenda"></section><section class="module-panel" id="reportes"></section><section class="module-panel" id="configuracion"></section></section></main>${authShellHtml()}`;
  renderCloudAccount();
}

function showNotice(message: string): void {
  const notice = qs<HTMLElement>('#notice');
  notice.hidden = false;
  notice.textContent = message;
  window.setTimeout(() => { notice.hidden = true; }, 5000);
}

function renderSimple(): void {
  qs<HTMLElement>('#whatsapp').innerHTML = '<div class="empty-module"><span class="eyebrow">WhatsApp + IA</span><h2>Próxima etapa</h2><p>La estructura queda preparada para integración oficial y respuestas sugeridas.</p></div>';
  qs<HTMLElement>('#agenda').innerHTML = `<div class="panel-heading"><div><span class="eyebrow">Agenda</span><h2>Seguimientos</h2></div><button data-toggle="reminder-form">Nuevo recordatorio</button></div><form id="reminder-form" class="data-form ${state.openForms.reminder ? '' : 'collapsed'}"><input name="date" type="date" required><input name="title" placeholder="Tarea" required><input name="related" placeholder="Cliente o propiedad" required><select name="priority"><option>Alta</option><option>Media</option><option>Baja</option></select><button type="submit">Guardar</button></form><div class="card-list">${state.crm.reminders.map((reminder) => `<article class="crm-card"><div><time>${escapeHtml(reminder.date)}</time><h3>${escapeHtml(reminder.title)}</h3><p>${escapeHtml(reminder.related)}</p></div><button class="delete" data-delete="reminders" data-id="${reminder.id}">×</button></article>`).join('')}</div>`;
  qs<HTMLElement>('#reportes').innerHTML = `<div class="metric-grid"><article><span>Leads</span><strong>${state.crm.clients.length}</strong></article><article><span>Calientes</span><strong>${state.crm.clients.filter((item) => item.temperature === 'Caliente').length}</strong></article><article><span>Fichas</span><strong>${state.crm.fichas.length}</strong></article><article><span>Propiedades</span><strong>${state.crm.properties.length}</strong></article></div>`;
  qs<HTMLElement>('#configuracion').innerHTML = `<div class="settings-grid"><section class="settings-brand-card"><img src="${PRODUCT_BRAND.wordmark}" alt="${PRODUCT_BRAND.name}"><div><span class="eyebrow">Marca del software</span><h3>${PRODUCT_BRAND.name}</h3><p>${PRODUCT_BRAND.tagline}</p><strong>${PRODUCT_BRAND.phrase}</strong><span class="agency-chip">Inmobiliaria configurada: ${AGENCY_BRAND.name}</span></div></section><section class="cloud-settings-card"><span class="eyebrow">Datos protegidos</span><h3>Cuenta y respaldo online</h3><p>Ingresá para usar los mismos clientes, propiedades, agenda y fichas desde distintos dispositivos.</p><div id="cloud-settings-account"></div></section><label>Software<input value="${PRODUCT_BRAND.name}" readonly></label><label>Inmobiliaria<input value="${AGENCY_BRAND.name}" readonly></label><label>WhatsApp público<input value="${AGENCY_BRAND.displayWhatsapp}" readonly></label><label>Marca de las fichas<img src="${AGENCY_BRAND.logo}" alt="${AGENCY_BRAND.name}"></label></div>`;
  const cloudSettings = document.querySelector<HTMLElement>('#cloud-settings-account');
  const topAccount = document.querySelector<HTMLElement>('#cloud-account');
  if (cloudSettings && topAccount) cloudSettings.innerHTML = topAccount.innerHTML;
  document.querySelector<HTMLFormElement>('#reminder-form')?.addEventListener('submit', (event) => {
    event.preventDefault(); const values = formValues(event.currentTarget as HTMLFormElement);
    state.crm.reminders.push({ id: nextId(state.crm.reminders), date: field(values, 'date'), title: field(values, 'title'), related: field(values, 'related'), priority: field(values, 'priority') });
    state.openForms.reminder = false; saveData(); document.dispatchEvent(new CustomEvent('trv-render'));
  });
}

function render(): void {
  renderHome(qs<HTMLElement>('#inicio')); renderClients(qs<HTMLElement>('#crm')); renderProperties(qs<HTMLElement>('#propiedades')); renderFichas(qs<HTMLElement>('#fichas')); renderExtensionInstallHelp(); renderSimple();
  modules.forEach(([id, label]) => {
    qs<HTMLElement>(`#${id}`).classList.toggle('active', id === state.activeModule);
    document.querySelector<HTMLButtonElement>(`[data-module="${id}"]`)?.classList.toggle('active', id === state.activeModule);
    if (id === state.activeModule) qs<HTMLElement>('#module-title').textContent = label;
  });
}

function removeItem(collection: string, id: number): void {
  if (collection === 'clients') state.crm.clients = state.crm.clients.filter((item) => item.id !== id);
  if (collection === 'properties') state.crm.properties = state.crm.properties.filter((item) => item.id !== id);
  if (collection === 'reminders') state.crm.reminders = state.crm.reminders.filter((item) => item.id !== id);
  if (collection === 'fichas') { state.crm.fichas = state.crm.fichas.filter((item) => item.id !== id); if (state.selectedFichaId === id) state.selectedFichaId = state.crm.fichas[0]?.id ?? null; }
  saveData(); render();
}

function bindShellEvents(): void {
  document.addEventListener('trv-render', render);
  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const module = target.dataset.module as ModuleId | undefined;
    if (module) { state.activeModule = module; render(); return; }
    const toggle = target.dataset.toggle;
    if (toggle === 'client-form') state.openForms.client = !state.openForms.client;
    if (toggle === 'property-form') state.openForms.property = !state.openForms.property;
    if (toggle === 'reminder-form') state.openForms.reminder = !state.openForms.reminder;
    if (toggle === 'ficha-form') state.openForms.ficha = !state.openForms.ficha;
    if (toggle) { render(); return; }
    const mode = target.dataset.mode as FichaMode | undefined;
    if (mode) { setFichaMode(mode); return; }
    const collection = target.dataset.delete;
    const id = Number(target.dataset.id);
    if (collection && id) { removeItem(collection, id); return; }
    const action = target.dataset.fichaAction;
    if (action && id) handleFichaAction(action, id);
  });
}

if (location.hash.startsWith('#public=')) {
  renderPublicMode(root, decodePublicFicha(location.hash.slice('#public='.length)));
} else {
  const extensionToken = location.hash.startsWith('#extension-import=') ? location.hash.slice('#extension-import='.length) : '';
  const extensionError = location.hash.startsWith('#extension-error=') ? location.hash.slice('#extension-error='.length) : '';
  renderShell();
  bindShellEvents();
  bindAuthUi(showNotice, render);
  if (extensionToken) {
    state.activeModule = 'fichas';
    state.fichaMode = 'external';
    state.openForms.ficha = true;
  }
  render();
  void initializeCloudSession(showNotice, render);
  if (extensionError) {
    let message = 'La extensión no pudo leer esta publicación.';
    try { message = decodeURIComponent(extensionError); } catch { /* mantener mensaje seguro */ }
    history.replaceState(null, '', `${location.pathname}${location.search}`);
    showNotice(message);
  }
  if (extensionToken) void consumeExtensionImport(extensionToken).catch((error) => {
    history.replaceState(null, '', `${location.pathname}${location.search}`);
    showNotice(error instanceof Error ? error.message : 'No se pudo recibir la propiedad desde la extensión.');
  });
}
