import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import test from 'node:test';
import * as ts from 'typescript';

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

const LEGACY_MEMBERSHIP_SYMBOLS = new Set([
  'getCloudMembershipContext',
  'fetchMembershipRows',
]);

const LEGACY_VISUAL_WRITER_HELPERS = new Set([
  'addActivity',
  'defaultAssigneeId',
]);

type NamedImportBinding = Readonly<{
  imported: string;
  local: string;
  isTypeOnly: boolean;
}>;

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

function parseText(text: string, fileName = 'fixture.ts'): ts.SourceFile {
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function parseSource(path: string): ts.SourceFile {
  return parseText(source(path), path);
}

function moduleSpecifierMatches(actual: string, expected: string): boolean {
  if (actual === expected) return true;
  const leaf = expected.replace(/^(?:\.\.\/|\.\/)+/, '');
  return actual === leaf || actual.endsWith(`/${leaf}`);
}

function namedImportBindings(
  parsed: ts.SourceFile,
  moduleSpecifier: string,
): NamedImportBinding[] {
  const bindings: NamedImportBinding[] = [];
  for (const statement of parsed.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (!moduleSpecifierMatches(statement.moduleSpecifier.text, moduleSpecifier)) continue;
    const clause = statement.importClause;
    if (!clause || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) continue;
    for (const element of clause.namedBindings.elements) {
      bindings.push({
        imported: (element.propertyName ?? element.name).text,
        local: element.name.text,
        isTypeOnly: clause.isTypeOnly || element.isTypeOnly,
      });
    }
  }
  return bindings;
}

function namedImportsFrom(path: string, moduleSpecifier: string): string[] {
  return namedImportBindings(parseSource(path), moduleSpecifier)
    .filter((binding) => !binding.isTypeOnly)
    .map((binding) => binding.imported);
}

function localImportBindingsFrom(path: string, moduleSpecifier: string): Map<string, string> {
  return new Map(
    namedImportBindings(parseSource(path), moduleSpecifier)
      .filter((binding) => !binding.isTypeOnly)
      .map((binding) => [binding.local, binding.imported] as const),
  );
}

function callExpressionsByIdentifier(parsed: ts.SourceFile, identifier: string): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === identifier) {
      calls.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return calls;
}

function importsModule(parsed: ts.SourceFile, moduleSpecifier: string): boolean {
  let hit = false;
  const visit = (node: ts.Node): void => {
    if (hit) return;
    if (
      ts.isImportDeclaration(node)
      && ts.isStringLiteral(node.moduleSpecifier)
      && moduleSpecifierMatches(node.moduleSpecifier.text, moduleSpecifier)
    ) {
      hit = true;
      return;
    }
    if (
      ts.isExportDeclaration(node)
      && node.moduleSpecifier
      && ts.isStringLiteral(node.moduleSpecifier)
      && moduleSpecifierMatches(node.moduleSpecifier.text, moduleSpecifier)
    ) {
      hit = true;
      return;
    }
    if (
      ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments.length === 1
      && ts.isStringLiteral(node.arguments[0]!)
      && moduleSpecifierMatches(node.arguments[0]!.text, moduleSpecifier)
    ) {
      hit = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return hit;
}

function directCloudApiValueImports(path: string): string[] {
  return namedImportsFrom(path, 'cloud-api.js');
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function isExplicitTenantScopeExpression(expression: ts.Expression): boolean {
  const value = unwrapExpression(expression);
  if (ts.isIdentifier(value)) return value.text === 'scope' || value.text.endsWith('Scope');
  if (ts.isPropertyAccessExpression(value)) return value.name.text === 'scope';
  return false;
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

test('A3.3 AST helpers distinguen procedencia, aliases y símbolos homónimos', () => {
  const legacyImport = parseText("import { addActivity } from './team-access.js';\naddActivity();");
  assert.deepEqual(
    namedImportBindings(legacyImport, 'team-access.js').map(({ imported, local }) => ({ imported, local })),
    [{ imported: 'addActivity', local: 'addActivity' }],
  );
  assert.equal(callExpressionsByIdentifier(legacyImport, 'addActivity').length, 1);

  const localHomonym = parseText('function addActivity() {}\naddActivity();');
  assert.deepEqual(namedImportBindings(localHomonym, 'team-access.js'), []);
  assert.equal(callExpressionsByIdentifier(localHomonym, 'addActivity').length, 1);

  const scopedHomonym = parseText('historicalUnscopedStorageKey();');
  assert.equal(callExpressionsByIdentifier(scopedHomonym, 'scopedStorageKey').length, 0);
  assert.equal(callExpressionsByIdentifier(scopedHomonym, 'historicalUnscopedStorageKey').length, 1);

  const multiline = parseText(`
    import {
      getCloudSession,
      signInCloud,
    } from './cloud-api.js';
  `);
  assert.deepEqual(
    namedImportBindings(multiline, 'cloud-api.js')
      .filter((binding) => !binding.isTypeOnly)
      .map((binding) => binding.imported),
    ['getCloudSession', 'signInCloud'],
  );

  const aliased = parseText("import { getCloudSession as session } from './cloud-api.js';\nsession();");
  const [aliasBinding] = namedImportBindings(aliased, 'cloud-api.js');
  assert.deepEqual(aliasBinding, { imported: 'getCloudSession', local: 'session', isTypeOnly: false });
  assert.equal(callExpressionsByIdentifier(aliased, 'session').length, 1);
});

test('A3.3 Guard 1: visit-transaction-cloud permanece sin imports productivos', () => {
  const legacy = source(LEGACY_VISIT_MODULE);
  assert.match(legacy, /getCloudMembershipContext/,
    'El allowlist sólo es válido mientras visit-transaction-cloud siga siendo el módulo legacy identificado.');

  for (const path of runtimeSourcePaths()) {
    if (path === LEGACY_VISIT_MODULE) continue;
    assert.equal(
      importsModule(parseSource(path), 'visit-transaction-cloud.js'),
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

  const legacyImportAllowlist = new Set([LEGACY_VISIT_MODULE]);
  for (const path of runtimeSourcePaths()) {
    const importedLegacyMembership = namedImportsFrom(path, 'cloud-api.js')
      .filter((name) => LEGACY_MEMBERSHIP_SYMBOLS.has(name));
    if (importedLegacyMembership.length === 0) continue;
    assert.equal(
      legacyImportAllowlist.has(path),
      true,
      `${path}: importa discovery legacy ${importedLegacyMembership.join(', ')} desde cloud-api.ts. Consumí TenantScope/membership catalog explícito.`,
    );
  }

  const telemetryPath = 'src/lead-recommendation-telemetry.ts';
  const telemetryAst = parseSource(telemetryPath);
  const telemetryCloudImports = namedImportsFrom(telemetryPath, 'cloud-api.js');
  for (const symbol of LEGACY_MEMBERSHIP_SYMBOLS) {
    assert.equal(telemetryCloudImports.includes(symbol), false,
      `${telemetryPath}: no puede importar ${symbol}; la autoridad debe venir de TenantScope/tenantCloudTransport.`);
    assert.equal(callExpressionsByIdentifier(telemetryAst, symbol).length, 0,
      `${telemetryPath}: no puede llamar ${symbol}; la autoridad legacy está prohibida en telemetry.`);
  }
  const telemetryStorageImports = namedImportsFrom(telemetryPath, 'tenant-storage.js');
  assert.equal(telemetryStorageImports.includes('scopedStorageKey'), false,
    `${telemetryPath}: no puede rederivar storage con scopedStorageKey global.`);
  assert.equal(callExpressionsByIdentifier(telemetryAst, 'scopedStorageKey').length, 0,
    `${telemetryPath}: no puede llamar scopedStorageKey; tenantStorageNamespace(scope) es el boundary canónico.`);

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
  for (const path of runtimeSourcePaths()) {
    if (definitionAllowlist.has(path)) continue;
    const parsed = parseSource(path);
    for (const call of callExpressionsByIdentifier(parsed, 'queueCloudSave')) {
      assert.ok(
        call.arguments.length >= 2,
        `${path}: queueCloudSave(${call.arguments.map((argument) => argument.getText(parsed)).join(', ')}) usa overload implícito. Pasá TenantScope como primer argumento.`,
      );
      const first = call.arguments[0];
      assert.ok(first, `${path}: queueCloudSave debe recibir TenantScope como primer argumento.`);
      assert.equal(
        isExplicitTenantScopeExpression(first),
        true,
        `${path}: primer argumento de queueCloudSave debe ser TenantScope explícito (scope/tenant.scope/runtimeLease.scope equivalente); recibido: ${first.getText(parsed)}`,
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

      const teamBindings = localImportBindingsFrom(path, 'team-access.js');
      for (const [local, imported] of teamBindings) {
        if (!LEGACY_VISUAL_WRITER_HELPERS.has(imported)) continue;
        const calls = callExpressionsByIdentifier(parseSource(path), local);
        assert.fail(
          `${path}: importa helper visual legacy ${imported} como ${local} desde team-access.ts (${calls.length} calls). Usá identidad autenticada del TenantScope.`,
        );
      }
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

  const telemetryPath = 'src/lead-recommendation-telemetry.ts';
  const telemetry = source(telemetryPath);
  assert.equal(hasTenantBoundRawMutation(telemetry), false,
    `${telemetryPath}: telemetry no puede emitir raw tenant mutations.`);
  assert.equal(telemetry.includes('/rest/v1/propcontrol_records'), false,
    `${telemetryPath}: endpoint raw propcontrol_records está prohibido.`);
  assert.doesNotMatch(telemetry, /method\s*:\s*['"](?:POST|PATCH|PUT|DELETE)['"]/,
    `${telemetryPath}: raw mutation HTTP está prohibida.`);
  const telemetryWriterBindings = localImportBindingsFrom(telemetryPath, 'tenant-cloud-data.js');
  const writerLocal = [...telemetryWriterBindings.entries()]
    .find(([, imported]) => imported === 'insertTenantCloudRecordsIgnoreDuplicates')?.[0];
  assert.ok(writerLocal,
    `${telemetryPath}: debe importar insertTenantCloudRecordsIgnoreDuplicates desde tenant-cloud-data.`);
  assert.ok(callExpressionsByIdentifier(parseSource(telemetryPath), writerLocal).length >= 1,
    `${telemetryPath}: debe usar el writer append-only canónico importado.`);
});

test('A3.3 Guard 8: UI/comercial no importa raw cloud adapters y legacy UI permanece unreachable', () => {
  const unsafeRawModules = [
    'tenant-cloud-data.js',
    'tenant-visit-v2.js',
    'visit-transaction-cloud.js',
  ];
  for (const path of runtimeSourcePaths()) {
    const isUiOrCommercial = /(?:-ui|^src\/mvp-|commercial-(?:close|mutation))/.test(path);
    if (!isUiOrCommercial || path === LEGACY_TEAM_UI) continue;
    const parsed = parseSource(path);
    for (const moduleName of unsafeRawModules) {
      assert.equal(
        importsModule(parsed, moduleName),
        false,
        `${path}: UI/comercial importa raw adapter ${moduleName}; debe atravesar el adapter/cutover autorizado.`,
      );
    }
  }

  for (const path of runtimeSourcePaths()) {
    if (path === LEGACY_CLOUD_API || path === LEGACY_VISIT_MODULE) continue;
    const directImports = directCloudApiValueImports(path);
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
  for (const path of runtimeSourcePaths()) {
    if (path === LEGACY_TEAM_UI) continue;
    assert.equal(
      importsModule(parseSource(path), 'team-ui.js'),
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