import { getCloudSession, pushCloudData } from './cloud-api-compatible.js';
import {
  reconcileEvaluatedCommercialAlerts,
  visitConfirmationActive,
  visitConfirmationDetail,
  VISIT_CONFIRMED_ACTION,
} from './commercial-alert-engine.js';
import { authenticatedTenantMember, state } from './store.js';
import { addActivityForAuthenticatedTenant } from './team-access.js';
import { assignmentVisible } from './team-policy.js';
import {
  assertTenantCrmScope,
  writeTenantSnapshot,
} from './tenant-storage.js';
import {
  assertTenantRuntimeLeaseCurrent,
  captureTenantRuntimeLease,
  requireCurrentTenantScope,
  tenantRuntimeLeaseIsCurrent,
} from './tenant-runtime.js';

function reconcileAlertsForCurrentActor(): void {
  const scope = requireCurrentTenantScope();
  const member = authenticatedTenantMember(scope);
  if (!member) throw new Error('AUTHENTICATED_TENANT_MEMBER_REQUIRED');
  state.crm.commercialAlerts = reconcileEvaluatedCommercialAlerts({
    organizationId: scope.organizationId,
    clients: state.crm.clients,
    properties: state.crm.properties,
    visits: state.crm.visits,
    offers: state.crm.offers,
    reservations: state.crm.reservations,
    reminders: state.crm.reminders,
    activityLog: state.crm.activityLog,
    actor: { id: member.id, role: member.role },
  }, state.crm.commercialAlerts ?? []);
}

export async function confirmScheduledVisit(visitId: number): Promise<'confirmed' | 'already-confirmed'> {
  const scope = requireCurrentTenantScope();
  const runtimeLease = captureTenantRuntimeLease(scope);
  assertTenantRuntimeLeaseCurrent(runtimeLease);
  assertTenantCrmScope(scope, state.crm);

  const member = authenticatedTenantMember(scope);
  if (!member) throw new Error('AUTHENTICATED_TENANT_MEMBER_REQUIRED');
  const visit = state.crm.visits.find((item) => item.id === visitId);
  if (!visit || !assignmentVisible(member.role, member.id, visit.assignedToId)) {
    throw new Error('La visita ya no está disponible.');
  }
  if (visit.status !== 'Coordinada') {
    throw new Error('La visita ya no está pendiente de confirmación.');
  }
  if (visitConfirmationActive(visit, state.crm.activityLog)) return 'already-confirmed';

  const before = structuredClone(state.crm);
  addActivityForAuthenticatedTenant(scope, {
    action: VISIT_CONFIRMED_ACTION,
    entityType: 'Cliente',
    entityId: visit.clientId,
    detail: visitConfirmationDetail(visit),
  });
  reconcileAlertsForCurrentActor();

  const reason = 'Visita confirmada';
  writeTenantSnapshot(scope, state.crm, { markDirty: true, reason });
  const snapshot = structuredClone(state.crm);
  const session = getCloudSession();

  if (!session) {
    document.dispatchEvent(new CustomEvent('trv-render'));
    return 'confirmed';
  }

  try {
    await pushCloudData(scope, snapshot);
    assertTenantRuntimeLeaseCurrent(runtimeLease);
    assertTenantCrmScope(scope, state.crm);
    document.dispatchEvent(new CustomEvent('trv-render'));
    return 'confirmed';
  } catch (error) {
    if (tenantRuntimeLeaseIsCurrent(runtimeLease)) {
      state.crm = before;
      writeTenantSnapshot(scope, state.crm, {
        markDirty: false,
        reason: 'Reversión: confirmación de visita no persistida',
        backup: false,
      });
      document.dispatchEvent(new CustomEvent('trv-render'));
    }
    throw error;
  }
}
