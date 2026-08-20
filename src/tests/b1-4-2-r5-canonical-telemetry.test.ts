import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

test('R5 guard: una sola telemetría productiva y todos los imports apuntan al módulo canónico', () => {
  const telemetryFiles = readdirSync('src')
    .filter((name) => /^lead-recommendation-telemetry(?:-r\d+)?\.ts$/.test(name))
    .sort();
  assert.deepEqual(telemetryFiles, ['lead-recommendation-telemetry.ts']);
  assert.equal(existsSync('src/lead-recommendation-telemetry-r3.ts'), false);
  assert.equal(existsSync('src/lead-recommendation-telemetry-r4.ts'), false);

  const runtime = readFileSync('src/lead-recommendation-instrumentation.ts', 'utf8');
  assert.match(runtime, /from ['"]\.\/lead-recommendation-telemetry\.js['"]/);
  assert.equal(runtime.includes(['lead-recommendation-telemetry-', 'r3.js'].join('')), false);
  assert.equal(runtime.includes(['lead-recommendation-telemetry-', 'r4.js'].join('')), false);

  const versionedR3 = ['lead-recommendation-telemetry-', 'r3.js'].join('');
  const versionedR4 = ['lead-recommendation-telemetry-', 'r4.js'].join('');
  const offenders = readdirSync('src/tests')
    .filter((name) => name.endsWith('.test.ts'))
    .filter((name) => {
      const source = readFileSync(`src/tests/${name}`, 'utf8');
      return source.includes(versionedR3) || source.includes(versionedR4);
    });
  assert.deepEqual(offenders, []);

  for (const name of [
    'b1-4-2-supervised-recommendation-instrumentation.test.ts',
    'b1-4-2-r3-recommendation-lifecycle.test.ts',
    'b1-4-2-r4-exactly-once-coalescing.test.ts',
  ]) {
    assert.match(readFileSync(`src/tests/${name}`, 'utf8'), /\.\.\/lead-recommendation-telemetry\.js/);
  }
});
