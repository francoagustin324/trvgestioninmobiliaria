import { canonicalUuid } from './sync-identity.js';

export type CommercialMutationError =
  | 'VALIDATION_ERROR'
  | 'PERMISSION_DENIED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'TERMINAL_STATE'
  | 'IDEMPOTENCY_REPLAY'
  | 'INTERNAL_ERROR';

export interface CommercialMutationRequest<TPayload = Record<string, unknown>> {
  organizationId: string;
  operationId: string;
  operationType: string;
  entityUid?: string;
  entityLegacyId?: number;
  expectedRevision?: number;
  clientUid?: string;
  expectedClientRevision?: number;
  payload: TPayload;
  requestedAt: string;
}

export interface CommercialMutationConflict {
  entityUid?: string;
  expectedRevision: number;
  actualRevision: number;
}

export interface CommercialMutationResponse {
  success: boolean;
  replayed: boolean;
  operationId: string;
  operationType: string;
  entityUid?: string;
  entityLegacyId?: number;
  revision?: number;
  clientUid?: string;
  clientRevision?: number;
  parentEntityUid?: string;
  parentRevision?: number;
  activityUid?: string;
  pipeline?: string;
  nextAction?: string;
  nextFollowUp?: string;
  serverTimestamp: string;
  conflict?: CommercialMutationConflict;
  errorCode?: CommercialMutationError;
  userMessage?: string;
}

function canonicalValue(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('El request contiene un número no finito.');
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(source)
      .filter((key) => source[key] !== undefined)
      .sort()
      .map((key) => [key, canonicalValue(source[key])]));
  }
  throw new Error('El request contiene un valor no serializable.');
}

/**
 * Forma estable para deduplicación local. No equivale al request_hash de la RPC:
 * el servidor recalcula y persiste el hash autoritativo desde sus propios argumentos.
 */
export function canonicalLocalCommercialIntent(request: CommercialMutationRequest): string {
  const hashInput = {
    operationType: request.operationType.trim(),
    ...(request.entityUid ? { entityUid: canonicalUuid(request.entityUid) ?? request.entityUid.trim().toLowerCase() } : {}),
    ...(request.entityLegacyId !== undefined ? { entityLegacyId: request.entityLegacyId } : {}),
    ...(request.expectedRevision !== undefined ? { expectedRevision: request.expectedRevision } : {}),
    ...(request.clientUid ? { clientUid: canonicalUuid(request.clientUid) ?? request.clientUid.trim().toLowerCase() } : {}),
    ...(request.expectedClientRevision !== undefined ? { expectedClientRevision: request.expectedClientRevision } : {}),
    payload: request.payload,
  };
  return JSON.stringify(canonicalValue(hashInput));
}

/** Fingerprint local no autoritativo; nunca sustituye el hash calculado por la RPC. */
export async function localCommercialIntentFingerprint(request: CommercialMutationRequest): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalLocalCommercialIntent(request));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
