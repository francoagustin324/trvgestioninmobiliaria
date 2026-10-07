import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const runtimeFiles = [
  'src/agenda-ui.ts',
  'src/followup-persistence.ts',
  'src/lead-qualification-ui.ts',
  'src/lead-recommendation-instrumentation.ts',
  'src/lead-source-reactivation-ui.ts',
  'src/mvp-leads-ui.ts',
  'src/mvp-properties-ui.ts',
  'src/mvp-users-ui.ts',
  'src/offer-workflow-ui.ts',
  'src/reservation-workflow-ui.ts',
  'src/visit-workflow-cutover.ts',
  'src/whatsapp-contact.ts',
  'src/whatsapp-human-identity.ts',
] as const;

function source(path: string): string {
  return readFileSync(path, 'utf8');
}

function section(text: string, start: string, end?: string): string {
  const from = text.indexOf(start);
  assert.notEqual(from, -1, `No se encontró inicio: ${start}`);
  const to = end ? text.indexOf(end, from + start.length) : -1;
  return text.slice(from, to === -1 ? undefined : to);
}

test('A3.2 static negative: superficies migradas no usan identidad visual como write authority', () => {
  const forbidden = [
    /createdById\s*:\s*state\.activeMemberId/g,
    /createdById\s*:\s*activeMember\(\)\.id/g,
    /assignedToId\s*:\s*state\.activeMemberId/g,
    /assignedToId\s*:\s*activeMember\(\)\.id/g,
    /actorId\s*:\s*state\.activeMemberId/g,
    /actorId\s*:\s*activeMember\(\)\.id/g,
    /actor\s*:\s*\{[^}]*id\s*:\s*state\.activeMemberId/gs,
    /actor\s*:\s*\{[^}]*id\s*:\s*activeMember\(\)\.id/gs,
  ];
  for (const path of runtimeFiles) {
    const text = source(path);
    for (const pattern of forbidden) {
      pattern.lastIndex = 0;
      assert.equal(pattern.test(text), false, `${path} conserva identidad visual en una posición de escritura: ${pattern}`);
    }
    assert.equal(text.includes('TEAM_VIEW_KEY'), false, `${path} no debe usar TEAM_VIEW_KEY como autoridad.`);
  }
});

test('A3.2 static negative: no aparecen writers implícitos, first-membership ni raw tenant discovery nuevos', () => {
  for (const path of runtimeFiles) {
    const text = source(path);
    assert.equal(/queueCloudSave\s*\(\s*(?:state\.)?crm\s*[,)]/.test(text), false, `${path} no debe reintroducir queueCloudSave(crm) implícito.`);
    assert.equal(text.includes('getCloudMembershipContext'), false, `${path} no debe descubrir tenant por membership legacy.`);
    assert.equal(text.includes('fetchMembershipRows'), false, `${path} no debe descubrir tenant por first-membership.`);
    assert.equal(/organization_members[^\n]{0,240}(?:limit\s*=\s*1|\.limit\(1\)|\[0\])/.test(text), false, `${path} no debe usar first-membership como autoridad.`);
  }
});

test('A3.2 Properties: create usa miembro autenticado, edit preserva metadata y stale lease queda cercado', () => {
  const text = source('src/mvp-properties-ui.ts');
  assert.match(text, /function propertyFormWriteContext[\s\S]*authenticatedTenantMember\(context\.scope\)/);
  assert.match(text, /function capturePropertyFormWriteContext[\s\S]*const scope = requireCurrentTenantScope\(\)[\s\S]*captureTenantRuntimeLease\(scope\)[\s\S]*assertTenantCrmScope\(scope,\s*state\.crm\)/);
  assert.match(text, /assignedToId:\s*editing\?\.assignedToId\s*\?\?\s*writeContext\.member\.id/);
  assert.match(text, /createdById:\s*editing\?\.createdById\s*\?\?\s*writeContext\.member\.id/);
  assert.match(text, /assertTenantRuntimeLeaseCurrent\(writeContext\.runtimeLease\)/);
  assert.match(text, /assertTenantCrmScope\(writeContext\.scope,\s*state\.crm\)/);
  const submit = section(text, "form?.addEventListener('submit'", '\n  });\n}');
  assert.equal(submit.includes('state.activeMemberId'), false);
  assert.equal(submit.includes('activeMember()'), false);
});

test('A3.2 Agenda: creator/default assignee y Activities se atan al actor autenticado del render scope', () => {
  const text = source('src/agenda-ui.ts');
  assert.match(text, /function agendaWriteMember\(scope:\s*TenantScope,\s*runtimeLease:\s*TenantRuntimeLease\)[\s\S]*assertTenantRuntimeLeaseCurrent\(runtimeLease\)[\s\S]*assertTenantCrmScope\(scope,\s*state\.crm\)[\s\S]*authenticatedTenantMember\(scope\)/);
  assert.match(text, /const renderScope = requireCurrentTenantScope\(\)/);
  assert.match(text, /const renderLease = captureTenantRuntimeLease\(renderScope\)/);
  assert.match(text, /assignedToId:\s*existing\?\.assignedToId\s*\?\?\s*agendaWriteMember\(renderScope,\s*renderLease\)\.id/);
  assert.match(text, /createdById:\s*existing\?\.createdById\s*\?\?\s*agendaWriteMember\(renderScope,\s*renderLease\)\.id/);
  assert.match(text, /addActivityForAuthenticatedTenant\(renderScope,\s*result\.activity\)/);
  assert.equal(/addActivity\(result\.activity\)/.test(text), false);
});

test('A3.2 Offers y Reservations: mutation actor sale del authenticated tenant member, no de la vista', () => {
  for (const path of ['src/offer-workflow-ui.ts', 'src/reservation-workflow-ui.ts']) {
    const text = source(path);
    assert.match(text, /authenticatedTenantMember\([^)]*scope\)/, `${path} debe resolver miembro autenticado.`);
    assert.match(text, /captureTenantRuntimeLease\(/, `${path} debe capturar lease.`);
    assert.match(text, /assertTenantRuntimeLeaseCurrent\(/, `${path} debe validar lease.`);
    assert.match(text, /id:\s*context\.member\.id/, `${path} debe pasar member.id autenticado al workflow.`);
    assert.match(text, /role:\s*context\.member\.role/, `${path} debe pasar member.role autenticado al workflow.`);
    const mutationArea = section(text, "addEventListener('submit'", undefined);
    assert.equal(mutationArea.includes('state.activeMemberId'), false, `${path} submit no puede usar activeMemberId.`);
  }
});

test('A3.2 Qualification/Reactivation: session A/B y Activity usan tenant autenticado', () => {
  const qualification = source('src/lead-qualification-ui.ts');
  assert.match(qualification, /JSON\.stringify\(\[scope\.userId,\s*scope\.organizationId,\s*clientId\]\)/);
  assert.match(qualification, /addActivityForAuthenticatedTenant\(scope,\s*activity\)/);
  assert.equal(qualification.includes("addActivity(activity)"), false);

  const reactivation = source('src/lead-source-reactivation-ui.ts');
  assert.match(reactivation, /addActivityForAuthenticatedTenant\(/);
  assert.match(reactivation, /requireCurrentTenantScope\(\)/);
});

test('A3.2 WhatsApp/contact: identidad humana y persistencia conservan tenant autenticado exacto', () => {
  const identity = source('src/whatsapp-human-identity.ts');
  assert.match(identity, /try \{ scope = requireCurrentTenantScope\(\); \} catch \{/);
  assert.match(identity, /assertTenantCrmScope\(scope,\s*state\.crm\)/);
  assert.match(identity, /authenticatedTenantMember\(scope\)/);
  assert.match(identity, /session && session\.userId !== scope\.userId/);
  assert.match(identity, /organizationId:\s*scope\.organizationId/);
  assert.match(identity, /actorId:\s*context\.member\.id/);
  assert.match(identity, /whatsappIdentityStorageKey\([\s\S]*context\.organizationId,[\s\S]*context\.member\.id,[\s\S]*context\.actorKey/);
  assert.equal(identity.includes('activeMember()'), false);
  assert.equal(identity.includes('state.activeMemberId'), false);

  const contact = source('src/whatsapp-contact.ts');
  assert.match(contact, /authenticatedTenantMember\(scope\)/);
  assert.match(contact, /state\.crm\.organization\.id/);
  assert.match(contact, /addActivityForAuthenticatedTenant\(requireCurrentTenantScope\(\)/);
  assert.equal(/actorId\s*:\s*activeMember\(\)\.id/.test(contact), false);
});

test('A3.2 Visit cutover: historical/local actor autenticado y V2 preserva scope + lease sin legacy first-membership', () => {
  const text = source('src/visit-workflow-cutover.ts');
  assert.match(text, /function historicalCoordinate[\s\S]*authenticatedTenantMember\(scope\)[\s\S]*actor:\s*\{\s*id:\s*actor\.id,\s*role:\s*actor\.role\s*\}/);
  assert.match(text, /function historicalResolve[\s\S]*authenticatedTenantMember\(scope\)[\s\S]*actor:\s*\{\s*id:\s*actor\.id,\s*role:\s*actor\.role\s*\}/);
  assert.match(text, /visitTransactionAuthorityActiveV2\(scope,\s*runtimeLease\)/);
  assert.match(text, /invokeVisitTransactionV2\(scope,[\s\S]*runtimeLease\)/);
  assert.match(text, /queueCloudSave\(runtimeLease\.scope,\s*state\.crm,\s*true\)/);
  assert.equal(text.includes('visit-transaction-cloud'), false);
  assert.equal(text.includes('getCloudMembershipContext'), false);
  assert.equal(text.includes('activeMember()'), false);
});

test('A3.2 Follow-up: tenant storage exacto, rollback tenant-bound y cero storage user-only directo', () => {
  const text = source('src/followup-persistence.ts');
  assert.match(text, /readTenantSnapshot\(scope\)/);
  assert.match(text, /function rollback\(previous:\s*CrmData,\s*scope:\s*TenantScope,\s*runtimeLease:\s*TenantRuntimeLease\)[\s\S]*tenantRuntimeLeaseIsCurrent\(runtimeLease\)[\s\S]*assertTenantRuntimeLeaseCurrent\(runtimeLease\)[\s\S]*assertTenantCrmScope\(scope,\s*previous\)[\s\S]*state\.crm = previous[\s\S]*writeTenantSnapshot\(scope,\s*previous,/);
  assert.match(text, /catch \(error\)[\s\S]*rollback\(previous,\s*scope,\s*runtimeLease\)/);
  assert.equal(text.includes('readLocalSnapshot'), false);
  assert.equal(text.includes('writeLocalSnapshot'), false);
  assert.equal(text.includes("from './sync-safety.js'"), false);
});

test('A3.2 Team: invite/role/status reciben renderScope + renderLease y revalidan actor autenticado', () => {
  const text = source('src/mvp-users-ui.ts');
  assert.match(text, /const renderScope = requireCurrentTenantScope\(\)/);
  assert.match(text, /const renderLease = captureTenantRuntimeLease\(renderScope\)/);
  assert.match(text, /authenticatedTeamActor\(renderScope,\s*renderLease\)/);
  assert.match(text, /inviteTeamMember\([^;]*renderScope,\s*renderLease\)/s);
  assert.match(text, /updateTeamMemberAccess\(id,\s*\{ role:\s*nextRole \},\s*renderScope,\s*renderLease\)/);
  assert.match(text, /updateTeamMemberAccess\(id,\s*\{ status \},\s*renderScope,\s*renderLease\)/);
  assert.match(text, /assertTenantRuntimeLeaseCurrent\(runtimeLease\)/);
  assert.match(text, /assertTenantCrmScope\(scope,\s*state\.crm\)/);
});
