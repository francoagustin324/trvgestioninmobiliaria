from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one replacement, found {count}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1))


def replace_tail(path: str, marker: str, replacement: str) -> None:
    p = Path(path)
    text = p.read_text()
    index = text.find(marker)
    if index < 0:
        raise SystemExit(f"{path}: tail marker missing: {marker!r}")
    if text.find(marker, index + 1) >= 0:
        raise SystemExit(f"{path}: tail marker ambiguous: {marker!r}")
    p.write_text(text[:index] + replacement)


# Shared modern cloud harness: make canonical cloud hydration preserve each fixture.
path = 'src/tests/a35-h5-r1-modern-tenant-harness.ts'
replace_once(
    path,
    "import type { BrowserContext, Route } from 'playwright';\nimport type { CrmData, TeamMember } from '../models.js';\n",
    "import type { BrowserContext, Route } from 'playwright';\nimport { crmToCloudRecords, membershipContext, type CloudMembershipRow } from '../cloud-records.js';\nimport type { CrmData, TeamMember } from '../models.js';\n",
)
replace_once(path, "function membershipRows(crm: CrmData) {\n", "function membershipRows(crm: CrmData): CloudMembershipRow[] {\n")
replace_once(
    path,
    "  const state: HarnessState = {\n    records: [],\n    recordsOutageArmed: false,\n    recordsOutageActive: false,\n  };\n",
    "  const memberships = membershipRows(crm);\n  const cloudContext = membershipContext(memberships, actorUserId);\n  const state: HarnessState = {\n    records: crmToCloudRecords(crm, cloudContext, actorUserId),\n    recordsOutageArmed: false,\n    recordsOutageActive: false,\n  };\n",
)

# Group 1/3/4 canonical tenant namespaces.
replace_once(
    'src/tests/b1-3-1-lead-create-real-app.test.ts',
    "  const storageKey = `trv-crm-basico:user:${userId}`;\n",
    "  const storageKey = `trv-crm-basico:user:${userId}:org:b131-org`;\n",
)
replace_once(
    'src/tests/b1-3-2-android-lead-save-real-app.test.ts',
    "    storageKey: `trv-crm-basico:user:${userId}`,\n    syncKey: `trv-crm-basico:user:${userId}:sync`,\n",
    "    storageKey: `trv-crm-basico:user:${userId}:org:b132-org`,\n    syncKey: `trv-crm-basico:user:${userId}:org:b132-org:sync`,\n",
)
replace_once(
    'src/tests/b1-3-3-audit-blockers-real-app.test.ts',
    "    storageKey: `trv-crm-basico:user:${userId}`,\n    syncKey: `trv-crm-basico:user:${userId}:sync`,\n",
    "    storageKey: `trv-crm-basico:user:${userId}:org:${organizationId}`,\n    syncKey: `trv-crm-basico:user:${userId}:org:${organizationId}:sync`,\n",
)
replace_once(
    'src/tests/b1-3-3-real-use-real-app.test.ts',
    "    storageKey: `trv-crm-basico:user:${userId}`,\n    syncKey: `trv-crm-basico:user:${userId}:sync`,\n",
    "    storageKey: `trv-crm-basico:user:${userId}:org:${organizationId}`,\n    syncKey: `trv-crm-basico:user:${userId}:org:${organizationId}:sync`,\n",
)
replace_once(
    'src/tests/followup-hotfix-browser.test.ts',
    "const STORAGE_KEY = `trv-crm-basico:user:${USER_ID}`;\n",
    "const STORAGE_KEY = `trv-crm-basico:user:${USER_ID}:org:followup-hotfix-org`;\n",
)

# Group 2 canonical account/recovery namespaces.
replace_once(
    'src/tests/b1-2-8-account-menu-responsive-real-app.test.ts',
    "  const storageKey = `trv-crm-basico:user:${userId}`;\n",
    "  const storageKey = `trv-crm-basico:user:${userId}:org:trv-${userId}`;\n",
)
replace_once(
    'src/tests/b1-2-9-multiuser-permissions-real-app.test.ts',
    "  const storageKey = `trv-crm-basico:user:${userId}`;\n",
    "  const storageKey = `trv-crm-basico:user:${userId}:org:b129-organization`;\n",
)

# Identity fixture mutation must be a real pending tenant-local edit so hydration cannot replace it.
replace_once(
    'src/tests/b1-2-8-account-menu-responsive-real-app.test.ts',
    "async function replaceIdentityData(page: Page): Promise<void> {\n  await page.evaluate((key) => {\n    const data = JSON.parse(localStorage.getItem(key) || '{}') as CrmData;\n    data.settings.profileName = 'Juan Ignacio Rodríguez Martínez de la Fuente';\n    data.organization.name = 'Inmobiliaria Desarrollo Patrimonial del Centro de Córdoba';\n    data.settings.agencyName = 'Inmobiliaria Desarrollo Patrimonial del Centro de Córdoba';\n    data.teamMembers[0]!.name = 'Juan Ignacio Rodríguez Martínez de la Fuente';\n    localStorage.setItem(key, JSON.stringify(data));\n  }, ownerIdentity.storageKey);\n",
    "async function replaceIdentityData(page: Page): Promise<void> {\n  await page.evaluate(({ dataKey, syncKey, sync }) => {\n    const data = JSON.parse(localStorage.getItem(dataKey) || '{}') as CrmData;\n    data.settings.profileName = 'Juan Ignacio Rodríguez Martínez de la Fuente';\n    data.organization.name = 'Inmobiliaria Desarrollo Patrimonial del Centro de Córdoba';\n    data.settings.agencyName = 'Inmobiliaria Desarrollo Patrimonial del Centro de Córdoba';\n    data.teamMembers[0]!.name = 'Juan Ignacio Rodríguez Martínez de la Fuente';\n    localStorage.setItem(dataKey, JSON.stringify(data));\n    localStorage.setItem(syncKey, JSON.stringify(sync));\n  }, { dataKey: ownerIdentity.storageKey, syncKey: ownerIdentity.syncKey, sync: pendingSyncState() });\n",
)

# Group 3.1: a DOM dataset is not authentication. Assert spoof resistance using the real Corredor actor.
replace_once(
    'src/tests/b1-3-2-android-lead-save-real-app.test.ts',
    "    await form.evaluate((node) => { node.dataset.b131Actor = '999'; });\n    await form.locator('input[name=\"nextFollowUp\"]').fill(await localToday(page));\n    await form.locator('[data-save-lead]').click();\n    await form.locator('[data-lead-status]').getByText(/no tiene autorización/i).waitFor({ state: 'visible' });\n    assert.equal((await snapshot(page, 'Corredor')).clients.length, 0);\n\n    await page.locator('[data-toggle=\"client-form\"]').click();\n    form = await openLeadForm(page);\n",
    "    await form.evaluate((node) => { node.dataset.b131Actor = '999'; });\n    await form.locator('input[name=\"nextFollowUp\"]').fill(await localToday(page));\n    await form.locator('[data-save-lead]').click();\n    await page.locator('#notice').getByText(/VALIDACIONES B1\\.3\\.2 fue creado correctamente/).waitFor({ state: 'visible' });\n    const spoofSnapshot = await snapshot(page, 'Corredor');\n    assert.equal(spoofSnapshot.clients.length, 1);\n    const spoofedLead = spoofSnapshot.clients.find((item) => item.name === 'VALIDACIONES B1.3.2');\n    assert.ok(spoofedLead);\n    assert.equal(spoofedLead.createdById, identity('Corredor').memberId, 'El dataset DOM no sustituye al actor autenticado.');\n    assert.notEqual(spoofedLead.createdById, 999);\n\n    form = await openLeadForm(page);\n",
)
replace_once(
    'src/tests/b1-3-2-android-lead-save-real-app.test.ts',
    "    assert.equal((await snapshot(page, 'Corredor')).clients.length, 0);\n    await page.evaluate(() => {\n      const target = window as unknown as B132Window;\n      if (target.__b132OriginalSetItem) Storage.prototype.setItem = target.__b132OriginalSetItem;\n    });\n",
    "    assert.equal((await snapshot(page, 'Corredor')).clients.length, 1);\n    await page.evaluate(() => {\n      const target = window as unknown as B132Window;\n      if (target.__b132OriginalSetItem) Storage.prototype.setItem = target.__b132OriginalSetItem;\n    });\n",
)
replace_once(
    'src/tests/b1-3-2-android-lead-save-real-app.test.ts',
    "    assert.equal((await snapshot(page, 'Corredor')).clients.length, 0, 'El DOM obsoleto falla cerrado.');\n",
    "    assert.equal((await snapshot(page, 'Corredor')).clients.length, 1, 'El DOM obsoleto no crea una escritura adicional.');\n",
)

# Group 3.3: activeMemberId is visual only; verify it cannot impersonate a different authenticated human identity.
path = 'src/tests/b1-3-3-audit-blockers-real-app.test.ts'
old_start = "test('B1.3.3 invalida panel antiguo al cambiar miembro activo'"
old_end = "\ntest('B1.3.3 conserva Todavía no e invalida intento pendiente tras cambiar identidad'"
p = Path(path)
text = p.read_text()
start = text.find(old_start)
end = text.find(old_end, start)
if start < 0 or end < 0:
    raise SystemExit(f'{path}: member-change block anchors missing')
new_block = '''test('B1.3.3 mantiene identidad autenticada al cambiar miembro visual', { timeout: 240_000 }, async () => {
  mkdirSync(artifactDir, { recursive: true });
  const executablePath = chromeExecutable();
  assert.ok(executablePath);
  const client = lead(305, 'Lead Cambio Miembro');
  const port = 63400 + Math.floor(Math.random() * 80);
  const url = `http://127.0.0.1:${port}`;
  const server = await startServer(port);
  const browser = await chromium.launch({ executablePath, headless: true });
  const context = await contextFor(browser, { width: 390, height: 844 }, 'member-change', fixture(client), 'Franco');
  try {
    const page = await context.newPage();
    await load(page, url);
    await installActionCounters(page);
    await page.locator(`#crm.active [data-contact-whatsapp="${client.id}"]`).click();
    assert.match(await page.locator('[data-whatsapp-message]').inputValue(), /soy Franco de TRV Gestión Inmobiliaria/i);
    await page.locator('[data-whatsapp-close]').click();

    const authority = await page.evaluate(async () => {
      const store = await import('/dist/store.js');
      const access = await import('/dist/team-access.js');
      store.setActiveMemberId(2);
      document.dispatchEvent(new CustomEvent('trv-render'));
      const actor = store.authenticatedTenantMember();
      const visual = access.activeMember();
      return {
        actor: actor ? { id: actor.id, userId: actor.userId, role: actor.role } : null,
        visual: { id: visual.id, userId: visual.userId, role: visual.role },
      };
    });
    assert.deepEqual(authority, {
      actor: { id: 1, userId: identity('Dueño').userId, role: 'Dueño' },
      visual: { id: 2, userId: identity('Administrador').userId, role: 'Administrador' },
    });

    await page.locator(`#crm.active [data-contact-whatsapp="${client.id}"]`).click();
    const message = page.locator('[data-whatsapp-message]');
    await message.waitFor({ state: 'attached' });
    assert.match(await message.inputValue(), /soy Franco de TRV Gestión Inmobiliaria/i);
    assert.equal(await page.locator('[data-whatsapp-open]').isDisabled(), false);
    assert.equal(await page.locator('[data-whatsapp-copy]').isDisabled(), false);
    await assertZeroWhatsAppEffects(page, client.id);
    await page.screenshot({ path: `${artifactDir}/16-miembro-visual-no-cambia-identidad.png`, fullPage: true });
  } finally {
    await context.close();
    await browser.close();
    await stopServer(server);
  }
});
'''
p.write_text(text[:start] + new_block + text[end:])

# Security stale case: use an actually authenticated Corredor, not an owner with a visual-member switch.
path = 'src/tests/b1-2-9-multiuser-permissions-real-app.test.ts'
marker = "test(\n  'B1.2.9 bloquea referencias DOM obsoletas y llamadas indirectas después de cambiar a Corredor',"
new_tail = '''test(
  'B1.2.9 bloquea capacidades administrativas con Corredor autenticado real',
  { timeout: 120_000 },
  async () => {
    const executablePath = chromeExecutable();
    assert.ok(executablePath, 'Chrome/Chromium no disponible para B1.2.9.');
    const port = 49900 + Math.floor(Math.random() * 300);
    const url = `http://127.0.0.1:${port}`;
    const server = await startServer(port);
    const browser = await chromium.launch({ executablePath, headless: true });
    const context = await createContext(browser, { width: 390, height: 844 }, 'Corredor');
    try {
      const page = await context.newPage();
      await loadApplication(page, url);
      const identity = fixtureIdentity('Corredor');

      const result = await page.evaluate(async ({ dataKey, backupKey }) => {
        const targetWindow = window as unknown as B129Window;
        targetWindow.__b129TeamRequests = 0;
        const nativeFetch = window.fetch.bind(window);
        window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
          const requestUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
          if (requestUrl.includes('/api/team/')) targetWindow.__b129TeamRequests = (targetWindow.__b129TeamRequests ?? 0) + 1;
          return nativeFetch(input, init);
        }) as typeof window.fetch;

        const store = await import('/dist/store.js');
        const access = await import('/dist/team-access.js');
        const actor = store.authenticatedTenantMember();
        const visual = access.activeMember();
        store.state.activeModule = 'equipo';
        document.dispatchEvent(new CustomEvent('trv-render'));
        const directRestore = store.restoreLatestLocalBackup();
        document.dispatchEvent(new CustomEvent('trv-render'));

        return {
          actor: actor ? { id: actor.id, userId: actor.userId, role: actor.role } : null,
          visual: { id: visual.id, userId: visual.userId, role: visual.role },
          directRestore,
          activeModule: store.state.activeModule,
          teamRequests: targetWindow.__b129TeamRequests,
          zone: (JSON.parse(localStorage.getItem(dataKey) || '{}') as CrmData).settings.defaultZone,
          backups: (JSON.parse(localStorage.getItem(backupKey) || '[]') as unknown[]).length,
          recoveryControls: document.querySelectorAll('[data-settings-security-recovery], [data-account-restore]').length,
          teamControls: document.querySelectorAll('#mvp-user-form, [data-toggle-user-form]').length,
          settingsHtml: document.querySelector('#configuracion')?.innerHTML.trim() || '',
          teamHtml: document.querySelector('#equipo')?.innerHTML.trim() || '',
        };
      }, { dataKey: identity.storageKey, backupKey: identity.backupKey });

      assert.deepEqual(result, {
        actor: { id: 3, userId: identity.userId, role: 'Corredor' },
        visual: { id: 3, userId: identity.userId, role: 'Corredor' },
        directRestore: false,
        activeModule: 'crm',
        teamRequests: 0,
        zone: 'Datos actuales B1.2.9',
        backups: 1,
        recoveryControls: 0,
        teamControls: 0,
        settingsHtml: '',
        teamHtml: '',
      });
    } finally {
      await context.close();
      await browser.close();
      await stopServer(server);
    }
  },
);
'''
replace_tail(path, marker, new_tail)

# Group 5: synchronize with the final optional-analysis rerender and keep real focus/visibility assertions.
replace_once(
    'src/tests/b1-2-3-compact-leads-real-app.test.ts',
    "  await panel.locator('[data-analyze-qualification]').click();\n  await panel.locator('[data-apply-qualification]').waitFor({ state: 'visible' });\n",
    "  await panel.locator('[data-analyze-qualification]').click();\n  await panel.locator('[data-apply-qualification]').waitFor({ state: 'visible' });\n  await panel.locator('.qualification-info').waitFor({ state: 'visible' });\n",
)
replace_once(
    'src/tests/b1-2-3-compact-leads-real-app.test.ts',
    "  await focusTarget.focus();\n  await page.waitForTimeout(550);\n  const geometry = await focusTarget.evaluate((element) => {\n",
    "  await focusTarget.focus();\n  await page.waitForFunction(() => {\n    const panel = document.querySelector<HTMLElement>('#crm .lead-qualification-panel');\n    if (!panel) return false;\n    const targets = Array.from(panel.querySelectorAll<HTMLElement>('[data-suggestion-value]:not([disabled]), [data-qualification-text]'));\n    const element = targets.at(-1);\n    if (!element || document.activeElement !== element) return false;\n    const rect = element.getBoundingClientRect();\n    const nav = document.querySelector<HTMLElement>('.mobile-bottom-nav');\n    const navVisible = nav && getComputedStyle(nav).display !== 'none';\n    const navRect = navVisible ? nav.getBoundingClientRect() : null;\n    const visibleBottom = Math.min(window.innerHeight, navRect?.top ?? window.innerHeight);\n    return rect.top >= 0 && rect.bottom <= visibleBottom - 8;\n  });\n  const geometry = await focusTarget.evaluate((element) => {\n",
)

print('R3_PATCH_APPLIED=YES')
print('R3_PRODUCT_FILES_CHANGED=0')
