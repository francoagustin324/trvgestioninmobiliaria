import { escapeHtml } from './utils.js';

interface MessageTemplate {
  id: string;
  name: string;
  category: 'Utilidad' | 'Marketing' | 'Autenticación';
  language: string;
  status: 'Aprobada' | 'En revisión' | 'Rechazada';
  body: string;
  variables: string[];
}

const templates: MessageTemplate[] = [
  {
    id: 'seguimiento_consulta_propiedad',
    name: 'Seguimiento de consulta',
    category: 'Utilidad',
    language: 'Español (AR)',
    status: 'Aprobada',
    body: 'Hola {{1}}, te escribimos por tu consulta sobre {{2}}. ¿Seguís buscando una propiedad?',
    variables: ['Nombre', 'Propiedad o zona'],
  },
  {
    id: 'nueva_propiedad_disponible',
    name: 'Nueva propiedad disponible',
    category: 'Marketing',
    language: 'Español (AR)',
    status: 'En revisión',
    body: 'Hola {{1}}, ingresó una propiedad en {{2}} que puede coincidir con tu búsqueda. ¿Querés recibir la información?',
    variables: ['Nombre', 'Zona'],
  },
];

function statusClass(status: MessageTemplate['status']): string {
  return status.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function templateCard(template: MessageTemplate): string {
  return `<article class="meta-template-card"><header><div><span>${escapeHtml(template.category)}</span><h3>${escapeHtml(template.name)}</h3><small>${escapeHtml(template.id)} · ${escapeHtml(template.language)}</small></div><strong class="template-status ${statusClass(template.status)}">${escapeHtml(template.status)}</strong></header><div class="template-preview"><p>${escapeHtml(template.body)}</p></div><div class="template-variables"><span>Variables</span>${template.variables.map((variable, index) => `<b>{{${index + 1}}} ${escapeHtml(variable)}</b>`).join('')}</div><footer><button type="button" class="secondary" disabled>${template.status === 'Aprobada' ? 'Usar al conectar Meta' : 'No disponible'}</button></footer></article>`;
}

export function appendMessageTemplates(container: HTMLElement): void {
  const existing = container.querySelector('[data-meta-templates]');
  if (existing) existing.remove();
  const section = document.createElement('section');
  section.dataset.metaTemplates = 'true';
  section.className = 'meta-templates-section';
  section.innerHTML = `<div class="mvp-section-heading"><div><h2>Plantillas de Meta</h2><p>Para iniciar una conversación fuera de la ventana de atención se utiliza una plantilla aprobada por Meta.</p></div><button type="button" class="secondary" disabled>Sincronizar con Meta</button></div><div class="meta-template-filters"><button type="button" class="active">Todas</button><button type="button">Aprobadas</button><button type="button">En revisión</button></div><div class="meta-template-grid">${templates.map(templateCard).join('')}</div><p class="meta-template-note">En el MVP estas tarjetas muestran la organización final. La creación, aprobación y sincronización real se habilitarán al conectar WhatsApp Business Platform.</p>`;
  container.append(section);
}