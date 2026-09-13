import { getCloudSession } from './cloud-api.js';
import type { CloudMembershipRow } from './cloud-records.js';
import {
  normalizeMembershipCatalogStatus,
  type MembershipCatalogEntry,
} from './active-organization.js';
import {
  assertSharedAuthGenerationCurrent,
  assertSharedCloudSessionCurrent,
  captureSharedAuthGeneration,
  type SharedCloudSession,
} from './auth-session-generation.js';

interface PublicCloudConfig {
  configured?: boolean;
  url?: string;
  publishableKey?: string;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  let payload: unknown = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { message: text }; }
  if (!response.ok) {
    const value = record(payload);
    const message = [value.message, value.error_description, value.error, value.hint]
      .find((candidate) => typeof candidate === 'string' && candidate.trim());
    throw new Error(typeof message === 'string' ? message : `Error de conexión (${response.status}).`);
  }
  return payload;
}

function assertCatalogAuthority(generation: string, session: SharedCloudSession): void {
  assertSharedAuthGenerationCurrent(generation);
  assertSharedCloudSessionCurrent(generation, session);
}

async function publicConfig(
  generation: string,
  session: SharedCloudSession,
): Promise<Required<Pick<PublicCloudConfig, 'url' | 'publishableKey'>>> {
  assertCatalogAuthority(generation, session);
  const response = await fetch('/api/cloud-config', {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  assertCatalogAuthority(generation, session);
  const payload = await parseJson(response) as PublicCloudConfig;
  assertCatalogAuthority(generation, session);
  if (!payload.configured || !payload.url || !payload.publishableKey) {
    throw new Error('La conexión con Supabase todavía no está configurada.');
  }
  return {
    url: payload.url.replace(/\/+$/g, ''),
    publishableKey: payload.publishableKey,
  };
}

function authenticatedHeaders(publishableKey: string, accessToken: string): Record<string, string> {
  return {
    apikey: publishableKey,
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
}

export function membershipCatalogEntryFromRow(row: CloudMembershipRow): MembershipCatalogEntry {
  const rawStatus = String(row.status ?? '');
  return Object.freeze({
    organizationId: String(row.organization_id ?? '').trim(),
    userId: String(row.user_id ?? '').trim(),
    status: normalizeMembershipCatalogStatus(rawStatus),
    rawStatus,
    role: String(row.role ?? ''),
    memberId: Number.isFinite(row.member_id) ? Number(row.member_id) : undefined,
    displayName: row.display_name,
    email: row.email,
    phone: row.phone,
  });
}

/**
 * A1.2 membership discovery surface.
 *
 * Read-only by contract: it reads the authenticated user's complete membership
 * catalog and never activates invitations or chooses an organization.
 *
 * A3.4: every material async boundary is fenced by the same shared auth
 * generation and exact session (user + access token + refresh token) that
 * initiated discovery. A catalog result can therefore never survive A->B->A or
 * a same-user token/session replacement.
 */
export async function fetchMembershipCatalog(): Promise<readonly MembershipCatalogEntry[]> {
  const session = getCloudSession();
  if (!session) throw new Error('Ingresá a tu cuenta para consultar tus inmobiliarias.');
  const authGeneration = captureSharedAuthGeneration();
  assertCatalogAuthority(authGeneration, session);

  const config = await publicConfig(authGeneration, session);
  assertCatalogAuthority(authGeneration, session);
  const query = new URL(`${config.url}/rest/v1/organization_members`);
  query.searchParams.set(
    'select',
    'organization_id,member_id,user_id,role,status,display_name,email,phone,created_at,last_active_at',
  );
  query.searchParams.set('user_id', `eq.${session.userId}`);
  query.searchParams.set('order', 'organization_id.asc,member_id.asc');

  const response = await fetch(query, {
    method: 'GET',
    headers: authenticatedHeaders(config.publishableKey, session.accessToken),
    cache: 'no-store',
  });
  assertCatalogAuthority(authGeneration, session);
  const payload = await parseJson(response);
  assertCatalogAuthority(authGeneration, session);
  if (!Array.isArray(payload)) throw new Error('Supabase devolvió un catálogo de membresías inválido.');

  const memberships = Object.freeze(payload
    .map((row) => membershipCatalogEntryFromRow(row as CloudMembershipRow))
    .filter((membership) => membership.userId === session.userId));
  assertCatalogAuthority(authGeneration, session);
  return memberships;
}
