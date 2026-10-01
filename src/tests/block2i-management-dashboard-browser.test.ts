import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { webkit } from 'playwright';
import type { ManagementMetrics } from '../management-metrics.js';
import type { TeamMember } from '../models.js';

test('Block 2I browser/responsive: Gestión existe en app real y no genera scroll horizontal en 1366 ni 390', async () => {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      get length() { return storage.size; },
      clear() { storage.clear(); },
      getItem(key: string) { return storage.get(key) ?? null; },
      key(index: number) { return [...storage.keys()][index] ?? null; },
      removeItem(key: string) { storage.delete(key); },
      setItem(key: string, value: string) { storage.set(key, String(value)); },
    } satisfies Storage,
  });
  const { managementDashboardMarkup } = await import('../management-dashboard-ui.js');
  const main=readFileSync('src/mvp-main.ts','utf8');
  const models=readFileSync('src/models.ts','utf8');
  const css=readFileSync('src/management-dashboard.css','utf8');
  assert.match(main,/renderManagementDashboard\(qs<HTMLElement>\('#reportes'\)\)/);
  assert.match(main,/id="reportes"/);
  assert.match(models,/\['reportes', 'Gestión'\]/);

  const members: TeamMember[]=[
    {id:1,userId:'u1',name:'Dueño',email:'d@example.com',role:'Dueño',status:'Activo',createdAt:'2026-01-01T00:00:00Z'},
    {id:2,userId:'u2',name:'Ana',email:'a@example.com',role:'Corredor',status:'Activo',createdAt:'2026-01-01T00:00:00Z'},
  ];
  const metrics: ManagementMetrics={
    organizationId:'org',period:{key:'last30',label:'Últimos 30 días',fromDate:'2026-09-02',toDate:'2026-10-01'},brokerId:null,
    scorecard:{leadsReceived:120,leadsAttended:100,firstResponseMedianMinutes:18,firstResponseSample:100,visitsScheduled:30,visitsCompleted:25,offers:12,reservations:5,closures:3,conversionPct:2.5,commissions:{USD:9000,ARS:250000}},
    funnel:[
      {key:'leads',label:'Leads',count:120,conversionFromPreviousPct:null},
      {key:'visits',label:'Visitas',count:25,conversionFromPreviousPct:20.83},
      {key:'offers',label:'Ofertas',count:12,conversionFromPreviousPct:48},
      {key:'reservations',label:'Reservas',count:5,conversionFromPreviousPct:41.67},
      {key:'closures',label:'Cierres',count:3,conversionFromPreviousPct:60},
    ],
    team:[{memberId:1,name:'Dueño',leads:70,attended:60,firstResponseMedianMinutes:15,visits:15,offers:8,reservations:3,closures:2,conversionPct:2.86},{memberId:2,name:'Ana',leads:50,attended:40,firstResponseMedianMinutes:22,visits:10,offers:4,reservations:2,closures:1,conversionPct:2}],
    sources:[{source:'Meta Ads',leads:70,visits:15,offers:8,reservations:3,closures:2,conversionPct:2.86},{source:'Zonaprop',leads:50,visits:10,offers:4,reservations:2,closures:1,conversionPct:2}],
    pipeline:[{stage:'Nuevo',count:20},{stage:'Contactado',count:30},{stage:'Calificado',count:25},{stage:'Visita coordinada',count:15},{stage:'Negociación',count:10},{stage:'Reservado',count:5},{stage:'Ganado',count:3},{stage:'Perdido',count:12}],
    propertyReviews:[{propertyId:1,label:'Departamento General Paz',reasons:['Sin visitas registradas','Lleva 45 días sin actividad comercial'],daysWithoutActivity:45}],
    dataQuality:{firstResponseComplete:false,firstResponseNote:'Primera respuesta calculada con 100 de 120 leads: faltan timestamps históricos confiables.'},
  };

  const browser=await webkit.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1366,height:768}});
    await page.setContent(`<style>${css}</style><main style="width:100%;box-sizing:border-box">${managementDashboardMarkup(metrics,members)}</main>`);
    assert.equal(await page.locator('[data-management-dashboard]').count(),1);
    assert.ok((await page.getByText('Gestión',{exact:true}).count())>=1);
    const desktopOverflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
    assert.ok(desktopOverflow<=1,`desktop overflow ${desktopOverflow}px`);
    await page.setViewportSize({width:390,height:844});
    const mobileOverflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
    assert.ok(mobileOverflow<=1,`mobile overflow ${mobileOverflow}px`);
    const buttons=page.locator('[data-management-period]');
    for(let i=0;i<await buttons.count();i+=1){
      const box=await buttons.nth(i).boundingBox();
      assert.ok(box && box.height>=44,`target ${i} mide ${box?.height}px`);
    }
    assert.equal(await page.locator('.mg-table thead').first().evaluate((el)=>getComputedStyle(el).display),'none');
  } finally {
    await browser.close();
  }
});
