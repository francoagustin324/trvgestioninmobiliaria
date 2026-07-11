globalThis.trvExtractProperty = async function trvExtractProperty() {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const clean = (value) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  const first = (...values) => values.map(clean).find(Boolean) || '';
  const meta = (key) => clean(document.querySelector(`meta[property="${key}"], meta[name="${key}"]`)?.content || '');
  const textOf = (...selectors) => {
    for (const selector of selectors) {
      const value = clean(document.querySelector(selector)?.textContent || '');
      if (value) return value;
    }
    return '';
  };
  const allText = clean(document.body?.innerText || '');

  for (let step = 1; step <= 6; step += 1) {
    window.scrollTo({ top: step * Math.max(window.innerHeight, 700), behavior: 'instant' });
    await sleep(250);
  }
  window.scrollTo({ top: 0, behavior: 'instant' });
  await sleep(500);

  const objects = [];
  const seenObjects = new WeakSet();
  const visit = (value, depth = 0) => {
    if (!value || typeof value !== 'object' || depth > 10 || seenObjects.has(value)) return;
    seenObjects.add(value);
    if (!Array.isArray(value)) objects.push(value);
    for (const child of Object.values(value)) visit(child, depth + 1);
  };

  const parsedJson = [];
  for (const script of document.scripts) {
    const raw = script.textContent?.trim() || '';
    if (!raw || raw.length > 2_500_000) continue;
    const isJson = script.type === 'application/ld+json' || script.id === '__NEXT_DATA__' || raw.startsWith('{') || raw.startsWith('[');
    if (!isJson) continue;
    try {
      const parsed = JSON.parse(raw);
      parsedJson.push(parsed);
      visit(parsed);
    } catch {
      // Algunos portales incluyen scripts que parecen JSON pero contienen JavaScript.
    }
  }

  const own = (record, keys) => {
    for (const [key, value] of Object.entries(record || {})) {
      if (keys.includes(key.toLowerCase()) && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')) return String(value);
    }
    return '';
  };
  const deep = (value, keys, depth = 0) => {
    if (!value || typeof value !== 'object' || depth > 8) return '';
    if (!Array.isArray(value)) {
      const direct = own(value, keys);
      if (direct) return direct;
    }
    for (const child of Object.values(value)) {
      const found = deep(child, keys, depth + 1);
      if (found) return found;
    }
    return '';
  };
  const score = (record) => {
    let points = 0;
    if (own(record, ['title', 'name', 'postingtitle', 'publicationtitle'])) points += 4;
    if (own(record, ['price', 'amount', 'formattedprice'])) points += 4;
    if ('pictures' in record || 'images' in record || 'photos' in record || 'gallery' in record) points += 4;
    if (own(record, ['description', 'plain_text', 'body'])) points += 2;
    if ('location' in record || 'address' in record) points += 2;
    if (own(record, ['bedrooms', 'bathrooms', 'totalarea', 'coveredarea'])) points += 2;
    return points;
  };
  const bestObject = objects.sort((a, b) => score(b) - score(a))[0] || {};
  const fromBest = (keys) => first(own(bestObject, keys), deep(bestObject, keys));
  const fromAnyJson = (keys) => {
    for (const value of parsedJson) {
      const found = deep(value, keys);
      if (found) return found;
    }
    return '';
  };
  const jsonValue = (keys) => first(fromBest(keys), fromAnyJson(keys));

  const imageCandidates = [];
  const pushImage = (value) => {
    if (typeof value !== 'string') return;
    const normalized = value.replace(/\\\//g, '/').replace(/&amp;/g, '&').trim();
    if (!normalized || normalized.startsWith('data:') || normalized.startsWith('blob:')) return;
    try {
      imageCandidates.push(new URL(normalized, location.href).toString());
    } catch {
      // URL inválida.
    }
  };
  const collectImages = (value, keyHint = '', depth = 0) => {
    if (depth > 10 || !value) return;
    if (typeof value === 'string') {
      if (/image|photo|picture|gallery|media|thumbnail/i.test(keyHint) || /^https?:\/\//i.test(value)) pushImage(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) collectImages(item, keyHint, depth + 1);
      return;
    }
    if (typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) collectImages(item, key, depth + 1);
    }
  };
  for (const value of parsedJson) collectImages(value);

  for (const image of document.querySelectorAll('img')) {
    pushImage(image.currentSrc);
    pushImage(image.src);
    pushImage(image.getAttribute('data-src') || '');
    pushImage(image.getAttribute('data-lazy-src') || '');
    const srcset = image.getAttribute('srcset') || image.getAttribute('data-srcset') || '';
    const last = srcset.split(',').map((item) => item.trim().split(/\s+/)[0]).filter(Boolean).at(-1);
    if (last) pushImage(last);
  }
  for (const source of document.querySelectorAll('source')) {
    const srcset = source.getAttribute('srcset') || source.getAttribute('data-srcset') || '';
    const last = srcset.split(',').map((item) => item.trim().split(/\s+/)[0]).filter(Boolean).at(-1);
    if (last) pushImage(last);
  }
  for (const element of document.querySelectorAll('[style*="background-image"]')) {
    const match = element.getAttribute('style')?.match(/url\(["']?([^"')]+)["']?\)/i);
    if (match?.[1]) pushImage(match[1]);
  }
  const html = document.documentElement.innerHTML.replace(/\\\//g, '/');
  for (const match of html.matchAll(/https?:\/\/[^"'<>\s]+?\.(?:jpe?g|png|webp)(?:\?[^"'<>\s]*)?/gi)) pushImage(match[0]);
  pushImage(meta('og:image'));

  const blockedImage = /(logo|avatar|icon|marker|map|sprite|banner|advert|favicon|tracking|pixel|placeholder|loading|brand|agency|inmobiliaria)/i;
  const photos = [];
  const seen = new Set();
  for (const candidate of imageCandidates) {
    if (blockedImage.test(candidate)) continue;
    const key = candidate.replace(/([?&])(width|height|w|h|quality|q)=\d+/gi, '$1').replace(/[?&]+$/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    photos.push(candidate);
    if (photos.length === 20) break;
  }

  const priceFromMeta = first(meta('product:price:amount'), meta('og:price:amount'));
  const currency = first(meta('product:price:currency'), meta('og:price:currency'), jsonValue(['pricecurrency', 'currency', 'currencyid', 'currency_id']));
  const rawPrice = first(
    jsonValue(['formattedprice', 'price', 'amount']),
    priceFromMeta,
    textOf('[data-qa="POSTING_CARD_PRICE"]', '[data-testid*="price"]', '.ui-pdp-price__second-line', '[class*="price"]')
  );
  const visiblePrice = allText.match(/(?:U\$S|US\$|USD|ARS|\$)\s*[\d.,]+/i)?.[0] || '';
  const price = first(
    rawPrice && currency && !rawPrice.toUpperCase().includes(currency.toUpperCase()) ? `${currency} ${rawPrice}` : rawPrice,
    visiblePrice
  );

  const title = first(
    jsonValue(['postingtitle', 'publicationtitle', 'title', 'name']),
    meta('og:title'),
    textOf('h1'),
    document.title
  ).slice(0, 240);
  const description = first(
    jsonValue(['description', 'plain_text', 'body', 'content']),
    textOf('[data-qa="POSTING_DESCRIPTION"]', '[data-testid*="description"]', '.ui-pdp-description__content', '[class*="description"]'),
    meta('og:description'),
    meta('description')
  ).slice(0, 8000);
  const zone = first(
    jsonValue(['neighborhood', 'barrio', 'locality', 'addresslocality', 'zone']),
    textOf('[data-qa="POSTING_LOCATION"]', '[data-testid*="location"]', '[class*="location"]')
  );
  const approxAddress = first(
    jsonValue(['streetaddress', 'address', 'direccion', 'fulladdress']),
    textOf('[data-qa="POSTING_ADDRESS"]', '[data-testid*="address"]')
  );

  const numberNear = (pattern) => allText.match(pattern)?.[1] || '';
  const propertyType = first(
    jsonValue(['propertytype', 'property_type', 'tipopropiedad']),
    /departamento|depto\b/i.test(allText) ? 'Departamento' : '',
    /casa\b/i.test(allText) ? 'Casa' : '',
    /d[uú]plex/i.test(allText) ? 'Dúplex' : '',
    /terreno|lote\b/i.test(allText) ? 'Terreno' : ''
  );
  const operation = first(
    jsonValue(['operation', 'operationtype', 'tipooperacion']),
    /\balquiler\b/i.test(allText) ? 'Alquiler' : '',
    /\bventa\b/i.test(allText) ? 'Venta' : ''
  );
  const bedrooms = first(jsonValue(['bedrooms', 'dormitorios']), numberNear(/(\d+)\s*(?:dormitorios?|habitaciones?)/i));
  const bathrooms = first(jsonValue(['bathrooms', 'baños', 'banos']), numberNear(/(\d+)\s*(?:baños?|banos?)/i));
  const coveredMeters = first(jsonValue(['coveredarea', 'coveredmeters', 'superficiecubierta']), numberNear(/([\d.,]+)\s*m(?:²|2)\s*(?:cubiertos?|cub\.?)/i));
  const totalMeters = first(jsonValue(['totalarea', 'totalmeters', 'superficietotal']), numberNear(/([\d.,]+)\s*m(?:²|2)\s*(?:totales?|total|superficie)/i));
  const expenses = first(jsonValue(['expenses', 'expensas']), allText.match(/expensas?\s*(?:aprox\.?|mensuales?)?\s*[:$]?\s*((?:ARS|USD|U\$S|\$)?\s*[\d.,]+)/i)?.[1] || '');
  const age = first(jsonValue(['age', 'antiquity', 'antiguedad', 'antigüedad']), allText.match(/(?:antigüedad|antiguedad)\s*[:\-]?\s*([\d]+\s*años?)/i)?.[1] || '');
  const garage = first(jsonValue(['garage', 'parking', 'cochera']), /(?:cochera|garage|garaje)/i.test(allText) ? 'Sí' : '');
  const deed = /(?:posee|con|cuenta con|tiene)\s+escritura/i.test(allText) ? 'Sí' : '';
  const creditReady = /no\s+apto\s+cr[eé]dito/i.test(allText) ? 'No' : /apto\s+cr[eé]dito/i.test(allText) ? 'Sí' : '';
  const amenities = [
    /pileta|piscina/i.test(allText) ? 'Pileta' : '',
    /\bSUM\b/i.test(allText) ? 'SUM' : '',
    /parrilla|asador/i.test(allText) ? 'Parrilla / asador' : '',
    /seguridad\s*24/i.test(allText) ? 'Seguridad 24 h' : '',
    /gimnasio/i.test(allText) ? 'Gimnasio' : '',
    /terraza/i.test(allText) ? 'Terraza' : ''
  ].filter(Boolean).join(', ');

  return {
    sourceUrl: location.href,
    data: {
      title,
      propertyType,
      operation,
      zone,
      approxAddress,
      price,
      expenses,
      bedrooms,
      bathrooms,
      garage,
      coveredMeters,
      totalMeters,
      age,
      amenities,
      description,
      deed,
      creditReady,
      photoUrls: photos
    }
  };
};
