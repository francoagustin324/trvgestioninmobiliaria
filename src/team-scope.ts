import { saveData, state } from './store.js';
import { activeMember, addActivity, canViewAll, visibleClients, visibleConversations, visibleProperties, visibleReminders } from './team-access.js';

let applying = false;

function claimUnassignedRecords(): boolean {
  const member = activeMember();
  let changed = false;
  const assign = <T extends { id: number; assignedToId?: number; createdById?: number }>(items: T[], type: 'Cliente' | 'Propiedad' | 'Conversación' | 'Tarea'): void => {
    items.forEach((item) => {
      if (item.assignedToId) return;
      item.assignedToId = member.id;
      item.createdById ??= member.id;
      addActivity({ action: 'Asignación automática', entityType: type, entityId: item.id, detail: `${type} #${item.id} quedó a cargo de ${member.name}.` });
      changed = true;
    });
  };
  assign(state.crm.clients, 'Cliente');
  assign(state.crm.properties, 'Propiedad');
  assign(state.crm.reminders, 'Tarea');
  state.crm.conversations.forEach((conversation) => {
    if (conversation.assignedToId) return;
    const client = state.crm.clients.find((item) => item.id === conversation.clientId);
    conversation.assignedToId = client?.assignedToId ?? member.id;
    conversation.createdById ??= member.id;
    addActivity({ action: 'Asignación automática', entityType: 'Conversación', entityId: conversation.id, detail: `Conversación #${conversation.id} quedó a cargo de ${member.name}.` });
    changed = true;
  });
  return changed;
}

function hideCard(card: HTMLElement, visible: boolean): void {
  card.hidden = !visible;
}

function scopeClients(): void {
  if (canViewAll()) return;
  const ids = new Set(visibleClients().map((item) => item.id));
  document.querySelectorAll<HTMLElement>('.crm-card').forEach((card) => {
    const id = Number(card.querySelector<HTMLElement>('[data-edit-client]')?.dataset.editClient);
    hideCard(card, ids.has(id));
  });
  const count = document.querySelector<HTMLElement>('#client-result-count');
  if (count) count.textContent = `${ids.size} clientes asignados`;
  document.querySelector<HTMLElement>('.duplicate-audit')?.setAttribute('hidden', 'true');
}

function scopeProperties(): void {
  if (canViewAll()) return;
  const ids = new Set(visibleProperties().map((item) => item.id));
  document.querySelectorAll<HTMLElement>('.property-card').forEach((card) => {
    const id = Number(card.querySelector<HTMLElement>('[data-delete="properties"]')?.dataset.id);
    hideCard(card, ids.has(id));
  });
}

function scopeAgenda(): void {
  if (canViewAll()) return;
  const clientIds = new Set(visibleClients().map((item) => item.id));
  const reminderIds = new Set(visibleReminders().map((item) => item.id));
  document.querySelectorAll<HTMLElement>('.agenda-card').forEach((card) => {
    const clientId = Number(card.querySelector<HTMLElement>('[data-edit-client]')?.dataset.editClient);
    const reminderId = Number(card.querySelector<HTMLElement>('[data-delete="reminders"]')?.dataset.id);
    hideCard(card, clientId ? clientIds.has(clientId) : reminderIds.has(reminderId));
  });
  const summaries = document.querySelectorAll<HTMLElement>('.agenda-summary article strong');
  const visibleCards = [...document.querySelectorAll<HTMLElement>('.agenda-card')].filter((card) => !card.hidden);
  const values = [
    visibleCards.filter((card) => card.classList.contains('overdue')).length,
    visibleCards.filter((card) => card.classList.contains('today')).length,
    visibleCards.filter((card) => card.classList.contains('upcoming')).length,
    visibleCards.length,
  ];
  summaries.forEach((summary, index) => { if (values[index] !== undefined) summary.textContent = String(values[index]); });
}

function scopeWhatsApp(): void {
  if (canViewAll()) return;
  const ids = new Set(visibleConversations().map((item) => item.id));
  document.querySelectorAll<HTMLElement>('[data-wa-select]').forEach((thread) => hideCard(thread, ids.has(Number(thread.dataset.waSelect))));
  document.querySelector<HTMLElement>('.audit-overview')?.setAttribute('hidden', 'true');
}

function scopeDashboard(): void {
  if (canViewAll()) return;
  const clients = visibleClients();
  const properties = visibleProperties();
  const reminders = visibleReminders();
  const metrics = document.querySelectorAll<HTMLElement>('#inicio .metric-grid article strong');
  const today = new Date().toISOString().slice(0, 10);
  const values = [
    clients.length,
    clients.filter((item) => item.temperature === 'Caliente').length,
    clients.filter((item) => item.pipeline === 'Visita posible').length,
    reminders.filter((item) => item.date < today).length,
    properties.filter((item) => item.status !== 'Cerrada').length,
  ];
  metrics.forEach((metric, index) => { if (values[index] !== undefined) metric.textContent = String(values[index]); });
  const names = new Set(clients.map((item) => item.name));
  document.querySelectorAll<HTMLElement>('#inicio .mini-alert').forEach((alert) => hideCard(alert, names.has(alert.querySelector('b')?.textContent ?? '')));
}

function applyScope(): void {
  if (applying) return;
  applying = true;
  try {
    if (claimUnassignedRecords()) saveData();
    scopeClients();
    scopeProperties();
    scopeAgenda();
    scopeWhatsApp();
    scopeDashboard();
  } finally {
    applying = false;
  }
}

const observer = new MutationObserver(() => window.requestAnimationFrame(applyScope));

function initialize(): void {
  applyScope();
  const root = document.querySelector('#root');
  if (root) observer.observe(root, { childList: true, subtree: true });
  document.addEventListener('trv-render', () => window.requestAnimationFrame(applyScope));
}

window.addEventListener('DOMContentLoaded', initialize);
window.setTimeout(initialize, 0);
