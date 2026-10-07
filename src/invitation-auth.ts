import {
  assertSharedAuthGenerationCurrent,
  assertSharedCloudSessionCurrent,
  captureSharedAuthGeneration,
  commitSharedCloudSession,
  readSharedCloudSession,
  type SharedCloudSession,
} from './auth-session-generation.js';

const INVITATION_KEY = 'propcontrol-pending-invitation-v1';

interface PublicCloudConfig {
  configured?: boolean;
  url?: string;
  publishableKey?: string;
}

type StoredCloudSession = SharedCloudSession;

interface PendingInvitation {
  userId: string;
  startedAt: number;
}

interface AuthUserResponse {
  id?: string;
  email?: string;
  message?: string;
  msg?: string;
  error?: string;
  error_description?: string;
}

export interface InvitationFragment {
  type: string;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  expiresAt: number;
  errorCode: string;
  errorDescription: string;
}

export function parseInvitationFragment(hash: string): InvitationFragment {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const expiresIn = Number(params.get('expires_in') || 0);
  const expiresAt = Number(params.get('expires_at') || 0);
  return {
    type: String(params.get('type') || '').toLowerCase(),
    accessToken: String(params.get('access_token') || ''),
    refreshToken: String(params.get('refresh_token') || ''),
    expiresIn: Number.isFinite(expiresIn) ? expiresIn : 0,
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : 0,
    errorCode: String(params.get('error_code') || params.get('error') || ''),
    errorDescription: String(params.get('error_description') || ''),
  };
}

export function isInvitationCallback(hash = location.hash): boolean {
  const parsed = parseInvitationFragment(hash);
  return parsed.type === 'invite'
    || Boolean(parsed.accessToken && parsed.refreshToken)
    || Boolean(parsed.errorCode || parsed.errorDescription);
}

async function parseResponse(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  let payload: unknown = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { message: text }; }
  const record = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
  if (!response.ok) {
    const message = [record.msg, record.message, record.error_description, record.error]
      .find((value) => typeof value === 'string' && value.trim());
    throw new Error(typeof message === 'string' ? message : `Supabase respondió ${response.status}.`);
  }
  return record;
}

async function publicConfig(): Promise<Required<Pick<PublicCloudConfig, 'url' | 'publishableKey'>>> {
  const response = await parseResponse(await fetch('/api/cloud-config', {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  }));
  const configured = Boolean(response.configured);
  const url = typeof response.url === 'string' ? response.url.replace(/\/+$/g, '') : '';
  const publishableKey = typeof response.publishableKey === 'string' ? response.publishableKey : '';
  if (!configured || !url || !publishableKey) {
    throw new Error('La conexión segura todavía no está configurada.');
  }
  return { url, publishableKey };
}

function readStoredSession(): StoredCloudSession | null {
  return readSharedCloudSession();
}

function readPendingInvitation(): PendingInvitation | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(INVITATION_KEY) || 'null') as Partial<PendingInvitation> | null;
    if (!parsed?.userId || !parsed.startedAt) return null;
    return { userId: parsed.userId, startedAt: Number(parsed.startedAt) };
  } catch {
    return null;
  }
}

export function hasPendingInvitationSession(): boolean {
  const session = readStoredSession();
  const pending = readPendingInvitation();
  return Boolean(session && pending && session.userId === pending.userId);
}

export async function consumeInvitationSessionFromUrl(): Promise<void> {
  const operationSharedGeneration = captureSharedAuthGeneration();
  const parsed = parseInvitationFragment(location.hash);
  if (parsed.errorCode || parsed.errorDescription) {
    history.replaceState(null, '', '/aceptar-invitacion');
    const detail = parsed.errorDescription || parsed.errorCode;
    throw new Error(`La invitación no es válida o venció${detail ? `: ${detail}` : '.'}`);
  }

  if (!parsed.accessToken || !parsed.refreshToken) {
    if (hasPendingInvitationSession()) return;
    throw new Error('El enlace de invitación no contiene una sesión válida. Pedí una nueva invitación.');
  }

  const config = await publicConfig();
  const user = await parseResponse(await fetch(`${config.url}/auth/v1/user`, {
    headers: {
      apikey: config.publishableKey,
      Authorization: `Bearer ${parsed.accessToken}`,
      Accept: 'application/json',
    },
    cache: 'no-store',
  })) as AuthUserResponse;
  if (!user.id) throw new Error('Supabase no pudo identificar al usuario invitado.');

  const expiresAt = parsed.expiresAt > 0
    ? parsed.expiresAt * 1000
    : Date.now() + Math.max(60, parsed.expiresIn || 3600) * 1000;
  const session: StoredCloudSession = {
    accessToken: parsed.accessToken,
    refreshToken: parsed.refreshToken,
    expiresAt,
    userId: user.id,
    email: user.email || '',
  };

  assertSharedAuthGenerationCurrent(operationSharedGeneration);
  const committedGeneration = commitSharedCloudSession(operationSharedGeneration, session);
  assertSharedCloudSessionCurrent(committedGeneration, session);
  localStorage.setItem(INVITATION_KEY, JSON.stringify({ userId: session.userId, startedAt: Date.now() }));
  history.replaceState(null, '', '/aceptar-invitacion');
}

async function activateInvitationMemberships(
  session: StoredCloudSession,
  config: Required<Pick<PublicCloudConfig, 'url' | 'publishableKey'>>,
  authGeneration: string,
): Promise<void> {
  assertSharedCloudSessionCurrent(authGeneration, session);
  await parseResponse(await fetch(`${config.url}/rest/v1/rpc/activate_my_organization_memberships`, {
    method: 'POST',
    headers: {
      apikey: config.publishableKey,
      Authorization: `Bearer ${session.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
    cache: 'no-store',
  }));
  assertSharedCloudSessionCurrent(authGeneration, session);
}

export async function setInvitationPassword(password: string): Promise<void> {
  if (password.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.');
  const authGeneration = captureSharedAuthGeneration();
  const session = readStoredSession();
  const pending = readPendingInvitation();
  if (!session || !pending || session.userId !== pending.userId) {
    throw new Error('La sesión de invitación no es válida. Pedí una nueva invitación.');
  }
  assertSharedCloudSessionCurrent(authGeneration, session);

  const config = await publicConfig();
  assertSharedCloudSessionCurrent(authGeneration, session);
  await parseResponse(await fetch(`${config.url}/auth/v1/user`, {
    method: 'PUT',
    headers: {
      apikey: config.publishableKey,
      Authorization: `Bearer ${session.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ password }),
  }));
  assertSharedCloudSessionCurrent(authGeneration, session);
  await activateInvitationMemberships(session, config, authGeneration);
  assertSharedCloudSessionCurrent(authGeneration, session);
  localStorage.removeItem(INVITATION_KEY);
}
