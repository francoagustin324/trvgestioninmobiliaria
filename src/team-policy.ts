import type { ModuleId, TeamMember, TeamRole } from './models.js';

export function roleCanManageTeam(role: TeamRole): boolean {
  return role === 'Dueño' || role === 'Administrador';
}

export function roleCanViewAll(role: TeamRole): boolean {
  return role === 'Dueño' || role === 'Administrador';
}

export function roleCanAccessModule(role: TeamRole, module: ModuleId): boolean {
  if (role !== 'Corredor') return true;
  return module !== 'reportes' && module !== 'configuracion';
}

export function assignmentVisible(role: TeamRole, memberId: number, assignedToId: number | undefined): boolean {
  return roleCanViewAll(role) || assignedToId === memberId;
}

export function activeMembers(members: TeamMember[]): TeamMember[] {
  return members.filter((member) => member.status !== 'Suspendido');
}

export function seatAvailable(members: TeamMember[], seatLimit: number | null): boolean {
  return seatLimit === null || activeMembers(members).length < seatLimit;
}

export function validSeatLimit(members: TeamMember[], seatLimit: number | null): boolean {
  return seatLimit === null || seatLimit >= activeMembers(members).length;
}
