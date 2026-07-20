import { FICHA_LEGAL, Ficha, FichaPublica, LOGO_PATH, WHATSAPP_NUMBER } from './models.js';
import { AGENCY_BRAND } from './branding.js';
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
    return parsed;
  } catch { return null; }
}

export function publicPayload(ficha: Ficha): FichaPublica {
  return {
    title: ficha.title, propertyType: ficha.propertyType, operation: ficha.operation, zone: ficha.zone,
    approxAddress: ficha.approxAddress, price: ficha.price, expenses: ficha.expenses, bedrooms: ficha.bedrooms,
    bathrooms: ficha.bathrooms, garage: ficha.garage, coveredMeters: ficha.coveredMeters, totalMeters: ficha.totalMeters,
    age: ficha.age, status: ficha.status, amenities: ficha.amenities, description: ficha.description,
    deed: ficha.deed, creditReady: ficha.creditReady, paymentMethod: ficha.paymentMethod, photoUrls: ficha.photoUrls,
    photoEnhancement: ficha.photoEnhancement === 'soft' ? 'soft' : 'none',
  };
}

export function publicLink(ficha: Ficha): string {
  return `${location.origin}${location.pathname}#public=${encodePublicFicha(publicPayload(ficha))}`;
}

export function whatsappText(ficha: Ficha): string {
  const features = [ficha.propertyType, ficha.bedrooms && `${ficha.bedrooms} dorm.`, ficha.bathrooms && `${ficha.bathrooms} baños`, ficha.coveredMeters && `${ficha.coveredMeters} m² cubiertos`, ficha.totalMeters && `${ficha.totalMeters} m² totales`].filter(Boolean).join(' · ');
  return [`Te comparto una propiedad de ${AGENCY_BRAND.name}:`, ficha.title, ficha.zone && `Zona: ${ficha.zone}`, ficha.operation && `Operación: ${ficha.operation}`, ficha.price && `Precio: ${ficha.price}`, features && `Características: ${features}`, `Ver ficha: ${publicLink(ficha)}`, 'Decime si querés que revisemos disponibilidad y condiciones.'].filter(Boolean).join('\n');
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

export function publicFichaHtml(ficha: FichaPublica): string {
  const photoUrls = ficha.photoUrls.map(safePhotoUrl).filter((url): url is string => Boolean(url)).slice(0, 8);
  const photos = photoUrls.map((url, index) => {
    const loading = index === 0 ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"';
    return `<img src="${escapeHtml(url)}" alt="Foto ${index + 1} de ${escapeHtml(ficha.title)}" ${loading}>`;
  }).join('');
  const contactText = encodeURIComponent(`Hola, consulto por ${ficha.title}. Quisiera confirmar disponibilidad y condiciones.`);
  const enhancementClass = ficha.photoEnhancement === 'soft' ? ' enhanced' : '';
  const galleryBadge = photoUrls.length ? `<span class="public-gallery-badge">${photoUrls.length} ${photoUrls.length === 1 ? 'foto' : 'fotos'}</span>` : '';
  const zone = hasValue(ficha.zone) ? String(ficha.zone) : hasValue(ficha.approxAddress) ? String(ficha.approxAddress) : '';
  const details = secondaryDetails(ficha);
  const phoneIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3 1.7-5A8 8 0 1 1 21 15Z"/><path d="M8.5 9.5c1 2.4 2.6 4 5 5"/></svg>';

  return `<article class="public-ficha">
    <header class="public-header"><img src="${LOGO_PATH}" alt="${AGENCY_BRAND.name}"><div><span>${AGENCY_BRAND.name}</span><h1>${escapeHtml(ficha.title)}</h1></div></header>
    <div class="public-gallery${enhancementClass}">${galleryBadge}${photos || '<div class="gallery-placeholder">Fotos disponibles próximamente</div>'}</div>
    <section class="public-summary" aria-label="Resumen comercial">
      <div class="public-summary-tags">${summaryTags(ficha)}</div>
      <p class="public-price">${escapeHtml(textOrConsult(ficha.price))}</p>
      ${zone ? `<p class="public-location">${escapeHtml(zone)}</p>` : ''}
    </section>
    <section class="public-key-facts" aria-label="Características principales">${keyFacts(ficha)}</section>
    <a class="whatsapp-public" href="https://wa.me/${WHATSAPP_NUMBER}?text=${contactText}" target="_blank" rel="noopener">${phoneIcon}<span>Consultar disponibilidad por WhatsApp</span></a>
    ${hasValue(ficha.description) ? `<section class="public-description"><h2>Descripción</h2><p>${escapeHtml(ficha.description)}</p></section>` : ''}
    <details class="public-details"><summary>Ver todos los detalles</summary><section class="public-data">${details}</section></details>
    <small>${FICHA_LEGAL}</small>
  </article>`;
}

export function renderPublicMode(root: HTMLElement, ficha: FichaPublica | null): void {
  document.body.classList.add('public-mode');
  root.innerHTML = `<main class="public-page">${ficha ? publicFichaHtml(ficha) : '<div class="public-error"><h1>Ficha no disponible</h1><p>El enlace es inválido o está incompleto.</p></div>'}</main>`;
}
