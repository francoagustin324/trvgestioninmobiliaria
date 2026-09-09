import type { TenantScope } from './active-organization.js';
import type { FichaPublica } from './models.js';
import { getCloudSession } from './cloud-api.js';
import { propertyToPublicFicha, type PropertyWithFicha } from './property-ficha.js';
import {
  assertTenantRuntimeLeaseCurrent,
  TENANT_RUNTIME_SESSION_MISMATCH,
  TENANT_RUNTIME_STALE,
  tenantScopesEqual,
  type TenantRuntimeLease,
} from './tenant-runtime.js';
import { safePhotoUrl } from './utils.js';

interface ShareConfig {
  configured?: boolean;
  url?: string;
  publishableKey?: string;
  publicUrl?: string;
}

interface PublicFichaRow {
  organization_id?: unknown;
  property_key?: unknown;
  slug?: unknown;
  payload?: FichaPublica;
}

export interface PublishedPropertyFicha {
  slug: string;
  url: string;
}

export const PUBLIC_PROPERTY_SHARE_RESPONSE_INVALID = 'PUBLIC_PROPERTY_SHARE_RESPONSE_INVALID';
export const PUBLIC_PROPERTY_SHARE_RESPONSE_MISMATCH = 'PUBLIC_PROPERTY_SHARE_RESPONSE_MISMATCH';

let configPromise: Promise<Required<Pick<ShareConfig, 'url' | 'publishableKey'>> & Pick<ShareConfig, 'publicUrl'>> | null = null;

async function parseResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  let payload: unknown = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { message: text }; }
  if (!response.ok) {
    const record = payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload as Record<string, unknown>
      : {};
    const message = [record.message, record.error, record.msg]
      .find((value) => typeof value === 'string' && value.trim());
    throw new Error(typeof message === 'string' ? message : `No se pudo publicar la ficha (${response.status}).`);
  }
  return payload;
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 10_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function loadShareConfig(): Promise<Required<Pick<ShareConfig, 'url' | 'publishableKey'>> & Pick<ShareConfig, 'publicUrl'>> {
  return fetchWithTimeout('/api/cloud-config', {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  }).then(parseResponse).then((payload) => {
    const config = payload as ShareConfig;
    if (!config.configured || !config.url || !config.publishableKey) {
      throw new Error('La publicación de fichas todavía no está configurada.');
    }
    return {
      url: config.url.replace(/\/+$/g, ''),
      publishableKey: config.publishableKey,
      publicUrl: config.publicUrl?.replace(/\/+$/g, ''),
    };
  });
}

async function shareConfig(): Promise<Required<Pick<ShareConfig, 'url' | 'publishableKey'>> & Pick<ShareConfig, 'publicUrl'>> {
  // Memoiza SOLO la config exitosa. Si la primera consulta falla (señal floja en
  // el celular), se descarta la promesa rechazada para que el próximo intento
  // reintente, en vez de quedar "pegada" en el error hasta recargar la página.
  configPromise ??= loadShareConfig();
  try {
    return await configPromise;
  } catch (error) {
    configPromise = null;
    throw error;
  }
}

function headers(config: Required<Pick<ShareConfig, 'url' | 'publishableKey'>>, accessToken?: string): Record<string, string> {
  const result: Record<string, string> = {
    apikey: config.publishableKey,
    'Content-Type': 'application/json',
  };
  if (accessToken) result.Authorization = `Bearer ${accessToken}`;
  return result;
}

function normalizedSlugBase(title: string): string {
  const value = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  return value || 'propiedad';
}

function randomSuffix(): string {
  const raw = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().replaceAll('-', '')
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return raw.slice(0, 7).toLowerCase();
}

function validStoredSlug(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{4,79}$/.test(value);
}

function assertPublishContext(scope: TenantScope, runtimeLease: TenantRuntimeLease): void {
  if (!tenantScopesEqual(scope, runtimeLease.scope)) throw new Error(TENANT_RUNTIME_STALE);
  assertTenantRuntimeLeaseCurrent(runtimeLease);
}

function requirePublishSession(scope: TenantScope): Readonly<{ accessToken: string; userId: string }> {
  const session = getCloudSession();
  if (!session?.accessToken || !session.userId) throw new Error('La sesión venció. Volvé a ingresar.');
  if (session.userId !== scope.userId) throw new Error(TENANT_RUNTIME_SESSION_MISMATCH);
  return Object.freeze({ accessToken: session.accessToken, userId: session.userId });
}

export function createPropertyPublicSlug(title: string): string {
  return `${normalizedSlugBase(title)}-${randomSuffix()}`;
}

export function propertyPublicUrl(slug: string, publicOrigin = location.origin): string {
  return `${publicOrigin.replace(/\/+$/g, '')}/ficha/${encodeURIComponent(slug)}`;
}

export async function publishPropertyFicha(
  property: PropertyWithFicha,
  scope: TenantScope,
  runtimeLease: TenantRuntimeLease,
): Promise<PublishedPropertyFicha> {
  assertPublishContext(scope, runtimeLease);
  const propertySnapshot = structuredClone(property);
  const propertyKey = String(propertySnapshot.id);
  const session = requirePublishSession(scope);

  const config = await shareConfig();
  assertPublishContext(scope, runtimeLease);
  requirePublishSession(scope);

  const slug = validStoredSlug(propertySnapshot.publicSlug)
    ? propertySnapshot.publicSlug
    : createPropertyPublicSlug(propertySnapshot.title);
  const target = new URL(`${config.url}/rest/v1/public_property_fichas`);
  target.searchParams.set('on_conflict', 'organization_id,property_key');
  const payload = {
    organization_id: scope.organizationId,
    property_key: propertyKey,
    slug,
    payload: propertyToPublicFicha(propertySnapshot),
    published: true,
    created_by: session.userId,
    updated_at: new Date().toISOString(),
  };

  assertPublishContext(scope, runtimeLease);
  const responsePayload = await parseResponse(await fetch(target, {
    method: 'POST',
    headers: {
      ...headers(config, session.accessToken),
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(payload),
  }));
  assertPublishContext(scope, runtimeLease);
  requirePublishSession(scope);

  if (!Array.isArray(responsePayload) || responsePayload.length !== 1) {
    throw new Error(PUBLIC_PROPERTY_SHARE_RESPONSE_INVALID);
  }
  const [rowValue] = responsePayload;
  if (!rowValue || typeof rowValue !== 'object' || Array.isArray(rowValue)) {
    throw new Error(PUBLIC_PROPERTY_SHARE_RESPONSE_INVALID);
  }
  const row = rowValue as PublicFichaRow;
  if (row.organization_id !== scope.organizationId || row.property_key !== propertyKey) {
    throw new Error(PUBLIC_PROPERTY_SHARE_RESPONSE_MISMATCH);
  }
  if (!validStoredSlug(row.slug)) throw new Error(PUBLIC_PROPERTY_SHARE_RESPONSE_INVALID);

  assertPublishContext(scope, runtimeLease);
  const origin = config.publicUrl || location.origin;
  return { slug: row.slug, url: propertyPublicUrl(row.slug, origin) };
}

function validPublicFicha(value: unknown): FichaPublica | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const ficha = value as FichaPublica;
  if (!ficha.title || !Array.isArray(ficha.photoUrls)) return null;
  return {
    ...ficha,
    photoUrls: ficha.photoUrls.map(safePhotoUrl).filter((url): url is string => Boolean(url)).slice(0, 8),
    photoEnhancement: ficha.photoEnhancement === 'soft' ? 'soft' : 'none',
  };
}

export async function loadPublicPropertyFicha(slug: string): Promise<FichaPublica | null> {
  if (!/^[a-z0-9][a-z0-9-]{4,79}$/.test(slug)) return null;
  const config = await shareConfig();
  const response = await parseResponse(await fetchWithTimeout(`${config.url}/rest/v1/rpc/get_public_property_ficha`, {
    method: 'POST',
    headers: headers(config),
    body: JSON.stringify({ target_slug: slug }),
    cache: 'no-store',
  }));
  return validPublicFicha(response);
}
