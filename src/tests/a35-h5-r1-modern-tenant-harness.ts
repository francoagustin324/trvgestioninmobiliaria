import type { BrowserContext, Route } from 'playwright';
import { crmToCloudRecords, membershipContext, type CloudMembershipRow, type CloudRecordRow } from '../cloud-records.js';
import type { CrmData, TeamMember } from '../models.js';

export const A35_H5_R1_AUTH_GENERATION = 'a35-h5-r1-auth-generation';

interface HarnessState {
  records: CloudRecordRow[];
  recordsOutageArmed: boolean;
  recordsOutageActive: boolean;
}

const states = new WeakMap<BrowserContext, HarnessState>();

function json(body: unknown, status = 200) {
  return {
    status,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(body),
  };
}

function canonicalRole(member: TeamMember): 'owner' | 'admin' | 'agent' {
  if (member.role === 'Dueño') return 'owner';
  if (member.role === 'Administrador') return 'admin';
  return 'agent';
}

function membershipRows(crm: CrmData): CloudMembershipRow[] {
  return crm.teamMembers
    .filter((member) => typeof member.userId === 'string' && member.userId.length > 0)
    .map((member) => ({
      organization_id: crm.organization.id,
      member_id: member.id,
      user_id: member.userId!,
      role: canonicalRole(member),
      status: 'active',
      display_name: member.name,
      email: member.email || undefined,
      phone: member.phone || undefined,
      created_at: member.createdAt || '2026-08-01T12:00:00.000Z',
      last_active_at: '2026-09-16T12:00:00.000Z',
    }));
}

function eqFilter(url: URL, key: string): string | null {
  const value = url.searchParams.get(key);
  if (!value) return null;
  return value.startsWith('eq.') ? value.slice(3) : value;
}

async function fulfillOptions(route: Route): Promise<void> {
  await route.fulfill({
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    },
    body: '',
  });
}

function recordIdentity(row: Pick<CloudRecordRow, 'organization_id' | 'entity_type' | 'entity_key'>): string {
  return `${row.organization_id}:${row.entity_type}:${row.entity_key}`;
}

function payloadRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function findProtectedRecord(
  state: HarnessState,
  entityType: 'client' | 'property',
  reference: { uid?: string; legacyId?: number } | undefined,
): CloudRecordRow | undefined {
  return state.records.find((row) => {
    if (row.entity_type !== entityType) return false;
    const payload = payloadRecord(row.payload);
    if (reference?.uid) return String(payload?.uid ?? '') === reference.uid;
    if (reference?.legacyId) return Number(payload?.id) === reference.legacyId;
    return false;
  });
}

async function fulfillProtectedCas(
  route: Route,
  state: HarnessState,
  entityType: 'client' | 'property',
): Promise<void> {
  const request = route.request().postDataJSON() as {
    p_organization_id?: string;
    p_request?: {
      action?: 'insert' | 'update' | 'delete';
      client?: { uid?: string; legacyId?: number };
      property?: { uid?: string; legacyId?: number };
      expectedRevision?: number;
      payload?: Record<string, unknown>;
      assignedMemberId?: number;
    };
  };
  const intent = request.p_request ?? {};
  const reference = entityType === 'client' ? intent.client : intent.property;
  const current = findProtectedRecord(state, entityType, reference);
  const currentPayload = current ? payloadRecord(current.payload) : null;
  const currentRevision = Number(currentPayload?.revision ?? 0);

  if (intent.action === 'insert') {
    if (current) {
      await route.fulfill(json({ code: '40001', message: 'STALE_REVISION' }, 409));
      return;
    }
    const payload = structuredClone(intent.payload ?? {});
    const uid = String(payload.uid ?? reference?.uid ?? '');
    const id = Number(payload.id ?? reference?.legacyId);
    const entityKey = `${request.p_organization_id}:${uid || id}`;
    const inserted: CloudRecordRow = {
      organization_id: String(request.p_organization_id ?? ''),
      entity_type: entityType,
      entity_key: entityKey,
      assigned_member_id: intent.assignedMemberId ?? Number(payload.assignedToId ?? 1),
      payload: { ...payload, revision: 0 },
      created_by: String(route.request().headers().authorization ?? 'synthetic'),
      updated_at: '2026-09-27T12:00:00.000Z',
    };
    state.records.push(inserted);
    await route.fulfill(json({
      success: true,
      organizationId: request.p_organization_id,
      action: 'insert',
      [entityType]: inserted.payload,
      serverTimestamp: inserted.updated_at,
    }));
    return;
  }

  if (!current) {
    await route.fulfill(json({ code: 'P0002', message: 'NOT_FOUND' }, 404));
    return;
  }
  if (currentRevision !== Number(intent.expectedRevision)) {
    await route.fulfill(json({ code: '40001', message: 'STALE_REVISION' }, 409));
    return;
  }
  if (intent.action === 'delete') {
    state.records = state.records.filter((row) => row !== current);
    await route.fulfill(json({
      success: true,
      organizationId: request.p_organization_id,
      action: 'delete',
      serverTimestamp: '2026-09-27T12:00:00.000Z',
    }));
    return;
  }

  const nextPayload = {
    ...structuredClone(intent.payload ?? {}),
    id: currentPayload?.id,
    ...(currentPayload?.uid ? { uid: currentPayload.uid } : {}),
    revision: currentRevision + 1,
    ...(intent.assignedMemberId ? { assignedToId: intent.assignedMemberId } : {}),
  };
  current.payload = nextPayload;
  if (intent.assignedMemberId) current.assigned_member_id = intent.assignedMemberId;
  current.updated_at = '2026-09-27T12:00:00.000Z';
  await route.fulfill(json({
    success: true,
    organizationId: request.p_organization_id,
    action: 'update',
    [entityType]: nextPayload,
    serverTimestamp: current.updated_at,
  }));
}

async function installAuthGeneration(context: BrowserContext): Promise<void> {
  await context.addInitScript(({ generation }) => {
    const sessionKey = 'propcontrol-cloud-session-v1';
    const generationKey = 'propcontrol-cloud-auth-generation-v1';
    const nativeSetItem = Storage.prototype.setItem;

    const normalizeSession = (raw: string): string => {
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        parsed.__propcontrolAuthGeneration = generation;
        return JSON.stringify(parsed);
      } catch {
        return raw;
      }
    };

    const patchExisting = (): void => {
      const current = localStorage.getItem(sessionKey);
      if (current) nativeSetItem.call(localStorage, sessionKey, normalizeSession(current));
      nativeSetItem.call(localStorage, generationKey, generation);
    };

    patchExisting();
    Storage.prototype.setItem = function setItem(key: string, value: string): void {
      nativeSetItem.call(this, key, key === sessionKey ? normalizeSession(value) : value);
      if (key === sessionKey) nativeSetItem.call(localStorage, generationKey, generation);
    };

    document.addEventListener('DOMContentLoaded', () => {
      Storage.prototype.setItem = nativeSetItem;
      patchExisting();
    }, { once: true });
  }, { generation: A35_H5_R1_AUTH_GENERATION });
}

export async function installA35H5R1ModernTenantHarness(
  context: BrowserContext,
  crm: CrmData,
  actorUserId: string,
): Promise<void> {
  const memberships = membershipRows(crm);
  const cloudContext = membershipContext(memberships, actorUserId);
  const state: HarnessState = {
    records: crmToCloudRecords(crm, cloudContext, actorUserId),
    recordsOutageArmed: false,
    recordsOutageActive: false,
  };
  states.set(context, state);

  await installAuthGeneration(context);

  await context.route('**/api/cloud-config', async (route) => {
    const requestOrigin = new URL(route.request().url()).origin;
    await route.fulfill(json({
      configured: true,
      url: requestOrigin,
      publishableKey: 'a35-h5-r1-publishable-key',
    }));
  });

  await context.route('**/rest/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (request.method() === 'OPTIONS') {
      await fulfillOptions(route);
      return;
    }

    if (url.pathname.endsWith('/rest/v1/rpc/activate_my_organization_memberships')) {
      await route.fulfill(json({}));
      return;
    }

    if (url.pathname.endsWith('/rest/v1/organization_members')) {
      const userFilter = eqFilter(url, 'user_id');
      const organizationFilter = eqFilter(url, 'organization_id');
      let rows = membershipRows(crm);
      if (organizationFilter) rows = rows.filter((row) => row.organization_id === organizationFilter);
      if (userFilter) rows = rows.filter((row) => row.user_id === userFilter);
      if (!userFilter && actorUserId && url.searchParams.has('user_id')) {
        rows = rows.filter((row) => row.user_id === actorUserId);
      }
      await route.fulfill(json(rows));
      return;
    }

    if (url.pathname.endsWith('/rest/v1/rpc/visit_transaction_authority_active_v2')) {
      await route.fulfill(json(false));
      return;
    }

    if (url.pathname.endsWith('/rest/v1/rpc/client_snapshot_cas_v2')) {
      await fulfillProtectedCas(route, state, 'client');
      return;
    }

    if (url.pathname.endsWith('/rest/v1/rpc/property_snapshot_cas_v1')) {
      await fulfillProtectedCas(route, state, 'property');
      return;
    }

    if (url.pathname.endsWith('/rest/v1/propcontrol_records')) {
      if (state.recordsOutageActive) {
        await route.fulfill(json({ message: 'A3.5 H5 R1 synthetic cloud outage.' }, 503));
        return;
      }
      if (request.method() === 'GET') {
        await route.fulfill(json(state.records));
        return;
      }
      if (request.method() === 'POST' || request.method() === 'PATCH') {
        const body = request.postDataJSON();
        const rows = (Array.isArray(body) ? body : [body]) as CloudRecordRow[];
        const prefer = request.headers().prefer ?? '';
        for (const incoming of rows) {
          const identity = recordIdentity(incoming);
          const index = state.records.findIndex((row) => recordIdentity(row) === identity);
          if (index >= 0 && prefer.includes('ignore-duplicates')) continue;
          const next = structuredClone(incoming);
          if (index >= 0) state.records[index] = next;
          else state.records.push(next);
        }
        await route.fulfill(json([], request.method() === 'POST' ? 201 : 200));
        return;
      }
      if (request.method() === 'DELETE') {
        const organization = eqFilter(url, 'organization_id');
        const entityType = eqFilter(url, 'entity_type');
        const rawKeys = url.searchParams.get('entity_key') ?? '';
        const keys = new Set(
          rawKeys.startsWith('in.(')
            ? rawKeys.slice(4, -1).split(',').map((key) => key.replace(/^"|"$/g, ''))
            : [],
        );
        state.records = state.records.filter((row) => !(
          (!organization || row.organization_id === organization)
          && (!entityType || row.entity_type === entityType)
          && (!keys.size || keys.has(row.entity_key))
        ));
        await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' }, body: '' });
        return;
      }
    }

    if (url.pathname.endsWith('/rest/v1/fichas')) {
      await route.fulfill(json([]));
      return;
    }

    await route.fulfill(json({ error: 'UNEXPECTED_A35_H5_R1_ENDPOINT', path: url.pathname }, 500));
  });
}

export function armA35H5R1RecordsOutage(context: BrowserContext): void {
  const state = states.get(context);
  if (!state) throw new Error('A3.5 H5 R1 tenant harness no instalado en el BrowserContext.');
  state.recordsOutageArmed = true;
}

export function activateA35H5R1RecordsOutage(context: BrowserContext): void {
  const state = states.get(context);
  if (!state) throw new Error('A3.5 H5 R1 tenant harness no instalado en el BrowserContext.');
  if (state.recordsOutageArmed) state.recordsOutageActive = true;
}
