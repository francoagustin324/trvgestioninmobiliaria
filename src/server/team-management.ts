import type { IncomingMessage, ServerResponse } from 'node:http';
import { handlePropertyPhotoStorage } from './property-photo-storage.js';

interface TeamManagementOptions {
  supabaseUrl: string;
  publishableKey: string;
  secretKey: string;
  appUrl?: string;
}

interface AuthUser {
  id?: string;
  email?: string;
}

interface MembershipRow {
  organization_id: string;
  member_id: number;
  user_id: string;
  role: string;
  status?: string;
  display_name?: string;
  email?: string;
  phone?: string;
  created_at?: string;
  last_active_at?: string;
}

const requestWindows = new Map<string, { count: number; resetAt: number }>();

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(payload));
}

function rateLimited(request: IncomingMessage): boolean {
  const key = request.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const current = requestWindows.get(key);
  if (!current || current.resetAt <= now) {
    requestWindows.set(key, { count: 1, resetAt: now + 10 * 60_000 });
    return false;
  }
  current.count += 1;
  return current.count > 15;
}

async function readJson(request: IncomingMessage, maxBytes = 20_000): Promise<Record<string, unknown>> {
  const contentType = String(request.headers['content-type'] || '').toLowerCase();
  if (!contentType.startsWith('application/json')) throw new Error('La solicitud debe enviarse como JSON.');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > maxBytes) throw new Error('La solicitud es demasiado grande.');
    chunks.push(buffer);
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('El contenido JSON no es válido.');
  return parsed as Record<string, unknown>;
}

async function responsePayload(response: Response): Promise<Record<string, unknown> | unknown[]> {
  const text = await response.text();
  let payload: unknown = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { message: text }; }
  if (!response.ok) {
    const record = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
    const message = [record.msg, record.message, record.error_description, record.error]
      .find((value) => typeof value === 'string' && value.trim());
    throw new Error(typeof message === 'string' ? message : `Supabase respondió ${response.status}.`);
  }
  return payload && typeof payload === 'object' ? payload as Record<string, unknown> | unknown[] : {};
}

export function supabaseServerHeaders(secretKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    apikey: secretKey,
    'Content-Type': 'application/json',
  };
  if (!secretKey.startsWith('sb_secret_')) headers.Authorization = `Bearer ${secretKey}`;
  return headers;
}

function serviceHeaders(options: TeamManagementOptions): Record<string, string> {
  return supabaseServerHeaders(options.secretKey);
}

function bearerToken(request: IncomingMessage): string {
  const authorization = String(request.headers.authorization || '');
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) throw new Error('Falta una sesión válida.');
  return match[1];
}

async function authenticatedUser(request: IncomingMessage, options: TeamManagementOptions): Promise<AuthUser> {
  const response = await fetch(`${options.supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: options.publishableKey,
      Authorization: `Bearer ${bearerToken(request)}`,
    },
  });
  const payload = await responsePayload(response) as Record<string, unknown>;
  if (typeof payload.id !== 'string') throw new Error('La sesión no identifica un usuario válido.');
  return { id: payload.id, email: typeof payload.email === 'string' ? payload.email : '' };
}

function normalizedRole(value: unknown): 'owner' | 'admin' | 'agent' {
  const role = String(value ?? '').toLowerCase();
  if (['owner', 'dueño', 'dueno'].includes(role)) return 'owner';
  if (['admin', 'administrator', 'administrador'].includes(role)) return 'admin';
  return 'agent';
}

function requestedRole(value: unknown): 'admin' | 'agent' {
  const role = normalizedRole(value);
  if (role === 'owner') throw new Error('No se puede invitar otro dueño desde esta pantalla.');
  return role;
}

function requestedStatus(value: unknown): 'active' | 'suspended' | undefined {
  if (value === undefined) return undefined;
  const status = String(value).toLowerCase();
  if (['activo', 'active'].includes(status)) return 'active';
  if (['suspendido', 'suspended'].includes(status)) return 'suspended';
  throw new Error('Estado de acceso no válido.');
}

async function requesterMembership(userId: string, options: TeamManagementOptions): Promise<MembershipRow> {
  const query = new URL(`${options.supabaseUrl}/rest/v1/organization_members`);
  query.searchParams.set('select', 'organization_id,member_id,user_id,role,status,display_name,email,phone,created_at,last_active_at');
  query.searchParams.set('user_id', `eq.${userId}`);
  query.searchParams.set('limit', '1');
  const rows = await responsePayload(await fetch(query, { headers: serviceHeaders(options) })) as MembershipRow[];
  const membership = rows[0];
  if (!membership?.organization_id) throw new Error('La cuenta no pertenece a una inmobiliaria.');
  if (String(membership.status || 'active').toLowerCase() === 'suspended') throw new Error('El acceso está suspendido.');
  if (!['owner', 'admin'].includes(normalizedRole(membership.role))) throw new Error('No tenés permiso para administrar usuarios.');
  return membership;
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
  query.searchParams.set('limit', '1');
  const rows = await responsePayload(await fetch(query, { headers: serviceHeaders(options) })) as MembershipRow[];
  return rows[0] || null;
}

async function organizationSeatLimit(organizationId: string, options: TeamManagementOptions): Promise<number | null> {
  const query = new URL(`${options.supabaseUrl}/rest/v1/organizations`);
  query.searchParams.set('select', 'seat_limit');
  query.searchParams.set('id', `eq.${organizationId}`);
  query.searchParams.set('limit', '1');
  const rows = await responsePayload(await fetch(query, { headers: serviceHeaders(options) })) as Array<{ seat_limit?: number | null }>;
  return Number.isFinite(rows[0]?.seat_limit) && Number(rows[0]?.seat_limit) > 0 ? Number(rows[0]?.seat_limit) : null;
}

async function activeSeatCount(organizationId: string, options: TeamManagementOptions): Promise<number> {
  const query = new URL(`${options.supabaseUrl}/rest/v1/organization_members`);
  query.searchParams.set('select', 'member_id,status');
  query.searchParams.set('organization_id', `eq.${organizationId}`);
  const rows = await responsePayload(await fetch(query, { headers: serviceHeaders(options) })) as Array<{ status?: string }>;
  return rows.filter((row) => String(row.status || 'active').toLowerCase() !== 'suspended').length;
}

async function ensureSeat(organizationId: string, options: TeamManagementOptions): Promise<void> {
  const limit = await organizationSeatLimit(organizationId, options);
  if (limit !== null && await activeSeatCount(organizationId, options) >= limit) {
    throw new Error(`La inmobiliaria alcanzó el límite de ${limit} usuarios de su plan.`);
  }
}

function invitationRedirect(options: TeamManagementOptions): string | undefined {
  const base = String(options.appUrl || '').trim().replace(/\/+$/g, '');
  return base ? `${base}/aceptar-invitacion` : undefined;
}

function generatedActionLink(payload: Record<string, unknown>): string {
  if (typeof payload.action_link === 'string') return payload.action_link;
  const properties = payload.properties && typeof payload.properties === 'object'
    ? payload.properties as Record<string, unknown>
    : {};
  return typeof properties.action_link === 'string' ? properties.action_link : '';
}

function generatedUser(payload: Record<string, unknown>): Record<string, unknown> {
  if (payload.user && typeof payload.user === 'object') return payload.user as Record<string, unknown>;
  return payload;
}

async function generateTeamLink(
  type: 'invite' | 'recovery',
  email: string,
  options: TeamManagementOptions,
  data?: Record<string, unknown>,
): Promise<{ inviteLink: string; userId: string }> {
  const body: Record<string, unknown> = {
    type,
    email,
    redirect_to: invitationRedirect(options),
  };
  if (data) body.data = data;
  const generated = await responsePayload(await fetch(`${options.supabaseUrl}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: serviceHeaders(options),
    body: JSON.stringify(body),
  })) as Record<string, unknown>;
  const inviteLink = generatedActionLink(generated);
  const linkedUser = generatedUser(generated);
  const userId = typeof linkedUser.id === 'string' ? linkedUser.id : '';
  if (!userId) throw new Error('Supabase no devolvió el usuario del enlace.');
  if (!inviteLink) throw new Error('Supabase no devolvió el enlace de acceso.');
  return { inviteLink, userId };
}

async function inviteMember(request: IncomingMessage, response: ServerResponse, options: TeamManagementOptions): Promise<void> {
  const user = await authenticatedUser(request, options);
  const requester = await requesterMembership(user.id!, options);
  const body = await readJson(request);
  const email = String(body.email || '').trim().toLowerCase();
  const displayName = String(body.name || '').trim();
  const phone = String(body.phone || '').trim();
  const role = requestedRole(body.role);
  if (!displayName || displayName.length > 120) throw new Error('Ingresá un nombre válido.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error('Ingresá un correo válido.');

  const existingMember = await organizationMemberByEmail(requester.organization_id, email, options);
  if (existingMember) {
    const status = String(existingMember.status || 'active').toLowerCase();
    const existingRole = normalizedRole(existingMember.role);
    if (status === 'suspended') throw new Error('El usuario está suspendido. Reactivalo antes de generar un enlace.');
    if (existingRole === 'owner') throw new Error('No se puede generar un enlace de acceso para el dueño desde esta pantalla.');
    if (normalizedRole(requester.role) === 'admin' && existingRole !== 'agent') {
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

  await ensureSeat(requester.organization_id, options);
  const generated = await generateTeamLink('invite', email, options, {
    organization_id: requester.organization_id,
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
      organization_id: requester.organization_id,
      user_id: generated.userId,
      role,
      status: 'invited',
      display_name: displayName,
      email,
      phone: phone || null,
    }),
  })) as MembershipRow[];
  const member = rows[0];
  if (!member) throw new Error('No se pudo asociar la invitación a la inmobiliaria.');
  sendJson(response, 201, {
    success: true,
    member,
    inviteLink: generated.inviteLink,
    linkType: 'invite',
  });
}

async function updateMember(request: IncomingMessage, response: ServerResponse, options: TeamManagementOptions, memberId: number): Promise<void> {
  const user = await authenticatedUser(request, options);
  const requester = await requesterMembership(user.id!, options);
  const query = new URL(`${options.supabaseUrl}/rest/v1/organization_members`);
  query.searchParams.set('select', 'organization_id,member_id,user_id,role,status,display_name,email,phone,created_at,last_active_at');
  query.searchParams.set('organization_id', `eq.${requester.organization_id}`);
  query.searchParams.set('member_id', `eq.${memberId}`);
  query.searchParams.set('limit', '1');
  const rows = await responsePayload(await fetch(query, { headers: serviceHeaders(options) })) as MembershipRow[];
  const targetMember = rows[0];
  if (!targetMember) throw new Error('No se encontró el integrante.');
  if (normalizedRole(targetMember.role) === 'owner') throw new Error('El dueño no puede modificarse desde esta pantalla.');
  if (normalizedRole(requester.role) === 'admin' && normalizedRole(targetMember.role) !== 'agent') {
    throw new Error('Un administrador no puede modificar a otro administrador.');
  }

  const body = await readJson(request);
  const patch: Record<string, unknown> = {};
  if (body.role !== undefined) {
    const role = requestedRole(body.role);
    if (normalizedRole(requester.role) === 'admin' && role !== 'agent') throw new Error('Solo el dueño puede designar administradores.');
    patch.role = role;
  }
  const status = requestedStatus(body.status);
  if (status) {
    if (status === 'active' && String(targetMember.status || '').toLowerCase() === 'suspended') {
      await ensureSeat(requester.organization_id, options);
    }
    patch.status = status;
  }
  if (!Object.keys(patch).length) throw new Error('No hay cambios válidos para aplicar.');

  const updateUrl = new URL(`${options.supabaseUrl}/rest/v1/organization_members`);
  updateUrl.searchParams.set('organization_id', `eq.${requester.organization_id}`);
  updateUrl.searchParams.set('member_id', `eq.${memberId}`);
  const updated = await responsePayload(await fetch(updateUrl, {
    method: 'PATCH',
    headers: { ...serviceHeaders(options), Prefer: 'return=representation' },
    body: JSON.stringify(patch),
  })) as MembershipRow[];
  if (!updated[0]) throw new Error('No se pudo actualizar el acceso.');
  sendJson(response, 200, { success: true, member: updated[0] });
}

export async function handleTeamManagement(
  request: IncomingMessage,
  response: ServerResponse,
  options: TeamManagementOptions,
): Promise<boolean> {
  const photoHandled = await handlePropertyPhotoStorage(request, response, options);
  if (photoHandled) return true;

  const pathname = new URL(request.url || '/', 'http://localhost').pathname;
  const invitation = pathname === '/api/team/invitations' && request.method === 'POST';
  const memberMatch = pathname.match(/^\/api\/team\/members\/(\d+)$/);
  const memberUpdate = Boolean(memberMatch?.[1] && request.method === 'PATCH');
  if (!invitation && !memberUpdate) return false;

  if (!options.supabaseUrl || !options.publishableKey || !options.secretKey) {
    sendJson(response, 503, { success: false, error: 'Falta configurar la clave secreta de Supabase en el servidor.' });
    return true;
  }
  if (rateLimited(request)) {
    sendJson(response, 429, { success: false, error: 'Demasiados cambios de equipo. Esperá unos minutos.' });
    return true;
  }

  try {
    if (invitation) await inviteMember(request, response, options);
    else await updateMember(request, response, options, Number(memberMatch![1]));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo administrar el equipo.';
    const status = /permiso|sesión|suspendido/i.test(message) ? 403 : 400;
    sendJson(response, status, { success: false, error: message });
  }
  return true;
}
