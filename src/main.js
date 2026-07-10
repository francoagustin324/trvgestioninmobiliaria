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

const icons = { home: '⌂', clients: '◉', properties: '▦', reminders: '◷', alerts: '!', plus: '+', trash: '×' };
const app = document.querySelector('#root');
const today = new Date().toISOString().slice(0, 10);
const loadData = () => JSON.parse(localStorage.getItem(STORAGE_KEY) || JSON.stringify(initialData));
let crm = loadData();

const saveData = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(crm));
const currency = (value, operation) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Number(value || 0)) + (operation === 'Alquiler' ? '/mes' : '');
const nextId = (items) => Math.max(0, ...items.map((item) => item.id)) + 1;
const hasValue = (value) => Boolean(String(value || '').trim());
const isPast = (date) => hasValue(date) && date < today;
const daysSince = (date) => hasValue(date) ? Math.floor((new Date(today) - new Date(date)) / 86400000) : 999;

app.innerHTML = `
  <main class="app-shell">
    <aside class="sidebar" aria-label="Navegación principal">
      <div class="brand"><div class="brand-mark">${icons.home}</div><div><strong>TRV CRM</strong><span>Gestión Inmobiliaria</span></div></div>
      <nav>
        <a class="active" href="#alertas">${icons.alerts} Alertas comerciales</a>
        <a href="#clientes">${icons.clients} Clientes / Leads</a>
        <a href="#propiedades">${icons.properties} Propiedades</a>
        <a href="#recordatorios">${icons.reminders} Recordatorios</a>
      </nav>
      <div class="sidebar-card"><h3>Semáforo comercial</h3><p>Priorizá oportunidades, seguimientos vencidos y clientes para reactivar sin salir del navegador.</p></div>
    </aside>

    <section class="content">
      <header class="hero">
        <span class="eyebrow">CRM básico para inmobiliaria</span>
        <h1>Gestiona clientes, propiedades, recordatorios y alertas comerciales.</h1>
        <p>Una app estática para priorizar contactos con semáforo comercial, sin backend ni base de datos.</p>
      </header>

      <section class="stats-grid" aria-label="Resumen del CRM">
        <article class="stat-card urgent"><span>Alertas urgentes</span><strong id="urgent-count"></strong><p>Requieren intervención</p></article>
        <article class="stat-card opportunity"><span>Posibles visitas</span><strong id="visit-count"></strong><p>Revisar y aprobar</p></article>
        <article class="stat-card pending"><span>Seguimientos vencidos</span><strong id="overdue-count"></strong><p>Contactos atrasados</p></article>
      </section>

      <section class="panel full" id="alertas">
        <div class="panel-heading"><div><span class="eyebrow">Alertas comerciales</span><h2>Prioridades detectadas automáticamente</h2></div></div>
        <div class="alert-list" id="alert-list"></div>
      </section>

      <section class="crm-grid">
        <section class="panel" id="clientes">
          <div class="panel-heading"><div><span class="eyebrow">Clientes / Leads</span><h2>Cargar y ver contactos</h2></div></div>
          <form class="crm-form client-form" id="client-form">
            <input name="name" placeholder="Nombre del cliente o lead" required>
            <input name="phone" placeholder="Teléfono" required>
            <input name="email" type="email" placeholder="Email">
            <input name="interest" placeholder="Qué busca / zona de interés" required>
            <select name="status"><option>Lead</option><option>Cliente</option><option>Seguimiento</option><option>Cerrado</option></select>
            <select name="temperature"><option>Caliente</option><option>Tibio</option><option>Frío</option></select>
            <select name="pipeline"><option>Nuevo</option><option>Calificado</option><option>Seguimiento</option><option>Visita posible</option><option>Negociación</option><option>Cerrado</option><option>Perdido</option></select>
            <input name="lastContact" type="date" aria-label="Fecha de último contacto">
            <input name="nextFollowUp" type="date" aria-label="Próximo seguimiento">
            <input name="budget" placeholder="Presupuesto">
            <input name="paymentMethod" placeholder="Forma de pago">
            <input name="purchaseTimeframe" placeholder="Plazo de compra">
            <select name="purpose"><option>Vivir</option><option>Invertir</option></select>
            <select name="knowsArea"><option>Sí</option><option>No</option></select>
            <select name="canMoveForward"><option>Sí</option><option>No</option></select>
            <input name="objections" placeholder="Objeciones">
            <textarea name="notes" placeholder="Observaciones"></textarea>
            <button>${icons.plus} Cargar cliente</button>
          </form>
          <div class="card-list" id="client-list"></div>
        </section>

        <section class="panel" id="propiedades">
          <div class="panel-heading"><div><span class="eyebrow">Propiedades</span><h2>Cargar y ver inmuebles</h2></div></div>
          <form class="crm-form" id="property-form">
            <input name="title" placeholder="Nombre de la propiedad" required>
            <input name="address" placeholder="Dirección o zona" required>
            <select name="type"><option>Piso</option><option>Casa</option><option>Local</option><option>Terreno</option></select>
            <select name="operation"><option>Venta</option><option>Alquiler</option></select>
            <input name="price" type="number" min="0" placeholder="Precio" required>
            <input name="owner" placeholder="Propietario" required>
            <select name="status"><option>Disponible</option><option>Captación</option><option>Reservada</option><option>Vendida</option></select>
            <button>${icons.plus} Cargar propiedad</button>
          </form>
          <div class="card-list" id="property-list"></div>
        </section>

        <section class="panel full" id="recordatorios">
          <div class="panel-heading"><div><span class="eyebrow">Recordatorios</span><h2>Cargar y ver próximas acciones</h2></div></div>
          <form class="crm-form reminders-form" id="reminder-form">
            <input name="date" type="date" required>
            <input name="title" placeholder="Qué hay que hacer" required>
            <input name="related" placeholder="Cliente o propiedad relacionada" required>
            <select name="priority"><option>Alta</option><option>Media</option><option>Baja</option></select>
            <button>${icons.plus} Cargar recordatorio</button>
          </form>
          <div class="card-list reminder-list" id="reminder-list"></div>
        </section>
      </section>
    </section>
  </main>`;

function formValues(form) { return Object.fromEntries(new FormData(form).entries()); }
function removeItem(collection, id) { crm[collection] = crm[collection].filter((item) => item.id !== Number(id)); saveData(); render(); }
function trafficLight(client) {
  const ready = client.temperature === 'Caliente' && hasValue(client.budget) && hasValue(client.paymentMethod) && hasValue(client.purchaseTimeframe) && client.canMoveForward === 'Sí';
  const blocked = client.temperature === 'Frío' || !hasValue(client.budget) || !hasValue(client.purchaseTimeframe) || client.canMoveForward === 'No';
  if (ready) return { color: 'verde', label: 'Verde', detail: 'Oportunidad clara' };
  if (blocked) return { color: 'rojo', label: 'Rojo', detail: 'Requiere calificación' };
  return { color: 'amarillo', label: 'Amarillo', detail: 'Pendiente de seguimiento' };
}
function clientSummary(client) {
  const light = trafficLight(client);
  const nextStep = light.color === 'verde' && client.pipeline === 'Visita posible' ? 'Este cliente parece apto para visita. Revisar y aprobar.' : light.color === 'rojo' ? 'Reactivar y completar presupuesto, plazo y capacidad de avance.' : 'Hacer seguimiento y completar datos faltantes.';
  return { search: client.interest || 'Sin búsqueda definida', budget: client.budget || 'Sin presupuesto definido', area: client.interest || 'Sin zona/interés cargado', objections: client.objections || client.notes || 'Sin objeciones cargadas', nextStep };
}
function clientAlerts(client) {
  const alerts = [];
  if (client.temperature === 'Caliente' && daysSince(client.lastContact) >= 3) alerts.push({ type: 'urgent', title: 'Cliente caliente sin contactar', detail: `${client.name} lleva ${daysSince(client.lastContact)} días sin contacto.` });
  if (isPast(client.nextFollowUp)) alerts.push({ type: 'urgent', title: 'Seguimiento vencido', detail: `${client.name} tenía seguimiento el ${client.nextFollowUp}.` });
  if (client.status === 'Lead' && daysSince(client.lastContact) >= 5) alerts.push({ type: 'pending', title: 'Lead sin responder', detail: `${client.name} necesita una nueva respuesta comercial.` });
  if (client.pipeline === 'Visita posible') alerts.push({ type: 'opportunity', title: 'Posible visita para revisar', detail: 'Este cliente parece apto para visita. Revisar y aprobar.' });
  if (client.pipeline === 'Negociación' && trafficLight(client).color === 'verde') alerts.push({ type: 'opportunity', title: 'Posible reserva', detail: `${client.name} está en negociación y puede avanzar.` });
  if (daysSince(client.lastContact) >= 30) alerts.push({ type: 'pending', title: 'Cliente viejo para reactivar', detail: `${client.name} lleva ${daysSince(client.lastContact)} días sin contacto.` });
  return alerts.map((alert) => ({ ...alert, client }));
}
function allAlerts() { return crm.clients.flatMap(clientAlerts); }
function alertCard(alert) { return `<article class="alert-card ${alert.type}"><span>${alert.title}</span><h3>${alert.client.name}</h3><p>${alert.detail}</p><small>${clientSummary(alert.client).nextStep}</small></article>`; }
function detailItem(label, value) { return `<span><b>${label}:</b> ${value || 'Pendiente'}</span>`; }

function render() {
  const alerts = allAlerts();
  document.querySelector('#urgent-count').textContent = alerts.filter((alert) => alert.type === 'urgent').length;
  document.querySelector('#visit-count').textContent = alerts.filter((alert) => alert.title === 'Posible visita para revisar').length;
  document.querySelector('#overdue-count').textContent = alerts.filter((alert) => alert.title === 'Seguimiento vencido').length;
  document.querySelector('#alert-list').innerHTML = alerts.length ? alerts.map(alertCard).join('') : '<p class="empty-state">No hay alertas comerciales activas.</p>';

  document.querySelector('#client-list').innerHTML = crm.clients.map((client) => {
    const light = trafficLight(client);
    const summary = clientSummary(client);
    return `
      <article class="crm-card client-card ${light.color}">
        <div>
          <div class="client-title"><h3>${client.name}</h3><span class="traffic ${light.color}">${light.label}</span></div>
          <p>${client.interest}</p>
          <small>${client.phone} · ${client.email || 'Sin email'}</small>
          <div class="client-details">
            ${detailItem('Temperatura', client.temperature)}${detailItem('Pipeline', client.pipeline)}${detailItem('Último contacto', client.lastContact)}${detailItem('Próximo seguimiento', client.nextFollowUp)}${detailItem('Presupuesto', summary.budget)}${detailItem('Forma de pago', client.paymentMethod)}${detailItem('Plazo', client.purchaseTimeframe)}${detailItem('Uso', client.purpose)}${detailItem('Conoce zona', client.knowsArea)}${detailItem('Puede avanzar', client.canMoveForward)}
          </div>
          <div class="client-summary"><b>Resumen automático:</b><p>Busca: ${summary.search}. Presupuesto: ${summary.budget}. Zona/interés: ${summary.area}. Objeciones: ${summary.objections}. Próximo paso recomendado: ${summary.nextStep}</p></div>
        </div>
        <span class="pill">${client.status}</span>
        <button class="delete" data-collection="clients" data-id="${client.id}" aria-label="Eliminar cliente ${client.name}">${icons.trash}</button>
      </article>`;
  }).join('') || '<p class="empty-state">Todavía no hay clientes o leads.</p>';

  document.querySelector('#property-list').innerHTML = crm.properties.map((property) => `
    <article class="crm-card"><div><h3>${property.title}</h3><p>${property.address} · ${property.type}</p><small>${property.owner}</small></div><strong>${currency(property.price, property.operation)}</strong><span class="pill">${property.status}</span><button class="delete" data-collection="properties" data-id="${property.id}" aria-label="Eliminar propiedad ${property.title}">${icons.trash}</button></article>
  `).join('') || '<p class="empty-state">Todavía no hay propiedades.</p>';

  document.querySelector('#reminder-list').innerHTML = crm.reminders
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((reminder) => `
      <article class="crm-card reminder"><time>${reminder.date}</time><div><h3>${reminder.title}</h3><p>${reminder.related}</p></div><span class="pill priority-${reminder.priority.toLowerCase()}">${reminder.priority}</span><button class="delete" data-collection="reminders" data-id="${reminder.id}" aria-label="Eliminar recordatorio ${reminder.title}">${icons.trash}</button></article>
    `).join('') || '<p class="empty-state">No hay recordatorios pendientes.</p>';
}

const handlers = {
  'client-form': (values) => crm.clients.push({ id: nextId(crm.clients), ...values }),
  'property-form': (values) => crm.properties.push({ id: nextId(crm.properties), ...values, price: Number(values.price) }),
  'reminder-form': (values) => crm.reminders.push({ id: nextId(crm.reminders), ...values }),
};

Object.entries(handlers).forEach(([formId, handler]) => {
  document.querySelector(`#${formId}`).addEventListener('submit', (event) => {
    event.preventDefault();
    handler(formValues(event.currentTarget));
    event.currentTarget.reset();
    saveData();
    render();
  });
});

document.addEventListener('click', (event) => {
  if (event.target.matches('.delete')) removeItem(event.target.dataset.collection, event.target.dataset.id);
});

render();
