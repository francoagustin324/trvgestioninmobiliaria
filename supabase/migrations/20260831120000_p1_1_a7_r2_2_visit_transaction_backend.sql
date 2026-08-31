-- P1.1-A7-R2.2B — backend transaccional Visit, instalado con autoridad OFF.
-- No activa el writer nuevo ni modifica las policies históricas.

begin;

create table private.commercial_entity_authority (
  organization_id uuid not null,
  entity_type text not null check (entity_type in ('visit')),
  transaction_owned boolean not null default false,
  activated_at timestamptz,
  activated_by uuid,
  primary key (organization_id, entity_type)
);

alter table private.commercial_entity_authority enable row level security;

create policy commercial_entity_authority_select_member
on private.commercial_entity_authority
for select
to authenticated
using (private.is_active_org_member(organization_id));

revoke all on table private.commercial_entity_authority from public;
revoke all on table private.commercial_entity_authority from anon;
revoke all on table private.commercial_entity_authority from authenticated;
grant select on table private.commercial_entity_authority to authenticated;

create function private.visit_authority_active(target_org uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $function$
  select coalesce((
    select authority.transaction_owned
    from private.commercial_entity_authority as authority
    where authority.organization_id = target_org
      and authority.entity_type = 'visit'
  ), false)
$function$;

create function private.visit_normalized(value text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $function$
  select pg_catalog.btrim(pg_catalog.lower(pg_catalog.translate(
    coalesce(value, ''),
    'áéíóúüñÁÉÍÓÚÜÑ',
    'aeiouunAEIOUUN'
  )))
$function$;

create function private.visit_qualification_missing(client_payload jsonb)
returns text[]
language plpgsql
immutable
security invoker
set search_path = ''
as $function$
declare
  missing text[] := '{}'::text[];
  payment text := private.visit_normalized(client_payload ->> 'paymentMethod');
  can_move text := private.visit_normalized(client_payload ->> 'canMoveForward');
  credit text := private.visit_normalized(client_payload ->> 'creditPossible');
  purpose text := private.visit_normalized(client_payload ->> 'purpose');
  knows_area text := private.visit_normalized(client_payload ->> 'knowsArea');
  credit_required boolean;
  credit_ready boolean;
begin
  if nullif(pg_catalog.btrim(client_payload ->> 'budget'), '') is null then
    missing := pg_catalog.array_append(missing, 'presupuesto');
  end if;
  if nullif(pg_catalog.btrim(client_payload ->> 'currency'), '') is null then
    missing := pg_catalog.array_append(missing, 'moneda');
  end if;
  if nullif(pg_catalog.btrim(client_payload ->> 'paymentMethod'), '') is null then
    missing := pg_catalog.array_append(missing, 'forma de pago');
  end if;
  if nullif(pg_catalog.btrim(client_payload ->> 'zones'), '') is null then
    missing := pg_catalog.array_append(missing, 'zona/barrios');
  end if;
  if purpose <> all (array['vivir', 'invertir', 'otra']::text[]) then
    missing := pg_catalog.array_append(missing, 'finalidad');
  end if;
  if nullif(pg_catalog.btrim(client_payload ->> 'purchaseTimeframe'), '') is null
    and nullif(pg_catalog.btrim(client_payload ->> 'urgency'), '') is null then
    missing := pg_catalog.array_append(missing, 'plazo / urgencia');
  end if;

  credit_required := pg_catalog.strpos(payment, 'credito hipotecario') > 0
    or can_move = 'depende del credito';
  credit_ready := credit = any (array['aprobado', 'preaprobado']::text[]);
  if credit_required and not credit_ready then
    missing := pg_catalog.array_append(missing, 'situación del crédito');
  end if;
  if can_move = any (array['', 'no confirmado', 'no', 'depende de vender', 'todavia no']::text[])
    or (can_move = 'depende del credito' and not credit_ready) then
    missing := pg_catalog.array_append(missing, 'capacidad de avance');
  end if;
  if knows_area <> 'si' then
    missing := pg_catalog.array_append(missing, 'aceptación de la zona');
  end if;
  return missing;
end;
$function$;

create function private.guard_transaction_owned_records()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  target_org uuid := case when tg_op = 'DELETE' then old.organization_id else new.organization_id end;
  target_type text := case when tg_op = 'DELETE' then old.entity_type else new.entity_type end;
  target_payload jsonb := case when tg_op = 'DELETE' then old.payload else new.payload end;
  transaction_path text := coalesce(
    pg_catalog.current_setting('propcontrol.transaction_path', true), ''
  );
begin
  if not private.visit_authority_active(target_org) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if target_type = 'visit' and transaction_path <> 'visit_rpc' then
    raise exception using errcode = '42501', message = 'TRANSACTION_AUTHORITY_REQUIRED';
  end if;
  if target_type = 'client' and tg_op in ('UPDATE', 'DELETE')
    and transaction_path not in ('visit_rpc', 'client_snapshot_cas') then
    raise exception using errcode = '40001', message = 'CLIENT_CAS_REQUIRED';
  end if;
  if target_type = 'activity'
    and target_payload ->> 'transactionOwner' = 'visit'
    and transaction_path <> 'visit_rpc' then
    raise exception using errcode = '42501', message = 'TRANSACTION_AUTHORITY_REQUIRED';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

create trigger guard_transaction_owned_records
before insert or update or delete on public.propcontrol_records
for each row execute function private.guard_transaction_owned_records();

create function public.client_snapshot_cas(
  p_request jsonb,
  p_force_rollback boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  current_user_id uuid := auth.uid();
  action_name text := p_request ->> 'action';
  requested_uid uuid;
  requested_legacy_id bigint;
  expected_revision bigint;
  matching_orgs uuid[];
  target_org uuid;
  current_record public.propcontrol_records%rowtype;
  next_payload jsonb;
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;
  if p_request is null or action_name is null or action_name not in ('update', 'delete') then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end if;
  begin
    requested_uid := nullif(p_request #>> '{client,uid}', '')::uuid;
    requested_legacy_id := nullif(p_request #>> '{client,legacyId}', '')::bigint;
    expected_revision := (p_request ->> 'expectedRevision')::bigint;
  exception when others then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end;
  if (requested_uid is null) = (requested_legacy_id is null)
    or coalesce(requested_legacy_id, 1) <= 0
    or expected_revision is null or expected_revision < 0
    or (action_name = 'update' and jsonb_typeof(p_request -> 'payload') <> 'object') then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end if;

  select pg_catalog.array_agg(candidate.organization_id)
  into matching_orgs
  from public.propcontrol_records as candidate
  where candidate.entity_type = 'client'
    and ((requested_uid is not null and candidate.uid = requested_uid)
      or (requested_legacy_id is not null and candidate.entity_key = requested_legacy_id::text));
  if coalesce(pg_catalog.array_length(matching_orgs, 1), 0) = 0 then
    raise exception using errcode = 'P0002', message = 'NOT_FOUND';
  end if;
  if pg_catalog.array_length(matching_orgs, 1) <> 1 then
    raise exception using errcode = '22023', message = 'AMBIGUOUS_REFERENCE';
  end if;
  target_org := matching_orgs[1];
  if not private.visit_authority_active(target_org) then
    raise exception using errcode = '22023', message = 'TERMINAL_STATE';
  end if;

  select record.* into current_record
  from public.propcontrol_records as record
  where record.organization_id = target_org
    and record.entity_type = 'client'
    and ((requested_uid is not null and record.uid = requested_uid)
      or (requested_legacy_id is not null and record.entity_key = requested_legacy_id::text))
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'NOT_FOUND';
  end if;
  if current_record.revision <> expected_revision then
    raise exception using errcode = '40001', message = 'CONFLICT';
  end if;

  perform pg_catalog.set_config('propcontrol.transaction_path', 'client_snapshot_cas', true);
  if action_name = 'delete' then
    delete from public.propcontrol_records
    where organization_id = target_org and entity_type = 'client' and entity_key = current_record.entity_key;
    if p_force_rollback then
      raise exception using errcode = 'P0001', message = 'INTERNAL_ERROR';
    end if;
    return pg_catalog.jsonb_build_object(
      'success', true, 'organizationId', target_org, 'action', action_name,
      'serverTimestamp', pg_catalog.statement_timestamp()
    );
  end if;

  next_payload := (p_request -> 'payload') - 'uid' - 'revision' - 'operationId'
    || pg_catalog.jsonb_build_object(
      'id', current_record.payload -> 'id',
      'revision', current_record.revision + 1
    )
    || case when current_record.uid is null then '{}'::jsonb
      else pg_catalog.jsonb_build_object('uid', current_record.uid) end;
  update public.propcontrol_records
  set payload = next_payload, revision = current_record.revision + 1
  where organization_id = target_org and entity_type = 'client' and entity_key = current_record.entity_key;
  if p_force_rollback then
    raise exception using errcode = 'P0001', message = 'INTERNAL_ERROR';
  end if;
  return pg_catalog.jsonb_build_object(
    'success', true, 'organizationId', target_org, 'action', action_name,
    'client', next_payload, 'serverTimestamp', pg_catalog.statement_timestamp()
  );
end;
$function$;

create function public.commercial_visit_mutation(
  p_operation_id uuid,
  p_operation_type text,
  p_request jsonb,
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
  target_org uuid;
  requested_client_uid uuid;
  requested_client_id bigint;
  requested_property_uid uuid;
  requested_property_id bigint;
  requested_visit_uid uuid;
  expected_client_revision bigint;
  expected_visit_revision bigint;
  client_record public.propcontrol_records%rowtype;
  property_record public.propcontrol_records%rowtype;
  visit_record public.propcontrol_records%rowtype;
  existing_operation private.commercial_operations%rowtype;
  canonical_request jsonb;
  computed_hash text;
  operation_result jsonb;
  inserted boolean := false;
  timestamp_value timestamptz := pg_catalog.statement_timestamp();
  scheduled_at timestamptz;
  local_date date;
  local_time time;
  status_name text;
  interest_name text;
  objection_text text;
  next_action text;
  next_follow_up date;
  terminal_client boolean;
  stage_name text;
  client_payload jsonb;
  visit_payload jsonb;
  activity_payload jsonb;
  visit_uid uuid;
  activity_uid uuid;
  next_visit_id bigint;
  next_activity_id bigint;
  assigned_member_id bigint;
  property_label text;
  activity_action text;
  activity_detail text;
  missing_qualification text[];
  candidate_orgs uuid[];
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;
  if p_operation_id is null or p_request is null or p_operation_type is null
    or p_operation_type not in ('VISIT_CREATE', 'VISIT_RESOLVE') then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end if;
  begin
    requested_client_uid := nullif(p_request #>> '{client,uid}', '')::uuid;
    requested_client_id := nullif(p_request #>> '{client,legacyId}', '')::bigint;
    expected_client_revision := (p_request ->> 'expectedClientRevision')::bigint;
    if p_operation_type = 'VISIT_CREATE' then
      requested_property_uid := nullif(p_request #>> '{property,uid}', '')::uuid;
      requested_property_id := nullif(p_request #>> '{property,legacyId}', '')::bigint;
    else
      requested_visit_uid := nullif(p_request ->> 'visitUid', '')::uuid;
      expected_visit_revision := (p_request ->> 'expectedVisitRevision')::bigint;
    end if;
  exception when others then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end;
  if (requested_client_uid is null) = (requested_client_id is null)
    or coalesce(requested_client_id, 1) <= 0
    or expected_client_revision is null or expected_client_revision < 0
    or (p_operation_type = 'VISIT_CREATE' and (
      (requested_property_uid is null) = (requested_property_id is null)
      or coalesce(requested_property_id, 1) <= 0
    ))
    or (p_operation_type = 'VISIT_RESOLVE' and (
      requested_visit_uid is null or expected_visit_revision is null or expected_visit_revision < 0
    )) then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end if;

  if p_operation_type = 'VISIT_CREATE' then
    select pg_catalog.array_agg(distinct client.organization_id)
    into candidate_orgs
    from public.propcontrol_records as client
    join public.propcontrol_records as property
      on property.organization_id = client.organization_id and property.entity_type = 'property'
    where client.entity_type = 'client'
      and ((requested_client_uid is not null and client.uid = requested_client_uid)
        or (requested_client_id is not null and client.entity_key = requested_client_id::text))
      and ((requested_property_uid is not null and property.uid = requested_property_uid)
        or (requested_property_id is not null and property.entity_key = requested_property_id::text));
  else
    select pg_catalog.array_agg(distinct visit.organization_id)
    into candidate_orgs
    from public.propcontrol_records as visit
    join public.propcontrol_records as client
      on client.organization_id = visit.organization_id and client.entity_type = 'client'
    where visit.entity_type = 'visit' and visit.uid = requested_visit_uid
      and ((requested_client_uid is not null and client.uid = requested_client_uid)
        or (requested_client_id is not null and client.entity_key = requested_client_id::text));
  end if;
  if coalesce(pg_catalog.array_length(candidate_orgs, 1), 0) = 0 then
    raise exception using errcode = 'P0002', message = 'NOT_FOUND';
  end if;
  if pg_catalog.array_length(candidate_orgs, 1) <> 1 then
    raise exception using errcode = '22023', message = 'AMBIGUOUS_REFERENCE';
  end if;
  target_org := candidate_orgs[1];

  select member.member_id,
    case
      when private.visit_normalized(member.role) in ('owner', 'dueno') then 'owner'
      when private.visit_normalized(member.role) in ('admin', 'administrator', 'administrador') then 'admin'
      else 'agent'
    end
  into current_member_id, current_role
  from public.organization_members as member
  where member.organization_id = target_org and member.user_id = current_user_id
    and private.visit_normalized(member.status) = 'active'
  limit 1;
  if current_member_id is null then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  canonical_request := pg_catalog.jsonb_build_object(
    'operationType', p_operation_type,
    'request', p_request
  );
  computed_hash := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(canonical_request::text, 'UTF8')), 'hex'
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_org::text || ':' || p_operation_id::text, 0)
  );

  select operation.* into existing_operation
  from private.commercial_operations as operation
  where operation.organization_id = target_org and operation.operation_id = p_operation_id;
  if found then
    if existing_operation.actor_user_id <> current_user_id
      or existing_operation.operation_type <> p_operation_type
      or existing_operation.request_hash <> computed_hash then
      raise exception using errcode = '23505', message = 'CONFLICT';
    end if;
    return existing_operation.result_payload || pg_catalog.jsonb_build_object(
      'replayed', true, 'errorCode', 'IDEMPOTENCY_REPLAY'
    );
  end if;
  if not private.visit_authority_active(target_org) then
    raise exception using errcode = '22023', message = 'TERMINAL_STATE';
  end if;

  if p_operation_type = 'VISIT_RESOLVE' then
    select record.* into visit_record
    from public.propcontrol_records as record
    where record.organization_id = target_org and record.entity_type = 'visit'
      and record.uid = requested_visit_uid
    for update;
    if not found then raise exception using errcode = 'P0002', message = 'NOT_FOUND'; end if;
    if visit_record.revision <> expected_visit_revision then
      raise exception using errcode = '40001', message = 'CONFLICT';
    end if;
    if current_role = 'agent' and visit_record.assigned_member_id is distinct from current_member_id then
      raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
    end if;
  end if;

  select record.* into client_record
  from public.propcontrol_records as record
  where record.organization_id = target_org and record.entity_type = 'client'
    and ((requested_client_uid is not null and record.uid = requested_client_uid)
      or (requested_client_id is not null and record.entity_key = requested_client_id::text))
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'NOT_FOUND'; end if;
  if client_record.revision <> expected_client_revision then
    raise exception using errcode = '40001', message = 'CONFLICT';
  end if;
  if current_role = 'agent' and client_record.assigned_member_id is distinct from current_member_id then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  if p_operation_type = 'VISIT_CREATE' then
    select record.* into property_record
    from public.propcontrol_records as record
    where record.organization_id = target_org and record.entity_type = 'property'
      and ((requested_property_uid is not null and record.uid = requested_property_uid)
        or (requested_property_id is not null and record.entity_key = requested_property_id::text))
    for share;
  else
    if (visit_record.payload ->> 'clientId')::bigint <> (client_record.payload ->> 'id')::bigint
      or (visit_record.payload ? 'clientUid' and visit_record.payload ->> 'clientUid' <> client_record.uid::text) then
      raise exception using errcode = '22023', message = 'WRONG_CLIENT';
    end if;
    select record.* into property_record
    from public.propcontrol_records as record
    where record.organization_id = target_org and record.entity_type = 'property'
      and ((visit_record.payload ? 'propertyUid' and record.uid::text = visit_record.payload ->> 'propertyUid')
        or (not (visit_record.payload ? 'propertyUid') and record.entity_key = visit_record.payload ->> 'propertyId'))
    for share;
  end if;
  if not found then raise exception using errcode = 'P0002', message = 'NOT_FOUND'; end if;
  if current_role = 'agent' and property_record.assigned_member_id is distinct from current_member_id then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  terminal_client := private.visit_normalized(client_record.payload ->> 'pipeline') in
      ('ganado', 'ganada', 'operacion ganada', 'cerrado', 'cerrada', 'perdido', 'perdida', 'operacion perdida')
    or private.visit_normalized(client_record.payload ->> 'status') in
      ('operacion ganada', 'operacion perdida', 'cerrado');
  assigned_member_id := coalesce(client_record.assigned_member_id, current_member_id);
  property_label := pg_catalog.btrim(coalesce(nullif(property_record.payload ->> 'title', ''),
    nullif(property_record.payload ->> 'address', ''), 'Propiedad ' || (property_record.payload ->> 'id')));
  if pg_catalog.char_length(property_label) > 70 then
    property_label := pg_catalog.rtrim(pg_catalog.substr(property_label, 1, 69)) || '…';
  end if;

  perform pg_catalog.set_config('propcontrol.transaction_path', 'visit_rpc', true);
  if p_operation_type = 'VISIT_CREATE' then
    if terminal_client then
      raise exception using errcode = '22023', message = 'TERMINAL_STATE';
    end if;
    missing_qualification := private.visit_qualification_missing(client_record.payload);
    if pg_catalog.cardinality(missing_qualification) > 0 then
      raise exception using errcode = '22023', message = 'QUALIFICATION_REQUIRED',
        detail = pg_catalog.array_to_string(missing_qualification, ', ');
    end if;
    begin
      local_date := (p_request ->> 'localDate')::date;
      local_time := (p_request ->> 'localTime')::time;
    exception when others then
      raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
    end;
    if local_date is null or local_time is null
      or p_request ->> 'localDate' !~ '^\d{4}-\d{2}-\d{2}$'
      or p_request ->> 'localTime' !~ '^([01]\d|2[0-3]):[0-5]\d$' then
      raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
    end if;
    scheduled_at := pg_catalog.make_timestamptz(
      pg_catalog.extract(year from local_date)::int,
      pg_catalog.extract(month from local_date)::int,
      pg_catalog.extract(day from local_date)::int,
      pg_catalog.extract(hour from local_time)::int,
      pg_catalog.extract(minute from local_time)::int,
      0, 'America/Argentina/Buenos_Aires'
    );
    if scheduled_at < timestamp_value then
      raise exception using errcode = '22023', message = 'PAST_SCHEDULE';
    end if;
    if exists (
      select 1 from public.propcontrol_records as duplicate
      where duplicate.organization_id = target_org and duplicate.entity_type = 'visit'
        and (duplicate.payload ->> 'clientId')::bigint = (client_record.payload ->> 'id')::bigint
        and (duplicate.payload ->> 'propertyId')::bigint = (property_record.payload ->> 'id')::bigint
        and (duplicate.payload ->> 'scheduledAt')::timestamptz = scheduled_at
        and duplicate.payload ->> 'status' = 'Coordinada'
    ) then
      raise exception using errcode = '23505', message = 'DUPLICATE_VISIT';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_org::text || ':visit:id', 0));
    select coalesce(pg_catalog.max((record.payload ->> 'id')::bigint), 0) + 1 into next_visit_id
    from public.propcontrol_records as record
    where record.organization_id = target_org and record.entity_type = 'visit'
      and record.payload ->> 'id' ~ '^\d+$';
    visit_uid := pg_catalog.gen_random_uuid();
    stage_name := private.visit_normalized(client_record.payload ->> 'pipeline');
    client_payload := client_record.payload || pg_catalog.jsonb_build_object(
      'nextAction', case when pg_catalog.char_length('Visita · ' || property_label) > 88
        then pg_catalog.rtrim(pg_catalog.substr('Visita · ' || property_label, 1, 87)) || '…'
        else 'Visita · ' || property_label end,
      'nextFollowUp', p_request ->> 'localDate',
      'revision', client_record.revision + 1
    ) || case when client_record.uid is null then '{}'::jsonb
      else pg_catalog.jsonb_build_object('uid', client_record.uid) end;
    if stage_name in ('', 'nuevo', 'contactado', 'calificado') then
      client_payload := client_payload || pg_catalog.jsonb_build_object(
        'pipeline', 'Visita coordinada', 'status', 'Lead'
      );
    end if;
    visit_payload := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'uid', visit_uid, 'revision', 0, 'operationId', p_operation_id,
      'id', next_visit_id, 'clientId', (client_record.payload ->> 'id')::bigint,
      'propertyId', (property_record.payload ->> 'id')::bigint,
      'clientUid', client_record.uid, 'propertyUid', property_record.uid,
      'scheduledAt', scheduled_at, 'status', 'Coordinada',
      'assignedToId', assigned_member_id, 'createdById', current_member_id,
      'createdAt', timestamp_value, 'updatedAt', timestamp_value
    ));
  else
    status_name := p_request ->> 'status';
    interest_name := nullif(pg_catalog.btrim(p_request ->> 'interest'), '');
    objection_text := nullif(pg_catalog.btrim(p_request ->> 'objection'), '');
    if visit_record.payload ->> 'status' <> 'Coordinada' then
      raise exception using errcode = '22023', message = 'TERMINAL_STATE';
    end if;
    if status_name is null or status_name not in ('Realizada', 'Cancelada', 'No asistió')
      or (status_name = 'Realizada' and (
        interest_name is null or interest_name not in ('Alto', 'Medio', 'Bajo')
      )) then
      raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
    end if;
    if status_name <> 'Realizada' then interest_name := null; end if;
    if not terminal_client then
      next_action := nullif(pg_catalog.btrim(p_request ->> 'nextAction'), '');
      begin next_follow_up := (p_request ->> 'nextFollowUp')::date;
      exception when others then raise exception using errcode = '22023', message = 'VALIDATION_ERROR'; end;
      if next_action is null or p_request ->> 'nextFollowUp' !~ '^\d{4}-\d{2}-\d{2}$'
        or next_follow_up < (timestamp_value at time zone 'America/Argentina/Buenos_Aires')::date then
        raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
      end if;
      client_payload := client_record.payload || pg_catalog.jsonb_build_object(
        'nextAction', next_action, 'nextFollowUp', next_follow_up,
        'revision', client_record.revision + 1
      );
    else
      client_payload := client_record.payload;
    end if;
    visit_uid := visit_record.uid;
    visit_payload := (visit_record.payload - 'interest' - 'objection') || pg_catalog.jsonb_strip_nulls(
      pg_catalog.jsonb_build_object(
        'revision', visit_record.revision + 1, 'operationId', p_operation_id,
        'status', status_name, 'interest', interest_name,
        'objection', objection_text, 'updatedAt', timestamp_value
      )
    );
    if status_name = 'Realizada' then activity_action := 'Visita realizada';
    elsif status_name = 'Cancelada' then activity_action := 'Visita cancelada';
    else activity_action := 'Cliente no asistió'; end if;
  end if;

  if p_operation_type = 'VISIT_CREATE' then
    update public.propcontrol_records
    set payload = client_payload, revision = client_record.revision + 1
    where organization_id = target_org and entity_type = 'client' and entity_key = client_record.entity_key;
    insert into public.propcontrol_records (
      organization_id, entity_type, entity_key, assigned_member_id, payload,
      created_by, uid, revision
    ) values (
      target_org, 'visit', visit_uid::text, assigned_member_id, visit_payload,
      current_user_id, visit_uid, 0
    );
    activity_action := 'Visita coordinada';
    activity_detail := property_label || ' · ' || (p_request ->> 'localDate') || ' ' || (p_request ->> 'localTime');
  else
    update public.propcontrol_records
    set payload = visit_payload, revision = visit_record.revision + 1
    where organization_id = target_org and entity_type = 'visit' and entity_key = visit_record.entity_key;
    if not terminal_client then
      update public.propcontrol_records
      set payload = client_payload, revision = client_record.revision + 1
      where organization_id = target_org and entity_type = 'client' and entity_key = client_record.entity_key;
    end if;
    activity_detail := property_label || ' · '
      || pg_catalog.to_char((visit_record.payload ->> 'scheduledAt')::timestamptz at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD HH24:MI')
      || ' · ' || status_name
      || case when interest_name is null then '' else ' · Interés ' || interest_name end
      || case when objection_text is null then '' else ' · ' || case
        when pg_catalog.char_length(objection_text) > 100
          then pg_catalog.rtrim(pg_catalog.substr(objection_text, 1, 99)) || '…'
        else objection_text end end;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_org::text || ':activity:id', 0));
  select coalesce(pg_catalog.max((record.payload ->> 'id')::bigint), 0) + 1 into next_activity_id
  from public.propcontrol_records as record
  where record.organization_id = target_org and record.entity_type = 'activity'
    and record.payload ->> 'id' ~ '^\d+$';
  activity_uid := pg_catalog.gen_random_uuid();
  activity_payload := pg_catalog.jsonb_build_object(
    'uid', activity_uid, 'revision', 0, 'operationId', p_operation_id,
    'visitUid', visit_uid, 'transactionOwner', 'visit',
    'id', next_activity_id, 'actorId', current_member_id,
    'action', activity_action, 'entityType', 'Cliente',
    'entityId', (client_record.payload ->> 'id')::bigint,
    'detail', activity_detail, 'createdAt', timestamp_value
  ) || case when client_record.uid is null then '{}'::jsonb
    else pg_catalog.jsonb_build_object('entityUid', client_record.uid) end;
  insert into public.propcontrol_records (
    organization_id, entity_type, entity_key, assigned_member_id, payload,
    created_by, uid, revision
  ) values (
    target_org, 'activity', activity_uid::text, assigned_member_id, activity_payload,
    current_user_id, activity_uid, 0
  );

  operation_result := pg_catalog.jsonb_build_object(
    'success', true, 'replayed', false, 'operationId', p_operation_id,
    'operationType', p_operation_type, 'organizationId', target_org,
    'serverTimestamp', timestamp_value, 'client', client_payload,
    'visit', visit_payload, 'activity', activity_payload
  );
  insert into private.commercial_operations (
    organization_id, operation_id, operation_type, actor_user_id,
    actor_member_id, request_hash, status, result_payload, entity_uid, completed_at
  ) values (
    target_org, p_operation_id, p_operation_type, current_user_id,
    current_member_id, computed_hash, 'completed', operation_result, visit_uid, timestamp_value
  ) on conflict (organization_id, operation_id) do nothing;
  inserted := found;
  if not inserted then
    raise exception using errcode = '23505', message = 'CONFLICT';
  end if;
  if p_force_rollback then
    raise exception using errcode = 'P0001', message = 'INTERNAL_ERROR';
  end if;
  return operation_result;
end;
$function$;

revoke all on function private.visit_authority_active(uuid) from public;
revoke all on function private.visit_normalized(text) from public;
revoke all on function private.visit_qualification_missing(jsonb) from public;
revoke all on function private.guard_transaction_owned_records() from public;
grant execute on function private.visit_authority_active(uuid) to authenticated;
grant execute on function private.visit_normalized(text) to authenticated;
grant execute on function private.visit_qualification_missing(jsonb) to authenticated;

revoke all on function public.client_snapshot_cas(jsonb, boolean) from public;
revoke all on function public.client_snapshot_cas(jsonb, boolean) from anon;
grant execute on function public.client_snapshot_cas(jsonb, boolean) to authenticated;

revoke all on function public.commercial_visit_mutation(uuid, text, jsonb, boolean) from public;
revoke all on function public.commercial_visit_mutation(uuid, text, jsonb, boolean) from anon;
grant execute on function public.commercial_visit_mutation(uuid, text, jsonb, boolean) to authenticated;

commit;
