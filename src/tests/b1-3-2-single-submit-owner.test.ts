import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function countMatches(source: string, pattern: RegExp): number {
  return [...source.matchAll(pattern)].length;
}

test('B1.3.2 exige un único propietario canónico del submit de leads', () => {
  const leadsUi = readFileSync('src/mvp-leads-ui.ts', 'utf8');
  const reliability = readFileSync('src/lead-create-reliability.ts', 'utf8');

  const localOwners = countMatches(
    leadsUi,
    /querySelector<HTMLFormElement>\('#mvp-lead-form'\)\?\.addEventListener\('submit'/g,
  );
  const globalOwners = countMatches(
    reliability,
    /document\.addEventListener\('submit',\s*submitLead,\s*true\)/g,
  );

  assert.equal(
    localOwners + globalOwners,
    1,
    `El formulario tiene ${localOwners + globalOwners} propietarios de submit: ${localOwners} local y ${globalOwners} global.`,
  );
  assert.equal(globalOwners, 0, 'El guardado no debe depender de un interceptor global en capture.');
  assert.doesNotMatch(reliability, /stopImmediatePropagation\(/, 'El flujo canónico no debe anular otro guardado.');
});
