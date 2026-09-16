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

# B1.2.8: seed the scenario backup only after canonical cloud hydration has completed.
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
    "        const page = await adminContext.newPage();\n        await loadApplication(page, url);\n        await seedRecoveryBackup(page, 'Administrador');\n        document.dispatchEvent;\n        await page.evaluate(() => document.dispatchEvent(new CustomEvent('trv-render')));\n        assert.equal(await page.locator('[data-settings-security-recovery]').count(), 1);\n",
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

# B1.2.9: same post-hydration backup fixture discipline.
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

# B1.2.9 rewritten security case: use a real authenticated Corredor rather than a visual switch.
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

# B1.3.3: activeMemberId is visual only; derive observation from runtime state without unsupported browser TS imports.
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

print('R3_CORRECTIONS_APPLIED=YES')
