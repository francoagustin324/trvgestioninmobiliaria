from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly 1 anchor, found {count}")
    return text.replace(old, new, 1)


def align_desktop() -> None:
    path = Path("src/tests/leads-desktop-zero-training.test.ts")
    text = path.read_text()

    text = replace_once(
        text,
        "const ORG_ID = 'desktop-zero-training-org';\nconst STORAGE_KEY = `trv-crm-basico:user:${USER_ID}`;",
        "const ORG_ID = 'desktop-zero-training-org';\nconst GENERATION = 'desktop-zero-training-generation-a34-1';\nconst STORAGE_KEY = `trv-crm-basico:user:${USER_ID}`;",
        "desktop generation",
    )

    authority = r'''
function syntheticMembership() {
  return {
    organization_id: ORG_ID,
    member_id: 1,
    user_id: USER_ID,
    role: 'owner',
    status: 'active',
    display_name: owner().name,
    email: owner().email,
    phone: owner().phone,
    created_at: '2026-08-11T12:00:00.000Z',
    last_active_at: '2026-09-13T18:00:00.000Z',
  };
}

function syntheticJson(body: unknown, status = 200) {
  return {
    status,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(body),
  };
}

async function installSyntheticAuthority(context: BrowserContext, origin: string): Promise<void> {
  let syntheticRecords: unknown[] = [];

  await context.route('**/api/cloud-config', async (route) => {
    await route.fulfill(syntheticJson({
      configured: true,
      url: origin,
      publishableKey: 'desktop-zero-training-publishable-key',
    }));
  });

  await context.route('**/rest/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (request.method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': '*',
          'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
        },
        body: '',
      });
      return;
    }

    if (url.pathname.endsWith('/rest/v1/rpc/activate_my_organization_memberships')) {
      await route.fulfill(syntheticJson({}));
      return;
    }

    if (url.pathname.endsWith('/rest/v1/organization_members')) {
      await route.fulfill(syntheticJson([syntheticMembership()]));
      return;
    }

    if (url.pathname.endsWith('/rest/v1/rpc/visit_transaction_authority_active_v2')) {
      await route.fulfill(syntheticJson(false));
      return;
    }

    if (url.pathname.endsWith('/rest/v1/propcontrol_records')) {
      if (request.method() === 'GET') {
        await route.fulfill(syntheticJson(syntheticRecords));
        return;
      }
      if (request.method() === 'POST') {
        const body = request.postDataJSON();
        syntheticRecords = Array.isArray(body) ? structuredClone(body) : [structuredClone(body)];
        await route.fulfill(syntheticJson(syntheticRecords, 201));
        return;
      }
      if (request.method() === 'DELETE') {
        syntheticRecords = [];
        await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' }, body: '' });
        return;
      }
    }

    if (url.pathname.endsWith('/rest/v1/fichas')) {
      await route.fulfill(syntheticJson([]));
      return;
    }

    await route.fulfill(syntheticJson({ error: 'UNEXPECTED_SYNTHETIC_ENDPOINT', path: url.pathname }, 500));
  });
}
'''
    text = replace_once(
        text,
        "\nasync function seedContext(context: BrowserContext): Promise<void> {",
        authority + "\nasync function seedContext(context: BrowserContext): Promise<void> {",
        "desktop authority helper",
    )
    text = replace_once(
        text,
        "  await context.addInitScript(({ crm, identityStorageKey, storageKey }) => {",
        "  await context.addInitScript(({ crm, generation, identityStorageKey, storageKey }) => {",
        "desktop init signature",
    )
    text = replace_once(
        text,
        "      userId: 'desktop-zero-training-owner',\n      email: 'franco@propcontrol.test',\n    }));\n    localStorage.setItem(storageKey, JSON.stringify(crm));",
        "      userId: 'desktop-zero-training-owner',\n      email: 'franco@propcontrol.test',\n      __propcontrolAuthGeneration: generation,\n    }));\n    localStorage.setItem('propcontrol-cloud-auth-generation-v1', generation);\n    localStorage.setItem(storageKey, JSON.stringify(crm));",
        "desktop generation storage",
    )
    text = replace_once(
        text,
        "  }, { crm: fixture(), identityStorageKey: identityKey, storageKey: STORAGE_KEY });",
        "  }, { crm: fixture(), generation: GENERATION, identityStorageKey: identityKey, storageKey: STORAGE_KEY });",
        "desktop init args",
    )

    chromium_anchor = "  });\n  await seedContext(context);\n\n  try {\n    const page = await context.newPage();\n    const url = `http://127.0.0.1:${port}`;"
    chromium_new = "  });\n  await installSyntheticAuthority(context, `http://127.0.0.1:${port}`);\n  await seedContext(context);\n\n  try {\n    const page = await context.newPage();\n    const url = `http://127.0.0.1:${port}`;"
    text = replace_once(text, chromium_anchor, chromium_new, "desktop chromium authority")

    webkit_anchor = "  });\n  await seedContext(context);\n\n  try {\n    const page = await context.newPage();\n    await load(page, `http://127.0.0.1:${port}`);"
    webkit_new = "  });\n  await installSyntheticAuthority(context, `http://127.0.0.1:${port}`);\n  await seedContext(context);\n\n  try {\n    const page = await context.newPage();\n    await load(page, `http://127.0.0.1:${port}`);"
    text = replace_once(text, webkit_anchor, webkit_new, "desktop webkit authority")

    path.write_text(text)


def align_redesign() -> None:
    path = Path("src/tests/leads-professional-redesign.test.ts")
    text = path.read_text()

    text = replace_once(
        text,
        "const email = 'owner-leads-redesign@propcontrol.test';\nconst sessionKey = 'propcontrol-cloud-session-v1';",
        "const email = 'owner-leads-redesign@propcontrol.test';\nconst generation = 'leads-redesign-generation-a34-1';\nconst sessionKey = 'propcontrol-cloud-session-v1';",
        "redesign generation",
    )

    authority = r'''
function syntheticMembership() {
  return {
    organization_id: organizationId,
    member_id: memberId,
    user_id: userId,
    role: 'owner',
    status: 'active',
    display_name: 'Franco Solís',
    email,
    phone: '5493515110001',
    created_at: '2026-08-04T12:00:00.000Z',
    last_active_at: '2026-09-13T18:00:00.000Z',
  };
}

function syntheticJson(body: unknown, status = 200) {
  return {
    status,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(body),
  };
}

async function installSyntheticAuthority(context: BrowserContext, origin: string): Promise<void> {
  let syntheticRecords: unknown[] = [];

  await context.route('**/api/cloud-config', async (route) => {
    await route.fulfill(syntheticJson({
      configured: true,
      url: origin,
      publishableKey: 'leads-redesign-publishable-key',
    }));
  });

  await context.route('**/rest/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (request.method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': '*',
          'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
        },
        body: '',
      });
      return;
    }

    if (url.pathname.endsWith('/rest/v1/rpc/activate_my_organization_memberships')) {
      await route.fulfill(syntheticJson({}));
      return;
    }

    if (url.pathname.endsWith('/rest/v1/organization_members')) {
      await route.fulfill(syntheticJson([syntheticMembership()]));
      return;
    }

    if (url.pathname.endsWith('/rest/v1/rpc/visit_transaction_authority_active_v2')) {
      await route.fulfill(syntheticJson(false));
      return;
    }

    if (url.pathname.endsWith('/rest/v1/propcontrol_records')) {
      if (request.method() === 'GET') {
        await route.fulfill(syntheticJson(syntheticRecords));
        return;
      }
      if (request.method() === 'POST') {
        const body = request.postDataJSON();
        syntheticRecords = Array.isArray(body) ? structuredClone(body) : [structuredClone(body)];
        await route.fulfill(syntheticJson(syntheticRecords, 201));
        return;
      }
      if (request.method() === 'DELETE') {
        syntheticRecords = [];
        await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' }, body: '' });
        return;
      }
    }

    if (url.pathname.endsWith('/rest/v1/fichas')) {
      await route.fulfill(syntheticJson([]));
      return;
    }

    await route.fulfill(syntheticJson({ error: 'UNEXPECTED_SYNTHETIC_ENDPOINT', path: url.pathname }, 500));
  });
}

'''
    text = replace_once(
        text,
        "function contextOptions(viewport: { width: number; height: number }): BrowserContextOptions {",
        authority + "function contextOptions(viewport: { width: number; height: number }): BrowserContextOptions {",
        "redesign authority helper",
    )
    text = replace_once(
        text,
        "  marker: string,\n): Promise<BrowserContext> {\n  const context = await browser.newContext(contextOptions(viewport));\n  await context.route('**/api/cloud-config', async (route) => {\n    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Nube de prueba no disponible.' }) });\n  });",
        "  marker: string,\n  origin: string,\n): Promise<BrowserContext> {\n  const context = await browser.newContext(contextOptions(viewport));\n  await installSyntheticAuthority(context, origin);",
        "redesign context authority",
    )
    text = replace_once(
        text,
        "  await context.addInitScript(({ data, keys, currentUserId, currentEmail, currentMemberId, initMarker }) => {",
        "  await context.addInitScript(({ data, generationValue, keys, currentUserId, currentEmail, currentMemberId, initMarker }) => {",
        "redesign init signature",
    )
    text = replace_once(
        text,
        "      userId: currentUserId,\n      email: currentEmail,\n    }));\n    localStorage.setItem(keys.storage, JSON.stringify(data));",
        "      userId: currentUserId,\n      email: currentEmail,\n      __propcontrolAuthGeneration: generationValue,\n    }));\n    localStorage.setItem('propcontrol-cloud-auth-generation-v1', generationValue);\n    localStorage.setItem(keys.storage, JSON.stringify(data));",
        "redesign generation storage",
    )
    text = replace_once(
        text,
        "    data: fixture(),\n    keys: { session: sessionKey, storage: storageKey, sync: syncKey, activeMember: activeMemberKey },",
        "    data: fixture(),\n    generationValue: generation,\n    keys: { session: sessionKey, storage: storageKey, sync: syncKey, activeMember: activeMemberKey },",
        "redesign init args",
    )
    text = replace_once(
        text,
        "    const context = await contextFor(browser, viewport, `pc-stage-contrast-${viewport.width}-${viewport.height}`);",
        "    const context = await contextFor(browser, viewport, `pc-stage-contrast-${viewport.width}-${viewport.height}`, url);",
        "redesign contrast context",
    )

    replacements = [
        (
            "redesign desktop context",
            "    const desktop = await contextFor(browser, { width: 1366, height: 768 }, 'pc-leads-redesign-desktop');",
            "    const desktop = await contextFor(browser, { width: 1366, height: 768 }, 'pc-leads-redesign-desktop', started.url);",
        ),
        (
            "redesign laptop context",
            "    const laptop = await contextFor(browser, { width: 1280, height: 720 }, 'pc-leads-redesign-laptop');",
            "    const laptop = await contextFor(browser, { width: 1280, height: 720 }, 'pc-leads-redesign-laptop', started.url);",
        ),
        (
            "redesign tablet context",
            "    const tablet = await contextFor(browser, { width: 768, height: 1024 }, 'pc-leads-redesign-tablet');",
            "    const tablet = await contextFor(browser, { width: 768, height: 1024 }, 'pc-leads-redesign-tablet', started.url);",
        ),
        (
            "redesign mobile context",
            "    const mobile = await contextFor(browser, { width: 390, height: 844 }, 'pc-leads-redesign-mobile');",
            "    const mobile = await contextFor(browser, { width: 390, height: 844 }, 'pc-leads-redesign-mobile', started.url);",
        ),
    ]
    for label, old, new in replacements:
        text = replace_once(text, old, new, label)

    path.write_text(text)


align_desktop()
align_redesign()
