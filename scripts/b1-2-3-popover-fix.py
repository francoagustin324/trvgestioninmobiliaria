from pathlib import Path

css_path = Path('src/lead-list-compact.css')
css = css_path.read_text()
old_css = """  #crm .mvp-lead-followup-popover {
    position: fixed;
    right: 12px;
    bottom: calc(var(--pc-mobile-nav-clearance,120px) - 18px);
    top: auto;
    width: calc(100vw - 24px);
  }"""
new_css = """  #crm .mvp-lead-followup-popover {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    bottom: auto;
    width: min(300px, calc(100vw - 32px));
  }"""
if new_css not in css:
    if old_css not in css:
        raise SystemExit('No se encontró el posicionamiento móvil del seguimiento.')
    css = css.replace(old_css, new_css, 1)

card_rule = """#crm .mvp-lead-compact-card:has(.mvp-lead-followup-menu[open]) {
  position: relative;
  z-index: 140;
}

"""
marker = "#crm .mvp-lead-followup-menu[open] {"
if card_rule not in css:
    if marker not in css:
        raise SystemExit('No se encontró el marcador del menú abierto.')
    css = css.replace(marker, card_rule + marker, 1)
css_path.write_text(css)

ui_path = Path('src/mvp-leads-ui.ts')
ui = ui_path.read_text()
old_ui = """  container.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-complete-client-follow-up]');
    if (!button || !container.contains(button)) return;"""
new_ui = """  container.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const followUpSummary = target.closest<HTMLElement>('.mvp-lead-followup-menu > summary');
    if (followUpSummary && container.contains(followUpSummary)) {
      const details = followUpSummary.closest<HTMLDetailsElement>('.mvp-lead-followup-menu');
      window.requestAnimationFrame(() => {
        if (details?.open) details.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'nearest' });
      });
      return;
    }
    const button = target.closest<HTMLButtonElement>('[data-complete-client-follow-up]');
    if (!button || !container.contains(button)) return;"""
if new_ui not in ui:
    if old_ui not in ui:
        raise SystemExit('No se encontró el listener delegado del seguimiento.')
    ui_path.write_text(ui.replace(old_ui, new_ui, 1))
