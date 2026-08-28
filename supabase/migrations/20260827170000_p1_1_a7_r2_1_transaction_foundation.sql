-- P1.1-A7-R2.1 — Foundation transaccional e idempotencia.
-- Migration aditiva. No migra workflows ni cambia entity_key legacy.

begin;

alter table public.propcontrol_records
  add column if not exists uid uuid,
  add column if not exists revision bigint not null default 0;

alter table public.propcontrol_records
  add constraint propcontrol_records_revision_nonnegative
  check (revision >= 0) not valid;

create unique index if not exists propcontrol_records_org_uid_uq
  on public.propcontrol_records (organization_id, uid)
  where uid is not null;

create index if not exists propcontrol_records_org_revision_idx
  on public.propcontrol_records (organization_id, entity_type, revision);

create table private.commercial_operations (
  organization_id uuid not null,
  operation_id uuid not null,
  operation_type text not null,
  actor_user_id uuid not null,
  actor_member_id bigint not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  status text not null check (status in ('completed')),
  result_payload jsonb not null,
  entity_uid uuid,
  created_at timestamptz not null default statement_timestamp(),
  completed_at timestamptz not null,
  primary key (organization_id, operation_id)
);

create index commercial_operations_org_created_idx
  on private.commercial_operations (organization_id, created_at desc);

alter table private.commercial_operations enable row level security;

create policy commercial_operations_select_tenant
on private.commercial_operations
for select
to authenticated
using (
  private.is_active_org_member(organization_id)
);

create policy commercial_operations_insert_own
on private.commercial_operations
for insert
to authenticated
with check (
  private.is_active_org_member(organization_id)
  and actor_user_id = auth.uid()
  and actor_member_id = private.org_member_number(organization_id)
);

revoke all on table private.commercial_operations from public;
revoke all on table private.commercial_operations from anon;
revoke all on table private.commercial_operations from authenticated;
grant select, insert on table private.commercial_operations to authenticated;

create function public.commercial_mutation_foundation(
  p_organization_id uuid,
  p_operation_id uuid,
  p_operation_type text,
  p_request jsonb,
  p_entity_type text default null,
  p_entity_key text default null,
  p_expected_revision bigint default null,
  p_force_rollback boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  current_user_id uuid := auth.uid();
  current_member_id bigint;
  current_role text;
  current_revision bigint;
  canonical_request jsonb;
  computed_hash text;
  existing_operation private.commercial_operations%rowtype;
  operation_result jsonb;
  inserted boolean := false;
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;
  if p_operation_id is null or p_organization_id is null then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end if;
  if nullif(pg_catalog.btrim(p_operation_type), '') is null or p_request is null then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end if;
  if p_operation_type in (
    'VISIT_CREATE', 'VISIT_RESOLVE', 'OFFER_CREATE', 'COUNTEROFFER_CREATE',
    'OFFER_RESOLVE', 'RESERVATION_CREATE', 'RESERVATION_RESOLVE'
  ) then
    raise exception using errcode = '22023', message = 'TERMINAL_STATE';
  end if;

  select member.member_id,
    case
      when pg_catalog.lower(pg_catalog.coalesce(member.role, '')) in ('owner', 'dueño', 'dueno') then 'owner'
      when pg_catalog.lower(pg_catalog.coalesce(member.role, '')) in ('admin', 'administrator', 'administrador') then 'admin'
      else 'agent'
    end
  into current_member_id, current_role
  from public.organization_members as member
  where member.organization_id = p_organization_id
    and member.user_id = current_user_id
    and pg_catalog.lower(pg_catalog.coalesce(member.status, '')) = 'active'
  limit 1;

  if current_member_id is null then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  if (p_entity_type is null) <> (p_entity_key is null)
    or (p_expected_revision is not null and (p_entity_type is null or p_entity_key is null))
    or p_expected_revision < 0 then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end if;

  canonical_request := pg_catalog.jsonb_build_object(
    'operationType', pg_catalog.btrim(p_operation_type),
    'entityType', p_entity_type,
    'entityKey', p_entity_key,
    'expectedRevision', p_expected_revision,
    'payload', p_request
  );
  computed_hash := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(canonical_request::text, 'UTF8')),
    'hex'
  );

  -- Serializa intents iguales antes de observar idempotencia. El lock vive sólo
  -- durante esta transacción y evita que dos actores atraviesen CAS en paralelo.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_organization_id::text || ':' || p_operation_id::text, 0)
  );

  select operation.* into existing_operation
  from private.commercial_operations as operation
  where operation.organization_id = p_organization_id
    and operation.operation_id = p_operation_id;

  if found then
    if existing_operation.actor_user_id <> current_user_id
      or existing_operation.operation_type <> pg_catalog.btrim(p_operation_type)
      or existing_operation.request_hash <> computed_hash then
      raise exception using errcode = '23505', message = 'CONFLICT';
    end if;
    return existing_operation.result_payload || pg_catalog.jsonb_build_object(
      'replayed', true,
      'errorCode', 'IDEMPOTENCY_REPLAY'
    );
  end if;

  -- CAS sólo pertenece al camino de una operación nueva. Un replay confirmado
  -- retorna arriba aunque la mutación original ya haya incrementado revision.
  if p_entity_type is not null then
    select record.revision
    into current_revision
    from public.propcontrol_records as record
    where record.organization_id = p_organization_id
      and record.entity_type = p_entity_type
      and record.entity_key = p_entity_key
    for update;

    if not found then
      raise exception using errcode = 'P0002', message = 'NOT_FOUND';
    end if;
    if p_expected_revision is not null and current_revision <> p_expected_revision then
      raise exception using
        errcode = '40001',
        message = 'CONFLICT',
        detail = pg_catalog.jsonb_build_object(
          'expectedRevision', p_expected_revision,
          'actualRevision', current_revision
        )::text;
    end if;
  end if;

  operation_result := pg_catalog.jsonb_build_object(
    'success', true,
    'replayed', false,
    'operationId', p_operation_id,
    'operationType', pg_catalog.btrim(p_operation_type),
    'serverTimestamp', pg_catalog.statement_timestamp(),
    'foundation', pg_catalog.jsonb_build_object(
      'actorMemberId', current_member_id,
      'role', current_role,
      'requestHash', computed_hash,
      'revision', current_revision
    )
  );

  insert into private.commercial_operations (
    organization_id, operation_id, operation_type, actor_user_id,
    actor_member_id, request_hash, status, result_payload,
    entity_uid, completed_at
  ) values (
    p_organization_id, p_operation_id, pg_catalog.btrim(p_operation_type), current_user_id,
    current_member_id, computed_hash, 'completed', operation_result,
    null, pg_catalog.statement_timestamp()
  )
  on conflict (organization_id, operation_id) do nothing;
  inserted := found;

  if not inserted then
    select operation.* into existing_operation
    from private.commercial_operations as operation
    where operation.organization_id = p_organization_id
      and operation.operation_id = p_operation_id;
    if existing_operation.actor_user_id <> current_user_id
      or existing_operation.operation_type <> pg_catalog.btrim(p_operation_type)
      or existing_operation.request_hash <> computed_hash then
      raise exception using errcode = '23505', message = 'CONFLICT';
    end if;
    return existing_operation.result_payload || pg_catalog.jsonb_build_object(
      'replayed', true,
      'errorCode', 'IDEMPOTENCY_REPLAY'
    );
  end if;

  if p_force_rollback then
    raise exception using errcode = 'P0001', message = 'INTERNAL_ERROR';
  end if;

  return operation_result;
end;
$function$;

revoke all on function public.commercial_mutation_foundation(uuid, uuid, text, jsonb, text, text, bigint, boolean) from public;
revoke all on function public.commercial_mutation_foundation(uuid, uuid, text, jsonb, text, text, bigint, boolean) from anon;
grant execute on function public.commercial_mutation_foundation(uuid, uuid, text, jsonb, text, text, bigint, boolean) to authenticated;

commit;
