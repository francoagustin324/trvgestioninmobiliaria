import { FICHA_LEGAL, Ficha, FichaPublica, LOGO_PATH, WHATSAPP_NUMBER } from './models.js';
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
  };
}

export function publicLink(ficha: Ficha): string {
  return `${location.origin}${location.pathname}#public=${encodePublicFicha(publicPayload(ficha))}`;
}

export function whatsappText(ficha: Ficha): string {
  const features = [ficha.propertyType, ficha.bedrooms && `${ficha.bedrooms} dorm.`, ficha.bathrooms && `${ficha.bathrooms} baños`, ficha.coveredMeters && `${ficha.coveredMeters} m² cubiertos`, ficha.totalMeters && `${ficha.totalMeters} m² totales`].filter(Boolean).join(' · ');
  return ['Te comparto una propiedad de TRV Gestión Inmobiliaria:', ficha.title, ficha.zone && `Zona: ${ficha.zone}`, ficha.operation && `Operación: ${ficha.operation}`, ficha.price && `Precio: ${ficha.price}`, features && `Características: ${features}`, `Ver ficha: ${publicLink(ficha)}`, 'Decime si querés que revisemos disponibilidad y condiciones.'].filter(Boolean).join('\n');
}

function rows(ficha: FichaPublica): string {
  const data: Array<[string, string]> = [];
  const push = (label: string, value: unknown): void => { if (hasValue(value)) data.push([label, String(value)]); };
  push('Tipo', ficha.propertyType); push('Operación', ficha.operation); push('Zona', ficha.zone); push('Dirección aproximada', ficha.approxAddress);
  data.push(['Precio', hasValue(ficha.price) ? String(ficha.price) : 'Consultar']);
  data.push(['Expensas', hasValue(ficha.expenses) ? String(ficha.expenses) : 'Consultar']);
  push('Dormitorios', ficha.bedrooms); push('Baños', ficha.bathrooms);
  if (hasValue(ficha.garage) && ficha.garage !== 'No') push('Cochera', ficha.garage);
  push('Metros cubiertos', ficha.coveredMeters); push('Metros totales', ficha.totalMeters); push('Antigüedad', ficha.age); push('Estado', ficha.status); push('Amenities', ficha.amenities);
  data.push(['Escritura', hasValue(ficha.deed) ? String(ficha.deed) : 'Consultar']);
  data.push(['Apto crédito', hasValue(ficha.creditReady) ? String(ficha.creditReady) : 'Consultar']);
  data.push(['Forma de pago', hasValue(ficha.paymentMethod) ? String(ficha.paymentMethod) : 'Consultar']);
  return data.map(([label, value]) => `<div class="public-data-item"><b>${escapeHtml(label)}</b><span>${escapeHtml(value)}</span></div>`).join('');
}

export function publicFichaHtml(ficha: FichaPublica): string {
  const photos = ficha.photoUrls.map(safePhotoUrl).filter((url): url is string => Boolean(url)).slice(0, 8).map((url, index) => `<img src="${escapeHtml(url)}" alt="Foto ${index + 1} de ${escapeHtml(ficha.title)}" loading="lazy">`).join('');
  const contactText = encodeURIComponent(`Hola, consulto por ${ficha.title}. Quisiera confirmar disponibilidad y condiciones.`);
  return `<article class="public-ficha"><header class="public-header"><img src="${LOGO_PATH}" alt="TRV Gestión Inmobiliaria"><div><span>TRV Gestión Inmobiliaria</span><h1>${escapeHtml(ficha.title)}</h1></div></header><div class="public-gallery">${photos || '<div class="gallery-placeholder">Fotos disponibles próximamente</div>'}</div><section class="public-data">${rows(ficha)}</section>${hasValue(ficha.description) ? `<p class="public-description">${escapeHtml(ficha.description)}</p>` : ''}<a class="whatsapp-public" href="https://wa.me/${WHATSAPP_NUMBER}?text=${contactText}" target="_blank" rel="noopener">Consultar por WhatsApp</a><small>${FICHA_LEGAL}</small></article>`;
}

export function renderPublicMode(root: HTMLElement, ficha: FichaPublica | null): void {
  document.body.classList.add('public-mode');
  root.innerHTML = `<main class="public-page">${ficha ? publicFichaHtml(ficha) : '<div class="public-error"><h1>Ficha no disponible</h1><p>El enlace es inválido o está incompleto.</p></div>'}</main>`;
}
