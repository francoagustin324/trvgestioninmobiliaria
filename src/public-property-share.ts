import type { FichaPublica } from './models.js';
import { getCloudSession } from './cloud-api.js';
import { propertyToPublicFicha, type PropertyWithFicha } from './property-ficha.js';
import { safePhotoUrl } from './utils.js';

interface ShareConfig {
  configured?: boolean;
  url?: string;
  publishableKey?: string;
  publicUrl?: string;
}

interface MembershipRow {
  organization_id?: string;
}

interface PublicFichaRow {
  slug?: string;
  payload?: FichaPublica;
}

interface PublishedPropertyFicha {
  slug: string;
  url: string;
}

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

async function shareConfig(): Promise<Required<Pick<ShareConfig, 'url' | 'publishableKey'>> & Pick<ShareConfig, 'publicUrl'>> {
  configPromise ??= fetch('/api/cloud-config', {
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
  return configPromise;
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

export function createPropertyPublicSlug(title: string): string {
  return `${normalizedSlugBase(title)}-${randomSuffix()}`;
}

export function propertyPublicUrl(slug: string, publicOrigin = location.origin): string {
  return `${publicOrigin.replace(/\/+$/g, '')}/ficha/${encodeURIComponent(slug)}`;
}

async function organizationId(
  config: Required<Pick<ShareConfig, 'url' | 'publishableKey'>>,
  accessToken: string,
  userId: string,
): Promise<string> {
  const query = new URL(`${config.url}/rest/v1/organization_members`);
  query.searchParams.set('select', 'organization_id');
  query.searchParams.set('user_id', `eq.${userId}`);
  query.searchParams.set('limit', '1');
  const rows = await parseResponse(await fetch(query, {
    headers: headers(config, accessToken),
    cache: 'no-store',
  })) as MembershipRow[];
  const organization = rows[0]?.organization_id;
  if (!organization) throw new Error('La cuenta no tiene una inmobiliaria asociada.');
  return organization;
}

export async function publishPropertyFicha(property: PropertyWithFicha): Promise<PublishedPropertyFicha> {
  const session = getCloudSession();
  if (!session?.accessToken || !session.userId) throw new Error('La sesión venció. Volvé a ingresar.');
  const config = await shareConfig();
  const organization = await organizationId(config, session.accessToken, session.userId);
  const slug = /^[a-z0-9][a-z0-9-]{4,79}$/.test(property.publicSlug || '')
    ? property.publicSlug!
    : createPropertyPublicSlug(property.title);
  const target = new URL(`${config.url}/rest/v1/public_property_fichas`);
  target.searchParams.set('on_conflict', 'organization_id,property_key');
  const payload = {
    organization_id: organization,
    property_key: String(property.id),
    slug,
    payload: propertyToPublicFicha(property),
    published: true,
    created_by: session.userId,
    updated_at: new Date().toISOString(),
  };
  const rows = await parseResponse(await fetch(target, {
    method: 'POST',
    headers: {
      ...headers(config, session.accessToken),
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(payload),
  })) as PublicFichaRow[];
  const storedSlug = rows[0]?.slug || slug;
  const origin = config.publicUrl || location.origin;
  return { slug: storedSlug, url: propertyPublicUrl(storedSlug, origin) };
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
  const response = await parseResponse(await fetch(`${config.url}/rest/v1/rpc/get_public_property_ficha`, {
    method: 'POST',
    headers: headers(config),
    body: JSON.stringify({ target_slug: slug }),
    cache: 'no-store',
  }));
  return validPublicFicha(response);
}
