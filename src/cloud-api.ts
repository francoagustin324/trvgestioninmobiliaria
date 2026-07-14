import type { CrmData, TeamMember, TeamRole, TeamMemberStatus } from './models.js';
import { initialData } from './models.js';
import {
  cloudRecordIdentity,
  cloudRecordsToCrm,
  crmToCloudRecords,
  membershipContext,
  staleCloudRecords,
  type CloudMembershipContext,
  type CloudMembershipRow,
  type CloudRecordRow,
} from './cloud-records.js';
import {
  assertRemoteIsSafe,
  latestRemoteVersion,
  markCloudHydrated,
  markCloudSaved,
  markSyncError,
  stableFingerprint,
} from './sync-safety.js';

const SESSION_KEY = 'propcontrol-cloud-session-v1';
const SNAPSHOT_SOURCE = 'propcontrol_system_snapshot';

interface CloudConfig {
  configured: boolean;
  url?: string;
  publishableKey?: string;
  invitationsConfigured?: boolean;
}

export interface CloudSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  userId: string;
  email: string;
}

interface AuthResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  user?: { id?: string; email?: string };
  msg?: string;
  message?: string;
  error_description?: string;
}

interface LegacySnapshot {
  crm: CrmData;
  updatedAt?: string;
}

interface LegacySnapshotRow {
  id: string;
  internal_data?: { crm?: unknown };
  updated_at?: string;
}

interface TeamMutationResponse {
  success?: boolean;
  member?: {
    member_id?: number;
    user_id?: string;
    organization_id?: string;
    display_name?: string;
    email?: string;
    phone?: string;
    role?: string;
    status?: string;
    created_at?: string;
    last_active_at?: string;
  };
  error?: string;
}

class CloudHttpError extends Error {
  constructor(message: string, readonly status: number, readonly code = '') {
    super(message);
  }
}

let configPromise: Promise<Required<Pick<CloudConfig, 'url' | 'publishableKey'>> & Pick<CloudConfig, 'invitationsConfigured'>> | null = null;
let refreshPromise: Promise<CloudSession | null> | null = null;
let saveTimer: number | null = null;

function emitStatus(message: string, kind: 'success' | 'error' | 'working' = 'success'): void {
  document.dispatchEvent(new CustomEvent('propcontrol-cloud-status', { detail: { message, kind } }));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'No se pudo guardar en la nube.';
}

async function parseResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  let payload: unknown = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { message: text }; }
  if (!response.ok) {
    const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    const message = [record.msg, record.message, record.error_description, record.error]
      .find((value) => typeof value === 'string' && value.trim());
    throw new CloudHttpError(
      typeof message === 'string' ? message : `Error de conexión (${response.status}).`,
      response.status,
      typeof record.code === 'string' ? record.code : '',
    );
  }
  return payload;
}

async function getConfig(): Promise<Required<Pick<CloudConfig, 'url' | 'publishableKey'>> & Pick<CloudConfig, 'invitationsConfigured'>> {
  configPromise ??= fetch('/api/cloud-config', { headers: { Accept: 'application/json' }, cache: 'no-store' })
    .then(parseResponse)
    .then((payload) => {
      const config = payload as CloudConfig;
      if (!config.configured || !config.url || !config.publishableKey) {
        throw new Error('La conexión con Supabase todavía no está configurada.');
      }
      return {
        url: config.url.replace(/\/+$/g, ''),
        publishableKey: config.publishableKey,
        invitationsConfigured: Boolean(config.invitationsConfigured),
      };
    });
  return configPromise;
}

function authHeaders(config: Required<Pick<CloudConfig, 'url' | 'publishableKey'>>, accessToken?: string): Record<string, string> {
  const headers: Record<string, string> = {
    apikey: config.publishableKey,
    'Content-Type': 'application/json',
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return headers;
}

function toSession(payload: AuthResponse): CloudSession | null {
  if (!payload.access_token || !payload.refresh_token || !payload.user?.id) return null;
  const expiresIn = Number(payload.expires_in || 3600);
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: Date.now() + Math.max(60, expiresIn - 30) * 1000,
    userId: payload.user.id,
    email: payload.user.email || '',
  };
}

function storeSession(session: CloudSession | null): void {
  if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else localStorage.removeItem(SESSION_KEY);
}

export function getCloudSession(): CloudSession | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null') as Partial<CloudSession> | null;
    if (!parsed?.accessToken || !parsed.refreshToken || !parsed.userId || !parsed.expiresAt) return null;
    return {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      userId: parsed.userId,
      expiresAt: Number(parsed.expiresAt),
      email: parsed.email || '',
    };
  } catch { return null; }
}

export function signOutCloud(): void {
  storeSession(null);
  emitStatus('Sesión cerrada. Los datos siguen guardados en este dispositivo.');
}

export async function signUpCloud(email: string, password: string, companyName: string): Promise<{ session: CloudSession | null; message: string }> {
  const config = await getConfig();
  const payload = await parseResponse(await fetch(`${config.url}/auth/v1/signup`, {
    method: 'POST',
    headers: authHeaders(config),
    body: JSON.stringify({
      email: email.trim().toLowerCase(),
      password,
      data: { company_name: companyName.trim() || 'Mi inmobiliaria' },
    }),
  })) as AuthResponse;
  const session = toSession(payload);
  storeSession(session);
  return session
    ? { session, message: 'Cuenta creada y conectada.' }
    : { session: null, message: 'Cuenta creada. Revisá tu correo, confirmá el registro y después ingresá.' };
}

export async function signInCloud(email: string, password: string): Promise<CloudSession> {
  const config = await getConfig();
  const payload = await parseResponse(await fetch(`${config.url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: authHeaders(config),
    body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
  })) as AuthResponse;
  const session = toSession(payload);
  if (!session) throw new Error('Supabase no devolvió una sesión válida.');
  storeSession(session);
  return session;
}

async function refreshCloudSession(session: CloudSession): Promise<CloudSession | null> {
  if (session.expiresAt > Date.now()) return session;
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const config = await getConfig();
      const payload = await parseResponse(await fetch(`${config.url}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: authHeaders(config),
        body: JSON.stringify({ refresh_token: session.refreshToken }),
      })) as AuthResponse;
      const renewed = toSession(payload);
      storeSession(renewed);
      return renewed;
    } catch {
      storeSession(null);
      return null;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

async function requireSession(): Promise<CloudSession> {
  const existing = getCloudSession();
  if (!existing) throw new Error('Ingresá a tu cuenta para sincronizar.');
  const session = await refreshCloudSession(existing);
  if (!session) throw new Error('La sesión venció. Volvé a ingresar.');
  return session;
}

async function activateMemberships(config: Required<Pick<CloudConfig, 'url' | 'publishableKey'>>, session: CloudSession): Promise<void> {
  try {
    await parseResponse(await fetch(`${config.url}/rest/v1/rpc/activate_my_organization_memberships`, {
      method: 'POST',
      headers: authHeaders(config, session.accessToken),
      body: '{}',
    }));
  } catch (error) {
    if (!(error instanceof CloudHttpError) || !['PGRST202', '42883'].includes(error.code)) throw error;
  }
}

async function fetchMembershipRows(config: Required<Pick<CloudConfig, 'url' | 'publishableKey'>>, session: CloudSession): Promise<CloudMembershipRow[]> {
  const ownQuery = new URL(`${config.url}/rest/v1/organization_members`);
  ownQuery.searchParams.set('select', 'organization_id,member_id,user_id,role,status,display_name,email,phone,created_at,last_active_at');
  ownQuery.searchParams.set('user_id', `eq.${session.userId}`);
  ownQuery.searchParams.set('limit', '1');
  const ownRows = await parseResponse(await fetch(ownQuery, {
    headers: authHeaders(config, session.accessToken),
    cache: 'no-store',
  })) as CloudMembershipRow[];
  const own = ownRows[0];
  if (!own?.organization_id) throw new Error('La cuenta no tiene una inmobiliaria asociada.');

  const directoryQuery = new URL(`${config.url}/rest/v1/organization_members`);
  directoryQuery.searchParams.set('select', 'organization_id,member_id,user_id,role,status,display_name,email,phone,created_at,last_active_at');
  directoryQuery.searchParams.set('organization_id', `eq.${own.organization_id}`);
  directoryQuery.searchParams.set('order', 'member_id.asc');
  return await parseResponse(await fetch(directoryQuery, {
    headers: authHeaders(config, session.accessToken),
    cache: 'no-store',
  })) as CloudMembershipRow[];
}

export async function getCloudMembershipContext(): Promise<CloudMembershipContext> {
  const session = await requireSession();
  const config = await getConfig();
  await activateMemberships(config, session);
  return membershipContext(await fetchMembershipRows(config, session), session.userId);
}

function isCrmData(value: unknown): value is CrmData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Partial<CrmData>;
  return Array.isArray(record.clients)
    && Array.isArray(record.properties)
    && Array.isArray(record.reminders)
    && Array.isArray(record.fichas);
}

async function getLegacySnapshot(
  config: Required<Pick<CloudConfig, 'url' | 'publishableKey'>>,
  session: CloudSession,
  organizationId: string,
): Promise<LegacySnapshot | null> {
  const query = new URL(`${config.url}/rest/v1/fichas`);
  query.searchParams.set('select', 'id,internal_data,updated_at');
  query.searchParams.set('organization_id', `eq.${organizationId}`);
  query.searchParams.set('source', `eq.${SNAPSHOT_SOURCE}`);
  query.searchParams.set('limit', '1');
  const rows = await parseResponse(await fetch(query, {
    headers: authHeaders(config, session.accessToken),
    cache: 'no-store',
  })) as LegacySnapshotRow[];
  const crm = rows[0]?.internal_data?.crm;
  return isCrmData(crm) ? { crm, updatedAt: rows[0]?.updated_at } : null;
}

async function fetchCloudRecords(
  config: Required<Pick<CloudConfig, 'url' | 'publishableKey'>>,
  session: CloudSession,
  organizationId: string,
): Promise<CloudRecordRow[]> {
  const query = new URL(`${config.url}/rest/v1/propcontrol_records`);
  query.searchParams.set('select', 'organization_id,entity_type,entity_key,assigned_member_id,payload,created_by,updated_at');
  query.searchParams.set('organization_id', `eq.${organizationId}`);
  query.searchParams.set('order', 'entity_type.asc,entity_key.asc');
  return await parseResponse(await fetch(query, {
    headers: authHeaders(config, session.accessToken),
    cache: 'no-store',
  })) as CloudRecordRow[];
}

async function upsertRecords(
  config: Required<Pick<CloudConfig, 'url' | 'publishableKey'>>,
  session: CloudSession,
  records: CloudRecordRow[],
): Promise<void> {
  for (let index = 0; index < records.length; index += 100) {
    const chunk = records.slice(index, index + 100);
    const target = new URL(`${config.url}/rest/v1/propcontrol_records`);
    target.searchParams.set('on_conflict', 'organization_id,entity_type,entity_key');
    await parseResponse(await fetch(target, {
      method: 'POST',
      headers: {
        ...authHeaders(config, session.accessToken),
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(chunk),
    }));
  }
}

async function deleteStaleRecords(
  config: Required<Pick<CloudConfig, 'url' | 'publishableKey'>>,
  session: CloudSession,
  stale: CloudRecordRow[],
): Promise<void> {
  const grouped = new Map<string, string[]>();
  stale.forEach((record) => {
    const keys = grouped.get(record.entity_type) ?? [];
    keys.push(record.entity_key);
    grouped.set(record.entity_type, keys);
  });
  for (const [entityType, keys] of grouped) {
    for (let index = 0; index < keys.length; index += 100) {
      const target = new URL(`${config.url}/rest/v1/propcontrol_records`);
      target.searchParams.set('entity_type', `eq.${entityType}`);
      target.searchParams.set('entity_key', `in.(${keys.slice(index, index + 100).map((key) => `"${key.replaceAll('"', '')}"`).join(',')})`);
      await parseResponse(await fetch(target, {
        method: 'DELETE',
        headers: { ...authHeaders(config, session.accessToken), Prefer: 'return=minimal' },
      }));
    }
  }
}

function recordsFingerprint(records: CloudRecordRow[]): string {
  return stableFingerprint(records
    .map((record) => ({
      organization_id: record.organization_id,
      entity_type: record.entity_type,
      entity_key: record.entity_key,
      assigned_member_id: record.assigned_member_id,
      payload: record.payload,
    }))
    .sort((left, right) => `${left.entity_type}:${left.entity_key}`.localeCompare(`${right.entity_type}:${right.entity_key}`)));
}

async function pushWithContext(
  crm: CrmData,
  config: Required<Pick<CloudConfig, 'url' | 'publishableKey'>>,
  session: CloudSession,
  context: CloudMembershipContext,
): Promise<void> {
  const existing = await fetchCloudRecords(config, session, context.organizationId);
  const next = crmToCloudRecords(crm, context, session.userId);
  const existingFingerprint = recordsFingerprint(existing);
  const nextFingerprint = recordsFingerprint(next);
  const remoteVersion = latestRemoteVersion(existing);

  assertRemoteIsSafe(remoteVersion, nextFingerprint, existingFingerprint);
  if (existingFingerprint === nextFingerprint) {
    markCloudSaved(remoteVersion);
    return;
  }

  await upsertRecords(config, session, next);
  await deleteStaleRecords(config, session, staleCloudRecords(existing, next));
  const refreshed = await fetchCloudRecords(config, session, context.organizationId);
  markCloudSaved(latestRemoteVersion(refreshed));
}

export async function pullCloudData(fallback: CrmData = initialData): Promise<CrmData | null> {
  const session = await requireSession();
  const config = await getConfig();
  await activateMemberships(config, session);
  const context = membershipContext(await fetchMembershipRows(config, session), session.userId);
  try {
    const records = await fetchCloudRecords(config, session, context.organizationId);
    if (records.length) {
      markCloudHydrated(latestRemoteVersion(records));
      return cloudRecordsToCrm(records, context, fallback);
    }

    if (context.currentRole !== 'Corredor') {
      const legacy = await getLegacySnapshot(config, session, context.organizationId);
      if (legacy) {
        markCloudHydrated(legacy.updatedAt || null);
        const migrated = { ...legacy.crm, organization: { ...legacy.crm.organization, id: context.organizationId }, teamMembers: context.members };
        await pushWithContext(migrated, config, session, context);
        return migrated;
      }
      markCloudHydrated(null);
      return null;
    }
    markCloudHydrated(null);
    return cloudRecordsToCrm([], context, fallback);
  } catch (error) {
    if (error instanceof CloudHttpError && ['PGRST205', '42P01'].includes(error.code)) {
      if (context.currentRole === 'Corredor') {
        throw new Error('La seguridad multiusuario todavía no fue activada en Supabase.');
      }
      const legacy = await getLegacySnapshot(config, session, context.organizationId);
      markCloudHydrated(legacy?.updatedAt || null);
      return legacy?.crm ?? null;
    }
    throw error;
  }
}

export async function pushCloudData(crm: CrmData): Promise<void> {
  const session = await requireSession();
  const config = await getConfig();
  await activateMemberships(config, session);
  const context = membershipContext(await fetchMembershipRows(config, session), session.userId);
  await pushWithContext({ ...crm, organization: { ...crm.organization, id: context.organizationId }, teamMembers: context.members }, config, session, context);
}

function mapMutationMember(value: NonNullable<TeamMutationResponse['member']>): TeamMember {
  const role = String(value.role || '').toLowerCase();
  const status = String(value.status || '').toLowerCase();
  return {
    id: Number(value.member_id),
    userId: value.user_id,
    name: String(value.display_name || value.email?.split('@')[0] || 'Integrante'),
    email: String(value.email || ''),
    phone: value.phone || undefined,
    role: role === 'owner' ? 'Dueño' : role === 'admin' ? 'Administrador' : 'Corredor',
    status: status === 'suspended' ? 'Suspendido' : status === 'invited' ? 'Pendiente de acceso' : 'Activo',
    createdAt: String(value.created_at || new Date().toISOString()),
    lastActiveAt: value.last_active_at || undefined,
  };
}

async function teamMutation(path: string, method: 'POST' | 'PATCH', payload: unknown): Promise<TeamMember> {
  const session = await requireSession();
  const response = await parseResponse(await fetch(path, {
    method,
    headers: { Authorization: `Bearer ${session.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })) as TeamMutationResponse;
  if (!response.success || !response.member) throw new Error(response.error || 'No se pudo actualizar el equipo.');
  return mapMutationMember(response.member);
}

export async function inviteTeamMember(input: { name: string; email: string; phone?: string; role: Exclude<TeamRole, 'Dueño'> }): Promise<TeamMember> {
  return teamMutation('/api/team/invitations', 'POST', input);
}

export async function updateTeamMemberAccess(memberId: number, input: { role?: Exclude<TeamRole, 'Dueño'>; status?: TeamMemberStatus }): Promise<TeamMember> {
  return teamMutation(`/api/team/members/${memberId}`, 'PATCH', input);
}

export function queueCloudSave(crm: CrmData): void {
  if (!getCloudSession()) return;
  if (saveTimer !== null) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    emitStatus('Guardando con protección contra sobrescrituras…', 'working');
    void pushCloudData(crm)
      .then(() => emitStatus('Guardado seguro en la nube.'))
      .catch((error) => {
        const message = errorMessage(error);
        markSyncError(message);
        emitStatus(message, 'error');
      });
  }, 700);
}

export function cloudRecordIds(records: CloudRecordRow[]): string[] {
  return records.map(cloudRecordIdentity);
}
