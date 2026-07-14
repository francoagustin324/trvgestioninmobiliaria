import { escapeHtml } from './utils.js';

interface MessageTemplate {
  id: string;
  name: string;
  category: 'Utilidad' | 'Marketing' | 'Autenticación';
  language: string;
  status: 'Aprobada' | 'En revisión' | 'Rechazada';
  quality: 'Alta' | 'Pendiente' | 'No disponible';
  body: string;
  variables: string[];
  buttons: string[];
  updatedAt: string;
}

type TemplateFilter = 'Todas' | MessageTemplate['status'];

let templateFilter: TemplateFilter = 'Todas';
let templateSearch = '';
let selectedTemplateId = 'seguimiento_consulta_propiedad';

const templates: MessageTemplate[] = [
  {
    id: 'seguimiento_consulta_propiedad',
    name: 'Seguimiento de consulta',
    category: 'Marketing',
    language: 'Español (AR)',
    status: 'Aprobada',
    quality: 'Alta',
    body: 'Hola {{1}}, te escribimos por tu consulta sobre {{2}}. ¿Seguís buscando una propiedad?',
    variables: ['Nombre del lead', 'Propiedad o zona'],
    buttons: ['Sí, sigo buscando', 'Hablar con un asesor'],
    updatedAt: '12 jul 2026',
  },
  {
    id: 'confirmacion_visita',
    name: 'Confirmación de visita',
    category: 'Utilidad',
    language: 'Español (AR)',
    status: 'Aprobada',
    quality: 'Alta',
    body: 'Hola {{1}}, confirmamos la visita a {{2}} para el {{3}} a las {{4}}. Respondé este mensaje si necesitás reprogramarla.',
    variables: ['Nombre', 'Propiedad', 'Fecha', 'Hora'],
    buttons: ['Confirmar', 'Reprogramar'],
    updatedAt: '10 jul 2026',
  },
  {
    id: 'nueva_propiedad_compatible',
    name: 'Nueva propiedad compatible',
    category: 'Marketing',
    language: 'Español (AR)',
    status: 'En revisión',
    quality: 'Pendiente',
    body: 'Hola {{1}}, ingresó una propiedad en {{2}} que coincide con tu búsqueda y presupuesto. ¿Querés recibir la información?',
    variables: ['Nombre', 'Zona'],
    buttons: ['Ver propiedad', 'No me interesa'],
    updatedAt: '13 jul 2026',
  },
  {
    id: 'recontacto_sin_contexto',
    name: 'Recontacto general',
    category: 'Marketing',
    language: 'Español (AR)',
    status: 'Rechazada',
    quality: 'No disponible',
    body: 'Hola {{1}}, tenemos nuevas oportunidades para vos. ¿Querés conocerlas?',
    variables: ['Nombre'],
    buttons: [],
    updatedAt: '9 jul 2026',
  },
];

function normalizedClass(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-');
}

function filteredTemplates(): MessageTemplate[] {
  const query = templateSearch.trim().toLowerCase();
  return templates.filter((template) => {
    const matchesStatus = templateFilter === 'Todas' || template.status === templateFilter;
    const matchesSearch = !query || [template.name, template.id, template.category, template.language]
      .some((value) => value.toLowerCase().includes(query));
    return matchesStatus && matchesSearch;
  });
}

function templateRow(template: MessageTemplate): string {
  const selected = selectedTemplateId === template.id;
  return `<button type="button" class="meta-template-row${selected ? ' active' : ''}" data-template-id="${escapeHtml(template.id)}">
    <span class="meta-template-main"><b>${escapeHtml(template.name)}</b><small>${escapeHtml(template.id)}</small></span>
    <span>${escapeHtml(template.category)}</span>
    <span>${escapeHtml(template.language)}</span>
    <span class="template-status ${normalizedClass(template.status)}">${escapeHtml(template.status)}</span>
    <span class="template-quality ${normalizedClass(template.quality)}">${escapeHtml(template.quality)}</span>
    <time>${escapeHtml(template.updatedAt)}</time>
  </button>`;
}

function templatePreview(template: MessageTemplate | undefined): string {
  if (!template) return '<div class="meta-template-empty"><p>No hay plantillas con esos filtros.</p></div>';
  return `<aside class="meta-template-detail">
    <header><div><span>${escapeHtml(template.category)}</span><h2>${escapeHtml(template.name)}</h2><small>${escapeHtml(template.id)} · ${escapeHtml(template.language)}</small></div><strong class="template-status ${normalizedClass(template.status)}">${escapeHtml(template.status)}</strong></header>
    <section><span class="meta-detail-label">Vista previa</span><div class="meta-phone-preview"><p>${escapeHtml(template.body)}</p>${template.buttons.map((button) => `<button type="button" disabled>${escapeHtml(button)}</button>`).join('')}</div></section>
    <section><span class="meta-detail-label">Variables</span><div class="template-variables">${template.variables.map((variable, index) => `<b>{{${index + 1}}} ${escapeHtml(variable)}</b>`).join('') || '<small>Sin variables</small>'}</div></section>
    <dl><div><dt>Categoría</dt><dd>${escapeHtml(template.category)}</dd></div><div><dt>Calidad</dt><dd>${escapeHtml(template.quality)}</dd></div><div><dt>Última actualización</dt><dd>${escapeHtml(template.updatedAt)}</dd></div></dl>
    <button type="button" disabled>${template.status === 'Aprobada' ? 'Usar al conectar Meta' : 'Plantilla no disponible'}</button>
  </aside>`;
}

export function renderMessageTemplates(container: HTMLElement): void {
  const visible = filteredTemplates();
  if (!visible.some((template) => template.id === selectedTemplateId)) selectedTemplateId = visible[0]?.id ?? '';
  const selected = templates.find((template) => template.id === selectedTemplateId);
  container.innerHTML = `<section class="meta-template-manager">
    <div class="mvp-section-heading"><div><h2>Plantillas de Meta</h2><p>Para iniciar o retomar una conversación fuera de la ventana de atención se usa una plantilla aprobada.</p></div><button type="button" disabled>Nueva plantilla</button></div>
    <div class="meta-template-toolbar"><label><span>Buscar</span><input type="search" value="${escapeHtml(templateSearch)}" placeholder="Nombre o identificador" data-template-search></label><div class="meta-template-filters">${(['Todas', 'Aprobada', 'En revisión', 'Rechazada'] as TemplateFilter[]).map((filter) => `<button type="button" class="${templateFilter === filter ? 'active' : ''}" data-template-filter="${escapeHtml(filter)}">${escapeHtml(filter)}</button>`).join('')}</div></div>
    <div class="meta-template-workspace"><div class="meta-template-table"><div class="meta-template-columns"><span>Nombre</span><span>Categoría</span><span>Idioma</span><span>Estado</span><span>Calidad</span><span>Actualizada</span></div><div>${visible.map(templateRow).join('') || '<p class="empty-state">No hay plantillas con esos filtros.</p>'}</div></div>${templatePreview(selected)}</div>
    <p class="meta-template-note">La lista es una vista de trabajo del MVP. La sincronización, creación y envío real se habilitarán cuando WhatsApp Business Platform esté conectada.</p>
  </section>`;

  container.querySelector<HTMLInputElement>('[data-template-search]')?.addEventListener('input', (event) => {
    templateSearch = (event.currentTarget as HTMLInputElement).value;
    renderMessageTemplates(container);
    window.requestAnimationFrame(() => container.querySelector<HTMLInputElement>('[data-template-search]')?.focus());
  });
  container.querySelectorAll<HTMLButtonElement>('[data-template-filter]').forEach((button) => button.addEventListener('click', () => {
    templateFilter = (button.dataset.templateFilter || 'Todas') as TemplateFilter;
    renderMessageTemplates(container);
  }));
  container.querySelectorAll<HTMLButtonElement>('[data-template-id]').forEach((button) => button.addEventListener('click', () => {
    selectedTemplateId = button.dataset.templateId || '';
    renderMessageTemplates(container);
  }));
}

export function appendMessageTemplates(container: HTMLElement): void {
  const section = document.createElement('section');
  section.dataset.metaTemplates = 'true';
  renderMessageTemplates(section);
  container.append(section);
}
