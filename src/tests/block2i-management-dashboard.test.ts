import assert from 'node:assert/strict';
import test from 'node:test';
import { performance } from 'node:perf_hooks';
import {
  buildManagementMetrics,
  managementDateRange,
  resolveManagementMember,
} from '../management-metrics.js';
import { defaultSettings, type ActivityEntry, type Client, type CrmData, type Property, type TeamMember } from '../models.js';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const USER_OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NOW = new Date('2026-10-01T15:00:00.000Z');

function member(id: number, userId: string, name: string, role: TeamMember['role'] = 'Corredor', status: TeamMember['status'] = 'Activo'): TeamMember {
  return { id, userId, name, email: `${id}@example.com`, role, status, createdAt: '2026-01-01T00:00:00.000Z' };
}
function client(id: number, assignedToId: number, createdAt: string, overrides: Partial<Client> = {}): Client {
  return {
    id, name: `Lead ${id}`, phone: `549351555${String(id).padStart(4,'0')}`, interest: 'Depto', status: 'Lead',
    temperature: 'Tibio', pipeline: 'Contactado', assignedToId, createdById: assignedToId,
    ...(overrides as Client),
    createdAt,
  } as Client;
}
function activity(id: number, clientId: number, action: string, createdAt: string): ActivityEntry {
  return { id, actorId: 1, action, entityType: 'Cliente', entityId: clientId, detail: '', createdAt };
}
function property(id: number, assignedToId: number, overrides: Partial<Property> = {}): Property {
  return { id, title: `Propiedad ${id}`, address: 'Córdoba', type: 'Departamento', operation: 'Venta', price: 100000, owner: 'Dueño', status: 'Activa', assignedToId, createdById: assignedToId, ...overrides };
}
function crm(): CrmData {
  return {
    organization: { id: ORG_A, name: 'Inmobiliaria A', seatLimit: null, planLabel: 'Test' },
    teamMembers: [member(1, USER_OWNER, 'Dueño', 'Dueño'), member(2, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Ana')],
    activityLog: [], clients: [], properties: [], visits: [], offers: [], reservations: [], contacts: [], reminders: [], fichas: [], conversations: [],
    settings: { ...defaultSettings },
  };
}
const scope = { userId: USER_OWNER, organizationId: ORG_A } as const;

test('Block 2I métricas: scorecard, primera respuesta, embudo, conversión y monedas usan fechas canónicas', () => {
  const data = crm();
  data.clients = [
    client(1, 1, '2026-10-01T10:00:00.000Z', { leadSource: 'Meta Ads', outcome: 'won', pipeline: 'Ganado', closedAt: '2026-10-01T14:00:00.000Z', commissionAmount: 3000, commissionCurrency: 'USD' }),
    client(2, 1, '2026-10-01T11:00:00.000Z', { leadSource: 'Zonaprop' }),
  ];
  data.activityLog = [
    activity(1, 1, 'Lead creado', '2026-10-01T10:00:00.000Z'),
    activity(2, 1, 'Contacto por WhatsApp', '2026-10-01T10:10:00.000Z'),
    activity(3, 2, 'Lead creado', '2026-10-01T11:00:00.000Z'),
    activity(4, 2, 'Llamada', '2026-10-01T11:30:00.000Z'),
  ];
  data.visits = [
    { id: 1, clientId: 1, propertyId: 1, scheduledAt: '2026-10-01T12:00:00.000Z', status: 'Realizada', assignedToId: 1, createdById: 1, createdAt: '2026-09-30T12:00:00Z', updatedAt: '2026-10-01T12:30:00Z' },
    { id: 2, clientId: 2, propertyId: 1, scheduledAt: '2026-10-01T18:00:00.000Z', status: 'Coordinada', assignedToId: 1, createdById: 1, createdAt: '2026-10-01T12:00:00Z', updatedAt: '2026-10-01T12:00:00Z' },
  ];
  data.offers = [{ id: 1, clientId: 1, propertyId: 1, origin: 'Cliente', amount: 100000, currency: 'USD', status: 'Aceptada', assignedToId: 1, createdById: 1, createdAt: '2026-10-01T13:00:00Z', updatedAt: '2026-10-01T13:30:00Z' }];
  data.reservations = [{ id: 1, clientId: 1, propertyId: 1, amount: 5000, currency: 'USD', reservedAt: '2026-10-01', status: 'Concretada', assignedToId: 1, createdById: 1, createdAt: '2026-10-01T13:40:00Z', updatedAt: '2026-10-01T14:00:00Z' }];

  const result = buildManagementMetrics({ crm: data, scope, period: 'today', now: NOW });
  assert.equal(result.scorecard.leadsReceived, 2);
  assert.equal(result.scorecard.leadsAttended, 2);
  assert.equal(result.scorecard.firstResponseMedianMinutes, 20);
  assert.equal(result.scorecard.visitsCompleted, 1);
  assert.equal(result.scorecard.visitsScheduled, 1);
  assert.equal(result.scorecard.offers, 1);
  assert.equal(result.scorecard.reservations, 1);
  assert.equal(result.scorecard.closures, 1);
  assert.equal(result.scorecard.conversionPct, 50);
  assert.deepEqual(result.funnel.map((row) => row.count), [2,1,1,1,1]);
  assert.equal(result.scorecard.commissions.USD, 3000);
  assert.equal(result.scorecard.commissions.ARS, 0);
});

test('Block 2I equipo/origen/pipeline: agrega una sola vez y el filtro de corredor es visual, no autoridad', () => {
  const data = crm();
  data.clients = [
    client(1, 1, '2026-10-01T09:00:00Z', { leadSource: 'Meta Ads', pipeline: 'Ganado', outcome: 'won', closedAt: '2026-10-01T14:00:00Z' }),
    client(2, 2, '2026-10-01T09:30:00Z', { leadSource: 'Zonaprop', pipeline: 'Negociación' }),
  ];
  data.activityLog = [activity(1,1,'Lead creado','2026-10-01T09:00:00Z'),activity(2,1,'WhatsApp','2026-10-01T09:05:00Z'),activity(3,2,'Lead creado','2026-10-01T09:30:00Z')];
  data.visits = [{ id: 1, clientId: 2, propertyId: 2, scheduledAt: '2026-10-01T10:00:00Z', status: 'Realizada', assignedToId: 2, createdById: 2, createdAt: '2026-10-01T09:00:00Z', updatedAt: '2026-10-01T11:00:00Z' }];
  const all = buildManagementMetrics({ crm:data, scope, period:'today', now:NOW });
  assert.deepEqual(all.team.map((row)=>row.memberId).sort(), [1,2]);
  assert.ok(all.sources.some((row)=>row.source==='Meta Ads' && row.closures===1));
  assert.ok(all.sources.some((row)=>row.source==='Zonaprop' && row.visits===1));
  assert.equal(all.pipeline.find((row)=>row.stage==='Ganado')?.count, 1);
  assert.equal(all.pipeline.find((row)=>row.stage==='Negociación')?.count, 1);

  const ana = buildManagementMetrics({ crm:data, scope, period:'today', brokerId:2, now:NOW });
  assert.equal(ana.scorecard.leadsReceived, 1);
  assert.equal(ana.scorecard.visitsCompleted, 1);
  assert.deepEqual(ana.team.map((row)=>row.memberId), [2]);
});

test('Block 2I propiedades: reglas transparentes detectan sin visitas, visitas sin oferta e inactividad de 30 días', () => {
  const data = crm();
  data.properties = [
    property(1,1,{ sharedAt:'2026-08-01' }),
    property(2,1,{ sharedAt:'2026-08-01' }),
    property(3,1,{ sharedAt:'2026-09-25' }),
  ];
  data.clients=[client(1,1,'2026-09-01T10:00:00Z')];
  data.visits=[{ id:1, clientId:1, propertyId:2, scheduledAt:'2026-08-15T10:00:00Z', status:'Realizada', assignedToId:1, createdById:1, createdAt:'2026-08-10T10:00:00Z', updatedAt:'2026-08-15T11:00:00Z' }];
  data.offers=[{ id:1, clientId:1, propertyId:3, origin:'Cliente', amount:100000, currency:'USD', status:'Pendiente', assignedToId:1, createdById:1, createdAt:'2026-09-30T10:00:00Z', updatedAt:'2026-09-30T10:00:00Z' }];
  const result=buildManagementMetrics({crm:data,scope,period:'last30',now:NOW});
  const one=result.propertyReviews.find((row)=>row.propertyId===1);
  const two=result.propertyReviews.find((row)=>row.propertyId===2);
  assert.ok(one?.reasons.includes('Sin visitas registradas'));
  assert.ok(one?.reasons.some((reason)=>reason.includes('días sin actividad')));
  assert.ok(two?.reasons.includes('Tiene visitas pero ninguna oferta'));
  assert.equal(result.propertyReviews.some((row)=>row.propertyId===3), false);
});

test('Block 2I períodos: Hoy, 7 días, 30 días y este mes son inclusivos y determinísticos', () => {
  assert.deepEqual(managementDateRange('today',NOW), {key:'today',label:'Hoy',fromDate:'2026-10-01',toDate:'2026-10-01'});
  assert.equal(managementDateRange('last7',NOW).fromDate,'2026-09-25');
  assert.equal(managementDateRange('last30',NOW).fromDate,'2026-09-02');
  assert.equal(managementDateRange('thisMonth',NOW).fromDate,'2026-10-01');
});

test('Block 2I seguridad: tenant, suspended/missing/ambiguous, same-id y corredor fallan cerrado', () => {
  const data=crm();
  assert.equal(resolveManagementMember(data,scope).role,'Dueño');
  assert.throws(()=>resolveManagementMember(data,{...scope,organizationId:ORG_B}),/MANAGEMENT_TENANT_MISMATCH/);

  const missing=crm(); missing.teamMembers=[];
  assert.throws(()=>resolveManagementMember(missing,scope),/MANAGEMENT_MEMBERSHIP_REQUIRED/);
  const suspended=crm(); suspended.teamMembers=[member(1,USER_OWNER,'Dueño','Dueño','Suspendido')];
  assert.throws(()=>resolveManagementMember(suspended,scope),/MANAGEMENT_MEMBER_SUSPENDED/);
  const ambiguous=crm(); ambiguous.teamMembers=[member(1,USER_OWNER,'Dueño','Dueño'),member(2,USER_OWNER,'Duplicado','Administrador')];
  assert.throws(()=>resolveManagementMember(ambiguous,scope),/MANAGEMENT_MEMBERSHIP_AMBIGUOUS/);
  const corredor=crm(); corredor.teamMembers=[member(1,USER_OWNER,'Corredor','Corredor')];
  assert.throws(()=>resolveManagementMember(corredor,scope),/MANAGEMENT_FORBIDDEN/);

  const otherTenant=crm(); otherTenant.organization.id=ORG_B; otherTenant.teamMembers=[member(1,USER_OWNER,'Mismo ID','Dueño')];
  assert.throws(()=>buildManagementMetrics({crm:otherTenant,scope,period:'today',now:NOW}),/MANAGEMENT_TENANT_MISMATCH/);
});

test('Block 2I vacíos/división cero: no produce NaN ni Infinity y primera respuesta admite falta de evidencia', () => {
  const data=crm();
  const result=buildManagementMetrics({crm:data,scope,period:'today',now:NOW});
  assert.equal(result.scorecard.conversionPct,0);
  assert.equal(result.scorecard.firstResponseMedianMinutes,null);
  assert.equal(result.dataQuality.firstResponseComplete,true);
  const serialized=JSON.stringify(result);
  assert.doesNotMatch(serialized,/NaN|Infinity|undefined/);

  data.clients=[client(9,1,'2026-10-01T10:00:00Z',{lastContact:'2026-10-01'})];
  const partial=buildManagementMetrics({crm:data,scope,period:'today',now:NOW});
  assert.equal(partial.scorecard.leadsAttended,1);
  assert.equal(partial.scorecard.firstResponseMedianMinutes,null);
  assert.equal(partial.dataQuality.firstResponseComplete,false);
  assert.match(partial.dataQuality.firstResponseNote||'',/timestamps históricos confiables/);
});

test('Block 2I performance: capa pura mantiene costo razonable con dataset realista', () => {
  const data=crm();
  const total=6000;
  for(let i=1;i<=total;i+=1){
    const assigned=i%2?1:2;
    const c=client(i,assigned,'2026-10-01T09:00:00Z',{leadSource:i%3===0?'Meta Ads':'Zonaprop'});
    data.clients.push(c);
    data.activityLog.push(activity(i*2-1,i,'Lead creado','2026-10-01T09:00:00Z'));
    data.activityLog.push(activity(i*2,i,'WhatsApp','2026-10-01T09:10:00Z'));
  }
  const started=performance.now();
  const result=buildManagementMetrics({crm:data,scope,period:'today',now:NOW});
  const elapsed=performance.now()-started;
  assert.equal(result.scorecard.leadsReceived,total);
  assert.equal(result.scorecard.leadsAttended,total);
  assert.ok(elapsed<3000,`capa gerencial tardó ${Math.round(elapsed)}ms para ${total} leads + ${total*2} actividades`);
});
