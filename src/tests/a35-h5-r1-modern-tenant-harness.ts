import type { BrowserContext, Route } from 'playwright';
import { crmToCloudRecords, membershipContext, type CloudMembershipRow } from '../cloud-records.js';
import type { CrmData, TeamMember } from '../models.js';

export const A35_H5_R1_AUTH_GENERATION = 'a35-h5-r1-auth-generation';

interface HarnessState {
  records: unknown[];
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
        state.records = Array.isArray(body) ? structuredClone(body) : [structuredClone(body)];
        await route.fulfill(json(state.records, request.method() === 'POST' ? 201 : 200));
        return;
      }
      if (request.method() === 'DELETE') {
        state.records = [];
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
