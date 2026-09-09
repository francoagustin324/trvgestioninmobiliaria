from pathlib import Path

# public-property-share.ts: after remote completion, require the session to still
# belong to the captured scope before accepting the response.
share_path = Path('src/public-property-share.ts')
share = share_path.read_text()
old = """  const responsePayload = await parseResponse(await fetch(target, {\n    method: 'POST',\n    headers: {\n      ...headers(config, session.accessToken),\n      Prefer: 'resolution=merge-duplicates,return=representation',\n    },\n    body: JSON.stringify(payload),\n  }));\n  assertPublishContext(scope, runtimeLease);\n\n  if (!Array.isArray(responsePayload) || responsePayload.length !== 1) {\n"""
new = """  const responsePayload = await parseResponse(await fetch(target, {\n    method: 'POST',\n    headers: {\n      ...headers(config, session.accessToken),\n      Prefer: 'resolution=merge-duplicates,return=representation',\n    },\n    body: JSON.stringify(payload),\n  }));\n  assertPublishContext(scope, runtimeLease);\n  requirePublishSession(scope);\n\n  if (!Array.isArray(responsePayload) || responsePayload.length !== 1) {\n"""
if share.count(old) != 1:
    raise SystemExit('public share response guard anchor mismatch')
share = share.replace(old, new, 1)
share_path.write_text(share)

ui_path = Path('src/mvp-properties-ui.ts')
ui = ui_path.read_text()

replacements = [
(
"""import type { TenantScope } from './active-organization.js';\nimport type { Property } from './models.js';\n""",
"""import type { TenantScope } from './active-organization.js';\nimport { getCloudSession } from './cloud-api.js';\nimport type { Property } from './models.js';\n"""
),
(
"""function assertPropertyShareTarget(\n  property: PropertyWithFicha,\n  scope: TenantScope,\n  runtimeLease: TenantRuntimeLease,\n): PropertyWithFicha {\n  if (!tenantScopesEqual(scope, runtimeLease.scope)) throw new Error(TENANT_RUNTIME_STALE);\n  assertTenantRuntimeLeaseCurrent(runtimeLease);\n  const current = findProperty(property.id);\n  if (current !== property) throw new Error(TENANT_RUNTIME_STALE);\n  return current;\n}\n\nfunction showButtonFeedback(\n  button: HTMLButtonElement,\n  message: string,\n  runtimeLease: TenantRuntimeLease,\n): void {\n""",
"""function propertyShareOperationIsCurrent(\n  scope: TenantScope,\n  runtimeLease: TenantRuntimeLease,\n): boolean {\n  return tenantRuntimeLeaseIsCurrent(runtimeLease) && getCloudSession()?.userId === scope.userId;\n}\n\nfunction assertPropertyShareOperationCurrent(\n  scope: TenantScope,\n  runtimeLease: TenantRuntimeLease,\n): void {\n  assertTenantRuntimeLeaseCurrent(runtimeLease);\n  if (getCloudSession()?.userId !== scope.userId) throw new Error(TENANT_RUNTIME_STALE);\n}\n\nfunction assertPropertyShareTarget(\n  property: PropertyWithFicha,\n  scope: TenantScope,\n  runtimeLease: TenantRuntimeLease,\n): PropertyWithFicha {\n  if (!tenantScopesEqual(scope, runtimeLease.scope)) throw new Error(TENANT_RUNTIME_STALE);\n  assertPropertyShareOperationCurrent(scope, runtimeLease);\n  const current = findProperty(property.id);\n  if (current !== property) throw new Error(TENANT_RUNTIME_STALE);\n  return current;\n}\n\nfunction showButtonFeedback(\n  button: HTMLButtonElement,\n  message: string,\n  scope: TenantScope,\n  runtimeLease: TenantRuntimeLease,\n): void {\n"""
),
(
"""  window.setTimeout(() => {\n    if (!tenantRuntimeLeaseIsCurrent(runtimeLease)) return;\n    button.textContent = original;\n    button.disabled = false;\n  }, 1800);\n}\n""",
"""  window.setTimeout(() => {\n    if (!propertyShareOperationIsCurrent(scope, runtimeLease)) return;\n    button.textContent = original;\n    button.disabled = false;\n  }, 1800);\n}\n"""
),
(
"""      assertTenantRuntimeLeaseCurrent(runtimeLease);\n      saveData(reason);\n""",
"""      assertPropertyShareOperationCurrent(scope, runtimeLease);\n      saveData(reason);\n"""
),
(
"""  current.publicSlug = slug;\n  assertTenantRuntimeLeaseCurrent(runtimeLease);\n  saveData(reason);\n""",
"""  current.publicSlug = slug;\n  assertPropertyShareOperationCurrent(scope, runtimeLease);\n  saveData(reason);\n"""
),
(
"""  const published = await publishPropertyFicha(property, scope, runtimeLease);\n  assertTenantRuntimeLeaseCurrent(runtimeLease);\n  rememberPublishedFicha(property, published.slug, scope, runtimeLease, reason, persistWhenUnchanged);\n  assertTenantRuntimeLeaseCurrent(runtimeLease);\n""",
"""  const published = await publishPropertyFicha(property, scope, runtimeLease);\n  assertPropertyShareOperationCurrent(scope, runtimeLease);\n  rememberPublishedFicha(property, published.slug, scope, runtimeLease, reason, persistWhenUnchanged);\n  assertPropertyShareOperationCurrent(scope, runtimeLease);\n"""
),
(
"""    const published = await publishAndRememberPropertyFicha(property, scope, runtimeLease);\n    assertTenantRuntimeLeaseCurrent(runtimeLease);\n    if (navigator.share) {\n""",
"""    const published = await publishAndRememberPropertyFicha(property, scope, runtimeLease);\n    assertPropertyShareOperationCurrent(scope, runtimeLease);\n    if (navigator.share) {\n"""
),
(
"""      assertTenantRuntimeLeaseCurrent(runtimeLease);\n      button.textContent = original;\n""",
"""      assertPropertyShareOperationCurrent(scope, runtimeLease);\n      button.textContent = original;\n"""
),
(
"""    await copyText(published.url);\n    assertTenantRuntimeLeaseCurrent(runtimeLease);\n    button.textContent = original;\n    button.disabled = false;\n    showButtonFeedback(button, 'Enlace corto copiado', runtimeLease);\n  } catch (error) {\n    if (!tenantRuntimeLeaseIsCurrent(runtimeLease)) return;\n""",
"""    await copyText(published.url);\n    assertPropertyShareOperationCurrent(scope, runtimeLease);\n    button.textContent = original;\n    button.disabled = false;\n    showButtonFeedback(button, 'Enlace corto copiado', scope, runtimeLease);\n  } catch (error) {\n    if (!propertyShareOperationIsCurrent(scope, runtimeLease)) return;\n"""
),
(
"""    const published = await publishAndRememberPropertyFicha(property, scope, runtimeLease);\n    assertTenantRuntimeLeaseCurrent(runtimeLease);\n    if (preview) preview.location.replace(published.url);\n""",
"""    const published = await publishAndRememberPropertyFicha(property, scope, runtimeLease);\n    assertPropertyShareOperationCurrent(scope, runtimeLease);\n    if (preview) preview.location.replace(published.url);\n"""
),
(
"""  } catch (error) {\n    if (!tenantRuntimeLeaseIsCurrent(runtimeLease)) {\n      preview?.close();\n      return;\n    }\n""",
"""  } catch (error) {\n    if (!propertyShareOperationIsCurrent(scope, runtimeLease)) {\n      preview?.close();\n      return;\n    }\n"""
),
(
"""  } finally {\n    if (!tenantRuntimeLeaseIsCurrent(runtimeLease)) return;\n    button.textContent = original;\n""",
"""  } finally {\n    if (!propertyShareOperationIsCurrent(scope, runtimeLease)) return;\n    button.textContent = original;\n"""
),
(
"""        assertTenantRuntimeLeaseCurrent(runtimeLease);\n      } catch (publishError) {\n        if (!tenantRuntimeLeaseIsCurrent(runtimeLease)) return;\n""",
"""        assertPropertyShareOperationCurrent(scope, runtimeLease);\n      } catch (publishError) {\n        if (!propertyShareOperationIsCurrent(scope, runtimeLease)) return;\n"""
),
]

for old, new in replacements:
    count = ui.count(old)
    if count != 1:
        raise SystemExit(f'ui session guard anchor mismatch ({count}): {old[:90]!r}')
    ui = ui.replace(old, new, 1)

ui_path.write_text(ui)
