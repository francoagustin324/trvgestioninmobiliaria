import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migrationPath = 'supabase/migrations/20260910130000_sec_fix_a2_1_canonical_organization_member_status.sql';
const historicalMigrationPath = 'supabase/migrations/20260716103000_add_organization_member_status.sql';
const migration = readFileSync(migrationPath, 'utf8');
const historicalMigration = readFileSync(historicalMigrationPath, 'utf8');
const databaseUrl = process.env.A2_1_TEST_DATABASE_URL ?? '';

function psql(sql: string): string {
  if (!databaseUrl) throw new Error('A2_1_TEST_DATABASE_URL no configurada.');
  return execFileSync('psql', [databaseUrl, '-X', '-v', 'ON_ERROR_STOP=1', '-qAt', '-c', sql], {
    encoding: 'utf8',
  }).trim();
}

function applyMigration(expectFailure = false): string {
  if (!databaseUrl) throw new Error('A2_1_TEST_DATABASE_URL no configurada.');
  try {
    return execFileSync('psql', [databaseUrl, '-X', '-v', 'ON_ERROR_STOP=1', '-qAt', '-f', migrationPath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    if (!expectFailure) throw error;
    const failure = error as { stderr?: Buffer | string };
    return String(failure.stderr ?? '');
  }
}

function resetTable(options: {
  statusDefinition?: string;
  checkDefinition?: string;
  seed?: readonly (string | null)[];
} = {}): void {
  const statusDefinition = options.statusDefinition ?? "text default 'active'";
  const checkDefinition = options.checkDefinition ? `, constraint organization_members_status_check check (${options.checkDefinition})` : '';
  const seed = options.seed ?? [];
  const values = seed.map((value) => value === null ? '(null)' : `('${value.replaceAll("'", "''")}')`).join(',');
  psql(`
    drop table if exists public.organization_members;
    create table public.organization_members (
      id bigint generated always as identity primary key,
      status ${statusDefinition}${checkDefinition}
    );
    ${values ? `insert into public.organization_members(status) values ${values};` : ''}
  `);
}

function finalMetadata(): { type: string; nullable: string; defaultValue: string; constraint: string } {
  const raw = psql(`
    select concat_ws(E'\\t',
      data_type,
      is_nullable,
      coalesce(column_default, ''),
      coalesce((
        select pg_catalog.pg_get_constraintdef(c.oid, true)
        from pg_catalog.pg_constraint c
        where c.conrelid = 'public.organization_members'::pg_catalog.regclass
          and c.conname = 'organization_members_status_check'
      ), '')
    )
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'organization_members'
      and column_name = 'status';
  `);
  const [type = '', nullable = '', defaultValue = '', constraint = ''] = raw.split('\t');
  return { type, nullable, defaultValue, constraint };
}

function assertInsertAccepted(status: string): void {
  psql(`insert into public.organization_members(status) values ('${status.replaceAll("'", "''")}');`);
}

function assertInsertRejected(status: string | null): void {
  const literal = status === null ? 'null' : `'${status.replaceAll("'", "''")}'`;
  assert.throws(() => psql(`insert into public.organization_members(status) values (${literal});`));
}

test('A2.1 static: conserva la migration histórica y agrega una forward migration separada', () => {
  assert.match(historicalMigration, /status\s+in\s*\(\s*'active'\s*,\s*'suspended'\s*\)/i);
  assert.notEqual(migrationPath, historicalMigrationPath);
  assert.match(migration, /^--[\s\S]*?\bbegin;[\s\S]*\bcommit;\s*$/i);
});

test('A2.1 static: el preflight precede a todo ALTER material y no normaliza datos', () => {
  const preflightIndex = migration.indexOf('do $preflight$');
  const firstAlterIndex = migration.search(/\balter\s+table\s+public\.organization_members/i);
  assert.ok(preflightIndex >= 0 && firstAlterIndex > preflightIndex);
  assert.equal(/\bupdate\s+public\.organization_members\b/i.test(migration), false);
  assert.equal(/\bdelete\s+from\b|\btruncate\b/i.test(migration), false);
  assert.match(migration, /member\.status\s+is\s+null[\s\S]*member\.status\s+not\s+in\s*\(\s*'active'\s*,\s*'invited'\s*,\s*'suspended'\s*\)/i);
});

test('A2.1 static: el CHECK final es exacto y no usa lower/trim/coerción', () => {
  const finalCheck = migration.match(/add\s+constraint\s+organization_members_status_check[\s\S]*?check\s*\(([^;]+)\);/i)?.[1] ?? '';
  assert.match(finalCheck, /^\s*status\s+in\s*\(\s*'active'\s*,\s*'invited'\s*,\s*'suspended'\s*\)\s*$/i);
  assert.equal(/lower\s*\(|trim\s*\(|btrim\s*\(|::/i.test(finalCheck), false);
});

test('A2.1 PostgreSQL 17: contrato canónico e idempotencia', { skip: !databaseUrl }, async (t) => {
  await t.test('1. active válido', () => {
    resetTable(); applyMigration(); assertInsertAccepted('active');
  });
  await t.test('2. invited válido', () => {
    resetTable(); applyMigration(); assertInsertAccepted('invited');
  });
  await t.test('3. suspended válido', () => {
    resetTable(); applyMigration(); assertInsertAccepted('suspended');
  });
  await t.test('4. NULL rechazado', () => {
    resetTable(); applyMigration(); assertInsertRejected(null);
  });
  await t.test('5. blank rechazado', () => {
    resetTable(); applyMigration(); assertInsertRejected('');
  });
  await t.test('6. Active rechazado', () => {
    resetTable(); applyMigration(); assertInsertRejected('Active');
  });
  await t.test("7. ' active ' rechazado", () => {
    resetTable(); applyMigration(); assertInsertRejected(' active ');
  });
  await t.test('8. unknown rechazado', () => {
    resetTable(); applyMigration(); assertInsertRejected('unknown');
  });
  await t.test('9. schema sin CHECK queda con contrato final', () => {
    resetTable({ statusDefinition: 'text' });
    applyMigration();
    const metadata = finalMetadata();
    assert.equal(metadata.type, 'text');
    assert.equal(metadata.nullable, 'NO');
    assert.equal(metadata.defaultValue, "'active'::text");
    assert.match(metadata.constraint, /active[\s\S]*invited[\s\S]*suspended/i);
  });
  await t.test('10. CHECK histórico active/suspended migra al contrato final', () => {
    resetTable({ checkDefinition: "status in ('active','suspended')", seed: ['active', 'suspended'] });
    applyMigration();
    assertInsertAccepted('invited');
    assertInsertRejected('other');
  });
  await t.test('11. schema correcto soporta rerun seguro/idempotente', () => {
    resetTable({ statusDefinition: "text not null default 'active'", checkDefinition: "status in ('active','invited','suspended')", seed: ['active', 'invited', 'suspended'] });
    applyMigration();
    const once = finalMetadata();
    applyMigration();
    const twice = finalMetadata();
    assert.deepEqual(twice, once);
    assert.equal(psql('select string_agg(status,\',\' order by id) from public.organization_members;'), 'active,invited,suspended');
  });
  await t.test('12. unknown existente aborta y conserva estado anterior', () => {
    resetTable({ statusDefinition: 'text', seed: ['unknown'] });
    const before = finalMetadata();
    const failure = applyMigration(true);
    assert.match(failure, /status no canónicos/i);
    assert.deepEqual(finalMetadata(), before);
    assert.equal(psql('select status from public.organization_members;'), 'unknown');
  });
  await t.test('13. invited existente se conserva', () => {
    resetTable({ statusDefinition: 'text', seed: ['invited'] });
    applyMigration();
    assert.equal(psql('select status from public.organization_members;'), 'invited');
  });
  await t.test("14. DEFAULT final exacto 'active'", () => {
    resetTable({ statusDefinition: "text default 'suspended'" }); applyMigration();
    assert.equal(finalMetadata().defaultValue, "'active'::text");
  });
  await t.test('15. NOT NULL final confirmado desde schema nullable', () => {
    resetTable({ statusDefinition: 'text' }); applyMigration();
    assert.equal(finalMetadata().nullable, 'NO');
  });
  await t.test('16. constraint final permite exactamente los tres estados', () => {
    resetTable(); applyMigration();
    for (const allowed of ['active', 'invited', 'suspended']) assertInsertAccepted(allowed);
    for (const rejected of ['', 'Active', ' active ', 'unknown', 'ACTIVE', 'suspended ']) assertInsertRejected(rejected);
  });
});
