import type { TenantScope } from './active-organization.js';
import { LatestSerialQueue } from './cloud-save-serial.js';
import type { CrmData } from './models.js';
import {
  getCloudSession,
  inviteTeamMember,
  signInCloud as signInCloudRaw,
  signOutCloud as signOutCloudRaw,
  signUpCloud as signUpCloudRaw,
  updateTeamMemberAccess,
} from './cloud-api.js';
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
  pushCloudDataWithVisitAuthorityV2,
  visitTransactionAuthorityActiveV2,
} from './tenant-visit-v2.js';
import {
  assertTenantRuntimeLeaseCurrent,
  captureTenantRuntimeLease,
  invalidateTenantRuntimeScope,
  requireCurrentTenantScope,
  tenantRuntimeKey,
  tenantRuntimeLeaseIsCurrent,
  type TenantRuntimeLease,
} from './tenant-runtime.js';

export {
  getCloudSession,
  inviteTeamMember,
  updateTeamMemberAccess,
};

export async function signInCloud(email: string, password: string) {
  const session = await signInCloudRaw(email, password);
  invalidateTenantRuntimeScope();
  return session;
}

export async function signUpCloud(email: string, password: string, companyName: string) {
  const result = await signUpCloudRaw(email, password, companyName);
  if (result.session) invalidateTenantRuntimeScope();
  return result;
}

export function signOutCloud(): void {
  invalidateTenantRuntimeScope();
  signOutCloudRaw();
}

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

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object') return value;
  const objectValue = value as object;
  if (seen.has(objectValue)) return value;
  seen.add(objectValue);
  for (const nested of Object.values(value as Record<string, unknown>)) {
    deepFreeze(nested, seen);
  }
  return Object.freeze(value);
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
  const snapshot = deepFreeze(structuredClone(crm));
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

function emitAuthoritativeSnapshot(job: CloudSaveJob, crm: CrmData = job.snapshot): void {
  const detail: TenantCloudAuthoritativeSnapshotDetail = Object.freeze({
    scope: job.scope,
    runtimeLease: job.runtimeLease,
    crm: structuredClone(crm),
    token: job.token,
  });
  document.dispatchEvent(new CustomEvent('propcontrol-cloud-authoritative-snapshot', { detail }));
}

export async function resolveTenantVisitAuthority(
  scope: TenantScope,
  runtimeLease: TenantRuntimeLease = captureTenantRuntimeLease(scope),
): Promise<boolean> {
  return visitTransactionAuthorityActiveV2(scope, runtimeLease);
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
  const runtimeLease = captureTenantRuntimeLease(scope);
  const frozenFallback = structuredClone(fallback);
  const cloud = await pullTenantCloudData(scope, frozenFallback, runtimeLease);
  assertTenantRuntimeLeaseCurrent(runtimeLease);
  if (cloud) assertTenantCrmScope(scope, cloud);
  return cloud;
}

async function runCloudPush(job: CloudSaveJob): Promise<void> {
  const session = getCloudSession();
  if (!session || session.userId !== job.scope.userId) {
    throw new Error('La sesión activa cambió durante la sincronización tenant. El guardado quedó pendiente.');
  }
  assertTenantCrmScope(job.scope, job.snapshot);
  assertTenantRuntimeLeaseCurrent(job.runtimeLease);

  const authorityActive = job.visitAuthorityDecision
    ?? await resolveTenantVisitAuthority(job.scope, job.runtimeLease);
  assertTenantRuntimeLeaseCurrent(job.runtimeLease);

  if (authorityActive) {
    const verified = await pushCloudDataWithVisitAuthorityV2(
      job.scope,
      job.snapshot,
      job.token,
      job.runtimeLease,
    );
    assertTenantRuntimeLeaseCurrent(job.runtimeLease);
    if (cloudSaveJobIsLatest(job)) emitAuthoritativeSnapshot(job, verified);
    return;
  }

  try {
    await pushTenantModernCloudData(job.scope, job.snapshot, job.token, job.runtimeLease);
    assertTenantRuntimeLeaseCurrent(job.runtimeLease);
  } catch (error) {
    if (!isLegacySchemaError(error)) throw error;
    assertTenantRuntimeLeaseCurrent(job.runtimeLease);
    await pushTenantLegacyCloudData(job.scope, job.snapshot, job.token, job.runtimeLease);
    assertTenantRuntimeLeaseCurrent(job.runtimeLease);
  }

  assertTenantRuntimeLeaseCurrent(job.runtimeLease);
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
    if (!tenantRuntimeLeaseIsCurrent(job.runtimeLease)) return;
    if (!tenantHasPendingLocalChanges(job.scope)) return;
    emitStatus(job, 'Guardando en la nube…', 'working');
    void enqueueCloudSaveJob(job)
      .then(() => {
        if (!tenantRuntimeLeaseIsCurrent(job.runtimeLease)) return;
        if (cloudSaveJobIsLatest(job)) {
          emitStatus(job, 'Guardado seguro en la nube.');
        }
      })
      .catch((error) => {
        if (!tenantRuntimeLeaseIsCurrent(job.runtimeLease)) return;
        const technicalMessage = errorMessage(error) || 'No se pudo guardar en la nube.';
        const message = `Guardado localmente, sincronización pendiente. ${technicalMessage}`;
        markTenantSyncError(job.scope, message);
        emitStatus(job, message, 'error');
      });
  }, 700);
  compatibilitySaveTimers.set(timerKey, timer);
}
