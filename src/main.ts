import { FichaMode, LOGO_PATH, ModuleId, modules } from './models.js';
import { renderHome, renderClients, renderProperties } from './crm-ui.js';
import { handleFichaAction, renderFichas, setFichaMode } from './fichas-ui.js';
import { decodePublicFicha, renderPublicMode } from './public-ficha.js';
import { saveData, state } from './store.js';
import { escapeHtml, field, formValues, nextId, qs } from './utils.js';

const root = qs<HTMLElement>('#root');

function renderShell(): void {
  root.innerHTML = `<main class="premium-shell"><aside class="premium-sidebar"><div class="brand"><img src="${LOGO_PATH}" alt="TRV"><div><strong>TRV CRM</strong><span>Gestión inmobiliaria</span></div></div><nav>${modules.map(([id, label]) => `<button class="nav-button" data-module="${id}">${label}</button>`).join('')}</nav><div class="sidebar-card"><b>Semáforo comercial</b><p>Priorizá clientes y seguimientos con criterio comercial.</p></div></aside><section class="premium-content"><header class="topbar"><div><span class="eyebrow">TRV Gestión Inmobiliaria</span><h1 id="module-title">Inicio</h1></div><span class="status-badge">TypeScript · Railway</span></header><div id="notice" class="notice" hidden></div><section class="module-panel" id="inicio"></section><section class="module-panel" id="crm"></section><section class="module-panel" id="propiedades"></section><section class="module-panel" id="fichas"></section><section class="module-panel" id="whatsapp"></section><section class="module-panel" id="agenda"></section><section class="module-panel" id="reportes"></section><section class="module-panel" id="configuracion"></section></section></main>`;
}

function renderSimple(): void {
  qs<HTMLElement>('#whatsapp').innerHTML = '<div class="empty-module"><span class="eyebrow">WhatsApp + IA</span><h2>Próxima etapa</h2><p>La estructura queda preparada para integración oficial y respuestas sugeridas.</p></div>';
  qs<HTMLElement>('#agenda').innerHTML = `<div class="panel-heading"><div><span class="eyebrow">Agenda</span><h2>Seguimientos</h2></div><button data-toggle="reminder-form">Nuevo recordatorio</button></div><form id="reminder-form" class="data-form ${state.openForms.reminder ? '' : 'collapsed'}"><input name="date" type="date" required><input name="title" placeholder="Tarea" required><input name="related" placeholder="Cliente o propiedad" required><select name="priority"><option>Alta</option><option>Media</option><option>Baja</option></select><button type="submit">Guardar</button></form><div class="card-list">${state.crm.reminders.map((reminder) => `<article class="crm-card"><div><time>${escapeHtml(reminder.date)}</time><h3>${escapeHtml(reminder.title)}</h3><p>${escapeHtml(reminder.related)}</p></div><button class="delete" data-delete="reminders" data-id="${reminder.id}">×</button></article>`).join('')}</div>`;
  qs<HTMLElement>('#reportes').innerHTML = `<div class="metric-grid"><article><span>Leads</span><strong>${state.crm.clients.length}</strong></article><article><span>Calientes</span><strong>${state.crm.clients.filter((item) => item.temperature === 'Caliente').length}</strong></article><article><span>Fichas</span><strong>${state.crm.fichas.length}</strong></article><article><span>Propiedades</span><strong>${state.crm.properties.length}</strong></article></div>`;
  qs<HTMLElement>('#configuracion').innerHTML = `<div class="settings-grid"><label>Inmobiliaria<input value="TRV Gestión Inmobiliaria" readonly></label><label>WhatsApp<input value="3515110069" readonly></label><label>Logo<img src="${LOGO_PATH}" alt="TRV"></label><label>Color principal<input type="color" value="#06364a"></label></div>`;
  document.querySelector<HTMLFormElement>('#reminder-form')?.addEventListener('submit', (event) => {
    event.preventDefault(); const values = formValues(event.currentTarget as HTMLFormElement);
    state.crm.reminders.push({ id: nextId(state.crm.reminders), date: field(values, 'date'), title: field(values, 'title'), related: field(values, 'related'), priority: field(values, 'priority') });
    state.openForms.reminder = false; saveData(); document.dispatchEvent(new CustomEvent('trv-render'));
  });
}

function render(): void {
  renderHome(qs<HTMLElement>('#inicio')); renderClients(qs<HTMLElement>('#crm')); renderProperties(qs<HTMLElement>('#propiedades')); renderFichas(qs<HTMLElement>('#fichas')); renderSimple();
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

if (location.hash.startsWith('#public=')) {
  renderPublicMode(root, decodePublicFicha(location.hash.slice('#public='.length)));
} else {
  renderShell(); render();
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
