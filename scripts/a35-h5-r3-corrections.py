from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one correction, found {count}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1))

replace_once(
    'src/tests/a35-h5-r1-modern-tenant-harness.ts',
    '      user_id: member.userId,\n',
    '      user_id: member.userId!,\n',
)
replace_once(
    'src/tests/a35-h5-r1-modern-tenant-harness.ts',
    '      email: member.email || null,\n      phone: member.phone || null,\n',
    '      email: member.email || undefined,\n      phone: member.phone || undefined,\n',
)

replace_once(
    'src/tests/b1-2-8-account-menu-responsive-real-app.test.ts',
    "    localStorage.setItem(keys.backup, JSON.stringify([{\n      createdAt: '2026-07-29T13:00:00-03:00',\n      reason: 'Copia anterior de prueba',\n      crm: backup,\n    }]));\n",
    "",
)
replace_once(
    'src/tests/b1-2-8-account-menu-responsive-real-app.test.ts',
    "async function loadApplication(page: Page, url: string): Promise<void> {\n",
    "async function seedRecoveryBackup(page: Page, role: TeamRole): Promise<void> {\n  const identity = fixtureIdentity(role);\n  await page.evaluate(({ backupKey, backup }) => {\n    localStorage.setItem(backupKey, JSON.stringify([{\n      createdAt: '2026-07-29T13:00:00-03:00',\n      reason: 'Copia anterior de prueba',\n      crm: backup,\n    }]));\n  }, { backupKey: identity.backupKey, backup: backupFixture(role) });\n}\n\nasync function loadApplication(page: Page, url: string): Promise<void> {\n",
)
replace_once(
    'src/tests/b1-2-8-account-menu-responsive-real-app.test.ts',
    "        const page = await ownerContext.newPage();\n        await loadApplication(page, url);\n        await assertSavedMenu(page);\n",
    "        const page = await ownerContext.newPage();\n        await loadApplication(page, url);\n        await seedRecoveryBackup(page, 'Dueño');\n        await assertSavedMenu(page);\n",
)
replace_once(
    'src/tests/b1-2-8-account-menu-responsive-real-app.test.ts',
    "        const page = await adminContext.newPage();\n        await loadApplication(page, url);\n        assert.equal(await page.locator('[data-settings-security-recovery]').count(), 1);\n",
    "        const page = await adminContext.newPage();\n        await loadApplication(page, url);\n        await seedRecoveryBackup(page, 'Administrador');\n        await page.evaluate(() => document.dispatchEvent(new CustomEvent('trv-render')));\n        assert.equal(await page.locator('[data-settings-security-recovery]').count(), 1);\n",
)
replace_once(
    'src/tests/b1-2-8-account-menu-responsive-real-app.test.ts',
    "        const page = await corredorContext.newPage();\n        await loadApplication(page, url);\n        assert.equal(await page.locator('[data-settings-security-recovery]').count(), 0);\n",
    "        const page = await corredorContext.newPage();\n        await loadApplication(page, url);\n        await seedRecoveryBackup(page, 'Corredor');\n        await page.evaluate(() => document.dispatchEvent(new CustomEvent('trv-render')));\n        assert.equal(await page.locator('[data-settings-security-recovery]').count(), 0);\n",
)
replace_once(
    'src/tests/b1-2-8-account-menu-responsive-real-app.test.ts',
    "  await page.reload({ waitUntil: 'domcontentloaded' });\n  await page.waitForSelector('[data-account-toggle]', { state: 'visible', timeout: 20_000 });\n}\n\nasync function restoreOwnerFixture",
    "  await page.reload({ waitUntil: 'domcontentloaded' });\n  await page.waitForSelector('[data-account-toggle]', { state: 'visible', timeout: 20_000 });\n  await setSyncState(page, savedSyncState());\n}\n\nasync function restoreOwnerFixture",
)

replace_once(
    'src/tests/b1-2-9-multiuser-permissions-real-app.test.ts',
    "      localStorage.setItem(keys.backup, JSON.stringify([{\n        createdAt: '2026-07-29T20:00:00-03:00',\n        reason: 'Copia anterior B1.2.9',\n        crm: backup,\n      }]));\n",
    "",
)
replace_once(
    'src/tests/b1-2-9-multiuser-permissions-real-app.test.ts',
    "async function loadApplication(page: Page, url: string): Promise<void> {\n",
    "async function seedRecoveryBackup(page: Page, role: TeamRole): Promise<void> {\n  const identity = fixtureIdentity(role);\n  await page.evaluate(({ backupKey, backup }) => {\n    localStorage.setItem(backupKey, JSON.stringify([{\n      createdAt: '2026-07-29T20:00:00-03:00',\n      reason: 'Copia anterior B1.2.9',\n      crm: backup,\n    }]));\n  }, { backupKey: identity.backupKey, backup: backupFixture(role) });\n  await page.evaluate(() => document.dispatchEvent(new CustomEvent('trv-render')));\n}\n\nasync function loadApplication(page: Page, url: string): Promise<void> {\n",
)
replace_once(
    'src/tests/b1-2-9-multiuser-permissions-real-app.test.ts',
    "            const page = await context.newPage();\n            await loadApplication(page, url);\n            await assertRecoveryAccess(page, role);\n",
    "            const page = await context.newPage();\n            await loadApplication(page, url);\n            await seedRecoveryBackup(page, role);\n            await assertRecoveryAccess(page, role);\n",
)
replace_once(
    'src/tests/b1-2-9-multiuser-permissions-real-app.test.ts',
    "      const result = await page.evaluate(async ({ dataKey, backupKey }) => {\n",
    "      const result = await page.evaluate(async ({ dataKey, backupKey, actorUserId }) => {\n",
)
replace_once(
    'src/tests/b1-2-9-multiuser-permissions-real-app.test.ts',
    "        const store = await import('/dist/store.js');\n        const access = await import('/dist/team-access.js');\n        const actor = store.authenticatedTenantMember();\n        const visual = access.activeMember();\n",
    "        const store = await import('/dist/store.js');\n        const actor = store.state.crm.teamMembers.find((member) => member.userId === actorUserId && member.status === 'Activo') ?? null;\n        const visual = store.state.crm.teamMembers.find((member) => member.id === store.state.activeMemberId) ?? null;\n",
)
replace_once(
    'src/tests/b1-2-9-multiuser-permissions-real-app.test.ts',
    "          visual: { id: visual.id, userId: visual.userId, role: visual.role },\n",
    "          visual: visual ? { id: visual.id, userId: visual.userId, role: visual.role } : null,\n",
)
replace_once(
    'src/tests/b1-2-9-multiuser-permissions-real-app.test.ts',
    "      }, { dataKey: identity.storageKey, backupKey: identity.backupKey });\n",
    "      }, { dataKey: identity.storageKey, backupKey: identity.backupKey, actorUserId: identity.userId });\n",
)
replace_once(
    'src/tests/b1-2-9-multiuser-permissions-real-app.test.ts',
    "      await loadApplication(page, url);\n      const identity = fixtureIdentity('Corredor');\n\n      const result = await page.evaluate",
    "      await loadApplication(page, url);\n      await seedRecoveryBackup(page, 'Corredor');\n      const identity = fixtureIdentity('Corredor');\n\n      const result = await page.evaluate",
)

replace_once(
    'src/tests/b1-3-3-audit-blockers-real-app.test.ts',
    "      const store = await import('/dist/store.js');\n      const access = await import('/dist/team-access.js');\n      store.setActiveMemberId(2);\n      document.dispatchEvent(new CustomEvent('trv-render'));\n      const actor = store.authenticatedTenantMember();\n      const visual = access.activeMember();\n",
    "      const store = await import('/dist/store.js');\n      store.setActiveMemberId(2);\n      document.dispatchEvent(new CustomEvent('trv-render'));\n      const actor = store.state.crm.teamMembers.find((member) => member.userId === 'b133-audit-owner' && member.status === 'Activo') ?? null;\n      const visual = store.state.crm.teamMembers.find((member) => member.id === store.state.activeMemberId) ?? null;\n",
)
replace_once(
    'src/tests/b1-3-3-audit-blockers-real-app.test.ts',
    "        visual: { id: visual.id, userId: visual.userId, role: visual.role },\n",
    "        visual: visual ? { id: visual.id, userId: visual.userId, role: visual.role } : null,\n",
)

replace_once(
    'src/tests/b1-2-3-compact-leads-real-app.test.ts',
    "  await panel.locator('[data-analyze-qualification]').click();\n  await panel.locator('[data-apply-qualification]').waitFor({ state: 'visible' });\n  await panel.locator('.qualification-info').waitFor({ state: 'visible' });\n",
    "  const preRerenderTarget = await panel.locator('[data-suggestion-value]:not([disabled]), [data-qualification-text]').last().elementHandle();\n  assert.ok(preRerenderTarget, 'No se encontró el control previo al rerender de Qualification.');\n  await panel.locator('[data-analyze-qualification]').click();\n  await panel.locator('[data-apply-qualification]').waitFor({ state: 'visible' });\n  await panel.locator('.qualification-info').waitFor({ state: 'visible' });\n  await page.waitForFunction((element) => !element.isConnected, preRerenderTarget);\n",
)
replace_once(
    'src/tests/b1-2-3-compact-leads-real-app.test.ts',
    "  const controls = [\n    panel.locator('[data-close-qualification]'),\n    panel.locator('[data-copy-next-question]'),\n    panel.locator('[data-apply-qualification]'),\n  ];\n  for (const control of controls) {\n    if (await control.count()) {\n      await control.scrollIntoViewIfNeeded();\n      const box = await control.boundingBox();\n      assert.ok(box && box.width >= 43.5 && box.height >= 43.5, `Control del panel menor a 44px en ${width}px.`);\n    }\n  }\n",
    "  const controlMetrics = await page.evaluate(() => {\n    const currentPanel = document.querySelector<HTMLElement>('#crm .lead-qualification-panel');\n    if (!currentPanel || !currentPanel.querySelector('.qualification-info')) {\n      throw new Error('El rerender final de Qualification no está presente para medir controles.');\n    }\n    return [\n      ['close', '[data-close-qualification]'],\n      ['copy-next-question', '[data-copy-next-question]'],\n      ['apply', '[data-apply-qualification]'],\n    ].flatMap(([name, selector]) => {\n      const element = currentPanel.querySelector<HTMLElement>(selector!);\n      if (!element) return [];\n      element.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });\n      const rect = element.getBoundingClientRect();\n      return [{ name, width: rect.width, height: rect.height, connected: element.isConnected }];\n    });\n  });\n  for (const metric of controlMetrics) {\n    assert.ok(metric.connected && metric.width >= 43.5 && metric.height >= 43.5, `Control ${metric.name} del panel menor a 44px en ${width}px: ${JSON.stringify(metric)}`);\n  }\n",
)
replace_once(
    'src/tests/b1-2-3-compact-leads-real-app.test.ts',
    "  await focusTarget.focus();\n  await page.waitForFunction(() => {\n    const panel = document.querySelector<HTMLElement>('#crm .lead-qualification-panel');\n    if (!panel) return false;\n    const targets = Array.from(panel.querySelectorAll<HTMLElement>('[data-suggestion-value]:not([disabled]), [data-qualification-text]'));\n    const element = targets.at(-1);\n    if (!element || document.activeElement !== element) return false;\n    const rect = element.getBoundingClientRect();\n    const nav = document.querySelector<HTMLElement>('.mobile-bottom-nav');\n    const navVisible = nav && getComputedStyle(nav).display !== 'none';\n    const navRect = navVisible ? nav.getBoundingClientRect() : null;\n    const visibleBottom = Math.min(window.innerHeight, navRect?.top ?? window.innerHeight);\n    return rect.top >= 0 && rect.bottom <= visibleBottom - 8;\n  });\n  const geometry = await focusTarget.evaluate((element) => {\n",
    "  const geometry = await page.evaluate(async () => {\n    const currentPanel = document.querySelector<HTMLElement>('#crm .lead-qualification-panel');\n    if (!currentPanel || !currentPanel.querySelector('.qualification-info')) {\n      throw new Error('El rerender final de Qualification no está presente.');\n    }\n    const initialTargets = Array.from(currentPanel.querySelectorAll<HTMLElement>('[data-suggestion-value]:not([disabled]), [data-qualification-text]'));\n    const initialElement = initialTargets.at(-1);\n    if (!initialElement) throw new Error('No se encontró el control equivalente del rerender final.');\n    initialElement.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });\n    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));\n    const finalPanel = document.querySelector<HTMLElement>('#crm .lead-qualification-panel');\n    if (!finalPanel || !finalPanel.querySelector('.qualification-info')) {\n      throw new Error('El rerender final de Qualification dejó de estar presente tras el scroll.');\n    }\n    const finalTargets = Array.from(finalPanel.querySelectorAll<HTMLElement>('[data-suggestion-value]:not([disabled]), [data-qualification-text]'));\n    const element = finalTargets.at(-1);\n    if (!element) throw new Error('No se encontró el control final de Qualification tras el scroll.');\n    element.focus({ preventScroll: true });\n",
)
replace_once(
    'src/tests/b1-2-3-compact-leads-real-app.test.ts',
    "            const panel = page.locator('#crm .lead-qualification-panel');\n            await panel.scrollIntoViewIfNeeded();\n            await capture(page, `leads-panel-${key}.png`);\n",
    "            await page.evaluate(() => {\n              const currentPanel = document.querySelector<HTMLElement>('#crm .lead-qualification-panel');\n              if (!currentPanel) throw new Error('Panel final de Qualification no disponible para captura.');\n              currentPanel.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });\n            });\n            await capture(page, `leads-panel-${key}.png`);\n",
)

print('R3_CORRECTIONS_APPLIED=YES')