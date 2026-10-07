import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { chromium } from 'playwright';
import { initialData } from '../dist/models.js';
import { installA35H5R1ModernTenantHarness } from '../dist/tests/a35-h5-r1-modern-tenant-harness.js';

const ORG='trvgestioninmobiliaria';
const USER='b133-agent';
function fixture(){
 const crm=structuredClone(initialData);
 crm.organization={id:ORG,name:'TRV Gestión Inmobiliaria',seatLimit:null,planLabel:'R2'};
 crm.teamMembers=[
  {id:1,userId:'b133-owner',name:'Franco Solís',email:'owner@x.test',role:'Dueño',status:'Activo',createdAt:'2026-08-01T12:00:00Z'},
  {id:2,userId:'b133-admin',name:'Ana Administradora',email:'admin@x.test',role:'Administrador',status:'Activo',createdAt:'2026-08-02T12:00:00Z'},
  {id:3,userId:USER,name:'Carla Corredora',email:'agent@x.test',role:'Corredor',status:'Activo',createdAt:'2026-08-03T12:00:00Z'},
 ];
 crm.clients=[{id:103,name:'Lead Corredor',phone:'03515110103',email:'lead@x.test',interest:'Departamento',status:'Lead',temperature:'Tibio',pipeline:'Nuevo',assignedToId:3,createdById:3}];
 crm.conversations=[]; crm.properties=[]; crm.contacts=[]; crm.reminders=[]; crm.fichas=[]; crm.activityLog=[];
 crm.settings={...crm.settings,profileName:'Gerencia Comercial',profileEmail:'agent@x.test',agencyName:'TRV Gestión Inmobiliaria'};
 return crm;
}
const chrome=()=>['/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser'].find(existsSync);
async function wait(url){for(let i=0;i<100;i++){try{if((await fetch(url+'/health')).ok)return;}catch{} await new Promise(r=>setTimeout(r,100));}throw new Error('server');}
async function start(port){const p=spawn(process.execPath,['dist/server.js'],{env:{...process.env,PORT:String(port),SUPABASE_URL:'',SUPABASE_PUBLISHABLE_KEY:'',SUPABASE_SECRET_KEY:'',SUPABASE_SERVICE_ROLE_KEY:'',LEAD_QUALIFICATION_AI_ENDPOINT:'',LEAD_QUALIFICATION_AI_KEY:'',LEAD_QUALIFICATION_AI_MODEL:''},stdio:['ignore','pipe','pipe']});await wait(`http://127.0.0.1:${port}`);return p;}
async function stop(p){if(p.exitCode!==null)return;p.kill('SIGTERM');await new Promise(r=>{const t=setTimeout(()=>{if(p.exitCode===null)p.kill('SIGKILL');r();},2000);p.once('exit',()=>{clearTimeout(t);r();});});}

test('R2 Corredor CTA exact actor/visibility trace',{timeout:90000},async()=>{
 const executablePath=chrome(); assert.ok(executablePath);
 const port=51900+Math.floor(Math.random()*80); const app=await start(port); const browser=await chromium.launch({executablePath,headless:true});
 try{
  const crm=fixture(); const context=await browser.newContext({viewport:{width:390,height:844},locale:'es-AR',timezoneId:'America/Argentina/Cordoba'});
  await installA35H5R1ModernTenantHarness(context,crm,USER);
  await context.addInitScript(({crm})=>{
   localStorage.setItem('propcontrol-cloud-session-v1',JSON.stringify({accessToken:'agent-r2',refreshToken:'agent-r2-r',expiresAt:Date.now()+3600000,userId:'b133-agent',email:'agent@x.test'}));
   localStorage.setItem('trv-crm-basico:user:b133-agent',JSON.stringify(crm));
   localStorage.setItem('trv-crm-basico:user:b133-agent:sync',JSON.stringify({dirty:false,localUpdatedAt:'2026-08-02T18:00:00-03:00'}));
   localStorage.setItem('propcontrol-active-team-member-v1','3');
   localStorage.setItem('propcontrol-whatsapp-human-identity-v1:trvgestioninmobiliaria:3:cloud%3Ab133-agent',JSON.stringify({version:1,organizationId:'trvgestioninmobiliaria',memberId:3,actorKey:'cloud:b133-agent',humanName:'Carla Pereyra',confirmedAt:'2026-08-02T17:30:00.000Z'}));
  },{crm});
  try{
   const page=await context.newPage(); await page.goto(`http://127.0.0.1:${port}`,{waitUntil:'domcontentloaded'}); await page.waitForSelector('#crm.active',{state:'visible',timeout:20000});
   const before=await page.evaluate(async()=>{const store=await import('/dist/store.js');const access=await import('/dist/team-access.js');const tenant=await import('/dist/tenant-runtime.js');const scope=tenant.currentTenantScope();const actor=store.authenticatedTenantMember(scope);const visual=access.activeMember();return {scope,actor:actor&&{id:actor.id,userId:actor.userId,role:actor.role},visual:{id:visual.id,userId:visual.userId,role:visual.role},visibleClients:access.visibleClients().map(x=>({id:x.id,assignedToId:x.assignedToId})),crmClients:store.state.crm.clients.map(x=>({id:x.id,assignedToId:x.assignedToId})),cards:document.querySelectorAll('#crm .mvp-lead-card').length,cta:document.querySelectorAll('#crm [data-contact-whatsapp="103"]').length};});
   const toggle=page.locator('[data-toggle="client-form"]'); if(await toggle.count()) await toggle.click();
   const form=page.locator('#mvp-lead-form'); if(await form.count()){const cancel=form.getByRole('button',{name:'Cancelar',exact:true}); if(await cancel.count()) await cancel.click();}
   await page.waitForTimeout(150);
   const after=await page.evaluate(async()=>{const store=await import('/dist/store.js');const access=await import('/dist/team-access.js');const tenant=await import('/dist/tenant-runtime.js');const scope=tenant.currentTenantScope();const actor=store.authenticatedTenantMember(scope);const visual=access.activeMember();return {scope,actor:actor&&{id:actor.id,userId:actor.userId,role:actor.role},visual:{id:visual.id,userId:visual.userId,role:visual.role},visibleClients:access.visibleClients().map(x=>({id:x.id,assignedToId:x.assignedToId})),crmClients:store.state.crm.clients.map(x=>({id:x.id,assignedToId:x.assignedToId})),cards:document.querySelectorAll('#crm .mvp-lead-card').length,cta:document.querySelectorAll('#crm [data-contact-whatsapp="103"]').length};});
   console.log('R2_WHATSAPP_AGENT_BEFORE='+JSON.stringify(before)); console.log('R2_WHATSAPP_AGENT_AFTER='+JSON.stringify(after));
   assert.equal(after.actor?.role,'Corredor'); assert.equal(after.visual.role,'Corredor'); assert.deepEqual(after.visibleClients,[{id:103,assignedToId:3}]); assert.equal(after.cta,1);
  }finally{await context.close();}
 }finally{await browser.close();await stop(app);}
});