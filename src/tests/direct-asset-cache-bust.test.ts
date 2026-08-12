import assert from 'node:assert/strict';
import { execFileSync, spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { staticCacheControl } from '../server/request-helpers.js';

const guardScript = join(process.cwd(), 'scripts', 'verify-direct-asset-cache-bust.mjs');

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function write(root: string, path: string, content: string): void {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function commit(root: string, message: string): string {
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', message]);
  return git(root, ['rev-parse', 'HEAD']);
}

function fixture(): { root: string; base: string } {
  const root = mkdtempSync(join(tmpdir(), 'propcontrol-cache-bust-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'cache-bust@propcontrol.test']);
  git(root, ['config', 'user.name', 'PropControl Cache Bust Test']);
  write(root, 'index.html', [
    '<!doctype html>',
    '<link rel="stylesheet" href="/src/app.css?v=1">',
    '<script type="module" src="/dist/app.js?v=1"></script>',
  ].join('\n'));
  write(root, 'src/app.css', 'body { color: black; }\n');
  write(root, 'src/app.ts', "import './indirect.js';\nconsole.log('base');\n");
  write(root, 'src/indirect.ts', 'export const indirect = 1;\n');
  return { root, base: commit(root, 'base') };
}

function guard(root: string, base: string, head: string, env: NodeJS.ProcessEnv = process.env) {
  return spawnSync(process.execPath, [guardScript, '--base', base, '--head', head], {
    cwd: root,
    encoding: 'utf8',
    env,
  });
}

function guardCi(root: string, eventName: string, event: unknown) {
  const eventPath = join(root, 'github-event.json');
  writeFileSync(eventPath, JSON.stringify(event));
  return spawnSync(process.execPath, [guardScript, '--ci'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, GITHUB_EVENT_NAME: eventName, GITHUB_EVENT_PATH: eventPath },
  });
}

function withFixture(run: (fixture: { root: string; base: string }) => void): void {
  const current = fixture();
  try { run(current); } finally { rmSync(current.root, { recursive: true, force: true }); }
}

function assertPass(result: SpawnSyncReturns<string>): void {
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(String(result.stdout), /CACHE-BUST OK/);
}

function assertFail(result: SpawnSyncReturns<string>, expected: RegExp): void {
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.match(String(result.stderr), expected);
}

test('A. asset CSS directo sin cambios => PASS', () => withFixture(({ root, base }) => {
  write(root, 'README.md', 'cambio sin assets\n');
  assertPass(guard(root, base, commit(root, 'A')));
}));

test('B. asset CSS directo cambia con el mismo ?v= => FAIL preciso', () => withFixture(({ root, base }) => {
  write(root, 'src/app.css', 'body { color: red; }\n');
  const result = guard(root, base, commit(root, 'B'));
  assertFail(result, /CACHE-BUST BLOQUEADO: src\/app\.css cambió pero \/src\/app\.css conserva \?v=1/);
}));

test('C. asset CSS directo cambia y cambia ?v= => PASS', () => withFixture(({ root, base }) => {
  write(root, 'src/app.css', 'body { color: red; }\n');
  write(root, 'index.html', '<link rel="stylesheet" href="/src/app.css?v=2">\n<script type="module" src="/dist/app.js?v=1"></script>\n');
  assertPass(guard(root, base, commit(root, 'C')));
}));

test('D. TS top-level de JS directo cambia con el mismo ?v= => FAIL preciso', () => withFixture(({ root, base }) => {
  write(root, 'src/app.ts', "import './indirect.js';\nconsole.log('cambió');\n");
  const result = guard(root, base, commit(root, 'D'));
  assertFail(result, /CACHE-BUST BLOQUEADO: src\/app\.ts cambió pero \/dist\/app\.js conserva \?v=1/);
}));

test('E. TS top-level de JS directo cambia y cambia ?v= => PASS', () => withFixture(({ root, base }) => {
  write(root, 'src/app.ts', "import './indirect.js';\nconsole.log('cambió');\n");
  write(root, 'index.html', '<link rel="stylesheet" href="/src/app.css?v=1">\n<script type="module" src="/dist/app.js?v=2"></script>\n');
  assertPass(guard(root, base, commit(root, 'E')));
}));

test('F. módulo ESM indirecto cambia => PASS sin exigir bump del padre', () => withFixture(({ root, base }) => {
  write(root, 'src/indirect.ts', 'export const indirect = 2;\n');
  assertPass(guard(root, base, commit(root, 'F')));
}));

test('G. asset directo versionado nuevo con fuente coherente => PASS', () => withFixture(({ root, base }) => {
  write(root, 'src/new.css', '.new { display: block; }\n');
  write(root, 'index.html', [
    '<link rel="stylesheet" href="/src/app.css?v=1">',
    '<link rel="stylesheet" href="/src/new.css?v=1">',
    '<script type="module" src="/dist/app.js?v=1"></script>',
  ].join('\n'));
  assertPass(guard(root, base, commit(root, 'G')));
}));

test('H. asset directo versionado conserva política immutable', () => {
  assert.equal(staticCacheControl('/src/app.css?v=1', '.css'), 'public, max-age=31536000, immutable');
  assert.equal(staticCacheControl('/dist/app.js?v=1', '.js'), 'public, max-age=31536000, immutable');
});

test('I. asset sin versión conserva política no-store', () => {
  assert.equal(staticCacheControl('/src/app.css', '.css'), 'no-store, no-cache, must-revalidate, max-age=0');
  assert.equal(staticCacheControl('/dist/app.js', '.js'), 'no-store, no-cache, must-revalidate, max-age=0');
});

test('J. HTML conserva política no-cache incluso con ?v=', () => {
  assert.equal(staticCacheControl('/index.html', '.html'), 'no-store, no-cache, must-revalidate, max-age=0');
  assert.equal(staticCacheControl('/index.html?v=1', '.html'), 'no-store, no-cache, must-revalidate, max-age=0');
});

test('CI pull_request compara base.sha contra head.sha reales del evento', () => withFixture(({ root, base }) => {
  write(root, 'README.md', 'pr\n');
  const head = commit(root, 'pr');
  const result = guardCi(root, 'pull_request', { pull_request: { base: { sha: base }, head: { sha: head } } });
  assertPass(result);
}));

test('CI push compara before contra after y detecta un bump faltante', () => withFixture(({ root, base }) => {
  write(root, 'src/app.css', 'body { color: red; }\n');
  const head = commit(root, 'push');
  const result = guardCi(root, 'push', { before: base, after: head });
  assertFail(result, /src\/app\.css cambió pero \/src\/app\.css conserva \?v=1/);
}));

test('CI schedule y workflow_dispatch no inventan un BASE frágil', () => withFixture(({ root }) => {
  for (const eventName of ['schedule', 'workflow_dispatch']) {
    const result = guardCi(root, eventName, {});
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(String(result.stdout), /no representa un diff de publicación; verificación comparativa omitida/);
  }
}));

test('CI push sin before comparable omite el diff de forma explícita', () => withFixture(({ root, base }) => {
  const result = guardCi(root, 'push', { before: '0000000000000000000000000000000000000000', after: base });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(String(result.stdout), /push sin BASE comparable/);
}));
