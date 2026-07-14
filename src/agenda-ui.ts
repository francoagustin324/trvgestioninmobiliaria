import {
  buildAgendaItems,
  completedReminders,
  daysBetweenIsoDates,
  groupAgendaItems,
  todayIsoDate,
  type AgendaItem,
  type AgendaUrgency,
  type ReminderWithStatus,
} from './agenda.js';
import { saveData, state } from './store.js';
import { escapeHtml, field, formValues, nextId } from './utils.js';

const dateFormatter = new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
const completedFormatter = new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const sectionLabels: Record<AgendaUrgency, { eyebrow: string; title: string; empty: string }> = {
  overdue: { eyebrow: 'Acción inmediata', title: 'Vencidos', empty: 'No hay seguimientos vencidos.' },
  today: { eyebrow: 'Prioridad del día', title: 'Para hoy', empty: 'No hay acciones programadas para hoy.' },
  upcoming: { eyebrow: 'Próximas acciones', title: 'Próximos', empty: 'No hay seguimientos futuros programados.' },
};

let editingReminderId: number | null = null;

function reminderRecords(): ReminderWithStatus[] {
  return state.crm.reminders as ReminderWithStatus[];
}

function formattedDate(value: string): string {
  return dateFormatter.format(new Date(`${value}T00:00:00Z`));
}

function completedDate(value: string | undefined): string {
  if (!value) return 'Sin fecha';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Sin fecha' : completedFormatter.format(date);
}

function relativeDateLabel(item: AgendaItem, today: string): string {
  const days = daysBetweenIsoDates(today, item.date);
  if (days < 0) return `Vencido hace ${Math.abs(days)} ${Math.abs(days) === 1 ? 'día' : 'días'}`;
  if (days === 0) return 'Para hoy';
  if (days === 1) return 'Para mañana';
  return `En ${days} días`;
}

function sourceBadge(item: AgendaItem): string {
  return item.source === 'client' ? 'Lead' : 'Recordatorio';
}

function reprogramControl(item: AgendaItem): string {
  return `<details class="agenda-reprogram">
    <summary>Reprogramar</summary>
    <form data-reprogram-source="${item.source}" data-reprogram-id="${item.sourceId}">
      <label>Nueva fecha<input name="date" type="date" value="${item.date}" required></label>
      <button type="submit">Guardar fecha</button>
    </form>
  </details>`;
}

function itemActions(item: AgendaItem): string {
  if (item.source === 'client') {
    return `<button type="button" class="secondary" data-complete-agenda="client" data-id="${item.sourceId}">Completar</button>
      ${reprogramControl(item)}
      <button type="button" class="secondary agenda-open-client" data-edit-client="${item.sourceId}">Abrir lead</button>`;
  }
  return `<button type="button" class="secondary" data-complete-agenda="reminder" data-id="${item.sourceId}">Completar</button>
    ${reprogramControl(item)}
    <button type="button" class="secondary" data-edit-reminder="${item.sourceId}">Editar</button>
    <button type="button" class="delete" data-delete="reminders" data-id="${item.sourceId}" aria-label="Eliminar ${escapeHtml(item.title)}">×</button>`;
}

function renderAgendaItem(item: AgendaItem, today: string): string {
  return `<article class="agenda-card ${item.urgency}">
    <div class="agenda-card-content">
      <div class="agenda-card-header"><span class="agenda-source">${sourceBadge(item)}</span><time datetime="${item.date}">${escapeHtml(formattedDate(item.date))}</time></div>
      <span class="agenda-relative-date">${escapeHtml(relativeDateLabel(item, today))}</span>
      <h3>${escapeHtml(item.title)}</h3>
      <p>${escapeHtml(item.detail)}</p>
      <small>${escapeHtml(item.secondary)}</small>
    </div>
    <div class="agenda-card-actions">${itemActions(item)}</div>
  </article>`;
}

function renderAgendaSection(urgency: AgendaUrgency, items: AgendaItem[], today: string): string {
  const labels = sectionLabels[urgency];
  return `<section class="agenda-section ${urgency}">
    <div class="agenda-section-heading"><div><span class="eyebrow">${labels.eyebrow}</span><h3>${labels.title}</h3></div><strong>${items.length}</strong></div>
    <div class="agenda-list">${items.map((item) => renderAgendaItem(item, today)).join('') || `<p class="empty-state">${labels.empty}</p>`}</div>
  </section>`;
}

function renderCompletedReminder(reminder: ReminderWithStatus): string {
  return `<article class="agenda-completed-card">
    <div><span>Completado ${escapeHtml(completedDate(reminder.completedAt))}</span><h4>${escapeHtml(reminder.title)}</h4><p>${escapeHtml(reminder.related)}</p></div>
    <button type="button" class="secondary" data-reopen-reminder="${reminder.id}">Reabrir</button>
  </article>`;
}

function reminderForm(editing: ReminderWithStatus | null, today: string): string {
  const date = editing?.date || today;
  const title = editing?.title || '';
  const related = editing?.related || '';
  const priority = editing?.priority || 'Media';
  return `<form id="reminder-form" class="data-form agenda-form ${state.openForms.reminder ? '' : 'collapsed'}">
    <div class="agenda-form-heading"><strong>${editing ? 'Editar seguimiento' : 'Nuevo seguimiento'}</strong><button type="button" class="quiet-button" data-cancel-reminder>Cerrar</button></div>
    <label>Fecha<input name="date" type="date" value="${escapeHtml(date)}" required></label>
    <label>Tarea<input name="title" value="${escapeHtml(title)}" placeholder="Ej. Llamar para confirmar visita" required></label>
    <label>Lead o propiedad<input name="related" value="${escapeHtml(related)}" placeholder="Ej. Cliente Docta" required></label>
    <label>Prioridad<select name="priority"><option${priority === 'Alta' ? ' selected' : ''}>Alta</option><option${priority === 'Media' ? ' selected' : ''}>Media</option><option${priority === 'Baja' ? ' selected' : ''}>Baja</option></select></label>
    <button type="submit">${editing ? 'Guardar cambios' : 'Guardar seguimiento'}</button>
  </form>`;
}

function saveAndRender(reason: string): void {
  saveData(reason);
  document.dispatchEvent(new CustomEvent('trv-render'));
}

function focusReminderForm(container: HTMLElement): void {
  window.requestAnimationFrame(() => {
    const form = container.querySelector<HTMLFormElement>('#reminder-form:not(.collapsed)');
    if (!form) return;
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    form.querySelector<HTMLInputElement>('input[name="date"]')?.focus({ preventScroll: true });
  });
}

export function renderAgenda(container: HTMLElement): void {
  const today = todayIsoDate();
  const groups = groupAgendaItems(buildAgendaItems(state.crm.clients, state.crm.reminders, today));
  const completed = completedReminders(state.crm.reminders);
  const total = groups.overdue.length + groups.today.length + groups.upcoming.length;
  const editing = editingReminderId === null ? null : reminderRecords().find((reminder) => reminder.id === editingReminderId) ?? null;

  container.innerHTML = `<div class="panel-heading"><div><span class="eyebrow">Agenda comercial</span><h2>Seguimientos</h2><p class="panel-description">Resolvé primero los vencidos, completá cada gestión y reprogramá el próximo contacto sin perder información.</p></div><button type="button" data-toggle="reminder-form">Nuevo seguimiento</button></div>
  ${reminderForm(editing, today)}
  <div class="agenda-summary">
    <article class="overdue"><span>Vencidos</span><strong>${groups.overdue.length}</strong></article>
    <article class="today"><span>Para hoy</span><strong>${groups.today.length}</strong></article>
    <article class="upcoming"><span>Próximos</span><strong>${groups.upcoming.length}</strong></article>
    <article class="completed"><span>Completados</span><strong>${completed.length}</strong></article>
  </div>
  <div class="agenda-total-line"><strong>${total}</strong><span>seguimientos activos ordenados por fecha y prioridad</span></div>
  <div class="agenda-board">
    ${renderAgendaSection('overdue', groups.overdue, today)}
    ${renderAgendaSection('today', groups.today, today)}
    ${renderAgendaSection('upcoming', groups.upcoming, today)}
  </div>
  <details class="agenda-completed" ${completed.length ? '' : 'hidden'}>
    <summary>Ver completados (${completed.length})</summary>
    <div class="agenda-completed-list">${completed.map(renderCompletedReminder).join('')}</div>
  </details>`;

  container.querySelector<HTMLFormElement>('#reminder-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const values = formValues(event.currentTarget as HTMLFormElement);
    const existing = editingReminderId === null ? null : reminderRecords().find((reminder) => reminder.id === editingReminderId) ?? null;
    const reminder: ReminderWithStatus = {
      ...(existing || {}),
      id: existing?.id ?? nextId(state.crm.reminders),
      date: field(values, 'date'),
      title: field(values, 'title').trim(),
      related: field(values, 'related').trim(),
      priority: field(values, 'priority'),
      assignedToId: existing?.assignedToId ?? state.activeMemberId,
      createdById: existing?.createdById ?? state.activeMemberId,
      completedAt: undefined,
    };
    if (existing) {
      const index = state.crm.reminders.findIndex((item) => item.id === existing.id);
      if (index >= 0) state.crm.reminders[index] = reminder;
    } else {
      state.crm.reminders.push(reminder);
    }
    editingReminderId = null;
    state.openForms.reminder = false;
    saveAndRender(existing ? 'Seguimiento editado' : 'Seguimiento creado');
  });

  container.querySelectorAll<HTMLButtonElement>('[data-edit-reminder]').forEach((button) => {
    button.addEventListener('click', () => {
      editingReminderId = Number(button.dataset.editReminder);
      state.openForms.reminder = true;
      renderAgenda(container);
      focusReminderForm(container);
    });
  });

  container.querySelector<HTMLElement>('[data-cancel-reminder]')?.addEventListener('click', () => {
    editingReminderId = null;
    state.openForms.reminder = false;
    renderAgenda(container);
  });

  container.querySelectorAll<HTMLButtonElement>('[data-complete-agenda]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = Number(button.dataset.id);
      if (button.dataset.completeAgenda === 'client') {
        const client = state.crm.clients.find((item) => item.id === id);
        if (!client) return;
        client.nextFollowUp = undefined;
        saveAndRender('Seguimiento de lead completado');
        return;
      }
      const reminder = reminderRecords().find((item) => item.id === id);
      if (!reminder) return;
      reminder.completedAt = new Date().toISOString();
      saveAndRender('Seguimiento completado');
    });
  });

  container.querySelectorAll<HTMLFormElement>('[data-reprogram-source]').forEach((form) => {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const source = form.dataset.reprogramSource;
      const id = Number(form.dataset.reprogramId);
      const date = field(formValues(form), 'date');
      if (source === 'client') {
        const client = state.crm.clients.find((item) => item.id === id);
        if (!client) return;
        client.nextFollowUp = date;
      } else {
        const reminder = reminderRecords().find((item) => item.id === id);
        if (!reminder) return;
        reminder.date = date;
        reminder.completedAt = undefined;
      }
      saveAndRender('Seguimiento reprogramado');
    });
  });

  container.querySelectorAll<HTMLButtonElement>('[data-reopen-reminder]').forEach((button) => {
    button.addEventListener('click', () => {
      const reminder = reminderRecords().find((item) => item.id === Number(button.dataset.reopenReminder));
      if (!reminder) return;
      reminder.completedAt = undefined;
      saveAndRender('Seguimiento reabierto');
    });
  });
}
