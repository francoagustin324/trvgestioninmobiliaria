import assert from 'node:assert/strict';
import test from 'node:test';
import { nextRevision } from '../sync-identity.js';

test('revision avanza de forma monotónica desde el baseline legacy', () => {
  assert.equal(nextRevision(undefined), 1);
  assert.equal(nextRevision(0), 1);
  assert.equal(nextRevision(4), 5);
  assert.throws(() => nextRevision(Number.MAX_SAFE_INTEGER), /máximo seguro/);
});
