const STORAGE_KEY = 'trv-crm-basico';

const initialData = {
  clients: [
    { id: 1, name: 'Lucía Martín', phone: '600 123 456', email: 'lucia@email.com', interest: 'Casa de 2 habitaciones en zona centro', status: 'Lead', temperature: 'Caliente', pipeline: 'Visita posible', lastContact: '2026-07-06', nextFollowUp: '2026-07-09', budget: 'USD 210.000', paymentMethod: 'Crédito preaprobado', purchaseTimeframe: '0-3 meses', purpose: 'Vivir', knowsArea: 'Sí', canMoveForward: 'Sí', objections: 'Quiere buena luz natural', notes: 'Preguntó por documentación y estado de la propiedad.' },
    { id: 2, name: 'Andrés Vega', phone: '611 222 333', email: 'andres@email.com', interest: 'Casa con jardín en zona familiar', status: 'Cliente', temperature: 'Tibio', pipeline: 'Seguimiento', lastContact: '2026-06-28', nextFollowUp: '2026-07-08', budget: 'USD 330.000', paymentMethod: 'Venta previa', purchaseTimeframe: '3-6 meses', purpose: 'Vivir', knowsArea: 'No', canMoveForward: 'No', objections: 'Debe vender antes de comprar', notes: 'Pedir actualización de su operación actual.' },
    { id: 3, name: 'Grupo Norte', phone: '622 444 555', email: 'norte@email.com', interest: 'Propiedad comercial para inversión', status: 'Lead', temperature: 'Frío', pipeline: 'Nuevo', lastContact: '2026-05-20', nextFollowUp: '2026-06-20', budget: '', paymentMethod: '', purchaseTimeframe: '', purpose: 'Invertir', knowsArea: 'No', canMoveForward: 'No', objections: 'No definió rentabilidad objetivo', notes: 'Reactivar con opciones comerciales disponibles.' },
  ],
  properties: [
    { id: 1, title: 'Casa centro reformada', address: 'Calle Mayor 14', type: 'Casa', operation: 'Venta', price: 210000, owner: 'Andrés Vega', status: 'Activa' },
    { id: 2, title: 'Propiedad comercial en avenida', address: 'Avenida Norte 8', type: 'Comercial', operation: 'Venta', price: 180000, owner: 'Inversiones Alba', status: 'Captación' },
  ],
  reminders: [
    { id: 1, date: '2026-07-13', title: 'Llamar a Lucía', related: 'Casa centro reformada', priority: 'Alta' },
    { id: 2, date: '2026-07-15', title: 'Preparar valoración', related: 'Andrés Vega', priority: 'Media' },
  ],
};

const modules = [
  ['inicio', 'Inicio'],
  ['crm', 'CRM / Leads'],
  ['propiedades', 'Propiedades'],
  ['fichas', 'Fichas TRV'],
  ['whatsapp', 'WhatsApp + IA'],
  ['agenda', 'Agenda / Seguimiento'],
  ['reportes', 'Reportes'],
  ['configuracion', 'Configuración'],
];
const icons = { home: '⌂', plus: '+', trash: '×' };
const app = document.querySelector('#root');
const logoPath = '/src/assets/trv-logo.svg';
const today = new Date().toISOString().slice(0, 10);
const loadData = () => JSON.parse(localStorage.getItem(STORAGE_KEY) || JSON.stringify(initialData));
let crm = loadData();
let activeModule = 'inicio';
const openForms = { clients: false, properties: false, reminders: false };
const expandedClients = new Set();

const saveData = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(crm));
const currency = (value) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(value || 0));
const nextId = (items) => Math.max(0, ...items.map((item) => item.id)) + 1;
const hasValue = (value) => Boolean(String(value || '').trim());
const isPast = (date) => hasValue(date) && date < today;
const daysSince = (date) => hasValue(date) ? Math.floor((new Date(today) - new Date(date)) / 86400000) : 999;

app.innerHTML = `
  <main class="app-shell premium-shell">
    <aside class="sidebar premium-sidebar" aria-label="Navegación principal">
      <div class="brand"><img class="brand-logo" src="${logoPath}" alt="Logo TRV Gestión Inmobiliaria"><div><strong>TRV CRM</strong><span>SaaS inmobiliario</span></div></div>
      <nav class="premium-nav">${modules.map(([id, label]) => `<button class="nav-button ${id === activeModule ? 'active' : ''}" data-module="${id}">${label}</button>`).join('')}</nav>
      <div class="sidebar-card"><h3>Semáforo comercial</h3><p>Leads, propiedades, fichas y seguimiento comercial en un tablero premium.</p></div>
    </aside>

    <section class="content premium-content">
      <header class="topbar">
        <div><span class="eyebrow">TRV Gestión Inmobiliaria</span><h1 id="module-title">Inicio</h1></div><img class="topbar-logo" src="${logoPath}" alt="TRV Gestión Inmobiliaria">
        <span class="status-badge">Railway ready · localStorage</span>
      </header>

      <section class="module-panel active" id="inicio">
        <section class="metric-grid" aria-label="Vista general del negocio">
          <article class="metric-card"><span>Leads nuevos</span><strong id="new-leads-count"></strong></article>
          <article class="metric-card hot"><span>Clientes calientes</span><strong id="hot-clients-count"></strong></article>
          <article class="metric-card urgent"><span>Alertas urgentes</span><strong id="urgent-count"></strong></article>
          <article class="metric-card opportunity"><span>Posibles visitas</span><strong id="visit-count"></strong></article>
          <article class="metric-card pending"><span>Seguimientos vencidos</span><strong id="overdue-count"></strong></article>
          <article class="metric-card"><span>Propiedades activas</span><strong id="active-properties-count"></strong></article>
        </section>
        <section class="dashboard-grid">
          <article class="panel-card"><div class="panel-heading"><div><span class="eyebrow">Alertas comerciales</span><h2>Prioridad de hoy</h2></div></div><div class="alert-list compact" id="home-alert-list"></div></article>
          <article class="panel-card"><div class="panel-heading"><div><span class="eyebrow">Actividad reciente</span><h2>Últimos movimientos</h2></div></div><div class="activity-list" id="activity-list"></div></article>
        </section>
      </section>

      <section class="module-panel" id="crm">
        <div class="panel-heading"><div><span class="eyebrow">CRM / Leads</span><h2>Pipeline comercial</h2></div><button class="toggle-form" data-form="clients">Nuevo cliente</button></div>
        <div class="pipeline-strip"><span>Nuevo</span><span>Calificado</span><span>Seguimiento</span><span>Visita posible</span><span>Negociación</span><span>Cerrado</span></div>
        <form class="crm-form client-form collapsed" id="client-form">
          <input name="name" placeholder="Nombre del cliente o lead" required><input name="phone" placeholder="Teléfono" required><input name="email" type="email" placeholder="Email"><input name="interest" placeholder="Qué busca / zona de interés" required>
          <select name="status"><option>Lead</option><option>Cliente</option><option>Seguimiento</option><option>Cerrado</option></select><select name="temperature"><option>Caliente</option><option>Tibio</option><option>Frío</option></select><select name="pipeline"><option>Nuevo</option><option>Calificado</option><option>Seguimiento</option><option>Visita posible</option><option>Negociación</option><option>Cerrado</option><option>Perdido</option></select>
          <input name="lastContact" type="date" aria-label="Fecha de último contacto"><input name="nextFollowUp" type="date" aria-label="Próximo seguimiento"><input name="budget" placeholder="Presupuesto"><input name="paymentMethod" placeholder="Forma de pago"><input name="purchaseTimeframe" placeholder="Plazo de compra">
          <select name="purpose"><option>Vivir</option><option>Invertir</option></select><select name="knowsArea"><option>Sí</option><option>No</option></select><select name="canMoveForward"><option>Sí</option><option>No</option></select><input name="objections" placeholder="Objeciones"><textarea name="notes" placeholder="Observaciones"></textarea><button>${icons.plus} Guardar cliente</button>
        </form>
        <div class="card-list" id="client-list"></div>
      </section>

      <section class="module-panel" id="propiedades">
        <div class="panel-heading"><div><span class="eyebrow">Propiedades</span><h2>Cartera activa</h2></div><button class="toggle-form" data-form="properties">Nueva propiedad</button></div>
        <form class="crm-form collapsed" id="property-form">
          <input name="title" placeholder="Nombre de la propiedad" required><input name="address" placeholder="Dirección o zona" required><select name="type"><option>Casa</option><option>Departamento</option><option>Comercial</option><option>Terreno</option></select><select name="operation"><option>Venta</option><option>Captación</option></select><input name="price" type="number" min="0" placeholder="Valor de referencia" required><input name="owner" placeholder="Propietario" required><select name="status"><option>Activa</option><option>Captación</option><option>Reservada</option><option>Cerrada</option></select><button>${icons.plus} Guardar propiedad</button>
        </form>
        <div class="property-board" id="property-list"></div>
      </section>

      <section class="module-panel" id="fichas">
        <div class="empty-module ficha-module"><img class="ficha-logo" src="${logoPath}" alt="Logo TRV para ficha comercial"><span class="eyebrow">Fichas TRV</span><h2>Generador de fichas comerciales TRV</h2><p>Plantilla visual preparada con la marca TRV: fondo azul institucional, acentos dorados, logo y formato uniforme para entregar a clientes.</p><div class="ficha-preview"><strong>Ficha comercial TRV</strong><span>Propiedad destacada · Datos técnicos · Descripción comercial · Contacto</span></div><div class="action-row"><button>Nueva ficha</button><button>Descargar PDF</button><button>Copiar texto para WhatsApp</button><button>Compartir por WhatsApp</button></div></div>
      </section>

      <section class="module-panel" id="whatsapp">
        <div class="empty-module"><span class="eyebrow">WhatsApp + IA</span><h2>Centro de comunicación WhatsApp + IA</h2><p>Diseño preparado sin conexión real a WhatsApp API.</p><div class="feature-grid"><article>Conversaciones</article><article>Resumen IA</article><article>Respuestas sugeridas</article><article>Audios y mensajes</article></div></div>
      </section>

      <section class="module-panel" id="agenda">
        <div class="panel-heading"><div><span class="eyebrow">Agenda / Seguimiento</span><h2>Tareas comerciales</h2></div><button class="toggle-form" data-form="reminders">Nuevo recordatorio</button></div>
        <form class="crm-form reminders-form collapsed" id="reminder-form"><input name="date" type="date" required><input name="title" placeholder="Qué hay que hacer" required><input name="related" placeholder="Cliente o propiedad relacionada" required><select name="priority"><option>Alta</option><option>Media</option><option>Baja</option></select><button>${icons.plus} Guardar recordatorio</button></form>
        <div class="card-list reminder-list" id="reminder-list"></div>
      </section>

      <section class="module-panel" id="reportes">
        <div class="panel-heading"><div><span class="eyebrow">Reportes</span><h2>Indicadores comerciales</h2></div></div>
        <div class="metric-grid report-grid"><article class="metric-card"><span>Leads recibidos</span><strong>38</strong></article><article class="metric-card"><span>Clientes contactados</span><strong>24</strong></article><article class="metric-card"><span>Visitas posibles</span><strong id="report-visits"></strong></article><article class="metric-card"><span>Operaciones cerradas</span><strong>4</strong></article><article class="metric-card"><span>Tasa de respuesta</span><strong>68%</strong></article></div>
      </section>

      <section class="module-panel" id="configuracion">
        <div class="panel-heading"><div><span class="eyebrow">Configuración</span><h2>Identidad de la inmobiliaria</h2></div></div>
        <div class="settings-grid"><label>Nombre inmobiliaria<input value="TRV Gestión Inmobiliaria"></label><label>WhatsApp<input value="3515110069"></label><label>Logo TRV<img class="settings-logo" src="${logoPath}" alt="Logo TRV"></label><label>Color principal<input type="color" value="#06364a"></label></div>
      </section>
    </section>
  </main>`;

function formValues(form) { return Object.fromEntries(new FormData(form).entries()); }
function removeItem(collection, id) { crm[collection] = crm[collection].filter((item) => item.id !== Number(id)); saveData(); render(); }
function trafficLight(client) { const ready = client.temperature === 'Caliente' && hasValue(client.budget) && hasValue(client.paymentMethod) && hasValue(client.purchaseTimeframe) && client.canMoveForward === 'Sí'; const blocked = client.temperature === 'Frío' || !hasValue(client.budget) || !hasValue(client.purchaseTimeframe) || client.canMoveForward === 'No'; if (ready) return { color: 'verde', label: 'Verde' }; if (blocked) return { color: 'rojo', label: 'Rojo' }; return { color: 'amarillo', label: 'Amarillo' }; }
function clientSummary(client) { const light = trafficLight(client); const nextStep = light.color === 'verde' && client.pipeline === 'Visita posible' ? 'Este cliente parece apto para visita. Revisar y aprobar.' : light.color === 'rojo' ? 'Reactivar y completar presupuesto, plazo y capacidad de avance.' : 'Hacer seguimiento y completar datos faltantes.'; return { search: client.interest || 'Sin búsqueda definida', budget: client.budget || 'Sin presupuesto definido', area: client.interest || 'Sin zona/interés cargado', objections: client.objections || client.notes || 'Sin objeciones cargadas', nextStep }; }
function clientAlerts(client) { const alerts = []; if (client.temperature === 'Caliente' && daysSince(client.lastContact) >= 3) alerts.push({ type: 'urgent', title: 'Cliente caliente sin contactar', detail: `${client.name} lleva ${daysSince(client.lastContact)} días sin contacto.` }); if (isPast(client.nextFollowUp)) alerts.push({ type: 'urgent', title: 'Seguimiento vencido', detail: `${client.name} tenía seguimiento el ${client.nextFollowUp}.` }); if (client.status === 'Lead' && daysSince(client.lastContact) >= 5) alerts.push({ type: 'pending', title: 'Lead sin responder', detail: `${client.name} necesita una nueva respuesta comercial.` }); if (client.pipeline === 'Visita posible') alerts.push({ type: 'opportunity', title: 'Posible visita para revisar', detail: 'Este cliente parece apto para visita. Revisar y aprobar.' }); if (client.pipeline === 'Negociación' && trafficLight(client).color === 'verde') alerts.push({ type: 'opportunity', title: 'Posible reserva', detail: `${client.name} está en negociación y puede avanzar.` }); if (daysSince(client.lastContact) >= 30) alerts.push({ type: 'pending', title: 'Cliente viejo para reactivar', detail: `${client.name} lleva ${daysSince(client.lastContact)} días sin contacto.` }); return alerts.map((alert) => ({ ...alert, client })); }
function allAlerts() { return crm.clients.flatMap(clientAlerts); }
function alertCard(alert) { return `<article class="alert-card ${alert.type}"><span>${alert.title}</span><h3>${alert.client.name}</h3><p>${alert.detail}</p><small>${clientSummary(alert.client).nextStep}</small></article>`; }
function detailItem(label, value) { return `<span><b>${label}:</b> ${value || 'Pendiente'}</span>`; }
function setText(selector, value) { const node = document.querySelector(selector); if (node) node.textContent = value; }
function updateModuleVisibility() { modules.forEach(([id, label]) => { document.querySelector(`#${id}`).classList.toggle('active', id === activeModule); if (id === activeModule) document.querySelector('#module-title').textContent = label; }); document.querySelectorAll('.nav-button').forEach((button) => button.classList.toggle('active', button.dataset.module === activeModule)); }
function updateFormVisibility() { document.querySelector('#client-form').classList.toggle('collapsed', !openForms.clients); document.querySelector('#property-form').classList.toggle('collapsed', !openForms.properties); document.querySelector('#reminder-form').classList.toggle('collapsed', !openForms.reminders); }
function recentActivity() { return [`Nuevo lead cargado: ${crm.clients.at(-1)?.name || 'Sin datos'}`, `Propiedad revisada: ${crm.properties[0]?.title || 'Sin datos'}`, `Seguimiento próximo: ${crm.reminders[0]?.title || 'Sin datos'}`, 'Fichas TRV listas para configurar']; }

function render() {
  updateModuleVisibility(); updateFormVisibility();
  const alerts = allAlerts();
  const urgent = alerts.filter((alert) => alert.type === 'urgent').length;
  const visits = alerts.filter((alert) => alert.title === 'Posible visita para revisar').length;
  const overdue = alerts.filter((alert) => alert.title === 'Seguimiento vencido').length;
  setText('#new-leads-count', crm.clients.filter((client) => client.status === 'Lead').length);
  setText('#hot-clients-count', crm.clients.filter((client) => client.temperature === 'Caliente').length);
  setText('#urgent-count', urgent); setText('#visit-count', visits); setText('#overdue-count', overdue); setText('#active-properties-count', crm.properties.filter((property) => property.status !== 'Cerrada').length); setText('#report-visits', visits);
  document.querySelector('#home-alert-list').innerHTML = alerts.length ? alerts.slice(0, 4).map(alertCard).join('') : '<p class="empty-state">No hay alertas comerciales activas.</p>';
  document.querySelector('#activity-list').innerHTML = recentActivity().map((item) => `<div class="activity-item"><span></span>${item}</div>`).join('');

  document.querySelector('#client-list').innerHTML = crm.clients.map((client) => { const light = trafficLight(client); const summary = clientSummary(client); const expanded = expandedClients.has(client.id); return `<article class="crm-card client-card ${light.color}"><div><div class="client-title"><h3>${client.name}</h3><span class="traffic ${light.color}">${light.label}</span></div><div class="client-compact"><span>${client.temperature || 'Sin temperatura'}</span><span>${client.pipeline || 'Sin pipeline'}</span><span>${summary.budget}</span></div><p class="next-step">${summary.nextStep}</p><div class="client-extra ${expanded ? 'expanded' : ''}"><small>${client.phone} · ${client.email || 'Sin email'}</small><div class="client-details">${detailItem('Qué busca', summary.search)}${detailItem('Último contacto', client.lastContact)}${detailItem('Próximo seguimiento', client.nextFollowUp)}${detailItem('Forma de pago', client.paymentMethod)}${detailItem('Plazo', client.purchaseTimeframe)}${detailItem('Uso', client.purpose)}${detailItem('Conoce zona', client.knowsArea)}${detailItem('Puede avanzar', client.canMoveForward)}</div><div class="client-summary"><b>Resumen automático:</b><p>Busca: ${summary.search}. Presupuesto: ${summary.budget}. Zona/interés: ${summary.area}. Objeciones: ${summary.objections}. Próximo paso recomendado: ${summary.nextStep}</p></div></div></div><div class="card-actions"><span class="pill">${client.status}</span><button class="ghost expand-client" data-id="${client.id}">${expanded ? 'Ver menos' : 'Ver más'}</button><button class="delete" data-collection="clients" data-id="${client.id}" aria-label="Eliminar cliente ${client.name}">${icons.trash}</button></div></article>`; }).join('') || '<p class="empty-state">Todavía no hay clientes o leads.</p>';

  document.querySelector('#property-list').innerHTML = crm.properties.map((property) => `<article class="property-card"><div><span class="pill">${property.status}</span><h3>${property.title}</h3><p>${property.address} · ${property.type}</p><small>Preparada para fotos, ficha técnica y estado comercial.</small></div><strong>${currency(property.price)}</strong><button class="delete" data-collection="properties" data-id="${property.id}" aria-label="Eliminar propiedad ${property.title}">${icons.trash}</button></article>`).join('') || '<p class="empty-state">Todavía no hay propiedades.</p>';

  document.querySelector('#reminder-list').innerHTML = crm.reminders.slice().sort((a, b) => a.date.localeCompare(b.date)).map((reminder) => `<article class="crm-card reminder"><time>${reminder.date}</time><div><h3>${reminder.title}</h3><p>${reminder.related}</p></div><span class="pill priority-${reminder.priority.toLowerCase()}">${reminder.priority}</span><button class="delete" data-collection="reminders" data-id="${reminder.id}" aria-label="Eliminar recordatorio ${reminder.title}">${icons.trash}</button></article>`).join('') || '<p class="empty-state">No hay recordatorios pendientes.</p>';
}

const handlers = { 'client-form': (values) => crm.clients.push({ id: nextId(crm.clients), ...values }), 'property-form': (values) => crm.properties.push({ id: nextId(crm.properties), ...values, price: Number(values.price) }), 'reminder-form': (values) => crm.reminders.push({ id: nextId(crm.reminders), ...values }) };
Object.entries(handlers).forEach(([formId, handler]) => { document.querySelector(`#${formId}`).addEventListener('submit', (event) => { event.preventDefault(); handler(formValues(event.currentTarget)); event.currentTarget.reset(); const formMap = { 'client-form': 'clients', 'property-form': 'properties', 'reminder-form': 'reminders' }; openForms[formMap[formId]] = false; saveData(); render(); }); });
document.addEventListener('click', (event) => { if (event.target.matches('.delete')) removeItem(event.target.dataset.collection, event.target.dataset.id); if (event.target.matches('.nav-button')) { activeModule = event.target.dataset.module; render(); } if (event.target.matches('.toggle-form')) { openForms[event.target.dataset.form] = !openForms[event.target.dataset.form]; render(); } if (event.target.matches('.expand-client')) { const id = Number(event.target.dataset.id); expandedClients.has(id) ? expandedClients.delete(id) : expandedClients.add(id); render(); } });

render();
