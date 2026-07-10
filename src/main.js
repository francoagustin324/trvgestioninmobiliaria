const properties = [
  { title: 'Ático luminoso en el centro', location: 'Centro histórico', operation: 'Venta', price: 285000, status: 'Publicado', type: 'Apartamento', beds: 3, baths: 2, area: 112, owner: 'María Gómez', image: 'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=900&q=80', highlight: true },
  { title: 'Casa familiar con jardín', location: 'Los Pinos', operation: 'Venta', price: 430000, status: 'Reservado', type: 'Casa', beds: 4, baths: 3, area: 248, owner: 'Carlos Rivera', image: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=900&q=80' },
  { title: 'Local comercial reformado', location: 'Avenida Norte', operation: 'Alquiler', price: 1450, status: 'Captación', type: 'Local', beds: 0, baths: 1, area: 86, owner: 'Inversiones Alba', image: 'https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=900&q=80' },
];

const leads = [
  { name: 'Lucía Martín', need: 'Busca piso de 2 habitaciones', budget: 'Hasta 210.000 €', stage: 'Visita agendada', score: 92 },
  { name: 'Grupo Norte', need: 'Oficina céntrica para alquiler', budget: '1.800 €/mes', stage: 'Negociación', score: 84 },
  { name: 'Andrés Vega', need: 'Quiere vender chalet', budget: 'Valoración pendiente', stage: 'Captación', score: 76 },
];

const visits = [
  { time: '10:00', property: 'Ático luminoso en el centro', client: 'Lucía Martín' },
  { time: '12:30', property: 'Casa familiar con jardín', client: 'Familia Navarro' },
  { time: '17:00', property: 'Local comercial reformado', client: 'Grupo Norte' },
];

const tasks = ['Subir contrato de exclusiva de Los Pinos', 'Enviar dossier del ático a clientes premium', 'Confirmar reportaje fotográfico del local', 'Revisar documentación de arras'];
const icons = { home: '⌂', docs: '☑', trend: '↗', building: '▦', users: '◉', calendar: '◷', money: '€', search: '⌕', star: '★', pin: '⌖', bed: '▭', bath: '◌', phone: '☎', plus: '+', arrow: '›' };

const formatCurrency = (value, operation) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value) + (operation === 'Alquiler' ? '/mes' : '');
const portfolioValue = properties.filter((property) => property.operation === 'Venta').reduce((total, property) => total + property.price, 0);

const app = document.querySelector('#root');
app.innerHTML = `
  <main class="app-shell">
    <aside class="sidebar" aria-label="Navegación principal">
      <div class="brand"><div class="brand-mark">${icons.home}</div><div><strong>TRV</strong><span>Gestión Inmobiliaria</span></div></div>
      <nav>${['Panel', 'Propiedades', 'Clientes', 'Visitas', 'Documentos'].map((item, index) => `<a class="${index === 0 ? 'active' : ''}" href="#${item.toLowerCase()}"><span>▣</span>${item}</a>`).join('')}</nav>
      <div class="sidebar-card"><span class="large-icon">${icons.docs}</span><h3>Control documental</h3><p>Alertas para contratos, certificados y firmas pendientes.</p></div>
    </aside>
    <section class="content">
      <header class="hero">
        <div><span class="eyebrow">CRM + cartera inmobiliaria</span><h1>Gestiona propiedades, clientes y visitas desde un único panel.</h1><p>Una base para que tu inmobiliaria pueda publicar inmuebles, priorizar oportunidades, coordinar visitas y controlar tareas comerciales.</p><div class="hero-actions"><button>${icons.plus} Nueva propiedad</button><button class="secondary">${icons.calendar} Agendar visita</button></div></div>
        <div class="hero-card"><span class="large-icon">${icons.trend}</span><span>Valor cartera en venta</span><strong>${formatCurrency(portfolioValue, 'Venta')}</strong><p>2 inmuebles activos con seguimiento comercial.</p></div>
      </header>
      <section class="stats-grid" aria-label="Indicadores principales">
        ${stat('building', 'Propiedades', '38', '12 captaciones nuevas')}${stat('users', 'Clientes activos', '126', '24 con alta intención')}${stat('calendar', 'Visitas semana', '17', '8 confirmadas hoy')}${stat('money', 'Comisiones previstas', '42.600 €', 'Pipeline a 60 días')}
      </section>
      <section class="workspace">
        <div class="panel properties-panel" id="propiedades">
          <div class="panel-heading"><div><span class="eyebrow">Cartera</span><h2>Propiedades destacadas</h2></div><div class="filters"><label class="search-box">${icons.search}<input id="property-search" placeholder="Buscar por zona o tipo" aria-label="Buscar propiedades"></label><select id="operation-filter" aria-label="Filtrar por operación"><option>Todas</option><option>Venta</option><option>Alquiler</option></select></div></div>
          <div class="property-grid" id="property-grid"></div>
        </div>
        <aside class="side-column">
          <div class="panel" id="clientes"><div class="panel-heading compact"><h2>Oportunidades</h2><a href="#clientes">Ver CRM ${icons.arrow}</a></div><div class="lead-list">${leads.map(leadCard).join('')}</div></div>
          <div class="panel" id="visitas"><div class="panel-heading compact"><h2>Agenda de hoy</h2><span>${icons.phone}</span></div>${visits.map(visitCard).join('')}</div>
          <div class="panel" id="documentos"><div class="panel-heading compact"><h2>Tareas pendientes</h2><span>${icons.docs}</span></div><ul class="task-list">${tasks.map((task) => `<li><span>✓</span>${task}</li>`).join('')}</ul></div>
        </aside>
      </section>
    </section>
  </main>`;

function stat(icon, label, value, detail) { return `<article class="stat-card"><div class="stat-icon">${icons[icon]}</div><span>${label}</span><strong>${value}</strong><p>${detail}</p></article>`; }
function leadCard(lead) { return `<article class="lead-card"><div><h3>${lead.name}</h3><p>${lead.need}</p><small>${lead.budget}</small></div><div class="score">${lead.score}</div><span>${lead.stage}</span></article>`; }
function visitCard(visit) { return `<div class="visit"><time>${visit.time}</time><div><b>${visit.property}</b><p>${visit.client}</p></div></div>`; }
function propertyCard(property) { return `<article class="property-card"><img src="${property.image}" alt="${property.title}"><div class="property-body"><div class="row between"><span class="status ${property.status.toLowerCase()}">${property.status}</span>${property.highlight ? `<span class="featured">${icons.star} Destacado</span>` : ''}</div><h3>${property.title}</h3><p class="muted">${icons.pin} ${property.location}</p><strong class="price">${formatCurrency(property.price, property.operation)}</strong><div class="features"><span>${icons.bed} ${property.beds || '—'}</span><span>${icons.bath} ${property.baths}</span><span>${property.area} m²</span></div><div class="owner">Propietario: <b>${property.owner}</b></div></div></article>`; }
function renderProperties() { const query = document.querySelector('#property-search').value.toLowerCase(); const operation = document.querySelector('#operation-filter').value; const filtered = properties.filter((property) => `${property.title} ${property.location} ${property.type}`.toLowerCase().includes(query) && (operation === 'Todas' || property.operation === operation)); document.querySelector('#property-grid').innerHTML = filtered.length ? filtered.map(propertyCard).join('') : '<p class="empty-state">No hay inmuebles que coincidan con la búsqueda.</p>'; }

document.querySelector('#property-search').addEventListener('input', renderProperties);
document.querySelector('#operation-filter').addEventListener('change', renderProperties);
renderProperties();
