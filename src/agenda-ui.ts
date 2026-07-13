import { buildAgendaItems, groupAgendaItems, todayIsoDate, type AgendaItem, type AgendaUrgency } from './agenda.js';
import { saveData, state } from './store.js';
import { escapeHtml, field, formValues, nextId } from './utils.js';

const dateFormatter = new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
const sectionLabels: Record<AgendaUrgency, { eyebrow: string; title: string; empty: string }> = {
  overdue: { eyebrow: 'Acción inmediata', title: 'Vencidos', empty: 'No hay seguimientos vencidos.' },
  today: { eyebrow: 'Prioridad del día', title: 'Para hoy', empty: 'No hay acciones programadas para hoy.' },
  upcoming: { eyebrow: 'Próximas acciones', title: 'Próximos', empty: 'No hay seguimientos futuros programados.' },
};

function formattedDate(value: string): string {
  return dateFormatter.format(new Date(`${value}T00:00:00Z`));
}

function sourceBadge(item: AgendaItem): string {
  return item.source === 'client' ? 'Cliente' : 'Recordatorio';
}

function itemAction(item: AgendaItem): string {
  if (item.source === 'client') {
    return `<button type="button" class="secondary agenda-open-client" data-edit-client="${item.sourceId}">Abrir cliente</button>`;
  }
  return `<button type="button" class="delete" data-delete="reminders" data-id="${item.sourceId}" aria-label="Eliminar ${escapeHtml(item.title)}">×</button>`;
}

function renderAgendaItem(item: AgendaItem): string {
  return `<article class="agenda-card ${item.urgency}">
    <div class="agenda-card-content">
      <div class="agenda-card-header"><span class="agenda-source">${sourceBadge(item)}</span><time datetime="${item.date}">${escapeHtml(formattedDate(item.date))}</time></div>
      <h3>${escapeHtml(item.title)}</h3>
      <p>${escapeHtml(item.detail)}</p>
      <small>${escapeHtml(item.secondary)}</small>
    </div>
    <div class="record-actions">${itemAction(item)}</div>
  </article>`;
}

function renderAgendaSection(urgency: AgendaUrgency, items: AgendaItem[]): string {
  const labels = sectionLabels[urgency];
  return `<section class="agenda-section ${urgency}">
    <div class="agenda-section-heading"><div><span class="eyebrow">${labels.eyebrow}</span><h3>${labels.title}</h3></div><strong>${items.length}</strong></div>
    <div class="agenda-list">${items.map(renderAgendaItem).join('') || `<p class="empty-state">${labels.empty}</p>`}</div>
  </section>`;
}

export function renderAgenda(container: HTMLElement): void {
  const today = todayIsoDate();
  const groups = groupAgendaItems(buildAgendaItems(state.crm.clients, state.crm.reminders, today));
  const total = groups.overdue.length + groups.today.length + groups.upcoming.length;

  container.innerHTML = `<div class="panel-heading"><div><span class="eyebrow">Agenda comercial</span><h2>Seguimientos priorizados</h2><p class="panel-description">Primero resolvé lo vencido, después lo de hoy y finalmente prepará las próximas acciones.</p></div><button type="button" data-toggle="reminder-form">Nuevo recordatorio</button></div>
  <form id="reminder-form" class="data-form ${state.openForms.reminder ? '' : 'collapsed'}">
    <input name="date" aria-label="Fecha" type="date" required>
    <input name="title" aria-label="Tarea" placeholder="Tarea" required>
    <input name="related" aria-label="Cliente o propiedad" placeholder="Cliente o propiedad" required>
    <select name="priority" aria-label="Prioridad"><option>Alta</option><option>Media</option><option>Baja</option></select>
    <button type="submit">Guardar recordatorio</button>
  </form>
  <div class="agenda-summary">
    <article class="overdue"><span>Vencidos</span><strong>${groups.overdue.length}</strong></article>
    <article class="today"><span>Para hoy</span><strong>${groups.today.length}</strong></article>
    <article class="upcoming"><span>Próximos</span><strong>${groups.upcoming.length}</strong></article>
    <article><span>Total priorizado</span><strong>${total}</strong></article>
  </div>
  <div class="agenda-board">
    ${renderAgendaSection('overdue', groups.overdue)}
    ${renderAgendaSection('today', groups.today)}
    ${renderAgendaSection('upcoming', groups.upcoming)}
  </div>`;

  container.querySelector<HTMLFormElement>('#reminder-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const values = formValues(event.currentTarget as HTMLFormElement);
    state.crm.reminders.push({
      id: nextId(state.crm.reminders),
      date: field(values, 'date'),
      title: field(values, 'title').trim(),
      related: field(values, 'related').trim(),
      priority: field(values, 'priority'),
    });
    state.openForms.reminder = false;
    saveData();
    document.dispatchEvent(new CustomEvent('trv-render'));
  });
}
