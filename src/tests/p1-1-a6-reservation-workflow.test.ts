import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { cloudRecordsToCrm, crmToCloudRecords, membershipContext, type CloudMembershipRow } from '../cloud-records.js';
import { initialData, type Client, type CrmData, type Offer, type Property } from '../models.js';
import { registerReservation, reservationsForClient, updateReservationStatus } from '../reservation-workflow.js';
import { readLocalSnapshot, writeLocalSnapshot } from '../sync-safety.js';

class MemoryStorage implements Storage { private values=new Map<string,string>(); get length(){return this.values.size;} clear(){this.values.clear();} getItem(k:string){return this.values.get(k)??null;} key(i:number){return [...this.values.keys()][i]??null;} removeItem(k:string){this.values.delete(k);} setItem(k:string,v:string){this.values.set(k,v);} }
const NOW=new Date(2026,7,25,12); const actor={id:20,role:'Corredor' as const}; const owner={id:1,role:'Dueño' as const};
function lead(stage='Nuevo',extra:Partial<Client>={}):Client{return{id:10,name:'Lucía',phone:'351',interest:'Dúplex',status:'Lead',temperature:'Caliente',pipeline:stage,assignedToId:20,createdById:20,...extra} as Client;}
function property(id=30,extra:Partial<Property>={}):Property{return{id,title:`Docta ${id}`,address:'Córdoba',type:'Dúplex',operation:'Venta',price:100000,owner:'Dueño',status:'Activa',assignedToId:20,createdById:20,...extra};}
function offer(extra:Partial<Offer>={}):Offer{return{id:40,clientId:10,propertyId:30,origin:'Cliente',amount:70000,currency:'USD',status:'Pendiente',assignedToId:20,createdById:20,createdAt:NOW.toISOString(),updatedAt:NOW.toISOString(),...extra};}
function crm(stage='Nuevo'):CrmData{const x=structuredClone(initialData);x.clients=[lead(stage)];x.properties=[property(),property(31)];x.offers=[offer()];x.reservations=[];x.visits=[];x.activityLog=[];x.reminders=[];return x;}
function input(extra:Record<string,unknown>={}){return{clientId:10,propertyId:30,amount:5000,currency:'USD',paymentMethod:'Transferencia',conditions:'Sujeto a informes',reservedAt:'2026-08-25',expiresAt:'2026-08-30',now:NOW,...extra} as Parameters<typeof registerReservation>[2];}
const json=(value:unknown)=>JSON.stringify(value);

test('P1.1-A6 registra Activa, avanza pipeline monotónicamente y crea compromiso/actividad sin Reminder',()=>{
  for(const stage of ['Nuevo','Contactado','Calificado','Visita coordinada','Negociación']) assert.equal(registerReservation(crm(stage),actor,input()).crm.clients[0]?.pipeline,'Reservado');
  for(const stage of ['Reservado','Ganado','Perdido']) assert.equal(registerReservation(crm(stage),actor,input()).crm.clients[0]?.pipeline,stage);
  const base=crm();base.reminders=[{id:2,date:'2026-09-01',title:'Existente',related:'Lead',priority:'Media'}];const reminders=structuredClone(base.reminders);const result=registerReservation(base,actor,input());
  assert.deepEqual({status:result.reservation.status,assigned:result.reservation.assignedToId,creator:result.reservation.createdById},{status:'Activa',assigned:20,creator:20});
  assert.equal(result.crm.clients[0]?.nextAction,'Dar seguimiento a la reserva · Docta 30');assert.equal(result.crm.clients[0]?.nextFollowUp,'2026-08-29');assert.deepEqual(result.crm.reminders,reminders);
  assert.equal(result.crm.activityLog[0]?.action,'Reserva registrada');assert.match(result.crm.activityLog[0]?.detail??'',/USD.*5[.,]000.*vence 2026-08-30/);
  const noExpiry=registerReservation(crm(),actor,input({expiresAt:''}));assert.equal(noExpiry.crm.clients[0]?.nextFollowUp,'2026-08-27');assert.match(noExpiry.crm.clients[0]?.nextAction??'',/seguimiento a la reserva/i);
});

test('P1.1-A6 valida campos, coherencia Offer, permisos y mantiene zero mutation',()=>{
  const cases:Array<[Record<string,unknown>,RegExp]>=[[{clientId:999},/lead/i],[{propertyId:999},/propiedad/i],[{amount:0},/monto/i],[{amount:-1},/monto/i],[{currency:'EUR'},/moneda/i],[{reservedAt:'2026-02-30'},/fecha de reserva/i],[{expiresAt:'2026-02-30'},/vencimiento/i],[{expiresAt:'2026-08-24'},/anterior/i],[{offerId:999},/oferta/i]];
  for(const [extra,message] of cases){const base=crm();const before=json(base);assert.throws(()=>registerReservation(base,actor,input(extra)),message);assert.equal(json(base),before);}
  const foreignClient=crm();foreignClient.offers=[offer({clientId:11})];assert.throws(()=>registerReservation(foreignClient,actor,input({offerId:40})),/otro lead/i);
  const foreignProperty=crm();foreignProperty.offers=[offer({propertyId:31})];assert.throws(()=>registerReservation(foreignProperty,actor,input({offerId:40})),/otra propiedad/i);
  const hidden=crm();hidden.properties[0]=property(30,{assignedToId:99});const before=json(hidden);assert.throws(()=>registerReservation(hidden,actor,input()),/permiso/i);assert.equal(json(hidden),before);assert.doesNotThrow(()=>registerReservation(hidden,owner,input()));
});

test('P1.1-A6 Offer opcional válida no muta Offer.status y no crea Commission',()=>{
  const base=crm();const snapshot=structuredClone(base.offers);const result=registerReservation(base,actor,input({offerId:40}));assert.equal(result.reservation.offerId,40);assert.deepEqual(result.crm.offers,snapshot);assert.equal('commissions' in result.crm,false);
  assert.equal(registerReservation(crm(),actor,input()).reservation.offerId,undefined);
});

test('P1.1-A6 Cancelada/Concretada no infieren Perdido/Ganado y preservan compromisos posteriores',()=>{
  const active=registerReservation(crm('Negociación'),actor,input());const cancelled=updateReservationStatus(active.crm,actor,{reservationId:1,status:'Cancelada',now:new Date(2026,7,26,10)});
  assert.equal(cancelled.crm.clients[0]?.pipeline,'Reservado');assert.notEqual(cancelled.crm.clients[0]?.pipeline,'Perdido');assert.equal(cancelled.crm.clients[0]?.nextAction,'Retomar negociación');assert.equal(cancelled.crm.clients[0]?.nextFollowUp,'2026-08-27');assert.equal(cancelled.crm.activityLog[0]?.action,'Reserva cancelada');
  const second=registerReservation(crm('Reservado'),actor,input());const concrete=updateReservationStatus(second.crm,actor,{reservationId:1,status:'Concretada',now:new Date(2026,7,26,10)});assert.equal(concrete.crm.clients[0]?.pipeline,'Reservado');assert.notEqual(concrete.crm.clients[0]?.pipeline,'Ganado');assert.equal(concrete.crm.clients[0]?.nextAction,'Completar cierre de la operación');assert.equal(concrete.crm.activityLog[0]?.action,'Reserva concretada');
  assert.throws(()=>updateReservationStatus(concrete.crm,actor,{reservationId:1,status:'Cancelada',now:NOW}),/cerrada/i);
  const later=registerReservation(crm(),actor,input());later.crm.clients[0]={...later.crm.clients[0]!,nextAction:'Compromiso posterior',nextFollowUp:'2026-09-15'};const kept=updateReservationStatus(later.crm,actor,{reservationId:1,status:'Cancelada',now:NOW});assert.equal(kept.crm.clients[0]?.nextAction,'Compromiso posterior');assert.equal(kept.crm.clients[0]?.nextFollowUp,'2026-09-15');
});

test('P1.1-A6 historial newest-first y persistencia local/cloud conservan Reservation',()=>{
  const first=registerReservation(crm(),actor,input({now:new Date(2026,7,25,10)}));const second=registerReservation(first.crm,actor,input({propertyId:31,expiresAt:'',now:new Date(2026,7,25,11)}));assert.deepEqual(reservationsForClient(second.crm.reservations,10).map((x)=>x.id),[2,1]);
  const storage=new MemoryStorage();writeLocalSnapshot(second.crm,{markDirty:true,reason:'A6'},storage);assert.deepEqual(readLocalSnapshot(storage)?.reservations,second.crm.reservations);
  const org='22222222-2222-4222-8222-222222222222';second.crm.organization.id=org;const rows:CloudMembershipRow[]=[{organization_id:org,member_id:1,user_id:'owner',role:'owner',status:'active',display_name:'Dueño',email:'o@x.com'},{organization_id:org,member_id:20,user_id:'agent',role:'agent',status:'active',display_name:'Agente',email:'a@x.com'}];const ctx=membershipContext(rows,'owner');second.crm.teamMembers=ctx.members;const restored=cloudRecordsToCrm(crmToCloudRecords(second.crm,ctx,'owner'),ctx,structuredClone(second.crm));assert.deepEqual(restored.reservations,second.crm.reservations);
});

test('P1.1-A6 UI/arquitectura: sección, CTA, estados, cache-bust y ausencia de sistemas paralelos',()=>{
  const workflow=readFileSync('src/reservation-workflow.ts','utf8'),ui=readFileSync('src/reservation-workflow-ui.ts','utf8'),css=readFileSync('src/reservation-workflow.css','utf8'),index=readFileSync('index.html','utf8'),agenda=readFileSync('src/agenda.ts','utf8');
  assert.match(ui,/Reservas/);assert.match(ui,/Registrar reserva/);assert.match(ui,/Oferta vinculada \(opcional\)/);assert.match(ui,/Cancelada/);assert.match(ui,/Concretada/);assert.match(ui,/form\.dataset\.submitting/);assert.match(css,/@media \(max-width:720px\)/);assert.match(css,/min-height:48px/);assert.match(index,/reservation-workflow\.css\?v=20260826-1/);assert.match(index,/reservation-workflow-ui\.js\?v=20260826-1/);
  assert.doesNotMatch(`${workflow}\n${ui}`,/state\.crm\.reminders|createReminder|Commission|Offer\.reservationId/i);assert.doesNotMatch(agenda,/reservations/);assert.doesNotMatch(index,/data-module=["']reservas/i);
});
