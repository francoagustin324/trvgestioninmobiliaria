import type {
  ActivityEntry,
  Client,
  Property,
  PropertyDiffusionChannel,
  PropertyDiffusionStatus,
  PublicTenantIdentity,
} from './models.js';
import { propertyShareText } from './property-ficha.js';
import { normalizeWhatsAppPhone, whatsappUrl } from './whatsapp-contact-core.js';

export type ConfirmedPropertyDiffusionStatus = Exclude<PropertyDiffusionStatus, 'PENDIENTE'>;

export type PropertyDiffusionActivity = ActivityEntry & {
  activityKind: 'property-diffusion';
  diffusionPropertyId: number;
  diffusionClientId: number;
  diffusionChannel: PropertyDiffusionChannel;
  diffusionStatus: ConfirmedPropertyDiffusionStatus;
};

const usdFormatter = new Intl.NumberFormat('es-AR');

function sameEntity(
  entryId: number | undefined,
  entryUid: string | undefined,
  entityId: number,
  entityUid: string | undefined,
): boolean {
  if (entryUid && entityUid) return entryUid === entityUid;
  return entryId === entityId;
}

export function isPropertyDiffusionActivity(entry: ActivityEntry): entry is PropertyDiffusionActivity {
  return entry.activityKind === 'property-diffusion'
    && Number.isFinite(entry.diffusionPropertyId)
    && Number.isFinite(entry.diffusionClientId)
    && (entry.diffusionChannel === 'WhatsApp' || entry.diffusionChannel === 'Email')
    && (entry.diffusionStatus === 'ENVIADO' || entry.diffusionStatus === 'RESPONDIO');
}

export function propertyDiffusionHistory(
  entries: ActivityEntry[],
  property: Pick<Property, 'id' | 'uid'>,
  client: Pick<Client, 'id' | 'uid'>,
): PropertyDiffusionActivity[] {
  return entries
    .filter(isPropertyDiffusionActivity)
    .filter((entry) => (
      sameEntity(entry.diffusionPropertyId, entry.diffusionPropertyUid, property.id, property.uid)
      && sameEntity(entry.diffusionClientId, entry.diffusionClientUid, client.id, client.uid)
    ))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export {
  latestPropertyDiffusionResponse,
  latestPropertyDiffusionSent,
  propertyDiffusionLedgerRecord,
  propertyDiffusionSendCount,
  propertyDiffusionStatus,
} from './property-diffusion-ledger.js';

export function buildPropertyDiffusionMessage(
  property: Pick<Property, 'title' | 'address' | 'price' | 'bedrooms'>,
  tenant: PublicTenantIdentity,
  publicUrl: string,
): string {
  const lines = [propertyShareText(property.title, tenant)];
  const commercial: string[] = [];
  if (property.address.trim()) commercial.push(`Zona: ${property.address.trim()}`);
  if (Number.isFinite(property.price) && property.price > 0) {
    commercial.push(`Precio: USD ${usdFormatter.format(property.price)}`);
  }
  if (property.bedrooms && property.bedrooms > 0) {
    commercial.push(`${property.bedrooms} ${property.bedrooms === 1 ? 'dormitorio' : 'dormitorios'}`);
  }
  if (commercial.length) lines.push(commercial.join(' · '));
  const cleanUrl = publicUrl.trim();
  if (cleanUrl) lines.push(cleanUrl);
  return lines.join('\n');
}

export function normalizedWhatsAppPhone(value: string | undefined): string | null {
  const normalized = normalizeWhatsAppPhone(String(value ?? ''));
  return normalized.valid ? normalized.normalized : null;
}

export function propertyDiffusionWhatsAppUrl(
  phone: string | undefined,
  message: string,
): string | null {
  const normalized = normalizedWhatsAppPhone(phone);
  return normalized ? whatsappUrl(normalized, message) : null;
}

export function normalizedEmail(value: string | undefined): string | null {
  const email = String(value ?? '').trim();
  if (!email || email.length > 254 || /\s/.test(email)) return null;
  return /^[^@]+@[^@]+\.[^@]+$/.test(email) ? email : null;
}

export function propertyDiffusionEmailUrl(
  email: string | undefined,
  propertyTitle: string,
  message: string,
): string | null {
  const target = normalizedEmail(email);
  if (!target) return null;
  return `mailto:${target}?subject=${encodeURIComponent(`Propiedad: ${propertyTitle}`)}&body=${encodeURIComponent(message)}`;
}

export function propertyDiffusionActivityData(
  property: Pick<Property, 'id' | 'uid' | 'title'>,
  client: Pick<Client, 'id' | 'uid' | 'name'>,
  channel: PropertyDiffusionChannel,
  status: ConfirmedPropertyDiffusionStatus,
): Omit<ActivityEntry, 'id' | 'actorId' | 'createdAt'> {
  return {
    action: status === 'ENVIADO' ? 'Propiedad enviada' : 'Cliente respondió a la propiedad',
    entityType: 'Cliente',
    entityId: client.id,
    entityUid: client.uid,
    detail: `${property.title} · ${channel}`,
    activityKind: 'property-diffusion',
    diffusionPropertyId: property.id,
    diffusionPropertyUid: property.uid,
    diffusionClientId: client.id,
    diffusionClientUid: client.uid,
    diffusionChannel: channel,
    diffusionStatus: status,
  };
}
