import { LatestSerialQueue } from './cloud-save-serial.js';
import type { CrmData } from './models.js';
import {
  getCloudSession,
  inviteTeamMember,
  pullCloudData as pullModernCloudData,
  pushCloudData as pushModernCloudData,
  signInCloud,
  signOutCloud,
  signUpCloud,
  updateTeamMemberAccess,
} from './cloud-api.js';
import { visitAuthorityRemoteVersion } from './visit-authority-sync-version.js';
import {
  pushCloudDataWithVisitAuthority,
  visitTransactionAuthorityActive,
} from './visit-transaction-cloud.js';
import {
  assertRemoteIsSafe,
  markCloudHydrated,
  markCloudSaved,
  getSyncState,
  hasPendingLocalChanges,
  markSyncError,
  readLocalSnapshot,
  stableFingerprint,
  syncSaveToken,
  type SyncSaveToken,
} from './sync-safety.js';

export {
  getCloudSession,
  inviteTeamMember,
  signInCloud,
  signOutCloud,
  signUpCloud,
  updateTeamMemberAccess,
};

const SNAPSHOT_SOURCE = 'propcontrol_system_snapshot';
const compatibilitySaveTimers = new Map<string, number>();

interface CloudSaveJob {
  accountKey: string;
  snapshot: CrmData;
  token: SyncSaveToken;
  visitAuthorityDecision?: boolean;
}

const accountSaveQueues = new Map<string, LatestSerialQueue<CloudSaveJob>>();

interface PublicCloudConfig {
  configured?: boolean;
  url?: string;
  publishableKey?: string;
}

interface LegacyMembershipRow {
  organization_id?: string;
  role?: string;
}

interface LegacySnapshotRow {
  id: string;
  internal_data?: { crm?: unknown };
  updated_at?: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? '');
}

export function isLegacySchemaError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  const missingLegacyColumn = message.includes('organization_members') && [
    'member_id',
    'display_name',
    'status',
    'last_active_at',
  ].some((column) => message.includes(column));
  const missingModernRelation = message.includes('propcontrol_records');
  const schemaCode = ['pgrst204', 'pgrst205', '42p01', '42703'].some((code) => message.includes(code));
  const missingSignal = [
    'does not exist',
    'could not find',
    'schema cache',
    'undefined',
    'pgrst',
  ].some((signal) => message.includes(signal));
  return (missingLegacyColumn || missingModernRelation || schemaCode) && missingSignal;
}

function isCrmData(value: unknown): value is CrmData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Partial<CrmData>;
  return Array.isArray(record.clients)
    && Array.isArray(record.properties)
    && Array.isArray(record.reminders)
    && Array.isArray(record.fichas);
}

function remoteComparableCrm(crm: CrmData): unknown {
  const comparable = structuredClone(crm) as unknown as Record<string, unknown>;
  const organization = comparable.organization as Record<string, unknown> | undefined;
  if (organization) delete organization.id;

  // La membresía y las asignaciones son normalizadas por el servidor. La verificación
  // remota compara el contenido CRM de negocio y no falla por esos campos autoritativos.
  comparable.teamMembers = [];
  ['clients', 'properties', 'visits', 'offers', 'reservations', 'contacts', 'reminders', 'fichas', 'conversations'].forEach((key) => {
    const items = comparable[key];
    if (!Array.isArray(items)) return;
    items.forEach((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return;
      const record = item as Record<string, unknown>;
      delete record.assignedToId;
      delete record.createdById;
      if (key === 'clients') {
        // client_snapshot_cas incrementa revision y elimina operationId como metadata
        // server-managed; el contenido comercial restante debe coincidir exactamente.
        delete record.revision;
        delete record.operationId;
      }
    });
    items.sort((left, right) => Number((left as Record<string, unknown>)?.id ?? 0) - Number((right as Record<string, unknown>)?.id ?? 0));
  });
  const activity = comparable.activityLog;
  if (Array.isArray(activity)) {
    activity.forEach((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return;
      delete (item as Record<string, unknown>).actorId;
    });
    activity.sort((left, right) => Number((left as Record<string, unknown>)?.id ?? 0) - Number((right as Record<string, unknown>)?.id ?? 0));
  }
  return comparable;
}

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  let payload: unknown = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { message: text }; }
  if (!response.ok) {
    const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    const message = [record.message, record.error_description, record.error, record.hint]
      .find((value) => typeof value === 'string' && value.trim());
    throw new Error(typeof message === 'string' ? message : `Error de conexión (${response.status}).`);
  }
  return payload;
}

async function publicConfig(): Promise<Required<Pick<PublicCloudConfig, 'url' | 'publishableKey'>>> {
  const payload = await parseJson(await fetch('/api/cloud-config', {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  })) as PublicCloudConfig;
  if (!payload.configured || !payload.url || !payload.publishableKey) {
    throw new Error('La conexión con Supabase todavía no está configurada.');
  }
  return { url: payload.url.replace(/\/+$/g, ''), publishableKey: payload.publishableKey };
}

function authenticatedHeaders(publishableKey: string, accessToken: string): Record<string, string> {
  return {
    apikey: publishableKey,
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
}

async function legacyMembership(): Promise<{ organizationId: string; userId: string; accessToken: string; config: Required<Pick<PublicCloudConfig, 'url' | 'publishableKey'>> }> {
  const session = getCloudSession();
  if (!session) throw new Error('Ingresá a tu cuenta para sincronizar.');
  const config = await publicConfig();
  const query = new URL(`${config.url}/rest/v1/organization_members`);
  query.searchParams.set('select', 'organization_id,role');
  query.searchParams.set('user_id', `eq.${session.userId}`);
  query.searchParams.set('limit', '1');
  const rows = await parseJson(await fetch(query, {
    headers: authenticatedHeaders(config.publishableKey, session.accessToken),
    cache: 'no-store',
  })) as LegacyMembershipRow[];
  const organizationId = rows[0]?.organization_id;
  if (!organizationId) throw new Error('La cuenta no tiene una inmobiliaria asociada.');
  return { organizationId, userId: session.userId, accessToken: session.accessToken, config };
}

async function legacySnapshotRow(): Promise<{ row: LegacySnapshotRow | null; membership: Awaited<ReturnType<typeof legacyMembership>> }> {
  const membership = await legacyMembership();
  const query = new URL(`${membership.config.url}/rest/v1/fichas`);
  query.searchParams.set('select', 'id,internal_data,updated_at');
  query.searchParams.set('organization_id', `eq.${membership.organizationId}`);
  query.searchParams.set('source', `eq.${SNAPSHOT_SOURCE}`);
  query.searchParams.set('limit', '1');
  const rows = await parseJson(await fetch(query, {
    headers: authenticatedHeaders(membership.config.publishableKey, membership.accessToken),
    cache: 'no-store',
  })) as LegacySnapshotRow[];
  return { row: rows[0] ?? null, membership };
}

async function pullLegacyCloudData(): Promise<CrmData | null> {
  const { row } = await legacySnapshotRow();
  const crm = row?.internal_data?.crm;
  if (!isCrmData(crm)) {
    markCloudHydrated(row?.updated_at || null);
    return null;
  }
  markCloudHydrated(row?.updated_at || null, stableFingerprint(crm));
  return crm;
}

async function pushLegacyCloudData(crm: CrmData, token: SyncSaveToken): Promise<void> {
  const { row, membership } = await legacySnapshotRow();
  const localFingerprint = stableFingerprint(crm);
  const remoteFingerprint = stableFingerprint(row?.internal_data?.crm ?? null);
  assertRemoteIsSafe(row?.updated_at || null, localFingerprint, remoteFingerprint);

  if (row && localFingerprint === remoteFingerprint) {
    markCloudSaved(row.updated_at || null, token);
    return;
  }

  const payload = {
    organization_id: membership.organizationId,
    title: 'Estado PropControl',
    source: SNAPSHOT_SOURCE,
    public_data: { system: true, version: 1 },
    internal_data: { crm, savedAt: new Date().toISOString(), version: 1 },
    created_by: membership.userId,
  };
  const target = row
    ? `${membership.config.url}/rest/v1/fichas?id=eq.${encodeURIComponent(row.id)}`
    : `${membership.config.url}/rest/v1/fichas`;
  await parseJson(await fetch(target, {
    method: row ? 'PATCH' : 'POST',
    headers: {
      ...authenticatedHeaders(membership.config.publishableKey, membership.accessToken),
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(payload),
  }));
  const refreshed = await legacySnapshotRow();
  const verifiedCrm = refreshed.row?.internal_data?.crm;
  if (!isCrmData(verifiedCrm) || stableFingerprint(verifiedCrm) !== localFingerprint) {
    throw new Error('La verificación remota legacy no coincide con el snapshot que PropControl intentó guardar.');
  }
  markCloudSaved(refreshed.row?.updated_at || new Date().toISOString(), token);
}

export async function pullCloudData(fallback?: CrmData): Promise<CrmData | null> {
  try {
    return await pullModernCloudData(fallback);
  } catch (error) {
    if (!isLegacySchemaError(error)) throw error;
    return await pullLegacyCloudData();
  }
}

async function runCloudPush(job: CloudSaveJob): Promise<void> {
  const session = getCloudSession();
  if (!session || session.userId !== job.accountKey) {
    throw new Error('La cuenta activa cambió durante la sincronización. El guardado quedó pendiente para evitar mezclar inmobiliarias.');
  }
  // Una decisión fijada por el workflow de Visit NO se vuelve a consultar: esto
  // conserva el contrato de carrera OFF→ON. Los jobs genéricos sí consultan la
  // capability al empezar a ejecutar.
  const authorityActive = job.visitAuthorityDecision ?? await visitTransactionAuthorityActive();
  try {
    let authoritativeRemoteVersion: string | null = null;
    if (authorityActive) {
      await pushCloudDataWithVisitAuthority(job.snapshot);
      authoritativeRemoteVersion = await visitAuthorityRemoteVersion();
    } else {
      await pushModernCloudData(job.snapshot);
    }

    const verified = await pullModernCloudData(job.snapshot);
    if (!verified || stableFingerprint(remoteComparableCrm(verified)) !== stableFingerprint(remoteComparableCrm(job.snapshot))) {
      throw new Error('La verificación remota moderna no coincide con el snapshot que PropControl intentó guardar.');
    }
    const latest = markCloudSaved(authoritativeRemoteVersion, job.token);
    if (latest) {
      document.dispatchEvent(new CustomEvent('propcontrol-cloud-authoritative-snapshot', {
        detail: { crm: verified },
      }));
    }
  } catch (error) {
    if (authorityActive || !isLegacySchemaError(error)) throw error;
    await pushLegacyCloudData(job.snapshot, job.token);
  }
}

function latestPendingJob(completed: CloudSaveJob): CloudSaveJob | null {
  const session = getCloudSession();
  if (!session || session.userId !== completed.accountKey || !hasPendingLocalChanges()) return null;
  const local = readLocalSnapshot();
  if (!local) return null;
  const token = syncSaveToken(local);
  if (token.generation === completed.token.generation && token.fingerprint === completed.token.fingerprint) return null;
  return { accountKey: completed.accountKey, snapshot: structuredClone(local), token };
}

function accountQueue(accountKey: string): LatestSerialQueue<CloudSaveJob> {
  const existing = accountSaveQueues.get(accountKey);
  if (existing) return existing;
  const created = new LatestSerialQueue<CloudSaveJob>(runCloudPush, latestPendingJob);
  accountSaveQueues.set(accountKey, created);
  return created;
}

export async function pushCloudData(
  crm: CrmData,
  expectedAccountKey?: string,
  visitAuthorityDecision?: boolean,
): Promise<void> {
  const session = getCloudSession();
  if (!session) throw new Error('Ingresá a tu cuenta para sincronizar.');
  if (expectedAccountKey && session.userId !== expectedAccountKey) {
    throw new Error('La cuenta activa cambió antes de iniciar la sincronización.');
  }
  const snapshot = structuredClone(crm);
  const job: CloudSaveJob = {
    accountKey: session.userId,
    snapshot,
    token: syncSaveToken(snapshot),
    ...(visitAuthorityDecision === undefined ? {} : { visitAuthorityDecision }),
  };
  await accountQueue(session.userId).enqueue(job);
}

function emitStatus(message: string, kind: 'success' | 'error' | 'working' = 'success'): void {
  document.dispatchEvent(new CustomEvent('propcontrol-cloud-status', { detail: { message, kind } }));
}

export function queueCloudSave(crm: CrmData, visitAuthorityDecision?: boolean): void {
  const session = getCloudSession();
  if (!session) return;
  const accountKey = session.userId;
  const previousTimer = compatibilitySaveTimers.get(accountKey);
  if (previousTimer !== undefined) window.clearTimeout(previousTimer);
  const snapshot = structuredClone(crm);
  const timer = window.setTimeout(() => {
    compatibilitySaveTimers.delete(accountKey);
    const active = getCloudSession();
    if (!active || active.userId !== accountKey) return;
    if (!hasPendingLocalChanges()) return;
    emitStatus('Guardando en la nube…', 'working');
    void pushCloudData(snapshot, accountKey, visitAuthorityDecision)
      .then(() => {
        if (!getSyncState().dirty) emitStatus('Guardado seguro en la nube.');
      })
      .catch((error) => {
        const technicalMessage = errorMessage(error) || 'No se pudo guardar en la nube.';
        const message = `Guardado localmente, sincronización pendiente. ${technicalMessage}`;
        markSyncError(message);
        emitStatus(message, 'error');
      });
  }, 700);
  compatibilitySaveTimers.set(accountKey, timer);
}
