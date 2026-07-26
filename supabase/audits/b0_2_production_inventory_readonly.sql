-- PropControl · B0.2-A · Inventario preliminar de producción
-- Consulta catalogal de solo lectura. No ejecuta las funciones inspeccionadas.

with
target_tables(schema_name, table_name) as (
  values
    ('public'::text, 'organizations'::text),
    ('public'::text, 'organization_members'::text),
    ('public'::text, 'fichas'::text),
    ('public'::text, 'propcontrol_records'::text),
    ('public'::text, 'public_property_fichas'::text)
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
schema_targets(schema_name) as (
  values
    ('public'::text),
    ('private'::text),
    ('auth'::text),
    ('storage'::text),
    ('supabase_migrations'::text)
),
expected_migrations(version) as (
  values
    ('20260713'::text),
    ('20260715093000'::text),
    ('20260716103000'::text),
    ('20260716103100'::text),
    ('20260717113000'::text),
    ('20260717190000'::text),
    ('20260724190000'::text)
),
schema_rows as (
  select
    st.schema_name,
    n.oid is not null as object_exists,
    owner_role.rolname as owner_name
  from schema_targets as st
  left join pg_catalog.pg_namespace as n
    on n.nspname = st.schema_name
  left join pg_catalog.pg_roles as owner_role
    on owner_role.oid = n.nspowner
),
schemas_inventory as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'schema', schema_name,
        'exists', object_exists,
        'owner', owner_name
      )
      order by schema_name
    ),
    '[]'::jsonb
  ) as value
  from schema_rows
),
target_relations as (
  select
    tt.schema_name,
    tt.table_name,
    c.oid as object_oid,
    c.relkind,
    c.relowner as owner_oid,
    owner_role.rolname as owner_name,
    c.relrowsecurity,
    c.relforcerowsecurity,
    c.relacl
  from target_tables as tt
  left join pg_catalog.pg_namespace as n
    on n.nspname = tt.schema_name
  left join pg_catalog.pg_class as c
    on c.relnamespace = n.oid
   and c.relname = tt.table_name
   and c.relkind in ('r', 'p', 'v', 'm', 'f')
  left join pg_catalog.pg_roles as owner_role
    on owner_role.oid = c.relowner
),
table_columns as (
  select
    tr.schema_name,
    tr.table_name,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'position', a.attnum,
          'name', a.attname,
          'type', pg_catalog.format_type(a.atttypid, a.atttypmod),
          'nullable', not a.attnotnull,
          'default', pg_catalog.pg_get_expr(ad.adbin, ad.adrelid),
          'identity', nullif(a.attidentity, ''),
          'generated', nullif(a.attgenerated, '')
        )
        order by a.attnum
      ) filter (where a.attnum is not null),
      '[]'::jsonb
    ) as columns
  from target_relations as tr
  left join pg_catalog.pg_attribute as a
    on a.attrelid = tr.object_oid
   and a.attnum > 0
   and not a.attisdropped
  left join pg_catalog.pg_attrdef as ad
    on ad.adrelid = a.attrelid
   and ad.adnum = a.attnum
  group by tr.schema_name, tr.table_name
),
table_constraints as (
  select
    tr.schema_name,
    tr.table_name,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'name', con.conname,
          'type', case con.contype
            when 'p' then 'PRIMARY KEY'
            when 'f' then 'FOREIGN KEY'
            when 'u' then 'UNIQUE'
            when 'c' then 'CHECK'
            when 'x' then 'EXCLUSION'
            when 'n' then 'NOT NULL'
            else con.contype::text
          end,
          'definition', pg_catalog.pg_get_constraintdef(con.oid, true),
          'validated', con.convalidated,
          'deferrable', con.condeferrable,
          'initially_deferred', con.condeferred,
          'referenced_table', case
            when con.contype = 'f' then con.confrelid::pg_catalog.regclass::text
            else null
          end
        )
        order by con.contype, con.conname
      ) filter (where con.oid is not null),
      '[]'::jsonb
    ) as constraints,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'name', con.conname,
          'definition', pg_catalog.pg_get_constraintdef(con.oid, true)
        )
        order by con.conname
      ) filter (where con.contype = 'p'),
      '[]'::jsonb
    ) as primary_keys,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'name', con.conname,
          'definition', pg_catalog.pg_get_constraintdef(con.oid, true),
          'referenced_table', con.confrelid::pg_catalog.regclass::text
        )
        order by con.conname
      ) filter (where con.contype = 'f'),
      '[]'::jsonb
    ) as foreign_keys
  from target_relations as tr
  left join pg_catalog.pg_constraint as con
    on con.conrelid = tr.object_oid
  group by tr.schema_name, tr.table_name
),
table_indexes as (
  select
    tr.schema_name,
    tr.table_name,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'name', index_relation.relname,
          'definition', pg_catalog.pg_get_indexdef(index_relation.oid),
          'primary', index_metadata.indisprimary,
          'unique', index_metadata.indisunique,
          'valid', index_metadata.indisvalid,
          'ready', index_metadata.indisready,
          'live', index_metadata.indislive
        )
        order by index_relation.relname
      ) filter (where index_relation.oid is not null),
      '[]'::jsonb
    ) as indexes
  from target_relations as tr
  left join pg_catalog.pg_index as index_metadata
    on index_metadata.indrelid = tr.object_oid
  left join pg_catalog.pg_class as index_relation
    on index_relation.oid = index_metadata.indexrelid
  group by tr.schema_name, tr.table_name
),
table_policies as (
  select
    tr.schema_name,
    tr.table_name,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'name', pol.polname,
          'command', case pol.polcmd
            when '*' then 'ALL'
            when 'r' then 'SELECT'
            when 'a' then 'INSERT'
            when 'w' then 'UPDATE'
            when 'd' then 'DELETE'
            else pol.polcmd::text
          end,
          'permissive', pol.polpermissive,
          'roles', coalesce(
            (
              select jsonb_agg(
                case
                  when role_item.role_oid = 0 then 'PUBLIC'
                  else coalesce(policy_role.rolname, role_item.role_oid::text)
                end
                order by role_item.role_oid
              )
              from unnest(pol.polroles) as role_item(role_oid)
              left join pg_catalog.pg_roles as policy_role
                on policy_role.oid = role_item.role_oid
            ),
            '[]'::jsonb
          ),
          'using', pg_catalog.pg_get_expr(pol.polqual, pol.polrelid),
          'with_check', pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid)
        )
        order by pol.polname
      ) filter (where pol.oid is not null),
      '[]'::jsonb
    ) as policies
  from target_relations as tr
  left join pg_catalog.pg_policy as pol
    on pol.polrelid = tr.object_oid
  group by tr.schema_name, tr.table_name
),
table_grants as (
  select
    tr.schema_name,
    tr.table_name,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'grantee', case
            when acl.grantee = 0 then 'PUBLIC'
            else coalesce(grantee_role.rolname, acl.grantee::text)
          end,
          'privilege', acl.privilege_type,
          'grantable', acl.is_grantable,
          'grantor', coalesce(grantor_role.rolname, acl.grantor::text)
        )
        order by
          case
            when acl.grantee = 0 then 'PUBLIC'
            else coalesce(grantee_role.rolname, acl.grantee::text)
          end,
          acl.privilege_type
      ) filter (where acl.grantee is not null),
      '[]'::jsonb
    ) as grants
  from target_relations as tr
  left join lateral pg_catalog.aclexplode(
    coalesce(tr.relacl, pg_catalog.acldefault('r', tr.owner_oid))
  ) as acl
    on tr.object_oid is not null
  left join pg_catalog.pg_roles as grantee_role
    on grantee_role.oid = acl.grantee
  left join pg_catalog.pg_roles as grantor_role
    on grantor_role.oid = acl.grantor
  group by tr.schema_name, tr.table_name
),
tables_inventory as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'schema', tr.schema_name,
        'table', tr.table_name,
        'exists', tr.object_oid is not null,
        'relation_kind', case tr.relkind
          when 'r' then 'table'
          when 'p' then 'partitioned_table'
          when 'v' then 'view'
          when 'm' then 'materialized_view'
          when 'f' then 'foreign_table'
          else null
        end,
        'owner', tr.owner_name,
        'columns', tc.columns,
        'primary_keys', tcon.primary_keys,
        'foreign_keys', tcon.foreign_keys,
        'constraints', tcon.constraints,
        'indexes', ti.indexes,
        'rls_enabled', coalesce(tr.relrowsecurity, false),
        'rls_forced', coalesce(tr.relforcerowsecurity, false),
        'policies', tp.policies,
        'grants', tg.grants
      )
      order by tr.schema_name, tr.table_name
    ),
    '[]'::jsonb
  ) as value
  from target_relations as tr
  join table_columns as tc
    using (schema_name, table_name)
  join table_constraints as tcon
    using (schema_name, table_name)
  join table_indexes as ti
    using (schema_name, table_name)
  join table_policies as tp
    using (schema_name, table_name)
  join table_grants as tg
    using (schema_name, table_name)
),
rls_inventory as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'schema', schema_name,
        'table', table_name,
        'exists', object_oid is not null,
        'enabled', coalesce(relrowsecurity, false),
        'forced', coalesce(relforcerowsecurity, false)
      )
      order by schema_name, table_name
    ),
    '[]'::jsonb
  ) as value
  from target_relations
),
main_policies_inventory as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'schema', schema_name,
        'table', table_name,
        'policies', policies
      )
      order by schema_name, table_name
    ),
    '[]'::jsonb
  ) as value
  from table_policies
),
main_grants_inventory as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'schema', schema_name,
        'table', table_name,
        'grants', grants
      )
      order by schema_name, table_name
    ),
    '[]'::jsonb
  ) as value
  from table_grants
),
function_rows as (
  select
    tf.schema_name,
    tf.function_name,
    p.oid as object_oid,
    p.proowner as owner_oid,
    owner_role.rolname as owner_name,
    p.proacl,
    p.prosecdef,
    p.provolatile,
    p.proconfig,
    p.prolang,
    language_row.lanname
  from target_functions as tf
  left join pg_catalog.pg_namespace as n
    on n.nspname = tf.schema_name
  left join pg_catalog.pg_proc as p
    on p.pronamespace = n.oid
   and p.proname = tf.function_name
  left join pg_catalog.pg_roles as owner_role
    on owner_role.oid = p.proowner
  left join pg_catalog.pg_language as language_row
    on language_row.oid = p.prolang
),
function_dependencies as (
  select
    fr.object_oid,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'dependency_type', case dependency.deptype
            when 'n' then 'normal'
            when 'a' then 'automatic'
            when 'i' then 'internal'
            when 'e' then 'extension'
            when 'p' then 'pinned'
            else dependency.deptype::text
          end,
          'referenced_object', case
            when dependency.refclassid = 'pg_catalog.pg_class'::pg_catalog.regclass then
              pg_catalog.quote_ident(class_namespace.nspname)
              || '.'
              || pg_catalog.quote_ident(class_object.relname)
            when dependency.refclassid = 'pg_catalog.pg_proc'::pg_catalog.regclass then
              pg_catalog.quote_ident(proc_namespace.nspname)
              || '.'
              || pg_catalog.quote_ident(proc_object.proname)
              || '('
              || pg_catalog.pg_get_function_identity_arguments(proc_object.oid)
              || ')'
            when dependency.refclassid = 'pg_catalog.pg_type'::pg_catalog.regclass then
              pg_catalog.quote_ident(type_namespace.nspname)
              || '.'
              || pg_catalog.quote_ident(type_object.typname)
            when dependency.refclassid = 'pg_catalog.pg_namespace'::pg_catalog.regclass then
              pg_catalog.quote_ident(namespace_object.nspname)
            when dependency.refclassid = 'pg_catalog.pg_extension'::pg_catalog.regclass then
              extension_object.extname
            when dependency.refclassid = 'pg_catalog.pg_language'::pg_catalog.regclass then
              language_object.lanname
            else dependency.refclassid::pg_catalog.regclass::text
              || ':'
              || dependency.refobjid::text
          end
        )
        order by dependency.refclassid, dependency.refobjid, dependency.refobjsubid
      ) filter (where dependency.objid is not null),
      '[]'::jsonb
    ) as dependencies
  from function_rows as fr
  left join pg_catalog.pg_depend as dependency
    on dependency.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass
   and dependency.objid = fr.object_oid
  left join pg_catalog.pg_class as class_object
    on dependency.refclassid = 'pg_catalog.pg_class'::pg_catalog.regclass
   and class_object.oid = dependency.refobjid
  left join pg_catalog.pg_namespace as class_namespace
    on class_namespace.oid = class_object.relnamespace
  left join pg_catalog.pg_proc as proc_object
    on dependency.refclassid = 'pg_catalog.pg_proc'::pg_catalog.regclass
   and proc_object.oid = dependency.refobjid
  left join pg_catalog.pg_namespace as proc_namespace
    on proc_namespace.oid = proc_object.pronamespace
  left join pg_catalog.pg_type as type_object
    on dependency.refclassid = 'pg_catalog.pg_type'::pg_catalog.regclass
   and type_object.oid = dependency.refobjid
  left join pg_catalog.pg_namespace as type_namespace
    on type_namespace.oid = type_object.typnamespace
  left join pg_catalog.pg_namespace as namespace_object
    on dependency.refclassid = 'pg_catalog.pg_namespace'::pg_catalog.regclass
   and namespace_object.oid = dependency.refobjid
  left join pg_catalog.pg_extension as extension_object
    on dependency.refclassid = 'pg_catalog.pg_extension'::pg_catalog.regclass
   and extension_object.oid = dependency.refobjid
  left join pg_catalog.pg_language as language_object
    on dependency.refclassid = 'pg_catalog.pg_language'::pg_catalog.regclass
   and language_object.oid = dependency.refobjid
  group by fr.object_oid
),
function_grants as (
  select
    fr.object_oid,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'grantee', case
            when acl.grantee = 0 then 'PUBLIC'
            else coalesce(grantee_role.rolname, acl.grantee::text)
          end,
          'privilege', acl.privilege_type,
          'grantable', acl.is_grantable,
          'grantor', coalesce(grantor_role.rolname, acl.grantor::text)
        )
        order by
          case
            when acl.grantee = 0 then 'PUBLIC'
            else coalesce(grantee_role.rolname, acl.grantee::text)
          end,
          acl.privilege_type
      ) filter (where acl.grantee is not null),
      '[]'::jsonb
    ) as grants
  from function_rows as fr
  left join lateral pg_catalog.aclexplode(
    coalesce(fr.proacl, pg_catalog.acldefault('f', fr.owner_oid))
  ) as acl
    on fr.object_oid is not null
  left join pg_catalog.pg_roles as grantee_role
    on grantee_role.oid = acl.grantee
  left join pg_catalog.pg_roles as grantor_role
    on grantor_role.oid = acl.grantor
  group by fr.object_oid
),
functions_inventory as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'schema', target.schema_name,
        'function', target.function_name,
        'exists', exists (
          select 1
          from function_rows as found
          where found.schema_name = target.schema_name
            and found.function_name = target.function_name
            and found.object_oid is not null
        ),
        'overloads', coalesce(
          (
            select jsonb_agg(
              jsonb_build_object(
                'signature',
                  pg_catalog.quote_ident(target.schema_name)
                  || '.'
                  || pg_catalog.quote_ident(target.function_name)
                  || '('
                  || pg_catalog.pg_get_function_identity_arguments(found.object_oid)
                  || ')',
                'arguments', pg_catalog.pg_get_function_arguments(found.object_oid),
                'return_type', pg_catalog.pg_get_function_result(found.object_oid),
                'language', found.lanname,
                'volatility', case found.provolatile
                  when 'i' then 'immutable'
                  when 's' then 'stable'
                  when 'v' then 'volatile'
                  else found.provolatile::text
                end,
                'security', case
                  when found.prosecdef then 'DEFINER'
                  else 'INVOKER'
                end,
                'search_path', (
                  select replace(config_item, 'search_path=', '')
                  from unnest(found.proconfig) as config_item
                  where config_item like 'search_path=%'
                  limit 1
                ),
                'owner', found.owner_name,
                'execute_grants', grants.grants,
                'definition', pg_catalog.regexp_replace(
                  pg_catalog.pg_get_functiondef(found.object_oid),
                  E'[\\n\\r\\t ]+',
                  ' ',
                  'g'
                ),
                'dependencies', dependencies.dependencies
              )
              order by pg_catalog.pg_get_function_identity_arguments(found.object_oid)
            )
            from function_rows as found
            left join function_grants as grants
              on grants.object_oid = found.object_oid
            left join function_dependencies as dependencies
              on dependencies.object_oid = found.object_oid
            where found.schema_name = target.schema_name
              and found.function_name = target.function_name
              and found.object_oid is not null
          ),
          '[]'::jsonb
        )
      )
      order by target.schema_name, target.function_name
    ),
    '[]'::jsonb
  ) as value
  from target_functions as target
),
function_grants_inventory as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'signature',
          pg_catalog.quote_ident(fr.schema_name)
          || '.'
          || pg_catalog.quote_ident(fr.function_name)
          || '('
          || pg_catalog.pg_get_function_identity_arguments(fr.object_oid)
          || ')',
        'grants', fg.grants
      )
      order by fr.schema_name, fr.function_name,
        pg_catalog.pg_get_function_identity_arguments(fr.object_oid)
    ) filter (where fr.object_oid is not null),
    '[]'::jsonb
  ) as value
  from function_rows as fr
  left join function_grants as fg
    on fg.object_oid = fr.object_oid
),
main_trigger_rows as (
  select
    table_namespace.nspname as schema_name,
    table_object.relname as table_name,
    trigger_object.tgname as trigger_name,
    case
      when (trigger_object.tgtype & 64) = 64 then 'INSTEAD OF'
      when (trigger_object.tgtype & 2) = 2 then 'BEFORE'
      else 'AFTER'
    end as timing,
    to_jsonb(
      array_remove(
        array[
          case when (trigger_object.tgtype & 4) = 4 then 'INSERT' end,
          case when (trigger_object.tgtype & 16) = 16 then 'UPDATE' end,
          case when (trigger_object.tgtype & 8) = 8 then 'DELETE' end,
          case when (trigger_object.tgtype & 32) = 32 then 'TRUNCATE' end
        ]::text[],
        null
      )
    ) as events,
    case
      when (trigger_object.tgtype & 1) = 1 then 'ROW'
      else 'STATEMENT'
    end as level,
    case trigger_object.tgenabled
      when 'O' then 'origin'
      when 'D' then 'disabled'
      when 'R' then 'replica'
      when 'A' then 'always'
      else trigger_object.tgenabled::text
    end as enabled_state,
    pg_catalog.quote_ident(function_namespace.nspname)
      || '.'
      || pg_catalog.quote_ident(function_object.proname)
      || '('
      || pg_catalog.pg_get_function_identity_arguments(function_object.oid)
      || ')' as linked_function,
    pg_catalog.pg_get_triggerdef(trigger_object.oid, true) as definition
  from target_relations as relation_target
  join pg_catalog.pg_class as table_object
    on table_object.oid = relation_target.object_oid
  join pg_catalog.pg_namespace as table_namespace
    on table_namespace.oid = table_object.relnamespace
  join pg_catalog.pg_trigger as trigger_object
    on trigger_object.tgrelid = table_object.oid
   and not trigger_object.tgisinternal
  join pg_catalog.pg_proc as function_object
    on function_object.oid = trigger_object.tgfoid
  join pg_catalog.pg_namespace as function_namespace
    on function_namespace.oid = function_object.pronamespace
),
main_triggers_inventory as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'schema', schema_name,
        'table', table_name,
        'trigger', trigger_name,
        'timing', timing,
        'events', events,
        'level', level,
        'enabled', enabled_state,
        'function', linked_function,
        'definition', definition
      )
      order by schema_name, table_name, trigger_name
    ),
    '[]'::jsonb
  ) as value
  from main_trigger_rows
),
auth_trigger_rows as (
  select
    trigger_object.tgname as trigger_name,
    case
      when (trigger_object.tgtype & 64) = 64 then 'INSTEAD OF'
      when (trigger_object.tgtype & 2) = 2 then 'BEFORE'
      else 'AFTER'
    end as timing,
    to_jsonb(
      array_remove(
        array[
          case when (trigger_object.tgtype & 4) = 4 then 'INSERT' end,
          case when (trigger_object.tgtype & 16) = 16 then 'UPDATE' end,
          case when (trigger_object.tgtype & 8) = 8 then 'DELETE' end,
          case when (trigger_object.tgtype & 32) = 32 then 'TRUNCATE' end
        ]::text[],
        null
      )
    ) as events,
    case
      when (trigger_object.tgtype & 1) = 1 then 'ROW'
      else 'STATEMENT'
    end as level,
    case trigger_object.tgenabled
      when 'O' then 'origin'
      when 'D' then 'disabled'
      when 'R' then 'replica'
      when 'A' then 'always'
      else trigger_object.tgenabled::text
    end as enabled_state,
    pg_catalog.quote_ident(function_namespace.nspname)
      || '.'
      || pg_catalog.quote_ident(function_object.proname)
      || '('
      || pg_catalog.pg_get_function_identity_arguments(function_object.oid)
      || ')' as linked_function,
    pg_catalog.pg_get_triggerdef(trigger_object.oid, true) as definition
  from pg_catalog.pg_namespace as table_namespace
  join pg_catalog.pg_class as table_object
    on table_object.relnamespace = table_namespace.oid
   and table_object.relname = 'users'
   and table_object.relkind in ('r', 'p')
  join pg_catalog.pg_trigger as trigger_object
    on trigger_object.tgrelid = table_object.oid
   and trigger_object.tgname = 'on_propcontrol_user_created'
   and not trigger_object.tgisinternal
  join pg_catalog.pg_proc as function_object
    on function_object.oid = trigger_object.tgfoid
  join pg_catalog.pg_namespace as function_namespace
    on function_namespace.oid = function_object.pronamespace
  where table_namespace.nspname = 'auth'
),
auth_trigger_inventory as (
  select jsonb_build_object(
    'schema', 'auth',
    'table', 'users',
    'trigger', 'on_propcontrol_user_created',
    'exists', exists (select 1 from auth_trigger_rows),
    'definitions', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'timing', timing,
            'events', events,
            'level', level,
            'enabled', enabled_state,
            'function', linked_function,
            'definition', definition
          )
          order by trigger_name
        )
        from auth_trigger_rows
      ),
      '[]'::jsonb
    )
  ) as value
),
storage_bucket_rows as (
  select
    bucket.name,
    bucket.public,
    bucket.file_size_limit,
    bucket.allowed_mime_types
  from storage.buckets as bucket
),
storage_buckets_inventory as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'name', name,
        'public', public,
        'file_size_limit', file_size_limit,
        'allowed_mime_types', to_jsonb(allowed_mime_types)
      )
      order by name
    ),
    '[]'::jsonb
  ) as value
  from storage_bucket_rows
),
storage_policy_rows as (
  select
    policy_object.polname as policy_name,
    case policy_object.polcmd
      when '*' then 'ALL'
      when 'r' then 'SELECT'
      when 'a' then 'INSERT'
      when 'w' then 'UPDATE'
      when 'd' then 'DELETE'
      else policy_object.polcmd::text
    end as command_name,
    policy_object.polpermissive as permissive,
    coalesce(
      (
        select jsonb_agg(
          case
            when role_item.role_oid = 0 then 'PUBLIC'
            else coalesce(policy_role.rolname, role_item.role_oid::text)
          end
          order by role_item.role_oid
        )
        from unnest(policy_object.polroles) as role_item(role_oid)
        left join pg_catalog.pg_roles as policy_role
          on policy_role.oid = role_item.role_oid
      ),
      '[]'::jsonb
    ) as roles,
    pg_catalog.pg_get_expr(
      policy_object.polqual,
      policy_object.polrelid
    ) as using_expression,
    pg_catalog.pg_get_expr(
      policy_object.polwithcheck,
      policy_object.polrelid
    ) as check_expression
  from pg_catalog.pg_namespace as storage_namespace
  join pg_catalog.pg_class as storage_objects
    on storage_objects.relnamespace = storage_namespace.oid
   and storage_objects.relname = 'objects'
   and storage_objects.relkind in ('r', 'p')
  join pg_catalog.pg_policy as policy_object
    on policy_object.polrelid = storage_objects.oid
  where storage_namespace.nspname = 'storage'
),
storage_policies_inventory as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'name', policy_name,
        'command', command_name,
        'permissive', permissive,
        'roles', roles,
        'using', using_expression,
        'with_check', check_expression
      )
      order by policy_name
    ),
    '[]'::jsonb
  ) as value
  from storage_policy_rows
),
registered_migrations as (
  select migration.version::text as version
  from supabase_migrations.schema_migrations as migration
),
migration_comparison as (
  select
    to_regclass('supabase_migrations.schema_migrations') is not null
      as relation_exists,
    (select count(*) from registered_migrations) as registered_count,
    coalesce(
      (
        select jsonb_agg(version order by version)
        from registered_migrations
      ),
      '[]'::jsonb
    ) as registered_versions,
    coalesce(
      (
        select jsonb_agg(expected.version order by expected.version)
        from expected_migrations as expected
        where not exists (
          select 1
          from registered_migrations as registered
          where registered.version = expected.version
        )
      ),
      '[]'::jsonb
    ) as missing_expected_versions,
    coalesce(
      (
        select jsonb_agg(registered.version order by registered.version)
        from registered_migrations as registered
        where not exists (
          select 1
          from expected_migrations as expected
          where expected.version = registered.version
        )
      ),
      '[]'::jsonb
    ) as unrecognized_versions
),
migration_inventory as (
  select jsonb_build_object(
    'relation', 'supabase_migrations.schema_migrations',
    'exists', relation_exists,
    'status', case
      when not relation_exists then 'absent'
      when registered_count = 0 then 'empty'
      when jsonb_array_length(missing_expected_versions) > 0 then 'incomplete'
      else 'present'
    end,
    'registered_versions', registered_versions,
    'expected_github_versions', (
      select coalesce(
        jsonb_agg(version order by version),
        '[]'::jsonb
      )
      from expected_migrations
    ),
    'missing_expected_versions', missing_expected_versions,
    'unrecognized_versions', unrecognized_versions
  ) as value
  from migration_comparison
),
expected_objects_status as (
  select *
  from (
    values
      (
        'table'::text,
        'public.user_profiles'::text,
        to_regclass('public.user_profiles') is not null
      ),
      (
        'table'::text,
        'public.organization_settings'::text,
        to_regclass('public.organization_settings') is not null
      ),
      (
        'storage_bucket'::text,
        'profile-avatars'::text,
        exists (
          select 1
          from storage_bucket_rows
          where name = 'profile-avatars'
        )
      )
  ) as expected(object_type, object_name, object_exists)
),
expected_objects_inventory as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'type', object_type,
        'object', object_name,
        'exists', object_exists,
        'missing', not object_exists
      )
      order by object_type, object_name
    ),
    '[]'::jsonb
  ) as value
  from expected_objects_status
),
warning_candidates(message) as (
  select 'Uno o más objetos de tabla requeridos no existen o no son tablas físicas.'
  where exists (
    select 1
    from target_relations
    where object_oid is null
       or relkind not in ('r', 'p')
  )
  union all
  select 'Una o más funciones requeridas no existen en producción.'
  where exists (
    select 1
    from target_functions as target
    where not exists (
      select 1
      from function_rows as found
      where found.schema_name = target.schema_name
        and found.function_name = target.function_name
        and found.object_oid is not null
    )
  )
  union all
  select 'El trigger auth.users.on_propcontrol_user_created no fue encontrado.'
  where not exists (select 1 from auth_trigger_rows)
  union all
  select 'Una o más tablas principales tienen RLS deshabilitado.'
  where exists (
    select 1
    from target_relations
    where object_oid is not null
      and relkind in ('r', 'p')
      and not relrowsecurity
  )
  union all
  select 'Una o más funciones SECURITY DEFINER no declaran search_path explícito.'
  where exists (
    select 1
    from function_rows
    where object_oid is not null
      and prosecdef
      and not exists (
        select 1
        from unnest(proconfig) as config_item
        where config_item like 'search_path=%'
      )
  )
  union all
  select 'El historial técnico de migraciones no coincide completamente con las versiones esperadas en GitHub.'
  from migration_comparison
  where not relation_exists
     or registered_count = 0
     or jsonb_array_length(missing_expected_versions) > 0
     or jsonb_array_length(unrecognized_versions) > 0
  union all
  select 'Uno o más objetos previstos para fases posteriores todavía están ausentes.'
  where exists (
    select 1
    from expected_objects_status
    where not object_exists
  )
),
warnings_inventory as (
  select coalesce(
    jsonb_agg(message order by message),
    '[]'::jsonb
  ) as value
  from warning_candidates
),
blocking_candidates(message) as (
  select 'Faltan tablas principales o existe un objeto con tipo incompatible.'
  where exists (
    select 1
    from target_relations
    where object_oid is null
       or relkind not in ('r', 'p')
  )
  union all
  select 'Faltan funciones requeridas para reconstruir el esquema.'
  where exists (
    select 1
    from target_functions as target
    where not exists (
      select 1
      from function_rows as found
      where found.schema_name = target.schema_name
        and found.function_name = target.function_name
        and found.object_oid is not null
    )
  )
  union all
  select 'Falta el trigger de alta de usuarios de PropControl.'
  where not exists (select 1 from auth_trigger_rows)
  union all
  select 'Hay tablas principales existentes con RLS deshabilitado.'
  where exists (
    select 1
    from target_relations
    where object_oid is not null
      and relkind in ('r', 'p')
      and not relrowsecurity
  )
  union all
  select 'El historial de migraciones está ausente, vacío o incompleto.'
  from migration_comparison
  where not relation_exists
     or registered_count = 0
     or jsonb_array_length(missing_expected_versions) > 0
),
blocking_inventory as (
  select coalesce(
    jsonb_agg(message order by message),
    '[]'::jsonb
  ) as value
  from blocking_candidates
),
final_inventory as (
  select jsonb_build_object(
    'check', 'B0.2 production schema inventory',
    'read_only', true,
    'generated_at', pg_catalog.clock_timestamp(),
    'server_version', pg_catalog.current_setting('server_version'),
    'schemas', (select value from schemas_inventory),
    'tables', (select value from tables_inventory),
    'functions', (select value from functions_inventory),
    'triggers', jsonb_build_object(
      'main_tables', (select value from main_triggers_inventory),
      'auth_user_trigger', (select value from auth_trigger_inventory)
    ),
    'rls', (select value from rls_inventory),
    'policies', jsonb_build_object(
      'main_tables', (select value from main_policies_inventory),
      'storage_objects', (select value from storage_policies_inventory)
    ),
    'grants', jsonb_build_object(
      'tables', (select value from main_grants_inventory),
      'functions', (select value from function_grants_inventory)
    ),
    'storage_buckets', jsonb_build_object(
      'metadata', (select value from storage_buckets_inventory),
      'storage_objects_policies', (select value from storage_policies_inventory)
    ),
    'migration_history', (select value from migration_inventory),
    'expected_objects_missing', (select value from expected_objects_inventory),
    'warnings', (select value from warnings_inventory),
    'blocking_findings', (select value from blocking_inventory)
  ) as b0_2_production_inventory
)
select b0_2_production_inventory
from final_inventory;
