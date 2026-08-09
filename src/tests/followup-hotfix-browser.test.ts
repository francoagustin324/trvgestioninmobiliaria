import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import test from 'node:test';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { initialData, type CrmData, type TeamMember } from '../models.js';

const FIXED_TIME = new Date('2026-08-05T23:59:30-03:00');
const AFTER_MIDNIGHT = new Date('2026-08-06T00:01:00-03:00');
const USER_ID = 'followup-owner';
const SESSION_KEY = 'propcontrol-cloud-session-v1';
const ACTIVE_MEMBER_KEY = 'propcontrol-active-team-member-v1';
const STORAGE_KEY = `trv-crm-basico:user:${USER_ID}`;
const SYNC_KEY = `${STORAGE_KEY}:sync`;
const ARTIFACT_DIR = 'artifacts/b1-3';

interface FollowUpTestWindow extends Window {
  __followUpWindowOpenCount?: number;
  __followUpOriginalSetItem?: Storage['setItem'];
  __followUpCloudMessages?: string[];
}

function owner(): TeamMember {
  return {
    id: 1,
    userId: USER_ID,
    name: 'Franco Solís',
    email: 'franco@propcontrol.test',
    phone: '5493515110069',
    role: 'Dueño',
    status: 'Activo',
    createdAt: '2026-08-01T12:00:00.000Z',
  };
}

function fixture(): CrmData {
  const crm = structuredClone(initialData);
  crm.organization = {
    id: 'followup-hotfix-org',
    name: 'TRV Gestión Inmobiliaria',
    seatLimit: null,
    planLabel: 'Hotfix',
  };
  crm.teamMembers = [owner()];
  crm.activityLog = [];
  crm.clients = [{
    id: 1,
    name: 'Lucía Martín',
    phone: '+54 9 351 511-0069',
    email: 'lucia@ejemplo.com',
    interest: 'Dúplex en Docta',
    status: 'Lead',
    temperature: 'Tibio',
    pipeline: 'Contactado',
    nextFollowUp: '2026-08-19',
    nextAction: 'Confirmar disponibilidad anterior',
    assignedToId: 1,
    createdById: 1,
  }];
  crm.reminders = [];
  crm.conversations = [];
  crm.settings = {
    ...crm.settings,
    profileName: owner().name,
    profileEmail: owner().email,
    agencyName: 'TRV Gestión Inmobiliaria',
  };
  return crm;
}

function chromeExecutable(): string | undefined {
  return [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].find(existsSync);
}

async function waitForServer(url: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      if ((await fetch(`${url}/health`)).ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Servidor del hotfix no disponible: ${String(lastError ?? 'sin respuesta')}`);
}

async function startServer(port: number): Promise<ChildProcess> {
  const server = spawn(process.execPath, ['dist/server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      SUPABASE_URL: '',
      SUPABASE_PUBLISHABLE_KEY: '',
      SUPABASE_SECRET_KEY: '',
      SUPABASE_SERVICE_ROLE_KEY: '',
      LEAD_QUALIFICATION_AI_ENDPOINT: '',
      LEAD_QUALIFICATION_AI_KEY: '',
      LEAD_QUALIFICATION_AI_MODEL: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForServer(`http://127.0.0.1:${port}`);
  return server;
}

async function stopServer(server: ChildProcess): Promise<void> {
  if (server.exitCode !== null) return;
  server.kill('SIGTERM');
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (server.exitCode === null) server.kill('SIGKILL');
      resolve();
    }, 2_000);
    server.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function browserContext(browser: Browser): Promise<BrowserContext> {
  const crm = fixture();
  const actorKey = `cloud:${USER_ID}`;
  const identityKey = `propcontrol-whatsapp-human-identity-v1:${encodeURIComponent(crm.organization.id)}:1:${encodeURIComponent(actorKey)}`;
  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Cordoba',
    colorScheme: 'dark',
  });
  await context.addInitScript(({ data, sessionKey, storageKey, syncKey, activeMemberKey, identityStorageKey }) => {
    const target = window as FollowUpTestWindow;
    target.__followUpCloudMessages = [];
    target.__followUpWindowOpenCount = 0;
    localStorage.setItem(sessionKey, JSON.stringify({
      accessToken: 'followup-access',
      refreshToken: 'followup-refresh',
      expiresAt: new Date('2026-08-06T05:00:00.000Z').getTime(),
      userId: 'followup-owner',
      email: 'franco@propcontrol.test',
    }));
    if (!localStorage.getItem(storageKey)) localStorage.setItem(storageKey, JSON.stringify(data));
    if (!localStorage.getItem(syncKey)) {
      localStorage.setItem(syncKey, JSON.stringify({
        dirty: false,
        localUpdatedAt: '2026-08-05T21:40:00.000Z',
        lastCloudSavedAt: '2026-08-05T21:40:00.000Z',
        lastCloudVersion: '2026-08-05T21:40:00.000Z',
      }));
    }
    localStorage.setItem(activeMemberKey, '1');
    localStorage.setItem(identityStorageKey, JSON.stringify({
      version: 1,
      organizationId: 'followup-hotfix-org',
      memberId: 1,
      actorKey: 'cloud:followup-owner',
      humanName: 'Franco Solís',
      confirmedAt: '2026-08-05T21:40:00.000Z',
    }));
    document.addEventListener('propcontrol-cloud-status', (event) => {
      const message = (event as CustomEvent<{ message?: string }>).detail?.message;
      if (message) target.__followUpCloudMessages?.push(message);
    });
    Object.defineProperty(window, 'open', {
      configurable: true,
      value: () => {
        target.__followUpWindowOpenCount = (target.__followUpWindowOpenCount || 0) + 1;
        return null;
      },
    });
  }, {
    data: crm,
    sessionKey: SESSION_KEY,
    storageKey: STORAGE_KEY,
    syncKey: SYNC_KEY,
    activeMemberKey: ACTIVE_MEMBER_KEY,
    identityStorageKey: identityKey,
  });
  return context;
}

async function load(page: Page, url: string): Promise<void> {
  await page.clock.setFixedTime(FIXED_TIME);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#crm.active', { state: 'visible', timeout: 20_000 });
  await page.waitForSelector('[data-contact-whatsapp="1"]', { state: 'visible', timeout: 20_000 });
}

async function storedCrm(page: Page): Promise<CrmData> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{}') as CrmData, STORAGE_KEY);
}

async function openFollowUp(page: Page): Promise<void> {
  await page.locator('[data-contact-whatsapp="1"]').click();
  await page.locator('[data-whatsapp-open]').click();
  await page.clock.runFor(750);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.locator('[data-whatsapp-confirm-sent]').waitFor({ state: 'visible' });
  await page.locator('[data-whatsapp-confirm-sent]').click();
  await page.locator('[data-whatsapp-change-followup]').waitFor({ state: 'visible' });
  await page.locator('[data-whatsapp-change-followup]').click();
  await page.locator('[data-zero-followup-form]').waitFor({ state: 'visible' });
}

async function selectPreset(page: Page, value: string, expectedDate: string, expectedPreview: string): Promise<void> {
  const form = page.locator('[data-zero-followup-form]');
  await form.locator(`input[name="follow-up-choice"][value="${value}"]`).check();
  await page.waitForFunction((choice) => (
    document.querySelector<HTMLFormElement>('[data-zero-followup-form]')?.dataset.followupSelectedChoice === choice
  ), value);
  const selection = await form.evaluate((current) => {
    const selectedDate = current.querySelector<HTMLInputElement>('input[name="selected-date"]')?.value || '';
    const preview = current.querySelector<HTMLElement>('[data-zero-followup-preview]')?.textContent || '';
    return {
      choice: current.dataset.followupSelectedChoice || '',
      canonicalDate: current.dataset.followupSelectedDate || '',
      selectedDate,
      preview,
    };
  });
  assert.deepEqual(selection, {
    choice: value,
    canonicalDate: expectedDate,
    selectedDate: expectedDate,
    preview: expectedPreview,
  });
}

async function waitForDone(page: Page): Promise<void> {
  await page.locator('[data-whatsapp-change-followup]').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#propcontrol-whatsapp-contact').isHidden(), false);
  assert.match(await page.locator('#whatsapp-contact-title').innerText(), /Listo\. Próximo contacto:/);
}

async function openAgenda(page: Page): Promise<void> {
  await page.locator('[data-module="agenda"]:visible').first().click();
  await page.waitForSelector('#agenda.active', { state: 'visible' });
}

test('hotfix congela la fecha al cruzar medianoche, evita duplicados y conserva el modal ante error real', { timeout: 240_000 }, async () => {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const executablePath = chromeExecutable();
  assert.ok(executablePath, 'Chrome/Chromium no disponible para probar el hotfix.');
  const port = 61350 + Math.floor(Math.random() * 100);
  const url = `http://127.0.0.1:${port}`;
  const server = await startServer(port);
  const browser = await chromium.launch({ executablePath, headless: true });
  const context = await browserContext(browser);

  try {
    const page = await context.newPage();
    await load(page, url);
    await openFollowUp(page);
    assert.equal(await page.locator('input[name="custom-date"]').inputValue(), '2026-08-19');
    await selectPreset(
      page,
      '1',
      '2026-08-06',
      'Se programará para: jueves, 6 de agosto de 2026',
    );
    await page.screenshot({ path: `${ARTIFACT_DIR}/07-hotfix-manana-seleccion.png`, fullPage: true });

    const form = page.locator('[data-zero-followup-form]');
    assert.equal(await form.getAttribute('data-followup-selected-choice'), '1');
    assert.equal(await form.getAttribute('data-followup-selected-date'), '2026-08-06');
    assert.equal(await page.locator('#propcontrol-whatsapp-contact').isHidden(), false);
    await page.clock.setFixedTime(AFTER_MIDNIGHT);
    assert.equal(await form.getAttribute('data-followup-selected-date'), '2026-08-06');
    assert.equal(await form.locator('input[name="selected-date"]').inputValue(), '2026-08-06');
    assert.equal(
      await form.locator('[data-zero-followup-preview]').textContent(),
      'Se programará para: jueves, 6 de agosto de 2026',
    );

    await form.evaluate((current) => {
      const followUp = current as HTMLFormElement;
      followUp.requestSubmit();
      followUp.requestSubmit();
    });
    await waitForDone(page);
    assert.equal(await page.locator('#whatsapp-contact-title').innerText(), 'Listo. Próximo contacto: Mañana');
    const tomorrow = await storedCrm(page);
    assert.equal(tomorrow.clients[0]?.nextFollowUp, '2026-08-06');
    assert.notEqual(tomorrow.clients[0]?.nextFollowUp, '2026-08-07');
    assert.equal(tomorrow.clients[0]?.nextAction, 'Volver a contactar por WhatsApp');
    assert.equal(tomorrow.reminders.length, 0, 'Agenda no debe crear un Reminder paralelo.');
    assert.equal(tomorrow.activityLog.filter((entry) => entry.action === 'Seguimiento por WhatsApp programado').length, 1);
    assert.equal(await page.evaluate(() => (window as FollowUpTestWindow).__followUpWindowOpenCount), 1);
    await page.screenshot({ path: `${ARTIFACT_DIR}/08-hotfix-manana-confirmado.png`, fullPage: true });

    await openAgenda(page);
    assert.equal(await page.locator('#agenda.active .agenda-card').filter({ hasText: 'Lucía Martín' }).count(), 1);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#crm.active', { state: 'visible' });
    await page.waitForSelector('[data-contact-whatsapp="1"]', { state: 'visible' });
    assert.equal((await storedCrm(page)).clients[0]?.nextFollowUp, '2026-08-06');

    const reopened = await context.newPage();
    await load(reopened, url);
    assert.equal((await storedCrm(reopened)).clients[0]?.nextFollowUp, '2026-08-06');
    await openFollowUp(reopened);
    await selectPreset(
      reopened,
      '7',
      '2026-08-12',
      'Se programará para: miércoles, 12 de agosto de 2026',
    );
    await reopened.locator('[data-zero-followup-form] button[type="submit"]').click();
    await waitForDone(reopened);
    const sevenDays = await storedCrm(reopened);
    assert.equal(sevenDays.clients[0]?.nextFollowUp, '2026-08-12');
    assert.equal(sevenDays.reminders.length, 0);
    assert.equal(await reopened.evaluate(() => (window as FollowUpTestWindow).__followUpWindowOpenCount), 1);
    await openAgenda(reopened);
    const sevenDaysAgenda = reopened.locator('#agenda.active .agenda-card').filter({ hasText: 'Lucía Martín' });
    assert.equal(await sevenDaysAgenda.count(), 1);
    assert.equal(await sevenDaysAgenda.locator('time[datetime="2026-08-12"]').count(), 1);
    await reopened.screenshot({ path: `${ARTIFACT_DIR}/09-hotfix-siete-dias-persistido.png`, fullPage: true });

    await reopened.locator('[data-module="crm"]:visible').first().click();
    await reopened.waitForSelector('#crm.active', { state: 'visible' });
    await openFollowUp(reopened);
    await selectPreset(
      reopened,
      '3',
      '2026-08-08',
      'Se programará para: sábado, 8 de agosto de 2026',
    );

    const beforeInconsistency = (await storedCrm(reopened)).clients[0]?.nextFollowUp;
    await reopened.locator('[data-zero-followup-form] input[name="selected-date"]').evaluate((input: HTMLInputElement) => {
      input.value = '2026-08-09';
    });
    await reopened.locator('[data-zero-followup-form] button[type="submit"]').click();
    const inconsistencyError = reopened.locator('[data-followup-save-error]');
    await inconsistencyError.waitFor({ state: 'visible' });
    assert.match(await inconsistencyError.textContent() || '', /inconsistente/i);
    assert.equal(await reopened.locator('#propcontrol-whatsapp-contact').isHidden(), false);
    assert.equal((await storedCrm(reopened)).clients[0]?.nextFollowUp, beforeInconsistency);

    await selectPreset(
      reopened,
      '7',
      '2026-08-12',
      'Se programará para: miércoles, 12 de agosto de 2026',
    );
    await selectPreset(
      reopened,
      '3',
      '2026-08-08',
      'Se programará para: sábado, 8 de agosto de 2026',
    );
    const beforePersistenceFailure = (await storedCrm(reopened)).clients[0]?.nextFollowUp;
    await reopened.evaluate((storageKey) => {
      const target = window as FollowUpTestWindow;
      target.__followUpOriginalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function setItem(key: string, value: string): void {
        if (key === storageKey) throw new Error('Falla local simulada');
        target.__followUpOriginalSetItem!.call(this, key, value);
      };
    }, STORAGE_KEY);
    await reopened.locator('[data-zero-followup-form] button[type="submit"]').click();
    const error = reopened.locator('[data-followup-save-error]');
    await error.waitFor({ state: 'visible' });
    assert.match(await error.textContent() || '', /Falla local simulada/i);
    assert.equal(await reopened.locator('[data-zero-followup-form]').getAttribute('data-followup-selected-date'), '2026-08-08');
    assert.equal(await reopened.locator('#propcontrol-whatsapp-contact').isHidden(), false);
    assert.equal((await storedCrm(reopened)).clients[0]?.nextFollowUp, beforePersistenceFailure);
    await reopened.screenshot({ path: `${ARTIFACT_DIR}/10-hotfix-error-persistencia.png`, fullPage: true });

    await reopened.evaluate(() => {
      const target = window as FollowUpTestWindow;
      if (target.__followUpOriginalSetItem) Storage.prototype.setItem = target.__followUpOriginalSetItem;
    });
    await reopened.locator('[data-zero-followup-form] button[type="submit"]').click();
    await waitForDone(reopened);
    const recovered = await storedCrm(reopened);
    assert.equal(recovered.clients[0]?.nextFollowUp, '2026-08-08');
    assert.equal(recovered.clients[0]?.nextAction, 'Volver a contactar por WhatsApp');
    assert.equal(recovered.reminders.length, 0);
    assert.equal(await reopened.evaluate(() => (window as FollowUpTestWindow).__followUpWindowOpenCount), 2);
    const recoveredAgenda = reopened.locator('#agenda .agenda-card').filter({ hasText: 'Lucía Martín' });
    assert.equal(await recoveredAgenda.count(), 1);
    assert.equal(await recoveredAgenda.locator('time[datetime="2026-08-08"]').count(), 1);

    await reopened.locator('[data-whatsapp-change-followup]').click();
    const noneForm = reopened.locator('[data-zero-followup-form]');
    await noneForm.locator('input[name="follow-up-choice"][value="none"]').check();
    assert.equal(await noneForm.getAttribute('data-followup-selected-choice'), 'none');
    assert.equal(await noneForm.getAttribute('data-followup-selected-date'), '');
    assert.equal(await noneForm.locator('input[name="selected-date"]').inputValue(), '');
    assert.equal(await noneForm.locator('[data-zero-followup-preview]').textContent(), 'No se programará un próximo seguimiento.');
    const beforeNoneFailure = await storedCrm(reopened);

    await reopened.evaluate((storageKey) => {
      const target = window as FollowUpTestWindow;
      target.__followUpOriginalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function setItem(key: string, value: string): void {
        if (key === storageKey) throw new Error('Falla none simulada');
        target.__followUpOriginalSetItem!.call(this, key, value);
      };
    }, STORAGE_KEY);
    await noneForm.locator('button[type="submit"]').click();
    const noneError = noneForm.locator('[data-followup-save-error]');
    await noneError.waitFor({ state: 'visible' });
    assert.match(await noneError.textContent() || '', /Falla none simulada/i);
    const afterNoneFailure = await storedCrm(reopened);
    assert.equal(afterNoneFailure.clients[0]?.nextFollowUp, beforeNoneFailure.clients[0]?.nextFollowUp);
    assert.equal(afterNoneFailure.clients[0]?.nextAction, beforeNoneFailure.clients[0]?.nextAction);
    assert.equal(afterNoneFailure.activityLog.length, beforeNoneFailure.activityLog.length);
    assert.equal(await reopened.locator('#propcontrol-whatsapp-contact').isHidden(), false);
    assert.equal(await noneForm.getAttribute('data-followup-selected-choice'), 'none');
    assert.equal(await noneForm.getAttribute('data-followup-selected-date'), '');

    await reopened.evaluate(() => {
      const target = window as FollowUpTestWindow;
      if (target.__followUpOriginalSetItem) Storage.prototype.setItem = target.__followUpOriginalSetItem;
    });
    await noneForm.locator('button[type="submit"]').click();
    await reopened.getByText('Contacto registrado', { exact: true }).waitFor({ state: 'visible' });
    const cleared = await storedCrm(reopened);
    assert.equal(cleared.clients[0]?.nextFollowUp, undefined);
    assert.equal(cleared.clients[0]?.nextAction, undefined);
    assert.equal(cleared.reminders.length, 0);
    assert.equal(cleared.activityLog.length, beforeNoneFailure.activityLog.length, 'none no agrega actividad al guardar.');
    await openAgenda(reopened);
    assert.equal(await reopened.locator('#agenda.active .agenda-card').filter({ hasText: 'Lucía Martín' }).count(), 0);

    await reopened.close();
  } finally {
    await context.close();
    await browser.close();
    await stopServer(server);
  }
});
