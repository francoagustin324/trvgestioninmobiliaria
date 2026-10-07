import type { TenantScope } from './active-organization.js';
import {
  renderOperationalAttentionQueue,
  renderOperationalAttentionUnavailable,
} from './lead-attention-queue.js';
import type { CrmData, Property, TeamMember } from './models.js';
import { assignmentVisible } from './team-policy.js';

export type OperationalAttentionAuthority =
  | { status: 'ready'; member: TeamMember }
  | { status: 'unavailable'; reason: 'tenant-mismatch' | 'membership-missing' | 'membership-suspended' | 'membership-ambiguous' };

export function resolveOperationalAttentionAuthority(
  crm: CrmData,
  scope: TenantScope | null,
): OperationalAttentionAuthority {
  if (!scope || crm.organization.id !== scope.organizationId) {
    return { status: 'unavailable', reason: 'tenant-mismatch' };
  }
  const sameUser = crm.teamMembers.filter((member) => member.userId === scope.userId);
  const active = sameUser.filter((member) => member.status === 'Activo');
  if (active.length > 1) return { status: 'unavailable', reason: 'membership-ambiguous' };
  if (active.length === 0) {
    return {
      status: 'unavailable',
      reason: sameUser.some((member) => member.status === 'Suspendido')
        ? 'membership-suspended'
        : 'membership-missing',
    };
  }
  return { status: 'ready', member: active[0]! };
}

export function renderOperationalAttentionForTenant(
  crm: CrmData,
  scope: TenantScope | null,
  limit = 3,
  prefilteredProperties?: Property[],
): string {
  const authority = resolveOperationalAttentionAuthority(crm, scope);
  if (authority.status !== 'ready') return renderOperationalAttentionUnavailable();

  const { member } = authority;
  const visible = <T extends { assignedToId?: number }>(items: T[]): T[] => (
    items.filter((item) => assignmentVisible(member.role, member.id, item.assignedToId))
  );
  return renderOperationalAttentionQueue({
    organizationId: scope!.organizationId,
    clients: visible(crm.clients),
    properties: visible(prefilteredProperties ?? crm.properties),
    visits: visible(crm.visits),
    offers: visible(crm.offers),
    reservations: visible(crm.reservations),
    reminders: visible(crm.reminders),
    activityLog: crm.activityLog,
    actor: { id: member.id, role: member.role },
  }, limit);
}
