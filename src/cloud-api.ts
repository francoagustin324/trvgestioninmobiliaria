import type { CrmData } from './models.js';

const SESSION_KEY = 'propcontrol-cloud-session-v1';
const SNAPSHOT_SOURCE = 'propcontrol_system_snapshot';

interface CloudConfig {
  configured: boolean;
  url?: string;
  publishableKey?: string;
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

interface MembershipRow {
  organization_id: string;
  role: string;
}

interface SnapshotRow {
  id: string;
  internal_data?: { crm?: unknown };
  updated_at?: string;
}

let configPromise: Promise<Required<Pick<CloudConfig, 'url' | 'publishableKey'>>> | null = null;
let refreshPromise: Promise<CloudSession | null> | null = null;
let saveTimer: number | null = null;

function emitStatus(message: string, kind: 'success' | 'error' | 'working' = 'success'): void {
  document.dispatchEvent(new CustomEvent('propcontrol-cloud-status', { detail: { message, kind } }));
}

async function parseResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  let payload: unknown = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { message: text }; }
  if (!response.ok) {
    const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    const message = [record.msg, record.message, record.error_description, record.error]
      .find((value) => typeof value === 'string' && value.trim());
    throw new Error(typeof message === 'string' ? message : `Error de conexión (${response.status}).`);
  }
  return payload;
}

async function getConfig(): Promise<Required<Pick<CloudConfig, 'url' | 'publishableKey'>>> {
  configPromise ??= fetch('/api/cloud-config', { headers: { Accept: 'application/json' }, cache: 'no-store' })
    .then(parseResponse)
    .then((payload) => {
      const config = payload as CloudConfig;
      if (!config.configured || !config.url || !config.publishableKey) {
        throw new Error('La conexión con Supabase todavía no está configurada.');
      }
      return { url: config.url.replace(/\/+$/g, ''), publishableKey: config.publishableKey };
    });
  return configPromise;
}

function authHeaders(config: Required<Pick<CloudConfig, 'url' | 'publishableKey'>>, accessToken?: string): HeadersInit {
  return {
    apikey: config.publishableKey,
    Authorization: `Bearer ${accessToken || config.publishableKey}`,
    'Content-Type': 'application/json',
  };
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

async function membership(config: Required<Pick<CloudConfig, 'url' | 'publishableKey'>>, session: CloudSession): Promise<MembershipRow> {
  const query = new URL(`${config.url}/rest/v1/organization_members`);
  query.searchParams.set('select', 'organization_id,role');
  query.searchParams.set('user_id', `eq.${session.userId}`);
  query.searchParams.set('limit', '1');
  const rows = await parseResponse(await fetch(query, { headers: authHeaders(config, session.accessToken), cache: 'no-store' })) as MembershipRow[];
  const row = rows[0];
  if (!row?.organization_id) throw new Error('La cuenta no tiene una inmobiliaria asociada.');
  return row;
}

function isCrmData(value: unknown): value is CrmData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Partial<CrmData>;
  return Array.isArray(record.clients)
    && Array.isArray(record.properties)
    && Array.isArray(record.reminders)
    && Array.isArray(record.fichas);
}

async function getSnapshotRow(config: Required<Pick<CloudConfig, 'url' | 'publishableKey'>>, session: CloudSession, organizationId: string): Promise<SnapshotRow | null> {
  const query = new URL(`${config.url}/rest/v1/fichas`);
  query.searchParams.set('select', 'id,internal_data,updated_at');
  query.searchParams.set('organization_id', `eq.${organizationId}`);
  query.searchParams.set('source', `eq.${SNAPSHOT_SOURCE}`);
  query.searchParams.set('limit', '1');
  const rows = await parseResponse(await fetch(query, { headers: authHeaders(config, session.accessToken), cache: 'no-store' })) as SnapshotRow[];
  return rows[0] || null;
}

export async function pullCloudData(): Promise<CrmData | null> {
  const session = await requireSession();
  const config = await getConfig();
  const member = await membership(config, session);
  const row = await getSnapshotRow(config, session, member.organization_id);
  const crm = row?.internal_data?.crm;
  return isCrmData(crm) ? crm : null;
}

export async function pushCloudData(crm: CrmData): Promise<void> {
  const session = await requireSession();
  const config = await getConfig();
  const member = await membership(config, session);
  const existing = await getSnapshotRow(config, session, member.organization_id);
  const payload = {
    organization_id: member.organization_id,
    title: 'Estado PropControl',
    source: SNAPSHOT_SOURCE,
    public_data: { system: true, version: 1 },
    internal_data: { crm, savedAt: new Date().toISOString(), version: 1 },
    created_by: session.userId,
  };

  const target = existing
    ? `${config.url}/rest/v1/fichas?id=eq.${encodeURIComponent(existing.id)}`
    : `${config.url}/rest/v1/fichas`;
  await parseResponse(await fetch(target, {
    method: existing ? 'PATCH' : 'POST',
    headers: { ...authHeaders(config, session.accessToken), Prefer: 'return=minimal' },
    body: JSON.stringify(payload),
  }));
}

export function queueCloudSave(crm: CrmData): void {
  if (!getCloudSession()) return;
  if (saveTimer !== null) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    emitStatus('Guardando en la nube…', 'working');
    void pushCloudData(crm)
      .then(() => emitStatus('Guardado en la nube.'))
      .catch((error) => emitStatus(error instanceof Error ? error.message : 'No se pudo guardar en la nube.', 'error'));
  }, 700);
}
