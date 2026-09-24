import type { TenantScope } from './active-organization.js';
import { getCloudSession } from './cloud-api.js';
import { resolveTenantCommercialIdentity } from './configuration-domain.js';
import type { Property } from './models.js';
import {
  clearReadEntityNavigation,
  currentReadEntityReturnTarget,
  currentReadEntityTarget,
  openEntityReadOnly,
  returnToEntityReadOnly,
} from './entity-read-navigation.js';
import { MAX_PROPERTY_PHOTOS, uploadPropertyPhoto } from './property-photo-upload.js';
import { propertyShareText, type PropertyWithFicha } from './property-ficha.js';
import { publishPropertyFicha, type PublishedPropertyFicha } from './public-property-share.js';
import { authenticatedTenantMember, saveData, state } from './store.js';
import { assertTenantCrmScope, writeTenantSnapshot } from './tenant-storage.js';
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

let searchText = '';
let photoUploadInProgress: TenantRuntimeLease | null = null;
const propertyFormWriteContexts = new WeakMap<HTMLFormElement, { scope: TenantScope; runtimeLease: TenantRuntimeLease }>();

function capturePropertyFormWriteContext(form: HTMLFormElement): void {
  if (form.classList.contains('collapsed')) return;
  const scope = requireCurrentTenantScope();
  const runtimeLease = captureTenantRuntimeLease(scope);
  assertTenantRuntimeLeaseCurrent(runtimeLease);
  assertTenantCrmScope(scope, state.crm);
  propertyFormWriteContexts.set(form, { scope, runtimeLease });
}

function propertyFormWriteContext(form: HTMLFormElement) {
  const context = propertyFormWriteContexts.get(form);
  if (!context) throw new Error('TENANT_FORM_CONTEXT_REQUIRED');
  assertTenantRuntimeLeaseCurrent(context.runtimeLease);
  assertTenantCrmScope(context.scope, state.crm);
  const member = authenticatedTenantMember(context.scope);
  if (!member) throw new Error('AUTHENTICATED_TENANT_MEMBER_REQUIRED');
  return { ...context, member };
}
const priceFormatter = new Intl.NumberFormat('es-AR');

export interface MvpPropertiesRenderOptions {
  onOpenOpportunities?: () => void;
}

function normalized(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function textValue(property: PropertyWithFicha | null, key: keyof PropertyWithFicha): string {
  const current = property?.[key];
  return escapeHtml(current === undefined || current === null ? '' : String(current));
}

function validPhotoUrls(property: PropertyWithFicha | null): string[] {
  return (property?.photoUrls ?? [])
    .map(safePhotoUrl)
    .filter((url): url is string => Boolean(url))
    .slice(0, MAX_PROPERTY_PHOTOS);
}

function option(value: string, label: string, current: string | undefined): string {
  return `<option value="${escapeHtml(value)}"${value === (current ?? '') ? ' selected' : ''}>${escapeHtml(label)}</option>`;
}

function propertyRows(): PropertyWithFicha[] {
  const query = normalized(searchText);
  const properties = state.crm.properties as PropertyWithFicha[];
  const filtered = query
    ? properties.filter((property) => [
      property.title,
      property.address,
      property.type,
      property.operation,
      property.owner,
      property.status,
      property.price,
      property.features,
      property.description,
    ].some((item) => normalized(item).includes(query)))
    : [...properties];

  return filtered.sort((left, right) => (
    left.status.localeCompare(right.status, 'es', { sensitivity: 'base' })
    || left.title.localeCompare(right.title, 'es', { sensitivity: 'base' })
  ));
}

function card(property: PropertyWithFicha): string {
  const details = [
    property.type,
    property.bedrooms ? `${property.bedrooms} dorm.` : '',
    property.bathrooms ? `${property.bathrooms} baños` : '',
    property.coveredMeters ? `${property.coveredMeters} m² cubiertos` : '',
  ].filter(Boolean).join(' · ');
  const photos = validPhotoUrls(property);
  const cover = photos[0];

  return `<article class="mvp-lead-card mvp-property-card">
    ${cover ? `<img class="mvp-property-cover" src="${escapeHtml(cover)}" alt="Foto principal de ${escapeHtml(property.title)}" loading="lazy">` : '<div class="mvp-property-cover mvp-property-cover-empty">Sin foto</div>'}
    <div class="mvp-property-main">
      <div class="mvp-lead-name mvp-property-title">
        <h3>${escapeHtml(property.title)}</h3>
        <span>USD ${priceFormatter.format(property.price)}</span>
      </div>
      <p>${escapeHtml(property.address)}${details ? ` · ${escapeHtml(details)}` : ''}</p>
      <div class="mvp-property-meta">
        <span>${escapeHtml(property.operation)}</span>
        <span>${escapeHtml(property.status)}</span>
        <span>${photos.length ? `${photos.length} foto${photos.length === 1 ? '' : 's'}` : 'Sin fotos'}</span>
        <span>${property.publicSlug ? 'Ficha publicada' : 'Ficha sin publicar'}</span>
        <span class="mvp-property-internal">Interno: ${escapeHtml(property.owner || 'Sin propietario')}</span>
      </div>
    </div>
    <div class="mvp-lead-actions mvp-property-card-actions">
      <button type="button" class="secondary" data-open-property-read="${property.id}">Abrir</button>
      <button type="button" class="mvp-property-share" data-share-property-ficha="${property.id}">Compartir ficha</button>
      <button type="button" class="secondary" data-open-property-ficha="${property.id}">Ver ficha</button>
      <button type="button" class="secondary" data-edit-property="${property.id}" aria-controls="mvp-property-form">Editar</button>
      <button type="button" class="delete" data-delete="properties" data-id="${property.id}" aria-label="Eliminar ${escapeHtml(property.title)}">×</button>
    </div>
  </article>`;
}

function focusPropertyForm(container: HTMLElement): void {
  window.requestAnimationFrame(() => {
    const form = container.querySelector<HTMLFormElement>('#mvp-property-form:not(.collapsed)');
    if (!form) return;
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    form.querySelector<HTMLInputElement>('input[name="title"]')?.focus({ preventScroll: true });
  });
}

function findProperty(id: number): PropertyWithFicha | null {
  return (state.crm.properties as PropertyWithFicha[]).find((property) => property.id === id) ?? null;
}

function propertyReadOnlySheet(): string {
  const target = currentReadEntityTarget();
  if (target?.entityType !== 'property') return '';
  const property = findProperty(target.entityId);
  if (!property) return '';
  const returnTarget = currentReadEntityReturnTarget();
  const returnAction = returnTarget?.entityType === 'lead'
    ? '<button type="button" class="secondary" data-return-read-entity>← Volver al lead</button>'
    : '';
  const details = [
    property.type,
    property.bedrooms ? `${property.bedrooms} dorm.` : '',
    property.bathrooms ? `${property.bathrooms} baños` : '',
    property.coveredMeters ? `${property.coveredMeters} m² cubiertos` : '',
  ].filter(Boolean).join(' · ');
  return `<section class="mvp-lead-card mvp-property-card mvp-property-read-sheet" data-property-read-sheet="${property.id}">
    <div class="mvp-property-main">
      <div class="mvp-lead-name mvp-property-title"><h2>${escapeHtml(property.title)}</h2><span>USD ${priceFormatter.format(property.price)}</span></div>
      <p>${escapeHtml(property.address)}${details ? ` · ${escapeHtml(details)}` : ''}</p>
      <div class="mvp-property-meta">
        <span>${escapeHtml(property.operation)}</span>
        <span>${escapeHtml(property.status)}</span>
        <span>${escapeHtml(property.features || 'Sin características adicionales')}</span>
      </div>
      ${property.description?.trim() ? `<p>${escapeHtml(property.description.trim())}</p>` : ''}
    </div>
    <div class="mvp-lead-actions mvp-property-card-actions">
      ${returnAction}
      <button type="button" class="secondary" data-open-property-ficha="${property.id}">Ver ficha pública</button>
      <button type="button" class="secondary" data-edit-property="${property.id}">Editar</button>
    </div>
  </section>`;
}

function propertyShareOperationIsCurrent(
  scope: TenantScope,
  runtimeLease: TenantRuntimeLease,
): boolean {
  return tenantRuntimeLeaseIsCurrent(runtimeLease) && getCloudSession()?.userId === scope.userId;
}

function assertPropertyShareOperationCurrent(
  scope: TenantScope,
  runtimeLease: TenantRuntimeLease,
): void {
  assertTenantRuntimeLeaseCurrent(runtimeLease);
  if (getCloudSession()?.userId !== scope.userId) throw new Error(TENANT_RUNTIME_STALE);
}

function propertyPhotoOperationIsCurrent(
  scope: TenantScope,
  runtimeLease: TenantRuntimeLease,
): boolean {
  return tenantScopesEqual(scope, runtimeLease.scope)
    && tenantRuntimeLeaseIsCurrent(runtimeLease)
    && getCloudSession()?.userId === scope.userId;
}

function assertPropertyPhotoOperationCurrent(
  scope: TenantScope,
  runtimeLease: TenantRuntimeLease,
): void {
  if (!tenantScopesEqual(scope, runtimeLease.scope)) throw new Error(TENANT_RUNTIME_STALE);
  assertTenantRuntimeLeaseCurrent(runtimeLease);
  if (getCloudSession()?.userId !== scope.userId) throw new Error(TENANT_RUNTIME_STALE);
}

function currentPhotoUploadInProgress(): boolean {
  const runtimeLease = photoUploadInProgress;
  return Boolean(runtimeLease && propertyPhotoOperationIsCurrent(runtimeLease.scope, runtimeLease));
}

function assertPropertyShareTarget(
  property: PropertyWithFicha,
  scope: TenantScope,
  runtimeLease: TenantRuntimeLease,
): PropertyWithFicha {
  if (!tenantScopesEqual(scope, runtimeLease.scope)) throw new Error(TENANT_RUNTIME_STALE);
  assertPropertyShareOperationCurrent(scope, runtimeLease);
  const current = findProperty(property.id);
  if (current !== property) throw new Error(TENANT_RUNTIME_STALE);
  return current;
}

function showButtonFeedback(
  button: HTMLButtonElement,
  message: string,
  scope: TenantScope,
  runtimeLease: TenantRuntimeLease,
): void {
  const original = button.textContent ?? '';
  button.textContent = message;
  button.disabled = true;
  window.setTimeout(() => {
    if (!propertyShareOperationIsCurrent(scope, runtimeLease)) return;
    button.textContent = original;
    button.disabled = false;
  }, 1800);
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('No se pudo copiar el enlace.');
}

export function rememberPublishedFicha(
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
      assertPropertyShareOperationCurrent(scope, runtimeLease);
      saveData(reason);
    }
    return;
  }
  current.publicSlug = slug;
  assertPropertyShareOperationCurrent(scope, runtimeLease);
  saveData(reason);
}


function currentTenantCommercialIdentity(
  scope: TenantScope,
  runtimeLease: TenantRuntimeLease,
) {
  assertPropertyShareOperationCurrent(scope, runtimeLease);
  assertTenantCrmScope(scope, state.crm);
  const identity = resolveTenantCommercialIdentity({
    organization: state.crm.organization,
  });
  if (identity.organizationId !== scope.organizationId) throw new Error(TENANT_RUNTIME_STALE);
  return identity;
}

export async function publishAndRememberPropertyFicha(
  property: PropertyWithFicha,
  scope: TenantScope,
  runtimeLease: TenantRuntimeLease,
  reason = 'Ficha pública publicada',
  persistWhenUnchanged = false,
): Promise<PublishedPropertyFicha> {
  assertPropertyShareTarget(property, scope, runtimeLease);
  const tenantIdentity = currentTenantCommercialIdentity(scope, runtimeLease);
  const published = await publishPropertyFicha(property, scope, runtimeLease, tenantIdentity);
  assertPropertyShareOperationCurrent(scope, runtimeLease);
  rememberPublishedFicha(property, published.slug, scope, runtimeLease, reason, persistWhenUnchanged);
  assertPropertyShareOperationCurrent(scope, runtimeLease);
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
    assertPropertyShareOperationCurrent(scope, runtimeLease);
    const tenantIdentity = currentTenantCommercialIdentity(scope, runtimeLease);
    if (navigator.share) {
      await navigator.share({
        title,
        text: propertyShareText(title, tenantIdentity),
        url: published.url,
      });
      assertPropertyShareOperationCurrent(scope, runtimeLease);
      button.textContent = original;
      button.disabled = false;
      return;
    }
    await copyText(published.url);
    assertPropertyShareOperationCurrent(scope, runtimeLease);
    button.textContent = original;
    button.disabled = false;
    showButtonFeedback(button, 'Enlace corto copiado', scope, runtimeLease);
  } catch (error) {
    if (!propertyShareOperationIsCurrent(scope, runtimeLease)) return;
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
    assertPropertyShareOperationCurrent(scope, runtimeLease);
    if (preview) preview.location.replace(published.url);
    else location.assign(published.url);
  } catch (error) {
    if (!propertyShareOperationIsCurrent(scope, runtimeLease)) {
      preview?.close();
      return;
    }
    preview?.close();
    window.alert(error instanceof Error ? error.message : 'No se pudo abrir la ficha.');
  } finally {
    if (!propertyShareOperationIsCurrent(scope, runtimeLease)) return;
    button.textContent = original;
    button.disabled = false;
  }
}

function bindPropertyCardActions(container: HTMLElement, options: MvpPropertiesRenderOptions): void {
  container.querySelectorAll<HTMLButtonElement>('[data-open-property-read]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const propertyId = Number(button.dataset.openPropertyRead);
      if (!propertyId || !findProperty(propertyId)) return;
      openEntityReadOnly({ entityType: 'property', entityId: propertyId });
    });
  });

  container.querySelectorAll<HTMLButtonElement>('[data-return-read-entity]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      returnToEntityReadOnly();
    });
  });
  container.querySelectorAll<HTMLButtonElement>('[data-edit-property]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const propertyId = Number(button.dataset.editProperty);
      if (!propertyId || !findProperty(propertyId)) return;
      clearReadEntityNavigation();
      state.editingPropertyId = propertyId;
      state.openForms.property = true;
      renderMvpProperties(container, options);
      focusPropertyForm(container);
    });
  });

  container.querySelectorAll<HTMLButtonElement>('[data-open-property-ficha]').forEach((button) => {
    button.addEventListener('click', () => {
      const property = findProperty(Number(button.dataset.openPropertyFicha));
      if (!property) return;
      void openPropertyFicha(property, button);
    });
  });

  container.querySelectorAll<HTMLButtonElement>('[data-share-property-ficha]').forEach((button) => {
    button.addEventListener('click', () => {
      const property = findProperty(Number(button.dataset.sharePropertyFicha));
      if (!property) return;
      void sharePropertyFicha(property, button);
    });
  });
}

function updatePropertyResults(container: HTMLElement, options: MvpPropertiesRenderOptions): void {
  const properties = propertyRows();
  const results = container.querySelector<HTMLElement>('#mvp-property-results');
  const count = container.querySelector<HTMLElement>('#mvp-property-count');
  if (results) results.innerHTML = properties.map(card).join('') || '<p class="empty-state">No hay propiedades para mostrar.</p>';
  if (count) count.textContent = `${properties.length} propiedades`;
  bindPropertyCardActions(container, options);
}

function optionalNumber(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function showPropertyFormError(
  form: HTMLFormElement,
  message: string,
  fieldElement?: HTMLInputElement | HTMLSelectElement | null,
): void {
  const error = form.querySelector<HTMLElement>('[data-property-error]');
  if (error) {
    error.textContent = message;
    error.hidden = false;
  }
  form.querySelectorAll<HTMLElement>('[aria-invalid="true"]').forEach((node) => node.removeAttribute('aria-invalid'));
  if (fieldElement) {
    fieldElement.setAttribute('aria-invalid', 'true');
    fieldElement.focus({ preventScroll: false });
  }
}

function clearPropertyFormError(form: HTMLFormElement): void {
  const error = form.querySelector<HTMLElement>('[data-property-error]');
  if (error) {
    error.textContent = '';
    error.hidden = true;
  }
  form.querySelectorAll<HTMLElement>('[aria-invalid="true"]').forEach((node) => node.removeAttribute('aria-invalid'));
}

function rollbackPropertySave(
  form: HTMLFormElement,
  context: { scope: TenantScope; runtimeLease: TenantRuntimeLease },
  previousCrm: typeof state.crm,
): void {
  if (!tenantRuntimeLeaseIsCurrent(context.runtimeLease)) {
    showPropertyFormError(form, 'El tenant o runtime activo cambió durante el guardado. La propiedad no se confirmó.');
    return;
  }
  try {
    assertTenantRuntimeLeaseCurrent(context.runtimeLease);
    assertTenantCrmScope(context.scope, previousCrm);
    state.crm = previousCrm;
    assertTenantCrmScope(context.scope, state.crm);
    writeTenantSnapshot(context.scope, previousCrm, {
      markDirty: true,
      reason: 'Reversión de propiedad no persistida',
      backup: false,
    });
  } catch {
    // Nunca se intenta completar un rollback sobre otro tenant o runtime.
  }
  showPropertyFormError(
    form,
    'No se pudo guardar la propiedad. Los datos y fotos siguen en el formulario para reintentar.',
  );
}

function photoPreviewHtml(urls: string[]): string {
  if (!urls.length) {
    return '<div class="mvp-property-photo-empty"><strong>Todavía no cargaste fotos</strong><span>La primera foto será la portada de la ficha.</span></div>';
  }
  return urls.map((url, index) => `<article class="mvp-property-photo-item">
    <img src="${escapeHtml(url)}" alt="Foto ${index + 1}" loading="lazy">
    <div class="mvp-property-photo-caption"><strong>${index === 0 ? 'Foto principal' : `Foto ${index + 1}`}</strong><span>${index + 1} de ${urls.length}</span></div>
    <div class="mvp-property-photo-actions">
      <button type="button" class="secondary" data-photo-left="${index}" ${index === 0 ? 'disabled' : ''} aria-label="Mover foto a la izquierda">←</button>
      <button type="button" class="secondary" data-photo-right="${index}" ${index === urls.length - 1 ? 'disabled' : ''} aria-label="Mover foto a la derecha">→</button>
      <button type="button" class="delete" data-photo-remove="${index}" aria-label="Quitar foto">×</button>
    </div>
  </article>`).join('');
}

function formPhotoUrls(form: HTMLFormElement): string[] {
  const storage = form.querySelector<HTMLTextAreaElement>('textarea[name="photoUrls"]');
  return (storage?.value ?? '')
    .split(/\r?\n/)
    .map((value) => safePhotoUrl(value.trim()))
    .filter((url): url is string => Boolean(url))
    .slice(0, MAX_PROPERTY_PHOTOS);
}

function updatePhotoManager(form: HTMLFormElement, urls: string[], statusMessage = ''): void {
  const cleanUrls = urls
    .map(safePhotoUrl)
    .filter((url): url is string => Boolean(url))
    .slice(0, MAX_PROPERTY_PHOTOS);
  const storage = form.querySelector<HTMLTextAreaElement>('textarea[name="photoUrls"]');
  const preview = form.querySelector<HTMLElement>('[data-property-photo-preview]');
  const count = form.querySelector<HTMLElement>('[data-property-photo-count]');
  const status = form.querySelector<HTMLElement>('[data-property-photo-status]');
  if (storage) storage.value = cleanUrls.join('\n');
  if (preview) preview.innerHTML = photoPreviewHtml(cleanUrls);
  if (count) count.textContent = `${cleanUrls.length} de ${MAX_PROPERTY_PHOTOS} fotos`;
  if (status) status.textContent = statusMessage;
}

function setPhotoUploading(
  form: HTMLFormElement,
  active: boolean,
  message: string,
  scope: TenantScope,
  runtimeLease: TenantRuntimeLease,
): void {
  assertPropertyPhotoOperationCurrent(scope, runtimeLease);
  if (active) photoUploadInProgress = runtimeLease;
  else if (photoUploadInProgress === runtimeLease) photoUploadInProgress = null;
  form.querySelectorAll<HTMLButtonElement>('button[type="submit"], [data-property-photo-picker], [data-cancel-property-edit]')
    .forEach((button) => { button.disabled = active; });
  const input = form.querySelector<HTMLInputElement>('[data-property-photo-input]');
  if (input) input.disabled = active;
  const status = form.querySelector<HTMLElement>('[data-property-photo-status]');
  if (status) status.textContent = message;
  form.classList.toggle('photo-uploading', active);
}

async function handlePhotoSelection(form: HTMLFormElement, input: HTMLInputElement, propertyId: number): Promise<void> {
  const scope = requireCurrentTenantScope();
  const runtimeLease = captureTenantRuntimeLease(scope);
  const tenantContext = { scope, runtimeLease };
  assertPropertyPhotoOperationCurrent(scope, runtimeLease);

  const selected = Array.from(input.files ?? []);
  input.value = '';
  if (!selected.length) return;

  const urls = formPhotoUrls(form);
  const available = MAX_PROPERTY_PHOTOS - urls.length;
  if (available <= 0) {
    assertPropertyPhotoOperationCurrent(scope, runtimeLease);
    updatePhotoManager(form, urls, `Ya cargaste el máximo de ${MAX_PROPERTY_PHOTOS} fotos.`);
    return;
  }

  const files = selected.slice(0, available);
  const omitted = selected.length - files.length;
  const errors: string[] = [];
  setPhotoUploading(form, true, `Preparando 1 de ${files.length} fotos…`, scope, runtimeLease);

  for (let index = 0; index < files.length; index += 1) {
    assertPropertyPhotoOperationCurrent(scope, runtimeLease);
    const file = files[index]!;
    setPhotoUploading(
      form,
      true,
      `Comprimiendo y cargando ${index + 1} de ${files.length}: ${file.name}`,
      scope,
      runtimeLease,
    );
    try {
      const uploadedUrl = await uploadPropertyPhoto(file, propertyId, tenantContext);
      assertPropertyPhotoOperationCurrent(scope, runtimeLease);
      urls.push(uploadedUrl);
      assertPropertyPhotoOperationCurrent(scope, runtimeLease);
      updatePhotoManager(form, urls, `Foto ${index + 1} de ${files.length} cargada.`);
    } catch (error) {
      if (!propertyPhotoOperationIsCurrent(scope, runtimeLease)) return;
      errors.push(error instanceof Error ? error.message : `No se pudo cargar ${file.name}.`);
    }
  }

  assertPropertyPhotoOperationCurrent(scope, runtimeLease);
  const finalMessage = errors.length
    ? `${urls.length} fotos listas. ${errors.join(' ')}`
    : `${urls.length} fotos listas para la ficha.${omitted > 0 ? ` Se omitieron ${omitted} por el límite.` : ''}`;
  setPhotoUploading(form, false, finalMessage, scope, runtimeLease);
  assertPropertyPhotoOperationCurrent(scope, runtimeLease);
  updatePhotoManager(form, urls, finalMessage);
}

function bindPhotoManager(form: HTMLFormElement, propertyId: number): void {
  const input = form.querySelector<HTMLInputElement>('[data-property-photo-input]');
  const storage = form.querySelector<HTMLTextAreaElement>('textarea[name="photoUrls"]');
  storage?.addEventListener('change', () => {
    const urls = formPhotoUrls(form);
    updatePhotoManager(form, urls, urls.length ? `${urls.length} fotos importadas. Revisalas antes de guardar.` : 'No se importaron fotos.');
  });
  form.querySelector<HTMLButtonElement>('[data-property-photo-picker]')?.addEventListener('click', () => input?.click());
  input?.addEventListener('change', () => { void handlePhotoSelection(form, input, propertyId); });

  form.querySelector<HTMLElement>('[data-property-photo-preview]')?.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const urls = formPhotoUrls(form);
    const removeIndex = Number(target.closest<HTMLElement>('[data-photo-remove]')?.dataset.photoRemove);
    const leftIndex = Number(target.closest<HTMLElement>('[data-photo-left]')?.dataset.photoLeft);
    const rightIndex = Number(target.closest<HTMLElement>('[data-photo-right]')?.dataset.photoRight);

    if (Number.isInteger(removeIndex) && removeIndex >= 0 && removeIndex < urls.length) {
      urls.splice(removeIndex, 1);
      updatePhotoManager(form, urls, 'Foto quitada. Guardá la propiedad para confirmar el cambio.');
      return;
    }
    if (Number.isInteger(leftIndex) && leftIndex > 0 && leftIndex < urls.length) {
      [urls[leftIndex - 1], urls[leftIndex]] = [urls[leftIndex]!, urls[leftIndex - 1]!];
      updatePhotoManager(form, urls, 'Orden actualizado.');
      return;
    }
    if (Number.isInteger(rightIndex) && rightIndex >= 0 && rightIndex < urls.length - 1) {
      [urls[rightIndex], urls[rightIndex + 1]] = [urls[rightIndex + 1]!, urls[rightIndex]!];
      updatePhotoManager(form, urls, 'Orden actualizado.');
    }
  });
}

export function renderMvpProperties(container: HTMLElement, options: MvpPropertiesRenderOptions = {}): void {
  const editing = findProperty(state.editingPropertyId ?? 0);
  const properties = propertyRows();
  const formPropertyId = editing?.id ?? nextId(state.crm.properties);
  const editingPhotos = validPhotoUrls(editing);
  const types = ['Departamento', 'Casa', 'Dúplex', 'Terreno', 'Comercial'];
  const operations = ['Venta', 'Alquiler', 'Captación'];
  const statuses = ['Activa', 'Captación', 'Reservada', 'Cerrada'];
  const opportunitiesAction = options.onOpenOpportunities
    ? '<button type="button" class="secondary property-opportunities-entry" data-open-property-opportunities>Buscar clientes compatibles</button>'
    : '';

  container.innerHTML = `<div class="mvp-page-heading mvp-properties-heading">
    <div class="mvp-properties-heading-copy"><h1>Propiedades</h1><p>Gestioná tu inventario y encontrá clientes compatibles.</p></div>
    <div class="mvp-properties-heading-actions" aria-label="Acciones de propiedades">
      ${opportunitiesAction}
      <button type="button" class="mvp-properties-primary-action" data-toggle="property-form">Nueva propiedad</button>
    </div>
  </div>
  ${propertyReadOnlySheet()}
  <form id="mvp-property-form" class="mvp-lead-form mvp-property-form ${state.openForms.property ? '' : 'collapsed'}" novalidate>
    <div class="mvp-form-heading">
      <div><h2>${editing ? `Editar ${escapeHtml(editing.title)}` : 'Nueva propiedad'}</h2><p>Guardá lo esencial ahora y completá el resto cuando tengas la información.</p></div>
      <button type="button" class="quiet-button" data-cancel-property-edit>Cerrar</button>
    </div>
    <div class="mvp-property-form-section mvp-property-wide" data-property-import-status hidden></div>

    <div class="mvp-property-quick-grid mvp-property-wide" aria-label="Datos esenciales de la propiedad">
      <label>Título comercial<input name="title" value="${textValue(editing, 'title')}" placeholder="Ej. Dúplex en Docta" autocomplete="off"></label>
      <label>Zona o ubicación aproximada<input name="address" value="${textValue(editing, 'address')}" placeholder="Ej. Docta Urbanización, Córdoba" autocomplete="off"></label>
      <label>Tipo<select name="type"><option value="">Seleccionar tipo</option>${types.map((item) => option(item, item, editing?.type)).join('')}</select></label>
      <label>Operación<select name="operation"><option value="">Seleccionar operación</option>${operations.map((item) => option(item, item, editing?.operation)).join('')}</select></label>
      <label>Precio USD<input name="price" type="number" min="1" inputmode="decimal" value="${textValue(editing, 'price')}" placeholder="Ej. 120000"></label>
    </div>

    <details class="mvp-property-progressive mvp-property-wide"${editing ? ' open' : ''}>
      <summary>Completar características</summary>
      <div class="mvp-property-progressive-grid">
        <label>Dormitorios<input name="bedrooms" type="number" min="0" value="${textValue(editing, 'bedrooms')}"></label>
        <label>Baños<input name="bathrooms" type="number" min="0" value="${textValue(editing, 'bathrooms')}"></label>
        <label>Cochera<input name="garage" value="${textValue(editing, 'garage')}" placeholder="Ej. 1 cochera cubierta"></label>
        <label>Metros cubiertos<input name="coveredMeters" type="number" min="0" value="${textValue(editing, 'coveredMeters')}"></label>
        <label>Metros totales<input name="totalMeters" type="number" min="0" value="${textValue(editing, 'totalMeters')}"></label>
        <label>Antigüedad<input name="age" value="${textValue(editing, 'age')}" placeholder="Ej. A estrenar"></label>
        <label>Escritura<select name="deed">${['', 'Sí', 'No', 'En trámite', 'A confirmar'].map((item) => option(item, item || 'No informado', editing?.deed)).join('')}</select></label>
        <label>Apto crédito<select name="creditReady">${['', 'Sí', 'No', 'A confirmar'].map((item) => option(item, item || 'No informado', editing?.creditReady)).join('')}</select></label>
        <label>Forma de pago<input name="paymentMethod" value="${textValue(editing, 'paymentMethod')}" placeholder="Contado, crédito, financiación..."></label>
        <label class="mvp-property-wide">Características<textarea name="features" placeholder="Balcón, cochera, pileta, patio, seguridad...">${textValue(editing, 'features')}</textarea></label>
        <label class="mvp-property-wide">Descripción comercial<textarea name="description" placeholder="Descripción clara y breve para presentar la propiedad al cliente.">${textValue(editing, 'description')}</textarea></label>
      </div>
    </details>

    <details class="mvp-property-progressive mvp-property-wide"${editing ? ' open' : ''}>
      <summary>Fotos</summary>
      <section class="mvp-property-photo-manager" aria-labelledby="property-photo-title">
        <div class="mvp-property-photo-heading">
          <div><strong id="property-photo-title">Fotos de la ficha</strong><span data-property-photo-count>${editingPhotos.length} de ${MAX_PROPERTY_PHOTOS} fotos</span></div>
          <button type="button" data-property-photo-picker>Agregar fotos</button>
          <input type="file" accept="image/*" multiple hidden data-property-photo-input>
        </div>
        <textarea name="photoUrls" hidden>${escapeHtml(editingPhotos.join('\n'))}</textarea>
        <div class="mvp-property-photo-grid" data-property-photo-preview>${photoPreviewHtml(editingPhotos)}</div>
        <p class="mvp-property-photo-status" data-property-photo-status>JPG, PNG o WEBP. Máximo ${MAX_PROPERTY_PHOTOS} fotos. Se comprimen automáticamente.</p>
      </section>
    </details>

    <details class="mvp-property-progressive mvp-property-wide mvp-property-progressive-internal"${editing ? ' open' : ''}>
      <summary>Información interna</summary>
      <div class="mvp-property-progressive-grid">
        <label>Propietario o colega<input name="owner" value="${textValue(editing, 'owner')}" placeholder="Opcional"></label>
        <label>Estado interno<select name="status">${statuses.map((item) => option(item, item, editing?.status ?? 'Activa')).join('')}</select><small>“Activa” permite trabajarla en matching; no publica la propiedad.</small></label>
        <input type="hidden" name="sourceLink" value="${textValue(editing, 'sourceLink')}">
        <label class="mvp-property-wide">Notas internas<textarea name="notes" placeholder="Datos privados, comisión, condiciones o información del colega.">${textValue(editing, 'notes')}</textarea></label>
      </div>
    </details>

    <div data-property-error class="form-error" role="alert" aria-live="polite" hidden></div>
    <button type="submit">${editing ? 'Guardar cambios' : 'Guardar propiedad'}</button>
  </form>
  <div class="mvp-lead-toolbar">
    <label><span>Buscar</span><input id="mvp-property-search" type="search" value="${escapeHtml(searchText)}" placeholder="Nombre, zona, tipo, propietario o precio"></label>
    <strong id="mvp-property-count">${properties.length} propiedades</strong>
  </div>
  <div id="mvp-property-results" class="mvp-lead-list">${properties.map(card).join('') || '<p class="empty-state">No hay propiedades para mostrar.</p>'}</div>`;

  container.querySelector<HTMLInputElement>('#mvp-property-search')?.addEventListener('input', (event) => {
    searchText = (event.currentTarget as HTMLInputElement).value;
    updatePropertyResults(container, options);
  });

  container.querySelector<HTMLButtonElement>('[data-open-property-opportunities]')?.addEventListener('click', () => {
    options.onOpenOpportunities?.();
  });

  bindPropertyCardActions(container, options);

  const form = container.querySelector<HTMLFormElement>('#mvp-property-form');
  if (form) {
    bindPhotoManager(form, formPropertyId);
    capturePropertyFormWriteContext(form);
  }

  container.querySelector<HTMLButtonElement>('[data-cancel-property-edit]')?.addEventListener('click', () => {
    if (currentPhotoUploadInProgress()) return;
    state.editingPropertyId = null;
    state.openForms.property = false;
    renderMvpProperties(container, options);
  });

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (currentPhotoUploadInProgress()) return;
    clearPropertyFormError(form);

    let writeContext: ReturnType<typeof propertyFormWriteContext>;
    try {
      writeContext = propertyFormWriteContext(form);
    } catch {
      showPropertyFormError(form, 'El tenant o runtime activo cambió. Volvé a abrir el formulario antes de guardar.');
      return;
    }

    const values = formValues(form);
    const title = field(values, 'title').trim();
    const address = field(values, 'address').trim();
    const type = field(values, 'type').trim();
    const operation = field(values, 'operation').trim();
    const price = Number(field(values, 'price'));
    const titleField = form.elements.namedItem('title');
    const addressField = form.elements.namedItem('address');
    const typeField = form.elements.namedItem('type');
    const operationField = form.elements.namedItem('operation');
    const priceField = form.elements.namedItem('price');

    if (!title) {
      showPropertyFormError(form, 'Ingresá un título comercial.', titleField instanceof HTMLInputElement ? titleField : null);
      return;
    }
    if (!address) {
      showPropertyFormError(form, 'Ingresá una zona o ubicación aproximada.', addressField instanceof HTMLInputElement ? addressField : null);
      return;
    }
    if (!type) {
      showPropertyFormError(form, 'Seleccioná el tipo de propiedad.', typeField instanceof HTMLSelectElement ? typeField : null);
      return;
    }
    if (!operation) {
      showPropertyFormError(form, 'Seleccioná la operación.', operationField instanceof HTMLSelectElement ? operationField : null);
      return;
    }
    if (!Number.isFinite(price) || price <= 0) {
      showPropertyFormError(form, 'Ingresá un precio válido mayor a cero.', priceField instanceof HTMLInputElement ? priceField : null);
      return;
    }

    const property: PropertyWithFicha = {
      ...(editing || newSyncRecordMetadata()),
      id: editing?.id ?? formPropertyId,
      title,
      address,
      type,
      operation,
      price,
      owner: field(values, 'owner').trim(),
      status: field(values, 'status').trim() || editing?.status || 'Activa',
      bedrooms: optionalNumber(field(values, 'bedrooms')),
      bathrooms: optionalNumber(field(values, 'bathrooms')),
      garage: field(values, 'garage').trim(),
      coveredMeters: optionalNumber(field(values, 'coveredMeters')),
      totalMeters: optionalNumber(field(values, 'totalMeters')),
      age: field(values, 'age').trim(),
      deed: field(values, 'deed'),
      creditReady: field(values, 'creditReady'),
      paymentMethod: field(values, 'paymentMethod').trim(),
      features: field(values, 'features').trim(),
      description: field(values, 'description').trim(),
      photoUrls: formPhotoUrls(form),
      sourceLink: field(values, 'sourceLink').trim() || undefined,
      notes: field(values, 'notes').trim(),
      assignedToId: editing?.assignedToId ?? writeContext.member.id,
      createdById: editing?.createdById ?? writeContext.member.id,
    };

    const previousCrm = structuredClone(state.crm);
    try {
      assertTenantRuntimeLeaseCurrent(writeContext.runtimeLease);
      assertTenantCrmScope(writeContext.scope, state.crm);
      if (editing) {
        const index = state.crm.properties.findIndex((item) => item.id === editing.id);
        if (index < 0) throw new Error('PROPERTY_EDIT_TARGET_MISSING');
        state.crm.properties[index] = property as Property;
      } else {
        state.crm.properties.push(property as Property);
      }

      assertTenantRuntimeLeaseCurrent(writeContext.runtimeLease);
      assertTenantCrmScope(writeContext.scope, state.crm);
      saveData(editing ? 'Propiedad editada' : 'Propiedad creada');
      assertTenantRuntimeLeaseCurrent(writeContext.runtimeLease);
      assertTenantCrmScope(writeContext.scope, state.crm);
    } catch {
      rollbackPropertySave(form, writeContext, previousCrm);
      return;
    }

    const error = form.querySelector<HTMLElement>('[data-property-error]');
    if (property.publicSlug) {
      const scope = writeContext.scope;
      const runtimeLease = writeContext.runtimeLease;
      assertTenantRuntimeLeaseCurrent(runtimeLease);
      const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
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
        assertPropertyShareOperationCurrent(scope, runtimeLease);
      } catch (publishError) {
        if (!propertyShareOperationIsCurrent(scope, runtimeLease)) return;
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

    state.editingPropertyId = null;
    state.openForms.property = false;
    document.dispatchEvent(new CustomEvent('trv-render'));
  });
}
