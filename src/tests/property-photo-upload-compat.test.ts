import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const upload = readFileSync('src/property-photo-upload.ts', 'utf8');
const server = readFileSync('src/server/property-photo-storage.ts', 'utf8');
const html = readFileSync('index.html', 'utf8');

test('el navegador no consulta directamente Supabase ni convierte el upload a base64', () => {
  assert.equal(upload.includes('getCloudMembershipContext'), false);
  assert.ok(upload.includes('getCloudSession'));
  assert.ok(upload.includes('/api/property-photos?'));
  assert.ok(upload.includes('body: photo.blob'));
  assert.equal(upload.includes('blobToDataUrl'), false);
  assert.equal(upload.includes('/rest/v1/organization_members'), false);
  assert.equal(upload.includes('/storage/v1/object/'), false);
});

test('el servidor valida membership activa exacta de usuario + inmobiliaria', () => {
  const select = "query.searchParams.set('select', 'organization_id,user_id,status')";
  const userFilter = "query.searchParams.set('user_id', `eq.${userId}`)";
  const organizationFilter = "query.searchParams.set('organization_id', `eq.${requestedOrganization}`)";
  const exactMembershipGuard = 'membershipPayload.length !== 1';
  const firstRowRead = 'const row = membershipPayload[0]';
  const organizationGuard = 'membership.organization_id !== requestedOrganization';
  const userGuard = 'membership.user_id !== userId';
  const activeGuard = "membership.status !== 'active'";
  const authorizedReturn = 'return { userId, organizationId: requestedOrganization, accessToken }';

  assert.ok(server.includes(select), 'La query debe pedir organization_id, user_id y status.');
  assert.ok(server.includes(userFilter), 'La membership debe filtrarse por el usuario autenticado exacto.');
  assert.ok(server.includes(organizationFilter), 'La membership debe filtrarse por la organización solicitada exacta.');
  assert.ok(server.includes(exactMembershipGuard), 'Debe existir exactamente una membership autorizante.');
  assert.ok(server.includes(organizationGuard), 'La fila autorizante debe pertenecer a la organización solicitada.');
  assert.ok(server.includes(userGuard), 'La fila autorizante debe pertenecer al usuario autenticado.');
  assert.ok(server.includes(activeGuard), 'Sólo status active puede satisfacer el contrato de autoridad.');
  assert.ok(server.includes(authorizedReturn), 'organizationId debe provenir de requestedOrganization ya autorizada.');
  assert.equal(server.includes('member_id'), false, 'El contrato no debe depender de member_id.');

  const userFilterIndex = server.indexOf(userFilter);
  const organizationFilterIndex = server.indexOf(organizationFilter);
  const exactMembershipGuardIndex = server.indexOf(exactMembershipGuard);
  const firstRowReadIndex = server.indexOf(firstRowRead);
  const organizationGuardIndex = server.indexOf(organizationGuard);
  const userGuardIndex = server.indexOf(userGuard);
  const activeGuardIndex = server.indexOf(activeGuard);
  const authorizedReturnIndex = server.indexOf(authorizedReturn);

  assert.ok(userFilterIndex >= 0 && userFilterIndex < exactMembershipGuardIndex);
  assert.ok(organizationFilterIndex >= 0 && organizationFilterIndex < exactMembershipGuardIndex);
  assert.ok(
    exactMembershipGuardIndex >= 0 && firstRowReadIndex > exactMembershipGuardIndex,
    'membershipPayload[0] sólo puede leerse después de exigir exactamente una fila; no selecciona tenant por first-row.',
  );
  assert.ok(organizationGuardIndex > firstRowReadIndex);
  assert.ok(userGuardIndex > firstRowReadIndex);
  assert.ok(activeGuardIndex > firstRowReadIndex);
  assert.ok(authorizedReturnIndex > activeGuardIndex);

  assert.equal(server.includes('membershipPayload.find('), false, 'No debe inferirse tenant buscando una membership cualquiera.');
  assert.equal(server.includes("membership.status === 'invited'"), false);
  assert.equal(server.includes("membership.status === 'suspended'"), false);
});

test('los bloqueos RLS se consideran estructurales y no se repiten', () => {
  assert.ok(upload.includes("'STORAGE_FORBIDDEN'"));
  assert.ok(upload.includes('blockedFatalUntil = now + 60_000'));
  assert.ok(server.includes('La política de seguridad de fotos todavía no está actualizada.'));
});

test('la versión nueva fuerza la actualización en celular', () => {
  assert.ok(html.includes('/dist/mvp-main.js?v=20260906-p1-4-a2-2-1'));
  assert.ok(html.includes('/dist/invitation-link-ux.js?v=20260802-1'));
});
