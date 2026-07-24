import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const migrationPath = 'supabase/migrations/20260724190000_harden_invited_membership_activation.sql';
const previousLockoutPath = 'supabase/migrations/20260720130000_lockout_miembros_suspendidos.sql';
const runbookPath = 'docs/B0_1_MEMBERSHIP_SECURITY_RUNBOOK.md';
const migration = readFileSync(migrationPath, 'utf8');
const previousLockout = readFileSync(previousLockoutPath, 'utf8');
const runbook = readFileSync(runbookPath, 'utf8');

function gitBlobSha(content: string): string {
  const body = Buffer.from(content, 'utf8');
  return createHash('sha1')
    .update(Buffer.from(`blob ${body.byteLength}\0`, 'utf8'))
    .update(body)
    .digest('hex');
}

function functionDefinition(namePattern: string): string {
  const match = migration.match(new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+${namePattern}[\\s\\S]*?\\$function\\$;`,
    'i',
  ));
  if (!match) throw new Error(`No se encontró la función ${namePattern}`);
  return match[0]!;
}

function functionBody(definition: string): string {
  const match = definition.match(/as\s+\$function\$([\s\S]*?)\$function\$;/i);
  if (!match?.[1]) throw new Error('No se encontró el cuerpo de la función');
  return match[1];
}

interface Membership {
  organizationId: string;
  userId: string;
  role: string;
  memberId: number;
  status: string;
  displayName: string;
  email: string;
  phone: string;
  lastActiveAt: string | null;
}

interface ActivationResult {
  rows: Membership[];
  error: 'unauthorized' | 'ambiguous' | null;
}

function simulateActivation(userId: string | null, source: readonly Membership[]): ActivationResult {
  const rows: Membership[] = source.map((row) => ({ ...row }));
  if (!userId) return { rows, error: 'unauthorized' };

  const invited = rows.filter((row) => (
    row.userId === userId && row.status.trim().toLowerCase() === 'invited'
  ));

  if (invited.length === 0) return { rows, error: null };
  if (invited.length > 1) return { rows, error: 'ambiguous' };

  const target = invited[0];
  if (!target) throw new Error('La simulación no encontró la membresía invited única.');
  target.status = 'active';
  target.lastActiveAt = 'now';
  return { rows, error: null };
}

const activationDefinition = functionDefinition('public\\.activate_my_organization_memberships\\(\\)');
const activationBody = functionBody(activationDefinition);
const isOrgMemberDefinition = functionDefinition('public\\.is_org_member\\(target_org\\s+uuid\\)');
const canManageDefinition = functionDefinition(
  'public\\.can_manage_public_property_ficha\\(target_organization\\s+text\\)',
);

const baseRows: Membership[] = [
  {
    organizationId: '11111111-1111-4111-8111-111111111111',
    userId: 'user-1',
    role: 'agent',
    memberId: 10,
    status: 'active',
    displayName: 'Activo',
    email: 'active@example.com',
    phone: '1',
    lastActiveAt: 'before',
  },
  {
    organizationId: '22222222-2222-4222-8222-222222222222',
    userId: 'user-1',
    role: 'admin',
    memberId: 11,
    status: 'suspended',
    displayName: 'Suspendido',
    email: 'suspended@example.com',
    phone: '2',
    lastActiveAt: null,
  },
];

test('la migración B0.1 existe una sola vez', () => {
  const matches = readdirSync('supabase/migrations')
    .filter((name) => name.endsWith('_harden_invited_membership_activation.sql'));
  assert.deepEqual(matches, ['20260724190000_harden_invited_membership_activation.sql']);
});

test('la migración anterior de lockout permanece byte a byte sin cambios', () => {
  assert.equal(gitBlobSha(previousLockout), '53a00e46fd56a6901a9c7e6daf52774f84d018da');
});

test('la migración está envuelta en una transacción explícita', () => {
  assert.match(migration, /^--[\s\S]*?\bbegin;[\s\S]*\bcommit;\s*$/i);
});

test('la migración no crea tablas ni esquemas', () => {
  assert.equal(/\bcreate\s+(table|schema)\b/i.test(migration), false);
});

test('la migración no toca Configuración, avatares ni Storage', () => {
  assert.equal(/user_profiles|organization_settings|profile-avatars|property-photos|storage\./i.test(migration), false);
});

test('la migración no contiene operaciones destructivas', () => {
  assert.equal(/\bdelete\s+from\b|\btruncate\b|\bdrop\s+table\b/i.test(migration), false);
});

test('el único UPDATE de organization_members está dentro del RPC', () => {
  const withoutActivation = migration.replace(activationDefinition, '');
  assert.equal(/\bupdate\s+public\.organization_members\b/i.test(withoutActivation), false);
  assert.equal((activationBody.match(/\bupdate\s+public\.organization_members\b/gi) ?? []).length, 1);
});

test('activate_my_organization_memberships conserva firma y retorno void', () => {
  assert.match(activationDefinition, /function\s+public\.activate_my_organization_memberships\(\)\s*\nreturns\s+void/i);
});

test('el RPC rechaza auth.uid nulo antes de consultar o actualizar', () => {
  const guardIndex = activationBody.search(/if\s+current_user_id\s+is\s+null/i);
  const queryIndex = activationBody.search(/from\s+public\.organization_members/i);
  const updateIndex = activationBody.search(/update\s+public\.organization_members/i);
  assert.ok(guardIndex >= 0 && guardIndex < queryIndex && guardIndex < updateIndex);
  assert.match(activationBody, /errcode\s*=\s*'42501'/i);
});

test('el RPC busca exclusivamente status invited normalizado', () => {
  assert.match(activationBody, /lower\(coalesce\(member\.status,\s*''\)\)\s*=\s*'invited'/i);
  assert.equal(/<>\s*'suspended'/i.test(activationBody), false);
});

test('el RPC no convierte membresías active', () => {
  assert.equal(/where[\s\S]*status[\s\S]*=\s*'active'/i.test(activationBody.split(/update\s+public\.organization_members/i)[0] ?? ''), false);
});

test('el RPC no convierte membresías suspended', () => {
  assert.equal(/set[\s\S]*status\s*=\s*'suspended'/i.test(activationBody), false);
  assert.equal(/where[\s\S]*status[\s\S]*=\s*'suspended'/i.test(activationBody), false);
});

test('el conteo inspecciona como máximo dos invitaciones', () => {
  assert.match(activationBody, /order\s+by\s+member\.organization_id\s+limit\s+2\s+for\s+update/i);
});

test('la ambigüedad se valida antes del UPDATE', () => {
  const ambiguityIndex = activationBody.search(/if\s+invited_count\s*>\s*1/i);
  const updateIndex = activationBody.search(/update\s+public\.organization_members/i);
  assert.ok(ambiguityIndex >= 0 && ambiguityIndex < updateIndex);
  assert.match(activationBody, /más de una invitación pendiente/i);
});

test('el UPDATE queda acotado por organización, usuario y status invited', () => {
  assert.match(activationBody, /member\.organization_id\s*=\s*invited_organization_id/i);
  assert.match(activationBody, /member\.user_id\s*=\s*current_user_id/i);
  assert.match(activationBody, /lower\(coalesce\(member\.status,\s*''\)\)\s*=\s*'invited'/i);
});

test('el UPDATE solo asigna status y last_active_at', () => {
  const setClause = activationBody.match(/update\s+public\.organization_members[\s\S]*?set([\s\S]*?)where/i)?.[1] ?? '';
  assert.match(setClause, /status\s*=\s*'active'/i);
  assert.match(setClause, /last_active_at\s*=\s*pg_catalog\.now\(\)/i);
  assert.equal(/organization_id\s*=|user_id\s*=|\brole\s*=|member_id\s*=|display_name\s*=|\bemail\s*=|\bphone\s*=/i.test(setClause), false);
});

test('las tres funciones usan SECURITY DEFINER y search_path vacío', () => {
  assert.equal((migration.match(/security\s+definer/gi) ?? []).length, 3);
  assert.equal((migration.match(/set\s+search_path\s+to\s+''/gi) ?? []).length, 3);
});

test('las referencias sensibles están calificadas por esquema', () => {
  assert.equal(/\bfrom\s+organization_members\b|\bupdate\s+organization_members\b/i.test(migration), false);
  assert.match(migration, /public\.organization_members/i);
  assert.match(migration, /private\.is_active_org_member/i);
  assert.match(migration, /auth\.uid\(\)/i);
});

test('PUBLIC pierde EXECUTE del RPC', () => {
  assert.match(migration, /revoke\s+all\s+on\s+function\s+public\.activate_my_organization_memberships\(\)\s+from\s+public;/i);
});

test('anon pierde EXECUTE del RPC', () => {
  assert.match(migration, /revoke\s+all\s+on\s+function\s+public\.activate_my_organization_memberships\(\)\s+from\s+anon;/i);
});

test('authenticated conserva EXECUTE del RPC', () => {
  assert.match(migration, /grant\s+execute\s+on\s+function\s+public\.activate_my_organization_memberships\(\)\s+to\s+authenticated;/i);
});

test('service_role conserva EXECUTE del RPC para flujos internos', () => {
  assert.match(migration, /grant\s+execute\s+on\s+function\s+public\.activate_my_organization_memberships\(\)\s+to\s+service_role;/i);
});

test('is_org_member conserva firma y delega en membresía active', () => {
  assert.match(isOrgMemberDefinition, /returns\s+boolean/i);
  assert.match(isOrgMemberDefinition, /private\.is_active_org_member\(target_org,\s*auth\.uid\(\)\)/i);
  assert.equal(/organization_members/i.test(functionBody(isOrgMemberDefinition)), false);
});

test('is_org_member mantiene solo permisos explícitos necesarios', () => {
  assert.match(migration, /revoke\s+all\s+on\s+function\s+public\.is_org_member\(uuid\)\s+from\s+public;/i);
  assert.match(migration, /grant\s+execute\s+on\s+function\s+public\.is_org_member\(uuid\)\s+to\s+anon,\s*authenticated,\s*service_role;/i);
});

test('can_manage_public_property_ficha conserva firma y exige membresía active', () => {
  assert.match(canManageDefinition, /returns\s+boolean/i);
  assert.match(canManageDefinition, /private\.is_active_org_member\(parsed_organization_id,\s*auth\.uid\(\)\)/i);
});

test('can_manage_public_property_ficha devuelve false para UUID inválido', () => {
  assert.match(canManageDefinition, /when\s+invalid_text_representation\s+then\s+return\s+false;/i);
  assert.match(canManageDefinition, /if\s+target_organization\s+is\s+null\s+then\s+return\s+false;/i);
});

test('can_manage elimina acceso PUBLIC y anon y conserva authenticated y service_role', () => {
  assert.match(migration, /revoke\s+all\s+on\s+function\s+public\.can_manage_public_property_ficha\(text\)\s+from\s+public;/i);
  assert.match(migration, /revoke\s+all\s+on\s+function\s+public\.can_manage_public_property_ficha\(text\)\s+from\s+anon;/i);
  assert.match(migration, /grant\s+execute[\s\S]*can_manage_public_property_ficha\(text\)\s+to\s+authenticated;/i);
  assert.match(migration, /grant\s+execute[\s\S]*can_manage_public_property_ficha\(text\)\s+to\s+service_role;/i);
});

test('la migración no modifica el trigger de alta ni código de aplicación', () => {
  assert.equal(/handle_new_propcontrol_user|on_propcontrol_user_created|invitation-auth|team-management|src\//i.test(migration), false);
});

test('la simulación rechaza una sesión nula sin cambios', () => {
  const result = simulateActivation(null, baseRows);
  assert.equal(result.error, 'unauthorized');
  assert.deepEqual(result.rows, baseRows);
});

test('la simulación sin invited es no-op y conserva active y suspended', () => {
  const result = simulateActivation('user-1', baseRows);
  assert.equal(result.error, null);
  assert.deepEqual(result.rows, baseRows);
});

test('la simulación activa una sola invited sin alterar identidad, rol ni datos de perfil', () => {
  const invited: Membership = {
    organizationId: '33333333-3333-4333-8333-333333333333',
    userId: 'user-1',
    role: 'admin',
    memberId: 12,
    status: ' Invited ',
    displayName: 'Invitado',
    email: 'invited@example.com',
    phone: '3',
    lastActiveAt: null,
  };
  const source = [...baseRows, invited];
  const result = simulateActivation('user-1', source);
  assert.equal(result.error, null);
  assert.equal(result.rows[2]?.status, 'active');
  assert.equal(result.rows[2]?.lastActiveAt, 'now');
  assert.deepEqual(
    { ...result.rows[2], status: invited.status, lastActiveAt: invited.lastActiveAt },
    invited,
  );
  assert.deepEqual(result.rows.slice(0, 2), baseRows);
});

test('la simulación con dos invited falla y deja cero cambios', () => {
  const source: Membership[] = [
    ...baseRows,
    { ...baseRows[0]!, organizationId: '33333333-3333-4333-8333-333333333333', memberId: 12, status: 'invited' },
    { ...baseRows[0]!, organizationId: '44444444-4444-4444-8444-444444444444', memberId: 13, status: 'INVITED' },
  ];
  const result = simulateActivation('user-1', source);
  assert.equal(result.error, 'ambiguous');
  assert.deepEqual(result.rows, source);
});

test('el runbook usa conteos agregados y evita columnas personales', () => {
  assert.match(runbook, /count\(\*\).*membership_count/is);
  assert.match(runbook, /users_with_multiple_invited_memberships/i);
  const preExecution = runbook.split('## Ejecución')[0] ?? '';
  assert.equal(/select[\s\S]*\b(email|display_name|phone)\b/i.test(preExecution), false);
});

test('el runbook documenta pre-ejecución, post-ejecución y rollback correctivo', () => {
  assert.match(runbook, /## Pre-ejecución/);
  assert.match(runbook, /## Post-ejecución/);
  assert.match(runbook, /## Rollback/);
  assert.match(runbook, /nueva migración correctiva/i);
  assert.match(runbook, /No ejecutar rollback durante la publicación normal/i);
});
