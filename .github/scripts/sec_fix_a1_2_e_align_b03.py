from pathlib import Path

path = Path('src/tests/b0-3-user-onboarding.test.ts')
text = path.read_text()

old = '''test('la ruta de Equipo deriva organización y rol en el servidor', () => {
  const handlerStart = teamServer.indexOf('async function inviteMember');
  const handlerEnd = teamServer.indexOf('async function updateMember', handlerStart);
  const handler = teamServer.slice(handlerStart, handlerEnd);
  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart);
  assert.match(handler, /const requester = await requesterMembership\\(user\\.id!, options\\)/i);
  assert.match(handler, /const role = requestedRole\\(body\\.role\\)/i);
  assert.match(handler, /organization_id: requester\\.organization_id/i);
  assert.match(handler, /user_id: generated\\.userId/i);
  assert.match(handler, /role,\\s*status: 'invited'/i);
  assert.match(handler, /on_conflict', 'organization_id,user_id'/i);
  assert.match(handler, /resolution=merge-duplicates/i);
  assert.doesNotMatch(handler, /organization_id:\\s*body\\./i);
});
'''
new = '''test('la ruta de Equipo usa organización explícita validada y rol en el servidor', () => {
  const handlerStart = teamServer.indexOf('async function inviteMember');
  const handlerEnd = teamServer.indexOf('async function updateMember', handlerStart);
  const handler = teamServer.slice(handlerStart, handlerEnd);
  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart);
  assert.match(handler, /const body = await readJson\\(request\\)/i);
  assert.match(handler, /const organizationId = requestedOrganizationId\\(body\\.organizationId\\)/i);
  assert.match(handler, /const requester = await requesterMembership\\(user\\.id!, organizationId, options\\)/i);
  assert.match(handler, /const role = requestedRole\\(body\\.role\\)/i);
  assert.match(handler, /organization_id: organizationId/i);
  assert.match(handler, /user_id: generated\\.userId/i);
  assert.match(handler, /role,\\s*status: 'invited'/i);
  assert.match(handler, /on_conflict', 'organization_id,user_id'/i);
  assert.match(handler, /resolution=merge-duplicates/i);
  assert.doesNotMatch(handler, /organization_id:\\s*body\\./i);
});
'''
if text.count(old) != 1:
    raise SystemExit(f'B0.3 Team route contract match count={text.count(old)}')
text = text.replace(old, new)

old = '''test('los reintentos usan recuperación o upsert y no crean otra membresía', () => {
  const existingMember = teamServer.indexOf('const existingMember = await organizationMemberByEmail');
  const recovery = teamServer.indexOf("generateTeamLink('recovery'", existingMember);
  const seatCheck = teamServer.indexOf('await ensureSeat(requester.organization_id, options)', existingMember);
  const upsert = teamServer.indexOf("on_conflict', 'organization_id,user_id'", seatCheck);
  assert.ok(existingMember >= 0);
  assert.ok(recovery > existingMember);
  assert.ok(seatCheck > recovery);
  assert.ok(upsert > seatCheck);
});
'''
new = '''test('los reintentos usan recuperación o upsert y no crean otra membresía', () => {
  const existingMember = teamServer.indexOf('const existingMember = await organizationMemberByEmail');
  const recovery = teamServer.indexOf("generateTeamLink('recovery'", existingMember);
  const seatCheck = teamServer.indexOf('await ensureSeat(organizationId, options)', existingMember);
  const upsert = teamServer.indexOf("on_conflict', 'organization_id,user_id'", seatCheck);
  assert.ok(existingMember >= 0);
  assert.ok(recovery > existingMember);
  assert.ok(seatCheck > recovery);
  assert.ok(upsert > seatCheck);
});
'''
if text.count(old) != 1:
    raise SystemExit(f'B0.3 retry contract match count={text.count(old)}')
text = text.replace(old, new)
path.write_text(text)
