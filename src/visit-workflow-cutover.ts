import { getCloudSession, pushCloudData, queueCloudSave } from './cloud-api-compatible.js';
import type { Client, CrmData, Property, SyncedVisit, VisitInterest, VisitStatus } from './models.js';
import { saveData, state } from './store.js';
import { writeLocalSnapshot } from './sync-safety.js';
import { canonicalUuid, normalizeRevision } from './sync-identity.js';
import { activeMember, addActivity } from './team-access.js';
import type { CommercialRecordReference, VisitMutationResult } from './visit-transaction-contract.js';
import {
  invokeVisitTransaction,
  visitTransactionAuthorityActive,
} from './visit-transaction-cloud.js';
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

function applyAuthoritativeResult(result: VisitMutationResult): void {
  replaceClient(result.client);
  upsertAuthoritativeVisit(result.visit);
  upsertAuthoritativeActivity(result);
  writeLocalSnapshot(state.crm, {
    markDirty: false,
    reason: result.operationType === 'VISIT_CREATE'
      ? 'Visita autoritativa coordinada'
      : `Resultado de visita autoritativo: ${result.visit.status}`,
  });
  // Si ya existían cambios locales no relacionados, la cola los conserva. El
  // snapshot authority-aware no vuelve a escribir Visit ni su Activity.
  queueCloudSave(state.crm, true);
}

async function persistHistoricalCloud(
  before: CrmData,
  reason: string,
  accountKey: string,
): Promise<void> {
  writeLocalSnapshot(state.crm, { markDirty: true, reason });
  try {
    // false fija la decisión tomada por la capability. Si authority cambia a ON
    // antes del write, los fences rechazan el writer histórico y NO se intenta RPC.
    await pushCloudData(state.crm, accountKey, false);
  } catch (error) {
    state.crm = before;
    writeLocalSnapshot(state.crm, {
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
  await executeVisitWriterSelection({
    hasCloudSession: Boolean(session),
    readAuthority: visitTransactionAuthorityActive,
    runLocal: () => {
      const reason = historicalCoordinate(input);
      saveData(reason);
    },
    runLegacyCloud: async () => {
      if (!session) throw new Error('La sesión cloud cambió durante la selección del writer.');
      const before = structuredClone(state.crm);
      const reason = historicalCoordinate(input);
      await persistHistoricalCloud(before, reason, session.userId);
    },
    runTransactionalCloud: async () => {
      const result = await invokeVisitTransaction({
        operationId: input.operationId,
        operationType: 'VISIT_CREATE',
        client: commercialReference(input.client),
        expectedClientRevision: normalizeRevision(input.client.revision),
        property: commercialReference(input.property),
        localDate: input.localDate,
        localTime: input.localTime,
      });
      applyAuthoritativeResult(result);
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
  await executeVisitWriterSelection({
    hasCloudSession: Boolean(session),
    readAuthority: visitTransactionAuthorityActive,
    runLocal: () => {
      const reason = historicalResolve(input);
      saveData(reason);
    },
    runLegacyCloud: async () => {
      if (!session) throw new Error('La sesión cloud cambió durante la selección del writer.');
      const before = structuredClone(state.crm);
      const reason = historicalResolve(input);
      await persistHistoricalCloud(before, reason, session.userId);
    },
    runTransactionalCloud: async () => {
      const visitUid = canonicalUuid(input.visit.uid);
      if (!visitUid) {
        throw new Error('La visita histórica no tiene identidad transaccional y no puede resolverse con Visit authority activa.');
      }
      if (!['Realizada', 'Cancelada', 'No asistió'].includes(input.status)) {
        throw new Error('Seleccioná un resultado válido para la visita.');
      }
      const result = await invokeVisitTransaction({
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
      });
      applyAuthoritativeResult(result);
    },
  });
}

// El coordinador cloud emite este evento únicamente después de verificar que el
// job sigue siendo la última generación local. Reconciliamos metadata server-side
// (por ejemplo revision de Client) sin marcar un nuevo dirty ni resetear UI transitoria.
document.addEventListener('propcontrol-cloud-authoritative-snapshot', (event) => {
  const crm = (event as CustomEvent<{ crm?: CrmData }>).detail?.crm;
  if (!crm) return;
  state.crm = structuredClone(crm);
  writeLocalSnapshot(state.crm, {
    markDirty: false,
    reason: 'Reconciliación autoritativa cloud',
    backup: false,
  });
  document.dispatchEvent(new CustomEvent('trv-render'));
});
