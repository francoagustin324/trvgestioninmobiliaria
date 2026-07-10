const STORAGE_KEY = 'trv-crm-basico';

const initialData = {
  clients: [
    { id: 1, name: 'Lucía Martín', phone: '600 123 456', email: 'lucia@email.com', interest: 'Comprar piso de 2 habitaciones', status: 'Lead' },
    { id: 2, name: 'Andrés Vega', phone: '611 222 333', email: 'andres@email.com', interest: 'Vender chalet familiar', status: 'Cliente' },
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

const icons = { home: '⌂', clients: '◉', properties: '▦', reminders: '◷', plus: '+', trash: '×' };
const app = document.querySelector('#root');
const loadData = () => JSON.parse(localStorage.getItem(STORAGE_KEY) || JSON.stringify(initialData));
let crm = loadData();

const saveData = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(crm));
const currency = (value, operation) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Number(value || 0)) + (operation === 'Alquiler' ? '/mes' : '');
const nextId = (items) => Math.max(0, ...items.map((item) => item.id)) + 1;

app.innerHTML = `
  <main class="app-shell">
    <aside class="sidebar" aria-label="Navegación principal">
      <div class="brand"><div class="brand-mark">${icons.home}</div><div><strong>TRV CRM</strong><span>Gestión Inmobiliaria</span></div></div>
      <nav>
        <a class="active" href="#clientes">${icons.clients} Clientes / Leads</a>
        <a href="#propiedades">${icons.properties} Propiedades</a>
        <a href="#recordatorios">${icons.reminders} Recordatorios</a>
      </nav>
      <div class="sidebar-card"><h3>CRM sencillo</h3><p>Cargá clientes, propiedades y recordatorios. Los datos quedan guardados en este navegador.</p></div>
    </aside>

    <section class="content">
      <header class="hero">
        <span class="eyebrow">CRM básico para inmobiliaria</span>
        <h1>Gestiona clientes, propiedades y recordatorios desde un único panel.</h1>
        <p>Una app estática para organizar contactos, inmuebles y próximas acciones comerciales sin backend ni base de datos.</p>
      </header>

      <section class="stats-grid" aria-label="Resumen del CRM">
        <article class="stat-card"><span>Clientes / leads</span><strong id="client-count"></strong><p>Contactos comerciales</p></article>
        <article class="stat-card"><span>Propiedades</span><strong id="property-count"></strong><p>Inmuebles registrados</p></article>
        <article class="stat-card"><span>Recordatorios</span><strong id="reminder-count"></strong><p>Tareas pendientes</p></article>
      </section>

      <section class="crm-grid">
        <section class="panel" id="clientes">
          <div class="panel-heading"><div><span class="eyebrow">Clientes / Leads</span><h2>Cargar y ver contactos</h2></div></div>
          <form class="crm-form" id="client-form">
            <input name="name" placeholder="Nombre del cliente o lead" required>
            <input name="phone" placeholder="Teléfono" required>
            <input name="email" type="email" placeholder="Email">
            <input name="interest" placeholder="Interés: compra, venta, alquiler..." required>
            <select name="status"><option>Lead</option><option>Cliente</option><option>Seguimiento</option><option>Cerrado</option></select>
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

function render() {
  document.querySelector('#client-count').textContent = crm.clients.length;
  document.querySelector('#property-count').textContent = crm.properties.length;
  document.querySelector('#reminder-count').textContent = crm.reminders.length;

  document.querySelector('#client-list').innerHTML = crm.clients.map((client) => `
    <article class="crm-card"><div><h3>${client.name}</h3><p>${client.interest}</p><small>${client.phone} · ${client.email || 'Sin email'}</small></div><span class="pill">${client.status}</span><button class="delete" data-collection="clients" data-id="${client.id}" aria-label="Eliminar cliente ${client.name}">${icons.trash}</button></article>
  `).join('') || '<p class="empty-state">Todavía no hay clientes o leads.</p>';

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