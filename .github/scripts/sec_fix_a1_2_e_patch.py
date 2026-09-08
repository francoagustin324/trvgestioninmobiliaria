from pathlib import Path
import re


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected one match, got {count}')
    return text.replace(old, new)


# cloud-api.ts: Team mutation boundary = exact TenantScope + runtime lease.
p = Path('src/cloud-api.ts')
text = p.read_text()
text = replace_once(
    text,
    "import type { CrmData, TeamMember, TeamRole, TeamMemberStatus } from './models.js';\n",
    "import type { TenantScope } from './active-organization.js';\n"
    "import type { CrmData, TeamMember, TeamRole, TeamMemberStatus } from './models.js';\n",
    'cloud-api imports',
)
text = replace_once(
    text,
    "import { initialData } from './models.js';\n",
    "import { initialData } from './models.js';\n"
    "import {\n"
    "  assertTenantRuntimeLeaseCurrent,\n"
    "  captureTenantRuntimeLease,\n"
    "  requireCurrentTenantScope,\n"
    "  TENANT_RUNTIME_SESSION_MISMATCH,\n"
    "  type TenantRuntimeLease,\n"
    "} from './tenant-runtime.js';\n",
    'cloud-api runtime imports',
)
old_team = '''async function teamMutation(path: string, method: 'POST' | 'PATCH', payload: unknown): Promise<TeamMember> {
  const session = await requireSession();
  const response = await parseResponse(await fetch(path, {
    method,
    headers: { Authorization: `Bearer ${session.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })) as TeamMutationResponse;
  if (!response.success || !response.member) throw new Error(response.error || 'No se pudo actualizar el equipo.');
  return mapMutationMember(response.member);
}

export async function inviteTeamMember(input: { name: string; email: string; phone?: string; role: Exclude<TeamRole, 'Dueño'> }): Promise<TeamMember> {
  return teamMutation('/api/team/invitations', 'POST', input);
}

export async function updateTeamMemberAccess(memberId: number, input: { role?: Exclude<TeamRole, 'Dueño'>; status?: TeamMemberStatus }): Promise<TeamMember> {
  return teamMutation(`/api/team/members/${memberId}`, 'PATCH', input);
}
'''
new_team = '''export const TENANT_TEAM_RESPONSE_ORGANIZATION_MISMATCH = 'TENANT_TEAM_RESPONSE_ORGANIZATION_MISMATCH';

async function teamMutation(
  scope: TenantScope,
  runtimeLease: TenantRuntimeLease,
  path: string,
  method: 'POST' | 'PATCH',
  payload: Record<string, unknown>,
): Promise<TeamMember> {
  assertTenantRuntimeLeaseCurrent(runtimeLease);
  const session = await requireSession();
  assertTenantRuntimeLeaseCurrent(runtimeLease);
  if (session.userId !== scope.userId) throw new Error(TENANT_RUNTIME_SESSION_MISMATCH);

  const response = await parseResponse(await fetch(path, {
    method,
    headers: { Authorization: `Bearer ${session.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, organizationId: scope.organizationId }),
  })) as TeamMutationResponse;

  assertTenantRuntimeLeaseCurrent(runtimeLease);
  if (!response.success || !response.member) throw new Error(response.error || 'No se pudo actualizar el equipo.');
  if (response.member.organization_id !== scope.organizationId) {
    throw new Error(TENANT_TEAM_RESPONSE_ORGANIZATION_MISMATCH);
  }
  assertTenantRuntimeLeaseCurrent(runtimeLease);
  return mapMutationMember(response.member);
}

export async function inviteTeamMember(
  input: { name: string; email: string; phone?: string; role: Exclude<TeamRole, 'Dueño'> },
  scope: TenantScope = requireCurrentTenantScope(),
  runtimeLease: TenantRuntimeLease = captureTenantRuntimeLease(scope),
): Promise<TeamMember> {
  return teamMutation(scope, runtimeLease, '/api/team/invitations', 'POST', input);
}

export async function updateTeamMemberAccess(
  memberId: number,
  input: { role?: Exclude<TeamRole, 'Dueño'>; status?: TeamMemberStatus },
  scope: TenantScope = requireCurrentTenantScope(),
  runtimeLease: TenantRuntimeLease = captureTenantRuntimeLease(scope),
): Promise<TeamMember> {
  return teamMutation(scope, runtimeLease, `/api/team/members/${memberId}`, 'PATCH', input);
}
'''
text = replace_once(text, old_team, new_team, 'cloud-api Team block')
p.write_text(text)


# server/team-management.ts: exact requested organization, exact requester, exact target.
p = Path('src/server/team-management.ts')
text = p.read_text()
start = text.index('async function requesterMembership(')
end = text.index('function invitationRedirect(', start)
new_authority = '''function requestedOrganizationId(value: unknown): string {
  if (typeof value !== 'string' || !value || value !== value.trim()) {
    throw new Error('Falta organizationId tenant válido.');
  }
  return value;
}

function exactMembershipStatus(value: unknown): 'active' | 'invited' | 'suspended' | null {
  if (value === 'active' || value === 'invited' || value === 'suspended') return value;
  return null;
}

function exactMembershipRole(value: unknown): 'owner' | 'admin' | 'agent' | null {
  if (value === 'owner' || value === 'admin' || value === 'agent') return value;
  return null;
}

function assertMemberOrganization(member: MembershipRow, organizationId: string): void {
  if (member.organization_id !== organizationId) throw new Error('TEAM_RESPONSE_ORGANIZATION_MISMATCH');
}

function oneReturnedMember(rows: MembershipRow[], organizationId: string, message: string): MembershipRow {
  if (rows.some((row) => row.organization_id !== organizationId)) {
    throw new Error('TEAM_RESPONSE_ORGANIZATION_MISMATCH');
  }
  if (rows.length !== 1) throw new Error(message);
  const member = rows.at(0)!;
  assertMemberOrganization(member, organizationId);
  return member;
}

async function requesterMembership(
  userId: string,
  organizationId: string,
  options: TeamManagementOptions,
): Promise<MembershipRow> {
  const query = new URL(`${options.supabaseUrl}/rest/v1/organization_members`);
  query.searchParams.set('select', 'organization_id,member_id,user_id,role,status,display_name,email,phone,created_at,last_active_at');
  query.searchParams.set('user_id', `eq.${userId}`);
  query.searchParams.set('organization_id', `eq.${organizationId}`);
  query.searchParams.set('status', 'eq.active');

  const rows = await responsePayload(await fetch(query, { headers: serviceHeaders(options) })) as MembershipRow[];
  if (rows.some((row) => (
    row.user_id !== userId
    || row.organization_id !== organizationId
    || exactMembershipStatus(row.status) !== 'active'
  ))) {
    throw new Error('TEAM_REQUESTER_MEMBERSHIP_MISMATCH');
  }
  if (rows.length !== 1) throw new Error('No tenés una membership ACTIVE exacta para esta inmobiliaria.');

  const requester = rows.at(0)!;
  const role = exactMembershipRole(requester.role);
  if (role !== 'owner' && role !== 'admin') throw new Error('No tenés permiso para administrar usuarios.');
  return requester;
}

async function organizationMemberByEmail(
  organizationId: string,
  email: string,
  options: TeamManagementOptions,
): Promise<MembershipRow | null> {
  const query = new URL(`${options.supabaseUrl}/rest/v1/organization_members`);
  query.searchParams.set('select', 'organization_id,member_id,user_id,role,status,display_name,email,phone,created_at,last_active_at');
  query.searchParams.set('organization_id', `eq.${organizationId}`);
  query.searchParams.set('email', `eq.${email}`);
  const rows = await responsePayload(await fetch(query, { headers: serviceHeaders(options) })) as MembershipRow[];
  if (rows.some((row) => row.organization_id !== organizationId)) {
    throw new Error('TEAM_RESPONSE_ORGANIZATION_MISMATCH');
  }
  if (rows.length > 1) throw new Error('La membership del correo es ambigua dentro de la inmobiliaria.');
  return rows.at(0) ?? null;
}

async function organizationSeatLimit(organizationId: string, options: TeamManagementOptions): Promise<number | null> {
  const query = new URL(`${options.supabaseUrl}/rest/v1/organizations`);
  query.searchParams.set('select', 'id,seat_limit');
  query.searchParams.set('id', `eq.${organizationId}`);
  const rows = await responsePayload(await fetch(query, { headers: serviceHeaders(options) })) as Array<{ id?: string; seat_limit?: number | null }>;
  if (rows.some((row) => row.id !== organizationId)) throw new Error('TEAM_RESPONSE_ORGANIZATION_MISMATCH');
  if (rows.length > 1) throw new Error('La organización solicitada devolvió un resultado ambiguo.');
  const seatLimit = rows.at(0)?.seat_limit;
  return Number.isFinite(seatLimit) && Number(seatLimit) > 0 ? Number(seatLimit) : null;
}

async function activeSeatCount(organizationId: string, options: TeamManagementOptions): Promise<number> {
  const query = new URL(`${options.supabaseUrl}/rest/v1/organization_members`);
  query.searchParams.set('select', 'organization_id,member_id,status');
  query.searchParams.set('organization_id', `eq.${organizationId}`);
  const rows = await responsePayload(await fetch(query, { headers: serviceHeaders(options) })) as Array<{ organization_id?: string; status?: string }>;
  if (rows.some((row) => row.organization_id !== organizationId)) throw new Error('TEAM_RESPONSE_ORGANIZATION_MISMATCH');
  return rows.filter((row) => row.status !== 'suspended').length;
}

async function ensureSeat(organizationId: string, options: TeamManagementOptions): Promise<void> {
  const limit = await organizationSeatLimit(organizationId, options);
  if (limit !== null && await activeSeatCount(organizationId, options) >= limit) {
    throw new Error(`La inmobiliaria alcanzó el límite de ${limit} usuarios de su plan.`);
  }
}

'''
text = text[:start] + new_authority + text[end:]

start = text.index('async function inviteMember(')
end = text.index('async function updateMember(', start)
new_invite = '''async function inviteMember(request: IncomingMessage, response: ServerResponse, options: TeamManagementOptions): Promise<void> {
  const user = await authenticatedUser(request, options);
  const body = await readJson(request);
  const organizationId = requestedOrganizationId(body.organizationId);
  const requester = await requesterMembership(user.id!, organizationId, options);
  const email = String(body.email || '').trim().toLowerCase();
  const displayName = String(body.name || '').trim();
  const phone = String(body.phone || '').trim();
  const role = requestedRole(body.role);
  if (!displayName || displayName.length > 120) throw new Error('Ingresá un nombre válido.');
  if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email) || email.length > 254) throw new Error('Ingresá un correo válido.');

  const existingMember = await organizationMemberByEmail(organizationId, email, options);
  if (existingMember) {
    assertMemberOrganization(existingMember, organizationId);
    const status = String(existingMember.status || '').toLowerCase();
    const existingRole = normalizedRole(existingMember.role);
    if (status === 'suspended') throw new Error('El usuario está suspendido. Reactivalo antes de generar un enlace.');
    if (existingRole === 'owner') throw new Error('No se puede generar un enlace de acceso para el dueño desde esta pantalla.');
    if (exactMembershipRole(requester.role) === 'admin' && existingRole !== 'agent') {
      throw new Error('Un administrador solo puede generar acceso para corredores.');
    }
    const generated = await generateTeamLink('recovery', email, options);
    if (generated.userId !== existingMember.user_id) {
      throw new Error('El correo no coincide con el usuario registrado en esta inmobiliaria.');
    }
    sendJson(response, 200, {
      success: true,
      member: existingMember,
      inviteLink: generated.inviteLink,
      linkType: 'recovery',
    });
    return;
  }

  await ensureSeat(organizationId, options);
  const generated = await generateTeamLink('invite', email, options, {
    organization_id: organizationId,
    organization_role: role,
    display_name: displayName,
  });

  const target = new URL(`${options.supabaseUrl}/rest/v1/organization_members`);
  target.searchParams.set('on_conflict', 'organization_id,user_id');
  const rows = await responsePayload(await fetch(target, {
    method: 'POST',
    headers: {
      ...serviceHeaders(options),
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify({
      organization_id: organizationId,
      user_id: generated.userId,
      role,
      status: 'invited',
      display_name: displayName,
      email,
      phone: phone || null,
    }),
  })) as MembershipRow[];
  const member = oneReturnedMember(rows, organizationId, 'No se pudo asociar la invitación a la inmobiliaria.');
  sendJson(response, 201, {
    success: true,
    member,
    inviteLink: generated.inviteLink,
    linkType: 'invite',
  });
}

'''
text = text[:start] + new_invite + text[end:]

start = text.index('async function updateMember(')
end = text.index('export async function handleTeamManagement(', start)
new_update = '''async function updateMember(request: IncomingMessage, response: ServerResponse, options: TeamManagementOptions, memberId: number): Promise<void> {
  const user = await authenticatedUser(request, options);
  const body = await readJson(request);
  const organizationId = requestedOrganizationId(body.organizationId);
  const requester = await requesterMembership(user.id!, organizationId, options);

  const query = new URL(`${options.supabaseUrl}/rest/v1/organization_members`);
  query.searchParams.set('select', 'organization_id,member_id,user_id,role,status,display_name,email,phone,created_at,last_active_at');
  query.searchParams.set('organization_id', `eq.${organizationId}`);
  query.searchParams.set('member_id', `eq.${memberId}`);
  const rows = await responsePayload(await fetch(query, { headers: serviceHeaders(options) })) as MembershipRow[];
  const exactTargets = rows.filter((row) => row.organization_id === organizationId && row.member_id === memberId);
  if (rows.some((row) => row.organization_id !== organizationId) || exactTargets.length !== 1) {
    throw new Error('No se encontró el integrante exacto dentro de esta inmobiliaria.');
  }
  const targetMember = exactTargets.at(0)!;
  assertMemberOrganization(targetMember, organizationId);

  if (normalizedRole(targetMember.role) === 'owner') throw new Error('El dueño no puede modificarse desde esta pantalla.');
  if (exactMembershipRole(requester.role) === 'admin' && normalizedRole(targetMember.role) !== 'agent') {
    throw new Error('Un administrador no puede modificar a otro administrador.');
  }

  const patch: Record<string, unknown> = {};
  if (body.role !== undefined) {
    const role = requestedRole(body.role);
    if (exactMembershipRole(requester.role) === 'admin' && role !== 'agent') throw new Error('Solo el dueño puede designar administradores.');
    patch.role = role;
  }
  const status = requestedStatus(body.status);
  if (status) {
    if (status === 'active' && targetMember.status === 'suspended') {
      await ensureSeat(organizationId, options);
    }
    patch.status = status;
  }
  if (!Object.keys(patch).length) throw new Error('No hay cambios válidos para aplicar.');

  const updateUrl = new URL(`${options.supabaseUrl}/rest/v1/organization_members`);
  updateUrl.searchParams.set('organization_id', `eq.${organizationId}`);
  updateUrl.searchParams.set('member_id', `eq.${memberId}`);
  const updatedRows = await responsePayload(await fetch(updateUrl, {
    method: 'PATCH',
    headers: { ...serviceHeaders(options), Prefer: 'return=representation' },
    body: JSON.stringify(patch),
  })) as MembershipRow[];
  const updated = oneReturnedMember(updatedRows, organizationId, 'No se pudo actualizar el acceso.');
  if (updated.member_id !== memberId) throw new Error('TEAM_RESPONSE_MEMBER_MISMATCH');
  sendJson(response, 200, { success: true, member: updated });
}

'''
text = text[:start] + new_update + text[end:]
text = replace_once(
    text,
    "    const status = /permiso|sesión|suspendido/i.test(message) ? 403 : 400;",
    "    const status = /permiso|sesión|suspendido|membership active|requester membership|acceso/i.test(message) ? 403 : 400;",
    'server status classifier',
)
p.write_text(text)


# team-ui.ts: capture scope/lease before each Team mutation; stale completions are silent.
p = Path('src/team-ui.ts')
text = p.read_text()
text = replace_once(
    text,
    "} from './cloud-api.js';\n",
    "} from './cloud-api.js';\n"
    "import {\n"
    "  assertTenantRuntimeLeaseCurrent,\n"
    "  captureTenantRuntimeLease,\n"
    "  requireCurrentTenantScope,\n"
    "  tenantRuntimeLeaseIsCurrent,\n"
    "  type TenantRuntimeLease,\n"
    "} from './tenant-runtime.js';\n",
    'team-ui imports',
)
text = replace_once(
    text,
    "const roles: TeamRole[] = ['Dueño', 'Administrador', 'Corredor'];\n",
    "const roles: TeamRole[] = ['Dueño', 'Administrador', 'Corredor'];\n\n"
    "function teamMutationContext(): { scope: ReturnType<typeof requireCurrentTenantScope>; runtimeLease: TenantRuntimeLease } {\n"
    "  const scope = requireCurrentTenantScope();\n"
    "  return { scope, runtimeLease: captureTenantRuntimeLease(scope) };\n"
    "}\n",
    'team-ui context helper',
)
text = replace_once(
    text,
    "    feedback(container, 'Enviando invitación…');\n    void inviteTeamMember({",
    "    feedback(container, 'Enviando invitación…');\n    const { scope, runtimeLease } = teamMutationContext();\n    void inviteTeamMember({",
    'team-ui invite capture',
)
text = replace_once(
    text,
    "      role: field(values, 'role') as Exclude<TeamRole, 'Dueño'>,\n    }).then((member) => {\n      replaceMember(member);",
    "      role: field(values, 'role') as Exclude<TeamRole, 'Dueño'>,\n    }, scope, runtimeLease).then((member) => {\n      assertTenantRuntimeLeaseCurrent(runtimeLease);\n      replaceMember(member);",
    'team-ui invite call',
)
text = replace_once(
    text,
    "    }).catch((error) => {\n      feedback(container, error instanceof Error ? error.message : 'No se pudo enviar la invitación.', true);",
    "    }).catch((error) => {\n      if (!tenantRuntimeLeaseIsCurrent(runtimeLease)) return;\n      feedback(container, error instanceof Error ? error.message : 'No se pudo enviar la invitación.', true);",
    'team-ui invite catch',
)
text = replace_once(
    text,
    "    const previousRole = target.role;\n    select.disabled = true;\n    void updateTeamMemberAccess(memberId, { role: select.value as Exclude<TeamRole, 'Dueño'> })\n      .then((updated) => {\n        replaceMember(updated);",
    "    const previousRole = target.role;\n    select.disabled = true;\n    const { scope, runtimeLease } = teamMutationContext();\n    void updateTeamMemberAccess(memberId, { role: select.value as Exclude<TeamRole, 'Dueño'> }, scope, runtimeLease)\n      .then((updated) => {\n        assertTenantRuntimeLeaseCurrent(runtimeLease);\n        replaceMember(updated);",
    'team-ui role mutation',
)
text = replace_once(
    text,
    "      .catch((error) => {\n        select.value = previousRole;",
    "      .catch((error) => {\n        if (!tenantRuntimeLeaseIsCurrent(runtimeLease)) return;\n        select.value = previousRole;",
    'team-ui role catch',
)
text = replace_once(
    text,
    "    button.disabled = true;\n    const status = target.status === 'Suspendido' ? 'Activo' : 'Suspendido';\n    void updateTeamMemberAccess(target.id, { status })\n      .then((updated) => {\n        replaceMember(updated);",
    "    button.disabled = true;\n    const status = target.status === 'Suspendido' ? 'Activo' : 'Suspendido';\n    const { scope, runtimeLease } = teamMutationContext();\n    void updateTeamMemberAccess(target.id, { status }, scope, runtimeLease)\n      .then((updated) => {\n        assertTenantRuntimeLeaseCurrent(runtimeLease);\n        replaceMember(updated);",
    'team-ui status mutation',
)
text = replace_once(
    text,
    "      .catch((error) => {\n        button.disabled = false;",
    "      .catch((error) => {\n        if (!tenantRuntimeLeaseIsCurrent(runtimeLease)) return;\n        button.disabled = false;",
    'team-ui status catch',
)
p.write_text(text)
