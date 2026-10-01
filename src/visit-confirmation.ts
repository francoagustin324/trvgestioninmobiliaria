import { getCloudSession, pushCloudData } from './cloud-api-compatible.js';
import {
  visitConfirmationActive,
  visitConfirmationDetail,
  VISIT_CONFIRMED_ACTION,
  withoutVisitConfirmationActivity,
} from './commercial-alert-engine.js';
import type { Visit } from './models.js';
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

function uuidFromBytes(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

async function deterministicUuid(seed: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('CRYPTO_DIGEST_REQUIRED');
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(seed),
  ));
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  return uuidFromBytes(bytes);
}

export async function visitConfirmationIntentIdentity(
  organizationId: string,
  visit: Visit,
): Promise<{ uid: string; operationId: string }> {
  const syncedVisit = visit as Visit & { uid?: string };
  const visitIdentity = syncedVisit.uid?.trim() || `legacy:${visit.id}`;
  const seed = [
    organizationId,
    'visit-confirmation',
    visitIdentity,
    visit.scheduledAt,
    VISIT_CONFIRMED_ACTION,
  ].join('|');
  const [uid, operationId] = await Promise.all([
    deterministicUuid(`activity|${seed}`),
    deterministicUuid(`operation|${seed}`),
  ]);
  return { uid, operationId };
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

  const confirmationDetail = visitConfirmationDetail(visit);
  const identity = await visitConfirmationIntentIdentity(scope.organizationId, visit);
  assertTenantRuntimeLeaseCurrent(runtimeLease);
  const syncedVisit = visit as Visit & { uid?: string };
  const confirmationActivity = addActivityForAuthenticatedTenant(scope, {
    uid: identity.uid,
    revision: 0,
    operationId: identity.operationId,
    action: VISIT_CONFIRMED_ACTION,
    entityType: 'Cliente',
    entityId: visit.clientId,
    detail: confirmationDetail,
    commercialEntityType: 'visit',
    commercialEntityId: visit.id,
    ...(syncedVisit.uid ? { commercialEntityUid: syncedVisit.uid } : {}),
  });
  const confirmationRecord = structuredClone(confirmationActivity);

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
      assertTenantCrmScope(scope, state.crm);
      const activityLog = withoutVisitConfirmationActivity(state.crm.activityLog, confirmationRecord);
      if (activityLog.length !== state.crm.activityLog.length) {
        state.crm.activityLog = activityLog;
        writeTenantSnapshot(scope, state.crm, {
          markDirty: true,
          reason: 'Reversión: confirmación de visita no persistida',
          backup: false,
        });
      }
      document.dispatchEvent(new CustomEvent('trv-render'));
    }
    throw error;
  }
}
