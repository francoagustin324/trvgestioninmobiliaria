import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const server = readFileSync('src/server/team-management.ts', 'utf8');
const client = readFileSync('src/invitation-link-ux.ts', 'utf8');
const html = readFileSync('index.html', 'utf8');

test('el servidor genera enlaces sin enviar correo', () => {
  assert.ok(server.includes('/auth/v1/admin/generate_link'));
  assert.ok(server.includes("type: 'invite' | 'recovery'"));
  assert.ok(server.includes("generateTeamLink('invite'"));
  assert.ok(server.includes("generateTeamLink('recovery'"));
  assert.ok(server.includes("`${base}/aceptar-invitacion`"));
  assert.ok(server.includes('generatedActionLink'));
  assert.ok(server.includes('inviteLink'));
  assert.ok(!server.includes('/auth/v1/invite'));
});

test('el enlace sólo se solicita después de validar sesión y permisos de equipo', () => {
  const inviteHandlerIndex = server.indexOf('async function inviteMember');
  const authIndex = server.indexOf('authenticatedUser(request, options)', inviteHandlerIndex);
  const membershipIndex = server.indexOf('requesterMembership(user.id!, options)', authIndex);
  const existingLinkIndex = server.indexOf("generateTeamLink('recovery'", membershipIndex);
  const newLinkIndex = server.indexOf("generateTeamLink('invite'", membershipIndex);
  assert.ok(inviteHandlerIndex >= 0);
  assert.ok(authIndex > inviteHandlerIndex);
  assert.ok(membershipIndex > authIndex);
  assert.ok(existingLinkIndex > membershipIndex);
  assert.ok(newLinkIndex > membershipIndex);
  assert.ok(server.includes("['owner', 'admin'].includes"));
});

test('un correo ya asociado recibe recuperación sin consumir otro cupo', () => {
  const existingIndex = server.indexOf('const existingMember = await organizationMemberByEmail');
  const recoveryIndex = server.indexOf("generateTeamLink('recovery'", existingIndex);
  const seatIndex = server.indexOf('await ensureSeat(requester.organization_id, options)', existingIndex);
  assert.ok(existingIndex >= 0);
  assert.ok(recoveryIndex > existingIndex);
  assert.ok(seatIndex > recoveryIndex);
  assert.ok(server.includes("linkType: 'recovery'"));
  assert.ok(server.includes("existingRole === 'owner'"));
  assert.ok(server.includes("normalizedRole(requester.role) === 'admin' && existingRole !== 'agent'"));
  assert.ok(server.includes('generated.userId !== existingMember.user_id'));
});

test('la interfaz intercepta el formulario y permite copiar ambos tipos de enlace', () => {
  assert.ok(client.includes("form.id !== 'mvp-user-form'"));
  assert.ok(client.includes('event.stopImmediatePropagation()'));
  assert.ok(client.includes("fetch('/api/team/invitations'"));
  assert.ok(client.includes('navigator.clipboard?.writeText'));
  assert.ok(client.includes('Copiar enlace'));
  assert.ok(client.includes('location.reload()'));
  assert.ok(client.includes("linkType?: 'invite' | 'recovery'"));
  assert.ok(client.includes("linkType === 'recovery'"));
  assert.ok(client.includes('crear o restablecer su contraseña'));
  assert.ok(!client.includes('SUPABASE_SECRET_KEY'));
  assert.ok(!client.includes('service_role'));
});

test('el navegador carga el módulo de invitaciones copiables', () => {
  assert.ok(html.includes('/dist/invitation-link-ux.js'));
});
