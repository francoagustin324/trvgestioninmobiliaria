from pathlib import Path
import sys

root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('.')
path = root / 'src/tests/b1-3-whatsapp-contact-real-app.test.ts'
text = path.read_text()

needle = "    const target = window as unknown as B13Window;\n"
instrumentation = r'''    const target = window as unknown as B13Window;
    const diagnosticWindow = window as unknown as { __b13Diag?: any };
    if (!diagnosticWindow.__b13Diag) {
      const nodeIds = new WeakMap<Node, string>();
      let nextNodeId = 1;
      const nodeId = (node: Node | null): string | null => {
        if (!node) return null;
        let existing = nodeIds.get(node);
        if (!existing) {
          existing = `node-${nextNodeId++}`;
          nodeIds.set(node, existing);
        }
        return existing;
      };
      const describe = (node: Node | null): any => {
        if (!(node instanceof Element)) return node ? { nodeId: nodeId(node), type: node.nodeType, connected: node.isConnected } : null;
        const element = node as HTMLElement;
        const rect = element.getBoundingClientRect();
        const computed = getComputedStyle(element);
        return {
          nodeId: nodeId(element),
          tag: element.tagName.toLowerCase(),
          id: element.id || '',
          className: element.getAttribute('class') || '',
          connected: element.isConnected,
          hidden: element.hidden,
          disabled: 'disabled' in element ? Boolean((element as HTMLInputElement).disabled) : undefined,
          open: 'open' in element ? Boolean((element as HTMLDetailsElement).open) : undefined,
          inlineStyle: element.getAttribute('style') || '',
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          computed: {
            display: computed.display,
            visibility: computed.visibility,
            opacity: computed.opacity,
            position: computed.position,
            contentVisibility: computed.getPropertyValue('content-visibility'),
            overflow: computed.overflow,
          },
          offsetParent: nodeId(element.offsetParent),
          clientWidth: element.clientWidth,
          clientHeight: element.clientHeight,
          parent: nodeId(element.parentElement),
          zeroTrainingView: element.dataset.zeroTrainingView || '',
          contactBlocked: element.dataset.contactBlocked || '',
          identityFingerprint: element.dataset.identityFingerprint || '',
        };
      };
      const trackedSelector = '#propcontrol-whatsapp-contact, .whatsapp-contact-panel, .whatsapp-message-field, [data-whatsapp-message-editor], [data-whatsapp-message], [data-whatsapp-message-preview]';
      const trackedWithin = (node: Node): Element[] => {
        if (!(node instanceof Element)) return [];
        const found: Element[] = [];
        if (node.matches(trackedSelector)) found.push(node);
        node.querySelectorAll(trackedSelector).forEach((item) => found.push(item));
        return found;
      };
      const relevantMutation = (record: MutationRecord): boolean => {
        if (record.target instanceof Element && (record.target.matches(trackedSelector) || Boolean(record.target.closest('#propcontrol-whatsapp-contact')))) return true;
        return [...record.addedNodes, ...record.removedNodes].some((node) => trackedWithin(node).length > 0);
      };
      const diag: any = {
        timeline: [],
        refs: {},
        seq: 0,
        push(kind: string, detail: any = {}) {
          this.timeline.push({ seq: ++this.seq, t: performance.now(), kind, ...detail });
        },
        capture(label: string, security: any = null) {
          const root = document.getElementById('propcontrol-whatsapp-contact');
          const panel = root?.querySelector<HTMLElement>('.whatsapp-contact-panel') || null;
          const messageLabel = panel?.querySelector<HTMLElement>('.whatsapp-message-field, [data-whatsapp-message-editor]') || null;
          const textarea = panel?.querySelector<HTMLTextAreaElement>('[data-whatsapp-message]') || null;
          const ancestors: any[] = [];
          let cursor: HTMLElement | null = textarea;
          while (cursor) {
            ancestors.push(describe(cursor));
            if (cursor === document.body) break;
            cursor = cursor.parentElement;
          }
          const firstExplicitHider = ancestors.find((item) => item && (
            !item.connected
            || item.hidden
            || item.computed?.display === 'none'
            || item.computed?.visibility === 'hidden'
            || item.computed?.visibility === 'collapse'
          )) || null;
          const snapshot = {
            label,
            root: describe(root),
            panel: describe(panel),
            messageLabel: describe(messageLabel),
            textarea: describe(textarea),
            ancestors,
            firstExplicitHider,
            bodyWhatsAppOpen: document.body.classList.contains('whatsapp-contact-open'),
            security,
          };
          this.push('snapshot', snapshot);
          return snapshot;
        },
        comparison() {
          const root = document.getElementById('propcontrol-whatsapp-contact');
          const panel = root?.querySelector<HTMLElement>('.whatsapp-contact-panel') || null;
          const textarea = panel?.querySelector<HTMLTextAreaElement>('[data-whatsapp-message]') || null;
          return {
            originalTextareaId: nodeId(this.refs.originalTextarea || null),
            originalTextareaConnected: Boolean(this.refs.originalTextarea?.isConnected),
            patchedTextareaId: nodeId(this.refs.patchedTextarea || null),
            patchedTextareaConnected: Boolean(this.refs.patchedTextarea?.isConnected),
            liveTextareaId: nodeId(textarea),
            liveIsOriginalTextarea: Boolean(textarea && textarea === this.refs.originalTextarea),
            liveIsPatchedTextarea: Boolean(textarea && textarea === this.refs.patchedTextarea),
            originalPanelId: nodeId(this.refs.panel || null),
            livePanelId: nodeId(panel),
            samePanel: Boolean(panel && panel === this.refs.panel),
            originalRootId: nodeId(this.refs.root || null),
            liveRootId: nodeId(root),
            sameRoot: Boolean(root && root === this.refs.root),
          };
        },
      };
      diagnosticWindow.__b13Diag = diag;

      const recordEvent = (name: string, detail: any = {}) => diag.push('event', { name, ...detail });
      document.addEventListener('click', (event) => {
        const element = event.target as HTMLElement | null;
        if (!element?.closest('[data-contact-whatsapp], .mvp-contact-btn.wa')) return;
        recordEvent('cta-click-capture');
        diag.capture('event:cta-click-capture');
      }, true);
      document.addEventListener('trv-render', () => recordEvent('trv-render'));
      document.addEventListener('propcontrol-cloud-status', (event) => recordEvent('propcontrol-cloud-status', {
        statusKind: (event as CustomEvent<{ kind?: string }>).detail?.kind || '',
      }));
      document.addEventListener('propcontrol-whatsapp-identity-changed', () => recordEvent('propcontrol-whatsapp-identity-changed'));
      window.addEventListener('focus', () => recordEvent('focus'));
      window.addEventListener('pageshow', () => recordEvent('pageshow'));
      document.addEventListener('visibilitychange', () => recordEvent('visibilitychange', { visibilityState: document.visibilityState }));

      const observer = new MutationObserver((records) => {
        records.forEach((record) => {
          if (!relevantMutation(record)) return;
          const addedTracked = [...record.addedNodes].flatMap(trackedWithin);
          const removedTracked = [...record.removedNodes].flatMap(trackedWithin);
          [...addedTracked, ...removedTracked].forEach((element) => {
            if (element.matches('#propcontrol-whatsapp-contact') && !diag.refs.root) diag.refs.root = element;
            if (element.matches('.whatsapp-contact-panel') && !diag.refs.panel) diag.refs.panel = element;
          });
          addedTracked.forEach((element) => {
            if (!element.matches('[data-whatsapp-message]')) return;
            if (element.closest('[data-whatsapp-message-editor]')) diag.refs.patchedTextarea = element;
            else if (!diag.refs.originalTextarea) diag.refs.originalTextarea = element;
          });
          const currentRoot = document.getElementById('propcontrol-whatsapp-contact');
          const currentPanel = currentRoot?.querySelector<HTMLElement>('.whatsapp-contact-panel') || null;
          if (currentRoot && !diag.refs.root) diag.refs.root = currentRoot;
          if (currentPanel && !diag.refs.panel) diag.refs.panel = currentPanel;
          diag.push('mutation', {
            mutationType: record.type,
            attributeName: record.attributeName || '',
            target: describe(record.target),
            addedTracked: addedTracked.map(describe),
            removedTracked: removedTracked.map(describe),
          });
          diag.capture(`mutation:${record.type}:${record.attributeName || 'childList'}`);
        });
      });
      observer.observe(document, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['hidden', 'class', 'style', 'disabled', 'open'],
      });
    }
'''
if needle not in text:
    raise SystemExit('diagnostic init insertion point not found')
text = text.replace(needle, instrumentation, 1)

start = text.index("test('B1.3 completa contacto")
end = text.index("test('B1.3 valida escritorio", start)
diagnostic_test = r'''async function captureMobileDiagnostic(page: Page, label: string, role: TeamRole): Promise<any> {
  const expected = identity(role);
  return page.evaluate(async ({ label, storageKey, organizationPreferenceKey }) => {
    const runtimePath = '/dist/tenant-runtime.js';
    const storePath = '/dist/store.js';
    const runtime = await import(runtimePath);
    const store = await import(storePath);
    const target = window as unknown as { __b13Diag?: any };
    const diagnostic = target.__b13Diag;
    const security = {
      tenantScope: runtime.currentTenantScope(),
      crmOrganizationId: store.state.crm.organization.id,
      organizationPreference: localStorage.getItem(organizationPreferenceKey),
      activeMemberId: store.state.activeMemberId,
      storageOrganizationId: (() => {
        try { return JSON.parse(localStorage.getItem(storageKey) || '{}')?.organization?.id || null; }
        catch { return null; }
      })(),
      panelIdentityFingerprint: document.querySelector<HTMLElement>('.whatsapp-contact-panel')?.dataset.identityFingerprint || '',
      panelContactBlocked: document.querySelector<HTMLElement>('.whatsapp-contact-panel')?.dataset.contactBlocked || '',
      bodyWhatsAppOpen: document.body.classList.contains('whatsapp-contact-open'),
      rootHidden: document.getElementById('propcontrol-whatsapp-contact')?.hidden ?? null,
    };
    if (!diagnostic) throw new Error('B1.3 diagnostic timeline missing');
    return diagnostic.capture(label, security);
  }, {
    label,
    storageKey: expected.storageKey,
    organizationPreferenceKey: expected.organizationPreferenceKey,
  });
}

test('B1.3 DIAGNOSTIC causalidad de visibilidad WhatsApp móvil', async () => {
  const executablePath = chromeExecutable();
  assert.ok(executablePath, 'Chrome/Chromium no disponible para diagnóstico B1.3.');
  const port = 61100 + Math.floor(Math.random() * 150);
  const url = `http://127.0.0.1:${port}`;
  const server = await startServer(port);
  const browser = await chromium.launch({ executablePath, headless: true });
  const context = await contextFor(browser, 'Dueño', { width: 390, height: 844 });
  try {
    const page = await context.newPage();
    await load(page, url, 'Dueño');
    await captureMobileDiagnostic(page, '1-before-cta-click', 'Dueño');

    await page.locator('[data-contact-whatsapp="1"]').click();
    await captureMobileDiagnostic(page, '2-immediately-after-cta-click', 'Dueño');

    const panel = page.locator('.whatsapp-contact-panel');
    await panel.waitFor({ state: 'visible' });
    await captureMobileDiagnostic(page, '3-panel-visible', 'Dueño');

    const message = page.locator('[data-whatsapp-message]');
    await message.waitFor({ state: 'attached' });
    await captureMobileDiagnostic(page, '4-textarea-attached', 'Dueño');

    const playwrightVisible = await message.isVisible();
    const finalSnapshot = await captureMobileDiagnostic(page, '6-playwright-visibility-result', 'Dueño');
    const diagnostic = await page.evaluate(() => {
      const target = window as unknown as { __b13Diag?: any };
      return {
        timeline: target.__b13Diag?.timeline || [],
        comparison: target.__b13Diag?.comparison?.() || null,
      };
    });

    console.log(`B13_PLAYWRIGHT_VISIBLE=${playwrightVisible}`);
    console.log(`B13_FINAL_SNAPSHOT=${JSON.stringify(finalSnapshot)}`);
    console.log(`B13_NODE_COMPARISON=${JSON.stringify(diagnostic.comparison)}`);
    console.log(`B13_TIMELINE=${JSON.stringify(diagnostic.timeline)}`);

    assert.equal(playwrightVisible, false, 'El diagnóstico debe reproducir el textarea hidden observado por el gate.');
    assert.equal(finalSnapshot.root?.hidden, false, 'El overlay debe seguir abierto durante la transición.');
    assert.equal(finalSnapshot.bodyWhatsAppOpen, true, 'El modo modal WhatsApp debe seguir activo.');
  } finally {
    await context.close();
    await browser.close();
    await stopServer(server);
  }
});

'''
text = text[:start] + diagnostic_test + text[end:]
path.write_text(text)
print(f'PATCHED_DIAGNOSTIC_FILE={path}')
