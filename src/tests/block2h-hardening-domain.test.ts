import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateCommercialAlertConditions,
  hasValidCommercialCommitment,
} from '../commercial-alert-engine.js';
import { renderOperationalAttentionForTenant } from '../lead-attention-runtime.js';
import { operationalAttentionQueue, renderOperationalAttentionQueue } from '../lead-attention-queue.js';
import { completeClientFollowUpWithDecision } from '../lead-pipeline.js';
import { resolveOffer } from '../offer-workflow.js';
import { updateReservationStatus } from '../reservation-workflow.js';
import { registerVisitResult } from '../visit-workflow.js';
import {
  defaultSettings,
  type ActivityEntry,
  type Client,
  type CrmData,
  type Offer,
  type Property,
  type Reservation,
  type SyncedVisit,
  type TeamMember,
} from '../models.js';

const ORG_A='11111111-1111-4111-8111-111111111111';
const ORG_B='22222222-2222-4222-8222-222222222222';
const USER_A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TODAY='2026-09-29';
const NOW=new Date('2026-09-29T15:00:00.000Z');

function member(id:number,userId:string,name:string,role:TeamMember['role']='Corredor',status:TeamMember['status']='Activo'):TeamMember{
  return {id,userId,name,email:`${id}@example.com`,role,status,createdAt:'2026-01-01T00:00:00.000Z'};
}
function client(id:number,assignedToId=1,overrides:Partial<Client>={}):Client{
  return {
    id,uid:`00000000-0000-4000-8000-${String(id).padStart(12,'0')}`,revision:1,
    name:`Cliente ${id}`,phone:`549351555${String(id).padStart(4,'0')}`,interest:'Departamento',
    status:'Lead',temperature:'Tibio',pipeline:'Contactado',lastContact:'2026-09-20',
    assignedToId,createdById:assignedToId,...overrides,
  };
}
function property(id:number,assignedToId=1):Property{
  return {id,uid:`10000000-0000-4000-8000-${String(id).padStart(12,'0')}`,revision:1,title:`Propiedad ${id}`,
    address:'General Paz, Córdoba',type:'Departamento',operation:'Venta',price:100000,owner:'Propietario',status:'Activa',
    bedrooms:2,assignedToId,createdById:assignedToId};
}
function evaluation(overrides:Partial<Parameters<typeof evaluateCommercialAlertConditions>[0]>={}){
  return {organizationId:ORG_A,clients:[] as Client[],properties:[] as Property[],visits:[],offers:[] as Offer[],
    reservations:[] as Reservation[],reminders:[],activityLog:[] as ActivityEntry[],actor:{id:1,role:'Dueño' as const},today:TODAY,now:NOW,...overrides};
}
function crm(org=ORG_A):CrmData{
  return {
    organization:{id:org,name:`Org ${org}`,seatLimit:null,planLabel:'Test'},
    teamMembers:[member(1,USER_A,'Dueño A','Dueño'),member(2,USER_B,'Corredor B')],
    activityLog:[],clients:[],properties:[],visits:[],offers:[],reservations:[],contacts:[],reminders:[],fichas:[],conversations:[],
    settings:{...defaultSettings},
  };
}
function types(input:Parameters<typeof evaluateCommercialAlertConditions>[0]):string[]{
  return evaluateCommercialAlertConditions(input).map((item)=>item.type);
}

test('Block 2H hardening visita: nextAction histórico no resuelve; sólo resultado causal de esa visita + compromiso válido',()=>{
  const c=client(10,1,{pipeline:'Visita coordinada',nextAction:'Enviar opciones viejo',nextFollowUp:'2026-10-02'});
  const visit:SyncedVisit={
    id:90,uid:'20000000-0000-4000-8000-000000000090',revision:2,clientId:c.id,propertyId:1,
    scheduledAt:'2026-09-28T12:00:00.000Z',status:'Realizada',interest:'Alto',assignedToId:1,createdById:1,
    createdAt:'2026-09-27T12:00:00.000Z',updatedAt:'2026-09-29T14:00:00.000Z',
  };
  assert.ok(types(evaluation({clients:[c],properties:[property(1)],visits:[visit]})).includes('VISIT_RESULT_MISSING'),
    'datos históricos del Client no prueban que la visita haya sido cerrada correctamente');

  const otherVisitActivity:ActivityEntry={
    id:1,actorId:1,action:'Visita realizada',entityType:'Cliente',entityId:c.id,detail:'otra visita',
    createdAt:'2026-09-29T14:00:01.000Z',commercialEntityType:'visit',commercialEntityId:91,
  };
  assert.ok(types(evaluation({clients:[c],properties:[property(1)],visits:[visit],activityLog:[otherVisitActivity]})).includes('VISIT_RESULT_MISSING'),
    'resultado de otra visita del mismo cliente no satisface causalidad');

  const exact:ActivityEntry={...otherVisitActivity,id:2,detail:'resultado exacto',commercialEntityId:visit.id,commercialEntityUid:visit.uid};
  assert.equal(types(evaluation({clients:[c],properties:[property(1)],visits:[visit],activityLog:[exact]})).includes('VISIT_RESULT_MISSING'),false,
    'resultado estructurado de la visita exacta + compromiso vigente resuelve');
});

test('Block 2H hardening movimiento: comunicación genérica o de otra entidad no silencia oferta/reserva; relación exacta sí',()=>{
  const c=client(20,1,{pipeline:'Negociación',nextAction:undefined,nextFollowUp:undefined});
  const p=property(20);
  const offer:Offer={id:200,clientId:c.id,propertyId:p.id,origin:'Cliente',amount:95000,currency:'USD',status:'Pendiente',
    assignedToId:1,createdById:1,createdAt:'2026-09-20T12:00:00.000Z',updatedAt:'2026-09-25T12:00:00.000Z'};
  const generic:ActivityEntry={id:1,actorId:1,action:'WhatsApp enviado',entityType:'Cliente',entityId:c.id,detail:'otro tema',createdAt:'2026-09-29T14:00:00.000Z'};
  assert.ok(types(evaluation({clients:[c],properties:[p],offers:[offer],activityLog:[generic]})).includes('OFFER_STALLED'));

  const wrongOffer:ActivityEntry={...generic,id:2,action:'Oferta revisada',commercialEntityType:'offer',commercialEntityId:201};
  assert.ok(types(evaluation({clients:[c],properties:[p],offers:[offer],activityLog:[wrongOffer]})).includes('OFFER_STALLED'));

  const exactOffer:ActivityEntry={...wrongOffer,id:3,commercialEntityId:offer.id};
  assert.equal(types(evaluation({clients:[c],properties:[p],offers:[offer],activityLog:[exactOffer]})).includes('OFFER_STALLED'),false);

  const reservedClient=client(21,1,{pipeline:'Reservado',nextAction:undefined,nextFollowUp:undefined});
  const reservation:Reservation={id:300,clientId:reservedClient.id,propertyId:p.id,amount:5000,currency:'USD',reservedAt:'2026-09-20',
    status:'Activa',assignedToId:1,createdById:1,createdAt:'2026-09-20T12:00:00.000Z',updatedAt:'2026-09-25T12:00:00.000Z'};
  assert.ok(types(evaluation({clients:[reservedClient],properties:[p],reservations:[reservation],activityLog:[generic]})).includes('RESERVATION_STALLED'));
  const exactReservation:ActivityEntry={...generic,id:4,action:'Reserva revisada',entityId:reservedClient.id,
    commercialEntityType:'reservation',commercialEntityId:reservation.id};
  assert.equal(types(evaluation({clients:[reservedClient],properties:[p],reservations:[reservation],activityLog:[exactReservation]})).includes('RESERVATION_STALLED'),false);
});

test('Block 2H hardening compromiso: texto sin fecha válida nunca cuenta como gestión vigente',()=>{
  const forgotten=client(30,1,{pipeline:'Contactado',lastContact:'2026-09-15',nextAction:'Llamar algún día',nextFollowUp:undefined});
  assert.equal(hasValidCommercialCommitment(forgotten,TODAY),false);
  assert.ok(types(evaluation({clients:[forgotten]})).includes('FORGOTTEN_LEAD'));

  const malformed={...forgotten,nextFollowUp:'cuando pueda'};
  assert.equal(hasValidCommercialCommitment(malformed,TODAY),false);
  assert.ok(types(evaluation({clients:[malformed]})).includes('FORGOTTEN_LEAD'));

  const advanced=client(31,1,{pipeline:'Negociación',lastContact:TODAY,nextAction:'Esperar respuesta',nextFollowUp:undefined});
  assert.ok(types(evaluation({clients:[advanced]})).includes('ADVANCED_NO_NEXT_ACTION'));

  const valid={...advanced,nextFollowUp:'2026-10-02'};
  assert.equal(hasValidCommercialCommitment(valid,TODAY),true);
  assert.equal(types(evaluation({clients:[valid]})).includes('ADVANCED_NO_NEXT_ACTION'),false);
});

test('Block 2H hardening cola: mantiene max3 limpio pero informa el total real previo a caps',()=>{
  const clients=Array.from({length:6},(_,index)=>client(index+100,1,{
    lastContact:TODAY,nextAction:'Llamar',nextFollowUp:'2026-09-28',
  }));
  const input=evaluation({clients});
  const visible=operationalAttentionQueue(input,3);
  assert.equal(visible.length,3);
  const markup=renderOperationalAttentionQueue(input,3);
  assert.match(markup,/Mostrando 3 de 6 acciones/);
  assert.match(markup,/6 altos/,'resumen de prioridades usa el total real, no sólo las tres tarjetas');
});

test('Block 2H hardening autoridad productiva: tenants/sesiones/membresías fallan cerrado sin filtrar nombres, counts ni motivos',()=>{
  const a=crm(ORG_A);
  a.clients=[client(1,1,{name:'SECRETO_A',lastContact:TODAY,nextAction:'Llamar A',nextFollowUp:'2020-01-01'}),
    client(2,2,{name:'SECRETO_BROKER',lastContact:TODAY,nextAction:'Llamar B',nextFollowUp:'2020-01-01'})];
  const b=crm(ORG_B);
  b.clients=[client(1,1,{name:'SECRETO_B',lastContact:TODAY,nextAction:'Llamar B2',nextFollowUp:'2020-01-01'})];

  const ownerA=renderOperationalAttentionForTenant(a,{userId:USER_A,organizationId:ORG_A},10);
  assert.match(ownerA,/SECRETO_A/);
  assert.match(ownerA,/SECRETO_BROKER/);
  assert.doesNotMatch(ownerA,/SECRETO_B(?!ROKER)/);

  const brokerA=renderOperationalAttentionForTenant(a,{userId:USER_B,organizationId:ORG_A},10);
  assert.doesNotMatch(brokerA,/SECRETO_A/);
  assert.match(brokerA,/SECRETO_BROKER/);

  const ownerB=renderOperationalAttentionForTenant(b,{userId:USER_A,organizationId:ORG_B},10);
  assert.match(ownerB,/SECRETO_B/);
  assert.doesNotMatch(ownerB,/SECRETO_A/);

  const cross=renderOperationalAttentionForTenant(a,{userId:USER_A,organizationId:ORG_B},10);
  assert.match(cross,/No pudimos verificar tu acceso/);
  assert.doesNotMatch(cross,/SECRETO_|Llamar|\d+ altos|Mostrando/);

  const missing=structuredClone(a); missing.teamMembers=missing.teamMembers.filter((m)=>m.userId!==USER_A);
  const suspended=structuredClone(a); suspended.teamMembers=[member(1,USER_A,'Suspendido','Dueño','Suspendido')];
  const ambiguous=structuredClone(a); ambiguous.teamMembers=[member(1,USER_A,'Uno','Dueño'),member(9,USER_A,'Dos','Administrador')];
  for(const candidate of [missing,suspended,ambiguous]){
    const markup=renderOperationalAttentionForTenant(candidate,{userId:USER_A,organizationId:ORG_A},10);
    assert.match(markup,/No pudimos verificar tu acceso/);
    assert.doesNotMatch(markup,/SECRETO_|Llamar|\d+ altos|Mostrando/);
  }
});

test('Block 2H hardening flujo productivo: CTA deriva de estado, mutación real persiste y al reload desaparece',()=>{
  const p=property(50);
  let data=crm();
  const follow=client(50,1,{lastContact:TODAY,nextAction:'Llamar',nextFollowUp:'2026-09-28'});
  data.clients=[follow]; data.properties=[p];
  let markup=renderOperationalAttentionQueue({...evaluation({clients:data.clients,properties:data.properties})},10);
  assert.match(markup,/data-operational-action="follow-up-overdue"/);
  const completed=completeClientFollowUpWithDecision(follow,{kind:'scheduled',nextAction:'Enviar opciones',nextFollowUp:'2026-10-02'},NOW);
  data.clients[0]=completed.client;
  data.activityLog=[{...completed.activity,id:1,actorId:1,createdAt:NOW.toISOString()}];
  data=JSON.parse(JSON.stringify(data)) as CrmData;
  assert.equal(types(evaluation({clients:data.clients,properties:data.properties,activityLog:data.activityLog})).includes('FOLLOW_UP_OVERDUE'),false);

  const visitClient=client(51,1,{pipeline:'Visita coordinada',nextAction:'Viejo',nextFollowUp:'2026-10-02'});
  const visit:SyncedVisit={id:51,uid:'20000000-0000-4000-8000-000000000051',revision:1,clientId:51,propertyId:p.id,
    scheduledAt:'2026-09-28T12:00:00.000Z',status:'Coordinada',assignedToId:1,createdById:1,createdAt:'2026-09-27T12:00:00Z',updatedAt:'2026-09-27T12:00:00Z'};
  assert.ok(types(evaluation({clients:[visitClient],properties:[p],visits:[visit]})).includes('VISIT_RESULT_MISSING'));
  const resolvedVisit=registerVisitResult({visit,client:visitClient,property:p,actor:{id:1,role:'Dueño'},status:'Realizada',interest:'Alto',
    nextAction:'Enviar propuesta',nextFollowUp:'2026-10-02',now:NOW});
  const visitActivity:ActivityEntry={...resolvedVisit.activity,id:2,actorId:1,createdAt:NOW.toISOString()};
  const reloadedVisit=JSON.parse(JSON.stringify({client:resolvedVisit.client,visit:resolvedVisit.visit,activity:visitActivity})) as
    {client:Client;visit:SyncedVisit;activity:ActivityEntry};
  assert.equal(types(evaluation({clients:[reloadedVisit.client],properties:[p],visits:[reloadedVisit.visit],activityLog:[reloadedVisit.activity]})).includes('VISIT_RESULT_MISSING'),false);

  const offerClient=client(52,1,{pipeline:'Negociación',nextAction:'Esperar',nextFollowUp:'2026-10-02'});
  const stalled:Offer={id:52,clientId:52,propertyId:p.id,origin:'Cliente',amount:90000,currency:'USD',status:'Pendiente',
    assignedToId:1,createdById:1,createdAt:'2026-09-20T12:00:00Z',updatedAt:'2026-09-20T12:00:00Z'};
  const offerCrm=crm(); offerCrm.clients=[offerClient]; offerCrm.properties=[p]; offerCrm.offers=[stalled];
  assert.ok(types(evaluation({clients:offerCrm.clients,properties:[p],offers:[stalled]})).includes('OFFER_STALLED'));
  const offerDone=resolveOffer(offerCrm,{id:1,role:'Dueño'},{offerId:stalled.id,status:'Rechazada',nextAction:'Buscar alternativa',nextFollowUp:'2026-10-02',now:NOW});
  const offerReload=JSON.parse(JSON.stringify(offerDone.crm)) as CrmData;
  assert.equal(types(evaluation({clients:offerReload.clients,properties:offerReload.properties,offers:offerReload.offers,activityLog:offerReload.activityLog})).includes('OFFER_STALLED'),false);

  const reservationClient=client(53,1,{pipeline:'Reservado',nextAction:undefined,nextFollowUp:undefined});
  const reservation:Reservation={id:53,clientId:53,propertyId:p.id,amount:5000,currency:'USD',reservedAt:'2026-09-20',status:'Activa',
    assignedToId:1,createdById:1,createdAt:'2026-09-20T12:00:00Z',updatedAt:'2026-09-20T12:00:00Z'};
  const reservationCrm=crm(); reservationCrm.clients=[reservationClient]; reservationCrm.properties=[p]; reservationCrm.reservations=[reservation];
  assert.ok(types(evaluation({clients:reservationCrm.clients,properties:[p],reservations:[reservation]})).includes('RESERVATION_STALLED'));
  const reservationDone=updateReservationStatus(reservationCrm,{id:1,role:'Dueño'},{reservationId:reservation.id,status:'Concretada',now:NOW});
  const reservationReload=JSON.parse(JSON.stringify(reservationDone.crm)) as CrmData;
  assert.equal(types(evaluation({clients:reservationReload.clients,properties:reservationReload.properties,reservations:reservationReload.reservations,activityLog:reservationReload.activityLog})).includes('RESERVATION_STALLED'),false);
});
