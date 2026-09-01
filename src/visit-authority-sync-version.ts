import { isSupervisedRecommendationTelemetryPayload, type CloudRecordRow } from './cloud-records.js';
import { getCloudMembershipContext, getCloudSession } from './cloud-api.js';
import { latestRemoteVersion } from './sync-safety.js';

interface PublicCloudConfig {
  configured?: boolean;
  url?: string;
  publishableKey?: string;
}

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  let payload: unknown = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { message: text }; }
  if (!response.ok) {
    const value = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    const message = [value.message, value.error_description, value.error, value.hint]
      .find((item) => typeof item === 'string' && item.trim());
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

export async function visitAuthorityRemoteVersion(): Promise<string | null> {
  const context = await getCloudMembershipContext();
  const session = getCloudSession();
  if (!session) throw new Error('La sesión venció. Volvé a ingresar.');
  const config = await publicConfig();
  const query = new URL(`${config.url}/rest/v1/propcontrol_records`);
  query.searchParams.set('select', 'organization_id,entity_type,entity_key,assigned_member_id,payload,updated_at');
  query.searchParams.set('organization_id', `eq.${context.organizationId}`);
  const rows = await parseJson(await fetch(query, {
    headers: {
      apikey: config.publishableKey,
      Authorization: `Bearer ${session.accessToken}`,
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  })) as CloudRecordRow[];
  return latestRemoteVersion(rows.filter((row) => !isSupervisedRecommendationTelemetryPayload(row.payload)));
}
