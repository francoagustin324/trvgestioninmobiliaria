import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const base = 'f4bbf63b179c575b9841532054beabc9b7f7598f';
const expected = [
  'src/legacy-quarantine/team-bootstrap.ts',
  'src/legacy-quarantine/team-scope.ts',
  'src/legacy-quarantine/team-ui.ts',
  'src/legacy-quarantine/visit-authority-sync-version.ts',
];

if (fs.existsSync('src/team-bootstrap.ts')) throw new Error('top-level team-bootstrap still exists');
if (fs.existsSync('src/team-ui.ts')) throw new Error('top-level team-ui still exists');
for (const file of expected) if (!fs.existsSync(file)) throw new Error(`missing quarantine file: ${file}`);

const actual = fs.readdirSync('src/legacy-quarantine')
  .filter((name) => name.endsWith('.ts'))
  .map((name) => `src/legacy-quarantine/${name}`)
  .sort();
if (JSON.stringify(actual) !== JSON.stringify(expected.slice().sort())) {
  throw new Error(`quarantine set mismatch: ${JSON.stringify(actual)}`);
}
console.log(`TEAM_QUARANTINE_EXACT_SET=${actual.length}/4 PASS`);

const oldBootstrap = execFileSync('git', ['show', `${base}:src/team-bootstrap.ts`], { encoding: 'utf8' });
const newBootstrap = fs.readFileSync('src/legacy-quarantine/team-bootstrap.ts', 'utf8')
  .replaceAll("from '../store.js'", "from './store.js'")
  .replaceAll("from '../team-access.js'", "from './team-access.js'");
if (oldBootstrap !== newBootstrap) throw new Error('team-bootstrap changed beyond required import paths');

const oldUi = execFileSync('git', ['show', `${base}:src/team-ui.ts`], { encoding: 'utf8' });
const newUi = fs.readFileSync('src/legacy-quarantine/team-ui.ts', 'utf8')
  .replaceAll("from '../models.js'", "from './models.js'")
  .replaceAll("from '../cloud-api.js'", "from './cloud-api.js'")
  .replaceAll("from '../tenant-runtime.js'", "from './tenant-runtime.js'")
  .replaceAll("from '../store.js'", "from './store.js'")
  .replaceAll("from '../team-access.js'", "from './team-access.js'")
  .replaceAll("from '../utils.js'", "from './utils.js'");
if (oldUi !== newUi) throw new Error('team-ui changed beyond required import paths');
console.log('TEAM_QUARANTINE_BYTE_EQUIVALENT_EXCEPT_IMPORT_PATHS=PASS');

const forbiddenDiff = execFileSync('git', ['diff', '--name-only', `${base}..HEAD`], { encoding: 'utf8' })
  .trim().split(/\r?\n/).filter(Boolean)
  .filter((name) => /(^|\/)(supabase|migrations?|baseline)(\/|$)|\.sql$/i.test(name));
if (forbiddenDiff.length) throw new Error(`forbidden SQL/migration/baseline diff: ${forbiddenDiff.join(', ')}`);
console.log('SQL_MIGRATIONS_BASELINE=0');
