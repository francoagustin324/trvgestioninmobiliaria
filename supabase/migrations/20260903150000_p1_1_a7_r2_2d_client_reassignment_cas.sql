-- P1.1-A7-R2.2D — reasignación autoritativa de Client bajo el CAS existente.
-- Migration aditiva. No activa Visit authority ni modifica policies históricas.

begin;

create or replace function public.client_snapshot_cas(
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
  matching_orgs uuid[];
  target_org uuid;
  current_member_id bigint;
  actor_role text;
  current_record public.propcontrol_records%rowtype;
  effective_assigned_member_id bigint;
  target_member_is_active boolean := false;
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

  select pg_catalog.array_agg(candidate.organization_id)
  into matching_orgs
  from public.propcontrol_records as candidate
  where candidate.entity_type = 'client'
    and ((requested_uid is not null and candidate.uid = requested_uid)
      or (requested_legacy_id is not null and candidate.entity_key =
        candidate.organization_id::text || ':' || requested_legacy_id::text));
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

revoke all on function public.client_snapshot_cas(jsonb, boolean) from public;
revoke all on function public.client_snapshot_cas(jsonb, boolean) from anon;
grant execute on function public.client_snapshot_cas(jsonb, boolean) to authenticated;

commit;
