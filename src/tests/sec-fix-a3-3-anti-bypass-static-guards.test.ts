import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import test from 'node:test';

const SRC_ROOT = 'src';
const LEGACY_CLOUD_API = 'src/cloud-api.ts';
const LEGACY_VISIT_MODULE = 'src/visit-transaction-cloud.ts';
const LEGACY_TEAM_UI = 'src/team-ui.ts';
const VISUAL_COMPATIBILITY = new Set([
  'src/store.ts',
  'src/team-access.ts',
  LEGACY_TEAM_UI,
]);

const RAW_TENANT_WRITER_ALLOWLIST = new Set([
  // Canonical tenant adapters.
  'src/tenant-cloud-data.ts',
  'src/tenant-visit-v2.ts',
  'src/public-property-share.ts',
  'src/server/team-management.ts',
  // Historical compatibility modules. Their callers are separately fenced below.
  LEGACY_CLOUD_API,
  LEGACY_VISIT_MODULE,
]);

const SAFE_DIRECT_CLOUD_API_IMPORTS = new Set([
  'getCloudSession',
  'inviteTeamMember',
  'signInCloud',
  'signOutCloud',
  'signUpCloud',
  'updateTeamMemberAccess',
]);

function normalizedPath(path: string): string {
  return path.split(sep).join('/');
}

function runtimeSourcePaths(directory = SRC_ROOT): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    const normalized = normalizedPath(full);
    if (entry.isDirectory()) {
      if (normalized === 'src/tests') continue;
      result.push(...runtimeSourcePaths(full));
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.ts') || entry.name.endsWith('.d.ts')) continue;
    result.push(normalized);
  }
  return result.sort();
}

function source(path: string): string {
  return readFileSync(path, 'utf8');
}

function runtimeSources(): Array<readonly [string, string]> {
  return runtimeSourcePaths().map((path) => [path, source(path)] as const);
}

function directCloudApiValueImports(text: string): string[] {
  const imports: string[] = [];
  const pattern = /import\s*\{([\s\S]*?)\}\s*from\s*['"]\.\/cloud-api\.js['"]/g;
  for (const match of text.matchAll(pattern)) {
    const body = match[1] ?? '';
    body.split(',').forEach((piece) => {
      const name = piece.trim().split(/\s+as\s+/i)[0]?.trim();
      if (name) imports.push(name);
    });
  }
  return imports;
}

function queueCloudSaveFirstArguments(text: string): Array<{ first: string; hasSecondArgument: boolean }> {
  const calls: Array<{ first: string; hasSecondArgument: boolean }> = [];
  const pattern = /\bqueueCloudSave\s*\(\s*([^,)]*?)(\s*[,)]?)/g;
  for (const match of text.matchAll(pattern)) {
    const first = String(match[1] ?? '').trim();
    const delimiter = String(match[2] ?? '').trim();
    if (!first) continue;
    calls.push({ first, hasSecondArgument: delimiter.startsWith(',') });
  }
  return calls;
}

function hasFirstMembershipAuthority(text: string): boolean {
  const membershipQuery = text.includes('/rest/v1/organization_members');
  const limitOne = /searchParams\.set\(\s*['"]limit['"]\s*,\s*['"]1['"]\s*\)/.test(text);
  const firstRow = /\b(?:ownRows|rows|payload|result)\s*\[\s*0\s*\]/.test(text);
  return membershipQuery && limitOne && firstRow;
}

function hasTenantBoundRawMutation(text: string): boolean {
  const tenantTables = [
    '/rest/v1/propcontrol_records',
    '/rest/v1/fichas',
    '/rest/v1/organization_members',
    '/rest/v1/public_property_fichas',
  ];
  return tenantTables.some((table) => text.includes(table))
    && /method\s*:\s*['"](?:POST|PATCH|PUT|DELETE)['"]/.test(text);
}

function relativeRuntime(path: string): string {
  return normalizedPath(relative('.', path));
}

test('A3.3 Guard 1: visit-transaction-cloud permanece sin imports productivos', () => {
  const legacy = source(LEGACY_VISIT_MODULE);
  assert.match(legacy, /getCloudMembershipContext/,
    'El allowlist sólo es válido mientras visit-transaction-cloud siga siendo el módulo legacy identificado.');

  for (const [path, text] of runtimeSources()) {
    if (path === LEGACY_VISIT_MODULE) continue;
    assert.equal(
      /(?:from\s*['"][^'"]*visit-transaction-cloud(?:\.js)?['"]|import\s*\([^)]*visit-transaction-cloud)/.test(text),
      false,
      `${path}: no puede importar el módulo legacy visit-transaction-cloud. Usá tenant-visit-v2/cutover canónico.`,
    );
  }
});

test('A3.3 Guard 2: first-membership authority queda confinada al compatibility legacy conocido', () => {
  const firstMembershipHits = runtimeSources()
    .filter(([, text]) => hasFirstMembershipAuthority(text))
    .map(([path]) => path);
  assert.deepEqual(
    firstMembershipHits,
    [LEGACY_CLOUD_API],
    'organization_members + limit(1) + first-row sólo puede sobrevivir en cloud-api.ts legacy hasta quarantine; ningún runtime nuevo puede usarlo.',
  );

  const contextAllowlist = new Set([LEGACY_CLOUD_API, LEGACY_VISIT_MODULE]);
  for (const [path, text] of runtimeSources()) {
    if (!text.includes('getCloudMembershipContext') && !text.includes('fetchMembershipRows')) continue;
    assert.equal(
      contextAllowlist.has(path),
      true,
      `${path}: reintroduce discovery legacy por first-membership. Consumí TenantScope/membership catalog explícito.`,
    );
  }

  const catalog = source('src/membership-catalog.ts');
  assert.doesNotMatch(catalog, /searchParams\.set\(\s*['"]limit['"]/,
    'membership-catalog debe leer el catálogo completo, no seleccionar la primera membership.');
  assert.doesNotMatch(catalog, /\b(?:rows|payload)\s*\[\s*0\s*\]/,
    'membership-catalog no puede escoger tenant por primera fila.');
});

test('A3.3 Guard 3: RPC comerciales canónicas son exclusivamente V2', () => {
  const legacyRpcLiterals = [
    /['"]visit_transaction_authority_active['"]/,
    /['"]client_snapshot_cas['"]/,
    /['"]commercial_visit_mutation['"]/,
  ];
  for (const [path, text] of runtimeSources()) {
    for (const pattern of legacyRpcLiterals) {
      if (!pattern.test(text)) continue;
      assert.equal(
        path,
        LEGACY_VISIT_MODULE,
        `${path}: contiene RPC comercial legacy ${pattern}. Los paths canónicos deben usar únicamente V2.`,
      );
    }
  }

  const canonical = source('src/tenant-visit-v2.ts');
  assert.match(canonical, /['"]visit_transaction_authority_active_v2['"]/);
  assert.match(canonical, /['"]client_snapshot_cas_v2['"]/);
  assert.match(canonical, /['"]commercial_visit_mutation_v2['"]/);
  for (const pattern of legacyRpcLiterals) {
    assert.doesNotMatch(canonical, pattern, 'tenant-visit-v2 no puede contener RPC legacy.');
  }

  const cutover = source('src/visit-workflow-cutover.ts');
  assert.match(cutover, /visitTransactionAuthorityActiveV2\(scope,\s*runtimeLease\)/);
  assert.match(cutover, /invokeVisitTransactionV2\(scope,/);
  assert.doesNotMatch(cutover, /visit-transaction-cloud|getCloudMembershipContext/);

  const writerSelection = source('src/visit-writer-selection.ts');
  assert.match(writerSelection, /const authorityActive = await selection\.readAuthority\(\)/);
  assert.match(writerSelection, /if \(mode === 'legacy-cloud'\) return selection\.runLegacyCloud\(\)/);
  assert.doesNotMatch(writerSelection, /catch\s*\([^)]*\)[\s\S]{0,300}runLegacyCloud/,
    'Un error del writer/authority V2 nunca puede convertirse en fallback legacy.');
});

test('A3.3 Guard 4: callers productivos de queueCloudSave siempre pasan TenantScope explícito', () => {
  const definitionAllowlist = new Set([LEGACY_CLOUD_API, 'src/cloud-api-compatible.ts']);
  for (const [path, text] of runtimeSources()) {
    if (definitionAllowlist.has(path)) continue;
    for (const call of queueCloudSaveFirstArguments(text)) {
      assert.equal(
        call.hasSecondArgument,
        true,
        `${path}: queueCloudSave(${call.first}) usa overload implícito. Pasá TenantScope como primer argumento.`,
      );
      assert.match(
        call.first,
        /scope/i,
        `${path}: primer argumento de queueCloudSave debe ser scope/lease.scope explícito; recibido: ${call.first}`,
      );
    }
  }

  const compatible = source('src/cloud-api-compatible.ts');
  assert.match(compatible, /export function queueCloudSave\(scope:\s*TenantScope,\s*crm:\s*CrmData/,
    'El contrato explícito queueCloudSave(scope, crm) debe permanecer disponible.');
});

test('A3.3 Guard 5: identidad visual no puede alimentar write actor ni Activity productiva', () => {
  const forbiddenWriterIdentity = [
    /createdById\s*:\s*state\.activeMemberId/g,
    /createdById\s*:\s*activeMember\(\)\.id/g,
    /assignedToId\s*:\s*state\.activeMemberId/g,
    /assignedToId\s*:\s*activeMember\(\)\.id/g,
    /actorId\s*:\s*state\.activeMemberId/g,
    /actorId\s*:\s*activeMember\(\)\.id/g,
    /changedBy\s*:\s*state\.activeMemberId/g,
    /changedBy\s*:\s*activeMember\(\)\.id/g,
    /actor\s*:\s*\{[^}]*id\s*:\s*state\.activeMemberId/gs,
    /actor\s*:\s*\{[^}]*id\s*:\s*activeMember\(\)\.id/gs,
  ];

  for (const [path, text] of runtimeSources()) {
    if (!VISUAL_COMPATIBILITY.has(path)) {
      for (const pattern of forbiddenWriterIdentity) {
        pattern.lastIndex = 0;
        assert.equal(pattern.test(text), false,
          `${path}: identidad visual activeMember/activeMemberId reapareció en un campo de escritura.`);
      }
      assert.doesNotMatch(text, /\baddActivity\s*\(/,
        `${path}: addActivity() usa actor visual; usá addActivityForAuthenticatedTenant(scope, ...).`);
      assert.doesNotMatch(text, /\bdefaultAssigneeId\s*\(/,
        `${path}: defaultAssigneeId() usa miembro visual; resolvé el miembro autenticado del TenantScope.`);
    }
    if (text.includes('TEAM_VIEW_KEY')) {
      assert.equal(path, 'src/store.ts', `${path}: TEAM_VIEW_KEY sólo puede vivir como preferencia visual en store.ts.`);
    }
  }

  const store = source('src/store.ts');
  assert.match(store, /activeMemberId \/ TEAM_VIEW_KEY remain a visual preference only and never[\s\S]*authenticatedTenantMember/);
  const legacyTeam = source(LEGACY_TEAM_UI);
  assert.match(legacyTeam, /\baddActivity\s*\(/,
    'team-ui.ts se mantiene explícitamente identificado como UI legacy antes de quarantine.');
});

test('A3.3 Guard 6: tenant de escritura no se deriva de CRM/record/payload mutable', () => {
  const forbiddenTenantWriters = [
    /organization_id\s*:\s*state\.crm\.organization\.id/g,
    /p_organization_id\s*:\s*state\.crm\.organization\.id/g,
    /searchParams\.set\(\s*['"]organization_id['"]\s*,\s*`[^`]*\$\{state\.crm\.organization\.id\}/g,
    /organizationId\s*:\s*(?:record|payload|form|values)\.organizationId/g,
  ];
  const compatibility = new Set([LEGACY_CLOUD_API, LEGACY_VISIT_MODULE, LEGACY_TEAM_UI]);
  for (const [path, text] of runtimeSources()) {
    if (compatibility.has(path)) continue;
    for (const pattern of forbiddenTenantWriters) {
      pattern.lastIndex = 0;
      assert.equal(pattern.test(text), false,
        `${path}: tenant de escritura deriva de estado/payload mutable; debe usar TenantScope capturado/revalidado.`);
    }
  }

  const tenantVisit = source('src/tenant-visit-v2.ts');
  assert.match(tenantVisit, /p_organization_id:\s*scope\.organizationId/);
  assert.match(tenantVisit, /organization_id[^\n]*scope\.organizationId|scope\.organizationId[^\n]*organization_id/);
  assert.match(tenantVisit, /assertResponseOrganization\(scope,/);

  const tenantCloud = source('src/tenant-cloud-data.ts');
  assert.match(tenantCloud, /organization_id[^\n]*transport\.scope\.organizationId|transport\.scope\.organizationId[^\n]*organization_id/);
  assert.match(tenantCloud, /assertRowsTenant\(transport\.scope,/);

  const publicShare = source('src/public-property-share.ts');
  assert.match(publicShare, /organization_id:\s*scope\.organizationId/);
  assert.match(publicShare, /row\.organization_id !== scope\.organizationId/);

  const teamServer = source('src/server/team-management.ts');
  assert.match(teamServer, /requestedOrganizationId\(body\.organizationId\)/);
  assert.match(teamServer, /requesterMembership\(user\.id!,\s*organizationId,\s*options\)/);
  assert.match(teamServer, /query\.searchParams\.set\('organization_id',\s*`eq\.\$\{organizationId\}`\)/);
});

test('A3.3 Guard 7: raw tenant writers sólo existen en adapters/compatibility exactos', () => {
  const hits = runtimeSources()
    .filter(([, text]) => hasTenantBoundRawMutation(text))
    .map(([path]) => path);

  for (const path of hits) {
    assert.equal(
      RAW_TENANT_WRITER_ALLOWLIST.has(path),
      true,
      `${path}: emite POST/PATCH/PUT/DELETE directo contra tabla tenant-bound fuera del allowlist mínimo.`,
    );
  }

  for (const expected of ['src/tenant-cloud-data.ts', 'src/tenant-visit-v2.ts', 'src/public-property-share.ts', 'src/server/team-management.ts']) {
    assert.equal(hits.includes(expected), true, `${expected}: adapter canónico esperado dejó de ser detectado; revisar precisión del guard.`);
  }
});

test('A3.3 Guard 8: UI/comercial no importa raw cloud adapters y legacy UI permanece unreachable', () => {
  const unsafeRawModules = [
    'tenant-cloud-data',
    'tenant-visit-v2',
    'visit-transaction-cloud',
  ];
  for (const [path, text] of runtimeSources()) {
    const isUiOrCommercial = /(?:-ui|^src\/mvp-|commercial-(?:close|mutation))/.test(path);
    if (!isUiOrCommercial || path === LEGACY_TEAM_UI) continue;
    for (const moduleName of unsafeRawModules) {
      assert.equal(
        text.includes(`./${moduleName}.js`) || text.includes(`../${moduleName}.js`),
        false,
        `${path}: UI/comercial importa raw adapter ${moduleName}; debe atravesar el adapter/cutover autorizado.`,
      );
    }
  }

  for (const [path, text] of runtimeSources()) {
    if (path === LEGACY_CLOUD_API || path === LEGACY_VISIT_MODULE) continue;
    const directImports = directCloudApiValueImports(text);
    for (const imported of directImports) {
      assert.equal(
        SAFE_DIRECT_CLOUD_API_IMPORTS.has(imported),
        true,
        `${path}: import directo inseguro ${imported} desde cloud-api.ts legacy. Usá cloud-api-compatible/TenantScope.`,
      );
    }
  }

  const index = source('index.html');
  assert.doesNotMatch(index, /(?:\/dist\/team-ui\.js|\/dist\/visit-transaction-cloud\.js)/,
    'Los módulos legacy no pueden volver a publicarse como entrypoints browser.');
  const main = source('src/mvp-main.ts');
  assert.doesNotMatch(main, /team-ui|visit-transaction-cloud/,
    'mvp-main no puede reactivar UI/Visit legacy.');
  for (const [path, text] of runtimeSources()) {
    if (path === LEGACY_TEAM_UI) continue;
    assert.equal(
      /from\s*['"][^'"]*team-ui(?:\.js)?['"]/.test(text),
      false,
      `${path}: team-ui.ts legacy volvió a ser reachable. Migrá al mvp-users-ui autenticado.`,
    );
  }
});

// Keep the helper referenced so TypeScript flags path normalization regressions during build.
test('A3.3 static inventory scans source paths, not dist/tests', () => {
  const paths = runtimeSourcePaths();
  assert.ok(paths.length > 20, 'El inventario runtime quedó anormalmente vacío.');
  assert.equal(paths.some((path) => path.startsWith('dist/')), false);
  assert.equal(paths.some((path) => path.startsWith('src/tests/')), false);
  assert.equal(paths.every((path) => relativeRuntime(path).startsWith('src/')), true);
});
