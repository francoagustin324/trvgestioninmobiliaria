from pathlib import Path

css_path = Path('src/lead-list-compact.css')
css = css_path.read_text()
stacking_rules = """#crm .mvp-lead-compact-card:has(.mvp-lead-followup-menu[open]) {
  position: relative;
  z-index: 140;
}

#crm .mvp-lead-followup-menu[open] {
  z-index: 130;
}

#crm .mvp-lead-followup-menu[open] > .mvp-lead-followup-popover {
  z-index: 131;
}

"""
inline_rules = """#crm .mvp-lead-next-action:has(.mvp-lead-followup-menu[open]) {
  grid-template-columns: 1fr;
}

#crm .mvp-lead-followup-menu[open] {
  display: grid;
  width: 100%;
  gap: 7px;
}

#crm .mvp-lead-followup-menu[open] > summary {
  justify-self: end;
}

"""
if inline_rules not in css:
    if stacking_rules in css:
        css = css.replace(stacking_rules, inline_rules, 1)
    else:
        marker = "#crm .mvp-lead-followup-menu:not([open]) > .mvp-lead-followup-popover,"
        if marker not in css:
            raise SystemExit('No se encontró el marcador del menú de seguimiento.')
        css = css.replace(marker, inline_rules + marker, 1)

fixed_css = """  #crm .mvp-lead-followup-popover {
    position: fixed;
    right: 12px;
    bottom: calc(var(--pc-mobile-nav-clearance,120px) - 18px);
    top: auto;
    width: calc(100vw - 24px);
  }"""
absolute_css = """  #crm .mvp-lead-followup-popover {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    bottom: auto;
    width: min(300px, calc(100vw - 32px));
  }"""
inline_css = """  #crm .mvp-lead-followup-popover {
    position: static;
    width: 100%;
    box-shadow: none;
  }"""
if inline_css not in css:
    if absolute_css in css:
        css = css.replace(absolute_css, inline_css, 1)
    elif fixed_css in css:
        css = css.replace(fixed_css, inline_css, 1)
    else:
        raise SystemExit('No se encontró el posicionamiento móvil del seguimiento.')
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
