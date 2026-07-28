from pathlib import Path


def replace(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    if new in text:
        return
    if old not in text:
        raise SystemExit(f'No se encontró el bloque esperado en {path}: {old}')
    file.write_text(text.replace(old, new, 1))


replace(
    'src/tests/b1-2-1-essential-qualification.test.ts',
    'assert.match(leads, /renderLeadCommercialSummary/);',
    'assert.match(leads, /renderCompactLeadCard/);',
)
replace(
    'src/tests/b1-2-lead-qualification.test.ts',
    'assert.match(leads, /Calificar automáticamente/);',
    "assert.match(readFileSync('src/lead-card-compact-ui.ts', 'utf8'), /Calificar automáticamente/);",
)
replace(
    'src/tests/mobile-leads-polish.test.ts',
    "const leads = readFileSync('src/mvp-leads-ui.ts', 'utf8');",
    "const leads = readFileSync('src/mvp-leads-ui.ts', 'utf8');\nconst compactCss = readFileSync('src/lead-list-compact.css', 'utf8');\nconst compactCard = readFileSync('src/lead-card-compact-ui.ts', 'utf8');",
)
replace(
    'src/tests/mobile-leads-polish.test.ts',
    "  assert.ok(html.indexOf('mobile-leads-polish.css') > html.indexOf('lead-qualification.css'));",
    "  assert.ok(html.indexOf('mobile-leads-polish.css') > html.indexOf('lead-qualification.css'));\n  assert.ok(html.indexOf('lead-list-compact.css') > html.indexOf('mobile-leads-polish.css'));",
)
replace(
    'src/tests/mobile-leads-polish.test.ts',
    "  assert.ok(leads.includes('class=\"mvp-lead-primary-action\"'));\n  assert.ok(leads.includes('class=\"mvp-lead-actions mvp-lead-secondary-actions\"'));",
    "  assert.ok(compactCard.includes('class=\"mvp-lead-quick-actions\"'));\n  assert.ok(compactCard.includes('class=\"mvp-lead-full-actions\"'));\n  assert.ok(compactCss.includes('.mvp-lead-full-sheet:not([open])'));",
)
replace(
    'src/tests/mobile-leads-polish.test.ts',
    "  const source = `${html}\\n${css}\\n${leads}`.toLowerCase();",
    "  const source = `${html}\\n${css}\\n${compactCss}\\n${leads}\\n${compactCard}`.toLowerCase();",
)
replace(
    'src/tests/mvp-leads-heading.test.ts',
    "  assert.ok(leads.includes('Calificá lo esencial, definí la próxima acción y avanzá cada oportunidad sin interrogatorios.'));",
    "  assert.ok(leads.includes('Priorizá a quién contactar, resolvé la próxima acción y abrí la ficha completa solo cuando haga falta.'));",
)
replace(
    'src/tests/b1-2-3-compact-leads-real-app.test.ts',
    "    const controls = [...document.querySelectorAll<HTMLElement>('#crm .mvp-lead-compact-card button, #crm .mvp-lead-compact-card a.mvp-contact-btn, #crm .mvp-lead-full-sheet > summary, #crm .mvp-lead-followup-menu > summary')];",
    "    const controls = [...document.querySelectorAll<HTMLElement>('#crm .mvp-lead-compact-card button, #crm .mvp-lead-compact-card a.mvp-contact-btn, #crm .mvp-lead-full-sheet > summary, #crm .mvp-lead-followup-menu > summary')]\n      .filter((control) => control.getClientRects().length > 0);",
)
