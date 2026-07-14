import type { CrmData } from './models.js';
import {
  getSyncState,
  scopedStorageKey,
  stableFingerprint,
  type SyncState,
} from './sync-safety.js';

export interface ReconciliationDifference {
  key: keyof Pick<CrmData, 'clients' | 'properties' | 'contacts' | 'reminders' | 'fichas' | 'conversations' | 'activityLog'>;
  label: string;
  localOnly: string[];
  cloudOnly: string[];
  conflicts: string[];
}

export interface ReconciliationResult {
  merged: CrmData;
  differences: ReconciliationDifference[];
  localLeadCount: number;
  cloudLeadCount: number;
  localOnlyCount: number;
  cloudOnlyCount: number;
  conflictCount: number;
  canMergeSafely: boolean;
}

type Identified = { id: number } & Record<string, unknown>;

const COLLECTIONS: Array<{
  key: ReconciliationDifference['key'];
  label: string;
}> = [
  { key: 'clients', label: 'leads' },
  { key: 'properties', label: 'propiedades' },
  { key: 'contacts', label: 'contactos' },
  { key: 'reminders', label: 'seguimientos' },
  { key: 'fichas', label: 'fichas' },
  { key: 'conversations', label: 'conversaciones' },
  { key: 'activityLog', label: 'actividades' },
];

function itemLabel(item: Identified): string {
  const candidate = item.name ?? item.title ?? item.related ?? item.phone ?? item.detail;
  const text = String(candidate ?? '').trim();
  return text || `Registro ${item.id}`;
}

function identifiedItems(value: unknown): Identified[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Identified => Boolean(item && typeof item === 'object' && Number.isFinite((item as { id?: number }).id)))
    .map((item) => structuredClone(item));
}

function mergeCollection(localValue: unknown, cloudValue: unknown): {
  merged: Identified[];
  localOnly: string[];
  cloudOnly: string[];
  conflicts: string[];
} {
  const local = identifiedItems(localValue);
  const cloud = identifiedItems(cloudValue);
  const localById = new Map(local.map((item) => [item.id, item]));
  const cloudById = new Map(cloud.map((item) => [item.id, item]));
  const ids = [...new Set([...localById.keys(), ...cloudById.keys()])].sort((left, right) => left - right);
  const merged: Identified[] = [];
  const localOnly: string[] = [];
  const cloudOnly: string[] = [];
  const conflicts: string[] = [];

  ids.forEach((id) => {
    const localItem = localById.get(id);
    const cloudItem = cloudById.get(id);
    if (localItem && !cloudItem) {
      localOnly.push(itemLabel(localItem));
      merged.push(localItem);
      return;
    }
    if (!localItem && cloudItem) {
      cloudOnly.push(itemLabel(cloudItem));
      merged.push(cloudItem);
      return;
    }
    if (!localItem || !cloudItem) return;
    if (stableFingerprint(localItem) === stableFingerprint(cloudItem)) {
      merged.push(cloudItem);
      return;
    }
    conflicts.push(itemLabel(localItem));
    merged.push(localItem);
  });

  return { merged, localOnly, cloudOnly, conflicts };
}

export function reconcileCrmSnapshots(local: CrmData, cloud: CrmData): ReconciliationResult {
  const merged = structuredClone(cloud);
  const mutableMerged = merged as unknown as Record<string, unknown>;
  const differences: ReconciliationDifference[] = [];

  COLLECTIONS.forEach(({ key, label }) => {
    const result = mergeCollection(local[key], cloud[key]);
    mutableMerged[key] = result.merged;
    differences.push({ key, label, localOnly: result.localOnly, cloudOnly: result.cloudOnly, conflicts: result.conflicts });
  });

  const localOnlyCount = differences.reduce((total, item) => total + item.localOnly.length, 0);
  const cloudOnlyCount = differences.reduce((total, item) => total + item.cloudOnly.length, 0);
  const conflictCount = differences.reduce((total, item) => total + item.conflicts.length, 0);

  return {
    merged,
    differences,
    localLeadCount: local.clients.length,
    cloudLeadCount: cloud.clients.length,
    localOnlyCount,
    cloudOnlyCount,
    conflictCount,
    canMergeSafely: conflictCount === 0,
  };
}

export function reconciliationMessage(result: ReconciliationResult): string {
  const leadDifference = result.differences.find((item) => item.key === 'clients');
  const lines = [
    `En esta computadora: ${result.localLeadCount} leads.`,
    `En la nube: ${result.cloudLeadCount} leads.`,
  ];

  if (leadDifference?.localOnly.length) lines.push(`Se agregarán a la nube: ${leadDifference.localOnly.join(', ')}.`);
  if (leadDifference?.cloudOnly.length) lines.push(`Se conservarán desde la nube: ${leadDifference.cloudOnly.join(', ')}.`);
  if (result.localOnlyCount + result.cloudOnlyCount > (leadDifference?.localOnly.length ?? 0) + (leadDifference?.cloudOnly.length ?? 0)) {
    lines.push('También se conservarán las demás diferencias detectadas en otros módulos.');
  }
  lines.push('Antes de cambiar nada se guardará una copia local de seguridad.');
  return lines.join('\n');
}

function syncStateStorageKey(): string {
  return `${scopedStorageKey()}:sync`;
}

export function restoreSyncStateSnapshot(snapshot: SyncState): void {
  localStorage.setItem(syncStateStorageKey(), JSON.stringify(snapshot));
}

export function authorizeConfirmedCloudResolution(remoteVersion: string): void {
  const current = getSyncState();
  localStorage.setItem(syncStateStorageKey(), JSON.stringify({
    ...current,
    dirty: true,
    lastCloudVersion: remoteVersion,
    lastError: undefined,
  } satisfies SyncState));
}
