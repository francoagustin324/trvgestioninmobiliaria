import { invalidateTenantRuntimeScope } from './tenant-runtime.js';

export const CLOUD_SESSION_KEY = 'propcontrol-cloud-session-v1';
export const CLOUD_AUTH_GENERATION_KEY = 'propcontrol-cloud-auth-generation-v1';
export const AUTH_SHARED_GENERATION_STALE = 'AUTH_SHARED_GENERATION_STALE';

const STORED_GENERATION_FIELD = '__propcontrolAuthGeneration';

type CrossTabAuthListener = () => void;

export interface SharedCloudSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  userId: string;
  email: string;
}

type StoredSharedCloudSession = SharedCloudSession & {
  [STORED_GENERATION_FIELD]?: string;
};

const crossTabListeners = new Set<CrossTabAuthListener>();
let storageListenerBound = false;
let fallbackGenerationCounter = 0;

function browserStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function nextSharedGeneration(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }
  fallbackGenerationCounter += 1;
  return `${Date.now().toString(36)}-${fallbackGenerationCounter.toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function captureSharedAuthGeneration(): string {
  return browserStorage()?.getItem(CLOUD_AUTH_GENERATION_KEY) ?? '';
}

export function sharedAuthGenerationIsCurrent(generation: string): boolean {
  return captureSharedAuthGeneration() === generation;
}

export function assertSharedAuthGenerationCurrent(generation: string): void {
  if (!sharedAuthGenerationIsCurrent(generation)) {
    throw new Error(AUTH_SHARED_GENERATION_STALE);
  }
}

function isValidSession(value: unknown): value is StoredSharedCloudSession {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const session = value as Partial<StoredSharedCloudSession>;
  return typeof session.accessToken === 'string'
    && Boolean(session.accessToken)
    && typeof session.refreshToken === 'string'
    && Boolean(session.refreshToken)
    && typeof session.userId === 'string'
    && Boolean(session.userId)
    && Number.isFinite(Number(session.expiresAt));
}

export function readSharedCloudSession(): SharedCloudSession | null {
  const storage = browserStorage();
  if (!storage) return null;
  try {
    const parsed = JSON.parse(storage.getItem(CLOUD_SESSION_KEY) || 'null') as unknown;
    if (!isValidSession(parsed)) return null;
    const sharedGeneration = captureSharedAuthGeneration();
    const storedGeneration = parsed[STORED_GENERATION_FIELD];

    // Backward-compatible bootstrap: a pre-FDR-02 session is accepted only while
    // no shared generation has ever been committed. After the first material
    // auth change, session and generation must match exactly.
    if (sharedGeneration) {
      if (!storedGeneration || storedGeneration !== sharedGeneration) return null;
    } else if (storedGeneration) {
      return null;
    }

    return {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      expiresAt: Number(parsed.expiresAt),
      userId: parsed.userId,
      email: parsed.email || '',
    };
  } catch {
    return null;
  }
}

export function commitSharedCloudSession(
  expectedGeneration: string,
  session: SharedCloudSession | null,
): string {
  const storage = browserStorage();
  if (!storage) throw new Error('AUTH_SHARED_STORAGE_UNAVAILABLE');
  assertSharedAuthGenerationCurrent(expectedGeneration);

  const nextGeneration = nextSharedGeneration();
  if (session) {
    const stored: StoredSharedCloudSession = {
      ...session,
      [STORED_GENERATION_FIELD]: nextGeneration,
    };
    storage.setItem(CLOUD_SESSION_KEY, JSON.stringify(stored));
  } else {
    storage.removeItem(CLOUD_SESSION_KEY);
  }

  // Generation is committed last. Readers fail closed while session/generation
  // are temporarily inconsistent and cross-tab listeners observe only the final
  // authority change.
  storage.setItem(CLOUD_AUTH_GENERATION_KEY, nextGeneration);

  if (!sharedAuthGenerationIsCurrent(nextGeneration)) {
    throw new Error(AUTH_SHARED_GENERATION_STALE);
  }
  if (session) {
    const current = readSharedCloudSession();
    if (
      !current
      || current.userId !== session.userId
      || current.accessToken !== session.accessToken
      || current.refreshToken !== session.refreshToken
    ) {
      throw new Error(AUTH_SHARED_GENERATION_STALE);
    }
  } else if (readSharedCloudSession()) {
    throw new Error(AUTH_SHARED_GENERATION_STALE);
  }
  return nextGeneration;
}

export function assertSharedCloudSessionCurrent(
  generation: string,
  session: SharedCloudSession,
): void {
  assertSharedAuthGenerationCurrent(generation);
  const current = readSharedCloudSession();
  if (
    !current
    || current.userId !== session.userId
    || current.accessToken !== session.accessToken
    || current.refreshToken !== session.refreshToken
  ) {
    throw new Error(AUTH_SHARED_GENERATION_STALE);
  }
}

export function subscribeCrossTabAuthGeneration(listener: CrossTabAuthListener): () => void {
  crossTabListeners.add(listener);
  return () => crossTabListeners.delete(listener);
}

function handleCrossTabStorageEvent(event: StorageEvent): void {
  if (event.key !== CLOUD_AUTH_GENERATION_KEY || event.oldValue === event.newValue) return;

  // A storage event is delivered only to other browsing contexts. Do not write
  // storage here: this is one-way invalidation and cannot create an event loop.
  invalidateTenantRuntimeScope();
  for (const listener of [...crossTabListeners]) listener();
}

function bindCrossTabStorageListener(): void {
  if (storageListenerBound) return;
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  window.addEventListener('storage', handleCrossTabStorageEvent);
  storageListenerBound = true;
}

bindCrossTabStorageListener();
