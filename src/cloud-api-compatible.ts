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

export {
  getCloudSession,
  inviteTeamMember,
  signInCloud,
  signOutCloud,
  signUpCloud,
  updateTeamMemberAccess,
};

const SNAPSHOT_SOURCE = 'propcontrol_system_snapshot';
let compatibilitySaveTimer: number | null = null;

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
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? '');
}

export function isLegacySchemaError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  return (
    message.includes('organization_members.member_id')
    || message.includes('organization_members.display_name')
    || message.includes('organization_members.status')
    || message.includes('organization_members.last_active_at')
    || message.includes('propcontrol_records')
    || message.includes('pgrst204')
    || message.includes('pgrst205')
    || message.includes('42p01')
    || message.includes('42703')
  ) && (
    message.includes('does not exist')
    || message.includes('could not find')
    || message.includes('schema cache')
    || message.includes('undefined')
    || message.includes('pgrst')
  );
}

function isCrmData(value: unknown): value is CrmData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Partial<CrmData>;
  return Array.isArray(record.clients)
    && Array.isArray(record.properties)
    && Array.isArray(record.reminders)
    && Array.isArray(record.fichas);
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
  return isCrmData(crm) ? crm : null;
}

async function pushLegacyCloudData(crm: CrmData): Promise<void> {
  const { row, membership } = await legacySnapshotRow();
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
}

export async function pullCloudData(fallback?: CrmData): Promise<CrmData | null> {
  try {
    return await pullModernCloudData(fallback);
  } catch (error) {
    if (!isLegacySchemaError(error)) throw error;
    return await pullLegacyCloudData();
  }
}

export async function pushCloudData(crm: CrmData): Promise<void> {
  try {
    await pushModernCloudData(crm);
  } catch (error) {
    if (!isLegacySchemaError(error)) throw error;
    await pushLegacyCloudData(crm);
  }
}

function emitStatus(message: string, kind: 'success' | 'error' | 'working' = 'success'): void {
  document.dispatchEvent(new CustomEvent('propcontrol-cloud-status', { detail: { message, kind } }));
}

export function queueCloudSave(crm: CrmData): void {
  if (!getCloudSession()) return;
  if (compatibilitySaveTimer !== null) window.clearTimeout(compatibilitySaveTimer);
  compatibilitySaveTimer = window.setTimeout(() => {
    compatibilitySaveTimer = null;
    emitStatus('Guardando en la nube…', 'working');
    void pushCloudData(crm)
      .then(() => emitStatus('Guardado en la nube.'))
      .catch((error) => emitStatus(errorMessage(error) || 'No se pudo guardar en la nube.', 'error'));
  }, 700);
}
