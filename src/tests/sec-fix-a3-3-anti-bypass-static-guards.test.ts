import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import test from 'node:test';
import * as ts from 'typescript';

const SRC_ROOT = 'src';
const LEGACY_CLOUD_API = 'src/cloud-api.ts';
const LEGACY_VISIT_MODULE = 'src/visit-transaction-cloud.ts';
const LEGACY_TEAM_UI = 'src/team-ui.ts';
const QUARANTINE_ROOT = 'src/legacy-quarantine/';
const QUARANTINED_LEGACY_MODULES = new Set([
  'src/legacy-quarantine/visit-authority-sync-version.ts',
  'src/legacy-quarantine/team-scope.ts',
]);
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

const TENANT_TABLE_ENDPOINTS = [
  '/rest/v1/propcontrol_records',
  '/rest/v1/fichas',
  '/rest/v1/organization_members',
  '/rest/v1/public_property_fichas',
] as const;
const MUTATION_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

type NamedImportBinding = Readonly<{
  imported: string;
  local: string;
  isTypeOnly: boolean;
}>;

type RawTenantMutation = Readonly<{
  endpoint: string;
  method: string;
  line: number;
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
      && ts.isStringLiteralLike(node.arguments[0]!)
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

function resolveRelativeSourceModule(fromPath: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const joined = normalizedPath(join(dirname(fromPath), specifier));
  if (joined.endsWith('.js')) return joined.replace(/\.js$/, '.ts');
  if (joined.endsWith('.ts')) return joined;
  return `${joined}.ts`;
}

function quarantineModuleEdges(path: string, parsed = parseSource(path)): string[] {
  const hits = new Set<string>();
  const inspect = (specifier: string): void => {
    const resolved = resolveRelativeSourceModule(path, specifier);
    if (resolved && QUARANTINED_LEGACY_MODULES.has(resolved)) hits.add(resolved);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      inspect(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      inspect(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments.length === 1
      && ts.isStringLiteralLike(node.arguments[0]!)
    ) {
      inspect(node.arguments[0]!.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return [...hits].sort();
}

function quarantineLoaderLiterals(path: string): string[] {
  const parsed = parseSource(path);
  const hits = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node) && node.text.includes('legacy-quarantine/')) hits.add(node.text);
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return [...hits].sort();
}

function nearestVariableInitializer(
  parsed: ts.SourceFile,
  identifier: string,
  beforePosition: number,
): ts.Expression | null {
  const matches: Array<{ position: number; initializer: ts.Expression }> = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.name.text === identifier
      && node.initializer
      && node.getStart(parsed) < beforePosition
    ) {
      matches.push({ position: node.getStart(parsed), initializer: node.initializer });
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  matches.sort((left, right) => right.position - left.position);
  return matches[0]?.initializer ?? null;
}

function staticStringValue(
  parsed: ts.SourceFile,
  expression: ts.Expression,
  beforePosition: number,
  seen = new Set<string>(),
): string | null {
  const value = unwrapExpression(expression);
  if (ts.isStringLiteralLike(value)) return value.text;
  if (ts.isNoSubstitutionTemplateLiteral(value)) return value.text;
  if (ts.isTemplateExpression(value)) {
    return `${value.head.text}${value.templateSpans.map((span) => `*${span.literal.text}`).join('')}`;
  }
  if (ts.isIdentifier(value)) {
    if (seen.has(value.text)) return null;
    seen.add(value.text);
    const initializer = nearestVariableInitializer(parsed, value.text, beforePosition);
    return initializer ? staticStringValue(parsed, initializer, beforePosition, seen) : null;
  }
  return null;
}

function staticEndpointValue(
  parsed: ts.SourceFile,
  expression: ts.Expression,
  beforePosition: number,
  seen = new Set<string>(),
): string | null {
  const value = unwrapExpression(expression);
  if (ts.isNewExpression(value) && ts.isIdentifier(value.expression) && value.expression.text === 'URL') {
    const first = value.arguments?.[0];
    return first ? staticStringValue(parsed, first, beforePosition, seen) : null;
  }
  if (ts.isCallExpression(value) && ts.isIdentifier(value.expression) && value.expression.text === 'URL') {
    const first = value.arguments[0];
    return first ? staticStringValue(parsed, first, beforePosition, seen) : null;
  }
  if (ts.isIdentifier(value)) {
    if (seen.has(value.text)) return null;
    seen.add(value.text);
    const initializer = nearestVariableInitializer(parsed, value.text, beforePosition);
    return initializer ? staticEndpointValue(parsed, initializer, beforePosition, seen) : null;
  }
  return staticStringValue(parsed, value, beforePosition, seen);
}

function objectLiteralFromExpression(
  parsed: ts.SourceFile,
  expression: ts.Expression,
  beforePosition: number,
): ts.ObjectLiteralExpression | null {
  const value = unwrapExpression(expression);
  if (ts.isObjectLiteralExpression(value)) return value;
  if (ts.isIdentifier(value)) {
    const initializer = nearestVariableInitializer(parsed, value.text, beforePosition);
    if (!initializer) return null;
    const unwrapped = unwrapExpression(initializer);
    return ts.isObjectLiteralExpression(unwrapped) ? unwrapped : null;
  }
  return null;
}

function fetchMethod(parsed: ts.SourceFile, call: ts.CallExpression): string {
  const options = call.arguments[1];
  if (!options) return 'GET';
  const object = objectLiteralFromExpression(parsed, options, call.getStart(parsed));
  if (!object) return 'GET';
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) continue;
    const name = property.name && (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name))
      ? property.name.text
      : '';
    if (name !== 'method') continue;
    const expression = ts.isPropertyAssignment(property)
      ? property.initializer
      : nearestVariableInitializer(parsed, property.name.text, call.getStart(parsed));
    if (!expression) return 'GET';
    return (staticStringValue(parsed, expression, call.getStart(parsed)) || 'GET').toUpperCase();
  }
  return 'GET';
}

function rawTenantMutationRequests(parsed: ts.SourceFile): RawTenantMutation[] {
  const hits: RawTenantMutation[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'fetch'
      && node.arguments[0]
    ) {
      const endpoint = staticEndpointValue(parsed, node.arguments[0], node.getStart(parsed));
      const method = fetchMethod(parsed, node);
      if (endpoint && MUTATION_METHODS.has(method) && TENANT_TABLE_ENDPOINTS.some((table) => endpoint.includes(table))) {
        hits.push({
          endpoint,
          method,
          line: parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return hits;
}

function hasTenantBoundRawMutation(text: string, fileName = 'fixture.ts'): boolean {
  return rawTenantMutationRequests(parseText(text, fileName)).length > 0;
}

function expressionUsesMutableTenant(expression: ts.Expression, parsed: ts.SourceFile): boolean {
  return /\b(?:record|payload|form|values)\.organizationId\b/.test(expression.getText(parsed));
}

function mutableTenantAuthoritySinkHits(path: string): string[] {
  const parsed = parseSource(path);
  const rawMutation = rawTenantMutationRequests(parsed).length > 0;
  const hits: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === 'set'
      && node.arguments.length >= 2
      && ts.isStringLiteralLike(node.arguments[0]!)
      && node.arguments[0]!.text === 'organization_id'
      && expressionUsesMutableTenant(node.arguments[1]!, parsed)
    ) {
      hits.push(`organization_id query @${parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1}`);
    }
    if (ts.isPropertyAssignment(node)) {
      const name = ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name) ? node.name.text : '';
      if (name === 'p_organization_id' && expressionUsesMutableTenant(node.initializer, parsed)) {
        hits.push(`p_organization_id RPC @${parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1}`);
      }
      if (name === 'organization_id' && rawMutation && expressionUsesMutableTenant(node.initializer, parsed)) {
        hits.push(`organization_id raw row @${parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1}`);
      }
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(parsed);
      if (/tenantCloudTransport|writeTenantSnapshot|queueCloudSave/.test(callee)) {
        for (const argument of node.arguments) {
          if (expressionUsesMutableTenant(argument, parsed)) {
            hits.push(`${callee} mutable tenant @${parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1}`);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return hits;
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

test('A3.3 request-level raw mutation parser correlaciona endpoint y method del mismo fetch', () => {
  const safe = parseText(`
    const membership = new URL('/rest/v1/organization_members');
    fetch(membership, { method: 'GET' });
    fetch('/storage/v1/object/photo', { method: 'POST' });
  `);
  assert.deepEqual(rawTenantMutationRequests(safe), []);

  const membershipPost = parseText(`
    const membership = new URL('/rest/v1/organization_members');
    fetch(membership, { method: 'POST' });
  `);
  assert.deepEqual(rawTenantMutationRequests(membershipPost).map(({ method }) => method), ['POST']);

  const directDelete = parseText("fetch('/rest/v1/propcontrol_records', { method: 'DELETE' });");
  assert.deepEqual(rawTenantMutationRequests(directDelete).map(({ method }) => method), ['DELETE']);
});

test('A3.3 Guard 0: quarantine existe y ningún source productivo puede alcanzarlo', () => {
  assert.deepEqual(
    [...QUARANTINED_LEGACY_MODULES].sort(),
    [
      'src/legacy-quarantine/team-scope.ts',
      'src/legacy-quarantine/visit-authority-sync-version.ts',
    ],
    'El quarantine es un set exacto; no puede crecer implícitamente por carpeta.',
  );
  for (const quarantined of QUARANTINED_LEGACY_MODULES) {
    assert.equal(existsSync(quarantined), true, `${quarantined}: la evidencia legacy quarantine debe seguir existiendo.`);
  }

  for (const path of runtimeSourcePaths()) {
    if (QUARANTINED_LEGACY_MODULES.has(path)) continue;
    assert.deepEqual(
      quarantineModuleEdges(path),
      [],
      `${path}: no puede importar/re-exportar/dynamic-importar un módulo de legacy-quarantine.`,
    );
    assert.deepEqual(
      quarantineLoaderLiterals(path),
      [],
      `${path}: contiene un loader literal hacia legacy-quarantine.`,
    );
  }

  const fixturePath = 'src/fixture.ts';
  for (const fixture of [
    "import { x } from './legacy-quarantine/team-scope.js';",
    "import './legacy-quarantine/team-scope.js';",
    "export { x } from './legacy-quarantine/team-scope.js';",
    "void import('./legacy-quarantine/team-scope.js');",
  ]) {
    assert.deepEqual(
      quarantineModuleEdges(fixturePath, parseText(fixture, fixturePath)),
      ['src/legacy-quarantine/team-scope.ts'],
      fixture,
    );
  }

  const index = source('index.html');
  assert.doesNotMatch(index, /\/dist\/legacy-quarantine\//,
    'index.html no puede cargar ningún módulo compilado de legacy-quarantine.');
});

test('A3.3 Guard 1: visit-transaction-cloud permanece sin imports productivos', () => {
  const legacy = source(LEGACY_VISIT_MODULE);
  assert.match(legacy, /getCloudMembershipContext/,
    'El allowlist sólo es válido mientras visit-transaction-cloud siga siendo el módulo legacy identificado.');

  for (const path of runtimeSourcePaths()) {
    if (path === LEGACY_VISIT_MODULE || QUARANTINED_LEGACY_MODULES.has(path)) continue;
    assert.equal(
      importsModule(parseSource(path), 'visit-transaction-cloud.js'),
      false,
      `${path}: no puede importar el módulo legacy visit-transaction-cloud. Usá tenant-visit-v2/cutover canónico.`,
    );
  }
});

test('A3.3 Guard 2: first-membership authority queda confinada al compatibility legacy conocido', () => {
  const firstMembershipHits = runtimeSources()
    .filter(([path]) => !QUARANTINED_LEGACY_MODULES.has(path))
    .filter(([, text]) => hasFirstMembershipAuthority(text))
    .map(([path]) => path);
  assert.deepEqual(
    firstMembershipHits,
    [LEGACY_CLOUD_API],
    'organization_members + limit(1) + first-row sólo puede sobrevivir en cloud-api.ts legacy; quarantine queda unreachable por Guard 0.',
  );

  const legacyImportAllowlist = new Set([LEGACY_VISIT_MODULE]);
  for (const path of runtimeSourcePaths()) {
    if (QUARANTINED_LEGACY_MODULES.has(path)) continue;
    const importedLegacyMembership = namedImportsFrom(path, 'cloud-api.js')
      .filter((name) => LEGACY_MEMBERSHIP_SYMBOLS.has(name));
    if (importedLegacyMembership.length === 0) continue;
    assert.equal(
      legacyImportAllowlist.has(path),
      true,
      `${path}: importa discovery legacy ${importedLegacyMembership.join(', ')} desde cloud-api.ts. Consumí TenantScope/membership catalog explícito.`,
    );
  }

  const quarantinedVisit = source('src/legacy-quarantine/visit-authority-sync-version.ts');
  assert.match(quarantinedVisit, /getCloudMembershipContext\(\)/,
    'El primitive histórico se preserva sólo dentro del módulo quarantine exacto y unreachable.');

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
    if (QUARANTINED_LEGACY_MODULES.has(path)) continue;
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
    if (definitionAllowlist.has(path) || QUARANTINED_LEGACY_MODULES.has(path)) continue;
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
    if (QUARANTINED_LEGACY_MODULES.has(path)) continue;
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

  const quarantinedTeam = source('src/legacy-quarantine/team-scope.ts');
  assert.match(quarantinedTeam, /\bactiveMember\(\)/,
    'El actor visual histórico se preserva sólo en el módulo quarantine exacto y unreachable.');
  assert.match(quarantinedTeam, /\baddActivity\s*\(/,
    'El writer visual histórico se preserva sólo en el módulo quarantine exacto y unreachable.');

  const store = source('src/store.ts');
  assert.match(store, /activeMemberId \/ TEAM_VIEW_KEY remain a visual preference only and never[\s\S]*authenticatedTenantMember/);
  const legacyTeam = source(LEGACY_TEAM_UI);
  assert.match(legacyTeam, /\baddActivity\s*\(/,
    'team-ui.ts se mantiene explícitamente identificado como UI legacy antes de quarantine.');
});

test('A3.3 Guard 6: tenant de escritura no se deriva de CRM/record/payload mutable', () => {
  const forbiddenStateTenantWriters = [
    /organization_id\s*:\s*state\.crm\.organization\.id/g,
    /p_organization_id\s*:\s*state\.crm\.organization\.id/g,
    /searchParams\.set\(\s*['"]organization_id['"]\s*,\s*`[^`]*\$\{state\.crm\.organization\.id\}/g,
  ];
  const compatibility = new Set([LEGACY_CLOUD_API, LEGACY_VISIT_MODULE, LEGACY_TEAM_UI]);
  for (const [path, text] of runtimeSources()) {
    if (compatibility.has(path) || QUARANTINED_LEGACY_MODULES.has(path)) continue;
    for (const pattern of forbiddenStateTenantWriters) {
      pattern.lastIndex = 0;
      assert.equal(pattern.test(text), false,
        `${path}: tenant de escritura deriva de state.crm.organization.id; debe usar TenantScope capturado/revalidado.`);
    }
    assert.deepEqual(
      mutableTenantAuthoritySinkHits(path),
      [],
      `${path}: record/payload/form mutable alimenta un authority sink tenant-bound.`,
    );
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

  const telemetryPath = 'src/lead-recommendation-telemetry.ts';
  const telemetry = source(telemetryPath);
  assert.match(telemetry, /event\.organizationId !== authorization\.organizationId/,
    `${telemetryPath}: debe validar organization exacta antes de persistir eventos.`);
  assert.match(telemetry, /event\.actorId !== authorization\.currentMemberId/,
    `${telemetryPath}: debe validar actor exacto antes de persistir eventos.`);
  assert.match(telemetry, /insertTenantCloudRecordsIgnoreDuplicates/,
    `${telemetryPath}: debe usar adapter tenant-aware append-only.`);
  assert.equal(rawTenantMutationRequests(parseSource(telemetryPath)).length, 0,
    `${telemetryPath}: no puede contener raw tenant mutation.`);
});

test('A3.3 Guard 7: raw tenant writers sólo existen en adapters/compatibility exactos', () => {
  const hits = runtimeSourcePaths()
    .filter((path) => !QUARANTINED_LEGACY_MODULES.has(path))
    .filter((path) => rawTenantMutationRequests(parseSource(path)).length > 0);

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

  const propertyPhotoPath = 'src/server/property-photo-storage.ts';
  assert.equal(rawTenantMutationRequests(parseSource(propertyPhotoPath)).length, 0,
    `${propertyPhotoPath}: GET membership + POST storage object no puede confundirse con mutation de tabla tenant.`);

  const telemetryPath = 'src/lead-recommendation-telemetry.ts';
  const telemetry = source(telemetryPath);
  assert.equal(hasTenantBoundRawMutation(telemetry, telemetryPath), false,
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
    if (QUARANTINED_LEGACY_MODULES.has(path)) continue;
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
    if (path === LEGACY_CLOUD_API || path === LEGACY_VISIT_MODULE || QUARANTINED_LEGACY_MODULES.has(path)) continue;
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
  assert.doesNotMatch(index, /(?:\/dist\/team-ui\.js|\/dist\/visit-transaction-cloud\.js|\/dist\/legacy-quarantine\/)/,
    'Los módulos legacy/quarantine no pueden volver a publicarse como entrypoints browser.');
  const main = source('src/mvp-main.ts');
  assert.doesNotMatch(main, /team-ui|visit-transaction-cloud|legacy-quarantine/,
    'mvp-main no puede reactivar UI/Visit legacy ni quarantine.');
  for (const path of runtimeSourcePaths()) {
    if (path === LEGACY_TEAM_UI || QUARANTINED_LEGACY_MODULES.has(path)) continue;
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
  assert.deepEqual(
    paths.filter((path) => path.startsWith(QUARANTINE_ROOT)).sort(),
    [...QUARANTINED_LEGACY_MODULES].sort(),
    'No puede aparecer un tercer módulo quarantine sin autorización explícita y actualización del set exacto.',
  );
});
