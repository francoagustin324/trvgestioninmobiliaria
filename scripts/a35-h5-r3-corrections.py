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
