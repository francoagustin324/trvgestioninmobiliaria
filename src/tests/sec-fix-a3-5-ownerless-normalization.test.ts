import './sec-fix-a1-2-c2-test-setup.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { initialData } from '../models.js';
import { activateStorageForTenant, state } from '../store.js';
import { canAccessSettings, canAdministerTeam, canViewAll } from '../team-access.js';
import { writeTenantSnapshot } from '../tenant-storage.js';

const USER_ID = 'a35-ownerless-agent';
const ORG_ID = '00000000-0000-0000-0000-00000000a350';
const MEMBER_ID = 350;
const scope = Object.freeze({ userId: USER_ID, organizationId: ORG_ID });

function explicitOwnerlessSnapshot() {
  const crm = structuredClone(initialData);
  crm.organization = {
    id: ORG_ID,
    name: 'A3.5 Ownerless Authority Contract',
    seatLimit: null,
    planLabel: 'Validation only',
  };
  crm.teamMembers = [{
    id: MEMBER_ID,
    userId: USER_ID,
    name: 'Authenticated Agent',
    email: 'a35-ownerless-agent@propcontrol.test',
    role: 'Corredor',
    status: 'Activo',
    createdAt: '2026-09-14T00:00:00.000Z',
  }];
  crm.activityLog = [];
  crm.clients = [];
  crm.properties = [];
  crm.visits = [];
  crm.offers = [];
  crm.reservations = [];
  crm.contacts = [];
  crm.reminders = [];
  crm.fichas = [];
  crm.conversations = [];
  return crm;
}

test('A3.5 G contract: explicit ownerless roster must never synthesize Owner authority', () => {
  localStorage.clear();
  writeTenantSnapshot(scope, explicitOwnerlessSnapshot(), {
    markDirty: true,
    reason: 'A3.5 ownerless authority contract',
    backup: false,
  });

  activateStorageForTenant(scope);

  const authenticated = state.crm.teamMembers.find((member) => member.userId === USER_ID);
  const ownerCount = state.crm.teamMembers.filter((member) => member.role === 'Dueño').length;
  const viewAll = canViewAll();
  const settings = canAccessSettings();
  const administerTeam = canAdministerTeam();

  console.log(`NORMALIZED_ROLE=${authenticated?.role ?? 'MISSING'}`);
  console.log(`OWNER_COUNT=${ownerCount}`);
  console.log(`CAN_VIEW_ALL=${viewAll ? 'YES' : 'NO'}`);
  console.log(`CAN_ACCESS_SETTINGS=${settings ? 'YES' : 'NO'}`);
  console.log(`CAN_ADMINISTER_TEAM=${administerTeam ? 'YES' : 'NO'}`);
  console.log(`ACTIVE_MEMBER_USER_ID=${state.crm.teamMembers.find((member) => member.id === state.activeMemberId)?.userId ?? 'MISSING'}`);

  assert.equal(authenticated?.role, 'Corredor');
  assert.equal(ownerCount, 0);
  assert.equal(viewAll, false);
  assert.equal(settings, false);
  assert.equal(administerTeam, false);
  assert.equal(state.crm.teamMembers.find((member) => member.id === state.activeMemberId)?.userId, USER_ID);
});
