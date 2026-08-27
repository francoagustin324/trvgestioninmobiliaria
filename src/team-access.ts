import { resolveHumanIdentity } from './human-identity.js';
import type {
  ActivityEntry,
  Client,
  ModuleId,
  Property,
  Reminder,
  TeamMember,
  TeamRole,
  WhatsAppConversation,
} from './models.js';
import { modules } from './models.js';
import { state } from './store.js';
import { newSyncRecordMetadata } from './sync-identity.js';
import {
  activeMembers,
  assignmentVisible,
  roleCanAccessModule,
  roleCanManageTeam,
  roleCanViewAll,
  seatAvailable,
} from './team-policy.js';

export function activeMember(): TeamMember {
  return state.crm.teamMembers.find((member) => member.id === state.activeMemberId)
    ?? state.crm.teamMembers.find((member) => member.role === 'Dueño')
    ?? state.crm.teamMembers[0]!;
}

export function memberName(memberId: number | undefined): string {
  if (!memberId) return 'Sin responsable';
  const member = state.crm.teamMembers.find((item) => item.id === memberId);
  if (!member) return 'Usuario inactivo';
  const identity = resolveHumanIdentity({
    member,
    profileName: member.id === state.activeMemberId ? state.crm.settings.profileName : '',
    profileEmail: member.id === state.activeMemberId ? state.crm.settings.profileEmail : '',
    organizationName: state.crm.organization.name,
    organizationId: state.crm.organization.id,
  });
  return identity.valid ? identity.fullName : 'Nombre sin configurar';
}

export function canManageTeam(member = activeMember()): boolean {
  return roleCanManageTeam(member.role);
}

export function canViewAll(member = activeMember()): boolean {
  return roleCanViewAll(member.role);
}

export function canAccessModule(module: ModuleId, member = activeMember()): boolean {
  return roleCanAccessModule(member.role, module);
}

/**
 * Capacidades administrativas compuestas a partir de la política de roles existente.
 * Ninguna interfaz debe volver a interpretar Dueño/Administrador/Corredor por su cuenta.
 */
export function canAccessSettings(member = activeMember()): boolean {
  return canAccessModule('configuracion', member);
}

export function canAdministerTeam(member = activeMember()): boolean {
  return canManageTeam(member) && canAccessModule('equipo', member);
}

export function canUseRecovery(member = activeMember()): boolean {
  return canManageTeam(member) && canAccessSettings(member);
}

export function canInviteTeamRole(role: Exclude<TeamRole, 'Dueño'>, member = activeMember()): boolean {
  return canAdministerTeam(member) && (member.role === 'Dueño' || role === 'Corredor');
}

export function canChangeTeamMemberRole(target: TeamMember, member = activeMember()): boolean {
  return canAdministerTeam(member) && member.role === 'Dueño' && target.role !== 'Dueño';
}

export function canChangeTeamMemberStatus(target: TeamMember, member = activeMember()): boolean {
  return canAdministerTeam(member)
    && target.role !== 'Dueño'
    && (member.role === 'Dueño' || target.role === 'Corredor');
}

export function accessibleModules(): Array<[ModuleId, string]> {
  return modules.filter(([module]) => canAccessModule(module));
}

function visibleByAssignment<T extends { assignedToId?: number }>(items: T[]): T[] {
  const member = activeMember();
  return items.filter((item) => assignmentVisible(member.role, member.id, item.assignedToId));
}

export function visibleClients(): Client[] { return visibleByAssignment(state.crm.clients); }
export function visibleProperties(): Property[] { return visibleByAssignment(state.crm.properties); }
export function visibleReminders(): Reminder[] { return visibleByAssignment(state.crm.reminders); }
export function visibleConversations(): WhatsAppConversation[] { return visibleByAssignment(state.crm.conversations); }

export function defaultAssigneeId(): number {
  return activeMember().id;
}

export function activeSeatCount(): number {
  return activeMembers(state.crm.teamMembers).length;
}

export function hasSeatAvailable(): boolean {
  return seatAvailable(state.crm.teamMembers, state.crm.organization.seatLimit);
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
    ...newSyncRecordMetadata(entry.operationId),
    id,
    actorId: activeMember().id,
    createdAt: new Date().toISOString(),
  });
  state.crm.activityLog = state.crm.activityLog.slice(0, 250);
}

export function ensureAccessibleModule(): void {
  if (!canAccessModule(state.activeModule)) state.activeModule = 'inicio';
}
