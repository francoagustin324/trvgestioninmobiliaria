from pathlib import Path

path = Path('src/tests/sec-fix-a3-3-anti-bypass-static-guards.test.ts')
text = path.read_text()

old = """const LEGACY_TEAM_UI = 'src/team-ui.ts';
const QUARANTINE_ROOT = 'src/legacy-quarantine/';
const QUARANTINED_LEGACY_MODULES = new Set([
  'src/legacy-quarantine/visit-authority-sync-version.ts',
  'src/legacy-quarantine/team-scope.ts',
]);"""
new = """const LEGACY_TEAM_BOOTSTRAP = 'src/legacy-quarantine/team-bootstrap.ts';
const LEGACY_TEAM_UI = 'src/legacy-quarantine/team-ui.ts';
const QUARANTINE_ROOT = 'src/legacy-quarantine/';
const QUARANTINED_LEGACY_MODULES = new Set([
  'src/legacy-quarantine/team-bootstrap.ts',
  'src/legacy-quarantine/team-scope.ts',
  'src/legacy-quarantine/team-ui.ts',
  'src/legacy-quarantine/visit-authority-sync-version.ts',
]);"""
assert text.count(old) == 1, 'unexpected quarantine constants block'
text = text.replace(old, new, 1)

old = """    [
      'src/legacy-quarantine/team-scope.ts',
      'src/legacy-quarantine/visit-authority-sync-version.ts',
    ],"""
new = """    [
      'src/legacy-quarantine/team-bootstrap.ts',
      'src/legacy-quarantine/team-scope.ts',
      'src/legacy-quarantine/team-ui.ts',
      'src/legacy-quarantine/visit-authority-sync-version.ts',
    ],"""
assert text.count(old) == 1, 'unexpected Guard 0 exact set block'
text = text.replace(old, new, 1)

anchor = """  for (const fixture of [
    \"import { x } from './legacy-quarantine/team-scope.js';\",
    \"import './legacy-quarantine/team-scope.js';\",
    \"export { x } from './legacy-quarantine/team-scope.js';\",
    \"void import('./legacy-quarantine/team-scope.js');\",
  ]) {
    assert.deepEqual(
      quarantineModuleEdges(fixturePath, parseText(fixture, fixturePath)),
      ['src/legacy-quarantine/team-scope.ts'],
      fixture,
    );
  }

"""
addition = anchor + """  const internalFixture = parseText(
    \"import { renderTeam } from './team-ui.js';\",
    LEGACY_TEAM_BOOTSTRAP,
  );
  assert.deepEqual(
    quarantineModuleEdges(LEGACY_TEAM_BOOTSTRAP, internalFixture),
    [LEGACY_TEAM_UI],
    'La relación quarantine → quarantine se preserva como evidencia histórica interna.',
  );
  assert.equal(LEGACY_TEAM_BOOTSTRAP.startsWith(QUARANTINE_ROOT), true,
    'Sólo un source dentro del quarantine exacto puede conservar esta relación histórica interna.');

"""
assert text.count(anchor) == 1, 'unexpected Guard 0 fixture block'
text = text.replace(anchor, addition, 1)

old = """  const legacyTeam = source(LEGACY_TEAM_UI);
  assert.match(legacyTeam, /\\baddActivity\\s*\\(/,
    'team-ui.ts se mantiene explícitamente identificado como UI legacy antes de quarantine.');"""
new = """  const legacyTeam = source(LEGACY_TEAM_UI);
  assert.match(legacyTeam, /\\bactiveMember\\(\\)/,
    'team-ui.ts preserva activeMember únicamente dentro del quarantine exacto y unreachable.');
  assert.match(legacyTeam, /\\baddActivity\\s*\\(/,
    'team-ui.ts preserva addActivity únicamente dentro del quarantine exacto y unreachable.');"""
assert text.count(old) == 1, 'unexpected Guard 5 legacy team block'
text = text.replace(old, new, 1)

start = text.index("test('A3.3 Guard 8:")
end = text.index("\n// Keep the helper", start)
replacement = """test('A3.3 Guard 8: UI/comercial no importa raw cloud adapters y Team legacy permanece quarantined', () => {
  const unsafeRawModules = [
    'tenant-cloud-data.js',
    'tenant-visit-v2.js',
    'visit-transaction-cloud.js',
  ];
  for (const path of runtimeSourcePaths()) {
    if (QUARANTINED_LEGACY_MODULES.has(path)) continue;
    const isUiOrCommercial = /(?:-ui|^src\\/mvp-|commercial-(?:close|mutation))/.test(path);
    if (!isUiOrCommercial) continue;
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

  assert.equal(existsSync('src/team-bootstrap.ts'), false,
    'src/team-bootstrap.ts top-level no puede reaparecer fuera del quarantine.');
  assert.equal(existsSync('src/team-ui.ts'), false,
    'src/team-ui.ts top-level no puede reaparecer fuera del quarantine.');
  assert.equal(existsSync(LEGACY_TEAM_BOOTSTRAP), true,
    'team-bootstrap histórico debe permanecer preservado dentro del quarantine exacto.');
  assert.equal(existsSync(LEGACY_TEAM_UI), true,
    'team-ui histórico debe permanecer preservado dentro del quarantine exacto.');

  const index = source('index.html');
  for (const forbiddenEntrypoint of [
    '/dist/team-bootstrap.js',
    '/dist/team-ui.js',
    '/dist/legacy-quarantine/team-bootstrap.js',
    '/dist/legacy-quarantine/team-ui.js',
  ]) {
    assert.equal(index.includes(forbiddenEntrypoint), false,
      `index.html no puede cargar ${forbiddenEntrypoint}.`);
  }
  assert.doesNotMatch(index, /\\/dist\\/legacy-quarantine\\//,
    'Ningún módulo quarantine puede publicarse como entrypoint browser.');

  const main = source('src/mvp-main.ts');
  assert.match(main, /import\\s*\\{\\s*renderMvpUsers\\s*\\}\\s*from\\s*['\"]\\.\\/mvp-users-ui\\.js['\"]/,
    'mvp-main debe usar la superficie moderna mvp-users-ui.');
  assert.match(main, /renderMvpUsers\\s*\\(/,
    'mvp-main debe renderizar la superficie moderna de usuarios.');
  assert.doesNotMatch(main, /team-bootstrap|team-ui|legacy-quarantine/,
    'mvp-main no puede reactivar Team legacy ni quarantine.');

  for (const path of runtimeSourcePaths()) {
    if (path.startsWith(QUARANTINE_ROOT)) continue;
    const parsed = parseSource(path);
    assert.equal(
      importsModule(parsed, 'team-bootstrap.js'),
      false,
      `${path}: no puede importar team-bootstrap legacy top-level.`,
    );
    assert.equal(
      importsModule(parsed, 'team-ui.js'),
      false,
      `${path}: no puede importar team-ui legacy top-level/quarantine.`,
    );
    for (const quarantinedTeamModule of [
      'legacy-quarantine/team-bootstrap.js',
      'legacy-quarantine/team-ui.js',
    ]) {
      assert.equal(
        importsModule(parsed, quarantinedTeamModule),
        false,
        `${path}: no puede importar ${quarantinedTeamModule}; Team legacy debe permanecer quarantined.`,
      );
    }
  }
});
"""
text = text[:start] + replacement + text[end:]

old = "'No puede aparecer un tercer módulo quarantine sin autorización explícita y actualización del set exacto.',"
new = "'No puede aparecer un quinto módulo quarantine sin autorización explícita y actualización del set exacto.',"
assert text.count(old) == 1, 'unexpected inventory message'
text = text.replace(old, new, 1)

path.write_text(text)
