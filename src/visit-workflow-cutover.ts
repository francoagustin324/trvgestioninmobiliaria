import { getCloudSession, pushCloudData, queueCloudSave } from './cloud-api-compatible.js';
import type { Client, CrmData, Property, SyncedVisit, VisitInterest, VisitStatus } from './models.js';
import { saveData, state } from './store.js';
import { writeTenantSnapshot } from './tenant-storage.js';
import {
  assertTenantRuntimeLeaseCurrent,
  captureTenantRuntimeLease,
  currentTenantScope,
  requireCurrentTenantScope,
  tenantRuntimeLeaseIsCurrent,
  tenantScopesEqual,
  type TenantRuntimeLease,
} from './tenant-runtime.js';
import { canonicalUuid, normalizeRevision } from './sync-identity.js';
import { activeMember, addActivity } from './team-access.js';
import type { CommercialRecordReference, VisitMutationResult } from './visit-transaction-contract.js';
import {
  invokeVisitTransactionV2,
  visitTransactionAuthorityActiveV2,
} from './tenant-visit-v2.js';
import { executeVisitWriterSelection } from './visit-writer-selection.js';
import { coordinateVisit, registerVisitResult } from './visit-workflow.js';

function commercialReference(value: { uid?: string; id: number }): CommercialRecordReference {
  const uid = canonicalUuid(value.uid);
  return uid ? { uid } : { legacyId: value.id };
}

function replaceClient(next: Client): void {
  const index = state.crm.clients.findIndex((client) => client.id === next.id);
  if (index < 0) throw new Error('El lead ya no está disponible.');
  state.crm.clients[index] = next;
}

function upsertAuthoritativeVisit(next: SyncedVisit): void {
  const uid = canonicalUuid(next.uid);
  const index = state.crm.visits.findIndex((visit) => (
    (uid && canonicalUuid((visit as SyncedVisit).uid) === uid) || (!uid && visit.id === next.id)
  ));
  if (index >= 0) state.crm.visits[index] = next;
  else state.crm.visits.push(next);
}

function upsertAuthoritativeActivity(result: VisitMutationResult): void {
  const uid = canonicalUuid(result.activity.uid);
  const index = state.crm.activityLog.findIndex((activity) => (
    (uid && canonicalUuid(activity.uid) === uid)
    || (activity.operationId === result.operationId && activity.id === result.activity.id)
  ));
  if (index >= 0) state.crm.activityLog[index] = result.activity;
  else state.crm.activityLog.unshift(result.activity);
  state.crm.activityLog = state.crm.activityLog.slice(0, 250);
}

function applyAuthoritativeResult(
  result: VisitMutationResult,
  runtimeLease: TenantRuntimeLease,
): void {
  assertTenantRuntimeLeaseCurrent(runtimeLease);
  if (result.organizationId !== runtimeLease.scope.organizationId) {
    throw new Error('TENANT_V2_ORGANIZATION_MISMATCH');
  }
  replaceClient(result.client);
  upsertAuthoritativeVisit(result.visit);
  upsertAuthoritativeActivity(result);
  writeTenantSnapshot(runtimeLease.scope, state.crm, {
    markDirty: false,
    reason: result.operationType === 'VISIT_CREATE'
      ? 'Visita autoritativa coordinada'
      : `Resultado de visita autoritativo: ${result.visit.status}`,
  });
  // El job conserva scope + generación. El snapshot authority-aware no vuelve
  // a escribir Visit ni su Activity y usa CAS V2 para Client existente.
  queueCloudSave(runtimeLease.scope, state.crm, true);
}

async function persistHistoricalCloud(
  before: CrmData,
  reason: string,
  runtimeLease: TenantRuntimeLease,
): Promise<void> {
  assertTenantRuntimeLeaseCurrent(runtimeLease);
  writeTenantSnapshot(runtimeLease.scope, state.crm, { markDirty: true, reason });
  const snapshot = structuredClone(state.crm);
  try {
    // false es una decisión explícita devuelta por authority V2. Un error V2 no
    // llega a este branch y por lo tanto nunca se transforma en writer histórico.
    await pushCloudData(runtimeLease.scope, snapshot, false);
    assertTenantRuntimeLeaseCurrent(runtimeLease);
  } catch (error) {
    if (!tenantRuntimeLeaseIsCurrent(runtimeLease)) throw error;
    state.crm = before;
    writeTenantSnapshot(runtimeLease.scope, state.crm, {
      markDirty: false,
      reason: `Reversión local: ${reason}`,
      backup: false,
    });
    throw error;
  }
}

function historicalCoordinate(input: CoordinateVisitCutoverInput): string {
  const actor = activeMember();
  const result = coordinateVisit({
    visits: state.crm.visits,
    client: input.client,
    property: input.property,
    actor: { id: actor.id, role: actor.role },
    localDate: input.localDate,
    localTime: input.localTime,
  });
  replaceClient(result.client);
  state.crm.visits.push(result.visit);
  addActivity(result.activity);
  return 'Visita coordinada';
}

function historicalResolve(input: RegisterVisitResultCutoverInput): string {
  const actor = activeMember();
  const result = registerVisitResult({
    visit: input.visit,
    client: input.client,
    property: input.property,
    actor: { id: actor.id, role: actor.role },
    status: input.status,
    interest: input.interest,
    objection: input.objection,
    nextAction: input.nextAction,
    nextFollowUp: input.nextFollowUp,
  });
  replaceClient(result.client);
  const index = state.crm.visits.findIndex((visit) => visit.id === input.visit.id);
  if (index < 0) throw new Error('La visita ya no está disponible.');
  state.crm.visits[index] = result.visit;
  addActivity(result.activity);
  return `Resultado de visita: ${result.visit.status}`;
}

export interface CoordinateVisitCutoverInput {
  operationId: string;
  client: Client;
  property: Property;
  localDate: string;
  localTime: string;
}

export async function coordinateVisitWithCutover(input: CoordinateVisitCutoverInput): Promise<void> {
  const session = getCloudSession();
  const scope = session ? requireCurrentTenantScope() : null;
  const runtimeLease = scope ? captureTenantRuntimeLease(scope) : null;

  await executeVisitWriterSelection({
    hasCloudSession: Boolean(session),
    readAuthority: async () => {
      if (!scope || !runtimeLease) throw new Error('TENANT_RUNTIME_SCOPE_REQUIRED');
      return visitTransactionAuthorityActiveV2(scope, runtimeLease);
    },
    runLocal: () => {
      const reason = historicalCoordinate(input);
      saveData(reason);
    },
    runLegacyCloud: async () => {
      if (!scope || !runtimeLease) throw new Error('TENANT_RUNTIME_SCOPE_REQUIRED');
      assertTenantRuntimeLeaseCurrent(runtimeLease);
      const before = structuredClone(state.crm);
      const reason = historicalCoordinate(input);
      await persistHistoricalCloud(before, reason, runtimeLease);
    },
    runTransactionalCloud: async () => {
      if (!scope || !runtimeLease) throw new Error('TENANT_RUNTIME_SCOPE_REQUIRED');
      assertTenantRuntimeLeaseCurrent(runtimeLease);
      const result = await invokeVisitTransactionV2(scope, {
        operationId: input.operationId,
        operationType: 'VISIT_CREATE',
        client: commercialReference(input.client),
        expectedClientRevision: normalizeRevision(input.client.revision),
        property: commercialReference(input.property),
        localDate: input.localDate,
        localTime: input.localTime,
      }, runtimeLease);
      assertTenantRuntimeLeaseCurrent(runtimeLease);
      applyAuthoritativeResult(result, runtimeLease);
    },
  });
}

export interface RegisterVisitResultCutoverInput {
  operationId: string;
  visit: SyncedVisit;
  client: Client;
  property?: Property;
  status: VisitStatus;
  interest?: VisitInterest;
  objection?: string;
  nextAction?: string;
  nextFollowUp?: string;
}

export async function registerVisitResultWithCutover(input: RegisterVisitResultCutoverInput): Promise<void> {
  const session = getCloudSession();
  const scope = session ? requireCurrentTenantScope() : null;
  const runtimeLease = scope ? captureTenantRuntimeLease(scope) : null;

  await executeVisitWriterSelection({
    hasCloudSession: Boolean(session),
    readAuthority: async () => {
      if (!scope || !runtimeLease) throw new Error('TENANT_RUNTIME_SCOPE_REQUIRED');
      return visitTransactionAuthorityActiveV2(scope, runtimeLease);
    },
    runLocal: () => {
      const reason = historicalResolve(input);
      saveData(reason);
    },
    runLegacyCloud: async () => {
      if (!scope || !runtimeLease) throw new Error('TENANT_RUNTIME_SCOPE_REQUIRED');
      assertTenantRuntimeLeaseCurrent(runtimeLease);
      const before = structuredClone(state.crm);
      const reason = historicalResolve(input);
      await persistHistoricalCloud(before, reason, runtimeLease);
    },
    runTransactionalCloud: async () => {
      if (!scope || !runtimeLease) throw new Error('TENANT_RUNTIME_SCOPE_REQUIRED');
      assertTenantRuntimeLeaseCurrent(runtimeLease);
      const visitUid = canonicalUuid(input.visit.uid);
      if (!visitUid) {
        throw new Error('La visita histórica no tiene identidad transaccional y no puede resolverse con Visit authority activa.');
      }
      if (!['Realizada', 'Cancelada', 'No asistió'].includes(input.status)) {
        throw new Error('Seleccioná un resultado válido para la visita.');
      }
      const result = await invokeVisitTransactionV2(scope, {
        operationId: input.operationId,
        operationType: 'VISIT_RESOLVE',
        client: commercialReference(input.client),
        expectedClientRevision: normalizeRevision(input.client.revision),
        visitUid,
        expectedVisitRevision: normalizeRevision(input.visit.revision),
        status: input.status as 'Realizada' | 'Cancelada' | 'No asistió',
        interest: input.interest,
        objection: input.objection,
        nextAction: input.nextAction,
        nextFollowUp: input.nextFollowUp,
      }, runtimeLease);
      assertTenantRuntimeLeaseCurrent(runtimeLease);
      applyAuthoritativeResult(result, runtimeLease);
    },
  });
}

// El coordinador cloud emite el snapshot junto con scope+lease. Aplicamos metadata
// server-side únicamente si la misma generación tenant continúa activa.
document.addEventListener('propcontrol-cloud-authoritative-snapshot', (event) => {
  const detail = (event as CustomEvent<{
    crm?: CrmData;
    runtimeLease?: TenantRuntimeLease;
  }>).detail;
  const crm = detail?.crm;
  const runtimeLease = detail?.runtimeLease;
  if (!crm || !runtimeLease) return;
  const activeScope = currentTenantScope();
  if (
    !activeScope
    || !tenantScopesEqual(activeScope, runtimeLease.scope)
    || !tenantRuntimeLeaseIsCurrent(runtimeLease)
  ) return;

  state.crm = structuredClone(crm);
  writeTenantSnapshot(runtimeLease.scope, state.crm, {
    markDirty: false,
    reason: 'Reconciliación autoritativa cloud',
    backup: false,
  });
  document.dispatchEvent(new CustomEvent('trv-render'));
});
