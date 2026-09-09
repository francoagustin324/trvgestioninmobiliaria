from pathlib import Path

path = Path('src/mvp-properties-ui.ts')
text = path.read_text()

replacements = []

replacements.append((
"""import type { Property } from './models.js';
import { MAX_PROPERTY_PHOTOS, uploadPropertyPhoto } from './property-photo-upload.js';
import type { PropertyWithFicha } from './property-ficha.js';
import { publishPropertyFicha } from './public-property-share.js';
import { saveData, state } from './store.js';
import { newSyncRecordMetadata } from './sync-identity.js';
import { escapeHtml, field, formValues, nextId, safePhotoUrl } from './utils.js';
""",
"""import type { TenantScope } from './active-organization.js';
import type { Property } from './models.js';
import { MAX_PROPERTY_PHOTOS, uploadPropertyPhoto } from './property-photo-upload.js';
import type { PropertyWithFicha } from './property-ficha.js';
import { publishPropertyFicha, type PublishedPropertyFicha } from './public-property-share.js';
import { saveData, state } from './store.js';
import { newSyncRecordMetadata } from './sync-identity.js';
import {
  assertTenantRuntimeLeaseCurrent,
  captureTenantRuntimeLease,
  requireCurrentTenantScope,
  TENANT_RUNTIME_STALE,
  tenantRuntimeLeaseIsCurrent,
  tenantScopesEqual,
  type TenantRuntimeLease,
} from './tenant-runtime.js';
import { escapeHtml, field, formValues, nextId, safePhotoUrl } from './utils.js';
"""))

replacements.append((
"""function showButtonFeedback(button: HTMLButtonElement, message: string): void {
  const original = button.textContent ?? '';
  button.textContent = message;
  button.disabled = true;
  window.setTimeout(() => {
    button.textContent = original;
    button.disabled = false;
  }, 1800);
}
""",
"""function assertPropertyShareTarget(
  property: PropertyWithFicha,
  scope: TenantScope,
  runtimeLease: TenantRuntimeLease,
): PropertyWithFicha {
  if (!tenantScopesEqual(scope, runtimeLease.scope)) throw new Error(TENANT_RUNTIME_STALE);
  assertTenantRuntimeLeaseCurrent(runtimeLease);
  const current = findProperty(property.id);
  if (current !== property) throw new Error(TENANT_RUNTIME_STALE);
  return current;
}

function showButtonFeedback(
  button: HTMLButtonElement,
  message: string,
  runtimeLease: TenantRuntimeLease,
): void {
  const original = button.textContent ?? '';
  button.textContent = message;
  button.disabled = true;
  window.setTimeout(() => {
    if (!tenantRuntimeLeaseIsCurrent(runtimeLease)) return;
    button.textContent = original;
    button.disabled = false;
  }, 1800);
}
"""))

replacements.append((
"""function rememberPublishedFicha(property: PropertyWithFicha, slug: string): void {
  if (property.publicSlug === slug) return;
  property.publicSlug = slug;
  saveData('Ficha pública publicada');
}

async function sharePropertyFicha(property: PropertyWithFicha, button: HTMLButtonElement): Promise<void> {
  const original = button.textContent ?? 'Compartir ficha';
  button.disabled = true;
  button.textContent = 'Preparando enlace…';
  try {
    const published = await publishPropertyFicha(property);
    rememberPublishedFicha(property, published.slug);
    if (navigator.share) {
      await navigator.share({
        title: property.title,
        text: `Te comparto esta propiedad de TRV Gestión Inmobiliaria: ${property.title}`,
        url: published.url,
      });
      button.textContent = original;
      button.disabled = false;
      return;
    }
    await copyText(published.url);
    button.textContent = original;
    button.disabled = false;
    showButtonFeedback(button, 'Enlace corto copiado');
  } catch (error) {
    button.textContent = original;
    button.disabled = false;
    if (error instanceof DOMException && error.name === 'AbortError') return;
    window.alert(error instanceof Error ? error.message : 'No se pudo compartir la ficha.');
  }
}

async function openPropertyFicha(property: PropertyWithFicha, button: HTMLButtonElement): Promise<void> {
  const original = button.textContent ?? 'Ver ficha';
  const preview = window.open('', '_blank');
  button.disabled = true;
  button.textContent = 'Abriendo…';
  try {
    const published = await publishPropertyFicha(property);
    rememberPublishedFicha(property, published.slug);
    if (preview) preview.location.replace(published.url);
    else location.assign(published.url);
  } catch (error) {
    preview?.close();
    window.alert(error instanceof Error ? error.message : 'No se pudo abrir la ficha.');
  } finally {
    button.textContent = original;
    button.disabled = false;
  }
}
""",
"""export function rememberPublishedFicha(
  property: PropertyWithFicha,
  slug: string,
  scope: TenantScope,
  runtimeLease: TenantRuntimeLease,
  reason = 'Ficha pública publicada',
  persistWhenUnchanged = false,
): void {
  const current = assertPropertyShareTarget(property, scope, runtimeLease);
  if (current.publicSlug === slug) {
    if (persistWhenUnchanged) {
      assertTenantRuntimeLeaseCurrent(runtimeLease);
      saveData(reason);
    }
    return;
  }
  current.publicSlug = slug;
  assertTenantRuntimeLeaseCurrent(runtimeLease);
  saveData(reason);
}

export async function publishAndRememberPropertyFicha(
  property: PropertyWithFicha,
  scope: TenantScope,
  runtimeLease: TenantRuntimeLease,
  reason = 'Ficha pública publicada',
  persistWhenUnchanged = false,
): Promise<PublishedPropertyFicha> {
  assertPropertyShareTarget(property, scope, runtimeLease);
  const published = await publishPropertyFicha(property, scope, runtimeLease);
  assertTenantRuntimeLeaseCurrent(runtimeLease);
  rememberPublishedFicha(property, published.slug, scope, runtimeLease, reason, persistWhenUnchanged);
  assertTenantRuntimeLeaseCurrent(runtimeLease);
  return published;
}

export async function sharePropertyFicha(property: PropertyWithFicha, button: HTMLButtonElement): Promise<void> {
  const scope = requireCurrentTenantScope();
  const runtimeLease = captureTenantRuntimeLease(scope);
  const original = button.textContent ?? 'Compartir ficha';
  const title = property.title;
  assertPropertyShareTarget(property, scope, runtimeLease);
  button.disabled = true;
  button.textContent = 'Preparando enlace…';
  try {
    const published = await publishAndRememberPropertyFicha(property, scope, runtimeLease);
    assertTenantRuntimeLeaseCurrent(runtimeLease);
    if (navigator.share) {
      await navigator.share({
        title,
        text: `Te comparto esta propiedad de TRV Gestión Inmobiliaria: ${title}`,
        url: published.url,
      });
      assertTenantRuntimeLeaseCurrent(runtimeLease);
      button.textContent = original;
      button.disabled = false;
      return;
    }
    await copyText(published.url);
    assertTenantRuntimeLeaseCurrent(runtimeLease);
    button.textContent = original;
    button.disabled = false;
    showButtonFeedback(button, 'Enlace corto copiado', runtimeLease);
  } catch (error) {
    if (!tenantRuntimeLeaseIsCurrent(runtimeLease)) return;
    button.textContent = original;
    button.disabled = false;
    if (error instanceof DOMException && error.name === 'AbortError') return;
    window.alert(error instanceof Error ? error.message : 'No se pudo compartir la ficha.');
  }
}

export async function openPropertyFicha(property: PropertyWithFicha, button: HTMLButtonElement): Promise<void> {
  const scope = requireCurrentTenantScope();
  const runtimeLease = captureTenantRuntimeLease(scope);
  const original = button.textContent ?? 'Ver ficha';
  assertPropertyShareTarget(property, scope, runtimeLease);
  const preview = window.open('', '_blank');
  button.disabled = true;
  button.textContent = 'Abriendo…';
  try {
    const published = await publishAndRememberPropertyFicha(property, scope, runtimeLease);
    assertTenantRuntimeLeaseCurrent(runtimeLease);
    if (preview) preview.location.replace(published.url);
    else location.assign(published.url);
  } catch (error) {
    if (!tenantRuntimeLeaseIsCurrent(runtimeLease)) {
      preview?.close();
      return;
    }
    preview?.close();
    window.alert(error instanceof Error ? error.message : 'No se pudo abrir la ficha.');
  } finally {
    if (!tenantRuntimeLeaseIsCurrent(runtimeLease)) return;
    button.textContent = original;
    button.disabled = false;
  }
}
"""))

replacements.append((
"""    if (property.publicSlug) {
      const submit = form.querySelector<HTMLButtonElement>('button[type=\"submit\"]');
      if (submit) {
        submit.disabled = true;
        submit.textContent = 'Actualizando ficha pública…';
      }
      try {
        const published = await publishPropertyFicha(property);
        property.publicSlug = published.slug;
        saveData('Ficha pública actualizada');
      } catch (publishError) {
        if (error) {
          error.textContent = `La propiedad se guardó, pero la ficha pública no se actualizó: ${publishError instanceof Error ? publishError.message : 'error desconocido'}`;
          error.hidden = false;
        }
        if (submit) {
          submit.disabled = false;
          submit.textContent = 'Reintentar actualización';
        }
        return;
      }
    }
""",
"""    if (property.publicSlug) {
      const scope = requireCurrentTenantScope();
      const runtimeLease = captureTenantRuntimeLease(scope);
      const submit = form.querySelector<HTMLButtonElement>('button[type=\"submit\"]');
      if (submit) {
        submit.disabled = true;
        submit.textContent = 'Actualizando ficha pública…';
      }
      try {
        await publishAndRememberPropertyFicha(
          property,
          scope,
          runtimeLease,
          'Ficha pública actualizada',
          true,
        );
        assertTenantRuntimeLeaseCurrent(runtimeLease);
      } catch (publishError) {
        if (!tenantRuntimeLeaseIsCurrent(runtimeLease)) return;
        if (error) {
          error.textContent = `La propiedad se guardó, pero la ficha pública no se actualizó: ${publishError instanceof Error ? publishError.message : 'error desconocido'}`;
          error.hidden = false;
        }
        if (submit) {
          submit.disabled = false;
          submit.textContent = 'Reintentar actualización';
        }
        return;
      }
    }
"""))

for old, new in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'expected exactly one match, found {count}: {old[:80]!r}')
    text = text.replace(old, new, 1)

path.write_text(text)
