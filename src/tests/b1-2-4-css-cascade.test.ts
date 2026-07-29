import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('la densidad de Leads se resuelve por cascada normal y no por important', () => {
  const pipeline = readFileSync('src/lead-pipeline.css', 'utf8');
  const compact = readFileSync('src/lead-list-compact.css', 'utf8');
  const polish = readFileSync('src/lead-list-polish.css', 'utf8');

  assert.match(pipeline, /\.mvp-lead-compact-card\s*\{\s*gap:10px;\s*\}/);
  assert.doesNotMatch(pipeline, /\.mvp-lead-compact-card\s*\{[^}]*!important/);
  assert.doesNotMatch(compact, /\.mvp-lead-compact-card\s*\{[^}]*!important/);
  assert.doesNotMatch(polish, /mvp-lead-card\.mvp-lead-card-with-matches\s*\{[^}]*!important/);
  assert.doesNotMatch(polish, /!important/);
});
