#!/usr/bin/env python3
import hashlib
import pathlib
import re
import sys
import textwrap

if len(sys.argv) != 3:
    raise SystemExit('usage: prepare.py <v2-source-yml> <preload-output>')

source_path = pathlib.Path(sys.argv[1])
preload_path = pathlib.Path(sys.argv[2])
source = source_path.read_text(encoding='utf-8')

marker = '          cat > "$PRELOAD" <<\'EOF\'\n'
start = source.find(marker)
if start < 0:
    raise SystemExit('V2 preload start marker not found')
start += len(marker)
end = source.find('          EOF\n', start)
if end < 0:
    raise SystemExit('V2 preload end marker not found')
body = textwrap.dedent(source[start:end])

old = "import { chromium } from 'playwright';"
new = "import { createRequire } from 'node:module';\nconst { chromium } = createRequire(process.cwd() + '/package.json')('playwright');"
if old not in body:
    raise SystemExit('playwright import marker missing')
body = body.replace(old, new, 1)

old = "record('fetch-end', { requestId: id, method, url, status: response.status, dirtyAfter: dirty(), snapshot: snapshot() });"
new = "let responseBody = null;\n        try { responseBody = await response.clone().text(); } catch {}\n        record('fetch-end', { requestId: id, method, url, status: response.status, responseBody, dirtyAfter: dirty(), snapshot: snapshot() });"
if old not in body:
    raise SystemExit('fetch-end line marker missing')
body = body.replace(old, new, 1)

old = "const ends = new Map(events.filter((e) => e.type === 'fetch-end').map((e) => [e.requestId, e]));"
new = old + """
        const recordsGet = starts.find((e) => e.method === 'GET' && String(e.url).includes('/rest/v1/propcontrol_records'));
        let cloudAfterProbe = null;
        if (recordsGet?.url) {
          try {
            cloudAfterProbe = await page.evaluate(async (url) => {
              const response = await fetch(url, { headers: { 'x-a35-v3-probe': 'cloud-after' } });
              const text = await response.text();
              let json = null;
              try { json = JSON.parse(text); } catch {}
              return { url, status: response.status, body: text, json };
            }, recordsGet.url);
          } catch (error) {
            cloudAfterProbe = { error: String(error) };
          }
        }"""
if old not in body:
    raise SystemExit('fetch-end map marker missing')
body = body.replace(old, new, 1)

pattern = re.compile(r"const result = \{\s*label: LABEL,", re.MULTILINE)
match = pattern.search(body)
if not match:
    raise SystemExit('result marker missing')
replacement = "const result = {\n          label: LABEL,\n          processPid: process.pid,\n          cloudAfterProbe,"
body = body[:match.start()] + replacement + body[match.end():]

preload_path.write_text(body, encoding='utf-8')
digest = hashlib.sha256(body.encode('utf-8')).hexdigest()
print(f'PRELOAD_PATH={preload_path}')
print(f'PRELOAD_SHA256={digest}')
print('PRELOAD_PATCH=OK')
