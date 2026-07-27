-- PropControl · B0.2-A · Inventario preliminar de producción
-- PostgreSQL 17 · estrictamente de solo lectura
--
-- IMPORTANTE:
--   1. Ejecutar primero y por separado solamente la ETAPA 1.
--   2. Ejecutar la ETAPA 2 únicamente cuando la ETAPA 1 devuelva
--      safe_to_run_inventory = true.
--   3. La ausencia de supabase_migrations no bloquea el inventario estructural.
--   4. Este archivo no es una migración y no debe moverse a supabase/migrations.

-- B0.2-A STAGE 1: PREFLIGHT BEGIN
with
required_schemas(schema_name, required_for_inventory) as (
  values
    ('pg_catalog'::text, true),
    ('public'::text, false),
    ('private'::text, false),
    ('auth'::text, false),
    ('storage'::text, true),
    ('supabase_migrations'::text, false)
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
    ('storage'::text, 'buckets'::text, true),
    ('storage'::text, 'objects'::text, false),
    ('supabase_migrations'::text, 'schema_migrations'::text, false),
    ('auth'::text, 'users'::text, false)
),
relation_status as (
  select
    expected.schema_name,
    expected.relation_name,
    expected.required_for_inventory,
    relation.oid as relation_oid,
    relation.relkind,
    relation.oid is not null
      and relation.relkind in ('r', 'p', 'v', 'm', 'f') as exists
  from required_relations as expected
  left join pg_catalog.pg_namespace as namespace
    on namespace.nspname = expected.schema_name
  left join pg_catalog.pg_class as relation
    on relation.relnamespace = namespace.oid
   and relation.relname = expected.relation_name
),
required_columns(schema_name, relation_name, column_name, required_for_inventory) as (
  values
    ('storage'::text, 'buckets'::text, 'name'::text, true),
    ('storage'::text, 'buckets'::text, 'public'::text, true),
    ('storage'::text, 'buckets'::text, 'file_size_limit'::text, true),
    ('storage'::text, 'buckets'::text, 'allowed_mime_types'::text, true),
    ('supabase_migrations'::text, 'schema_migrations'::text, 'version'::text, false)
),
column_status as (
  select
    expected.schema_name,
    expected.relation_name,
    expected.column_name,
    expected.required_for_inventory,
    attribute.attname is not null
      and attribute.attnum > 0
      and not attribute.attisdropped as exists
  from required_columns as expected
  left join pg_catalog.pg_namespace as namespace
    on namespace.nspname = expected.schema_name
  left join pg_catalog.pg_class as relation
    on relation.relnamespace = namespace.oid
   and relation.relname = expected.relation_name
  left join pg_catalog.pg_attribute as attribute
    on attribute.attrelid = relation.oid
   and attribute.attname = expected.column_name
),
required_catalog_relations(relation_name) as (
  values
    ('pg_namespace'::text),
    ('pg_class'::text),
    ('pg_attribute'::text),
    ('pg_attrdef'::text),
    ('pg_constraint'::text),
    ('pg_index'::text),
    ('pg_policy'::text),
    ('pg_proc'::text),
    ('pg_trigger'::text),
    ('pg_depend'::text),
    ('pg_roles'::text),
    ('pg_language'::text)
),
catalog_relation_status as (
  select
    expected.relation_name,
    relation.oid is not null as exists
  from required_catalog_relations as expected
  left join pg_catalog.pg_namespace as namespace
    on namespace.nspname = 'pg_catalog'
  left join pg_catalog.pg_class as relation
    on relation.relnamespace = namespace.oid
   and relation.relname = expected.relation_name
   and relation.relkind in ('r', 'v')
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
    ('pg_describe_object'::text, 3)
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
    pg_catalog.jsonb_build_object(
      'schema', schema_name,
      'relation', relation_name,
      'relkind', relkind
    )
  from relation_status

  union all

  select
    'column'::text,
    schema_name || '.' || relation_name || '.' || column_name,
    required_for_inventory,
    exists,
    pg_catalog.jsonb_build_object(
      'schema', schema_name,
      'relation', relation_name,
      'column', column_name
    )
  from column_status

  union all

  select
    'catalog_relation'::text,
    'pg_catalog.' || relation_name,
    true,
    exists,
    pg_catalog.jsonb_build_object('relation', relation_name)
  from catalog_relation_status

  union all

  select
    'catalog_function'::text,
    'pg_catalog.' || function_name,
    true,
    coalesce(exists, false),
    pg_catalog.jsonb_build_object(
      'function', function_name,
      'minimum_arguments', minimum_arguments
    )
  from catalog_function_status
),
migration_source_status as (
  select
    exists (
      select 1
      from schema_status
      where schema_name = 'supabase_migrations'
        and exists
    )
    and exists (
      select 1
      from relation_status
      where schema_name = 'supabase_migrations'
        and relation_name = 'schema_migrations'
        and exists
    )
    and exists (
      select 1
      from column_status
      where schema_name = 'supabase_migrations'
        and relation_name = 'schema_migrations'
        and column_name = 'version'
        and exists
    ) as source_available
),
preflight_summary as (
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
          'reason', 'required object is absent'
        )
        order by category, object_name
      ) filter (where required_for_inventory and not exists),
      '[]'::jsonb
    ) as blocking_findings
  from requirements
)
select pg_catalog.jsonb_build_object(
  'check', 'B0.2 production inventory preflight',
  'read_only', true,
  'catalog_only', true,
  'generated_at', pg_catalog.clock_timestamp(),
  'server_version', pg_catalog.current_setting('server_version'),
  'safe_to_run_inventory', summary.safe_to_run_inventory,
  'requirements', summary.requirements,
  'warnings', case
    when migration.source_available then '[]'::jsonb
    else pg_catalog.jsonb_build_array('migration history unavailable')
  end,
  'blocking_findings', summary.blocking_findings,
  'next_step', case
    when summary.safe_to_run_inventory
      then 'Stage 2 may be reviewed for a separately authorized execution.'
    else 'Stop. Do not execute Stage 2.'
  end
) as b0_2_production_inventory_preflight
from preflight_summary as summary
cross join migration_source_status as migration;
-- B0.2-A STAGE 1: PREFLIGHT END

-- B0.2-A STAGE 2: INVENTORY BEGIN
-- EJECUTAR ESTA ETAPA SOLAMENTE SI LA ETAPA 1 DEVOLVIÓ:
-- safe_to_run_inventory = true
with
inventory_gate as (
  select
    exists (
      select 1
      from pg_catalog.pg_namespace as namespace
      join pg_catalog.pg_class as relation
        on relation.relnamespace = namespace.oid
       and relation.relname = 'buckets'
       and relation.relkind in ('r', 'p', 'v', 'm', 'f')
      where namespace.nspname = 'storage'
    )
    and not exists (
      select 1
      from (
        values
          ('name'::text),
          ('public'::text),
          ('file_size_limit'::text),
          ('allowed_mime_types'::text)
      ) as expected(column_name)
      where not exists (
        select 1
        from pg_catalog.pg_namespace as namespace
        join pg_catalog.pg_class as relation
          on relation.relnamespace = namespace.oid
         and relation.relname = 'buckets'
        join pg_catalog.pg_attribute as attribute
          on attribute.attrelid = relation.oid
         and attribute.attname = expected.column_name
         and attribute.attnum > 0
         and not attribute.attisdropped
        where namespace.nspname = 'storage'
      )
    ) as safe_to_run_inventory
),
target_schemas(schema_name) as (
  values
    ('public'::text),
    ('private'::text),
    ('auth'::text),
    ('storage'::text),
    ('supabase_migrations'::text)
),
schema_inventory as (
  select
    target.schema_name,
    namespace.oid is not null as exists
  from target_schemas as target
  left join pg_catalog.pg_namespace as namespace
    on namespace.nspname = target.schema_name
),
target_tables(schema_name, table_name) as (
  values
    ('public'::text, 'organizations'::text),
    ('public'::text, 'organization_members'::text),
    ('public'::text, 'fichas'::text),
    ('public'::text, 'propcontrol_records'::text),
    ('public'::text, 'public_property_fichas'::text)
),
table_catalog as (
  select
    target.schema_name,
    target.table_name,
    relation.oid as relation_oid,
    relation.relkind,
    relation.relowner as owner_oid,
    case
      when relation.relowner is null then null
      else pg_catalog.pg_get_userbyid(relation.relowner)
    end as owner_name,
    relation.relrowsecurity,
    relation.relforcerowsecurity,
    relation.relacl,
    relation.oid is not null as exists
  from target_tables as target
  left join pg_catalog.pg_namespace as namespace
    on namespace.nspname = target.schema_name
  left join pg_catalog.pg_class as relation
    on relation.relnamespace = namespace.oid
   and relation.relname = target.table_name
   and relation.relkind in ('r', 'p')
),
table_columns as (
  select
    table_info.schema_name,
    table_info.table_name,
    coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'position', attribute.attnum,
          'name', attribute.attname,
          'type', pg_catalog.format_type(attribute.atttypid, attribute.atttypmod),
          'nullable', not attribute.attnotnull,
          'default', case
            when default_value.oid is null then null
            else pg_catalog.pg_get_expr(default_value.adbin, default_value.adrelid)
          end,
          'identity', nullif(attribute.attidentity, ''),
          'generated', nullif(attribute.attgenerated, '')
        )
        order by attribute.attnum
      ) filter (where attribute.attnum is not null),
      '[]'::jsonb
    ) as columns
  from table_catalog as table_info
  left join pg_catalog.pg_attribute as attribute
    on attribute.attrelid = table_info.relation_oid
   and attribute.attnum > 0
   and not attribute.attisdropped
  left join pg_catalog.pg_attrdef as default_value
    on default_value.adrelid = attribute.attrelid
   and default_value.adnum = attribute.attnum
  group by table_info.schema_name, table_info.table_name
),
table_constraints as (
  select
    table_info.schema_name,
    table_info.table_name,
    coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'name', constraint_info.conname,
          'type', case constraint_info.contype
            when 'p' then 'primary_key'
            when 'f' then 'foreign_key'
            when 'u' then 'unique'
            when 'c' then 'check'
            when 'x' then 'exclusion'
            else constraint_info.contype::text
          end,
          'definition', pg_catalog.pg_get_constraintdef(constraint_info.oid, true),
          'validated', constraint_info.convalidated,
          'deferrable', constraint_info.condeferrable,
          'initially_deferred', constraint_info.condeferred
        )
        order by constraint_info.conname
      ) filter (where constraint_info.oid is not null),
      '[]'::jsonb
    ) as constraints,
    coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'name', constraint_info.conname,
          'definition', pg_catalog.pg_get_constraintdef(constraint_info.oid, true)
        ) order by constraint_info.conname
      ) filter (where constraint_info.contype = 'p'),
      '[]'::jsonb
    ) as primary_keys,
    coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'name', constraint_info.conname,
          'definition', pg_catalog.pg_get_constraintdef(constraint_info.oid, true)
        ) order by constraint_info.conname
      ) filter (where constraint_info.contype = 'f'),
      '[]'::jsonb
    ) as foreign_keys
  from table_catalog as table_info
  left join pg_catalog.pg_constraint as constraint_info
    on constraint_info.conrelid = table_info.relation_oid
  group by table_info.schema_name, table_info.table_name
),
table_indexes as (
  select
    table_info.schema_name,
    table_info.table_name,
    coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'name', index_relation.relname,
          'unique', index_info.indisunique,
          'primary', index_info.indisprimary,
          'valid', index_info.indisvalid,
          'ready', index_info.indisready,
          'definition', pg_catalog.pg_get_indexdef(index_info.indexrelid)
        ) order by index_relation.relname
      ) filter (where index_info.indexrelid is not null),
      '[]'::jsonb
    ) as indexes
  from table_catalog as table_info
  left join pg_catalog.pg_index as index_info
    on index_info.indrelid = table_info.relation_oid
  left join pg_catalog.pg_class as index_relation
    on index_relation.oid = index_info.indexrelid
  group by table_info.schema_name, table_info.table_name
),
table_policies as (
  select
    table_info.schema_name,
    table_info.table_name,
    coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'name', policy.polname,
          'command', policy.polcmd,
          'permissive', policy.polpermissive,
          'roles', coalesce(
            (
              select pg_catalog.jsonb_agg(role_info.rolname order by role_info.rolname)
              from pg_catalog.pg_roles as role_info
              where role_info.oid = any(policy.polroles)
            ),
            '[]'::jsonb
          ),
          'using', case
            when policy.polqual is null then null
            else pg_catalog.pg_get_expr(policy.polqual, policy.polrelid)
          end,
          'with_check', case
            when policy.polwithcheck is null then null
            else pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid)
          end
        ) order by policy.polname
      ) filter (where policy.oid is not null),
      '[]'::jsonb
    ) as policies
  from table_catalog as table_info
  left join pg_catalog.pg_policy as policy
    on policy.polrelid = table_info.relation_oid
  group by table_info.schema_name, table_info.table_name
),
table_acl_source as (
  select
    table_info.schema_name,
    table_info.table_name,
    table_info.relation_oid,
    table_info.owner_oid,
    case
      when table_info.relation_oid is null or table_info.owner_oid is null
        then null::aclitem[]
      when table_info.relacl is null
        then pg_catalog.acldefault('r', table_info.owner_oid)
      else table_info.relacl
    end as effective_acl
  from table_catalog as table_info
),
table_grants as (
  select
    acl_source.schema_name,
    acl_source.table_name,
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
        ) order by
          case when grant_item.grantee = 0 then 'PUBLIC' else grantee_role.rolname end,
          grant_item.privilege_type
      ) filter (where grant_item.privilege_type is not null),
      '[]'::jsonb
    ) as grants
  from table_acl_source as acl_source
  left join lateral pg_catalog.aclexplode(acl_source.effective_acl) as grant_item
    on acl_source.effective_acl is not null
  left join pg_catalog.pg_roles as grantee_role
    on grantee_role.oid = grant_item.grantee
  left join pg_catalog.pg_roles as grantor_role
    on grantor_role.oid = grant_item.grantor
  group by acl_source.schema_name, acl_source.table_name
),
tables_json as (
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'schema', table_info.schema_name,
        'name', table_info.table_name,
        'exists', table_info.exists,
        'relation_kind', table_info.relkind,
        'owner', table_info.owner_name,
        'rls_enabled', coalesce(table_info.relrowsecurity, false),
        'rls_forced', coalesce(table_info.relforcerowsecurity, false),
        'columns', table_columns.columns,
        'primary_keys', table_constraints.primary_keys,
        'foreign_keys', table_constraints.foreign_keys,
        'constraints', table_constraints.constraints,
        'indexes', table_indexes.indexes,
        'policies', table_policies.policies,
        'grants', table_grants.grants
      ) order by table_info.schema_name, table_info.table_name
    ),
    '[]'::jsonb
  ) as value
  from table_catalog as table_info
  join table_columns using (schema_name, table_name)
  join table_constraints using (schema_name, table_name)
  join table_indexes using (schema_name, table_name)
  join table_policies using (schema_name, table_name)
  join table_grants using (schema_name, table_name)
),
target_functions(schema_name, function_name) as (
  values
    ('private'::text, 'is_active_org_member'::text),
    ('private'::text, 'org_member_role'::text),
    ('private'::text, 'org_member_number'::text),
    ('private'::text, 'can_access_property_photo'::text),
    ('public'::text, 'activate_my_organization_memberships'::text),
    ('public'::text, 'is_org_member'::text),
    ('public'::text, 'can_manage_public_property_ficha'::text),
    ('public'::text, 'handle_new_propcontrol_user'::text),
    ('public'::text, 'protect_propcontrol_record_identity'::text)
),
function_catalog as (
  select
    target.schema_name,
    target.function_name,
    function_info.oid as function_oid,
    function_info.proowner as owner_oid,
    function_info.proacl,
    function_info.provolatile,
    function_info.prosecdef,
    function_info.proconfig,
    language.lanname as language_name,
    case
      when function_info.proowner is null then null
      else pg_catalog.pg_get_userbyid(function_info.proowner)
    end as owner_name,
    case
      when function_info.oid is null then null
      else pg_catalog.pg_get_function_identity_arguments(function_info.oid)
    end as identity_arguments,
    case
      when function_info.oid is null then null
      else pg_catalog.pg_get_function_arguments(function_info.oid)
    end as arguments,
    case
      when function_info.oid is null then null
      else pg_catalog.pg_get_function_result(function_info.oid)
    end as return_type,
    case
      when function_info.oid is null then null
      else pg_catalog.regexp_replace(
        pg_catalog.pg_get_functiondef(function_info.oid),
        '[[:space:]]+',
        ' ',
        'g'
      )
    end as normalized_definition
  from target_functions as target
  left join pg_catalog.pg_namespace as namespace
    on namespace.nspname = target.schema_name
  left join pg_catalog.pg_proc as function_info
    on function_info.pronamespace = namespace.oid
   and function_info.proname = target.function_name
  left join pg_catalog.pg_language as language
    on language.oid = function_info.prolang
),
function_dependencies as (
  select
    function_info.schema_name,
    function_info.function_name,
    function_info.function_oid,
    coalesce(
      pg_catalog.jsonb_agg(
        distinct pg_catalog.pg_describe_object(
          dependency.refclassid,
          dependency.refobjid,
          dependency.refobjsubid
        )
      ) filter (where dependency.refobjid is not null),
      '[]'::jsonb
    ) as dependencies
  from function_catalog as function_info
  left join pg_catalog.pg_depend as dependency
    on dependency.classid = 'pg_catalog.pg_proc'::regclass
   and dependency.objid = function_info.function_oid
   and dependency.deptype in ('n', 'a', 'i')
  group by
    function_info.schema_name,
    function_info.function_name,
    function_info.function_oid
),
function_acl_source as (
  select
    function_info.schema_name,
    function_info.function_name,
    function_info.function_oid,
    function_info.owner_oid,
    case
      when function_info.function_oid is null or function_info.owner_oid is null
        then null::aclitem[]
      when function_info.proacl is null
        then pg_catalog.acldefault('f', function_info.owner_oid)
      else function_info.proacl
    end as effective_acl
  from function_catalog as function_info
),
function_grants as (
  select
    acl_source.schema_name,
    acl_source.function_name,
    acl_source.function_oid,
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
        ) order by
          case when grant_item.grantee = 0 then 'PUBLIC' else grantee_role.rolname end,
          grant_item.privilege_type
      ) filter (where grant_item.privilege_type is not null),
      '[]'::jsonb
    ) as execute_grants
  from function_acl_source as acl_source
  left join lateral pg_catalog.aclexplode(acl_source.effective_acl) as grant_item
    on acl_source.effective_acl is not null
  left join pg_catalog.pg_roles as grantee_role
    on grantee_role.oid = grant_item.grantee
  left join pg_catalog.pg_roles as grantor_role
    on grantor_role.oid = grant_item.grantor
  group by
    acl_source.schema_name,
    acl_source.function_name,
    acl_source.function_oid
),
functions_json as (
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'schema', function_info.schema_name,
        'name', function_info.function_name,
        'exists', function_info.function_oid is not null,
        'signature', case
          when function_info.function_oid is null then null
          else function_info.schema_name || '.' || function_info.function_name
            || '(' || function_info.identity_arguments || ')'
        end,
        'identity_arguments', function_info.identity_arguments,
        'arguments', function_info.arguments,
        'return_type', function_info.return_type,
        'language', function_info.language_name,
        'volatility', case function_info.provolatile
          when 'i' then 'immutable'
          when 's' then 'stable'
          when 'v' then 'volatile'
          else null
        end,
        'security', case
          when function_info.function_oid is null then null
          when function_info.prosecdef then 'definer'
          else 'invoker'
        end,
        'search_path', function_info.proconfig,
        'owner', function_info.owner_name,
        'execute_grants', function_grants.execute_grants,
        'normalized_definition', function_info.normalized_definition,
        'dependencies', function_dependencies.dependencies
      ) order by
        function_info.schema_name,
        function_info.function_name,
        function_info.identity_arguments nulls first
    ),
    '[]'::jsonb
  ) as value
  from function_catalog as function_info
  left join function_dependencies
    on function_dependencies.schema_name = function_info.schema_name
   and function_dependencies.function_name = function_info.function_name
   and function_dependencies.function_oid is not distinct from function_info.function_oid
  left join function_grants
    on function_grants.schema_name = function_info.schema_name
   and function_grants.function_name = function_info.function_name
   and function_grants.function_oid is not distinct from function_info.function_oid
),
trigger_targets as (
  select relation_oid
  from table_catalog
  where relation_oid is not null

  union

  select relation.oid
  from pg_catalog.pg_namespace as namespace
  join pg_catalog.pg_class as relation
    on relation.relnamespace = namespace.oid
  where namespace.nspname = 'auth'
    and relation.relname = 'users'
),
trigger_inventory as (
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'schema', relation_namespace.nspname,
        'table', relation.relname,
        'name', trigger_info.tgname,
        'linked_function', function_namespace.nspname || '.' || function_info.proname,
        'timing', case
          when (trigger_info.tgtype & 2) <> 0 then 'before'
          when (trigger_info.tgtype & 64) <> 0 then 'instead_of'
          else 'after'
        end,
        'events', pg_catalog.jsonb_build_array(
          case when (trigger_info.tgtype & 4) <> 0 then 'insert' end,
          case when (trigger_info.tgtype & 8) <> 0 then 'delete' end,
          case when (trigger_info.tgtype & 16) <> 0 then 'update' end,
          case when (trigger_info.tgtype & 32) <> 0 then 'truncate' end
        ),
        'level', case when (trigger_info.tgtype & 1) <> 0 then 'row' else 'statement' end,
        'enabled_state', trigger_info.tgenabled,
        'definition', pg_catalog.pg_get_triggerdef(trigger_info.oid, true)
      ) order by relation_namespace.nspname, relation.relname, trigger_info.tgname
    ) filter (where trigger_info.oid is not null),
    '[]'::jsonb
  ) as value
  from trigger_targets as target
  join pg_catalog.pg_trigger as trigger_info
    on trigger_info.tgrelid = target.relation_oid
   and not trigger_info.tgisinternal
  join pg_catalog.pg_class as relation
    on relation.oid = trigger_info.tgrelid
  join pg_catalog.pg_namespace as relation_namespace
    on relation_namespace.oid = relation.relnamespace
  join pg_catalog.pg_proc as function_info
    on function_info.oid = trigger_info.tgfoid
  join pg_catalog.pg_namespace as function_namespace
    on function_namespace.oid = function_info.pronamespace
  where relation_namespace.nspname <> 'auth'
     or relation.relname <> 'users'
     or trigger_info.tgname = 'on_propcontrol_user_created'
),
rls_inventory as (
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'schema', schema_name,
        'table', table_name,
        'exists', exists,
        'enabled', coalesce(relrowsecurity, false),
        'forced', coalesce(relforcerowsecurity, false)
      ) order by schema_name, table_name
    ),
    '[]'::jsonb
  ) as value
  from table_catalog
),
policy_inventory as (
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'schema', namespace.nspname,
        'table', relation.relname,
        'name', policy.polname,
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
      ) order by namespace.nspname, relation.relname, policy.polname
    ) filter (where policy.oid is not null),
    '[]'::jsonb
  ) as value
  from pg_catalog.pg_policy as policy
  join pg_catalog.pg_class as relation
    on relation.oid = policy.polrelid
  join pg_catalog.pg_namespace as namespace
    on namespace.oid = relation.relnamespace
  where policy.polrelid in (
    select relation_oid
    from table_catalog
    where relation_oid is not null

    union

    select relation.oid
    from pg_catalog.pg_namespace as namespace_filter
    join pg_catalog.pg_class as relation
      on relation.relnamespace = namespace_filter.oid
    where namespace_filter.nspname = 'storage'
      and relation.relname = 'objects'
  )
),
grants_inventory as (
  select pg_catalog.jsonb_build_object(
    'tables', coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'schema', schema_name,
            'table', table_name,
            'grants', grants
          ) order by schema_name, table_name
        )
        from table_grants
      ),
      '[]'::jsonb
    ),
    'functions', coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'schema', schema_name,
            'function', function_name,
            'function_oid_present', function_oid is not null,
            'execute_grants', execute_grants
          ) order by schema_name, function_name, function_oid nulls first
        )
        from function_grants
      ),
      '[]'::jsonb
    )
  ) as value
),
storage_buckets_inventory as (
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'name', bucket.name,
        'public', bucket.public,
        'file_size_limit', bucket.file_size_limit,
        'allowed_mime_types', bucket.allowed_mime_types
      ) order by bucket.name
    ),
    '[]'::jsonb
  ) as value
  from storage.buckets as bucket
  cross join inventory_gate as gate
  where gate.safe_to_run_inventory
),
storage_objects_policies as (
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'name', policy.polname,
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
      ) order by policy.polname
    ) filter (where policy.oid is not null),
    '[]'::jsonb
  ) as value
  from pg_catalog.pg_namespace as namespace
  join pg_catalog.pg_class as relation
    on relation.relnamespace = namespace.oid
   and relation.relname = 'objects'
  left join pg_catalog.pg_policy as policy
    on policy.polrelid = relation.oid
  where namespace.nspname = 'storage'
),
migration_source_status as (
  select
    exists (
      select 1
      from pg_catalog.pg_namespace as namespace
      join pg_catalog.pg_class as relation
        on relation.relnamespace = namespace.oid
       and relation.relname = 'schema_migrations'
       and relation.relkind in ('r', 'p', 'v', 'm', 'f')
      join pg_catalog.pg_attribute as attribute
        on attribute.attrelid = relation.oid
       and attribute.attname = 'version'
       and attribute.attnum > 0
       and not attribute.attisdropped
      where namespace.nspname = 'supabase_migrations'
    ) as source_available
),
migration_history_inventory as (
  select case
    when source_available then pg_catalog.jsonb_build_object(
      'source_available', true,
      'status', 'available_not_read',
      'registered_versions', '[]'::jsonb,
      'missing_expected_versions', '[]'::jsonb,
      'unrecognized_versions', '[]'::jsonb,
      'warning', 'supabase_migrations.schema_migrations exists but row data is not read by this static inventory'
    )
    else pg_catalog.jsonb_build_object(
      'source_available', false,
      'status', 'unavailable',
      'registered_versions', '[]'::jsonb,
      'missing_expected_versions', '[]'::jsonb,
      'unrecognized_versions', '[]'::jsonb,
      'warning', 'supabase_migrations.schema_migrations is not available in this production database'
    )
  end as value
  from migration_source_status
),
expected_objects as (
  select
    'table'::text as object_type,
    'public.user_profiles'::text as object_name,
    exists (
      select 1
      from pg_catalog.pg_namespace as namespace
      join pg_catalog.pg_class as relation
        on relation.relnamespace = namespace.oid
      where namespace.nspname = 'public'
        and relation.relname = 'user_profiles'
        and relation.relkind in ('r', 'p')
    ) as exists

  union all

  select
    'table'::text,
    'public.organization_settings'::text,
    exists (
      select 1
      from pg_catalog.pg_namespace as namespace
      join pg_catalog.pg_class as relation
        on relation.relnamespace = namespace.oid
      where namespace.nspname = 'public'
        and relation.relname = 'organization_settings'
        and relation.relkind in ('r', 'p')
    )

  union all

  select
    'bucket'::text,
    'profile-avatars'::text,
    exists (
      select 1
      from storage.buckets as bucket
      cross join inventory_gate as gate
      where gate.safe_to_run_inventory
        and bucket.name = 'profile-avatars'
    )
),
expected_objects_missing as (
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'type', object_type,
        'name', object_name
      ) order by object_type, object_name
    ) filter (where not exists),
    '[]'::jsonb
  ) as value
  from expected_objects
),
warning_inventory as (
  select coalesce(
    pg_catalog.jsonb_agg(message order by message),
    '[]'::jsonb
  ) as value
  from (
    select 'Expected later-phase object is absent: ' || object_name as message
    from expected_objects
    where not exists

    union all

    select 'migration history unavailable'
    from migration_source_status
    where not source_available
  ) as warnings
),
blocking_inventory as (
  select coalesce(
    pg_catalog.jsonb_agg(message order by message),
    '[]'::jsonb
  ) as value
  from (
    select 'Stage 2 preflight revalidation failed.' as message
    from inventory_gate
    where not safe_to_run_inventory

    union all

    select 'Required table is absent: ' || schema_name || '.' || table_name
    from table_catalog
    where not exists

    union all

    select 'RLS is disabled on existing table: ' || schema_name || '.' || table_name
    from table_catalog
    where exists and not relrowsecurity

    union all

    select 'Required function is absent: ' || schema_name || '.' || function_name
    from function_catalog
    group by schema_name, function_name
    having pg_catalog.bool_and(function_oid is null)
  ) as findings
),
final_inventory as (
  select pg_catalog.jsonb_build_object(
    'check', 'B0.2 production schema inventory',
    'read_only', true,
    'generated_at', pg_catalog.clock_timestamp(),
    'server_version', pg_catalog.current_setting('server_version'),
    'preflight_revalidated', gate.safe_to_run_inventory,
    'schemas', (
      select coalesce(
        pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'name', schema_name,
            'exists', exists
          ) order by schema_name
        ),
        '[]'::jsonb
      )
      from schema_inventory
    ),
    'tables', tables_json.value,
    'functions', functions_json.value,
    'triggers', trigger_inventory.value,
    'rls', rls_inventory.value,
    'policies', policy_inventory.value,
    'grants', grants_inventory.value,
    'storage_buckets', storage_buckets_inventory.value,
    'storage_objects_policies', storage_objects_policies.value,
    'migration_history', migration_history_inventory.value,
    'expected_objects_missing', expected_objects_missing.value,
    'warnings', warning_inventory.value,
    'blocking_findings', blocking_inventory.value
  ) as b0_2_production_inventory
  from inventory_gate as gate
  cross join tables_json
  cross join functions_json
  cross join trigger_inventory
  cross join rls_inventory
  cross join policy_inventory
  cross join grants_inventory
  cross join storage_buckets_inventory
  cross join storage_objects_policies
  cross join migration_history_inventory
  cross join expected_objects_missing
  cross join warning_inventory
  cross join blocking_inventory
  where gate.safe_to_run_inventory
)
select b0_2_production_inventory
from final_inventory;
-- B0.2-A STAGE 2: INVENTORY END
