const STORAGE_KEY = 'trv-crm-basico';

const initialData = {
  clients: [
    { id: 1, name: 'Lucía Martín', phone: '600 123 456', email: 'lucia@email.com', interest: 'Piso de 2 habitaciones en zona centro', status: 'Lead', temperature: 'Caliente', pipeline: 'Visita posible', lastContact: '2026-07-06', nextFollowUp: '2026-07-09', budget: '210000', paymentMethod: 'Hipoteca aprobada', purchaseTimeframe: '0-3 meses', purpose: 'Vivir', knowsArea: 'Sí', canMoveForward: 'Sí', objections: 'Quiere buena luz natural', notes: 'Vio dos pisos y preguntó por documentación.' },
    { id: 2, name: 'Andrés Vega', phone: '611 222 333', email: 'andres@email.com', interest: 'Comprar casa con jardín en zona familiar', status: 'Cliente', temperature: 'Tibio', pipeline: 'Seguimiento', lastContact: '2026-06-28', nextFollowUp: '2026-07-08', budget: '330000', paymentMethod: 'Venta previa', purchaseTimeframe: '3-6 meses', purpose: 'Vivir', knowsArea: 'No', canMoveForward: 'No', objections: 'Debe vender antes de comprar', notes: 'Pedir actualización de su operación actual.' },
    { id: 3, name: 'Grupo Norte', phone: '622 444 555', email: 'norte@email.com', interest: 'Local comercial para inversión', status: 'Lead', temperature: 'Frío', pipeline: 'Nuevo', lastContact: '2026-05-20', nextFollowUp: '2026-06-20', budget: '', paymentMethod: '', purchaseTimeframe: '', purpose: 'Invertir', knowsArea: 'No', canMoveForward: 'No', objections: 'No definió rentabilidad objetivo', notes: 'Reactivar con opciones de locales alquilados.' },
  ],
  properties: [
    { id: 1, title: 'Piso centro reformado', address: 'Calle Mayor 14', type: 'Piso', operation: 'Venta', price: 210000, owner: 'Andrés Vega', status: 'Disponible' },
    { id: 2, title: 'Local en avenida principal', address: 'Avenida Norte 8', type: 'Local', operation: 'Alquiler', price: 1200, owner: 'Inversiones Alba', status: 'Captación' },
  ],
  reminders: [
    { id: 1, date: '2026-07-13', title: 'Llamar a Lucía', related: 'Piso centro reformado', priority: 'Alta' },
    { id: 2, date: '2026-07-15', title: 'Preparar valoración', related: 'Andrés Vega', priority: 'Media' },
  ],
};

const app = document.querySelector('#root');
let activeTab = 'alertas';
let openForm = null;
const expandedClients = new Set();

const tabs = [
  { id: 'alertas', label: 'Alertas' },
  { id: 'clientes', label: 'Clientes' },
  { id: 'propiedades', label: 'Propiedades' },
  { id: 'recordatorios', label: 'Recordatorios' },
];

function todayIso() { return new Date().toISOString().slice(0, 10); }
function hasValue(value) { return Boolean(String(value || '').trim()); }
function isPast(date) { return hasValue(date) && date < todayIso(); }
function daysSince(date) { return hasValue(date) ? Math.max(0, Math.floor((new Date(todayIso()) - new Date(date)) / 86400000)) : 999; }
function nextId(items) { return Math.max(0, ...items.map((item) => Number(item.id) || 0)) + 1; }
function money(value, operation) { return hasValue(value) ? `${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(Number(value))}${operation === 'Alquiler' ? '/mes' : ''}` : 'Pendiente'; }
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
}

function loadData() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') || initialData;
    return {
      clients: Array.isArray(parsed.clients) ? parsed.clients : initialData.clients,
      properties: Array.isArray(parsed.properties) ? parsed.properties : initialData.properties,
      reminders: Array.isArray(parsed.reminders) ? parsed.reminders : initialData.reminders,
    };
  } catch {
    return initialData;
  }
}

let crm = loadData();
function saveData() { localStorage.setItem(STORAGE_KEY, JSON.stringify(crm)); }

function normalizeClient(client) {
  return {
    temperature: 'Tibio',
    pipeline: client.status || 'Nuevo',
    lastContact: '',
    nextFollowUp: '',
    budget: '',
    paymentMethod: '',
    purchaseTimeframe: '',
    purpose: 'Vivir',
    knowsArea: 'No',
    canMoveForward: 'No',
    objections: '',
    notes: '',
    ...client,
  };
}

function trafficLight(rawClient) {
  const client = normalizeClient(rawClient);
  const ready = client.temperature === 'Caliente' && hasValue(client.budget) && hasValue(client.paymentMethod) && hasValue(client.purchaseTimeframe) && client.canMoveForward === 'Sí';
  const blocked = client.temperature === 'Frío' || !hasValue(client.budget) || !hasValue(client.purchaseTimeframe) || client.canMoveForward === 'No';
  if (ready) return { color: 'verde', label: 'Verde', detail: 'Oportunidad clara' };
  if (blocked) return { color: 'rojo', label: 'Rojo', detail: 'Requiere calificación' };
  return { color: 'amarillo', label: 'Amarillo', detail: 'Pendiente de seguimiento' };
}

function clientSummary(rawClient) {
  const client = normalizeClient(rawClient);
  const light = trafficLight(client);
  const nextStep = light.color === 'verde' && client.pipeline === 'Visita posible'
    ? 'Apto para visita. Revisar y aprobar.'
    : light.color === 'rojo'
      ? 'Completar datos y reactivar.'
      : 'Hacer seguimiento y cerrar datos faltantes.';

  return {
    search: client.interest || 'Sin búsqueda definida',
    budget: client.budget || 'Sin presupuesto definido',
    objections: client.objections || client.notes || 'Sin objeciones cargadas',
    nextStep,
  };
}

function clientAlerts(rawClient) {
  const client = normalizeClient(rawClient);
  const alerts = [];
  if (client.temperature === 'Caliente' && daysSince(client.lastContact) >= 3) alerts.push({ type: 'urgent', title: 'Cliente caliente sin contactar', detail: `${client.name} lleva ${daysSince(client.lastContact)} días sin contacto.` });
  if (isPast(client.nextFollowUp)) alerts.push({ type: 'urgent', title: 'Seguimiento vencido', detail: `${client.name} tenía seguimiento el ${client.nextFollowUp}.` });
  if (client.status === 'Lead' && daysSince(client.lastContact) >= 5) alerts.push({ type: 'pending', title: 'Lead sin responder', detail: `${client.name} necesita una nueva respuesta comercial.` });
  if (client.pipeline === 'Visita posible') alerts.push({ type: 'opportunity', title: 'Posible visita', detail: 'Este cliente parece apto para visita. Revisar y aprobar.' });
  if (client.pipeline === 'Negociación' && trafficLight(client).color === 'verde') alerts.push({ type: 'opportunity', title: 'Posible reserva', detail: `${client.name} está en negociación y puede avanzar.` });
  if (daysSince(client.lastContact) >= 30) alerts.push({ type: 'pending', title: 'Cliente viejo para reactivar', detail: `${client.name} lleva ${daysSince(client.lastContact)} días sin contacto.` });
  return alerts.map((alert) => ({ ...alert, client }));
}

function allAlerts() { return crm.clients.flatMap(clientAlerts); }
function formValues(form) { return Object.fromEntries(new FormData(form).entries()); }
function removeItem(collection, id) {
  crm[collection] = crm[collection].filter((item) => Number(item.id) !== Number(id));
  saveData();
  render();
}

function statCards(alerts) {
  const urgent = alerts.filter((alert) => alert.type === 'urgent').length;
  const visits = alerts.filter((alert) => alert.title === 'Posible visita').length;
  const overdue = alerts.filter((alert) => alert.title === 'Seguimiento vencido').length;
  return `
    <section class="stats-grid" aria-label="Resumen del CRM">
      <button class="stat-card urgent" data-tab="alertas"><span>Urgentes</span><strong>${urgent}</strong><small>Requieren intervención</small></button>
      <button class="stat-card opportunity" data-tab="alertas"><span>Visitas</span><strong>${visits}</strong><small>Revisar y aprobar</small></button>
      <button class="stat-card pending" data-tab="alertas"><span>Vencidos</span><strong>${overdue}</strong><small>Seguimientos</small></button>
    </section>`;
}

function tabsHtml() {
  return `<div class="tab-bar" role="tablist">${tabs.map((tab) => `<button class="tab-button ${activeTab === tab.id ? 'active' : ''}" data-tab="${tab.id}" role="tab">${tab.label}</button>`).join('')}</div>`;
}

function alertCard(alert) {
  const summary = clientSummary(alert.client);
  return `<article class="alert-card ${alert.type}"><div><span>${escapeHtml(alert.title)}</span><h3>${escapeHtml(alert.client.name)}</h3><p>${escapeHtml(alert.detail)}</p></div><small>${escapeHtml(summary.nextStep)}</small></article>`;
}

function renderAlerts() {
  const alerts = allAlerts();
  return `<section class="panel module-panel"><div class="panel-heading"><div><span class="eyebrow">Alertas comerciales</span><h2>Prioridades</h2></div></div><div class="alert-list">${alerts.length ? alerts.map(alertCard).join('') : '<p class="empty-state">No hay alertas activas.</p>'}</div></section>`;
}

function clientForm() {
  if (openForm !== 'client') return '';
  return `
    <form class="crm-form client-form" id="client-form">
      <input name="name" placeholder="Nombre" required>
      <input name="phone" placeholder="Teléfono" required>
      <input name="email" type="email" placeholder="Email">
      <input name="interest" placeholder="Qué busca / zona" required>
      <select name="status"><option>Lead</option><option>Cliente</option><option>Seguimiento</option><option>Cerrado</option></select>
      <select name="temperature"><option>Caliente</option><option>Tibio</option><option>Frío</option></select>
      <select name="pipeline"><option>Nuevo</option><option>Calificado</option><option>Seguimiento</option><option>Visita posible</option><option>Negociación</option><option>Cerrado</option><option>Perdido</option></select>
      <input name="lastContact" type="date" aria-label="Último contacto">
      <input name="nextFollowUp" type="date" aria-label="Próximo seguimiento">
      <input name="budget" placeholder="Presupuesto">
      <input name="paymentMethod" placeholder="Forma de pago">
      <input name="purchaseTimeframe" placeholder="Plazo de compra">
      <select name="purpose"><option>Vivir</option><option>Invertir</option></select>
      <select name="knowsArea"><option>Sí</option><option>No</option></select>
      <select name="canMoveForward"><option>Sí</option><option>No</option></select>
      <input name="objections" placeholder="Objeciones">
      <textarea name="notes" placeholder="Observaciones"></textarea>
      <div class="form-actions"><button type="submit">Guardar cliente</button><button type="button" class="secondary" data-close-form>Cancelar</button></div>
    </form>`;
}

function clientCard(rawClient) {
  const client = normalizeClient(rawClient);
  const light = trafficLight(client);
  const summary = clientSummary(client);
  const expanded = expandedClients.has(Number(client.id));
  return `
    <article class="compact-card client-card ${light.color}">
      <div class="card-main">
        <div class="card-top"><h3>${escapeHtml(client.name)}</h3><span class="traffic ${light.color}">${light.label}</span></div>
        <p>${escapeHtml(client.interest || 'Sin búsqueda cargada')}</p>
        <div class="mini-grid"><span>${escapeHtml(client.pipeline || 'Nuevo')}</span><span>${escapeHtml(summary.budget)}</span></div>
        <strong class="next-step">${escapeHtml(summary.nextStep)}</strong>
      </div>
      <div class="card-actions"><button class="secondary" data-toggle-client="${client.id}">${expanded ? 'Ver menos' : 'Ver más'}</button><button class="delete" data-collection="clients" data-id="${client.id}" aria-label="Eliminar ${escapeHtml(client.name)}">×</button></div>
      ${expanded ? `<div class="card-details"><span><b>Tel:</b> ${escapeHtml(client.phone || 'Pendiente')}</span><span><b>Email:</b> ${escapeHtml(client.email || 'Pendiente')}</span><span><b>Último:</b> ${escapeHtml(client.lastContact || 'Pendiente')}</span><span><b>Próximo:</b> ${escapeHtml(client.nextFollowUp || 'Pendiente')}</span><span><b>Pago:</b> ${escapeHtml(client.paymentMethod || 'Pendiente')}</span><span><b>Plazo:</b> ${escapeHtml(client.purchaseTimeframe || 'Pendiente')}</span><span><b>Vivir/invertir:</b> ${escapeHtml(client.purpose || 'Pendiente')}</span><span><b>Puede avanzar:</b> ${escapeHtml(client.canMoveForward || 'Pendiente')}</span><span class="wide"><b>Objeciones:</b> ${escapeHtml(summary.objections)}</span></div>` : ''}
    </article>`;
}

function renderClients() {
  return `<section class="panel module-panel"><div class="panel-heading"><div><span class="eyebrow">Clientes / Leads</span><h2>Clientes</h2></div><button data-toggle-form="client">${openForm === 'client' ? 'Cerrar' : 'Nuevo cliente'}</button></div>${clientForm()}<div class="card-list">${crm.clients.length ? crm.clients.map(clientCard).join('') : '<p class="empty-state">Todavía no hay clientes.</p>'}</div></section>`;
}

function propertyForm() {
  if (openForm !== 'property') return '';
  return `
    <form class="crm-form" id="property-form">
      <input name="title" placeholder="Nombre de la propiedad" required>
      <input name="address" placeholder="Dirección o zona" required>
      <select name="type"><option>Piso</option><option>Casa</option><option>Local</option><option>Terreno</option></select>
      <select name="operation"><option>Venta</option><option>Alquiler</option></select>
      <input name="price" type="number" min="0" placeholder="Precio" required>
      <input name="owner" placeholder="Propietario" required>
      <select name="status"><option>Disponible</option><option>Captación</option><option>Reservada</option><option>Vendida</option></select>
      <div class="form-actions"><button type="submit">Guardar propiedad</button><button type="button" class="secondary" data-close-form>Cancelar</button></div>
    </form>`;
}

function propertyCard(property) {
  return `<article class="compact-card"><div class="card-main"><div class="card-top"><h3>${escapeHtml(property.title)}</h3><span class="pill">${escapeHtml(property.status)}</span></div><p>${escapeHtml(property.address)} · ${escapeHtml(property.type)}</p><strong>${money(property.price, property.operation)}</strong><small>Propietario: ${escapeHtml(property.owner || 'Pendiente')}</small></div><button class="delete" data-collection="properties" data-id="${property.id}" aria-label="Eliminar propiedad">×</button></article>`;
}

function renderProperties() {
  return `<section class="panel module-panel"><div class="panel-heading"><div><span class="eyebrow">Propiedades</span><h2>Propiedades</h2></div><button data-toggle-form="property">${openForm === 'property' ? 'Cerrar' : 'Nueva propiedad'}</button></div>${propertyForm()}<div class="card-list">${crm.properties.length ? crm.properties.map(propertyCard).join('') : '<p class="empty-state">Todavía no hay propiedades.</p>'}</div></section>`;
}

function reminderForm() {
  if (openForm !== 'reminder') return '';
  return `
    <form class="crm-form" id="reminder-form">
      <input name="date" type="date" required>
      <input name="title" placeholder="Qué hay que hacer" required>
      <input name="related" placeholder="Cliente o propiedad" required>
      <select name="priority"><option>Alta</option><option>Media</option><option>Baja</option></select>
      <div class="form-actions"><button type="submit">Guardar recordatorio</button><button type="button" class="secondary" data-close-form>Cancelar</button></div>
    </form>`;
}

function reminderCard(reminder) {
  return `<article class="compact-card reminder-card"><time>${escapeHtml(reminder.date)}</time><div class="card-main"><h3>${escapeHtml(reminder.title)}</h3><p>${escapeHtml(reminder.related)}</p></div><span class="pill priority-${String(reminder.priority).toLowerCase()}">${escapeHtml(reminder.priority)}</span><button class="delete" data-collection="reminders" data-id="${reminder.id}" aria-label="Eliminar recordatorio">×</button></article>`;
}

function renderReminders() {
  const reminders = crm.reminders.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return `<section class="panel module-panel"><div class="panel-heading"><div><span class="eyebrow">Recordatorios</span><h2>Recordatorios</h2></div><button data-toggle-form="reminder">${openForm === 'reminder' ? 'Cerrar' : 'Nuevo recordatorio'}</button></div>${reminderForm()}<div class="card-list">${reminders.length ? reminders.map(reminderCard).join('') : '<p class="empty-state">No hay recordatorios.</p>'}</div></section>`;
}

function activeModule() {
  if (activeTab === 'clientes') return renderClients();
  if (activeTab === 'propiedades') return renderProperties();
  if (activeTab === 'recordatorios') return renderReminders();
  return renderAlerts();
}

function render() {
  const alerts = allAlerts();
  app.innerHTML = `
    <main class="app-shell">
      <aside class="sidebar">
        <div class="brand"><div class="brand-mark">TRV</div><div><strong>TRV CRM</strong><span>Gestión Inmobiliaria</span></div></div>
        <p class="sidebar-copy">Semáforo comercial, alertas y seguimiento sin backend.</p>
      </aside>
      <section class="content">
        <header class="hero compact-hero"><span class="eyebrow">CRM inmobiliario</span><h1>Panel compacto de gestión comercial.</h1><p>Priorizá alertas, clientes, propiedades y recordatorios desde módulos separados.</p></header>
        ${statCards(alerts)}
        ${tabsHtml()}
        ${activeModule()}
      </section>
    </main>`;
}

function addClient(values) { crm.clients.push({ id: nextId(crm.clients), ...values }); }
function addProperty(values) { crm.properties.push({ id: nextId(crm.properties), ...values, price: Number(values.price) }); }
function addReminder(values) { crm.reminders.push({ id: nextId(crm.reminders), ...values }); }

app.addEventListener('click', (event) => {
  const target = event.target.closest('button');
  if (!target) return;
  if (target.dataset.tab) { activeTab = target.dataset.tab; openForm = null; render(); return; }
  if (target.dataset.toggleForm) { openForm = openForm === target.dataset.toggleForm ? null : target.dataset.toggleForm; render(); return; }
  if (target.hasAttribute('data-close-form')) { openForm = null; render(); return; }
  if (target.dataset.toggleClient) {
    const id = Number(target.dataset.toggleClient);
    expandedClients.has(id) ? expandedClients.delete(id) : expandedClients.add(id);
    render();
    return;
  }
  if (target.dataset.collection && target.dataset.id) removeItem(target.dataset.collection, target.dataset.id);
});

app.addEventListener('submit', (event) => {
  event.preventDefault();
  const values = formValues(event.target);
  if (event.target.id === 'client-form') addClient(values);
  if (event.target.id === 'property-form') addProperty(values);
  if (event.target.id === 'reminder-form') addReminder(values);
  openForm = null;
  saveData();
  render();
});

render();