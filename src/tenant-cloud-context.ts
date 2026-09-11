import type { TenantScope } from './active-organization.js';
import { membershipContext, type CloudMembershipContext, type CloudMembershipRow } from './cloud-records.js';
import { getCloudSession } from './cloud-api.js';

export const TENANT_CLOUD_SESSION_REQUIRED = 'TENANT_CLOUD_SESSION_REQUIRED';
export const TENANT_CLOUD_SESSION_MISMATCH = 'TENANT_CLOUD_SESSION_MISMATCH';
export const TENANT_CLOUD_MEMBERSHIP_REQUIRED = 'TENANT_CLOUD_MEMBERSHIP_REQUIRED';
export const TENANT_CLOUD_RESPONSE_MISMATCH = 'TENANT_CLOUD_RESPONSE_MISMATCH';

export interface TenantCloudConfig {
  url: string;
  publishableKey: string;
}

export type TenantCloudTransport = Readonly<{
  scope: TenantScope;
  context: CloudMembershipContext;
  accessToken: string;
  userId: string;
  config: TenantCloudConfig;
}>;

interface PublicCloudConfig {
  configured?: boolean;
  url?: string;
  publishableKey?: string;
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export async function parseTenantCloudJson(response: Response): Promise<unknown> {
  const text = await response.text();
  let payload: unknown = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { message: text }; }
  if (!response.ok) {
    const record = objectRecord(payload);
    const message = [record.message, record.error_description, record.error, record.hint]
      .find((value) => typeof value === 'string' && value.trim());
    const code = typeof record.code === 'string' ? record.code : '';
    const error = new Error(typeof message === 'string' ? message : `Error de conexión (${response.status}).`) as Error & { status?: number; code?: string };
    error.status = response.status;
    error.code = code;
    throw error;
  }
  return payload;
}

export async function tenantCloudConfig(): Promise<TenantCloudConfig> {
  const payload = await parseTenantCloudJson(await fetch('/api/cloud-config', {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  })) as PublicCloudConfig;
  if (!payload.configured || !payload.url || !payload.publishableKey) {
    throw new Error('La conexión con Supabase todavía no está configurada.');
  }
  return Object.freeze({
    url: payload.url.replace(/\/+$/g, ''),
    publishableKey: payload.publishableKey,
  });
}

export function tenantCloudHeaders(publishableKey: string, accessToken: string): Record<string, string> {
  return {
    apikey: publishableKey,
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
}

function activeStatus(value: unknown): boolean {
  return String(value ?? '').trim().toLowerCase() === 'active';
}

export async function tenantCloudTransport(scope: TenantScope): Promise<TenantCloudTransport> {
  const session = getCloudSession();
  if (!session) throw new Error(TENANT_CLOUD_SESSION_REQUIRED);
  if (session.userId !== scope.userId) throw new Error(TENANT_CLOUD_SESSION_MISMATCH);

  const config = await tenantCloudConfig();
  const query = new URL(`${config.url}/rest/v1/organization_members`);
  query.searchParams.set(
    'select',
    'organization_id,member_id,user_id,role,status,display_name,email,phone,created_at,last_active_at',
  );
  query.searchParams.set('organization_id', `eq.${scope.organizationId}`);
  query.searchParams.set('order', 'member_id.asc');

  const payload = await parseTenantCloudJson(await fetch(query, {
    method: 'GET',
    headers: tenantCloudHeaders(config.publishableKey, session.accessToken),
    cache: 'no-store',
  }));
  if (!Array.isArray(payload)) throw new Error(TENANT_CLOUD_RESPONSE_MISMATCH);

  const rows = payload as CloudMembershipRow[];
  if (rows.some((row) => row.organization_id !== scope.organizationId)) {
    throw new Error(TENANT_CLOUD_RESPONSE_MISMATCH);
  }
  const own = rows.find((row) => row.user_id === scope.userId && row.organization_id === scope.organizationId);
  if (!own || !Number.isFinite(own.member_id) || !activeStatus(own.status)) {
    throw new Error(TENANT_CLOUD_MEMBERSHIP_REQUIRED);
  }

  const context = membershipContext(rows, scope.userId);
  if (context.organizationId !== scope.organizationId) {
    throw new Error(TENANT_CLOUD_RESPONSE_MISMATCH);
  }

  return Object.freeze({
    scope: Object.freeze({ userId: scope.userId, organizationId: scope.organizationId }),
    context,
    accessToken: session.accessToken,
    userId: session.userId,
    config,
  });
}
