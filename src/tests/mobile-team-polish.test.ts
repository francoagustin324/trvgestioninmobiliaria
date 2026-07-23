import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync('index.html', 'utf8');
const ui = readFileSync('src/mvp-users-ui.ts', 'utf8');
const models = readFileSync('src/models.ts', 'utf8');
const policy = readFileSync('src/team-policy.ts', 'utf8');
const css = readFileSync('src/mobile-team-polish.css', 'utf8');
const shellCss = readFileSync('src/mobile-bottom-nav.css', 'utf8');
const packageJsonText = readFileSync('package.json', 'utf8');
const packageJson = packageJsonText.toLowerCase();

test('carga el pulido móvil de Equipo después de las capas existentes', () => {
  assert.ok(html.includes('/src/mobile-team-polish.css?v=20260723-1'));
  assert.ok(html.indexOf('mobile-team-polish.css') > html.indexOf('mvp.css'));
  assert.ok(html.indexOf('mobile-team-polish.css') > html.indexOf('mobile-bottom-nav.css'));
  assert.ok(html.indexOf('mobile-team-polish.css') > html.indexOf('mobile-agenda-polish.css'));
});

test('conserva título, descripción e invitación según permisos', () => {
  assert.ok(ui.includes('<h1>Administración de usuarios</h1>'));
  assert.ok(ui.includes('Administrá accesos y roles de la inmobiliaria.'));
  assert.ok(ui.includes('data-toggle-user-form>Invitar usuario</button>'));
  assert.ok(ui.includes('const canManage = canManageTeam()'));
  assert.ok(css.includes('#equipo .mvp-page-heading'));
  assert.ok(css.includes('min-height: 46px'));
});

test('conserva avatar, iniciales, nombre y email de cada integrante', () => {
  assert.ok(ui.includes('member.name.slice(0, 2).toUpperCase()'));
  assert.ok(ui.includes('class="mvp-user-avatar"'));
  assert.ok(ui.includes('<strong>${escapeHtml(member.name)}</strong>'));
  assert.ok(ui.includes("member.email || 'Correo pendiente'"));
  assert.ok(css.includes('#equipo .mvp-user-info strong'));
  assert.ok(css.includes('#equipo .mvp-user-info span'));
  assert.ok(css.includes('overflow-wrap: anywhere'));
  assert.ok(css.includes('word-break: break-word'));
});

test('conserva selector y roles actuales sin agregar valores', () => {
  assert.ok(models.includes("export type TeamRole = 'Dueño' | 'Administrador' | 'Corredor'"));
  assert.ok(ui.includes('data-user-role="${member.id}"'));
  assert.ok(ui.includes('<option>Dueño</option>'));
  assert.ok(ui.includes('>Corredor</option>'));
  assert.ok(ui.includes('>Administrador</option>'));
  assert.ok(css.includes('#equipo .mvp-user-row > label select'));
  assert.ok(css.includes('min-height: 44px'));
});

test('conserva estados y acciones Suspender o Reactivar', () => {
  assert.ok(models.includes("export type TeamMemberStatus = 'Activo' | 'Pendiente de acceso' | 'Suspendido'"));
  assert.ok(ui.includes('class="mvp-user-status"'));
  assert.ok(ui.includes("member.status === 'Suspendido' ? 'Reactivar' : 'Suspender'"));
  assert.ok(ui.includes("const status = target.status === 'Suspendido' ? 'Activo' : 'Suspendido'"));
  assert.ok(ui.includes('data-user-status="${member.id}"'));
  assert.ok(css.includes('#equipo .mvp-user-row > button[data-user-status]'));
});

test('mantiene permisos, restricciones del dueño y ausencia de eliminación', () => {
  assert.ok(ui.includes("canManageTeam() && member.role !== 'Dueño'"));
  assert.ok(ui.includes("current.role === 'Dueño' || member.role === 'Corredor'"));
  assert.ok(ui.includes("if (!target || target.role === 'Dueño') return"));
  assert.ok(policy.includes("return role === 'Dueño' || role === 'Administrador'"));
  assert.ok(policy.includes("return !['equipo', 'reportes', 'configuracion'].includes(module)"));
  assert.equal(ui.includes('Eliminar usuario'), false);
  assert.equal(ui.includes('data-delete-user'), false);
});

test('conserva invitación, cambio de rol y acceso sin ejecutar acciones en pruebas', () => {
  assert.ok(ui.includes('void inviteTeamMember'));
  assert.ok(ui.includes('if (!canManage || !getCloudSession()) return'));
  assert.ok(ui.includes('void updateTeamMemberAccess(id, { role: select.value'));
  assert.ok(ui.includes('void updateTeamMemberAccess(id, { status })'));
  assert.ok(ui.includes("Ya existe un usuario con ese correo."));
  assert.ok(ui.includes("Ingresá para invitar"));
  assert.equal(css.includes('inviteTeamMember'), false);
  assert.equal(css.includes('updateTeamMemberAccess'), false);
});

test('respeta navegación inferior, safe area y última tarjeta accesible', () => {
  assert.ok(css.includes('scroll-margin-bottom: calc(var(--pc-mobile-nav-height, 76px) + 24px + env(safe-area-inset-bottom))'));
  assert.ok(shellCss.includes('padding: 12px 14px calc(var(--pc-mobile-nav-height) + 40px + env(safe-area-inset-bottom))'));
  assert.ok(shellCss.includes('grid-template-columns: repeat(5, minmax(0, 1fr))'));
  assert.equal(css.includes('.mobile-bottom-nav {'), false);
  assert.equal(css.includes('.mvp-content {'), false);
});

test('limita cambios a Equipo móvil y conserva stack y dependencias', () => {
  assert.ok(css.includes('@media (max-width: 720px)'));
  assert.equal(css.includes('@media (min-width: 721px)'), false);
  assert.ok(css.includes('#equipo.module-panel'));
  assert.equal(css.includes('#crm'), false);
  assert.equal(css.includes('#propiedades'), false);
  assert.equal(css.includes('#whatsapp'), false);
  assert.equal(css.includes('#agenda'), false);
  assert.equal(packageJson.includes('react'), false);
  assert.equal(packageJson.includes('tailwind'), false);
  const parsed = JSON.parse(packageJsonText);
  assert.deepEqual(Object.keys(parsed.dependencies ?? {}), ['playwright']);
});