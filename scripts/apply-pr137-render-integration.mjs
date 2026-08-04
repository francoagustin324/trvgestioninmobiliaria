import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';

function replaceOnce(path, before, after) {
  const source = readFileSync(path, 'utf8');
  if (source.includes(after)) return;
  if (!source.includes(before)) throw new Error(`No se encontró el bloque esperado en ${path}`);
  writeFileSync(path, source.replace(before, after));
}

replaceOnce(
  'src/leads-professional-redesign.ts',
  `  const create = heading.querySelector<HTMLButtonElement>('[data-toggle="client-form"]');`,
  `  const create = container.querySelector<HTMLButtonElement>('[data-toggle="client-form"]');`,
);

replaceOnce(
  'src/leads-professional-redesign.ts',
  `function enhanceLeads(): void {\n  scheduled = false;\n  const container = document.querySelector<HTMLElement>('#crm');\n  if (!container) return;\n  container.classList.add('pc-leads-redesign');\n  enhanceHeading(container);\n  enhanceFilterPanel(container);\n  enhanceStageSummary(container);\n  enhanceLeadCards(container);\n  organizeLeadForm();\n  applyAttention(container);\n}\n`,
  `export function enhanceLeadsProfessionalRedesign(container: HTMLElement): void {\n  container.classList.add('pc-leads-redesign');\n  enhanceHeading(container);\n  enhanceFilterPanel(container);\n  enhanceStageSummary(container);\n  enhanceLeadCards(container);\n  organizeLeadForm();\n  applyAttention(container);\n}\n\nfunction enhanceLeads(): void {\n  scheduled = false;\n  const container = document.querySelector<HTMLElement>('#crm');\n  if (!container) return;\n  enhanceLeadsProfessionalRedesign(container);\n}\n`,
);

replaceOnce(
  'src/mvp-leads-ui.ts',
  `import { enhanceLeadList } from './lead-list-polish-ui.js';\n`,
  `import { enhanceLeadList } from './lead-list-polish-ui.js';\nimport { enhanceLeadsProfessionalRedesign } from './leads-professional-redesign.js';\nimport { prepareLeadsProfessionalRedesign } from './leads-professional-redesign-blocking-fix.js';\n`,
);

replaceOnce(
  'src/mvp-leads-ui.ts',
  `  enhanceLeadList(container, { centerSelectedStage });\n  enhanceLeadForm();\n}\n`,
  `  enhanceLeadList(container, { centerSelectedStage });\n  enhanceLeadForm();\n  prepareLeadsProfessionalRedesign(container);\n  enhanceLeadsProfessionalRedesign(container);\n}\n`,
);

replaceOnce(
  'src/leads-professional-redesign-blocking-fix.ts',
  `let synchronizationScheduled = false;\nlet initialPreparationFrame: number | null = null;\nlet initialEnhancementSignalSent = false;\n`,
  `let synchronizationScheduled = false;\n`,
);

replaceOnce(
  'src/leads-professional-redesign-blocking-fix.ts',
  `function prepareInitialLeadsBeforePaint(): void {\n  initialPreparationFrame = null;\n  const crm = document.querySelector<HTMLElement>('#crm');\n  if (crm?.querySelector('#mvp-lead-results')) {\n    prepareLeadsProfessionalRedesign(crm);\n    if (!initialEnhancementSignalSent) {\n      initialEnhancementSignalSent = true;\n      document.dispatchEvent(new CustomEvent('trv-render'));\n    }\n    if (crm.querySelector('[data-pc-attention-section]')) return;\n  } else if (location.pathname !== '/' && location.pathname !== '') {\n    return;\n  }\n  initialPreparationFrame = window.requestAnimationFrame(prepareInitialLeadsBeforePaint);\n}\n\n`,
  ``,
);

replaceOnce(
  'src/leads-professional-redesign-blocking-fix.ts',
  `\n  if (initialPreparationFrame === null) {\n    initialPreparationFrame = window.requestAnimationFrame(prepareInitialLeadsBeforePaint);\n  }\n`,
  `\n`,
);

const cssPath = 'src/leads-professional-redesign-final-fix.css';
const cssMarker = '/* PR #137: correcciones causales finales */';
let css = readFileSync(cssPath, 'utf8');
if (!css.includes(cssMarker)) {
  css += `\n${cssMarker}\n@media (max-width: 720px) {\n  #crm .mvp-lead-filter-panel :is(input, select) {\n    color: #eef4f0;\n    border-color: rgba(222, 197, 147, 0.34);\n    background: #0b3024;\n  }\n\n  #crm .mvp-lead-filter-panel input::placeholder {\n    color: #b6c8be;\n    opacity: 1;\n  }\n\n  #crm.pc-leads-redesign .pc-stage-summary[data-expanded="false"] [data-pc-secondary-stage]:not(.active):not([aria-pressed="true"]):not(.pc-selected-stage) {\n    display: flex;\n  }\n}\n\n@media (min-width: 901px) {\n  #crm.pc-leads-redesign .pc-lead-controls {\n    grid-template-columns: minmax(0, 1fr);\n    grid-auto-rows: auto;\n    align-content: start;\n  }\n\n  #crm.pc-leads-redesign .pc-lead-controls > *,\n  #crm.pc-leads-redesign .mvp-lead-filter-primary,\n  #crm.pc-leads-redesign .mvp-lead-active-filters,\n  #crm.pc-leads-redesign .mvp-lead-more-filters,\n  #crm.pc-leads-redesign .pc-attention-section,\n  #crm.pc-leads-redesign .pc-stage-summary {\n    grid-column: 1 / -1;\n    min-height: 0;\n  }\n\n  #crm.pc-leads-redesign .pc-attention-grid {\n    grid-template-columns: repeat(4, minmax(0, 1fr));\n  }\n}\n`;
  writeFileSync(cssPath, css);
}

replaceOnce(
  'src/tests/leads-professional-redesign.test.ts',
  `  await load(page, url);\n  await assertInitialHierarchy(page);\n  await assertNoHorizontalScroll(page);\n  await screenshot(page, '01-leads-desktop-1366x768-inicial.png');\n`,
  `  await load(page, url);\n  await screenshot(page, '01-leads-desktop-1366x768-inicial.png');\n  await assertInitialHierarchy(page);\n  await assertNoHorizontalScroll(page);\n`,
);

const workflowPath = '.github/workflows/ci.yml';
let workflow = readFileSync(workflowPath, 'utf8');
workflow = workflow.replace(`permissions:\n  contents: write\n\n`, '');
workflow = workflow.replace(/      - name: Aplicar integración causal PR #137[\s\S]*?          git push origin HEAD:"\$BRANCH"\n/, '');
workflow = workflow.replace(/      - name: Adjuntar snapshot temporal del PR[\s\S]*?          retention-days: 1\n/, '');
writeFileSync(workflowPath, workflow);

unlinkSync('scripts/apply-pr137-render-integration.mjs');
