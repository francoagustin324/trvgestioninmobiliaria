import { readFileSync, writeFileSync } from 'node:fs';

const source = 'dist/tests/b1-2-3-compact-leads-real-app.test.js';
const target = 'dist/tests/b1-2-3-compact-leads-real-app.r3diag.test.js';
let text = readFileSync(source, 'utf8');

const needle = `    await focusTarget.focus();\n    await page.waitForTimeout(550);\n    const geometry = await focusTarget.evaluate((element) => {`;
const replacement = `    await focusTarget.focus();\n    const __r3OldNode = await focusTarget.elementHandle();\n    if (!__r3OldNode) throw new Error('R3_DIAG_NO_FOCUSED_NODE');\n    const __r3Before = await __r3OldNode.evaluate((element) => ({\n        connected: element.isConnected,\n        active: document.activeElement === element,\n        tag: element.tagName,\n        suggestion: element.closest('[data-qualification-suggestion]')?.getAttribute('data-qualification-suggestion') || null,\n    }));\n    console.log('R3_QUALIFICATION_NODE_BEFORE=' + JSON.stringify(__r3Before));\n    await page.waitForTimeout(550);\n    const __r3AfterOld = await __r3OldNode.evaluate((element) => ({\n        connected: element.isConnected,\n        active: document.activeElement === element,\n        tag: element.tagName,\n        suggestion: element.closest('[data-qualification-suggestion]')?.getAttribute('data-qualification-suggestion') || null,\n    }));\n    const __r3CurrentLocator = panel.locator('[data-suggestion-value]:not([disabled]), [data-qualification-text]').last();\n    const __r3CurrentNode = await __r3CurrentLocator.elementHandle();\n    const __r3Current = __r3CurrentNode ? await __r3CurrentNode.evaluate((element) => ({\n        connected: element.isConnected,\n        active: document.activeElement === element,\n        tag: element.tagName,\n        suggestion: element.closest('[data-qualification-suggestion]')?.getAttribute('data-qualification-suggestion') || null,\n    })) : null;\n    const __r3SameNode = __r3CurrentNode ? await page.evaluate(({ oldNode, currentNode }) => oldNode === currentNode, { oldNode: __r3OldNode, currentNode: __r3CurrentNode }) : false;\n    console.log('R3_QUALIFICATION_NODE_AFTER_OLD=' + JSON.stringify(__r3AfterOld));\n    console.log('R3_QUALIFICATION_NODE_AFTER_CURRENT=' + JSON.stringify(__r3Current));\n    console.log('R3_QUALIFICATION_SAME_NODE=' + String(__r3SameNode));\n    console.log('OLD_NODE_REPLACED_BY_VALID_RERENDER=' + String(!__r3AfterOld.connected && Boolean(__r3Current?.connected) && !__r3SameNode));\n    const geometry = await focusTarget.evaluate((element) => {`;

if (!text.includes(needle)) {
  throw new Error('R3_DIAG_NEEDLE_NOT_FOUND');
}
text = text.replace(needle, replacement);
writeFileSync(target, text);
console.log(`R3_DIAG_WRITTEN=${target}`);
