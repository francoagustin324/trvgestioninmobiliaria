from pathlib import Path

path = Path('src/mvp-leads-ui.ts')
text = path.read_text()
replacements = {
    'function focusLeadFormfunction focusLeadForm': 'function focusLeadForm',
    'function stageOptionsfunction stageOptions': 'function stageOptions',
    'export function renderMvpLeadsexport function renderMvpLeads': 'export function renderMvpLeads',
}
for old, new in replacements.items():
    text = text.replace(old, new)
path.write_text(text)
