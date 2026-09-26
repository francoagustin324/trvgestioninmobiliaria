import type { TenantScope } from './active-organization.js';
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
import { authenticatedTenantMember, state } from './store.js';
import { newSyncRecordMetadata } from './sync-identity.js';
import {
  activeMembers,
  assignmentVisible,
  roleCanAccessModule,
  roleCanManageTeam,
  roleCanViewAll,
  seatAvailable,
} from './team-policy.js';

/**
 * Miembro seleccionado únicamente para presentación/vista.
 *
 * NO es una fuente de autoridad. No resuelve Dueño ni primer miembro como
 * fallback: si activeMemberId es inválido, la selección visual es inválida.
 */
export function selectedTeamViewMember(): TeamMember | null {
  return state.crm.teamMembers.find(
    (member) => member.id === state.activeMemberId && member.status !== 'Suspendido',
  ) ?? null;
}

/**
 * Compatibilidad histórica para superficies de presentación.
 *
 * Authorization-sensitive code debe usar authenticatedTenantMember()/los
 * helpers can*/visible* de este módulo, nunca activeMember().
 */
export function activeMember(): TeamMember {
  const member = selectedTeamViewMember();
  if (!member) throw new Error('TEAM_VIEW_MEMBER_REQUIRED');
  return member;
}

function authorizedTenantMember(candidate?: TeamMember): TeamMember | null {
  const member = authenticatedTenantMember();
  if (!member) return null;
  // Un actor explícito sólo puede actuar como assertion de identidad, nunca como
  // fuente de autoridad. Un member visual/obsoleto diferente falla cerrado.
  if (candidate && candidate.id !== member.id) return null;
  return member;
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

export function canManageTeam(candidate?: TeamMember): boolean {
  const member = authorizedTenantMember(candidate);
  return Boolean(member && roleCanManageTeam(member.role));
}

export function canViewAll(candidate?: TeamMember): boolean {
  const member = authorizedTenantMember(candidate);
  return Boolean(member && roleCanViewAll(member.role));
}

export function canAccessModule(module: ModuleId, candidate?: TeamMember): boolean {
  const member = authorizedTenantMember(candidate);
  return Boolean(member && roleCanAccessModule(member.role, module));
}

/**
 * Capacidades administrativas compuestas a partir de la política de roles existente.
 * La identidad efectiva siempre se vuelve a resolver desde TenantScope.
 */
export function canAccessSettings(candidate?: TeamMember): boolean {
  return canAccessModule('configuracion', candidate);
}

export function canAdministerTeam(candidate?: TeamMember): boolean {
  return canManageTeam(candidate) && canAccessModule('equipo', candidate);
}

/**
 * Recovery es authorization-sensitive y siempre queda ligado al miembro ACTIVE
 * exacto del usuario del TenantScope actual.
 */
export function canUseRecovery(): boolean {
  const member = authenticatedTenantMember();
  return Boolean(
    member
    && roleCanManageTeam(member.role)
    && roleCanAccessModule(member.role, 'configuracion'),
  );
}

export function canInviteTeamRole(role: Exclude<TeamRole, 'Dueño'>, candidate?: TeamMember): boolean {
  const member = authorizedTenantMember(candidate);
  return Boolean(
    member
    && roleCanManageTeam(member.role)
    && roleCanAccessModule(member.role, 'equipo')
    && (member.role === 'Dueño' || role === 'Corredor'),
  );
}

export function canChangeTeamMemberRole(target: TeamMember, candidate?: TeamMember): boolean {
  const member = authorizedTenantMember(candidate);
  return Boolean(
    member
    && roleCanManageTeam(member.role)
    && roleCanAccessModule(member.role, 'equipo')
    && member.role === 'Dueño'
    && target.role !== 'Dueño',
  );
}

export function canChangeTeamMemberStatus(target: TeamMember, candidate?: TeamMember): boolean {
  const member = authorizedTenantMember(candidate);
  return Boolean(
    member
    && roleCanManageTeam(member.role)
    && roleCanAccessModule(member.role, 'equipo')
    && target.role !== 'Dueño'
    && (member.role === 'Dueño' || target.role === 'Corredor'),
  );
}

export function accessibleModules(): Array<[ModuleId, string]> {
  return modules.filter(([module]) => canAccessModule(module));
}

function visibleByAssignment<T extends { assignedToId?: number }>(items: T[]): T[] {
  const member = authorizedTenantMember();
  if (!member) return [];
  return items.filter((item) => assignmentVisible(member.role, member.id, item.assignedToId));
}

export function visibleClients(): Client[] { return visibleByAssignment(state.crm.clients); }
export function visibleProperties(): Property[] { return visibleByAssignment(state.crm.properties); }
export function visibleReminders(): Reminder[] { return visibleByAssignment(state.crm.reminders); }
export function visibleConversations(): WhatsAppConversation[] { return visibleByAssignment(state.crm.conversations); }

export function defaultAssigneeId(): number {
  const member = authorizedTenantMember();
  if (!member) throw new Error('AUTHENTICATED_TENANT_MEMBER_REQUIRED');
  return member.id;
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

type NewActivityEntry = Omit<ActivityEntry, 'id' | 'createdAt' | 'actorId'>;

function appendActivity(entry: NewActivityEntry, actorId: number): void {
  const id = Math.max(0, ...state.crm.activityLog.map((item) => item.id)) + 1;
  state.crm.activityLog.unshift({
    ...entry,
    ...newSyncRecordMetadata(entry.operationId),
    id,
    actorId,
    createdAt: new Date().toISOString(),
  });
  state.crm.activityLog = state.crm.activityLog.slice(0, 250);
}

export function addActivityForAuthenticatedTenant(scope: TenantScope, entry: NewActivityEntry): void {
  const member = authenticatedTenantMember(scope);
  const matches = state.crm.teamMembers.filter((candidate) => (
    candidate.userId === scope.userId && candidate.status === 'Activo'
  ));
  if (!member || matches.length !== 1 || matches[0]?.id !== member.id) {
    throw new Error('AUTHENTICATED_TENANT_MEMBER_REQUIRED');
  }
  appendActivity(entry, member.id);
}

/**
 * Compatibilidad histórica: aun sin scope explícito, el actor se deriva del
 * usuario autenticado actual. activeMemberId nunca participa.
 */
export function addActivity(entry: NewActivityEntry): void {
  const member = authorizedTenantMember();
  if (!member) throw new Error('AUTHENTICATED_TENANT_MEMBER_REQUIRED');
  appendActivity(entry, member.id);
}

export function ensureAccessibleModule(): void {
  if (!canAccessModule(state.activeModule)) state.activeModule = 'inicio';
}
