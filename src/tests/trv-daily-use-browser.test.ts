import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { initialData, type Client, type CrmData, type TeamMember } from '../models.js';
import { tenantStorageNamespace } from '../tenant-storage.js';
import { installA35H5R1ModernTenantHarness } from './a35-h5-r1-modern-tenant-harness.js';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const USER_A = 'trv-daily-owner-a';
const USER_B = 'trv-daily-agent-b';
const FIXED_TIME = new Date('2026-09-18T12:00:00-03:00');

function member(id: number, userId: string, role: TeamMember['role'], name: string): TeamMember {
  return { id, userId, name, email: `${userId}@example.test`, role, status: 'Activo', createdAt: '2026-09-01T12:00:00.000Z' };
}

function lead(id: number, name: string, assignedToId: number, overrides: Partial<Client> = {}): Client {
  return {
    id, name, phone: `5493515550${String(id).padStart(3, '0')}`,
    interest: 'Departamento 2 dormitorios General Paz con balcón',
    status: 'Lead', temperature: 'Caliente', pipeline: 'Calificado',
    budget: 'USD 120.000', currency: 'USD', paymentMethod: 'Contado',
    purchaseTimeframe: '0-3 meses', purpose: 'Vivir', knowsArea: 'Sí',
    canMoveForward: 'Sí', zones: 'General Paz', propertyType: 'Departamento',
    bedrooms: 2, features: 'Balcón', assignedToId, createdById: assignedToId,
    ...overrides,
  };
}

function tenantA(): CrmData {
  const crm = structuredClone(initialData);
  crm.organization = { id: ORG_A, name: 'Tenant A TRV Daily', seatLimit: null, planLabel: 'Smoke' };
  crm.teamMembers = [
    member(1, USER_A, 'Dueño', 'Owner A'),
    member(2, 'agent-a', 'Corredor', 'Agent A'),
  ];
  crm.clients = [
    lead(1, 'Lead Programado A', 1, { nextAction: 'Confirmar interés', nextFollowUp: '2026-09-18' }),
    lead(2, 'Lead NONE A', 1, { nextAction: 'Llamar por decisión', nextFollowUp: '2026-09-18' }),
    lead(3, 'Lead Won Reopen A', 1, { pipeline: 'Negociación', nextAction: 'Confirmar propuesta', nextFollowUp: '2026-09-18' }),
    lead(4, 'Lead Lost A', 1, { pipeline: 'Negociación', nextAction: 'Cerrar decisión', nextFollowUp: '2026-09-18' }),
  ];
  crm.properties = [
    { id: 10, title: 'Departamento General Paz A', address: 'General Paz, Córdoba', type: 'Departamento', operation: 'Venta', price: 100000, owner: 'Owner Property A', status: 'Activa', bedrooms: 2, paymentMethod: 'Contado', features: 'Balcón', assignedToId: 1, createdById: 1 },
    { id: 11, title: 'Casa lejana A', address: 'Otra zona', type: 'Casa', operation: 'Venta', price: 300000, owner: 'Owner Property A2', status: 'Activa', bedrooms: 4, assignedToId: 2, createdById: 2 },
  ];
  crm.visits = [{ id: 101, clientId: 1, propertyId: 10, scheduledAt: '2026-09-18T15:30:00.000Z', status: 'Coordinada', assignedToId: 1, createdById: 1, createdAt: '2026-09-10T12:00:00.000Z', updatedAt: '2026-09-10T12:00:00.000Z' }];
  crm.offers = [{ id: 201, clientId: 1, propertyId: 10, origin: 'Cliente', amount: 95000, currency: 'USD', validUntil: '2026-09-18', status: 'Pendiente', assignedToId: 1, createdById: 1, createdAt: '2026-09-10T12:00:00.000Z', updatedAt: '2026-09-10T12:00:00.000Z' }];
  crm.reservations = [{ id: 301, clientId: 1, propertyId: 10, amount: 5000, currency: 'USD', reservedAt: '2026-09-17', expiresAt: '2026-09-19', status: 'Activa', assignedToId: 1, createdById: 1, createdAt: '2026-09-17T12:00:00.000Z', updatedAt: '2026-09-17T12:00:00.000Z' }];
  crm.activityLog = [];
  crm.contacts = []; crm.reminders = []; crm.fichas = []; crm.conversations = [];
  crm.settings = { ...crm.settings, profileName: 'Owner A', profileEmail: `${USER_A}@example.test`, agencyName: 'Tenant A TRV Daily' };
  return crm;
}

function tenantB(): CrmData {
  const crm = structuredClone(initialData);
  crm.organization = { id: ORG_B, name: 'Tenant B TRV Daily', seatLimit: null, planLabel: 'Smoke' };
  crm.teamMembers = [
    member(1, 'owner-b', 'Dueño', 'Owner B'),
    member(2, USER_B, 'Corredor', 'Agent B'),
    member(3, 'other-agent-b', 'Corredor', 'Other Agent B'),
  ];
  crm.clients = [
    lead(21, 'Lead Visible Tenant B', 2, { nextAction: 'Contactar B', nextFollowUp: '2026-09-18' }),
    lead(22, 'Lead Terminal Tenant B', 2, { pipeline: 'Perdido', status: 'Operación perdida', outcome: 'lost', closedAt: '2026-09-17', lostReason: 'Precio', nextAction: undefined, nextFollowUp: undefined }),
    lead(23, 'Lead Oculto Tenant B', 3, { nextAction: 'Oculto', nextFollowUp: '2026-09-18' }),
  ];
  crm.properties = [
    { id: 210, title: 'Propiedad Visible Tenant B', address: 'General Paz', type: 'Departamento', operation: 'Venta', price: 90000, owner: 'B', status: 'Activa', bedrooms: 2, assignedToId: 2, createdById: 2 },
    { id: 230, title: 'Propiedad Oculta Tenant B', address: 'General Paz', type: 'Departamento', operation: 'Venta', price: 90000, owner: 'B', status: 'Activa', bedrooms: 2, assignedToId: 3, createdById: 3 },
  ];
  crm.visits = [
    { id: 2101, clientId: 21, propertyId: 210, scheduledAt: '2026-09-18T17:00:00.000Z', status: 'Coordinada', assignedToId: 2, createdById: 2, createdAt: '2026-09-10', updatedAt: '2026-09-10' },
    { id: 2301, clientId: 23, propertyId: 230, scheduledAt: '2026-09-18T18:00:00.000Z', status: 'Coordinada', assignedToId: 3, createdById: 3, createdAt: '2026-09-10', updatedAt: '2026-09-10' },
  ];
  crm.offers = [
    { id: 2201, clientId: 21, propertyId: 210, origin: 'Cliente', amount: 85000, currency: 'USD', validUntil: '2026-09-18', status: 'Pendiente', assignedToId: 2, createdById: 2, createdAt: '2026-09-10', updatedAt: '2026-09-10' },
    { id: 2302, clientId: 23, propertyId: 230, origin: 'Cliente', amount: 85000, currency: 'USD', validUntil: '2026-09-18', status: 'Pendiente', assignedToId: 3, createdById: 3, createdAt: '2026-09-10', updatedAt: '2026-09-10' },
  ];
  crm.reservations = [
    { id: 2202, clientId: 21, propertyId: 210, amount: 5000, currency: 'USD', reservedAt: '2026-09-17', expiresAt: '2026-09-19', status: 'Activa', assignedToId: 2, createdById: 2, createdAt: '2026-09-17', updatedAt: '2026-09-17' },
    { id: 2303, clientId: 23, propertyId: 230, amount: 5000, currency: 'USD', reservedAt: '2026-09-17', expiresAt: '2026-09-19', status: 'Activa', assignedToId: 3, createdById: 3, createdAt: '2026-09-17', updatedAt: '2026-09-17' },
  ];
  crm.activityLog = [];
  crm.contacts = []; crm.reminders = []; crm.fichas = []; crm.conversations = [];
  crm.settings = { ...crm.settings, profileName: 'Agent B', profileEmail: `${USER_B}@example.test`, agencyName: 'Tenant B TRV Daily' };
  return crm;
}

function switchTenantForUserA(): CrmData {
  const crm = structuredClone(initialData);
  crm.organization = { id: ORG_B, name: 'Tenant B Switch', seatLimit: null, planLabel: 'Smoke' };
  crm.teamMembers = [member(7, USER_A, 'Dueño', 'Owner A in B')];
  crm.clients = [lead(70, 'Sólo Tenant B Switch', 7)];
  crm.properties = [];
  crm.visits = []; crm.offers = []; crm.reservations = [];
  crm.activityLog = []; crm.contacts = []; crm.reminders = []; crm.fichas = []; crm.conversations = [];
  crm.settings = { ...crm.settings, profileName: 'Owner A in B', profileEmail: `${USER_A}@example.test`, agencyName: 'Tenant B Switch' };
  return crm;
}

function chromeExecutable(): string {
  const executable = ['/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser'].find(existsSync);
  assert.ok(executable, 'Chrome/Chromium no disponible para TRV Daily smoke.');
  return executable;
}

async function waitForServer(baseUrl: string): Promise<void> {
  for (let i=0;i<100;i+=1) {
    try { if ((await fetch(`${baseUrl}/health`)).ok) return; } catch {}
    await new Promise((resolve)=>setTimeout(resolve,200));
  }
  throw new Error('TRV_DAILY_SMOKE_SERVER_UNAVAILABLE');
}

async function startServer(port: number): Promise<ChildProcess> {
  const server=spawn(process.execPath,['dist/server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),SUPABASE_URL:'',SUPABASE_PUBLISHABLE_KEY:'',SUPABASE_SECRET_KEY:'',SUPABASE_SERVICE_ROLE_KEY:''},stdio:['ignore','pipe','pipe']});
  await waitForServer(`http://127.0.0.1:${port}`);
  return server;
}

async function stopServer(server: ChildProcess): Promise<void> {
  if (server.exitCode!==null) return;
  server.kill('SIGTERM');
  await new Promise<void>((resolve)=>{
    const timer=setTimeout(()=>{if(server.exitCode===null)server.kill('SIGKILL');resolve();},2000);
    server.once('exit',()=>{clearTimeout(timer);resolve();});
  });
}

async function installContext(context: BrowserContext, crm: CrmData, userId: string, activeMemberId: number): Promise<{crmKey:string;syncKey:string}> {
  await installA35H5R1ModernTenantHarness(context,crm,userId);
  const ns=tenantStorageNamespace({userId,organizationId:crm.organization.id});
  const legacyKey=`trv-crm-basico:user:${userId}`;
  await context.addInitScript(({data,user,memberId,crmKey,syncKey,legacy})=>{
    localStorage.setItem('propcontrol-cloud-session-v1',JSON.stringify({accessToken:'daily-token',refreshToken:'daily-refresh',expiresAt:Date.now()+3600000,userId:user,email:`${user}@example.test`}));
    localStorage.setItem(crmKey,JSON.stringify(data));
    localStorage.setItem(syncKey,JSON.stringify({dirty:false,localUpdatedAt:'2026-09-18T14:00:00.000Z',lastCloudSavedAt:'2026-09-18T14:00:00.000Z',lastCloudVersion:'2026-09-18T14:00:00.000Z'}));
    localStorage.setItem(legacy,JSON.stringify(data));
    localStorage.setItem(`${legacy}:sync`,JSON.stringify({dirty:false,localUpdatedAt:'2026-09-18T14:00:00.000Z',lastCloudSavedAt:'2026-09-18T14:00:00.000Z'}));
    localStorage.setItem('propcontrol-active-team-member-v1',String(memberId));
  },{data:crm,user:userId,memberId:activeMemberId,crmKey:ns.crmKey,syncKey:ns.syncKey,legacy:legacyKey});
  return {crmKey:ns.crmKey,syncKey:ns.syncKey};
}

async function openApp(page: Page, baseUrl: string): Promise<void> {
  await page.clock.setFixedTime(FIXED_TIME);
  await page.goto(baseUrl,{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#crm.active .mvp-lead-card',{state:'visible',timeout:20000});
}

async function reloadApp(page: Page): Promise<void> {
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#crm.active .mvp-lead-card',{state:'visible',timeout:20000});
}

async function navigate(page: Page,moduleId: string): Promise<void> {
  await page.locator(`[data-module="${moduleId}"]:visible`).first().click();
  await page.waitForSelector(`#${moduleId}.active`,{state:'visible'});
}

async function stable(page: Page,selector: string): Promise<void> {
  await page.waitForFunction(async (value)=>{
    const first=document.querySelector(value);
    if (!(first instanceof HTMLElement)) return false;
    const rect=first.getBoundingClientRect();
    if (!first.isConnected || rect.width<=0 || rect.height<=0) return false;
    if (first instanceof HTMLButtonElement && first.disabled) return false;
    await new Promise<void>((resolve)=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
    return document.querySelector(value)===first && first.isConnected;
  },selector);
}

async function openLeadDetails(page: Page,id: number): Promise<void> {
  const sheet=`.mvp-lead-card[data-client-id="${id}"] [data-lead-full-sheet="${id}"]`;
  if (await page.locator(sheet).evaluate((node)=>node instanceof HTMLDetailsElement && node.open).catch(()=>false)) return;
  const actions=`.mvp-lead-card[data-client-id="${id}"] .mvp-lead-quick-actions[data-zero-training-actions="true"]`;
  await page.waitForSelector(actions,{state:'visible'});
  const menu=`${actions} .mvp-lead-actions-menu > summary`;
  await stable(page,menu);
  await page.locator(menu).click();
  const button=`${actions} .mvp-lead-actions-menu[open] [data-open-lead-details="${id}"]`;
  await stable(page,button);
  await page.locator(button).click();
  await page.waitForFunction((selector)=>{const node=document.querySelector(selector);return node instanceof HTMLDetailsElement && node.open;},sheet);
}

async function openMatchedProperty(page: Page,clientId: number,propertyId: number): Promise<void> {
  const card=page.locator(`.mvp-lead-card[data-client-id="${clientId}"]`);
  const matches=card.locator('.mvp-lead-matches');
  await matches.waitFor({state:'visible'});
  const summary=matches.locator(':scope > summary');
  await summary.waitFor({state:'visible'});
  await summary.click();
  await page.waitForFunction(({clientId:id})=>{
    const details=document.querySelector(`.mvp-lead-card[data-client-id="${id}"] .mvp-lead-matches`);
    return details instanceof HTMLDetailsElement && details.open;
  },{clientId});
  assert.equal(await matches.evaluate((node)=>node instanceof HTMLDetailsElement && node.open),true);
  const button=matches.locator(`[data-open-match-property="${propertyId}"]`);
  await button.waitFor({state:'visible'});
  await button.click();
}

async function followupCompleteButton(page: Page,id: number): Promise<void> {
  const card=page.locator(`.mvp-lead-card[data-client-id="${id}"]`);
  const menu=card.locator('.mvp-lead-followup-menu');
  await menu.waitFor({state:'visible'});
  const isOpen=await menu.evaluate((node)=>node instanceof HTMLDetailsElement && node.open);
  if (!isOpen) {
    const summary=menu.locator(':scope > summary');
    await summary.waitFor({state:'visible'});
    await summary.click();
    await page.waitForFunction(({clientId})=>{
      const details=document.querySelector(`.mvp-lead-card[data-client-id="${clientId}"] .mvp-lead-followup-menu`);
      return details instanceof HTMLDetailsElement && details.open;
    },{clientId:id});
    assert.equal(await menu.evaluate((node)=>node instanceof HTMLDetailsElement && node.open),true);
  }
  const button=menu.locator(`[data-complete-client-follow-up="${id}"]`);
  await button.waitFor({state:'visible'});
  await button.click();
  await page.waitForSelector('dialog[data-followup-completion-dialog][open]',{state:'visible'});
}

async function readCrm(page: Page,key: string): Promise<CrmData> {
  return page.evaluate((storageKey)=>JSON.parse(localStorage.getItem(storageKey)||'{}') as CrmData,key);
}

async function waitClient(page: Page,crmKey: string,syncKey: string,id: number,expected: Record<string,string|number|null>): Promise<void> {
  await page.waitForFunction(({crmKey:ck,syncKey:sk,clientId,expectedValues})=>{
    const crm=JSON.parse(localStorage.getItem(ck)||'{}') as CrmData;
    const client=crm.clients?.find((item)=>item.id===clientId) as Record<string,unknown>|undefined;
    if(!client) return false;
    const matches=Object.entries(expectedValues).every(([key,value])=>value===null ? client[key]===undefined : client[key]===value);
    const sync=JSON.parse(localStorage.getItem(sk)||'{}') as {dirty?:boolean};
    return matches && sync.dirty===false;
  },{crmKey,syncKey,clientId:id,expectedValues:expected},{timeout:25000});
}

function activityCount(crm: CrmData,id: number,action: string): number {
  return crm.activityLog.filter((entry)=>entry.entityType==='Cliente'&&entry.entityId===id&&entry.action===action).length;
}

async function assertNoOverflow(page: Page): Promise<void> {
  const metrics=await page.evaluate(()=>({viewport:window.innerWidth,documentWidth:document.documentElement.scrollWidth}));
  assert.ok(metrics.documentWidth<=metrics.viewport+1,JSON.stringify(metrics));
}

test('TRV Daily Use Gate smoke desktop/mobile, roles, tenants y F5', {timeout:360000}, async()=>{
  const server=await startServer(4388);
  const browser:Browser=await chromium.launch({executablePath:chromeExecutable(),headless:true,args:['--no-sandbox']});
  const baseUrl='http://127.0.0.1:4388';
  try {
    // Tenant A / Dueño / desktop 1366x768
    const crmA=tenantA();
    const desktop=await browser.newContext({viewport:{width:1366,height:768},locale:'es-AR',timezoneId:'America/Argentina/Cordoba'});
    const keysA=await installContext(desktop,crmA,USER_A,1);
    const page=await desktop.newPage();
    await openApp(page,baseUrl);

    // Lead -> exact Property -> correct Lead. OPEN != EDIT.
    await openLeadDetails(page,1);
    await openMatchedProperty(page,1,10);
    await page.waitForSelector('#propiedades.active [data-property-read-sheet="10"]',{state:'visible'});
    assert.match(await page.locator('[data-property-read-sheet="10"]').textContent()||'',/Departamento General Paz A/);
    assert.equal(await page.locator('#mvp-property-form:not(.collapsed)').count(),0);
    await page.locator('[data-property-read-sheet="10"] [data-return-read-entity]').click();
    await page.waitForFunction(()=>{const node=document.querySelector('[data-lead-full-sheet="1"]');return node instanceof HTMLDetailsElement&&node.open;});
    assert.equal(await page.locator('#mvp-lead-form:not(.collapsed)').count(),0);

    // transient nav/returnTarget disappear after F5.
    await openMatchedProperty(page,1,10);
    await page.waitForSelector('#propiedades.active [data-property-read-sheet="10"]',{state:'visible'});
    await reloadApp(page);
    const navAfterF5=await page.evaluate(async()=>{
      const nav=await import(`${location.origin}/dist/entity-read-navigation.js`);
      return nav.readEntityNavigationSnapshot();
    });
    assert.deepEqual(navAfterF5,{target:null,returnTarget:null});
    assert.equal(await page.locator('[data-property-read-sheet]').count(),0);

    // Matching -> exact Property and filters/selections survive contextual round-trip.
    await navigate(page,'propiedades');
    await page.locator('#propiedades [data-open-property-opportunities]').click();
    await page.waitForSelector('#propiedades [data-property-opportunities]',{state:'visible'});
    await page.locator('[data-opportunity-property]').selectOption('10');
    await page.locator('[data-opportunity-search]').fill('Lead Programado A');
    await page.waitForSelector('[data-opportunity-client="1"]',{state:'visible'});
    await page.locator('[data-opportunity-client="1"] [data-open-opportunity-client="1"]').click();
    await page.waitForFunction(()=>{const n=document.querySelector('[data-lead-full-sheet="1"]');return n instanceof HTMLDetailsElement&&n.open;});
    assert.equal(await page.locator('#mvp-lead-form:not(.collapsed)').count(),0);
    await page.locator('.mvp-lead-card[data-client-id="1"] [data-return-read-entity]').click();
    await page.waitForSelector('#propiedades.active [data-property-read-sheet="10"]',{state:'visible'});
    await page.locator('#propiedades [data-open-property-opportunities]').click();
    const navAfterOpportunitiesReentry=await page.evaluate(async()=>{
      const nav=await import(`${location.origin}/dist/entity-read-navigation.js`);
      return nav.readEntityNavigationSnapshot();
    });
    assert.deepEqual(navAfterOpportunitiesReentry,{target:null,returnTarget:null});
    await page.waitForSelector('#propiedades [data-property-opportunities]',{state:'visible'});
    assert.equal(await page.locator('#mvp-property-form:not(.collapsed)').count(),0);
    assert.equal(await page.locator('[data-opportunity-property]').inputValue(),'10');
    assert.equal(await page.locator('[data-opportunity-search]').inputValue(),'Lead Programado A');
    await page.locator('[data-open-opportunity-property="10"]').click();
    await page.waitForSelector('#propiedades.active [data-property-read-sheet="10"]',{state:'visible'});
    assert.match(await page.locator('[data-property-read-sheet="10"]').textContent()||'',/Departamento General Paz A/);

    // Follow-up Scheduled.
    await navigate(page,'crm');
    await openLeadDetails(page,1);
    await followupCompleteButton(page,1);
    const scheduled=page.locator('[data-followup-scheduled-form]');
    await scheduled.locator('input[name="nextAction"]').fill('Enviar comparativa final');
    await scheduled.locator('input[name="nextFollowUp"]').fill('2026-09-19');
    await scheduled.locator('button[type="submit"]').click();
    await waitClient(page,keysA.crmKey,keysA.syncKey,1,{nextAction:'Enviar comparativa final',nextFollowUp:'2026-09-19'});
    let stored=await readCrm(page,keysA.crmKey);
    assert.equal(activityCount(stored,1,'Seguimiento completado'),1);
    await reloadApp(page);
    stored=await readCrm(page,keysA.crmKey);
    assert.equal(stored.clients.find((c)=>c.id===1)?.nextFollowUp,'2026-09-19');
    console.log('SCHEDULED_F5=GREEN');

    // Cancel = no mutation; then NONE = one Activity and no Agenda item.
    await openLeadDetails(page,2);
    const beforeCancel=await readCrm(page,keysA.crmKey);
    await followupCompleteButton(page,2);
    await page.locator('dialog[data-followup-completion-dialog] [data-followup-cancel]').first().click();
    await page.waitForSelector('dialog[data-followup-completion-dialog]',{state:'detached'});
    const afterCancel=await readCrm(page,keysA.crmKey);
    assert.deepEqual(afterCancel.clients.find((c)=>c.id===2),beforeCancel.clients.find((c)=>c.id===2));
    assert.equal(activityCount(afterCancel,2,'Seguimiento completado'),0);

    await openLeadDetails(page,2);
    await followupCompleteButton(page,2);
    await page.locator('dialog[data-followup-completion-dialog] [data-followup-none]').click();
    await waitClient(page,keysA.crmKey,keysA.syncKey,2,{nextAction:null,nextFollowUp:null});
    stored=await readCrm(page,keysA.crmKey);
    assert.equal(activityCount(stored,2,'Seguimiento completado'),1);
    await reloadApp(page);
    stored=await readCrm(page,keysA.crmKey);
    const noneClient=stored.clients.find((c)=>c.id===2);
    assert.equal(noneClient?.nextAction,undefined);
    assert.equal(noneClient?.nextFollowUp,undefined);
    assert.match(await page.locator('.mvp-lead-card[data-client-id="2"]').textContent()||'',/Definir próxima acción|Sin seguimiento/);
    console.log('NONE_F5=GREEN');

    // Agenda read-only: Followup + Visit + Offer + Reservation, NONE excluded.
    await navigate(page,'agenda');
    for(const source of ['visit','offer','reservation']) {
      const badge=page.locator(`[data-agenda-source="${source}"]`).first();
      await badge.waitFor({state:'visible'});
      const card=badge.locator('xpath=ancestor::article[1]');
      assert.equal(await card.locator('[data-open-agenda-context]').count(),1);
      assert.equal(await card.locator('[data-complete-agenda]').count(),0);
      assert.equal(await card.locator('[data-reprogram-source]').count(),0);
    }
    assert.equal(await page.locator('.agenda-card').filter({hasText:'Lead NONE A'}).count(),0);
    const workflowsBefore=await readCrm(page,keysA.crmKey);
    const visitCard=page.locator('[data-agenda-source="visit"]').first().locator('xpath=ancestor::article[1]');
    await visitCard.locator('[data-open-agenda-context="1"]').click();
    await page.waitForFunction(()=>{const n=document.querySelector('[data-lead-full-sheet="1"]');return n instanceof HTMLDetailsElement&&n.open;});
    const workflowsAfter=await readCrm(page,keysA.crmKey);
    assert.deepEqual(workflowsAfter.visits,workflowsBefore.visits);
    assert.deepEqual(workflowsAfter.offers,workflowsBefore.offers);
    assert.deepEqual(workflowsAfter.reservations,workflowsBefore.reservations);

    // Won from full sheet -> F5 -> one Activity.
    await navigate(page,'crm');
    await openLeadDetails(page,3);
    await page.waitForSelector('.mvp-lead-card[data-client-id="3"] [data-close-operation-stage="Ganado"]',{state:'visible'});
    await page.locator('.mvp-lead-card[data-client-id="3"] [data-close-operation-stage="Ganado"]').click();
    await page.waitForSelector('dialog[data-commercial-close-dialog][open] [data-commercial-close-modal-form="won"]',{state:'visible'});
    const won=page.locator('[data-commercial-close-modal-form="won"]');
    await won.locator('input[name="dealAmount"]').fill('100000');
    await won.locator('select[name="dealCurrency"]').selectOption('USD');
    await won.locator('select[name="dealPropertyId"]').selectOption('10');
    await won.locator('select[name="commissionMode"]').selectOption('percentage');
    await won.locator('input[name="commissionPercentage"]').fill('3');
    await won.locator('[data-commercial-close-confirm="Ganado"]').click();
    await waitClient(page,keysA.crmKey,keysA.syncKey,3,{pipeline:'Ganado',outcome:'won'});
    await reloadApp(page);
    stored=await readCrm(page,keysA.crmKey);
    assert.equal(stored.clients.find((c)=>c.id===3)?.outcome,'won');
    assert.equal(activityCount(stored,3,'Operación ganada'),1);
    console.log('WON_F5=GREEN');

    // Reopen -> F5, one Activity and historical Won remains.
    await openLeadDetails(page,3);
    await page.locator('.mvp-lead-card[data-client-id="3"] [data-reopen-operation="3"]').click();
    await page.waitForSelector('dialog[data-commercial-close-dialog][open] [data-commercial-close-modal-form="reopen"]',{state:'visible'});
    await page.locator('[data-commercial-close-modal-form="reopen"] select[name="reopenStage"]').selectOption('Negociación');
    await page.locator('[data-commercial-reopen-confirm]').click();
    await waitClient(page,keysA.crmKey,keysA.syncKey,3,{pipeline:'Negociación',outcome:null});
    await reloadApp(page);
    stored=await readCrm(page,keysA.crmKey);
    assert.equal(stored.clients.find((c)=>c.id===3)?.outcome,undefined);
    assert.equal(activityCount(stored,3,'Operación ganada'),1);
    assert.equal(activityCount(stored,3,'Operación reabierta'),1);
    console.log('REOPEN_F5=GREEN');

    // Lost -> F5 -> one Activity.
    await openLeadDetails(page,4);
    await page.waitForSelector('.mvp-lead-card[data-client-id="4"] [data-close-operation-stage="Perdido"]',{state:'visible'});
    await page.locator('.mvp-lead-card[data-client-id="4"] [data-close-operation-stage="Perdido"]').click();
    await page.waitForSelector('dialog[data-commercial-close-dialog][open] [data-commercial-close-modal-form="lost"]',{state:'visible'});
    await page.locator('[data-commercial-close-modal-form="lost"] select[name="lostReason"]').selectOption('Precio');
    await page.locator('[data-commercial-close-confirm="Perdido"]').click();
    await waitClient(page,keysA.crmKey,keysA.syncKey,4,{pipeline:'Perdido',outcome:'lost'});
    await reloadApp(page);
    stored=await readCrm(page,keysA.crmKey);
    assert.equal(stored.clients.find((c)=>c.id===4)?.outcome,'lost');
    assert.equal(activityCount(stored,4,'Operación perdida'),1);
    console.log('LOST_F5=GREEN');

    // Tenant switch clears navigation/return and cannot contaminate A -> B.
    const switchCrm=switchTenantForUserA();
    const switchNs=tenantStorageNamespace({userId:USER_A,organizationId:ORG_B});
    await page.evaluate(({crm,key,syncKey})=>{
      localStorage.setItem(key,JSON.stringify(crm));
      localStorage.setItem(syncKey,JSON.stringify({dirty:false,localUpdatedAt:'2026-09-18T15:00:00.000Z',lastCloudSavedAt:'2026-09-18T15:00:00.000Z'}));
    },{crm:switchCrm,key:switchNs.crmKey,syncKey:switchNs.syncKey});
    const switchResult=await page.evaluate(async({userId,organizationId,tenantAKey,tenantBKey})=>{
      const nav=await import(`${location.origin}/dist/entity-read-navigation.js`);
      const runtime=await import(`${location.origin}/dist/tenant-runtime.js`);
      const store=await import(`${location.origin}/dist/store.js`);
      nav.openEntityReadOnly({entityType:'property',entityId:10},{returnTarget:{entityType:'lead',entityId:1}});
      const before=nav.readEntityNavigationSnapshot();
      runtime.invalidateTenantRuntimeScope();
      const scope={userId,organizationId};
      runtime.installTenantRuntimeScope(scope,userId);
      store.activateStorageForTenant(scope);
      const after=nav.readEntityNavigationSnapshot();
      return {
        before,
        after,
        currentOrg:store.state.crm.organization.id,
        tenantAOrg:JSON.parse(localStorage.getItem(tenantAKey)||'{}').organization?.id,
        tenantBOrg:JSON.parse(localStorage.getItem(tenantBKey)||'{}').organization?.id,
      };
    },{userId:USER_A,organizationId:ORG_B,tenantAKey:keysA.crmKey,tenantBKey:switchNs.crmKey});
    assert.ok(switchResult.before.target && switchResult.before.returnTarget);
    assert.deepEqual(switchResult.after,{target:null,returnTarget:null});
    assert.equal(switchResult.currentOrg,ORG_B);
    assert.equal(switchResult.tenantAOrg,ORG_A);
    assert.equal(switchResult.tenantBOrg,ORG_B);
    console.log('TENANT_SWITCH_RESET=GREEN');
    await page.close();
    await desktop.close();

    // Tenant B / Corredor / mobile 390x844: role isolation, agenda isolation, mobile close access.
    const crmB=tenantB();
    const mobile=await browser.newContext({viewport:{width:390,height:844},locale:'es-AR',timezoneId:'America/Argentina/Cordoba'});
    await installContext(mobile,crmB,USER_B,2);
    const mpage=await mobile.newPage();
    await openApp(mpage,baseUrl);
    assert.equal(await mpage.locator('.mvp-lead-card[data-client-id="23"]').count(),0);
    assert.doesNotMatch(await mpage.locator('#crm').textContent()||'',/Lead Programado A|Lead Oculto Tenant B/);
    await openLeadDetails(mpage,21);
    for(const stage of ['Ganado','Perdido']) {
      const button=mpage.locator(`.mvp-lead-card[data-client-id="21"] [data-close-operation-stage="${stage}"]`);
      await button.waitFor({state:'visible'});
      const rect=await button.boundingBox();
      assert.ok(rect && rect.height>=43.5 && rect.x>=-1 && rect.x+rect.width<=391,JSON.stringify(rect));
    }
    await openLeadDetails(mpage,22);
    const reopen=mpage.locator('.mvp-lead-card[data-client-id="22"] [data-reopen-operation="22"]');
    await reopen.waitFor({state:'visible'});
    const reopenRect=await reopen.boundingBox();
    assert.ok(reopenRect && reopenRect.height>=43.5 && reopenRect.x>=-1 && reopenRect.x+reopenRect.width<=391,JSON.stringify(reopenRect));
    await assertNoOverflow(mpage);

    await navigate(mpage,'agenda');
    assert.equal(await mpage.locator('[data-agenda-source="visit"]').count(),1);
    assert.equal(await mpage.locator('[data-agenda-source="offer"]').count(),1);
    assert.equal(await mpage.locator('[data-agenda-source="reservation"]').count(),1);
    assert.doesNotMatch(await mpage.locator('#agenda').textContent()||'',/Lead Oculto Tenant B|Propiedad Oculta Tenant B|Tenant A/);
    await assertNoOverflow(mpage);

    // Logout clears returnTarget.
    const beforeLogout=await mpage.evaluate(async()=>{
      const nav=await import(`${location.origin}/dist/entity-read-navigation.js`);
      nav.openEntityReadOnly({entityType:'property',entityId:210},{returnTarget:{entityType:'lead',entityId:21}});
      return nav.readEntityNavigationSnapshot();
    });
    assert.ok(beforeLogout.target && beforeLogout.returnTarget);
    await mpage.locator('[data-account-toggle]:visible').click();
    await mpage.locator('[data-account-logout]:visible').click();
    await mpage.waitForURL(/\/login/,{timeout:20000});
    const afterLogout=await mpage.evaluate(async()=>{
      const nav=await import(`${location.origin}/dist/entity-read-navigation.js`);
      return nav.readEntityNavigationSnapshot();
    });
    assert.deepEqual(afterLogout,{target:null,returnTarget:null});
    console.log('LOGOUT_RESET=GREEN');
    await mpage.close();
    await mobile.close();

    console.log('DESKTOP_SMOKE=GREEN');
    console.log('MOBILE_SMOKE=GREEN');
    console.log('PERSISTENCE_F5_SMOKE=GREEN');
  } finally {
    await browser.close();
    await stopServer(server);
  }
});
