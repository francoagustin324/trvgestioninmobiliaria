-- OrdenBroker · BASE-P0A.1a · Extended production inventory
-- PostgreSQL 17 / Supabase · STRICTLY READ-ONLY
--
-- This file complements, and does not replace:
--   supabase/audits/b0_2_production_inventory_readonly.sql
--
-- SAFETY CONTRACT
--   * Run STAGE 1 independently first.
--   * Run STAGE 2 only when STAGE 1 returns safe_to_run_inventory = true
--     and CEREBRO separately authorizes production execution.
--   * Never move this file into supabase/migrations.
--   * This inventory does not read CRM/Auth row payloads or storage.objects rows.
--   * The only non-catalog row source is storage.buckets configuration metadata.
--   * It never calls application RPCs, cron jobs, webhooks, or mutating functions.

-- P0A.1a STAGE 1: PREFLIGHT BEGIN
with
required_schemas(schema_name, required_for_inventory) as (
  values
    ('pg_catalog'::text, true),
    ('information_schema'::text, true),
    ('public'::text, true),
    ('private'::text, true),
    ('auth'::text, true),
    ('storage'::text, true),
    ('supabase_migrations'::text, false),
    ('cron'::text, false),
    ('net'::text, false)
),
schema_status as (
  select
    expected.schema_name,
    expected.required_for_inventory,
    namespace.oid is not null as exists
  from required_schemas as expected
  left join pg_catalog.pg_namespace as namespace
    on namespace.nspname = expected.schema_name
),
required_relations(schema_name, relation_name, required_for_inventory) as (
  values
    ('pg_catalog'::text, 'pg_namespace'::text, true),
    ('pg_catalog'::text, 'pg_class'::text, true),
    ('pg_catalog'::text, 'pg_attribute'::text, true),
    ('pg_catalog'::text, 'pg_attrdef'::text, true),
    ('pg_catalog'::text, 'pg_constraint'::text, true),
    ('pg_catalog'::text, 'pg_index'::text, true),
    ('pg_catalog'::text, 'pg_policy'::text, true),
    ('pg_catalog'::text, 'pg_proc'::text, true),
    ('pg_catalog'::text, 'pg_trigger'::text, true),
    ('pg_catalog'::text, 'pg_depend'::text, true),
    ('pg_catalog'::text, 'pg_roles'::text, true),
    ('pg_catalog'::text, 'pg_language'::text, true),
    ('pg_catalog'::text, 'pg_type'::text, true),
    ('pg_catalog'::text, 'pg_enum'::text, true),
    ('pg_catalog'::text, 'pg_extension'::text, true),
    ('pg_catalog'::text, 'pg_sequence'::text, true),
    ('pg_catalog'::text, 'pg_available_extensions'::text, true),
    ('information_schema'::text, 'columns'::text, true),
    ('storage'::text, 'buckets'::text, true),
    ('storage'::text, 'objects'::text, true),
    ('auth'::text, 'users'::text, true),
    ('supabase_migrations'::text, 'schema_migrations'::text, false),
    ('cron'::text, 'job'::text, false)
),
relation_status as (
  select
    expected.schema_name,
    expected.relation_name,
    expected.required_for_inventory,
    relation.oid as relation_oid,
    relation.relkind,
    relation.oid is not null as exists
  from required_relations as expected
  left join pg_catalog.pg_namespace as namespace
    on namespace.nspname = expected.schema_name
  left join pg_catalog.pg_class as relation
    on relation.relnamespace = namespace.oid
   and relation.relname = expected.relation_name
),
required_storage_columns(column_name) as (
  values
    ('name'::text),
    ('public'::text),
    ('file_size_limit'::text),
    ('allowed_mime_types'::text)
),
storage_column_status as (
  select
    expected.column_name,
    attribute.attname is not null
      and attribute.attnum > 0
      and not attribute.attisdropped as exists
  from required_storage_columns as expected
  left join pg_catalog.pg_namespace as namespace
    on namespace.nspname = 'storage'
  left join pg_catalog.pg_class as relation
    on relation.relnamespace = namespace.oid
   and relation.relname = 'buckets'
  left join pg_catalog.pg_attribute as attribute
    on attribute.attrelid = relation.oid
   and attribute.attname = expected.column_name
),
required_catalog_functions(function_name, minimum_arguments) as (
  values
    ('acldefault'::text, 2),
    ('aclexplode'::text, 1),
    ('format_type'::text, 2),
    ('pg_get_expr'::text, 2),
    ('pg_get_constraintdef'::text, 1),
    ('pg_get_indexdef'::text, 1),
    ('pg_get_functiondef'::text, 1),
    ('pg_get_function_arguments'::text, 1),
    ('pg_get_function_identity_arguments'::text, 1),
    ('pg_get_function_result'::text, 1),
    ('pg_get_triggerdef'::text, 1),
    ('pg_get_userbyid'::text, 1),
    ('has_table_privilege'::text, 2),
    ('has_schema_privilege'::text, 2)
),
catalog_function_status as (
  select
    expected.function_name,
    expected.minimum_arguments,
    pg_catalog.bool_or(
      function_info.oid is not null
      and function_info.pronargs >= expected.minimum_arguments
    ) as exists
  from required_catalog_functions as expected
  left join pg_catalog.pg_namespace as namespace
    on namespace.nspname = 'pg_catalog'
  left join pg_catalog.pg_proc as function_info
    on function_info.pronamespace = namespace.oid
   and function_info.proname = expected.function_name
  group by expected.function_name, expected.minimum_arguments
),
permission_status as (
  select
    case
      when pg_catalog.to_regclass('storage.buckets') is null then false
      else pg_catalog.has_table_privilege(current_user, 'storage.buckets', 'SELECT')
    end as can_read_bucket_config,
    case
      when not exists (select 1 from pg_catalog.pg_namespace where nspname = 'storage') then false
      else pg_catalog.has_schema_privilege(current_user, 'storage', 'USAGE')
    end as can_use_storage_schema
),
extension_candidates(extension_name) as (
  values
    ('pgcrypto'::text),
    ('uuid-ossp'::text),
    ('pg_cron'::text),
    ('pg_net'::text)
),
extension_status as (
  select
    candidate.extension_name,
    extension.oid is not null as installed,
    available.name is not null as available,
    extension.extversion as installed_version,
    available.default_version,
    extension_namespace.nspname as installed_schema
  from extension_candidates as candidate
  left join pg_catalog.pg_extension as extension
    on extension.extname = candidate.extension_name
  left join pg_catalog.pg_namespace as extension_namespace
    on extension_namespace.oid = extension.extnamespace
  left join pg_catalog.pg_available_extensions as available
    on available.name = candidate.extension_name
),
requirements as (
  select
    'schema'::text as category,
    schema_name as object_name,
    required_for_inventory,
    exists,
    pg_catalog.jsonb_build_object('schema', schema_name) as details
  from schema_status

  union all

  select
    'relation'::text,
    schema_name || '.' || relation_name,
    required_for_inventory,
    exists,
    pg_catalog.jsonb_build_object('relkind', relkind)
  from relation_status

  union all

  select
    'storage_column'::text,
    'storage.buckets.' || column_name,
    true,
    exists,
    pg_catalog.jsonb_build_object('column', column_name)
  from storage_column_status

  union all

  select
    'catalog_function'::text,
    'pg_catalog.' || function_name,
    true,
    coalesce(exists, false),
    pg_catalog.jsonb_build_object('minimum_arguments', minimum_arguments)
  from catalog_function_status

  union all

  select
    'permission'::text,
    'storage schema USAGE',
    true,
    can_use_storage_schema,
    '{}'::jsonb
  from permission_status

  union all

  select
    'permission'::text,
    'storage.buckets SELECT',
    true,
    can_read_bucket_config,
    '{}'::jsonb
  from permission_status
),
summary as (
  select
    coalesce(
      pg_catalog.bool_and(exists) filter (where required_for_inventory),
      false
    ) as safe_to_run_inventory,
    coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'category', category,
          'object', object_name,
          'required_for_inventory', required_for_inventory,
          'exists', exists,
          'details', details
        )
        order by category, object_name
      ),
      '[]'::jsonb
    ) as requirements,
    coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'category', category,
          'object', object_name,
          'reason', 'required inspection capability is absent'
        )
        order by category, object_name
      ) filter (where required_for_inventory and not exists),
      '[]'::jsonb
    ) as blocking_findings
  from requirements
)
select pg_catalog.jsonb_build_object(
  'check', 'BASE-P0A.1a extended production inventory preflight',
  'read_only', true,
  'catalog_first', true,
  'server_version', pg_catalog.current_setting('server_version'),
  'server_version_num', pg_catalog.current_setting('server_version_num'),
  'safe_to_run_inventory', summary.safe_to_run_inventory,
  'requirements', summary.requirements,
  'extension_candidates', (
    select coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'name', extension_name,
          'installed', installed,
          'available', available,
          'installed_version', installed_version,
          'default_version', default_version,
          'schema', installed_schema
        )
        order by extension_name
      ),
      '[]'::jsonb
    )
    from extension_status
  ),
  'blocking_findings', summary.blocking_findings,
  'next_step', case
    when summary.safe_to_run_inventory
      then 'Stage 2 may be considered only after separate CEREBRO authorization.'
    else 'STOP. Stage 2 is not authorized because preflight failed closed.'
  end
) as p0a_1a_extended_inventory_preflight
from summary;
-- P0A.1a STAGE 1: PREFLIGHT END

-- P0A.1a STAGE 2: INVENTORY BEGIN
-- DESIGN/OFFLINE VALIDATION ONLY IN BASE-P0A.1a.
with
target_namespaces as (
  select namespace.oid, namespace.nspname
  from pg_catalog.pg_namespace as namespace
  where namespace.nspname not in ('pg_catalog', 'information_schema')
    and namespace.nspname !~ '^pg_toast'
    and namespace.nspname !~ '^pg_temp_'
    and namespace.nspname !~ '^pg_toast_temp_'
),
schema_rows as (
  select
    'schemas'::text as section,
    namespace.nspname as schema_name,
    'schema'::text as object_type,
    namespace.nspname as object_name,
    namespace.nspname as identity,
    pg_catalog.jsonb_build_object(
      'owner', pg_catalog.pg_get_userbyid(namespace.nspowner)
    ) as definition,
    null::text as classification_hint
  from target_namespaces as namespace
),
installed_extension_rows as (
  select
    'extensions'::text as section,
    extension_namespace.nspname as schema_name,
    'extension'::text as object_type,
    extension.extname as object_name,
    extension.extname as identity,
    pg_catalog.jsonb_build_object(
      'version', extension.extversion,
      'schema', extension_namespace.nspname,
      'dependency_count', (
        select pg_catalog.count(*)
        from pg_catalog.pg_depend as dependency
        where dependency.refclassid = 'pg_catalog.pg_extension'::pg_catalog.regclass
          and dependency.refobjid = extension.oid
      ),
      'has_dependencies', exists (
        select 1
        from pg_catalog.pg_depend as dependency
        where dependency.refclassid = 'pg_catalog.pg_extension'::pg_catalog.regclass
          and dependency.refobjid = extension.oid
      )
    ) as definition,
    null::text as classification_hint
  from pg_catalog.pg_extension as extension
  join pg_catalog.pg_namespace as extension_namespace
    on extension_namespace.oid = extension.extnamespace
),
extension_candidates(extension_name) as (
  values
    ('pgcrypto'::text),
    ('uuid-ossp'::text),
    ('pg_cron'::text),
    ('pg_net'::text)
),
extension_candidate_rows as (
  select
    'extension_candidates'::text as section,
    coalesce(extension_namespace.nspname, '') as schema_name,
    'extension_candidate'::text as object_type,
    candidate.extension_name as object_name,
    candidate.extension_name as identity,
    pg_catalog.jsonb_build_object(
      'installed', extension.oid is not null,
      'available', available.name is not null,
      'installed_version', extension.extversion,
      'default_version', available.default_version,
      'installed_schema', extension_namespace.nspname
    ) as definition,
    null::text as classification_hint
  from extension_candidates as candidate
  left join pg_catalog.pg_extension as extension
    on extension.extname = candidate.extension_name
  left join pg_catalog.pg_namespace as extension_namespace
    on extension_namespace.oid = extension.extnamespace
  left join pg_catalog.pg_available_extensions as available
    on available.name = candidate.extension_name
),
enum_labels as (
  select
    type_info.oid as type_oid,
    pg_catalog.jsonb_agg(enum.enumlabel order by enum.enumsortorder) as labels
  from pg_catalog.pg_type as type_info
  join pg_catalog.pg_enum as enum
    on enum.enumtypid = type_info.oid
  group by type_info.oid
),
domain_constraints as (
  select
    constraint_info.contypid as type_oid,
    pg_catalog.jsonb_agg(
      pg_catalog.pg_get_constraintdef(constraint_info.oid, true)
      order by constraint_info.conname
    ) as constraints
  from pg_catalog.pg_constraint as constraint_info
  where constraint_info.contypid <> 0
  group by constraint_info.contypid
),
composite_attributes as (
  select
    type_info.oid as type_oid,
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'name', attribute.attname,
        'type', pg_catalog.format_type(attribute.atttypid, attribute.atttypmod),
        'position', attribute.attnum
      )
      order by attribute.attnum
    ) as attributes
  from pg_catalog.pg_type as type_info
  join pg_catalog.pg_class as relation
    on relation.oid = type_info.typrelid
   and relation.relkind = 'c'
  join pg_catalog.pg_attribute as attribute
    on attribute.attrelid = relation.oid
   and attribute.attnum > 0
   and not attribute.attisdropped
  group by type_info.oid
),
type_rows as (
  select
    'types'::text as section,
    namespace.nspname as schema_name,
    case type_info.typtype
      when 'e' then 'enum'
      when 'd' then 'domain'
      when 'c' then 'composite'
      else 'type'
    end as object_type,
    type_info.typname as object_name,
    namespace.nspname || '.' || type_info.typname as identity,
    pg_catalog.jsonb_build_object(
      'type_kind', case type_info.typtype
        when 'e' then 'enum'
        when 'd' then 'domain'
        when 'c' then 'composite'
        else type_info.typtype::text
      end,
      'base_type', case
        when type_info.typtype = 'd'
          then pg_catalog.format_type(type_info.typbasetype, type_info.typtypmod)
        else null
      end,
      'not_null', type_info.typnotnull,
      'default', type_info.typdefault,
      'enum_labels', enum_labels.labels,
      'domain_constraints', domain_constraints.constraints,
      'attributes', composite_attributes.attributes
    ) as definition,
    null::text as classification_hint
  from pg_catalog.pg_type as type_info
  join target_namespaces as namespace
    on namespace.oid = type_info.typnamespace
  left join enum_labels
    on enum_labels.type_oid = type_info.oid
  left join domain_constraints
    on domain_constraints.type_oid = type_info.oid
  left join composite_attributes
    on composite_attributes.type_oid = type_info.oid
  where type_info.typtype in ('e', 'd', 'c')
    and (
      type_info.typtype <> 'c'
      or exists (
        select 1
        from pg_catalog.pg_class as relation
        where relation.oid = type_info.typrelid
          and relation.relkind = 'c'
      )
    )
),
sequence_ownership as (
  select
    sequence_relation.oid as sequence_oid,
    owner_namespace.nspname as owner_schema,
    owner_relation.relname as owner_table,
    owner_attribute.attname as owner_column,
    owner_attribute.attidentity as identity_mode,
    pg_catalog.pg_get_expr(owner_default.adbin, owner_default.adrelid) as column_default
  from pg_catalog.pg_class as sequence_relation
  left join pg_catalog.pg_depend as dependency
    on dependency.classid = 'pg_catalog.pg_class'::pg_catalog.regclass
   and dependency.objid = sequence_relation.oid
   and dependency.refclassid = 'pg_catalog.pg_class'::pg_catalog.regclass
   and dependency.deptype in ('a', 'i')
  left join pg_catalog.pg_class as owner_relation
    on owner_relation.oid = dependency.refobjid
  left join pg_catalog.pg_namespace as owner_namespace
    on owner_namespace.oid = owner_relation.relnamespace
  left join pg_catalog.pg_attribute as owner_attribute
    on owner_attribute.attrelid = owner_relation.oid
   and owner_attribute.attnum = dependency.refobjsubid
   and owner_attribute.attnum > 0
   and not owner_attribute.attisdropped
  left join pg_catalog.pg_attrdef as owner_default
    on owner_default.adrelid = owner_relation.oid
   and owner_default.adnum = owner_attribute.attnum
  where sequence_relation.relkind = 'S'
),
sequence_rows as (
  select
    'sequences'::text as section,
    namespace.nspname as schema_name,
    'sequence'::text as object_type,
    relation.relname as object_name,
    namespace.nspname || '.' || relation.relname as identity,
    pg_catalog.jsonb_build_object(
      'data_type', pg_catalog.format_type(sequence_info.seqtypid, null),
      'start', sequence_info.seqstart,
      'increment', sequence_info.seqincrement,
      'min', sequence_info.seqmin,
      'max', sequence_info.seqmax,
      'cache', sequence_info.seqcache,
      'cycle', sequence_info.seqcycle,
      'owned_by_schema', ownership.owner_schema,
      'owned_by_table', ownership.owner_table,
      'owned_by_column', ownership.owner_column,
      'identity_mode', nullif(ownership.identity_mode, ''),
      'column_default', ownership.column_default
    ) as definition,
    null::text as classification_hint
  from pg_catalog.pg_class as relation
  join target_namespaces as namespace
    on namespace.oid = relation.relnamespace
  join pg_catalog.pg_sequence as sequence_info
    on sequence_info.seqrelid = relation.oid
  left join sequence_ownership as ownership
    on ownership.sequence_oid = relation.oid
  where relation.relkind = 'S'
),
relation_columns as (
  select
    relation.oid as relation_oid,
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'name', attribute.attname,
        'type', pg_catalog.format_type(attribute.atttypid, attribute.atttypmod),
        'not_null', attribute.attnotnull,
        'identity', nullif(attribute.attidentity, ''),
        'generated', nullif(attribute.attgenerated, ''),
        'default', pg_catalog.pg_get_expr(default_value.adbin, default_value.adrelid)
      )
      order by attribute.attnum
    ) filter (where attribute.attname is not null) as columns
  from pg_catalog.pg_class as relation
  left join pg_catalog.pg_attribute as attribute
    on attribute.attrelid = relation.oid
   and attribute.attnum > 0
   and not attribute.attisdropped
  left join pg_catalog.pg_attrdef as default_value
    on default_value.adrelid = relation.oid
   and default_value.adnum = attribute.attnum
  group by relation.oid
),
relation_constraints as (
  select
    relation.oid as relation_oid,
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'name', constraint_info.conname,
        'type', constraint_info.contype,
        'definition', pg_catalog.pg_get_constraintdef(constraint_info.oid, true)
      )
      order by constraint_info.conname
    ) filter (where constraint_info.oid is not null) as constraints
  from pg_catalog.pg_class as relation
  left join pg_catalog.pg_constraint as constraint_info
    on constraint_info.conrelid = relation.oid
  group by relation.oid
),
relation_indexes as (
  select
    relation.oid as relation_oid,
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'name', index_relation.relname,
        'unique', index_info.indisunique,
        'primary', index_info.indisprimary,
        'valid', index_info.indisvalid,
        'definition', pg_catalog.pg_get_indexdef(index_info.indexrelid)
      )
      order by index_relation.relname
    ) filter (where index_info.indexrelid is not null) as indexes
  from pg_catalog.pg_class as relation
  left join pg_catalog.pg_index as index_info
    on index_info.indrelid = relation.oid
  left join pg_catalog.pg_class as index_relation
    on index_relation.oid = index_info.indexrelid
  group by relation.oid
),
relation_definition as (
  select
    relation.oid as relation_oid,
    namespace.nspname as schema_name,
    relation.relname as relation_name,
    relation.relkind,
    relation.relrowsecurity,
    relation.relforcerowsecurity,
    pg_catalog.pg_get_userbyid(relation.relowner) as owner,
    coalesce(relation_columns.columns, '[]'::jsonb) as columns,
    coalesce(relation_constraints.constraints, '[]'::jsonb) as constraints,
    coalesce(relation_indexes.indexes, '[]'::jsonb) as indexes
  from pg_catalog.pg_class as relation
  join target_namespaces as namespace
    on namespace.oid = relation.relnamespace
  left join relation_columns
    on relation_columns.relation_oid = relation.oid
  left join relation_constraints
    on relation_constraints.relation_oid = relation.oid
  left join relation_indexes
    on relation_indexes.relation_oid = relation.oid
  where relation.relkind in ('r', 'p', 'v', 'm', 'f')
),
commercial_operations_rows as (
  select
    'commercial_operations'::text as section,
    'private'::text as schema_name,
    'table'::text as object_type,
    'commercial_operations'::text as object_name,
    'private.commercial_operations'::text as identity,
    pg_catalog.jsonb_build_object(
      'exists', definition.relation_oid is not null,
      'relkind', definition.relkind,
      'owner', definition.owner,
      'rls_enabled', coalesce(definition.relrowsecurity, false),
      'rls_forced', coalesce(definition.relforcerowsecurity, false),
      'columns', coalesce(definition.columns, '[]'::jsonb),
      'constraints', coalesce(definition.constraints, '[]'::jsonb),
      'indexes', coalesce(definition.indexes, '[]'::jsonb)
    ) as definition,
    null::text as classification_hint
  from (values (1)) as one(value)
  left join relation_definition as definition
    on definition.schema_name = 'private'
   and definition.relation_name = 'commercial_operations'
),
idempotency_surface_rows as (
  select
    'idempotency_surface'::text as section,
    'private'::text as schema_name,
    'structural_contract'::text as object_type,
    'commercial_operations_idempotency'::text as object_name,
    'private.commercial_operations:idempotency'::text as identity,
    pg_catalog.jsonb_build_object(
      'table_exists', definition.relation_oid is not null,
      'expected_fields', pg_catalog.jsonb_build_array(
        'operation_id',
        'operation_type',
        'status',
        'request_hash',
        'actor',
        'entity_uid',
        'completed_at'
      ),
      'matching_columns', coalesce((
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'name', attribute.attname,
            'type', pg_catalog.format_type(attribute.atttypid, attribute.atttypmod),
            'not_null', attribute.attnotnull
          )
          order by attribute.attnum
        )
        from pg_catalog.pg_attribute as attribute
        where attribute.attrelid = definition.relation_oid
          and attribute.attnum > 0
          and not attribute.attisdropped
          and (
            attribute.attname in (
              'operation_id', 'operation_type', 'status', 'request_hash',
              'actor', 'actor_id', 'actor_user_id',
              'entity_uid', 'completed_at'
            )
            or attribute.attname ~ '^(operation|request|actor|entity|completed)'
          )
      ), '[]'::jsonb)
    ) as definition,
    null::text as classification_hint
  from (values (1)) as one(value)
  left join relation_definition as definition
    on definition.schema_name = 'private'
   and definition.relation_name = 'commercial_operations'
),
function_catalog as (
  select
    function_info.oid as function_oid,
    namespace.nspname as schema_name,
    function_info.proname as function_name,
    pg_catalog.pg_get_function_identity_arguments(function_info.oid) as identity_arguments,
    pg_catalog.pg_get_function_arguments(function_info.oid) as arguments,
    pg_catalog.pg_get_function_result(function_info.oid) as return_type,
    language.lanname as language_name,
    function_info.provolatile,
    function_info.prosecdef,
    function_info.proconfig,
    function_info.proowner,
    function_info.proacl,
    pg_catalog.pg_get_functiondef(function_info.oid) as function_definition
  from pg_catalog.pg_proc as function_info
  join pg_catalog.pg_namespace as namespace
    on namespace.oid = function_info.pronamespace
  join pg_catalog.pg_language as language
    on language.oid = function_info.prolang
  where namespace.nspname in ('public', 'private', 'auth', 'storage', 'cron', 'net')
    and function_info.prokind in ('f', 'p')
),
function_acl as (
  select
    function_info.function_oid,
    coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'grantee', case
            when grant_item.grantee = 0 then 'PUBLIC'
            else grantee_role.rolname
          end,
          'grantor', grantor_role.rolname,
          'privilege', grant_item.privilege_type,
          'grantable', grant_item.is_grantable
        )
        order by
          case when grant_item.grantee = 0 then 'PUBLIC' else grantee_role.rolname end,
          grant_item.privilege_type
      ) filter (where grant_item.privilege_type is not null),
      '[]'::jsonb
    ) as grants
  from function_catalog as function_info
  left join lateral pg_catalog.aclexplode(
    case
      when function_info.proowner is null then null::aclitem[]
      when function_info.proacl is null
        then pg_catalog.acldefault('f', function_info.proowner)
      else function_info.proacl
    end
  ) as grant_item on true
  left join pg_catalog.pg_roles as grantee_role
    on grantee_role.oid = grant_item.grantee
  left join pg_catalog.pg_roles as grantor_role
    on grantor_role.oid = grant_item.grantor
  group by function_info.function_oid
),
function_rows as (
  select
    'functions'::text as section,
    function_info.schema_name,
    'function'::text as object_type,
    function_info.function_name as object_name,
    function_info.schema_name || '.' || function_info.function_name
      || '(' || function_info.identity_arguments || ')' as identity,
    pg_catalog.jsonb_build_object(
      'arguments', function_info.arguments,
      'return_type', function_info.return_type,
      'language', function_info.language_name,
      'security', case when function_info.prosecdef then 'definer' else 'invoker' end,
      'owner', pg_catalog.pg_get_userbyid(function_info.proowner),
      'search_path', function_info.proconfig,
      'volatility', case function_info.provolatile
        when 'i' then 'immutable'
        when 's' then 'stable'
        when 'v' then 'volatile'
        else function_info.provolatile::text
      end,
      'grants', function_acl.grants,
      'uses_revision', function_info.function_definition ~* '\mrevision\M',
      'uses_expected_revision', function_info.function_definition ~* 'expected[_ ]?revision',
      'uses_operation_id', function_info.function_definition ~* 'operation[_ ]?id',
      'uses_pg_net_or_http', function_info.function_definition ~* '(pg_net|net\.|http_post|http_get|https?://)',
      'uses_cron', function_info.function_definition ~* '(cron\.|schedule\s*\()'
    ) as definition,
    null::text as classification_hint
  from function_catalog as function_info
  left join function_acl
    on function_acl.function_oid = function_info.function_oid
),
cas_revision_rows as (
  select
    'cas_revision'::text as section,
    function_info.schema_name,
    'function'::text as object_type,
    function_info.function_name as object_name,
    function_info.schema_name || '.' || function_info.function_name
      || '(' || function_info.identity_arguments || ')' as identity,
    pg_catalog.jsonb_build_object(
      'security', case when function_info.prosecdef then 'definer' else 'invoker' end,
      'owner', pg_catalog.pg_get_userbyid(function_info.proowner),
      'search_path', function_info.proconfig,
      'volatility', case function_info.provolatile
        when 'i' then 'immutable'
        when 's' then 'stable'
        when 'v' then 'volatile'
        else function_info.provolatile::text
      end,
      'arguments', function_info.arguments,
      'return_type', function_info.return_type,
      'grants', function_acl.grants,
      'revision_related', function_info.function_definition ~* '\mrevision\M',
      'expected_revision_related', function_info.function_definition ~* 'expected[_ ]?revision',
      'operation_id_related', function_info.function_definition ~* 'operation[_ ]?id'
    ) as definition,
    null::text as classification_hint
  from function_catalog as function_info
  left join function_acl
    on function_acl.function_oid = function_info.function_oid
  where function_info.function_name ~* '(cas|snapshot|visit|commercial|revision)'
     or function_info.function_definition ~* '(expected[_ ]?revision|operation[_ ]?id|\mrevision\M)'
),
auth_relation_rows as (
  select
    'auth_metadata'::text as section,
    definition.schema_name,
    case definition.relkind
      when 'v' then 'view'
      when 'm' then 'materialized_view'
      else 'relation'
    end as object_type,
    definition.relation_name as object_name,
    definition.schema_name || '.' || definition.relation_name as identity,
    pg_catalog.jsonb_build_object(
      'relkind', definition.relkind,
      'owner', definition.owner,
      'rls_enabled', definition.relrowsecurity,
      'rls_forced', definition.relforcerowsecurity,
      'columns', definition.columns,
      'constraints', definition.constraints,
      'indexes', definition.indexes
    ) as definition,
    null::text as classification_hint
  from relation_definition as definition
  where definition.schema_name = 'auth'
),
storage_relation_rows as (
  select
    'storage_metadata'::text as section,
    definition.schema_name,
    case definition.relkind
      when 'v' then 'view'
      when 'm' then 'materialized_view'
      else 'relation'
    end as object_type,
    definition.relation_name as object_name,
    definition.schema_name || '.' || definition.relation_name as identity,
    pg_catalog.jsonb_build_object(
      'relkind', definition.relkind,
      'owner', definition.owner,
      'rls_enabled', definition.relrowsecurity,
      'rls_forced', definition.relforcerowsecurity,
      'columns', definition.columns,
      'constraints', definition.constraints,
      'indexes', definition.indexes
    ) as definition,
    null::text as classification_hint
  from relation_definition as definition
  where definition.schema_name = 'storage'
),
storage_bucket_rows as (
  select
    'storage_buckets'::text as section,
    'storage'::text as schema_name,
    'bucket_config'::text as object_type,
    bucket.name::text as object_name,
    'storage.buckets:' || bucket.name::text as identity,
    pg_catalog.jsonb_build_object(
      'public', bucket.public,
      'file_size_limit', bucket.file_size_limit,
      'allowed_mime_types', bucket.allowed_mime_types
    ) as definition,
    null::text as classification_hint
  from storage.buckets as bucket
),
trigger_catalog as (
  select
    trigger_info.oid as trigger_oid,
    relation_namespace.nspname as schema_name,
    relation.relname as table_name,
    trigger_info.tgname as trigger_name,
    trigger_info.tgtype,
    trigger_info.tgenabled,
    function_namespace.nspname as function_schema,
    function_info.proname as function_name,
    pg_catalog.pg_get_functiondef(function_info.oid) as function_definition
  from pg_catalog.pg_trigger as trigger_info
  join pg_catalog.pg_class as relation
    on relation.oid = trigger_info.tgrelid
  join pg_catalog.pg_namespace as relation_namespace
    on relation_namespace.oid = relation.relnamespace
  join pg_catalog.pg_proc as function_info
    on function_info.oid = trigger_info.tgfoid
  join pg_catalog.pg_namespace as function_namespace
    on function_namespace.oid = function_info.pronamespace
  where not trigger_info.tgisinternal
    and relation_namespace.nspname not in ('pg_catalog', 'information_schema')
    and relation_namespace.nspname !~ '^pg_toast'
),
trigger_rows as (
  select
    'triggers'::text as section,
    trigger_info.schema_name,
    'trigger'::text as object_type,
    trigger_info.trigger_name as object_name,
    trigger_info.schema_name || '.' || trigger_info.table_name || ':' || trigger_info.trigger_name as identity,
    pg_catalog.jsonb_build_object(
      'table', trigger_info.schema_name || '.' || trigger_info.table_name,
      'timing', case
        when (trigger_info.tgtype & 2) <> 0 then 'before'
        when (trigger_info.tgtype & 64) <> 0 then 'instead_of'
        else 'after'
      end,
      'events', (
        select pg_catalog.jsonb_agg(event_name order by event_name)
        from (
          select 'DELETE'::text as event_name where (trigger_info.tgtype & 8) <> 0
          union all
          select 'INSERT'::text where (trigger_info.tgtype & 4) <> 0
          union all
          select 'TRUNCATE'::text where (trigger_info.tgtype & 32) <> 0
          union all
          select 'UPDATE'::text where (trigger_info.tgtype & 16) <> 0
        ) as events
      ),
      'level', case when (trigger_info.tgtype & 1) <> 0 then 'row' else 'statement' end,
      'function', trigger_info.function_schema || '.' || trigger_info.function_name,
      'enabled_state', trigger_info.tgenabled,
      'external_integration_flag', trigger_info.function_definition ~* '(pg_net|net\.|http_post|http_get|https?://|cron\.)'
    ) as definition,
    null::text as classification_hint
  from trigger_catalog as trigger_info
),
rls_rows as (
  select
    'rls'::text as section,
    definition.schema_name,
    'table_rls'::text as object_type,
    definition.relation_name as object_name,
    definition.schema_name || '.' || definition.relation_name as identity,
    pg_catalog.jsonb_build_object(
      'rls_enabled', definition.relrowsecurity,
      'rls_forced', definition.relforcerowsecurity
    ) as definition,
    null::text as classification_hint
  from relation_definition as definition
  where definition.relkind in ('r', 'p')
),
policy_rows as (
  select
    'policies'::text as section,
    namespace.nspname as schema_name,
    'policy'::text as object_type,
    policy.polname as object_name,
    namespace.nspname || '.' || relation.relname || ':' || policy.polname as identity,
    pg_catalog.jsonb_build_object(
      'table', namespace.nspname || '.' || relation.relname,
      'roles', (
        select coalesce(
          pg_catalog.jsonb_agg(
            case when role_entry.role_oid = 0 then 'PUBLIC' else role_info.rolname end
            order by case when role_entry.role_oid = 0 then 'PUBLIC' else role_info.rolname end
          ),
          '[]'::jsonb
        )
        from pg_catalog.unnest(policy.polroles) as role_entry(role_oid)
        left join pg_catalog.pg_roles as role_info
          on role_info.oid = role_entry.role_oid
      ),
      'command', policy.polcmd,
      'permissive', policy.polpermissive,
      'using', case
        when policy.polqual is null then null
        else pg_catalog.pg_get_expr(policy.polqual, policy.polrelid)
      end,
      'with_check', case
        when policy.polwithcheck is null then null
        else pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid)
      end
    ) as definition,
    null::text as classification_hint
  from pg_catalog.pg_policy as policy
  join pg_catalog.pg_class as relation
    on relation.oid = policy.polrelid
  join target_namespaces as namespace
    on namespace.oid = relation.relnamespace
),
relation_acl_source as (
  select
    relation.oid as object_oid,
    namespace.nspname as schema_name,
    relation.relname as object_name,
    relation.relkind,
    relation.relowner,
    case
      when relation.relacl is not null then relation.relacl
      when relation.relkind = 'S' then pg_catalog.acldefault('S', relation.relowner)
      else pg_catalog.acldefault('r', relation.relowner)
    end as effective_acl
  from pg_catalog.pg_class as relation
  join target_namespaces as namespace
    on namespace.oid = relation.relnamespace
  where relation.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
),
relation_grant_rows as (
  select
    'grants'::text as section,
    acl.schema_name,
    case when acl.relkind = 'S' then 'sequence_grant' else 'table_grant' end as object_type,
    acl.object_name,
    acl.schema_name || '.' || acl.object_name || ':'
      || case when grant_item.grantee = 0 then 'PUBLIC' else grantee_role.rolname end
      || ':' || grant_item.privilege_type as identity,
    pg_catalog.jsonb_build_object(
      'grantee', case when grant_item.grantee = 0 then 'PUBLIC' else grantee_role.rolname end,
      'grantor', grantor_role.rolname,
      'privilege', grant_item.privilege_type,
      'grantable', grant_item.is_grantable
    ) as definition,
    null::text as classification_hint
  from relation_acl_source as acl
  cross join lateral pg_catalog.aclexplode(acl.effective_acl) as grant_item
  left join pg_catalog.pg_roles as grantee_role
    on grantee_role.oid = grant_item.grantee
  left join pg_catalog.pg_roles as grantor_role
    on grantor_role.oid = grant_item.grantor
),
schema_grant_rows as (
  select
    'grants'::text as section,
    namespace.nspname as schema_name,
    'schema_grant'::text as object_type,
    namespace.nspname as object_name,
    namespace.nspname || ':'
      || case when grant_item.grantee = 0 then 'PUBLIC' else grantee_role.rolname end
      || ':' || grant_item.privilege_type as identity,
    pg_catalog.jsonb_build_object(
      'grantee', case when grant_item.grantee = 0 then 'PUBLIC' else grantee_role.rolname end,
      'grantor', grantor_role.rolname,
      'privilege', grant_item.privilege_type,
      'grantable', grant_item.is_grantable
    ) as definition,
    null::text as classification_hint
  from target_namespaces as namespace
  cross join lateral pg_catalog.aclexplode(
    coalesce(namespace.nspacl, pg_catalog.acldefault('n', namespace.nspowner))
  ) as grant_item
  left join pg_catalog.pg_roles as grantee_role
    on grantee_role.oid = grant_item.grantee
  left join pg_catalog.pg_roles as grantor_role
    on grantor_role.oid = grant_item.grantor
),
function_grant_rows as (
  select
    'grants'::text as section,
    function_info.schema_name,
    'function_grant'::text as object_type,
    function_info.function_name as object_name,
    function_info.schema_name || '.' || function_info.function_name
      || '(' || function_info.identity_arguments || '):'
      || case when grant_item.grantee = 0 then 'PUBLIC' else grantee_role.rolname end
      || ':' || grant_item.privilege_type as identity,
    pg_catalog.jsonb_build_object(
      'grantee', case when grant_item.grantee = 0 then 'PUBLIC' else grantee_role.rolname end,
      'grantor', grantor_role.rolname,
      'privilege', grant_item.privilege_type,
      'grantable', grant_item.is_grantable
    ) as definition,
    null::text as classification_hint
  from function_catalog as function_info
  cross join lateral pg_catalog.aclexplode(
    case
      when function_info.proacl is null
        then pg_catalog.acldefault('f', function_info.proowner)
      else function_info.proacl
    end
  ) as grant_item
  left join pg_catalog.pg_roles as grantee_role
    on grantee_role.oid = grant_item.grantee
  left join pg_catalog.pg_roles as grantor_role
    on grantor_role.oid = grant_item.grantor
),
integration_surface_rows as (
  select
    'external_integrations'::text as section,
    coalesce(namespace.nspname, '') as schema_name,
    'integration_surface'::text as object_type,
    candidate.surface_name as object_name,
    candidate.surface_name as identity,
    pg_catalog.jsonb_build_object(
      'extension_installed', extension.oid is not null,
      'schema_exists', namespace.oid is not null,
      'relation_exists', case
        when candidate.relation_name is null then null
        else relation.oid is not null
      end,
      'function_present', case
        when candidate.function_name is null then null
        else exists (
          select 1
          from pg_catalog.pg_proc as function_info
          where function_info.pronamespace = namespace.oid
            and function_info.proname = candidate.function_name
        )
      end
    ) as definition,
    null::text as classification_hint
  from (
    values
      ('pg_cron'::text, 'cron'::text, 'job'::text, null::text),
      ('pg_net'::text, 'net'::text, null::text, 'http_post'::text)
  ) as candidate(surface_name, schema_name, relation_name, function_name)
  left join pg_catalog.pg_extension as extension
    on extension.extname = candidate.surface_name
  left join pg_catalog.pg_namespace as namespace
    on namespace.nspname = candidate.schema_name
  left join pg_catalog.pg_class as relation
    on relation.relnamespace = namespace.oid
   and relation.relname = candidate.relation_name
),
webhook_trigger_rows as (
  select
    'external_integrations'::text as section,
    trigger_info.schema_name,
    'webhook_trigger_candidate'::text as object_type,
    trigger_info.trigger_name as object_name,
    trigger_info.schema_name || '.' || trigger_info.table_name || ':' || trigger_info.trigger_name as identity,
    pg_catalog.jsonb_build_object(
      'table', trigger_info.schema_name || '.' || trigger_info.table_name,
      'function', trigger_info.function_schema || '.' || trigger_info.function_name,
      'external_integration_flag', true
    ) as definition,
    null::text as classification_hint
  from trigger_catalog as trigger_info
  where trigger_info.function_definition ~* '(pg_net|net\.|http_post|http_get|https?://|cron\.)'
),
migration_surface_rows as (
  select
    'migration_surface'::text as section,
    definition.schema_name,
    'relation'::text as object_type,
    definition.relation_name as object_name,
    definition.schema_name || '.' || definition.relation_name as identity,
    pg_catalog.jsonb_build_object(
      'relkind', definition.relkind,
      'columns', definition.columns,
      'note', 'Presence is inventory evidence only; absence does not imply unapplied migrations.'
    ) as definition,
    null::text as classification_hint
  from relation_definition as definition
  where definition.schema_name = 'supabase_migrations'
     or definition.relation_name ~* '(migration|schema_migrations|version_history)'
),
all_rows as (
  select * from schema_rows
  union all select * from installed_extension_rows
  union all select * from extension_candidate_rows
  union all select * from type_rows
  union all select * from sequence_rows
  union all select * from commercial_operations_rows
  union all select * from idempotency_surface_rows
  union all select * from function_rows
  union all select * from cas_revision_rows
  union all select * from auth_relation_rows
  union all select * from storage_relation_rows
  union all select * from storage_bucket_rows
  union all select * from trigger_rows
  union all select * from rls_rows
  union all select * from policy_rows
  union all select * from relation_grant_rows
  union all select * from schema_grant_rows
  union all select * from function_grant_rows
  union all select * from integration_surface_rows
  union all select * from webhook_trigger_rows
  union all select * from migration_surface_rows
)
select
  section,
  schema_name,
  object_type,
  object_name,
  identity,
  definition,
  classification_hint
from all_rows
order by
  section,
  schema_name,
  object_type,
  object_name,
  identity;
-- P0A.1a STAGE 2: INVENTORY END
