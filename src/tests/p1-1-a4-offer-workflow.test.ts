import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { cloudRecordsToCrm, crmToCloudRecords, membershipContext, type CloudMembershipRow } from '../cloud-records.js';
import { initialData, type Client, type CrmData, type Property } from '../models.js';
import { readLocalSnapshot, writeLocalSnapshot } from '../sync-safety.js';
import { offersForClient, registerCounterOffer, registerOffer, resolveOffer } from '../offer-workflow.js';

class MemoryStorage implements Storage {
  private readonly values = new Map<string,string>();
  get length(){ return this.values.size; } clear(){ this.values.clear(); }
  getItem(k:string){ return this.values.get(k) ?? null; } key(i:number){ return [...this.values.keys()][i] ?? null; }
  removeItem(k:string){ this.values.delete(k); } setItem(k:string,v:string){ this.values.set(k,v); }
}
const NOW = new Date(2026,7,24,15); const FOLLOW='2026-08-27';
const agent={id:20,role:'Corredor' as const}, owner={id:1,role:'Dueño' as const}, admin={id:2,role:'Administrador' as const};
function lead(pipeline='Nuevo', extra:Partial<Client>={}):Client { return {id:10,name:'Lucía Martín',phone:'3515550101',interest:'Dúplex Docta',status:'Lead',temperature:'Caliente',pipeline,budget:'120000',currency:'USD',paymentMethod:'Contado',zones:'Docta',purpose:'Vivir',purchaseTimeframe:'0-3 meses',canMoveForward:'Sí',assignedToId:20,createdById:20,...extra} as Client; }
function property(extra:Partial<Property>={}):Property { return {id:30,title:'Docta Etapa 3',address:'Docta, Córdoba',type:'Dúplex',operation:'Venta',price:133000,owner:'Constructor',status:'Disponible',assignedToId:20,createdById:20,...extra}; }
function crm(stage='Nuevo'):CrmData { const d=structuredClone(initialData); d.clients=[lead(stage)]; d.properties=[property()]; d.offers=[]; d.visits=[]; d.reminders=[]; d.activityLog=[]; return d; }
function offerInput(extra:Record<string,unknown>={}) { return {clientId:10,propertyId:30,amount:75000,currency:'USD',origin:'Cliente',paymentTerms:'Contado',conditions:'Sujeto a revisión',validUntil:'2026-09-01',nextAction:'Presentar oferta al propietario',nextFollowUp:FOLLOW,now:NOW,...extra} as Parameters<typeof registerOffer>[2]; }
function created(stage='Nuevo'){ return registerOffer(crm(stage),agent,offerInput()); }
const json=(v:unknown)=>JSON.stringify(v);

test('P1.1-A4 creación válida, validaciones, permisos y zero mutation',()=>{
  const ok=created();
  assert.deepEqual({status:ok.offer.status,parent:ok.offer.parentOfferId,clientId:ok.offer.clientId,propertyId:ok.offer.propertyId,assigned:ok.offer.assignedToId,creator:ok.offer.createdById},{status:'Pendiente',parent:undefined,clientId:10,propertyId:30,assigned:20,creator:20});
  assert.equal(ok.crm.clients[0]?.pipeline,'Negociación'); assert.equal(ok.crm.clients[0]?.nextAction,'Presentar oferta al propietario'); assert.equal(ok.crm.clients[0]?.nextFollowUp,FOLLOW); assert.equal(ok.crm.reminders.length,0);
  assert.equal(ok.crm.activityLog[0]?.action,'Oferta registrada'); assert.match(ok.crm.activityLog[0]?.detail ?? '',/Lucía Martín.*Docta Etapa 3.*USD.*75[.,]000/);
  for(const bad of [0,-1,NaN,Infinity]) assert.throws(()=>registerOffer(crm(),agent,offerInput({amount:bad})),/monto/i);
  assert.throws(()=>registerOffer(crm(),agent,offerInput({currency:'EUR'})),/moneda/i);
  assert.throws(()=>registerOffer(crm(),agent,offerInput({origin:'Sistema'})),/origen/i);
  assert.throws(()=>registerOffer(crm(),agent,offerInput({propertyId:999})),/propiedad/i);
  assert.throws(()=>registerOffer(crm(),agent,offerInput({nextAction:''})),/próxima acción/i);
  assert.throws(()=>registerOffer(crm(),agent,offerInput({nextFollowUp:'2026-02-30'})),/próxima fecha/i);
  assert.throws(()=>registerOffer(crm(),agent,offerInput({nextFollowUp:'2026-08-20'})),/pasado/i);
  for(const stage of ['Ganado','Perdido']) assert.throws(()=>registerOffer(crm(stage),agent,offerInput()),/ganado o perdido/i);
  const hiddenProperty=crm(); hiddenProperty.properties[0]=property({assignedToId:99}); const hiddenBefore=json(hiddenProperty);
  assert.throws(()=>registerOffer(hiddenProperty,agent,offerInput()),/permiso/i); assert.equal(json(hiddenProperty),hiddenBefore);
  const foreign=crm(); foreign.clients[0]=lead('Nuevo',{assignedToId:99}); foreign.properties[0]=property({assignedToId:99});
  const before=json(foreign); assert.throws(()=>registerOffer(foreign,agent,offerInput()),/permiso/i); assert.equal(json(foreign),before);
  assert.doesNotThrow(()=>registerOffer(foreign,owner,offerInput())); assert.doesNotThrow(()=>registerOffer(foreign,admin,offerInput()));
  const withReminder=crm(); withReminder.reminders=[{id:77,date:FOLLOW,title:'Tarea previa',related:'Lucía',priority:'Media',assignedToId:20,createdById:20}];
  const reminderSnapshot=structuredClone(withReminder.reminders); const reminderResult=registerOffer(withReminder,agent,offerInput()); assert.deepEqual(reminderResult.crm.reminders,reminderSnapshot);
});

test('P1.1-A4 pipeline monotónico: avanza hasta Negociación, no degrada Reservado y no reabre terminales',()=>{
  for(const stage of ['Nuevo','Contactado','Calificado','Visita coordinada']) assert.equal(created(stage).crm.clients[0]?.pipeline,'Negociación');
  for(const stage of ['Negociación','Reservado']) assert.equal(created(stage).crm.clients[0]?.pipeline,stage);
  for(const stage of ['Ganado','Perdido']) assert.throws(()=>created(stage),/ganado o perdido/i);
});

test('P1.1-A4 contraoferta preserva historia y es atómica',()=>{
  const first=created();
  const result=registerCounterOffer(first.crm,agent,{parentOfferId:1,amount:82000,currency:'USD',origin:'Propietario',paymentTerms:'Contado',nextAction:'Presentar contraoferta al cliente',nextFollowUp:'2026-08-28',now:NOW});
  assert.equal(result.offer.parentOfferId,1); assert.equal(result.offer.status,'Pendiente'); assert.equal(result.offer.origin,'Propietario');
  assert.equal(result.crm.offers.find(x=>x.id===1)?.status,'Contraofertada'); assert.deepEqual(offersForClient(result.crm.offers,10).map(x=>x.id),[2,1]); assert.equal(result.crm.activityLog[0]?.action,'Contraoferta registrada');
  const snapshot=structuredClone(result.crm); assert.throws(()=>registerCounterOffer(result.crm,agent,{parentOfferId:1,amount:83000,currency:'USD',origin:'Cliente',nextAction:'Consultar',nextFollowUp:FOLLOW,now:NOW}),/pendiente/i); assert.equal(json(result.crm),json(snapshot));
  const first2=created(); const before=json(first2.crm); assert.throws(()=>registerCounterOffer(first2.crm,agent,{parentOfferId:1,amount:0,currency:'USD',origin:'Propietario',nextAction:'Consultar',nextFollowUp:FOLLOW,now:NOW}),/monto/i); assert.equal(json(first2.crm),before);
});

test('P1.1-A4 aceptación/rechazo/retirada son terminales de Offer sin Reservation ni Perdido automático',()=>{
  const accepted=resolveOffer(created('Negociación').crm,agent,{offerId:1,status:'Aceptada',nextAction:'Formalizar reserva',nextFollowUp:'2026-08-29',now:NOW});
  assert.equal(accepted.offer.status,'Aceptada'); assert.equal(accepted.crm.clients[0]?.pipeline,'Negociación'); assert.equal(accepted.crm.clients[0]?.nextAction,'Formalizar reserva'); assert.equal('reservation' in accepted.crm,false); assert.equal(accepted.crm.reminders.length,0); assert.equal(accepted.crm.activityLog[0]?.action,'Oferta aceptada');
  assert.throws(()=>resolveOffer(accepted.crm,agent,{offerId:1,status:'Rechazada',nextAction:'X',nextFollowUp:FOLLOW,now:NOW}),/cerrada/i);
  assert.throws(()=>resolveOffer(created().crm,agent,{offerId:1,status:'Contraofertada',nextAction:'X',nextFollowUp:FOLLOW,now:NOW}),/estado válido/i);
  const reserved=resolveOffer(created('Reservado').crm,agent,{offerId:1,status:'Aceptada',nextAction:'Revisar documentación',nextFollowUp:FOLLOW,now:NOW}); assert.equal(reserved.crm.clients[0]?.pipeline,'Reservado');
  const rejected=resolveOffer(created().crm,agent,{offerId:1,status:'Rechazada',nextAction:'Enviar alternativas',nextFollowUp:FOLLOW,now:NOW}); assert.equal(rejected.offer.status,'Rechazada'); assert.notEqual(rejected.crm.clients[0]?.pipeline,'Perdido'); assert.equal(rejected.crm.activityLog[0]?.action,'Oferta rechazada');
  const withdrawn=resolveOffer(created().crm,agent,{offerId:1,status:'Retirada',nextAction:'Retomar búsqueda',nextFollowUp:FOLLOW,now:NOW}); assert.equal(withdrawn.offer.status,'Retirada'); assert.equal(withdrawn.crm.activityLog[0]?.action,'Oferta retirada');
});

test('P1.1-A4 valida permiso/coherencia de Offer antes de toda mutación',()=>{
  const foreign=created(); foreign.crm.offers[0]={...foreign.crm.offers[0]!,assignedToId:99}; const before=json(foreign.crm); assert.throws(()=>resolveOffer(foreign.crm,agent,{offerId:1,status:'Rechazada',nextAction:'Alternativas',nextFollowUp:FOLLOW,now:NOW}),/permiso/i); assert.equal(json(foreign.crm),before);
  const corrupt=created(); corrupt.crm.offers[0]={...corrupt.crm.offers[0]!,propertyId:999}; const before2=json(corrupt.crm); assert.throws(()=>resolveOffer(corrupt.crm,owner,{offerId:1,status:'Aceptada',nextAction:'Formalizar reserva',nextFollowUp:FOLLOW,now:NOW}),/propiedad/i); assert.equal(json(corrupt.crm),before2);
});

test('P1.1-A4 F5/local y cloud round-trip conservan historial y parentOfferId',()=>{
  const first=created(); const chain=registerCounterOffer(first.crm,agent,{parentOfferId:1,amount:82000,currency:'USD',origin:'Propietario',nextAction:'Consultar respuesta',nextFollowUp:FOLLOW,now:NOW});
  const storage=new MemoryStorage(); writeLocalSnapshot(chain.crm,{markDirty:true,reason:'A4 historial'},storage); const local=readLocalSnapshot(storage); assert.equal(local?.offers.length,2); assert.equal(local?.offers.find(x=>x.id===2)?.parentOfferId,1);
  const org='22222222-2222-4222-8222-222222222222'; chain.crm.organization.id=org;
  const memberships:CloudMembershipRow[]=[{organization_id:org,member_id:1,user_id:'owner-user',role:'owner',status:'active',display_name:'Dueño',email:'owner@example.com'},{organization_id:org,member_id:20,user_id:'agent-user',role:'agent',status:'active',display_name:'Corredor',email:'agent@example.com'}];
  const ctx=membershipContext(memberships,'owner-user'); chain.crm.teamMembers=ctx.members; const restored=cloudRecordsToCrm(crmToCloudRecords(chain.crm,ctx,'owner-user'),ctx,structuredClone(chain.crm)); assert.deepEqual(restored.offers,chain.crm.offers); assert.equal(restored.offers.find(x=>x.id===2)?.parentOfferId,1);
});

test('P1.1-A4 Agenda/Reminder/UI permanecen bajo contratos existentes y doble submit queda bloqueado',()=>{
  const agenda=readFileSync('src/agenda.ts','utf8'), workflow=readFileSync('src/offer-workflow.ts','utf8'), ui=readFileSync('src/offer-workflow-ui.ts','utf8'), css=readFileSync('src/offer-workflow.css','utf8'), index=readFileSync('index.html','utf8');
  assert.match(agenda,/nextFollowUp/); assert.doesNotMatch(agenda,/\boffers\b/); assert.doesNotMatch(`${workflow}\n${ui}`,/state\.crm\.reminders|Reminder|createReminder/i);
  assert.match(ui,/\.mvp-lead-full-content/); assert.match(ui,/Ofertas \/ Negociación/); assert.match(ui,/Registrar oferta/); assert.match(ui,/Registrar contraoferta/); assert.match(ui,/form\.dataset\.submitting === 'true'/); assert.match(ui,/button\.disabled = busy/);
  assert.match(css,/min-height:\s*44px/); assert.match(css,/@media \(max-width:720px\)/); assert.match(index,/offer-workflow\.css\?v=20260824-1/); assert.match(index,/offer-workflow-ui\.js\?v=20260824-1/); assert.doesNotMatch(index,/data-module=["']ofertas["']/i);
});
