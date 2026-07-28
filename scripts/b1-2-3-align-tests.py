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
    "  await sheets.nth(1).locator(':scope > summary').click();\n  assert.equal(await page.locator('#crm .mvp-lead-full-sheet[open]').count(), 1);",
    "  await sheets.nth(1).locator(':scope > summary').click();\n  await page.waitForFunction(() => document.querySelectorAll('#crm .mvp-lead-full-sheet[open]').length === 1);\n  assert.equal(await page.locator('#crm .mvp-lead-full-sheet[open]').count(), 1);",
)
replace(
    'src/tests/b1-2-3-compact-leads-real-app.test.ts',
    "  const selectedClient = await page.locator('#crm .mvp-lead-full-sheet[open]').getAttribute('data-lead-full-sheet');\n  const order = page.locator('#mvp-lead-order');\n  await order.selectOption('name');\n  await page.waitForTimeout(100);\n  assert.equal(await page.locator('#crm .mvp-lead-full-sheet[open]').count(), 1);\n  assert.equal(await page.locator('#crm .mvp-lead-full-sheet[open]').getAttribute('data-lead-full-sheet'), selectedClient);\n  await page.locator('#mvp-lead-order').selectOption('priority');",
    "  const selectedClient = await page.locator('#crm .mvp-lead-full-sheet[open]').getAttribute('data-lead-full-sheet');\n  await page.locator('#crm .mvp-lead-more-filters').evaluate((details: HTMLDetailsElement) => { details.open = true; });\n  const order = page.locator('#mvp-lead-order');\n  await order.selectOption('name');\n  await page.waitForTimeout(100);\n  assert.equal(await page.locator('#crm .mvp-lead-full-sheet[open]').count(), 1);\n  assert.equal(await page.locator('#crm .mvp-lead-full-sheet[open]').getAttribute('data-lead-full-sheet'), selectedClient);\n  await page.locator('#crm .mvp-lead-more-filters').evaluate((details: HTMLDetailsElement) => { details.open = true; });\n  await page.locator('#mvp-lead-order').selectOption('priority');",
)
replace(
    'src/tests/b1-2-3-compact-leads-real-app.test.ts',
    "  await updatedCard.locator('[data-complete-client-follow-up]').click();\n  await page.waitForFunction(() => {\n    const cards = [...document.querySelectorAll<HTMLElement>('#crm .mvp-lead-compact-card')];\n    const card = cards.find((item) => item.textContent?.includes('Seguimiento muy vencido'));\n    return card?.querySelector('.mvp-lead-next-action')?.textContent?.includes('Sin próxima acción') === true;\n  });\n  const completedCard = page.locator('#crm .mvp-lead-compact-card').filter({ hasText: 'Seguimiento muy vencido' });\n  assert.match(await completedCard.locator('.mvp-lead-next-action').innerText(), /Sin próxima acción/);",
    "  await page.evaluate(() => {\n    document.querySelector('#crm')?.addEventListener('click', (event) => {\n      const button = (event.target as HTMLElement).closest<HTMLElement>('[data-complete-client-follow-up]');\n      if (button) document.documentElement.dataset.b123CompleteClick = button.dataset.completeClientFollowUp || '';\n    }, { once: true });\n  });\n  await updatedCard.locator('[data-complete-client-follow-up]').click();\n  await page.waitForTimeout(400);\n  const diagnostic = await page.evaluate(() => {\n    const raw = localStorage.getItem('trv-crm-basico:user:compact-owner');\n    const data = raw ? JSON.parse(raw) as { clients?: Array<{ id: number; nextAction?: string; nextFollowUp?: string }>; activityLog?: Array<{ action?: string; entityId?: number }> } : null;\n    const stored = data?.clients?.find((item) => item.id === 4);\n    const liveButton = document.querySelector<HTMLElement>('[data-complete-client-follow-up=\"4\"]');\n    return {\n      bubbled: document.documentElement.dataset.b123CompleteClick || '',\n      buttonConnected: Boolean(liveButton?.isConnected),\n      menuOpen: Boolean(liveButton?.closest('details')?.hasAttribute('open')),\n      nextAction: stored?.nextAction ?? null,\n      nextFollowUp: stored?.nextFollowUp ?? null,\n      latestActivity: data?.activityLog?.find((item) => item.entityId === 4)?.action ?? null,\n    };\n  });\n  console.log(`B1.2.3 diagnóstico completar seguimiento: ${JSON.stringify(diagnostic)}`);\n  assert.equal(diagnostic.bubbled, '4');\n  assert.equal(diagnostic.nextAction, null);\n  assert.equal(diagnostic.nextFollowUp, null);\n  const completedCard = page.locator('#crm .mvp-lead-compact-card').filter({ hasText: 'Seguimiento muy vencido' });\n  assert.match(await completedCard.locator('.mvp-lead-next-action').innerText(), /Sin próxima acción/);",
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
replace(
    'src/mvp-leads-ui.ts',
    "function saveLeadFollowUp(reason: string, container: HTMLElement): void {\n  saveData(reason);\n  renderMvpLeads(container);\n  document.dispatchEvent(new CustomEvent('trv-render'));\n}",
    "function saveLeadFollowUp(reason: string, container: HTMLElement): void {\n  saveData(reason);\n  renderMvpLeads(container);\n  queueMicrotask(() => document.dispatchEvent(new CustomEvent('trv-render')));\n}",
)
replace(
    'src/mvp-leads-ui.ts',
    "}\n\nfunction bindLeadCardActions(container: HTMLElement): void {",
    "}\n\nconst followUpActionContainers = new WeakSet<HTMLElement>();\n\nfunction bindDelegatedFollowUpActions(container: HTMLElement): void {\n  if (followUpActionContainers.has(container)) return;\n  followUpActionContainers.add(container);\n  container.addEventListener('click', (event) => {\n    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-complete-client-follow-up]');\n    if (!button || !container.contains(button)) return;\n    event.preventDefault();\n    event.stopPropagation();\n    const client = visibleClients().find((item) => item.id === Number(button.dataset.completeClientFollowUp));\n    if (!client || isTerminalClient(client)) return;\n    const result = completeClientFollowUp(client);\n    Object.assign(client, result.client);\n    addActivity(result.activity);\n    saveLeadFollowUp(`Seguimiento de lead completado: ${client.name}`, container);\n  });\n  container.addEventListener('submit', (event) => {\n    const form = (event.target as HTMLElement).closest<HTMLFormElement>('[data-reprogram-client-follow-up]');\n    if (!form || !container.contains(form)) return;\n    event.preventDefault();\n    const client = visibleClients().find((item) => item.id === Number(form.dataset.reprogramClientFollowUp));\n    const date = new FormData(form).get('date')?.toString() || '';\n    if (!client || !date || isTerminalClient(client)) return;\n    const result = reprogramClientFollowUp(client, date);\n    Object.assign(client, result.client);\n    addActivity(result.activity);\n    saveLeadFollowUp(`Seguimiento reprogramado: ${client.name}`, container);\n  });\n}\n\nfunction bindLeadCardActions(container: HTMLElement): void {",
)
replace(
    'src/mvp-leads-ui.ts',
    "  container.querySelectorAll<HTMLButtonElement>('[data-complete-client-follow-up]').forEach((button) => {\n    button.addEventListener('click', () => {\n      const client = visibleClients().find((item) => item.id === Number(button.dataset.completeClientFollowUp));\n      if (!client || isTerminalClient(client)) return;\n      const result = completeClientFollowUp(client);\n      Object.assign(client, result.client);\n      addActivity(result.activity);\n      saveLeadFollowUp(`Seguimiento de lead completado: ${client.name}`, container);\n    });\n  });\n  container.querySelectorAll<HTMLFormElement>('[data-reprogram-client-follow-up]').forEach((form) => {\n    form.addEventListener('submit', (event) => {\n      event.preventDefault();\n      const client = visibleClients().find((item) => item.id === Number(form.dataset.reprogramClientFollowUp));\n      const date = new FormData(form).get('date')?.toString() || '';\n      if (!client || !date || isTerminalClient(client)) return;\n      const result = reprogramClientFollowUp(client, date);\n      Object.assign(client, result.client);\n      addActivity(result.activity);\n      saveLeadFollowUp(`Seguimiento reprogramado: ${client.name}`, container);\n    });\n  });",
    "  bindDelegatedFollowUpActions(container);",
)
