-- SEC-FIX-A1.1 — compatibilidad DB org-aware aditiva.
--
-- Agrega contratos V2 con organization_id explícito como boundary SQL.
-- No modifica datos, memberships, organizations, RLS, flags ni contratos legacy.

begin;

create function public.visit_transaction_authority_active_v2(
  p_organization_id uuid
)
returns boolean
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null or p_organization_id is null then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;
  if not private.is_active_org_member(p_organization_id, current_user_id) then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;
  return private.visit_authority_active(p_organization_id);
end;
$function$;

create function public.client_snapshot_cas_v2(
  p_organization_id uuid,
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
  assignment_requested boolean := action_name = 'update' and p_request ? 'assignedMemberId';
  requested_assigned_member_id bigint;
  target_org uuid := p_organization_id;
  current_member_id bigint;
  actor_role text;
  current_record public.propcontrol_records%rowtype;
  effective_assigned_member_id bigint;
  target_member_is_active boolean := false;
  next_payload jsonb;
begin
  if current_user_id is null or target_org is null then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  select member.member_id,
    case
      when private.visit_normalized(member.role) in ('owner', 'dueno') then 'owner'
      when private.visit_normalized(member.role) in ('admin', 'administrator', 'administrador') then 'admin'
      else 'agent'
    end
  into current_member_id, actor_role
  from public.organization_members as member
  where member.organization_id = target_org
    and member.user_id = current_user_id
    and private.visit_normalized(member.status) = 'active'
  limit 1;
  if current_member_id is null then
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
    or (action_name = 'update' and pg_catalog.jsonb_typeof(p_request -> 'payload') <> 'object') then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end if;

  if assignment_requested then
    if pg_catalog.jsonb_typeof(p_request -> 'assignedMemberId') <> 'number' then
      raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
    end if;
    begin
      requested_assigned_member_id := (p_request ->> 'assignedMemberId')::bigint;
    exception when others then
      raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
    end;
    if requested_assigned_member_id is null or requested_assigned_member_id <= 0 then
      raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
    end if;
  end if;

  select record.* into current_record
  from public.propcontrol_records as record
  where record.organization_id = target_org
    and record.entity_type = 'client'
    and ((requested_uid is not null and record.uid = requested_uid)
      or (requested_legacy_id is not null and record.entity_key =
        target_org::text || ':' || requested_legacy_id::text))
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'NOT_FOUND';
  end if;

  if not private.visit_authority_active(target_org) then
    raise exception using errcode = '22023', message = 'TERMINAL_STATE';
  end if;
  if current_record.revision <> expected_revision then
    raise exception using errcode = '40001', message = 'CONFLICT';
  end if;

  if action_name = 'delete' then
    perform pg_catalog.set_config('propcontrol.transaction_path', 'client_snapshot_cas', true);
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

  effective_assigned_member_id := current_record.assigned_member_id;
  if assignment_requested
    and current_record.assigned_member_id is distinct from requested_assigned_member_id then
    if actor_role not in ('owner', 'admin') then
      raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
    end if;

    select exists (
      select 1
      from public.organization_members as target_member
      where target_member.organization_id = target_org
        and target_member.member_id = requested_assigned_member_id
        and private.visit_normalized(target_member.status) = 'active'
    )
    into target_member_is_active;
    if not target_member_is_active then
      raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
    end if;
    effective_assigned_member_id := requested_assigned_member_id;
  end if;

  next_payload := (p_request -> 'payload') - 'uid' - 'revision' - 'operationId' - 'assignedToId'
    || pg_catalog.jsonb_build_object(
      'id', current_record.payload -> 'id',
      'revision', current_record.revision + 1
    )
    || case when current_record.uid is null then '{}'::jsonb
      else pg_catalog.jsonb_build_object('uid', current_record.uid) end
    || case when effective_assigned_member_id is null then '{}'::jsonb
      else pg_catalog.jsonb_build_object('assignedToId', effective_assigned_member_id) end;

  perform pg_catalog.set_config('propcontrol.transaction_path', 'client_snapshot_cas', true);
  update public.propcontrol_records
  set payload = next_payload,
      revision = current_record.revision + 1,
      assigned_member_id = effective_assigned_member_id
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

create function public.commercial_visit_mutation_v2(
  p_organization_id uuid,
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
  actor_role text;
  target_org uuid := p_organization_id;
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
begin
  if current_user_id is null or target_org is null then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  select member.member_id,
    case
      when private.visit_normalized(member.role) in ('owner', 'dueno') then 'owner'
      when private.visit_normalized(member.role) in ('admin', 'administrator', 'administrador') then 'admin'
      else 'agent'
    end
  into current_member_id, actor_role
  from public.organization_members as member
  where member.organization_id = target_org
    and member.user_id = current_user_id
    and private.visit_normalized(member.status) = 'active'
  limit 1;
  if current_member_id is null then
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
    if actor_role = 'agent' and visit_record.assigned_member_id is distinct from current_member_id then
      raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
    end if;
  end if;

  select record.* into client_record
  from public.propcontrol_records as record
  where record.organization_id = target_org and record.entity_type = 'client'
    and ((requested_client_uid is not null and record.uid = requested_client_uid)
      or (requested_client_id is not null and record.entity_key =
        target_org::text || ':' || requested_client_id::text))
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'NOT_FOUND'; end if;
  if client_record.revision <> expected_client_revision then
    raise exception using errcode = '40001', message = 'CONFLICT';
  end if;
  if actor_role = 'agent' and client_record.assigned_member_id is distinct from current_member_id then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  if p_operation_type = 'VISIT_CREATE' then
    select record.* into property_record
    from public.propcontrol_records as record
    where record.organization_id = target_org and record.entity_type = 'property'
      and ((requested_property_uid is not null and record.uid = requested_property_uid)
        or (requested_property_id is not null and record.entity_key =
          target_org::text || ':' || requested_property_id::text))
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
        or (not (visit_record.payload ? 'propertyUid') and record.entity_key =
          target_org::text || ':' || (visit_record.payload ->> 'propertyId')))
    for share;
  end if;
  if not found then raise exception using errcode = 'P0002', message = 'NOT_FOUND'; end if;
  if actor_role = 'agent' and property_record.assigned_member_id is distinct from current_member_id then
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
      extract(year from local_date)::int,
      extract(month from local_date)::int,
      extract(day from local_date)::int,
      extract(hour from local_time)::int,
      extract(minute from local_time)::int,
      0, 'America/Argentina/Buenos_Aires'
    );
    if scheduled_at < timestamp_value then
      raise exception using errcode = '22023', message = 'PAST_SCHEDULE';
    end if;
    if private.commercial_visit_duplicate_exists(
      target_org,
      (client_record.payload ->> 'id')::bigint,
      (property_record.payload ->> 'id')::bigint,
      scheduled_at
    ) then
      raise exception using errcode = '23505', message = 'DUPLICATE_VISIT';
    end if;

    next_visit_id := private.next_commercial_legacy_id(target_org, 'visit');
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
      target_org, 'visit', target_org::text || ':' || visit_uid::text,
      assigned_member_id, visit_payload,
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

  next_activity_id := private.next_commercial_legacy_id(target_org, 'activity');
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
    target_org, 'activity', target_org::text || ':' || activity_uid::text,
    assigned_member_id, activity_payload,
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

revoke all on function public.visit_transaction_authority_active_v2(uuid) from public;
revoke all on function public.visit_transaction_authority_active_v2(uuid) from anon;
grant execute on function public.visit_transaction_authority_active_v2(uuid) to authenticated;

revoke all on function public.client_snapshot_cas_v2(uuid, jsonb, boolean) from public;
revoke all on function public.client_snapshot_cas_v2(uuid, jsonb, boolean) from anon;
grant execute on function public.client_snapshot_cas_v2(uuid, jsonb, boolean) to authenticated;

revoke all on function public.commercial_visit_mutation_v2(uuid, uuid, text, jsonb, boolean) from public;
revoke all on function public.commercial_visit_mutation_v2(uuid, uuid, text, jsonb, boolean) from anon;
grant execute on function public.commercial_visit_mutation_v2(uuid, uuid, text, jsonb, boolean) to authenticated;

commit;
