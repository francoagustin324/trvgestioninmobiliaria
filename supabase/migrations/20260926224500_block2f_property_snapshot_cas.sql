-- ORDENBROKER BLOQUE 2F — CAS atómico para Property.
-- Forward-only. No toca datos reales ni RPC históricas.
-- El organization_id del frontend nunca otorga autoridad: se valida membresía activa server-side.

begin;

do $preflight$
declare
  required_relation text;
  required_function text;
  canonical_oid oid;
begin
  foreach required_relation in array array[
    'public.organization_members',
    'public.propcontrol_records'
  ] loop
    if pg_catalog.to_regclass(required_relation) is null then
      raise exception 'BLOCK2F abortado: falta dependencia %.', required_relation;
    end if;
  end loop;

  foreach required_function in array array[
    'auth.uid()',
    'private.visit_normalized(text)'
  ] loop
    if pg_catalog.to_regprocedure(required_function) is null then
      raise exception 'BLOCK2F abortado: falta dependencia %.', required_function;
    end if;
  end loop;

  if pg_catalog.to_regrole('anon') is null
    or pg_catalog.to_regrole('authenticated') is null
    or pg_catalog.to_regrole('service_role') is null then
    raise exception 'BLOCK2F abortado: faltan roles Supabase requeridos.';
  end if;

  if exists (
    select 1
    from (
      values
        ('organization_id'::text, 'pg_catalog.uuid'::pg_catalog.regtype),
        ('user_id'::text, 'pg_catalog.uuid'::pg_catalog.regtype),
        ('member_id'::text, 'pg_catalog.int8'::pg_catalog.regtype),
        ('role'::text, 'pg_catalog.text'::pg_catalog.regtype),
        ('status'::text, 'pg_catalog.text'::pg_catalog.regtype)
    ) as expected(column_name, type_oid)
    where not exists (
      select 1
      from pg_catalog.pg_attribute a
      where a.attrelid = 'public.organization_members'::pg_catalog.regclass
        and a.attname = expected.column_name
        and a.atttypid = expected.type_oid
        and a.attnum > 0
        and not a.attisdropped
    )
  ) then
    raise exception 'BLOCK2F abortado: organization_members incompatible.';
  end if;

  if exists (
    select 1
    from (
      values
        ('organization_id'::text, 'pg_catalog.uuid'::pg_catalog.regtype),
        ('entity_type'::text, 'pg_catalog.text'::pg_catalog.regtype),
        ('entity_key'::text, 'pg_catalog.text'::pg_catalog.regtype),
        ('assigned_member_id'::text, 'pg_catalog.int8'::pg_catalog.regtype),
        ('payload'::text, 'pg_catalog.jsonb'::pg_catalog.regtype),
        ('created_by'::text, 'pg_catalog.uuid'::pg_catalog.regtype),
        ('uid'::text, 'pg_catalog.uuid'::pg_catalog.regtype),
        ('revision'::text, 'pg_catalog.int8'::pg_catalog.regtype)
    ) as expected(column_name, type_oid)
    where not exists (
      select 1
      from pg_catalog.pg_attribute a
      where a.attrelid = 'public.propcontrol_records'::pg_catalog.regclass
        and a.attname = expected.column_name
        and a.atttypid = expected.type_oid
        and a.attnum > 0
        and not a.attisdropped
    )
  ) then
    raise exception 'BLOCK2F abortado: propcontrol_records incompatible.';
  end if;

  canonical_oid := pg_catalog.to_regprocedure('public.property_snapshot_cas_v1(uuid,jsonb,boolean)');
  if exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'property_snapshot_cas_v1'
      and p.oid <> coalesce(canonical_oid, 0::oid)
  ) then
    raise exception 'BLOCK2F abortado: overload incompatible para public.property_snapshot_cas_v1.';
  end if;
end;
$preflight$;

create or replace function public.property_snapshot_cas_v1(
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
  target_org uuid := p_organization_id;
  action_name text := p_request ->> 'action';
  requested_uid uuid;
  requested_legacy_id bigint;
  expected_revision bigint;
  payload_id bigint;
  assignment_requested boolean := p_request ? 'assignedMemberId';
  requested_assigned_member_id bigint;
  current_member_id bigint;
  actor_role text;
  effective_assigned_member_id bigint;
  target_member_is_active boolean := false;
  current_record public.propcontrol_records%rowtype;
  next_payload jsonb;
  target_entity_key text;
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
    and member.status = 'active'
  limit 1;

  if current_member_id is null then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  if p_request is null
    or action_name is null
    or action_name not in ('insert', 'update', 'delete') then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end if;

  begin
    requested_uid := nullif(p_request #>> '{property,uid}', '')::uuid;
    requested_legacy_id := nullif(p_request #>> '{property,legacyId}', '')::bigint;
    expected_revision := (p_request ->> 'expectedRevision')::bigint;
    if action_name in ('insert', 'update') then
      payload_id := (p_request #>> '{payload,id}')::bigint;
    end if;
  exception when others then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end;

  if (requested_uid is null) = (requested_legacy_id is null)
    or coalesce(requested_legacy_id, 1) <= 0
    or expected_revision is null
    or expected_revision < 0
    or (action_name in ('insert', 'update') and (
      pg_catalog.jsonb_typeof(p_request -> 'payload') <> 'object'
      or payload_id is null
      or payload_id <= 0
    ))
    or (requested_legacy_id is not null and action_name in ('insert', 'update') and payload_id <> requested_legacy_id)
    or (action_name = 'insert' and expected_revision <> 0) then
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

  if action_name = 'insert' then
    effective_assigned_member_id := coalesce(requested_assigned_member_id, current_member_id);
    if actor_role = 'agent' and effective_assigned_member_id <> current_member_id then
      raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
    end if;
    if effective_assigned_member_id <> current_member_id or actor_role in ('owner', 'admin') then
      select exists (
        select 1
        from public.organization_members as target_member
        where target_member.organization_id = target_org
          and target_member.member_id = effective_assigned_member_id
          and target_member.status = 'active'
      ) into target_member_is_active;
      if not target_member_is_active then
        raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
      end if;
    end if;

    target_entity_key := target_org::text || ':' || coalesce(requested_uid::text, payload_id::text);

    select record.* into current_record
    from public.propcontrol_records as record
    where record.organization_id = target_org
      and record.entity_type = 'property'
      and record.entity_key = target_entity_key
    for update;
    if found then
      raise exception using errcode = '40001', message = 'STALE_REVISION';
    end if;

    next_payload := (p_request -> 'payload') - 'uid' - 'revision' - 'operationId' - 'assignedToId' - 'id'
      || pg_catalog.jsonb_build_object(
        'id', payload_id,
        'revision', 0,
        'assignedToId', effective_assigned_member_id
      )
      || case when requested_uid is null then '{}'::jsonb
        else pg_catalog.jsonb_build_object('uid', requested_uid) end;

    perform pg_catalog.set_config('propcontrol.transaction_path', 'property_snapshot_cas', true);
    begin
      insert into public.propcontrol_records (
        organization_id,
        entity_type,
        entity_key,
        assigned_member_id,
        payload,
        created_by,
        uid,
        revision
      ) values (
        target_org,
        'property',
        target_entity_key,
        effective_assigned_member_id,
        next_payload,
        current_user_id,
        requested_uid,
        0
      );
    exception when unique_violation then
      raise exception using errcode = '40001', message = 'STALE_REVISION';
    end;

    if p_force_rollback then
      raise exception using errcode = 'P0001', message = 'INTERNAL_ERROR';
    end if;

    return pg_catalog.jsonb_build_object(
      'success', true,
      'organizationId', target_org,
      'action', action_name,
      'property', next_payload,
      'serverTimestamp', pg_catalog.statement_timestamp()
    );
  end if;

  select record.* into current_record
  from public.propcontrol_records as record
  where record.organization_id = target_org
    and record.entity_type = 'property'
    and (
      (requested_uid is not null and record.uid = requested_uid)
      or (
        requested_legacy_id is not null
        and record.entity_key = target_org::text || ':' || requested_legacy_id::text
      )
    )
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'NOT_FOUND';
  end if;

  if current_record.revision <> expected_revision then
    raise exception using errcode = '40001', message = 'STALE_REVISION';
  end if;

  if actor_role = 'agent'
    and current_record.assigned_member_id is distinct from current_member_id then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  if action_name = 'delete' then
    perform pg_catalog.set_config('propcontrol.transaction_path', 'property_snapshot_cas', true);
    delete from public.propcontrol_records
    where organization_id = target_org
      and entity_type = 'property'
      and entity_key = current_record.entity_key;

    if p_force_rollback then
      raise exception using errcode = 'P0001', message = 'INTERNAL_ERROR';
    end if;

    return pg_catalog.jsonb_build_object(
      'success', true,
      'organizationId', target_org,
      'action', action_name,
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
        and target_member.status = 'active'
    ) into target_member_is_active;

    if not target_member_is_active then
      raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
    end if;

    effective_assigned_member_id := requested_assigned_member_id;
  end if;

  if payload_id <> (current_record.payload ->> 'id')::bigint then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end if;

  next_payload := (p_request -> 'payload') - 'uid' - 'revision' - 'operationId' - 'assignedToId' - 'id'
    || pg_catalog.jsonb_build_object(
      'id', current_record.payload -> 'id',
      'revision', current_record.revision + 1
    )
    || case when current_record.uid is null then '{}'::jsonb
      else pg_catalog.jsonb_build_object('uid', current_record.uid) end
    || case when effective_assigned_member_id is null then '{}'::jsonb
      else pg_catalog.jsonb_build_object('assignedToId', effective_assigned_member_id) end;

  perform pg_catalog.set_config('propcontrol.transaction_path', 'property_snapshot_cas', true);
  update public.propcontrol_records
  set payload = next_payload,
      revision = current_record.revision + 1,
      assigned_member_id = effective_assigned_member_id
  where organization_id = target_org
    and entity_type = 'property'
    and entity_key = current_record.entity_key;

  if p_force_rollback then
    raise exception using errcode = 'P0001', message = 'INTERNAL_ERROR';
  end if;

  return pg_catalog.jsonb_build_object(
    'success', true,
    'organizationId', target_org,
    'action', action_name,
    'property', next_payload,
    'serverTimestamp', pg_catalog.statement_timestamp()
  );
end;
$function$;

revoke all on function public.property_snapshot_cas_v1(uuid, jsonb, boolean) from public;
revoke all on function public.property_snapshot_cas_v1(uuid, jsonb, boolean) from anon;
revoke all on function public.property_snapshot_cas_v1(uuid, jsonb, boolean) from service_role;
grant execute on function public.property_snapshot_cas_v1(uuid, jsonb, boolean) to authenticated;

commit;
