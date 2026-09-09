from pathlib import Path

path = Path('src/tests/sec-fix-a1-2-g-public-property-share.test.ts')
text = path.read_text()
old = "return json([{ organization_id: ORG_B }]);"
new = "return json([{ organization_id: ORG_B }, { organization_id: ORG_A }]);"
if text.count(old) != 1:
    raise SystemExit(f'expected one membership mock anchor, found {text.count(old)}')
path.write_text(text.replace(old, new, 1))
