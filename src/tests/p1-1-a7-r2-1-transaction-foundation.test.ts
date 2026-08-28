import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  canonicalCommercialRequest,
  commercialRequestHash,
  type CommercialMutationError,
  type CommercialMutationRequest,
  type CommercialMutationResponse,
} from '../commercial-mutation-contract.js';
import {
  SNAPSHOT_ONLY_COMMERCIAL_AUTHORITY,
  snapshotMayWriteCommercialEntity,
  type CommercialSyncAuthority,
} from '../commercial-sync-transition.js';
import { newOperationId } from '../sync-identity.js';

const migrationPath = 'supabase/migrations/20260827170000_p1_1_a7_r2_1_transaction_foundation.sql';
const migration = readFileSync(migrationPath, 'utf8');

function request(overrides: Partial<CommercialMutationRequest> = {}): CommercialMutationRequest {
  return {
    organizationId: '11111111-1111-4111-8111-111111111111',
    operationId: newOperationId(),
    operationType: 'FOUNDATION_PROBE',
    expectedRevision: 3,
    payload: { amount: 100, nested: { currency: 'USD', terms: ['cash'] } },
    requestedAt: '2026-08-27T20:00:00.000Z',
    ...overrides,
  };
}

class FoundationLedger {
  private readonly rows = new Map<string, { hash: string; response: CommercialMutationResponse }>();

  async execute(value: CommercialMutationRequest): Promise<CommercialMutationResponse> {
    const key = `${value.organizationId}:${value.operationId}`;
    const hash = await commercialRequestHash(value);
    const existing = this.rows.get(key);
    if (existing) {
      if (existing.hash !== hash) throw new Error('CONFLICT');
      return { ...existing.response, replayed: true, errorCode: 'IDEMPOTENCY_REPLAY' };
    }
    const response: CommercialMutationResponse = {
      success: true,
      replayed: false,
      operationId: value.operationId,
      operationType: value.operationType,
      serverTimestamp: '2026-08-27T20:00:01.000Z',
    };
    this.rows.set(key, { hash, response });
    return response;
  }
}

test('R2.1 contrato request/response y catálogo de errores permanecen tipados', () => {
  const value = request();
  const response: CommercialMutationResponse = {
    success: true,
    replayed: false,
    operationId: value.operationId,
    operationType: value.operationType,
    entityUid: '22222222-2222-4222-8222-222222222222',
    entityLegacyId: 7,
    revision: 4,
    clientUid: '33333333-3333-4333-8333-333333333333',
    clientRevision: 8,
    parentEntityUid: '44444444-4444-4444-8444-444444444444',
    parentRevision: 2,
    activityUid: '55555555-5555-4555-8555-555555555555',
    pipeline: 'Negociación',
    nextAction: 'Confirmar condiciones',
    nextFollowUp: '2026-08-30',
    serverTimestamp: '2026-08-27T20:00:01.000Z',
    conflict: { expectedRevision: 3, actualRevision: 4 },
    errorCode: 'CONFLICT',
    userMessage: 'El registro cambió.',
  };
  assert.equal(response.operationId, value.operationId);
  const errors: CommercialMutationError[] = [
    'VALIDATION_ERROR', 'PERMISSION_DENIED', 'NOT_FOUND', 'CONFLICT',
    'TERMINAL_STATE', 'IDEMPOTENCY_REPLAY', 'INTERNAL_ERROR',
  ];
  assert.equal(errors.length, 7);
});

test('R2.1 operationId usa UUID canónico válido', () => {
  assert.match(newOperationId(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('R2.1 hash canónico ignora orden de propiedades, whitespace JSON y campos derivados', async () => {
  const operationId = newOperationId();
  const first = request({ operationId, payload: { b: 2, a: { y: true, x: 'value' } } });
  const second = request({
    operationId: newOperationId(),
    organizationId: '99999999-9999-4999-8999-999999999999',
    requestedAt: '2030-01-01T00:00:00.000Z',
    payload: JSON.parse('{  "a" : { "x": "value", "y": true }, "b": 2 }'),
  });
  assert.equal(canonicalCommercialRequest(first), canonicalCommercialRequest(second));
  assert.equal(await commercialRequestHash(first), await commercialRequestHash(second));
  assert.match(await commercialRequestHash(first), /^[0-9a-f]{64}$/);
});

test('R2.1 mismo tenant operationId y request hace replay; request distinto hace conflict', async () => {
  const ledger = new FoundationLedger();
  const value = request();
  assert.equal((await ledger.execute(value)).replayed, false);
  const replay = await ledger.execute(structuredClone(value));
  assert.equal(replay.replayed, true);
  assert.equal(replay.errorCode, 'IDEMPOTENCY_REPLAY');
  await assert.rejects(ledger.execute({ ...value, payload: { amount: 101 } }), /CONFLICT/);
});

test('R2.1 mismo operationId queda aislado por organización', async () => {
  const ledger = new FoundationLedger();
  const operationId = newOperationId();
  const first = await ledger.execute(request({ operationId }));
  const second = await ledger.execute(request({
    operationId,
    organizationId: '99999999-9999-4999-8999-999999999999',
  }));
  assert.equal(first.replayed, false);
  assert.equal(second.replayed, false);
});

test('R2.1 migration es aditiva, conserva legacy keys y prepara uid/revision estructurales', () => {
  assert.match(migration, /^begin;/m);
  assert.match(migration, /commit;\s*$/);
  assert.match(migration, /alter table public\.propcontrol_records[\s\S]*add column if not exists uid uuid/i);
  assert.match(migration, /add column if not exists revision bigint not null default 0/i);
  assert.match(migration, /check \(revision >= 0\) not valid/i);
  assert.match(migration, /where uid is not null/i);
  assert.doesNotMatch(migration, /last_operation_id/i);
  assert.doesNotMatch(migration, /update\s+public\.propcontrol_records|delete\s+from|drop\s+(table|column)/i);
  assert.doesNotMatch(migration, /set\s+entity_key|alter\s+column\s+entity_key/i);
});

test('R2.1 commercial_operations tiene scope, permanencia y constraint idempotente', () => {
  for (const field of [
    'organization_id', 'operation_id', 'operation_type', 'actor_user_id',
    'actor_member_id', 'request_hash', 'status', 'result_payload',
    'entity_uid', 'created_at', 'completed_at',
  ]) assert.match(migration, new RegExp(`\\b${field}\\b`));
  assert.match(migration, /primary key \(organization_id, operation_id\)/i);
  assert.match(migration, /create table private\.commercial_operations/i);
  assert.doesNotMatch(migration, /create table public\.commercial_operations/i);
  assert.doesNotMatch(migration, /expires_at|ttl|delete\s+from\s+private\.commercial_operations/i);
});

test('R2.1 RPC es SECURITY INVOKER, deriva actor/membership y bloquea operaciones R2.2+', () => {
  assert.match(migration, /create function public\.commercial_mutation_foundation/i);
  assert.match(migration, /security invoker/i);
  assert.doesNotMatch(migration, /security definer/i);
  assert.match(migration, /current_user_id uuid := auth\.uid\(\)/i);
  assert.match(migration, /from public\.organization_members as member/i);
  assert.match(migration, /member\.organization_id = p_organization_id/i);
  assert.match(migration, /member\.user_id = current_user_id/i);
  assert.match(migration, /lower\([\s\S]*member\.status[\s\S]*= 'active'/i);
  for (const forbidden of [
    'VISIT_CREATE', 'VISIT_RESOLVE', 'OFFER_CREATE', 'COUNTEROFFER_CREATE',
    'OFFER_RESOLVE', 'RESERVATION_CREATE', 'RESERVATION_RESOLVE',
  ]) assert.match(migration, new RegExp(`'${forbidden}'`));
});

test('R2.1 RPC demuestra hash servidor, CAS bajo lock, replay, conflict y rollback', () => {
  assert.match(migration, /sha256\(pg_catalog\.convert_to\(canonical_request::text, 'UTF8'\)\)/i);
  assert.match(migration, /for update;/i);
  assert.match(migration, /current_revision <> p_expected_revision/i);
  assert.match(migration, /message = 'CONFLICT'/i);
  assert.match(migration, /'errorCode', 'IDEMPOTENCY_REPLAY'/i);
  assert.match(migration, /if p_force_rollback then[\s\S]*message = 'INTERNAL_ERROR'/i);
  assert.match(migration, /insert into private\.commercial_operations/i);
});

test('R2.1 policy y grants son nuevos, mínimos y niegan anon/PUBLIC', () => {
  assert.match(migration, /alter table private\.commercial_operations enable row level security/i);
  assert.match(migration, /create policy commercial_operations_select_own/i);
  assert.match(migration, /create policy commercial_operations_insert_own/i);
  assert.match(migration, /private\.is_active_org_member\(organization_id\)/i);
  assert.match(migration, /actor_user_id = auth\.uid\(\)/i);
  assert.match(migration, /actor_member_id = private\.org_member_number\(organization_id\)/i);
  assert.match(migration, /revoke all on table private\.commercial_operations from public/i);
  assert.match(migration, /revoke all on table private\.commercial_operations from anon/i);
  assert.match(migration, /grant select, insert on table private\.commercial_operations to authenticated/i);
  assert.doesNotMatch(migration, /grant\s+(update|delete|all)/i);
  assert.match(migration, /revoke all on function public\.commercial_mutation_foundation[\s\S]*from anon/i);
  assert.match(migration, /grant execute on function public\.commercial_mutation_foundation[\s\S]*to authenticated/i);
});

test('R2.1 no modifica policies existentes ni conecta workflows productivos', () => {
  assert.doesNotMatch(migration, /(?:create|drop|alter)\s+policy\s+propcontrol_records_/i);
  for (const path of [
    'src/visit-workflow.ts', 'src/visit-workflow-ui.ts',
    'src/offer-workflow.ts', 'src/offer-workflow-ui.ts',
    'src/reservation-workflow.ts', 'src/reservation-workflow-ui.ts',
  ]) {
    const source = readFileSync(path, 'utf8');
    assert.doesNotMatch(source, /commercial_mutation_foundation|commercial-mutation-contract|commercial-sync-transition/);
  }
});

test('R2.1 snapshot actual sigue siendo writer y la exclusión futura es opt-in', () => {
  for (const type of ['visit', 'offer', 'reservation'] as const) {
    assert.equal(snapshotMayWriteCommercialEntity(type), true);
    assert.equal(snapshotMayWriteCommercialEntity(type, SNAPSHOT_ONLY_COMMERCIAL_AUTHORITY), true);
  }
  const future: CommercialSyncAuthority = { transactionOwnedEntityTypes: new Set(['visit']) };
  assert.equal(snapshotMayWriteCommercialEntity('visit', future), false);
  assert.equal(snapshotMayWriteCommercialEntity('offer', future), true);
  assert.equal(snapshotMayWriteCommercialEntity('reservation', future), true);
});
