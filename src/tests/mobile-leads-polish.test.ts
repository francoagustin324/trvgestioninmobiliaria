import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync('index.html', 'utf8');
const css = readFileSync('src/mobile-leads-polish.css', 'utf8');
const layoutCss = readFileSync('src/mobile-layout-fix.css', 'utf8');
const leads = readFileSync('src/mvp-leads-ui.ts', 'utf8');

test('carga el pulido de Leads después de la navegación móvil y de la calificación', () => {
  assert.ok(html.includes('/src/mobile-leads-polish.css?v=20260728-1'));
  assert.ok(html.indexOf('mobile-leads-polish.css') > html.indexOf('mobile-bottom-nav.css'));
  assert.ok(html.indexOf('mobile-leads-polish.css') > html.indexOf('lead-qualification.css'));
});

test('consolida una única fuente móvil para el DOM vigente de Leads', () => {
  assert.ok(css.includes('@media (max-width: 720px)'));
  assert.ok(css.includes('@media (max-width: 520px)'));
  assert.ok(css.includes('#crm .mvp-lead-title-line'));
  assert.ok(css.includes('#crm .mvp-lead-card-main'));
  assert.ok(css.includes('#crm .mvp-lead-primary-action'));
  assert.ok(css.includes('#crm .mvp-lead-secondary-actions'));
  assert.ok(css.includes('#crm .mvp-lead-more-filters'));
  assert.ok(css.includes('#crm .mvp-lead-matches > summary'));
  assert.equal(css.includes('#crm .mvp-lead-name'), false);
  assert.equal(css.includes('#crm .mvp-lead-toolbar'), false);
  assert.equal(layoutCss.includes('.mvp-lead-card'), false);
  assert.equal(layoutCss.includes('.mvp-lead-actions'), false);
});

test('mantiene accesibles contactos y separa acción principal de acciones secundarias', () => {
  assert.ok(css.includes('#crm .mvp-contact-btn'));
  assert.ok(css.includes('#crm .mvp-lead-secondary-actions .mvp-icon-btn'));
  assert.ok(css.includes('#crm .mvp-auto-qualify-button'));
  assert.ok(css.includes('min-height: 44px'));
  assert.ok(leads.includes('class="mvp-lead-quick-row"'));
  assert.ok(leads.includes('class="mvp-lead-card-menu"'));
  assert.ok(leads.includes('class="secondary mvp-lead-toggle"'));
  assert.equal(css.includes('.mvp-contact-btn { display: none'), false);
  assert.equal(css.includes('.mvp-lead-secondary-actions { display: none'), false);
});

test('protege nombres e intereses de cortes carácter por carácter', () => {
  assert.ok(css.includes('word-break: normal'));
  assert.ok(css.includes('overflow-wrap: break-word'));
  assert.ok(css.includes('hyphens: none'));
  const titleRule = css.match(/#crm \.mvp-lead-title-line h3 \{([\s\S]*?)\}/)?.[1] || '';
  const interestRule = css.match(/#crm \.mvp-lead-main-copy > p \{([\s\S]*?)\}/)?.[1] || '';
  assert.equal(titleRule.includes('overflow-wrap: anywhere'), false);
  assert.equal(interestRule.includes('overflow-wrap: anywhere'), false);
});

test('no incorpora frameworks ni afecta datos o seguridad', () => {
  const source = `${html}\n${css}\n${leads}`.toLowerCase();
  assert.equal(source.includes('react'), false);
  assert.equal(source.includes('tailwind'), false);
  assert.equal(source.includes('service_role'), false);
  assert.equal(source.includes('supabase_secret'), false);
});
