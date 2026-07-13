import type {
  ActivityEntry,
  Client,
  ModuleId,
  Property,
  Reminder,
  TeamMember,
  WhatsAppConversation,
} from './models.js';
import { modules } from './models.js';
import { state } from './store.js';

export function activeMember(): TeamMember {
  return state.crm.teamMembers.find((member) => member.id === state.activeMemberId)
    ?? state.crm.teamMembers.find((member) => member.role === 'Dueño')
    ?? state.crm.teamMembers[0]!;
}

export function memberName(memberId: number | undefined): string {
  if (!memberId) return 'Sin responsable';
  return state.crm.teamMembers.find((member) => member.id === memberId)?.name ?? 'Usuario inactivo';
}

export function canManageTeam(member = activeMember()): boolean {
  return member.role === 'Dueño' || member.role === 'Administrador';
}

export function canViewAll(member = activeMember()): boolean {
  return member.role === 'Dueño' || member.role === 'Administrador';
}

export function canAccessModule(module: ModuleId, member = activeMember()): boolean {
  if (member.role !== 'Corredor') return true;
  return !['reportes', 'configuracion'].includes(module);
}

export function accessibleModules(): Array<[ModuleId, string]> {
  return modules.filter(([module]) => canAccessModule(module));
}

function visibleByAssignment<T extends { assignedToId?: number }>(items: T[]): T[] {
  const member = activeMember();
  return canViewAll(member) ? items : items.filter((item) => item.assignedToId === member.id);
}

export function visibleClients(): Client[] { return visibleByAssignment(state.crm.clients); }
export function visibleProperties(): Property[] { return visibleByAssignment(state.crm.properties); }
export function visibleReminders(): Reminder[] { return visibleByAssignment(state.crm.reminders); }
export function visibleConversations(): WhatsAppConversation[] { return visibleByAssignment(state.crm.conversations); }

export function defaultAssigneeId(): number {
  return activeMember().id;
}

export function activeSeatCount(): number {
  return state.crm.teamMembers.filter((member) => member.status !== 'Suspendido').length;
}

export function hasSeatAvailable(): boolean {
  const limit = state.crm.organization.seatLimit;
  return limit === null || activeSeatCount() < limit;
}

export function workload(memberId: number): { clients: number; properties: number; conversations: number; tasks: number; unread: number } {
  return {
    clients: state.crm.clients.filter((item) => item.assignedToId === memberId).length,
    properties: state.crm.properties.filter((item) => item.assignedToId === memberId).length,
    conversations: state.crm.conversations.filter((item) => item.assignedToId === memberId).length,
    tasks: state.crm.reminders.filter((item) => item.assignedToId === memberId).length,
    unread: state.crm.conversations.filter((item) => item.assignedToId === memberId).reduce((sum, item) => sum + item.unread, 0),
  };
}

export function addActivity(entry: Omit<ActivityEntry, 'id' | 'createdAt' | 'actorId'>): void {
  const id = Math.max(0, ...state.crm.activityLog.map((item) => item.id)) + 1;
  state.crm.activityLog.unshift({
    ...entry,
    id,
    actorId: activeMember().id,
    createdAt: new Date().toISOString(),
  });
  state.crm.activityLog = state.crm.activityLog.slice(0, 250);
}

export function ensureAccessibleModule(): void {
  if (!canAccessModule(state.activeModule)) state.activeModule = 'inicio';
}
