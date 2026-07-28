from pathlib import Path


def replace(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    if new and new in text:
        return
    if old not in text:
        if not new:
            return
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
replace(
    'src/tests/b1-2-3-compact-leads-real-app.test.ts',
    "  await sheets.nth(0).locator('summary').click();\n  assert.equal(await page.locator('#crm .mvp-lead-full-sheet[open]').count(), 1);\n  await sheets.nth(1).locator('summary').click();",
    "  await sheets.nth(0).locator(':scope > summary').click();\n  assert.equal(await page.locator('#crm .mvp-lead-full-sheet[open]').count(), 1);\n  await sheets.nth(1).locator(':scope > summary').click();",
)
replace(
    'src/tests/b1-2-3-compact-leads-real-app.test.ts',
    "  const selectedClient = await page.locator('#crm .mvp-lead-full-sheet[open]').getAttribute('data-lead-full-sheet');\n  const order = page.locator('#mvp-lead-order');\n  await order.selectOption('name');\n  await page.waitForTimeout(100);\n  assert.equal(await page.locator('#crm .mvp-lead-full-sheet[open]').count(), 1);\n  assert.equal(await page.locator('#crm .mvp-lead-full-sheet[open]').getAttribute('data-lead-full-sheet'), selectedClient);\n  await page.locator('#mvp-lead-order').selectOption('priority');",
    "  const selectedClient = await page.locator('#crm .mvp-lead-full-sheet[open]').getAttribute('data-lead-full-sheet');\n  await page.locator('#crm .mvp-lead-more-filters').evaluate((details: HTMLDetailsElement) => { details.open = true; });\n  const order = page.locator('#mvp-lead-order');\n  await order.selectOption('name');\n  await page.waitForTimeout(100);\n  assert.equal(await page.locator('#crm .mvp-lead-full-sheet[open]').count(), 1);\n  assert.equal(await page.locator('#crm .mvp-lead-full-sheet[open]').getAttribute('data-lead-full-sheet'), selectedClient);\n  await page.locator('#crm .mvp-lead-more-filters').evaluate((details: HTMLDetailsElement) => { details.open = true; });\n  await page.locator('#mvp-lead-order').selectOption('priority');",
)
replace(
    'src/tests/b1-2-3-compact-leads-real-app.test.ts',
    "    assert.ok(fullLeadHeight >= 320 && fullLeadHeight <= 450, `Tarjeta cerrada fuera de 320-450px: ${fullLeadHeight}`);",
    "    assert.ok(fullLeadHeight >= 320 && fullLeadHeight <= 450, `Tarjeta cerrada fuera de 320-450px: ${fullLeadHeight}`);\n    console.log(`B1.2.3 altura tarjeta cerrada 390: ${fullLeadHeight.toFixed(2)}px`);",
)
replace(
    'src/lead-list-compact.css',
    "  #crm .mvp-lead-quick-actions .mvp-auto-qualify-button {\n    width: 100%;\n    flex-basis: 100%;\n  }",
    "  #crm .mvp-lead-quick-actions .mvp-auto-qualify-button {\n    min-width: 0;\n    width: auto;\n    flex: 1 1 160px;\n  }",
)
replace(
    'src/lead-list-compact.css',
    "  #crm .mvp-lead-compact-facts,\n  #crm .mvp-lead-full-grid {\n    grid-template-columns: 1fr;\n  }\n\n  #crm .mvp-lead-compact-facts > div:last-child {\n    grid-column: 1;\n  }",
    "  #crm .mvp-lead-compact-header {\n    grid-template-columns: 1fr;\n  }\n\n  #crm .mvp-lead-compact-facts {\n    grid-template-columns: repeat(2,minmax(0,1fr));\n  }\n\n  #crm .mvp-lead-compact-facts > div:last-child {\n    grid-column: 1 / -1;\n  }\n\n  #crm .mvp-lead-full-grid {\n    grid-template-columns: 1fr;\n  }\n\n  #crm .mvp-lead-quick-actions .mvp-auto-qualify-button {\n    width: 100%;\n    flex-basis: 100%;\n  }",
)
replace(
    'src/lead-list-compact.css',
    "  #crm .mvp-lead-compact-card {\n    gap: 10px !important;\n    padding: 14px;\n  }",
    "  #crm .mvp-lead-compact-card {\n    gap: 7px !important;\n    padding: 12px;\n  }",
)
replace(
    'src/lead-list-compact.css',
    "@media (max-width: 520px) {\n  #crm .mvp-lead-alert {",
    "@media (max-width: 520px) {\n  #crm .mvp-lead-compact-header {\n    grid-template-columns: 1fr;\n  }\n\n  #crm .mvp-lead-compact-facts {\n    grid-template-columns: repeat(2,minmax(0,1fr));\n  }\n\n  #crm .mvp-lead-compact-facts > div:last-child {\n    grid-column: 1 / -1;\n  }\n\n  #crm .mvp-lead-alert {",
)
