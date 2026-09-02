import assert from 'node:assert/strict';
import test from 'node:test';
import { initialData, type CrmData } from '../models.js';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

interface DeferredWrite {
  records: Array<Record<string, unknown>>;
  resolve: () => void;
}

function waitUntil(predicate: () => boolean, timeoutMs = 4_000, label = 'cloud step'): Promise<void> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (predicate()) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error(`timeout waiting for deterministic ${label}`));
      setTimeout(poll, 5);
    };
    poll();
  });
}

function contactSnapshot(): CrmData {
  const crm = structuredClone(initialData);
  const client = crm.clients[0]!;
  client.lastContact = '2026-08-07';
  crm.activityLog.push({
    id: Math.max(0, ...crm.activityLog.map((item) => item.id)) + 1,
    actorId: 1,
    action: 'Contacto por WhatsApp',
    entityType: 'Cliente',
    entityId: client.id,
    detail: 'Canal: WhatsApp\nResponsable: Franco Solis\nIntento: wa-cloud-race',
    createdAt: '2026-08-07T19:52:00.000Z',
  });
  return crm;
}

function followUpSnapshot(contact: CrmData, date: string): CrmData {
  const crm = structuredClone(contact);
  const client = crm.clients[0]!;
  client.nextAction = 'Volver a contactar por WhatsApp';
  client.nextFollowUp = date;
  crm.activityLog.push({
    id: Math.max(0, ...crm.activityLog.map((item) => item.id)) + 1,
    actorId: 1,
    action: 'Seguimiento por WhatsApp programado',
    entityType: 'Cliente',
    entityId: client.id,
    detail: `Volver a contactar por WhatsApp · ${date}\nSeguimiento WhatsApp: wa-cloud-race`,
    createdAt: '2026-08-07T19:52:02.000Z',
  });
  return crm;
}

test('reproduce la pérdida física: contacto A en vuelo + seguimiento B + F5 conserva ambos', async () => {
  const storage = new MemoryStorage();
  storage.setItem('propcontrol-cloud-session-v1', JSON.stringify({
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    expiresAt: Date.now() + 60_000,
    userId: 'franco-user',
    email: 'franco@example.com',
  }));
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: globalThis });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: new EventTarget() });

  const membership = {
    organization_id: 'org-trv',
    member_id: 1,
    user_id: 'franco-user',
    role: 'owner',
    status: 'active',
    display_name: 'Franco Solis',
    email: 'franco@example.com',
    created_at: '2026-01-01T00:00:00.000Z',
  };
  let remoteRecords: Array<Record<string, unknown>> = [];
  const pendingWrites: DeferredWrite[] = [];
  let writeNumber = 0;

  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input.toString() : input.url, 'https://app.test');
      const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
      const json = (value: unknown) => new Response(JSON.stringify(value), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

      if (url.pathname === '/api/cloud-config') {
        return json({ configured: true, url: 'https://supabase.test', publishableKey: 'publishable-key' });
      }
      if (url.pathname.endsWith('/rpc/activate_my_organization_memberships')) return json({});
      if (url.pathname.endsWith('/rpc/visit_transaction_authority_active')) return json(false);
      if (url.pathname.endsWith('/organization_members')) return json([membership]);
      if (url.pathname.endsWith('/propcontrol_records') && method === 'GET') return json(structuredClone(remoteRecords));
      if (url.pathname.endsWith('/propcontrol_records') && method === 'DELETE') return json([]);
      if (url.pathname.endsWith('/propcontrol_records') && method === 'POST') {
        writeNumber += 1;
        const records = JSON.parse(String(init?.body || '[]')) as Array<Record<string, unknown>>;
        return await new Promise<Response>((resolve) => {
          pendingWrites.push({
            records,
            resolve: () => {
              const stamp = `2026-08-07T19:52:0${writeNumber}.000Z`;
              remoteRecords = records.map((record) => ({ ...structuredClone(record), updated_at: stamp }));
              resolve(json([]));
            },
          });
        });
      }
      throw new Error(`Unexpected fetch ${method} ${url.toString()}`);
    },
  });

  const { queueCloudSave, pullCloudData } = await import('../cloud-api-compatible.js');
  const { getSyncState, writeLocalSnapshot, readLocalSnapshot } = await import('../sync-safety.js');

  const contact = contactSnapshot();
  const selectedDate = '2026-08-08';
  const withFollowUp = followUpSnapshot(contact, selectedDate);

  // A/B/C: contacto confirmado y primer guardado remoto iniciado.
  writeLocalSnapshot(contact, { reason: 'Contacto por WhatsApp registrado' });
  queueCloudSave(structuredClone(contact));
  await waitUntil(() => pendingWrites.length === 1, 4_000, 'first write');

  // D: mientras A sigue en vuelo se confirma y persiste el seguimiento B.
  writeLocalSnapshot(withFollowUp, { reason: 'Seguimiento por WhatsApp programado' });
  queueCloudSave(structuredClone(withFollowUp));

  // E: aunque transcurra el debounce de B, la red sólo puede tener A en vuelo.
  await new Promise((resolve) => setTimeout(resolve, 760));
  assert.equal(pendingWrites.length, 1, 'B no puede competir con A mientras A siga en vuelo');

  // F: al terminar A, dirty debe seguir true porque B es una generación posterior.
  pendingWrites[0]!.resolve();
  await waitUntil(() => pendingWrites.length === 2, 4_000, 'second write');
  assert.equal(getSyncState().dirty, true, 'A viejo no puede limpiar dirty mientras B está pendiente');

  // Recién ahora se ejecuta B, se verifica y puede dejar el estado limpio.
  pendingWrites[1]!.resolve();
  await waitUntil(() => getSyncState().dirty === false, 4_000, 'dirty false');
  await waitUntil(() => remoteRecords.some((record) => {
    const payload = record.payload as { nextFollowUp?: string } | undefined;
    return record.entity_type === 'client' && payload?.nextFollowUp === selectedDate;
  }), 4_000, 'remote follow-up');

  // G: la nube ya contiene B y un módulo de aplicación nuevo simula F5/hidratación autenticada.
  const cloud = await pullCloudData(withFollowUp);
  assert.ok(cloud);
  assert.equal(cloud!.clients[0]!.nextFollowUp, selectedDate);
  const { hydrateAuthenticatedSession } = await import('../mvp-auth.js');
  const { state } = await import('../store.js');
  await hydrateAuthenticatedSession();
  const rehydrated = readLocalSnapshot()!;

  // H: contrato físico obligatorio, tanto en state como en persistencia local rehidratada.
  assert.equal(state.crm.clients[0]!.nextFollowUp, selectedDate);
  const client = rehydrated.clients.find((item) => item.id === withFollowUp.clients[0]!.id)!;
  assert.equal(client.nextAction, 'Volver a contactar por WhatsApp');
  assert.equal(client.nextFollowUp, selectedDate);
  assert.equal(rehydrated.activityLog.filter((item) => item.action === 'Contacto por WhatsApp').length, 1);
  assert.equal(rehydrated.activityLog.filter((item) => item.action === 'Seguimiento por WhatsApp programado').length, 1);
  assert.equal(rehydrated.reminders.length, withFollowUp.reminders.length, 'no se crea ningún Reminder paralelo');
});
