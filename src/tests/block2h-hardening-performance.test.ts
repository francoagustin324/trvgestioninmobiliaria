import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { evaluateRelevantMatchAlertConditions } from '../commercial-alert-engine.js';
import { invalidatePropertyMatchingCaches, matchPropertiesForClient, matchRelevantPropertiesForClient, relevantPropertyCandidatesForClient } from '../property-matching.js';
import type { Client, Property } from '../models.js';

const ZONES = Array.from({ length: 100 }, (_, index) => `Zona ${String(index + 1).padStart(3, '0')}`);
const TYPES = ['Departamento', 'Casa', 'Terreno', 'Comercial'] as const;

function client(id: number): Client {
  const zone = ZONES[(id * 17) % ZONES.length]!;
  const propertyType = TYPES[id % TYPES.length]!;
  const bedrooms = propertyType === 'Terreno' || propertyType === 'Comercial' ? undefined : 1 + (id % 4);
  return {
    id,
    uid: `10000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
    revision: 1,
    name: `Cliente ${id}`,
    phone: `549351${String(id).padStart(7, '0')}`,
    interest: `${propertyType} ${bedrooms ?? ''} ${zone} preferencia-${id}`,
    status: 'Lead',
    temperature: id % 3 === 0 ? 'Caliente' : 'Tibio',
    pipeline: 'Calificado',
    budget: `USD ${110000 + (id % 75) * 2000}`,
    currency: 'USD',
    paymentMethod: id % 2 === 0 ? 'Contado' : 'Financiación',
    zones: zone,
    propertyType,
    operation: 'Compra',
    ...(bedrooms ? { bedrooms } : {}),
    canMoveForward: id % 5 === 0 ? 'Sí' : 'No',
    preferences: `preferencia-${id}`,
    assignedToId: 1,
    createdById: 1,
  };
}

function property(id: number): Property {
  const zone = ZONES[(id * 19) % ZONES.length]!;
  const type = TYPES[id % TYPES.length]!;
  const bedrooms = type === 'Terreno' || type === 'Comercial' ? undefined : 1 + (id % 4);
  return {
    id,
    uid: `20000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
    revision: 1,
    title: `${type} ${id}`,
    address: `${zone}, Córdoba`,
    type,
    operation: 'Venta',
    price: 85000 + id * 100,
    owner: 'Propietario',
    status: 'Activa',
    ...(bedrooms ? { bedrooms } : {}),
    paymentMethod: id % 2 === 0 ? 'Contado' : 'Financiación',
    assignedToId: 1,
    createdById: 1,
  };
}

test('Block 2H performance gate: 1000 clientes variados x 1000 propiedades variadas no vuelve al cruce bloqueante', () => {
  const clients=Array.from({length:1000},(_,i)=>client(i+1));
  const properties=Array.from({length:1000},(_,i)=>property(i+1));
  assert.ok(new Set(clients.map((item) => item.interest)).size > 900, 'el gate debe usar perfiles comerciales variados');
  assert.ok(new Set(properties.map((item) => `${item.type}|${item.address}|${item.price}`)).size > 900, 'el gate debe usar inventario variado');
  const candidateCounts = clients.map((item) => relevantPropertyCandidatesForClient(item, properties).length);
  assert.ok(Math.max(...candidateCounts) <= 36, 'ningún perfil puede volver a evaluar las 1000 propiedades completas; máximo 36 candidatos');
  const started=performance.now();
  const result=evaluateRelevantMatchAlertConditions({
    organizationId:'11111111-1111-4111-8111-111111111111',
    clients,
    properties,
    activityLog:[],
    actor:{id:1,role:'Dueño'},
  });
  const elapsed=performance.now()-started;
  console.log(`BLOCK2H_MATCH_AFTER_MS=${elapsed.toFixed(2)}`);
  assert.ok(result.length > 0, 'el dataset variado debe conservar oportunidades relevantes');
  assert.ok(
    elapsed < 1500,
    `matching 1000x1000 tardó ${elapsed.toFixed(2)}ms; el gate razonable es <1500ms para impedir regresiones a segundos`,
  );
});


test('Block 2H matching acotado conserva el mejor match exhaustivo en casos representativos', () => {
  const properties = Array.from({ length: 200 }, (_, index) => property(index + 1));
  for (const id of [7, 41, 88, 133, 197]) {
    const current = client(id);
    const exhaustive = matchPropertiesForClient(current, properties).find((match) => match.level === 'Alta');
    const bounded = matchRelevantPropertiesForClient(current, properties).find((match) => match.level === 'Alta');
    assert.equal(bounded?.property.id, exhaustive?.property.id, `perfil ${id}: el candidato acotado debe conservar el mejor match alto`);
    assert.equal(bounded?.score, exhaustive?.score, `perfil ${id}: el score del mejor match debe ser idéntico`);
  }
});


test('Block 2H regression: inventario desordenado sin typeKey no puede ocultar una oportunidad Alta', () => {
  const buyer: Client = {
    id: 9001,
    uid: '10000000-0000-4000-8000-000000009001',
    revision: 1,
    name: 'Cliente adversarial',
    phone: '5493515559001',
    interest: 'Busca una oportunidad con amenities',
    status: 'Lead',
    temperature: 'Caliente',
    pipeline: 'Calificado',
    budget: 'USD 100.000',
    currency: 'USD',
    paymentMethod: 'Contado',
    propertyType: 'PH especial',
    operation: 'Compra',
    bedrooms: 2,
    canMoveForward: 'Sí',
    features: 'pileta balcón terraza cochera',
    assignedToId: 1,
    createdById: 1,
  };

  const affordableDistractors = Array.from({ length: 500 }, (_, index): Property => ({
    id: index + 1,
    uid: `30000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    revision: 1,
    title: `PH genérico ${index + 1}`,
    address: 'Zona genérica, Córdoba',
    type: 'PH',
    operation: 'Venta',
    price: 80000 + index,
    owner: 'Propietario',
    status: 'Activa',
    bedrooms: 1,
    paymentMethod: 'Financiación',
    assignedToId: 1,
    createdById: 1,
  }));

  const expensiveDistractors = Array.from({ length: 499 }, (_, index): Property => ({
    id: 501 + index,
    uid: `40000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    revision: 1,
    title: `PH fuera de presupuesto ${index + 1}`,
    address: 'Otra zona, Córdoba',
    type: 'PH',
    operation: 'Venta',
    price: 180000 + index,
    owner: 'Propietario',
    status: 'Activa',
    bedrooms: 2,
    paymentMethod: 'Contado',
    assignedToId: 1,
    createdById: 1,
  }));

  const best: Property = {
    id: 1000,
    uid: '50000000-0000-4000-8000-000000001000',
    revision: 1,
    title: 'PH oportunidad completa',
    address: 'Zona objetivo, Córdoba',
    type: 'PH',
    operation: 'Venta',
    price: 95000,
    owner: 'Propietario',
    status: 'Activa',
    bedrooms: 2,
    paymentMethod: 'Contado',
    features: 'pileta balcón terraza cochera',
    assignedToId: 1,
    createdById: 1,
  };

  const properties = [...affordableDistractors, ...expensiveDistractors, best];
  assert.equal(properties.length, 1000);
  assert.equal(properties.at(-1)?.id, best.id);

  const permutations = [
    properties,
    [...properties].reverse(),
    [...properties.slice(317), ...properties.slice(0, 317)],
  ];

  for (const [index, inventory] of permutations.entries()) {
    const exhaustive = matchPropertiesForClient(buyer, inventory).find((match) => match.level === 'Alta');
    const bounded = matchRelevantPropertiesForClient(buyer, inventory).find((match) => match.level === 'Alta');

    assert.equal(exhaustive?.property.id, best.id, `permutación ${index}: exhaustive debe encontrar la oportunidad Alta`);
    assert.equal(bounded?.property.id, best.id, `permutación ${index}: bounded debe conservar la oportunidad Alta`);
    assert.equal(bounded?.score, exhaustive?.score, `permutación ${index}: el score del mejor match debe coincidir`);
  }

  const edgeBuyer: Client = {
    ...buyer,
    id: 9002,
    uid: '10000000-0000-4000-8000-000000009002',
    name: 'Cliente borde de presupuesto',
    propertyType: 'Departamento',
    zones: 'Docta',
  };
  const edgeTarget: Property = {
    ...best,
    id: 2000,
    uid: '50000000-0000-4000-8000-000000002000',
    title: 'Departamento borde exacto',
    address: 'Docta, Córdoba',
    type: 'Departamento',
    price: 110000,
  };
  const edgeInventory = Array.from({ length: 999 }, (_, index): Property => ({
    ...property(index + 3000),
    type: 'Departamento',
    address: 'Zona descartable, Córdoba',
    price: 150000 + index,
    bedrooms: 2,
  }));
  edgeInventory.splice(777, 0, edgeTarget);

  const edgeExhaustive = matchPropertiesForClient(edgeBuyer, edgeInventory).find((match) => match.level === 'Alta');
  const edgeBounded = matchRelevantPropertiesForClient(edgeBuyer, edgeInventory).find((match) => match.level === 'Alta');
  assert.equal(edgeInventory.length, 1000);
  assert.equal(edgeExhaustive?.property.id, edgeTarget.id, 'el borde +10% debe seguir siendo una oportunidad válida');
  assert.equal(edgeBounded?.property.id, edgeTarget.id, 'bounded debe conservar el match ubicado lejos en el inventario');
});

test('Block 2H Work counterexample: bounded conserva score máximo Alta en precio y orden adversariales', () => {
  const buyer: Client = {
    id: 9500,
    uid: '10000000-0000-4000-8000-000000009500',
    revision: 1,
    name: 'Cliente Work counterexample',
    phone: '5493515559500',
    interest: 'Busca pileta patio cochera',
    status: 'Lead',
    temperature: 'Caliente',
    pipeline: 'Calificado',
    budget: 'USD 100.000',
    currency: 'USD',
    paymentMethod: 'Contado',
    propertyType: 'PH especial',
    operation: 'Compra',
    bedrooms: 2,
    canMoveForward: 'Sí',
    features: 'pileta patio cochera',
    assignedToId: 1,
    createdById: 1,
  };
  const distractors = Array.from({ length: 999 }, (_, index): Property => ({
    id: 6000 + index,
    uid: `61000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    revision: 1,
    title: `PH 2 dormitorios genérico ${index + 1}`,
    address: 'Zona genérica, Córdoba',
    type: 'PH',
    operation: 'Venta',
    price: 50000 + index * 50,
    owner: 'Propietario',
    status: 'Activa',
    bedrooms: 2,
    paymentMethod: 'Financiación',
    assignedToId: 1,
    createdById: 1,
  }));
  const target = (price: number): Property => ({
    id: 5000,
    uid: '62000000-0000-4000-8000-000000005000',
    revision: 1,
    title: 'PH superior Work',
    address: 'Zona genérica, Córdoba',
    type: 'PH',
    operation: 'Venta',
    price,
    owner: 'Propietario',
    status: 'Activa',
    bedrooms: 2,
    paymentMethod: 'Contado',
    features: 'pileta patio cochera',
    assignedToId: 1,
    createdById: 1,
  });
  const place = (price: number, position: 'start' | 'middle' | 'end'): Property[] => {
    const inventory = distractors.map((item) => ({ ...item }));
    const offset = position === 'start' ? 0 : position === 'middle' ? Math.floor(inventory.length / 2) : inventory.length;
    inventory.splice(offset, 0, target(price));
    return inventory;
  };
  const middle = place(80000, 'middle');
  const mixed = Array.from({ length: middle.length }, (_, index) => middle[(index * 37) % middle.length]!);
  const cases: Array<[string, Property[]]> = [
    ['precio bajo / inicio', place(60000, 'start')],
    ['precio medio / medio', middle],
    ['precio alto / final', place(99900, 'end')],
    ['ascendente', [...middle].sort((a, b) => a.price - b.price || a.id - b.id)],
    ['descendente', [...middle].sort((a, b) => b.price - a.price || b.id - a.id)],
    ['mezclado determinístico', mixed],
  ];
  for (const [label, inventory] of cases) {
    invalidatePropertyMatchingCaches(inventory);
    const exhaustive = matchPropertiesForClient(buyer, inventory);
    const bounded = matchRelevantPropertiesForClient(buyer, inventory);
    assert.equal(exhaustive[0]?.score, 75, `${label}: exhaustive reproduce score 75 Alta`);
    assert.equal(exhaustive[0]?.level, 'Alta', `${label}: exhaustive debe ser Alta`);
    assert.equal(bounded[0]?.score, exhaustive[0]?.score, `${label}: bounded debe conservar el score máximo`);
    assert.equal(bounded[0]?.level, 'Alta', `${label}: bounded no puede degradar Alta a Buena`);
    assert.ok(relevantPropertyCandidatesForClient(buyer, inventory).length <= 36, `${label}: límite de candidatos debe seguir en 36`);
  }

  const matchAlerts = evaluateRelevantMatchAlertConditions({
    organizationId: '11111111-1111-4111-8111-111111111111',
    clients: [buyer],
    properties: middle,
    activityLog: [],
    actor: { id: 1, role: 'Dueño' },
  });
  const opportunity = matchAlerts.find((condition) => condition.type === 'NEW_RELEVANT_MATCH');
  assert.ok(opportunity, 'NEW_RELEVANT_MATCH debe conservar la oportunidad Alta del contraejemplo Work');
  assert.equal(opportunity?.propertyId, 5000);
  assert.match(opportunity?.reason ?? '', /^75% compatible/);
});

test('Block 2H cache invalidation dinámica evita resultados stale por el camino canónico', async () => {
  if (!('localStorage' in globalThis)) {
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        get length() { return values.size; },
        clear() { values.clear(); },
        getItem(key: string) { return values.get(key) ?? null; },
        key(index: number) { return [...values.keys()][index] ?? null; },
        removeItem(key: string) { values.delete(key); },
        setItem(key: string, value: string) { values.set(String(key), String(value)); },
      },
    });
  }
  const store = await import('../store.js');
  const buyer: Client = {
    ...client(12),
    id: 9600,
    propertyType: 'Departamento',
    zones: 'Zona Cache',
    bedrooms: 2,
    budget: 'USD 100.000',
    paymentMethod: 'Contado',
    features: 'pileta',
  };
  const first: Property = {
    ...property(9601),
    id: 9601,
    uid: '63000000-0000-4000-8000-000000009601',
    title: 'Cache original',
    address: 'Zona Cache, Córdoba',
    type: 'Departamento',
    price: 90000,
    bedrooms: 2,
    paymentMethod: 'Contado',
    features: 'pileta',
    status: 'Activa',
  };
  const inventory: Property[] = [first];
  store.replacePropertyCollection(inventory);

  const exhaustiveBefore = matchPropertiesForClient(buyer, store.state.crm.properties)[0];
  const boundedBefore = matchRelevantPropertiesForClient(buyer, store.state.crm.properties)[0];
  assert.equal(exhaustiveBefore?.property.id, 9601);
  assert.equal(boundedBefore?.property.id, 9601);

  first.price = 150000;
  first.revision = Number(first.revision ?? 0) + 1;
  store.replacePropertyCollection(inventory);
  const exhaustiveAfterPrice = matchPropertiesForClient(buyer, store.state.crm.properties).find((match) => match.property.id === 9601);
  const boundedAfterPrice = matchRelevantPropertiesForClient(buyer, store.state.crm.properties).find((match) => match.property.id === 9601);
  assert.ok(exhaustiveAfterPrice, 'exhaustive puede conservar el match por señales no-precio');
  assert.ok(boundedAfterPrice, 'bounded puede conservar el match por señales no-precio');
  assert.ok(
    (exhaustiveAfterPrice?.score ?? 0) < (exhaustiveBefore?.score ?? 0),
    'el camino canónico debe invalidar y reflejar el precio/revision mutados',
  );
  assert.equal(boundedAfterPrice?.score, exhaustiveAfterPrice?.score);

  const added: Property = {
    ...first,
    id: 9602,
    uid: '63000000-0000-4000-8000-000000009602',
    title: 'Cache agregado',
    price: 85000,
    revision: 1,
    status: 'Activa',
  };
  inventory.push(added);
  store.replacePropertyCollection(inventory);
  assert.equal(matchPropertiesForClient(buyer, store.state.crm.properties)[0]?.property.id, 9602, 'exhaustive debe ver alta nueva');
  assert.equal(matchRelevantPropertiesForClient(buyer, store.state.crm.properties)[0]?.property.id, 9602, 'bounded debe ver alta nueva');

  added.status = 'Pausada';
  added.revision = 2;
  store.replacePropertyCollection(inventory);
  assert.equal(matchPropertiesForClient(buyer, store.state.crm.properties).some((match) => match.property.id === 9602), false, 'exhaustive debe quitar propiedad pausada');
  assert.equal(matchRelevantPropertiesForClient(buyer, store.state.crm.properties).some((match) => match.property.id === 9602), false, 'bounded debe quitar propiedad pausada');

  inventory.splice(inventory.indexOf(added), 1);
  store.replacePropertyCollection(inventory);
  assert.equal(matchPropertiesForClient(buyer, store.state.crm.properties).some((match) => match.property.id === 9602), false, 'exhaustive debe conservar eliminación');
  assert.equal(matchRelevantPropertiesForClient(buyer, store.state.crm.properties).some((match) => match.property.id === 9602), false, 'bounded debe conservar eliminación');
});

test('Block 2H zona sin typeKey usa índice directo y no full eligible scan por lead', () => {
  const source = readFileSync('src/property-matching.ts', 'utf8');
  const candidateStart = source.indexOf('export function relevantPropertyCandidatesForClient');
  const candidateEnd = source.indexOf('export function matchRelevantPropertiesForClient', candidateStart);
  assert.ok(candidateStart >= 0 && candidateEnd > candidateStart);
  const candidateBlock = source.slice(candidateStart, candidateEnd);
  assert.match(source, /byZone: Map<string, Property\[\]>/, 'el índice debe materializar zona sin depender de tipo');
  assert.match(source, /zones: \[\.\.\.zones\]\.sort\(\)/, 'la inferencia debe usar catálogo de zonas preconstruido');
  assert.match(candidateBlock, /index\.byZone\.get\(zone\)/, 'sin typeKey debe resolver el bucket de zona directamente');
  assert.doesNotMatch(candidateBlock, /index\.eligible\.filter\(/, 'resolver una zona no puede volver a escanear eligible por lead');

  const noTypeBuyer: Client = {
    ...client(20),
    id: 9700,
    propertyType: 'PH especial',
    zones: 'Zona 050',
    bedrooms: 2,
  };
  const inventory = Array.from({ length: 1000 }, (_, index) => property(index + 1));
  const candidates = relevantPropertyCandidatesForClient(noTypeBuyer, inventory);
  assert.ok(candidates.length <= 36);
  console.log(`BLOCK2H_ZONE_CANDIDATES=${candidates.length}`);
});

test('Block 2H Leads render usa bounded cerrado, exhaustive abierto y property saves invalidan caches por identidad', () => {
  const leadsSource = readFileSync('src/mvp-leads-ui.ts', 'utf8');
  const propertiesSource = readFileSync('src/mvp-properties-ui.ts', 'utf8');
  const storeSource = readFileSync('src/store.ts', 'utf8');
  const mainSource = readFileSync('src/mvp-main.ts', 'utf8');

  assert.match(
    leadsSource,
    /const expanded = expandedClientId === client\.id \|\| openedReadOnly;/,
    'el render debe resolver explícitamente si la ficha está abierta',
  );
  assert.match(
    leadsSource,
    /exhaustive[\s\S]*\? matchPropertiesForClient\(client, properties\)[\s\S]*: matchRelevantPropertiesForClient\(client, properties\)/,
    'la ficha abierta debe preservar exhaustive y la tarjeta cerrada debe usar bounded',
  );
  assert.match(
    leadsSource,
    /matches: matchesForLead\(client, properties, expanded\),/,
    'el render productivo debe seleccionar bounded/exhaustive según apertura',
  );

  assert.doesNotMatch(
    propertiesSource,
    /state\.crm\.properties\[[^\]]+\]\s*=/,
    'editar una propiedad no puede conservar la identidad del array cacheado',
  );
  assert.doesNotMatch(
    propertiesSource,
    /state\.crm\.properties\.push\(/,
    'crear una propiedad no puede mutar in-place el array cacheado',
  );
  assert.match(propertiesSource, /replacePropertyCollection\(state\.crm\.properties\.map\(/);
  assert.match(propertiesSource, /replacePropertyCollection\(\[\.\.\.state\.crm\.properties, property as Property\]\)/);
  assert.match(storeSource, /export function replacePropertyCollection/);
  assert.match(storeSource, /invalidatePropertyMatchingCaches\(properties\)/);
  assert.match(mainSource, /replacePropertyCollection\(state\.crm\.properties\.filter/);

  const properties = Array.from({ length: 1000 }, (_, index) => property(index + 1));
  const clients = Array.from({ length: 1000 }, (_, index) => client(index + 1));

  const renderStarted = performance.now();
  const collapsedRows = clients.map((current) => matchRelevantPropertiesForClient(current, properties).slice(0, 3));
  const renderElapsed = performance.now() - renderStarted;
  console.log(`BLOCK2H_LEADS_RENDER_AFTER_MS=${renderElapsed.toFixed(2)}`);
  assert.ok(collapsedRows.some((matches) => matches.length > 0));
  assert.ok(collapsedRows.every((matches) => matches.length <= 3));
  assert.ok(
    renderElapsed < 2000,
    `render operativo de 1000 leads x 1000 propiedades tardó ${renderElapsed.toFixed(2)}ms; no debe volver al cruce exhaustivo de segundos altos`,
  );

  const openedStarted = performance.now();
  matchPropertiesForClient(client(7), properties);
  const openedElapsed = performance.now() - openedStarted;
  console.log(`BLOCK2H_LEADS_ONE_OPEN_AFTER_MS=${openedElapsed.toFixed(2)}`);
  assert.ok(
    openedElapsed < 500,
    `una única ficha abierta sobre 1000 propiedades tardó ${openedElapsed.toFixed(2)}ms; exhaustive debe quedar acotado al lead abierto`,
  );
});
