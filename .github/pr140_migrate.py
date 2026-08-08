from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    n = text.count(old)
    if n != 1:
        raise SystemExit(f'{path}: esperaba 1 coincidencia y encontré {n}: {old[:140]!r}')
    p.write_text(text.replace(old, new, 1))


def replace_all(path: str, old: str, new: str, minimum: int = 1) -> None:
    p = Path(path)
    text = p.read_text()
    n = text.count(old)
    if n < minimum:
        raise SystemExit(f'{path}: esperaba >= {minimum} coincidencias y encontré {n}: {old[:140]!r}')
    p.write_text(text.replace(old, new))


# B1.2.2: IA sigue probada, ahora desde •••.
replace_once(
    'src/tests/b1-2-2-mobile-leads-real-app.test.ts',
    "  await page.locator('#crm .mvp-lead-card').first().locator('[data-auto-qualify-client]').click();",
    "  const leadCard = page.locator('#crm .mvp-lead-card').first();\n  await leadCard.locator('.mvp-lead-actions-menu > summary').click();\n  await leadCard.getByRole('button', { name: 'Completar datos con IA', exact: true }).click();",
)

# B1.2.3 compacta: menor altura y detalles desde •••.
replace_once(
    'src/tests/b1-2-3-compact-leads-real-app.test.ts',
    "    assert.ok(fullLeadHeight >= 320 && fullLeadHeight <= 450, `Tarjeta cerrada fuera de 320-450px: ${fullLeadHeight}`);",
    "    assert.ok(fullLeadHeight >= 230 && fullLeadHeight <= 450, `Tarjeta simplificada fuera de 230-450px: ${fullLeadHeight}`);",
)
replace_once(
    'src/tests/b1-2-3-compact-leads-real-app.test.ts',
    "  await sheets.nth(0).locator(':scope > summary').click();",
    "  const firstCard = page.locator('#crm .mvp-lead-compact-card').nth(0);\n  await firstCard.locator('.mvp-lead-actions-menu > summary').click();\n  await firstCard.getByRole('button', { name: 'Ver detalles', exact: true }).click();",
)
replace_once(
    'src/tests/b1-2-3-compact-leads-real-app.test.ts',
    "  await sheets.nth(1).locator(':scope > summary').click();",
    "  const secondCard = page.locator('#crm .mvp-lead-compact-card').nth(1);\n  await secondCard.locator('.mvp-lead-actions-menu > summary').click();\n  await secondCard.getByRole('button', { name: 'Ver detalles', exact: true }).click();",
)

# B1.2.3 matriz: el tercer control visible es ••• y detalles se abren desde él.
replace_once('src/tests/b1-2-3-responsive-matrix-real-app.test.ts', "    const auto = first.querySelector<HTMLElement>('.mvp-auto-qualify-button')!;", "    const auto = first.querySelector<HTMLElement>('.mvp-lead-actions-menu > summary')!;")
replace_once('src/tests/b1-2-3-responsive-matrix-real-app.test.ts', "  assert.equal(metrics.autoText, 'Calificar automáticamente');", "  assert.equal(metrics.autoText, '•••');")
replace_once('src/tests/b1-2-3-responsive-matrix-real-app.test.ts', "  assert.equal(metrics.autoNotClipped, true, `Calificar automáticamente truncado en ${viewport.width}px.`);", "  assert.equal(metrics.autoNotClipped, true, `Menú de acciones truncado en ${viewport.width}px.`);")
replace_once(
    'src/tests/b1-2-3-responsive-matrix-real-app.test.ts',
    "  await sheets.nth(0).locator(':scope > summary').click();",
    "  const firstMenuCard = page.locator('#crm .mvp-lead-compact-card').nth(0);\n  await firstMenuCard.locator('.mvp-lead-actions-menu > summary').click();\n  await firstMenuCard.getByRole('button', { name: 'Ver detalles', exact: true }).click();",
)
replace_once(
    'src/tests/b1-2-3-responsive-matrix-real-app.test.ts',
    "  await sheets.nth(1).locator(':scope > summary').click();",
    "  const secondMenuCard = page.locator('#crm .mvp-lead-compact-card').nth(1);\n  await secondMenuCard.locator('.mvp-lead-actions-menu > summary').click();\n  await secondMenuCard.getByRole('button', { name: 'Ver detalles', exact: true }).click();",
)
replace_once('src/tests/b1-2-3-responsive-matrix-real-app.test.ts', "  await page.locator('#crm .mvp-lead-full-sheet[open] > summary').click();", "  await page.locator('#crm .mvp-lead-full-sheet[open]').evaluate((element: HTMLDetailsElement) => { element.open = false; });")

# B1.2.4: tarjeta mínima sin resumen técnico ni CTA IA principal.
replace_once('src/tests/b1-2-4-responsive-real-app.test.ts', "  assert.equal(data.summaryCount, 1);", "  assert.equal(data.summaryCount, 0);")
replace_once('src/tests/b1-2-4-responsive-real-app.test.ts', "  assert.equal(data.factCount, 0);", "  assert.equal(data.factCount, 1);")
replace_once('src/tests/b1-2-4-responsive-real-app.test.ts', "  assert.equal(data.autoText, 'Calificar automáticamente');", "  assert.equal(data.autoText, undefined);")
replace_once(
    'src/tests/b1-2-4-responsive-real-app.test.ts',
    "  if (!(await sheet.evaluate((element: HTMLDetailsElement) => element.open))) await sheet.locator(':scope > summary').click();",
    "  if (!(await sheet.evaluate((element: HTMLDetailsElement) => element.open))) {\n    await complete.locator('.mvp-lead-actions-menu > summary').click();\n    await complete.getByRole('button', { name: 'Ver detalles', exact: true }).click();\n  }",
)
replace_once('src/tests/b1-2-4-responsive-real-app.test.ts', "  await sheet.locator(':scope > summary').click();", "  await sheet.evaluate((element: HTMLDetailsElement) => { element.open = false; });")
replace_all('src/tests/b1-2-4-responsive-real-app.test.ts', 'data.emptyHeight >= 300', 'data.emptyHeight >= 220')
replace_all('src/tests/b1-2-4-responsive-real-app.test.ts', 'data.completeHeight >= 340', 'data.completeHeight >= 230')

# B1.2.5: navegación inferior sobre controles visibles reales.
replace_once(
    'src/tests/b1-2-5-responsive-real-app.test.ts',
    "  const qualify = last.locator('.mvp-auto-qualify-button');\n  const summary = last.locator('.mvp-lead-full-sheet > summary');\n  assert.ok(await clearance(qualify) >= 16, 'Calificar automáticamente queda demasiado cerca de la navegación inferior.');\n  assert.ok(await clearance(summary) >= 16, 'Ver ficha completa queda demasiado cerca de la navegación inferior.');\n  await summary.click();",
    "  const menu = last.locator('.mvp-lead-actions-menu');\n  const summary = menu.locator(':scope > summary');\n  assert.ok(await clearance(summary) >= 16, 'El menú de acciones queda demasiado cerca de la navegación inferior.');\n  await summary.click();\n  const details = menu.getByRole('button', { name: 'Ver detalles', exact: true });\n  assert.ok(await clearance(details) >= 16, 'Ver detalles queda demasiado cerca de la navegación inferior.');\n  await details.click();",
)

# B1.2.7: sólo cambian etiquetas humanas; datos internos quedan intactos.
replace_once('src/tests/b1-2-7-responsive-real-app.test.ts', "            action: 'Definir acción',", "            action: 'Definir próximo paso',")
replace_once('src/tests/b1-2-7-responsive-real-app.test.ts', "          assert.equal(occurrences(text, 'Definir acción'), 1);", "          assert.equal(occurrences(text, 'Definir próximo paso'), 1);")
replace_once('src/tests/b1-2-7-responsive-real-app.test.ts', "          action: 'Contactar por primera vez',", "          action: 'WhatsApp',")
replace_once('src/tests/b1-2-7-responsive-real-app.test.ts', "          action: 'Programar seguimiento',", "          action: 'Elegir próximo contacto',")

# B1.3.2: edición desde Ver detalles.
replace_once(
    'src/tests/b1-3-2-android-lead-save-real-app.test.ts',
    "          await details.locator(':scope > summary').click();",
    "          const card = page.locator(`#crm.active [data-client-id=\"${clientId}\"]`);\n          await card.locator('.mvp-lead-actions-menu > summary').click();\n          await card.getByRole('button', { name: 'Ver detalles', exact: true }).click();",
)

# B1.3.3: desaparece CTA manual, fail-closed sigue obligatorio.
replace_once('src/tests/b1-3-3-audit-blockers-real-app.test.ts', "? Array.from(panel.querySelectorAll<HTMLButtonElement>('[data-whatsapp-open], [data-whatsapp-manual-register], [data-whatsapp-copy]'))", "? Array.from(panel.querySelectorAll<HTMLButtonElement>('[data-whatsapp-open], [data-whatsapp-copy]'))")
replace_once('src/tests/b1-3-3-audit-blockers-real-app.test.ts', '      && actions.length === 3', '      && actions.length === 2')
replace_all('src/tests/b1-3-3-audit-blockers-real-app.test.ts', "'[data-whatsapp-open]', '[data-whatsapp-manual-register]', '[data-whatsapp-copy]'", "'[data-whatsapp-open]', '[data-whatsapp-copy]'", minimum=2)
replace_once('src/tests/b1-3-3-audit-blockers-real-app.test.ts', "    await page.locator('[data-whatsapp-manual-register]').evaluate((button) => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));\n", '')
replace_once(
    'src/tests/b1-3-3-audit-blockers-real-app.test.ts',
    "    await page.locator('[data-whatsapp-manual-register]').click();\n    const form = page.locator('[data-whatsapp-followup-form]');\n    await form.waitFor({ state: 'visible' });",
    "    await page.locator('[data-whatsapp-open]').click();\n    await page.clock.runFor(750);\n    await page.evaluate(() => window.dispatchEvent(new Event('focus')));\n    await page.locator('[data-whatsapp-confirm-sent]').waitFor({ state: 'visible' });\n    await page.locator('[data-whatsapp-confirm-sent]').click();\n    await page.locator('[data-whatsapp-change-followup]').waitFor({ state: 'visible' });\n    await page.locator('[data-whatsapp-change-followup]').click();\n    const form = page.locator('[data-zero-followup-form]');\n    await form.waitFor({ state: 'visible' });",
)
replace_all('src/tests/b1-3-3-audit-blockers-real-app.test.ts', '[data-whatsapp-followup-preview]', '[data-zero-followup-preview]')
replace_once('src/tests/b1-3-3-audit-blockers-real-app.test.ts', "    assert.equal(await page.evaluate(() => (window as unknown as { __b133OpenCount: number }).__b133OpenCount), 0);", "    assert.equal(await page.evaluate(() => (window as unknown as { __b133OpenCount: number }).__b133OpenCount), 1);")
replace_once('src/tests/b1-3-3-audit-blockers-real-app.test.ts', "        document.querySelector<HTMLElement>('[data-whatsapp-manual-register]')!,\n", '')

# B1.3.3 visual: control legacy ausente.
replace_once('src/tests/b1-3-3-mobile-postproduction-hotfix.test.ts', "  assert.equal(await panel.locator('[data-whatsapp-manual-register]').isDisabled(), true);", "  assert.equal(await panel.locator('[data-whatsapp-manual-register]').count(), 0);")

# B1.3.3 uso real: contexto técnico oculto; selector sólo tras Cambiar.
replace_once('src/tests/b1-3-3-real-use-real-app.test.ts', "    assert.match(await page.locator('[data-whatsapp-context-note]').innerText(), /mensajes entrantes|Contexto disponible/i);", "    const contextNote = page.locator('[data-whatsapp-context-note]');\n    if (await contextNote.count()) assert.equal(await contextNote.isVisible(), false, 'El contexto técnico no compite con el CTA principal.');")
replace_once(
    'src/tests/b1-3-3-real-use-real-app.test.ts',
    "    await page.locator('[data-whatsapp-manual-register]').click();\n    const followUpForm = page.locator('[data-whatsapp-followup-form]');\n    await followUpForm.waitFor({ state: 'visible' });",
    "    await page.locator('[data-whatsapp-open]').click();\n    await page.waitForTimeout(750);\n    await page.evaluate(() => window.dispatchEvent(new Event('focus')));\n    await page.locator('[data-whatsapp-confirm-sent]').waitFor({ state: 'visible' });\n    await page.locator('[data-whatsapp-confirm-sent]').click();\n    await page.locator('[data-whatsapp-change-followup]').waitFor({ state: 'visible' });\n    await page.locator('[data-whatsapp-change-followup]').click();\n    const followUpForm = page.locator('[data-zero-followup-form]');\n    await followUpForm.waitFor({ state: 'visible' });",
)

# B1.3 principal: editar/copiar secundarios; selector sólo tras confirmación y Cambiar.
replace_once(
    'src/tests/b1-3-whatsapp-contact-real-app.test.ts',
    "    const edited = 'Hola Lucía 👋\\n¿Seguís buscando en Nueva Córdoba?';\n    await page.locator('[data-whatsapp-message]').fill(edited);\n    await page.locator('[data-whatsapp-copy]').click();",
    "    const edited = 'Hola Lucía 👋\\n¿Seguís buscando en Nueva Córdoba?';\n    await page.locator('[data-whatsapp-edit-message]').click();\n    await page.locator('[data-whatsapp-message]').fill(edited);\n    await page.locator('.whatsapp-zero-more-options > summary').click();\n    await page.locator('[data-whatsapp-copy]').click();",
)
replace_once(
    'src/tests/b1-3-whatsapp-contact-real-app.test.ts',
    "    await page.locator('[data-whatsapp-confirm-sent]').click();\n    await page.locator('[data-whatsapp-followup-form]').waitFor({ state: 'visible' });\n    const choices = await page.locator('input[name=\"follow-up-choice\"]').evaluateAll((nodes) => nodes.map((node) => (node as HTMLInputElement).value));\n    assert.deepEqual(choices, ['1', '3', '7', '14', '30', 'custom', 'none']);",
    "    await page.locator('[data-whatsapp-confirm-sent]').click();\n    await page.locator('[data-whatsapp-change-followup]').waitFor({ state: 'visible' });\n    assert.equal(await page.locator('[data-zero-followup-form]').count(), 0);\n    await page.locator('[data-whatsapp-change-followup]').click();\n    await page.locator('[data-zero-followup-form]').waitFor({ state: 'visible' });\n    const choices = await page.locator('input[name=\"follow-up-choice\"]').evaluateAll((nodes) => nodes.map((node) => (node as HTMLInputElement).value));\n    assert.deepEqual(choices, ['1', '3', '7', '14', '30', 'custom']);",
)
replace_all('src/tests/b1-3-whatsapp-contact-real-app.test.ts', '[data-whatsapp-followup-form]', '[data-zero-followup-form]')
replace_once(
    'src/tests/b1-3-whatsapp-contact-real-app.test.ts',
    "    await page.locator('[data-module=\"crm\"]:visible').first().click();\n    await page.locator('[data-contact-whatsapp=\"1\"]').click();\n    await page.locator('[data-whatsapp-manual-register]').click();\n    await page.locator('input[name=\"follow-up-choice\"][value=\"none\"]').check();\n    await page.locator('[data-zero-followup-form] button[type=\"submit\"]').click();\n    assert.equal((await crmFromStorage(page, 'Dueño')).clients[0]?.nextFollowUp, undefined, 'Sin seguimiento no impone fecha.');",
    "    await page.locator('[data-module=\"crm\"]:visible').first().click();\n    await page.locator('[data-contact-whatsapp=\"1\"]').click();\n    await page.locator('[data-whatsapp-open]').click();\n    await page.waitForTimeout(750);\n    await page.evaluate(() => window.dispatchEvent(new Event('focus')));\n    await page.locator('[data-whatsapp-confirm-sent]').waitFor({ state: 'visible' });\n    await page.getByRole('button', { name: 'Todavía no', exact: true }).click();\n    assert.equal((await crmFromStorage(page, 'Dueño')).clients[0]?.nextFollowUp, undefined, 'Todavía no no impone fecha.');",
)

# PR #139 navegador: Sí puede coalescer contacto+seguimiento en una generación segura.
replace_once(
    'src/tests/followup-cloud-persistence-browser.test.ts',
    "    await page.locator('[data-contact-whatsapp=\"1\"]').click();\n    await page.locator('[data-whatsapp-manual-register]').waitFor({ state: 'visible' });\n    await page.locator('[data-whatsapp-manual-register]').click();\n    await page.locator('[data-whatsapp-followup-form]').waitFor({ state: 'visible' });\n    await page.clock.runFor(750);",
    "    await page.locator('[data-contact-whatsapp=\"1\"]').click();\n    await page.locator('[data-whatsapp-open]').click();\n    await page.clock.runFor(750);\n    await page.evaluate(() => window.dispatchEvent(new Event('focus')));\n    await page.locator('[data-whatsapp-confirm-sent]').waitFor({ state: 'visible' });\n    await page.locator('[data-whatsapp-confirm-sent]').click();\n    await page.clock.runFor(750);",
)
replace_once(
    'src/tests/followup-cloud-persistence-browser.test.ts',
    "    const form = page.locator('[data-whatsapp-followup-form]');\n    await form.locator('input[name=\"follow-up-choice\"][value=\"1\"]').check();\n    await page.waitForFunction((date) => document.querySelector<HTMLFormElement>('[data-whatsapp-followup-form]')?.dataset.followupSelectedDate === date, FOLLOW_UP_DATE);\n    await form.locator('button[type=\"submit\"]').click();\n\n    await page.clock.runFor(850);\n    assert.equal(cloud.postCount(), 1, 'B no puede iniciar un segundo POST mientras A sigue en vuelo');",
    "    assert.equal((await crmFromStorage(page)).clients[0]?.nextFollowUp, FOLLOW_UP_DATE);\n    await page.clock.runFor(850);\n    assert.equal(cloud.postCount(), 1, 'La cola mantiene un único POST mientras el primero sigue en vuelo');",
)
replace_once('src/tests/followup-cloud-persistence-browser.test.ts', "    assert.equal(cloud.postCount(), 2, 'B debe ejecutarse automáticamente después de A');", "    assert.ok(cloud.postCount() >= 1 && cloud.postCount() <= 2, `La cola segura usó ${cloud.postCount()} push(es).`);")

# PR #138 navegador: Cambiar conserva hidden selected-date como estado canónico.
replace_once(
    'src/tests/followup-hotfix-browser.test.ts',
    "async function openFollowUp(page: Page): Promise<void> {\n  await page.locator('[data-contact-whatsapp=\"1\"]').click();\n  await page.locator('[data-whatsapp-manual-register]').waitFor({ state: 'visible' });\n  await page.locator('[data-whatsapp-manual-register]').click();\n  const form = page.locator('[data-whatsapp-followup-form]');\n  await form.waitFor({ state: 'visible' });\n  await page.waitForFunction(() => Boolean(\n    document.querySelector<HTMLFormElement>('[data-whatsapp-followup-form]')?.dataset.followupSelectedChoice,\n  ));\n}",
    "async function openFollowUp(page: Page): Promise<void> {\n  await page.locator('[data-contact-whatsapp=\"1\"]').click();\n  await page.locator('[data-whatsapp-open]').click();\n  await page.clock.runFor(750);\n  await page.evaluate(() => window.dispatchEvent(new Event('focus')));\n  await page.locator('[data-whatsapp-confirm-sent]').waitFor({ state: 'visible' });\n  await page.locator('[data-whatsapp-confirm-sent]').click();\n  await page.locator('[data-whatsapp-change-followup]').waitFor({ state: 'visible' });\n  await page.locator('[data-whatsapp-change-followup]').click();\n  await page.locator('[data-zero-followup-form]').waitFor({ state: 'visible' });\n}",
)
replace_all('src/tests/followup-hotfix-browser.test.ts', '[data-whatsapp-followup-form]', '[data-zero-followup-form]')
replace_all('src/tests/followup-hotfix-browser.test.ts', '[data-whatsapp-followup-preview]', '[data-zero-followup-preview]')
replace_once(
    'src/tests/followup-hotfix-browser.test.ts',
    "    return current?.dataset.followupSelectedChoice === choice\n      && current?.dataset.followupSelectedDate === date\n      && previewNode?.dataset.followupPreviewDate === date\n      && previewNode?.textContent === preview;",
    "    return current?.querySelector<HTMLInputElement>('input[name=\"selected-date\"]')?.value === date\n      && previewNode?.textContent === preview;",
)
