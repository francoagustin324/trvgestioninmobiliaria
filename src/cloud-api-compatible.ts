import type { TenantScope } from './active-organization.js';
import { activeMembershipsForUser } from './active-organization.js';
import { LatestSerialQueue } from './cloud-save-serial.js';
import type { CrmData } from './models.js';
import {
  getCloudSession,
  inviteTeamMember,
  signInCloud,
  signOutCloud,
  signUpCloud,
  updateTeamMemberAccess,
} from './cloud-api.js';
import { fetchMembershipCatalog } from './membership-catalog.js';
import type { SyncSaveToken } from './sync-safety.js';
import {
  assertTenantCrmScope,
  markTenantSyncError,
  readTenantSyncState,
  tenantHasPendingLocalChanges,
  tenantSyncSaveToken,
} from './tenant-storage.js';
import {
  pullTenantCloudData,
  pushTenantLegacyCloudData,
  pushTenantModernCloudData,
} from './tenant-cloud-data.js';
import {
  parseTenantCloudJson,
  tenantCloudHeaders,
  tenantCloudTransport,
} from './tenant-cloud-context.js';
import {
  captureTenantRuntimeLease,
  requireCurrentTenantScope,
  tenantRuntimeKey,
  type TenantRuntimeLease,
} from './tenant-runtime.js';

export {
  getCloudSession,
  inviteTeamMember,
  signInCloud,
  signOutCloud,
  signUpCloud,
  updateTeamMemberAccess,
};

export const TENANT_VISIT_CAPABILITY_INDETERMINATE = 'TENANT_VISIT_CAPABILITY_INDETERMINATE';
export const TENANT_VISIT_TRANSACTION_SCOPE_REQUIRED = 'TENANT_VISIT_TRANSACTION_SCOPE_REQUIRED';

export type CloudSaveJob = Readonly<{
  scope: TenantScope;
  snapshot: CrmData;
  token: Readonly<SyncSaveToken>;
  runtimeLease: TenantRuntimeLease;
  visitAuthorityDecision?: boolean;
}>;

export type TenantCloudStatusDetail = Readonly<{
  scope: TenantScope;
  runtimeLease: TenantRuntimeLease;
  message: string;
  kind: 'success' | 'error' | 'working';
}>;

export type TenantCloudAuthoritativeSnapshotDetail = Readonly<{
  scope: TenantScope;
  runtimeLease: TenantRuntimeLease;
  crm: CrmData;
  token: Readonly<SyncSaveToken>;
}>;

const compatibilitySaveTimers = new Map<string, number>();
const tenantSaveQueues = new Map<string, LatestSerialQueue<CloudSaveJob>>();

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? '');
}

function isTenantScope(value: unknown): value is TenantScope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const scope = value as Partial<TenantScope>;
  return typeof scope.userId === 'string' && typeof scope.organizationId === 'string';
}

export function cloudSaveQueueKey(scope: TenantScope): string {
  return tenantRuntimeKey(scope);
}

export function createCloudSaveJob(
  scope: TenantScope,
  crm: CrmData,
  visitAuthorityDecision?: boolean,
): CloudSaveJob {
  assertTenantCrmScope(scope, crm);
  const frozenScope: TenantScope = Object.freeze({ ...scope });
  const snapshot = structuredClone(crm);
  const token = Object.freeze({ ...tenantSyncSaveToken(frozenScope, snapshot) });
  const runtimeLease = captureTenantRuntimeLease(frozenScope);
  return Object.freeze({
    scope: frozenScope,
    snapshot,
    token,
    runtimeLease,
    ...(visitAuthorityDecision === undefined ? {} : { visitAuthorityDecision }),
  });
}

export function cloudSaveJobIsLatest(job: CloudSaveJob): boolean {
  const sync = readTenantSyncState(job.scope);
  return sync.dirty === false
    && sync.verifiedGeneration === job.token.generation
    && sync.lastCloudFingerprint === job.token.fingerprint;
}

export function isLegacySchemaError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  const code = error && typeof error === 'object'
    ? String((error as { code?: unknown }).code ?? '').toLowerCase()
    : '';
  const missingLegacyColumn = message.includes('organization_members') && [
    'member_id',
    'display_name',
    'status',
    'last_active_at',
  ].some((column) => message.includes(column));
  const missingModernRelation = message.includes('propcontrol_records');
  const schemaCode = ['pgrst204', 'pgrst205', '42p01', '42703'].some((candidate) => (
    message.includes(candidate) || code === candidate
  ));
  const missingSignal = [
    'does not exist',
    'could not find',
    'schema cache',
    'undefined',
    'pgrst',
  ].some((signal) => message.includes(signal));
  return (missingLegacyColumn || missingModernRelation || schemaCode) && missingSignal;
}

function emitStatus(
  job: CloudSaveJob,
  message: string,
  kind: 'success' | 'error' | 'working' = 'success',
): void {
  const detail: TenantCloudStatusDetail = Object.freeze({
    scope: job.scope,
    runtimeLease: job.runtimeLease,
    message,
    kind,
  });
  document.dispatchEvent(new CustomEvent('propcontrol-cloud-status', { detail }));
}

function emitAuthoritativeSnapshot(job: CloudSaveJob): void {
  const detail: TenantCloudAuthoritativeSnapshotDetail = Object.freeze({
    scope: job.scope,
    runtimeLease: job.runtimeLease,
    crm: structuredClone(job.snapshot),
    token: job.token,
  });
  document.dispatchEvent(new CustomEvent('propcontrol-cloud-authoritative-snapshot', { detail }));
}

export async function resolveTenantVisitAuthority(scope: TenantScope): Promise<boolean> {
  const memberships = await fetchMembershipCatalog();
  const active = activeMembershipsForUser(scope.userId, memberships);
  if (
    active.length !== 1
    || active[0]?.organizationId !== scope.organizationId
  ) {
    throw new Error(TENANT_VISIT_CAPABILITY_INDETERMINATE);
  }

  const transport = await tenantCloudTransport(scope);
  const payload = await parseTenantCloudJson(await fetch(
    `${transport.config.url}/rest/v1/rpc/visit_transaction_authority_active`,
    {
      method: 'POST',
      headers: tenantCloudHeaders(transport.config.publishableKey, transport.accessToken),
      body: '{}',
    },
  ));
  if (typeof payload !== 'boolean') {
    throw new Error(TENANT_VISIT_CAPABILITY_INDETERMINATE);
  }
  return payload;
}

export function pullCloudData(scope: TenantScope, fallback: CrmData): Promise<CrmData | null>;
export function pullCloudData(fallback: CrmData): Promise<CrmData | null>;
export async function pullCloudData(
  scopeOrFallback: TenantScope | CrmData,
  fallbackMaybe?: CrmData,
): Promise<CrmData | null> {
  const scope = isTenantScope(scopeOrFallback) ? scopeOrFallback : requireCurrentTenantScope();
  const fallback = isTenantScope(scopeOrFallback) ? fallbackMaybe : scopeOrFallback;
  if (!fallback) throw new Error('TENANT_CLOUD_FALLBACK_REQUIRED');
  assertTenantCrmScope(scope, fallback);
  const cloud = await pullTenantCloudData(scope, fallback);
  if (cloud) assertTenantCrmScope(scope, cloud);
  return cloud;
}

async function runCloudPush(job: CloudSaveJob): Promise<void> {
  const session = getCloudSession();
  if (!session || session.userId !== job.scope.userId) {
    throw new Error('La sesión activa cambió durante la sincronización tenant. El guardado quedó pendiente.');
  }
  assertTenantCrmScope(job.scope, job.snapshot);

  const authorityActive = job.visitAuthorityDecision ?? await resolveTenantVisitAuthority(job.scope);
  if (authorityActive) {
    throw new Error(TENANT_VISIT_TRANSACTION_SCOPE_REQUIRED);
  }

  try {
    await pushTenantModernCloudData(job.scope, job.snapshot, job.token);
  } catch (error) {
    if (!isLegacySchemaError(error)) throw error;
    await pushTenantLegacyCloudData(job.scope, job.snapshot, job.token);
  }

  if (cloudSaveJobIsLatest(job)) emitAuthoritativeSnapshot(job);
}

function tenantSaveQueue(scope: TenantScope): LatestSerialQueue<CloudSaveJob> {
  const key = cloudSaveQueueKey(scope);
  const existing = tenantSaveQueues.get(key);
  if (existing) return existing;
  const created = new LatestSerialQueue<CloudSaveJob>(runCloudPush);
  tenantSaveQueues.set(key, created);
  return created;
}

function enqueueCloudSaveJob(job: CloudSaveJob): Promise<void> {
  return tenantSaveQueue(job.scope).enqueue(job);
}

export function pushCloudData(scope: TenantScope, crm: CrmData, visitAuthorityDecision?: boolean): Promise<void>;
export function pushCloudData(crm: CrmData, expectedAccountKey?: string, visitAuthorityDecision?: boolean): Promise<void>;
export async function pushCloudData(
  scopeOrCrm: TenantScope | CrmData,
  crmOrExpectedAccountKey?: CrmData | string,
  visitAuthorityDecisionMaybe?: boolean,
): Promise<void> {
  const scoped = isTenantScope(scopeOrCrm);
  const scope = scoped ? scopeOrCrm : requireCurrentTenantScope();
  const crm = scoped ? crmOrExpectedAccountKey as CrmData : scopeOrCrm;
  const expectedAccountKey = !scoped && typeof crmOrExpectedAccountKey === 'string'
    ? crmOrExpectedAccountKey
    : undefined;
  const visitAuthorityDecision = visitAuthorityDecisionMaybe;

  const session = getCloudSession();
  if (!session || session.userId !== scope.userId || (expectedAccountKey && expectedAccountKey !== scope.userId)) {
    throw new Error('La sesión activa cambió antes de iniciar la sincronización tenant.');
  }
  const job = createCloudSaveJob(scope, crm, visitAuthorityDecision);
  await enqueueCloudSaveJob(job);
}

export function queueCloudSave(scope: TenantScope, crm: CrmData, visitAuthorityDecision?: boolean): void;
export function queueCloudSave(crm: CrmData, visitAuthorityDecision?: boolean): void;
export function queueCloudSave(
  scopeOrCrm: TenantScope | CrmData,
  crmOrVisitAuthorityDecision?: CrmData | boolean,
  visitAuthorityDecisionMaybe?: boolean,
): void {
  const scoped = isTenantScope(scopeOrCrm);
  const scope = scoped ? scopeOrCrm : requireCurrentTenantScope();
  const crm = scoped ? crmOrVisitAuthorityDecision as CrmData : scopeOrCrm;
  const visitAuthorityDecision = scoped
    ? visitAuthorityDecisionMaybe
    : typeof crmOrVisitAuthorityDecision === 'boolean' ? crmOrVisitAuthorityDecision : undefined;

  const session = getCloudSession();
  if (!session || session.userId !== scope.userId) return;
  const job = createCloudSaveJob(scope, crm, visitAuthorityDecision);
  const timerKey = cloudSaveQueueKey(job.scope);
  const previousTimer = compatibilitySaveTimers.get(timerKey);
  if (previousTimer !== undefined) window.clearTimeout(previousTimer);

  const timer = window.setTimeout(() => {
    compatibilitySaveTimers.delete(timerKey);
    const active = getCloudSession();
    if (!active || active.userId !== job.scope.userId) return;
    if (!tenantHasPendingLocalChanges(job.scope)) return;
    emitStatus(job, 'Guardando en la nube…', 'working');
    void enqueueCloudSaveJob(job)
      .then(() => {
        if (cloudSaveJobIsLatest(job)) {
          emitStatus(job, 'Guardado seguro en la nube.');
        }
      })
      .catch((error) => {
        const technicalMessage = errorMessage(error) || 'No se pudo guardar en la nube.';
        const message = `Guardado localmente, sincronización pendiente. ${technicalMessage}`;
        markTenantSyncError(job.scope, message);
        emitStatus(job, message, 'error');
      });
  }, 700);
  compatibilitySaveTimers.set(timerKey, timer);
}
