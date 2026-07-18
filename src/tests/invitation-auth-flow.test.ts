import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseInvitationFragment } from '../invitation-auth.js';

test('interpreta una devolución de invitación válida sin perder tokens', () => {
  const parsed = parseInvitationFragment('#access_token=access-123&refresh_token=refresh-456&type=invite&expires_in=3600');
  assert.equal(parsed.type, 'invite');
  assert.equal(parsed.accessToken, 'access-123');
  assert.equal(parsed.refreshToken, 'refresh-456');
  assert.equal(parsed.expiresIn, 3600);
  assert.equal(parsed.errorCode, '');
});

test('interpreta errores de invitación vencida para mostrar un mensaje seguro', () => {
  const parsed = parseInvitationFragment('#error=access_denied&error_code=otp_expired&error_description=Invite%20expired');
  assert.equal(parsed.errorCode, 'otp_expired');
  assert.equal(parsed.errorDescription, 'Invite expired');
  assert.equal(parsed.accessToken, '');
});

test('la contraseña se actualiza con la sesión del invitado y sin clave secreta en el navegador', () => {
  const source = readFileSync('src/invitation-auth.ts', 'utf8');
  assert.ok(source.includes("fetch(`${config.url}/auth/v1/user`"));
  assert.ok(source.includes("method: 'PUT'"));
  assert.ok(source.includes("Authorization: `Bearer ${session.accessToken}`"));
  assert.ok(source.includes("localStorage.removeItem(INVITATION_KEY)"));
  assert.ok(!source.includes('SUPABASE_SECRET_KEY'));
  assert.ok(!source.includes('service_role'));
});

test('la aceptación activa la membresía antes de entrar al CRM', () => {
  const source = readFileSync('src/invitation-auth.ts', 'utf8');
  const migration = readFileSync('supabase/migrations/20260713_auth_multiusuario_rls.sql', 'utf8');
  const passwordUpdate = source.indexOf("fetch(`${config.url}/auth/v1/user`");
  const activation = source.indexOf('/rest/v1/rpc/activate_my_organization_memberships');
  const cleanup = source.indexOf('localStorage.removeItem(INVITATION_KEY)');
  assert.ok(passwordUpdate >= 0);
  assert.ok(activation > passwordUpdate);
  assert.ok(cleanup > activation);
  assert.ok(source.includes("method: 'POST'"));
  assert.ok(source.includes("Authorization: `Bearer ${session.accessToken}`"));
  assert.ok(migration.includes('create or replace function public.activate_my_organization_memberships()'));
  assert.ok(migration.includes("set status = 'active', last_active_at = now()"));
  assert.ok(migration.includes('where user_id = auth.uid()'));
});

test('los mensajes externos se escapan antes de insertarse en la pantalla', () => {
  const source = readFileSync('src/mvp-invitation-auth.ts', 'utf8');
  assert.ok(source.includes("import { escapeHtml } from './utils.js'"));
  assert.ok(source.includes('${escapeHtml(message)}'));
});

test('el MVP intercepta la invitación antes de cargar login o CRM', () => {
  const main = readFileSync('src/mvp-main.ts', 'utf8');
  const invitationCheck = main.indexOf('if (isInvitationPage())');
  const loginCheck = main.indexOf('if (!hasAuthenticatedSession())');
  assert.ok(main.includes("from './mvp-invitation-auth.js'"));
  assert.ok(main.includes('await renderInvitationAuth(root)'));
  assert.ok(invitationCheck >= 0);
  assert.ok(loginCheck > invitationCheck);
});
