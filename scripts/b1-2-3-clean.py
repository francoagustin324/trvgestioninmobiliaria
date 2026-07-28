from pathlib import Path
import re

path = Path('src/mvp-leads-ui.ts')
text = path.read_text()

line = "import { followUpDisplay, primaryLeadAlert, readableResponsible, relativeCommercialDate, sortLeads, type LeadSort } from './lead-list-priority.js';\n"
while line + line in text:
    text = text.replace(line + line, line)

pattern = re.compile(r"function expandedDetails\(client: Client\): string \{[\s\S]*?\n\}")
matches = list(pattern.finditer(text))
if len(matches) > 1:
    for match in reversed(matches[1:]):
        text = text[:match.start()] + text[match.end():]

active = "  if (filters.assignedTo !== 'Todos') active.push(`Responsable: ${readableResponsible({ assignedToId: filters.assignedTo } as Client, state.crm.teamMembers, state.crm.settings.profileName, state.crm.settings.profileEmail)}`);\n  if (filters.order !== 'priority') active.push(`Orden: ${filters.order}`);\n"
while active + active in text:
    text = text.replace(active + active, active)

block = """  container.querySelector<HTMLSelectElement>('#mvp-lead-assigned-filter')?.addEventListener('change', (event) => {
    const value = (event.currentTarget as HTMLSelectElement).value;
    filters.assignedTo = value === 'Todos' ? 'Todos' : Number(value);
    renderMvpLeads(container);
  });
  container.querySelector<HTMLSelectElement>('#mvp-lead-order')?.addEventListener('change', (event) => {
    filters.order = (event.currentTarget as HTMLSelectElement).value as LeadSort;
    renderMvpLeads(container);
  });
  container.querySelector<HTMLButtonElement>('[data-clear-lead-filters]')?.addEventListener('click', () => {
    filters = { search: '', stage: 'Todas', temperature: 'Todas', overdueOnly: false, missingNextActionOnly: false, assignedTo: 'Todos', order: 'priority' };
    renderMvpLeads(container);
  });
  const pipeline = container.querySelector<HTMLElement>('.mvp-stage-counters');
  const updatePipelineEdges = (): void => {
    if (!pipeline) return;
    pipeline.classList.toggle('can-scroll-left', pipeline.scrollLeft > 2);
    pipeline.classList.toggle('can-scroll-right', pipeline.scrollLeft + pipeline.clientWidth < pipeline.scrollWidth - 2);
  };
  pipeline?.addEventListener('scroll', updatePipelineEdges, { passive: true });
  updatePipelineEdges();
"""
while block + block in text:
    text = text.replace(block + block, block)

path.write_text(text)
