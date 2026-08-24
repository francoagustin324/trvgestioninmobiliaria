import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  cloudRecordsToCrm,
  crmToCloudRecords,
  isSupervisedRecommendationTelemetryPayload,
  membershipContext,
  organizationScopedEntityKey,
  reconcileCrmAssignments,
  staleCloudRecords,
  type CloudMembershipRow,
  type CloudRecordRow,
} from '../cloud-records.js';
import { initialData, STORAGE_KEY, type CrmData, type Visit } from '../models.js';
import { reconcileCrmSnapshots } from '../sync-reconciliation.js';
import {
  hasLocalBackup,
  readLocalSnapshot,
  restoreLatestBackup,
  writeLocalSnapshot,
} from '../sync-safety.js';
import { assignmentVisible } from '../team-policy.js';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

const organizationId = '11111111-1111-4111-8111-111111111111';

const memberships: CloudMembershipRow[] = [
  {
    organization_id: organizationId,
    member_id: 10,
    user_id: 'owner-user',
    role: 'owner',
    status: 'active',
    display_name: 'Dueño',
    email: 'owner@example.com',
  },
  {
    organization_id: organizationId,
    member_id: 15,
    user_id: 'admin-user',
    role: 'admin',
    status: 'active',
    display_name: 'Administrador',
    email: 'admin@example.com',
  },
  {
    organization_id: organizationId,
    member_id: 20,
    user_id: 'agent-user',
    role: 'agent',
    status: 'active',
    display_name: 'Corredor A',
    email: 'agent@example.com',
  },
  {
    organization_id: organizationId,
    member_id: 30,
    user_id: 'other-agent-user',
    role: 'agent',
    status: 'active',
    display_name: 'Corredor B',
    email: 'other-agent@example.com',
  },
];

function context(userId: string) {
  return membershipContext(memberships, userId);
}

function visit(overrides: Partial<Visit> = {}): Visit {
  return {
    id: 1,
    clientId: 101,
    propertyId: 201,
    scheduledAt: '2026-08-24T15:30:00.000Z',
    status: 'Realizada',
    interest: 'Alto',
    objection: 'Necesita revisar expensas',
    assignedToId: 20,
    createdById: 20,
    createdAt: '2026-08-23T20:00:00.000Z',
    updatedAt: '2026-08-23T21:00:00.000Z',
    ...overrides,
  };
}

function crmFixture(): CrmData {
  const crm = structuredClone(initialData);
  crm.organization.id = organizationId;
  crm.teamMembers = context('owner-user').members;
  crm.visits = [
    visit({ id: 1, assignedToId: 20, createdById: 20 }),
    visit({
      id: 2,
      clientId: 102,
      propertyId: 202,
      assignedToId: 30,
      createdById: 30,
      status: 'Coordinada',
      interest: undefined,
      objection: undefined,
    }),
  ];
  return crm;
}

test('P1.1-A1 normaliza un snapshot local histórico sin visits y conserva el round-trip completo', async () => {
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });

  const legacy = structuredClone(initialData) as Partial<CrmData> & { visits?: Visit[] };
  delete legacy.visits;
  storage.setItem(STORAGE_KEY, JSON.stringify(legacy));

  const store = await import('../store.js');
  assert.deepEqual(store.state.crm.visits, []);

  const expected = visit({ id: 9, assignedToId: 1, createdById: 1 });
  store.state.crm.visits = [expected];
  store.saveData('P1.1-A1 local Visit');
  assert.deepEqual(readLocalSnapshot(storage)?.visits, [expected]);

  store.activateStorageForCurrentSession();
  assert.deepEqual(store.state.crm.visits, [expected]);
});

test('P1.1-A1 conserva visits en backup y restore sin cambiar la estrategia de storage', () => {
  const storage = new MemoryStorage();
  const first = structuredClone(initialData);
  first.visits = [visit({ id: 7, assignedToId: 1, createdById: 1 })];
  writeLocalSnapshot(first, { markDirty: true, reason: 'Visit base' }, storage);

  const second = structuredClone(first);
  second.visits[0] = visit({
    id: 7,
    assignedToId: 1,
    createdById: 1,
    status: 'Cancelada',
    interest: undefined,
    objection: 'Reprogramará más adelante',
    updatedAt: '2026-08-23T22:00:00.000Z',
  });
  writeLocalSnapshot(second, { markDirty: true, reason: 'Visit modificada' }, storage);

  assert.equal(hasLocalBackup(storage), true);
  const restored = restoreLatestBackup(storage);
  assert.ok(restored);
  assert.deepEqual(restored.visits, first.visits);
  assert.deepEqual(readLocalSnapshot(storage)?.visits, first.visits);
});

test('P1.1-A1 tolera un CRM legacy sin visits también en reconciliación de asignaciones cloud', () => {
  const legacy = structuredClone(crmFixture()) as Partial<CrmData> & { visits?: Visit[] };
  delete legacy.visits;
  const reconciled = reconcileCrmAssignments(legacy as CrmData, context('owner-user'));
  assert.deepEqual(reconciled.visits, []);
});

test('P1.1-A1 serializa Visit como entity_type visit y la hidrata idéntica', () => {
  const crm = crmFixture();
  const owner = context('owner-user');
  const rows = crmToCloudRecords(crm, owner, 'owner-user');
  const visitRows = rows.filter((row) => row.entity_type === 'visit');

  assert.equal(visitRows.length, 2);
  assert.equal(visitRows[0]?.assigned_member_id, 20);
  assert.equal(visitRows[0]?.created_by, 'owner-user');
  assert.equal(visitRows[0]?.entity_key, organizationScopedEntityKey(organizationId, 1));
  assert.deepEqual(visitRows[0]?.payload, crm.visits[0]);

  const restored = cloudRecordsToCrm(rows, owner, structuredClone(crm));
  assert.deepEqual(restored.visits, crm.visits);
});

test('P1.1-A1 respeta scope por responsable: dueño/admin ven todo y corredor sólo lo propio', () => {
  const crm = crmFixture();
  const ownerRows = crmToCloudRecords(crm, context('owner-user'), 'owner-user')
    .filter((row) => row.entity_type === 'visit');
  const adminRows = crmToCloudRecords(crm, context('admin-user'), 'admin-user')
    .filter((row) => row.entity_type === 'visit');
  const agentRows = crmToCloudRecords(crm, context('agent-user'), 'agent-user')
    .filter((row) => row.entity_type === 'visit');

  assert.deepEqual(ownerRows.map((row) => (row.payload as Visit).id), [1, 2]);
  assert.deepEqual(adminRows.map((row) => (row.payload as Visit).id), [1, 2]);
  assert.deepEqual(agentRows.map((row) => (row.payload as Visit).id), [1]);
  assert.equal(agentRows[0]?.assigned_member_id, 20);

  assert.deepEqual(
    crm.visits.filter((item) => assignmentVisible('Corredor', 20, item.assignedToId)).map((item) => item.id),
    [1],
  );
  assert.deepEqual(
    crm.visits.filter((item) => assignmentVisible('Dueño', 10, item.assignedToId)).map((item) => item.id),
    [1, 2],
  );
  assert.deepEqual(
    crm.visits.filter((item) => assignmentVisible('Administrador', 15, item.assignedToId)).map((item) => item.id),
    [1, 2],
  );
});

test('P1.1-A1 incorpora visits a reconciliation: local-only, cloud-only, mismo ID y conflicto', () => {
  const base = crmFixture();
  const local = structuredClone(base);
  const cloud = structuredClone(base);
  local.visits = [visit({ id: 1, objection: 'Local' })];
  cloud.visits = [visit({ id: 2, objection: 'Cloud' })];

  const split = reconcileCrmSnapshots(local, cloud);
  const visitDifference = split.differences.find((item) => item.key === 'visits');
  assert.ok(visitDifference);
  assert.deepEqual(visitDifference.localOnly, ['Registro 1']);
  assert.deepEqual(visitDifference.cloudOnly, ['Registro 2']);
  assert.deepEqual(visitDifference.conflicts, []);
  assert.deepEqual(split.merged.visits.map((item) => item.id), [1, 2]);

  const sameLocal = structuredClone(base);
  const sameCloud = structuredClone(base);
  sameLocal.visits = [visit({ id: 3 })];
  sameCloud.visits = [visit({ id: 3 })];
  const same = reconcileCrmSnapshots(sameLocal, sameCloud);
  assert.deepEqual(same.merged.visits.map((item) => item.id), [3]);
  assert.deepEqual(same.differences.find((item) => item.key === 'visits')?.conflicts, []);

  sameCloud.visits = [visit({ id: 3, objection: 'Valor remoto distinto' })];
  const conflict = reconcileCrmSnapshots(sameLocal, sameCloud);
  assert.deepEqual(conflict.differences.find((item) => item.key === 'visits')?.conflicts, ['Registro 3']);
  assert.equal(conflict.merged.visits[0]?.objection, sameLocal.visits[0]?.objection);
});

test('P1.1-A1 stale records conserva Visit vigente, detecta Visit removida y no toca telemetría B1.4.2', () => {
  const crm = crmFixture();
  const owner = context('owner-user');
  const current = crmToCloudRecords(crm, owner, 'owner-user');
  const telemetry: CloudRecordRow = {
    organization_id: organizationId,
    entity_type: 'activity',
    entity_key: organizationScopedEntityKey(organizationId, 'b1-4-2-event'),
    assigned_member_id: 10,
    payload: { recordKind: 'supervised_recommendation_event', event: 'SHOWN' },
    created_by: 'owner-user',
  };

  const unchangedStale = staleCloudRecords([...current, telemetry], current);
  assert.equal(unchangedStale.some((row) => row.entity_type === 'visit'), false);
  assert.equal(unchangedStale.some((row) => row.entity_key === telemetry.entity_key), false);

  const reduced = structuredClone(crm);
  reduced.visits = [crm.visits[0]!];
  const next = crmToCloudRecords(reduced, owner, 'owner-user');
  const removed = staleCloudRecords(current, next).filter((row) => row.entity_type === 'visit');
  assert.deepEqual(removed.map((row) => row.entity_key), [organizationScopedEntityKey(organizationId, 2)]);

  assert.equal(isSupervisedRecommendationTelemetryPayload(crm.visits[0]), false);
  assert.equal(isSupervisedRecommendationTelemetryPayload(telemetry.payload), true);
});

test('P1.1-A1 agrega visits a la comparación remota y Agenda permanece ajena a visits', () => {
  const compatible = readFileSync('src/cloud-api-compatible.ts', 'utf8');
  const agenda = readFileSync('src/agenda.ts', 'utf8');
  assert.match(
    compatible,
    /\['clients', 'properties', 'visits', 'offers', 'contacts', 'reminders', 'fichas', 'conversations'\]/,
  );
  assert.doesNotMatch(agenda, /\bvisits\b/);
});

test('P1.1-A1 mantiene Visit sin agenda/follow-up duplicados ni entidades futuras', () => {
  const source = readFileSync('src/models.ts', 'utf8');
  const block = source.match(/export interface Visit \{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.ok(block);
  assert.doesNotMatch(block, /nextAction|nextFollowUp|offerId|reservationId|commissionId|probability|metadata/);
  assert.match(source, /export type AssignmentEntity = 'Cliente' \| 'Propiedad' \| 'Conversación' \| 'Tarea';/);
});

test('P1.1-A1 migration admite visit sin ampliar RLS, permisos ni aislamiento', () => {
  const migration = readFileSync(
    'supabase/migrations/20260823213000_p1_1_a1_visit_entity_type.sql',
    'utf8',
  );
  const baseRls = readFileSync('supabase/migrations/20260713_auth_multiusuario_rls.sql', 'utf8');
  const restrictive = readFileSync(
    'supabase/migrations/20260717190000_restrictive_organization_isolation.sql',
    'utf8',
  );

  assert.match(migration, /propcontrol_records_entity_type_check/);
  for (const entityType of [
    'organization',
    'client',
    'property',
    'commercial_contact',
    'reminder',
    'ficha',
    'conversation',
    'activity',
    'visit',
  ]) {
    assert.match(migration, new RegExp(`'${entityType}'`));
  }

  assert.match(migration, /drop constraint propcontrol_records_entity_type_check/);
  assert.match(migration, /add constraint propcontrol_records_entity_type_check/);
  assert.doesNotMatch(migration, /create\s+policy|drop\s+policy|grant\s|revoke\s|row level security/i);
  assert.doesNotMatch(migration, /create\s+table|add\s+column|alter\s+column|create\s+index|drop\s+index/i);
  assert.doesNotMatch(migration, /organization_members/i);

  assert.match(baseRls, /private\.org_member_role\(organization_id\) in \('owner','admin'\)/);
  assert.match(baseRls, /assigned_member_id = private\.org_member_number\(organization_id\)/);
  assert.match(baseRls, /private\.is_active_org_member\(organization_id\)/);
  assert.match(baseRls, /lower\(coalesce\(om\.status, 'active'\)\) = 'active'/);
  assert.match(restrictive, /create policy propcontrol_records_org_scope_restrictive/);
  assert.match(restrictive, /as restrictive/);
  assert.match(restrictive, /private\.is_active_org_member\(organization_id\)/);
});
