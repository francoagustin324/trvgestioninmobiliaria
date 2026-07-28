import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync('index.html', 'utf8');
const css = readFileSync('src/mobile-leads-polish.css', 'utf8');
const compactCss = readFileSync('src/lead-list-compact.css', 'utf8');
const layoutCss = readFileSync('src/mobile-layout-fix.css', 'utf8');
const leads = readFileSync('src/mvp-leads-ui.ts', 'utf8');

test('carga el pulido de Leads después de la navegación móvil y de la calificación', () => {
  assert.ok(html.includes('/src/mobile-leads-polish.css?v=20260728-1'));
  assert.ok(html.includes('/src/lead-list-compact.css?v=20260728-1'));
  assert.ok(html.indexOf('mobile-leads-polish.css') > html.indexOf('mobile-bottom-nav.css'));
  assert.ok(html.indexOf('mobile-leads-polish.css') > html.indexOf('lead-qualification.css'));
});

test('consolida una fuente móvil vigente y una capa compacta explícita', () => {
  assert.ok(css.includes('@media (max-width: 720px)'));
  assert.ok(css.includes('@media (max-width: 520px)'));
  assert.ok(css.includes('#crm .mvp-lead-title-line'));
  assert.ok(compactCss.includes('.compact-lead-card'));
  assert.ok(compactCss.includes('.compact-lead-expanded[hidden]'));
  assert.ok(compactCss.includes('.compact-lead-actions'));
  assert.equal(css.includes('#crm .mvp-lead-name'), false);
  assert.equal(css.includes('#crm .mvp-lead-toolbar'), false);
  assert.equal(layoutCss.includes('.mvp-lead-card'), false);
  assert.equal(layoutCss.includes('.mvp-lead-actions'), false);
});

test('mantiene accesibles contactos y separa acción principal de acciones secundarias', () => {
  assert.ok(css.includes('#crm .mvp-contact-btn'));
  assert.ok(compactCss.includes('.compact-lead-secondary .mvp-icon-btn'));
  assert.ok(compactCss.includes('min-width:44px'));
  assert.ok(leads.includes('class="compact-lead-actions"'));
  assert.ok(leads.includes('class="compact-lead-secondary"'));
  assert.ok(leads.includes('class="secondary mvp-auto-qualify-button"'));
  assert.equal(css.includes('.mvp-contact-btn { display: none'), false);
});

test('protege nombres e intereses de cortes carácter por carácter', () => {
  assert.ok(css.includes('word-break: normal'));
  assert.ok(css.includes('overflow-wrap: break-word'));
  assert.ok(css.includes('hyphens: none'));
  assert.ok(compactCss.includes('word-break:normal'));
  assert.ok(compactCss.includes('overflow-wrap:normal'));
  const titleRule = css.match(/#crm \.mvp-lead-title-line h3 \{([\s\S]*?)\}/)?.[1] || '';
  const interestRule = css.match(/#crm \.mvp-lead-main-copy > p \{([\s\S]*?)\}/)?.[1] || '';
  assert.equal(titleRule.includes('overflow-wrap: anywhere'), false);
  assert.equal(interestRule.includes('overflow-wrap: anywhere'), false);
});

test('no incorpora frameworks ni afecta datos o seguridad', () => {
  const source = `${html}\n${css}\n${compactCss}\n${leads}`.toLowerCase();
  assert.equal(source.includes('react'), false);
  assert.equal(source.includes('tailwind'), false);
  assert.equal(source.includes('service_role'), false);
  assert.equal(source.includes('supabase_secret'), false);
});
