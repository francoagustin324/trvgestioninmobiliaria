import type { Ficha, FichaPublica, PublicTenantIdentity } from './models.js';
import { normalizePublicTenantIdentity } from './configuration-domain.js';
import { normalizeWhatsAppPhone } from './whatsapp-contact-core.js';
import { escapeHtml, hasValue, safePhotoUrl } from './utils.js';

export function encodePublicFicha(ficha: FichaPublica): string {
  const bytes = new TextEncoder().encode(JSON.stringify(ficha));
  let binary = ''; bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

export function decodePublicFicha(payload: string): FichaPublica | null {
  try {
    const normalized = payload.replaceAll('-', '+').replaceAll('_', '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as FichaPublica;
    if (!parsed.title || !Array.isArray(parsed.photoUrls)) return null;
    parsed.photoUrls = parsed.photoUrls.map(safePhotoUrl).filter((url): url is string => Boolean(url));
    parsed.photoEnhancement = parsed.photoEnhancement === 'soft' ? 'soft' : 'none';
    parsed.tenant = normalizePublicTenantIdentity(parsed.tenant);
    return parsed;
  } catch { return null; }
}

export function publicPayload(
  ficha: Ficha,
  tenantIdentity?: PublicTenantIdentity,
): FichaPublica {
  return {
    tenant: normalizePublicTenantIdentity(tenantIdentity ?? ficha.tenant),
    title: ficha.title, propertyType: ficha.propertyType, operation: ficha.operation, zone: ficha.zone,
    approxAddress: ficha.approxAddress, price: ficha.price, expenses: ficha.expenses, bedrooms: ficha.bedrooms,
    bathrooms: ficha.bathrooms, garage: ficha.garage, coveredMeters: ficha.coveredMeters, totalMeters: ficha.totalMeters,
    age: ficha.age, status: ficha.status, amenities: ficha.amenities, description: ficha.description,
    deed: ficha.deed, creditReady: ficha.creditReady, paymentMethod: ficha.paymentMethod, photoUrls: ficha.photoUrls,
    photoEnhancement: ficha.photoEnhancement === 'soft' ? 'soft' : 'none',
  };
}

export function publicLink(ficha: Ficha, tenantIdentity?: PublicTenantIdentity): string {
  return `${location.origin}${location.pathname}#public=${encodePublicFicha(publicPayload(ficha, tenantIdentity))}`;
}

export function whatsappText(ficha: Ficha, tenantIdentity?: PublicTenantIdentity): string {
  const tenant = normalizePublicTenantIdentity(tenantIdentity ?? ficha.tenant);
  const features = [ficha.propertyType, ficha.bedrooms && `${ficha.bedrooms} dorm.`, ficha.bathrooms && `${ficha.bathrooms} baños`, ficha.coveredMeters && `${ficha.coveredMeters} m² cubiertos`, ficha.totalMeters && `${ficha.totalMeters} m² totales`].filter(Boolean).join(' · ');
  return [`Te comparto una propiedad de ${tenant.name}:`, ficha.title, ficha.zone && `Zona: ${ficha.zone}`, ficha.operation && `Operación: ${ficha.operation}`, ficha.price && `Precio: ${ficha.price}`, features && `Características: ${features}`, `Ver ficha: ${publicLink(ficha, tenant)}`, 'Decime si querés que revisemos disponibilidad y condiciones.'].filter(Boolean).join('\n');
}

type PublicDatum = [label: string, value: string];

function textOrConsult(value: unknown): string {
  return hasValue(value) ? String(value) : 'Consultar';
}

function addIfPresent(target: PublicDatum[], label: string, value: unknown): void {
  if (hasValue(value)) target.push([label, String(value)]);
}

function renderData(items: PublicDatum[], itemClass: string): string {
  return items.map(([label, value]) => `<div class="${itemClass}"><b>${escapeHtml(label)}</b><span>${escapeHtml(value)}</span></div>`).join('');
}

function keyFacts(ficha: FichaPublica): string {
  const data: PublicDatum[] = [];
  addIfPresent(data, 'Dormitorios', ficha.bedrooms);
  addIfPresent(data, 'Baños', ficha.bathrooms);
  if (hasValue(ficha.garage) && ficha.garage !== 'No') addIfPresent(data, 'Cochera', ficha.garage);
  addIfPresent(data, 'Cubiertos', ficha.coveredMeters);
  addIfPresent(data, 'Totales', ficha.totalMeters);
  data.push(['Escritura', textOrConsult(ficha.deed)]);
  return renderData(data, 'public-key-item');
}

function secondaryDetails(ficha: FichaPublica): string {
  const data: PublicDatum[] = [];
  addIfPresent(data, 'Tipo', ficha.propertyType);
  addIfPresent(data, 'Operación', ficha.operation);
  addIfPresent(data, 'Dirección aproximada', ficha.approxAddress);
  data.push(['Expensas', textOrConsult(ficha.expenses)]);
  addIfPresent(data, 'Antigüedad', ficha.age);
  addIfPresent(data, 'Estado', ficha.status);
  addIfPresent(data, 'Amenities', ficha.amenities);
  data.push(['Apto crédito', textOrConsult(ficha.creditReady)]);
  data.push(['Forma de pago', textOrConsult(ficha.paymentMethod)]);
  return renderData(data, 'public-data-item');
}

function summaryTags(ficha: FichaPublica): string {
  return [ficha.propertyType, ficha.operation]
    .filter(hasValue)
    .map((value) => `<span>${escapeHtml(String(value))}</span>`)
    .join('');
}


function safePublicLogo(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (/^\/(?!\/)/.test(raw)) return raw;
  return safePhotoUrl(raw);
}

function tenantInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'IN';
  return (parts[0]![0]! + (parts[1]?.[0] ?? '')).toUpperCase();
}

export function publicFichaHtml(ficha: FichaPublica): string {
  const photoUrls = ficha.photoUrls.map(safePhotoUrl).filter((url): url is string => Boolean(url)).slice(0, 8);
  const photos = photoUrls.map((url, index) => {
    const loading = index === 0 ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"';
    return `<img src="${escapeHtml(url)}" alt="Foto ${index + 1} de ${escapeHtml(ficha.title)}" ${loading}>`;
  }).join('');
  const tenant = normalizePublicTenantIdentity(ficha.tenant);
  const logoUrl = safePublicLogo(tenant.logoPath);
  const tenantLogo = logoUrl
    ? `<img class="public-tenant-logo" src="${escapeHtml(logoUrl)}" alt="Logo de ${escapeHtml(tenant.name)}">`
    : `<span class="public-tenant-logo public-tenant-logo-placeholder" aria-label="${escapeHtml(tenant.name)}">${escapeHtml(tenantInitials(tenant.name))}</span>`;
  const phone = normalizeWhatsAppPhone(tenant.commercialPhone);
  const contactText = encodeURIComponent(`Hola, consulto por ${ficha.title}. Quisiera confirmar disponibilidad y condiciones.`);
  const whatsappCta = phone.valid
    ? `<a class="whatsapp-public" href="https://wa.me/${phone.normalized}?text=${contactText}" target="_blank" rel="noopener">Consultar por WhatsApp</a>`
    : '';
  const legalText = tenant.legalText
    ? `<small>${escapeHtml(tenant.legalText)}</small>`
    : '';
  const enhancementClass = ficha.photoEnhancement === 'soft' ? ' enhanced' : '';
  const galleryBadge = photoUrls.length ? `<span class="public-gallery-badge">${photoUrls.length} ${photoUrls.length === 1 ? 'foto' : 'fotos'}</span>` : '';
  const zone = hasValue(ficha.zone) ? String(ficha.zone) : hasValue(ficha.approxAddress) ? String(ficha.approxAddress) : '';
  const details = secondaryDetails(ficha);

  return `<article class="public-ficha">
    <header class="public-header">${tenantLogo}<div><span>${escapeHtml(tenant.name)}</span><h1>${escapeHtml(ficha.title)}</h1></div></header>
    <div class="public-gallery${enhancementClass}">${galleryBadge}${photos || '<div class="gallery-placeholder">Fotos disponibles próximamente</div>'}</div>
    <section class="public-summary" aria-label="Resumen comercial">
      <div class="public-summary-tags">${summaryTags(ficha)}</div>
      <p class="public-price">${escapeHtml(textOrConsult(ficha.price))}</p>
      ${zone ? `<p class="public-location">${escapeHtml(zone)}</p>` : ''}
    </section>
    <section class="public-key-facts" aria-label="Características principales">${keyFacts(ficha)}</section>
    ${whatsappCta}
    ${hasValue(ficha.description) ? `<section class="public-description"><h2>Descripción</h2><p>${escapeHtml(ficha.description)}</p></section>` : ''}
    <details class="public-details"><summary>Ver todos los detalles</summary><section class="public-data">${details}</section></details>
    ${legalText}
  </article>`;
}

export function renderPublicMode(root: HTMLElement, ficha: FichaPublica | null): void {
  document.body.classList.add('public-mode');
  root.innerHTML = `<main class="public-page">${ficha ? publicFichaHtml(ficha) : '<div class="public-error"><h1>Ficha no disponible</h1><p>El enlace es inválido o está incompleto.</p></div>'}</main>`;
}
