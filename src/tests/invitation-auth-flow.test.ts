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

test('el bootstrap intercepta la invitación antes de cargar el CRM', () => {
  const bootstrap = readFileSync('src/mvp-bootstrap.ts', 'utf8');
  const html = readFileSync('index.html', 'utf8');
  assert.ok(bootstrap.includes('isInvitationPage()'));
  assert.ok(bootstrap.includes('renderInvitationAuth(root)'));
  assert.ok(bootstrap.includes("import('./mvp-main.js')"));
  assert.ok(html.includes('/dist/mvp-bootstrap.js'));
});
