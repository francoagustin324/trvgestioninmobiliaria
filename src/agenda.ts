import type { Client, Reminder } from './models.js';

export type AgendaUrgency = 'overdue' | 'today' | 'upcoming';
export type AgendaSource = 'client' | 'reminder';

export interface AgendaItem {
  id: string;
  source: AgendaSource;
  sourceId: number;
  date: string;
  urgency: AgendaUrgency;
  title: string;
  detail: string;
  secondary: string;
  priority: number;
}

export interface AgendaGroups {
  overdue: AgendaItem[];
  today: AgendaItem[];
  upcoming: AgendaItem[];
}

const urgencyOrder: Record<AgendaUrgency, number> = { overdue: 0, today: 1, upcoming: 2 };
const reminderPriority: Record<string, number> = { Alta: 0, Media: 1, Baja: 2 };
const clientPriority: Record<Client['temperature'], number> = { Caliente: 0, Tibio: 1, Frío: 2 };

export function todayIsoDate(value = new Date()): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function isValidIsoDate(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [yearText, monthText, dayText] = value.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function agendaUrgency(date: string, today: string): AgendaUrgency {
  if (date < today) return 'overdue';
  if (date === today) return 'today';
  return 'upcoming';
}

function terminalClient(client: Client): boolean {
  return client.status === 'Cerrado' || client.pipeline === 'Cerrado' || client.pipeline === 'Perdido';
}

export function buildAgendaItems(clients: Client[], reminders: Reminder[], today = todayIsoDate()): AgendaItem[] {
  const clientItems = clients.flatMap<AgendaItem>((client) => {
    if (terminalClient(client) || !isValidIsoDate(client.nextFollowUp)) return [];
    const budget = client.budget?.trim();
    return [{
      id: `client-${client.id}`,
      source: 'client',
      sourceId: client.id,
      date: client.nextFollowUp,
      urgency: agendaUrgency(client.nextFollowUp, today),
      title: client.name,
      detail: client.interest,
      secondary: [client.phone, budget].filter(Boolean).join(' · '),
      priority: clientPriority[client.temperature],
    }];
  });

  const reminderItems = reminders.flatMap<AgendaItem>((reminder) => {
    if (!isValidIsoDate(reminder.date)) return [];
    return [{
      id: `reminder-${reminder.id}`,
      source: 'reminder',
      sourceId: reminder.id,
      date: reminder.date,
      urgency: agendaUrgency(reminder.date, today),
      title: reminder.title,
      detail: reminder.related,
      secondary: `Recordatorio · ${reminder.priority || 'Sin prioridad'}`,
      priority: reminderPriority[reminder.priority] ?? 3,
    }];
  });

  return [...clientItems, ...reminderItems].sort((left, right) => (
    urgencyOrder[left.urgency] - urgencyOrder[right.urgency]
    || left.date.localeCompare(right.date)
    || left.priority - right.priority
    || left.title.localeCompare(right.title, 'es')
  ));
}

export function groupAgendaItems(items: AgendaItem[]): AgendaGroups {
  return items.reduce<AgendaGroups>((groups, item) => {
    groups[item.urgency].push(item);
    return groups;
  }, { overdue: [], today: [], upcoming: [] });
}
