#!/usr/bin/env python3
import json
import os
import pathlib
import sys
from collections import Counter

if len(sys.argv) != 3:
    raise SystemExit('usage: build.py <trace-dir> <evidence-dir>')

trace = pathlib.Path(sys.argv[1])
out = pathlib.Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)


def read_jsonl(path):
    p = pathlib.Path(path)
    rows = []
    if not p.exists():
        return rows
    for line in p.read_text(encoding='utf-8', errors='replace').splitlines():
        if not line.strip():
            continue
        try:
            rows.append(json.loads(line))
        except Exception as exc:
            rows.append({'parseError': str(exc), 'raw': line})
    return rows


def parse_json(value):
    if not isinstance(value, str):
        return value
    try:
        return json.loads(value)
    except Exception:
        return value


def org_ids(body):
    parsed = parse_json(body)
    rows = parsed if isinstance(parsed, list) else [parsed]
    return sorted({
        str(row.get('organization_id'))
        for row in rows
        if isinstance(row, dict) and row.get('organization_id') is not None
    })


def latest_cloud_before(events, post_seq):
    starts = [
        e for e in events
        if e.get('type') == 'fetch-start'
        and e.get('method') == 'GET'
        and '/rest/v1/propcontrol_records' in str(e.get('url', ''))
        and (e.get('seq') or 0) < (post_seq or 0)
    ]
    if not starts:
        return None
    latest = starts[-1]
    ends = {
        e.get('requestId'): e
        for e in events
        if e.get('type') == 'fetch-end'
    }
    return parse_json((ends.get(latest.get('requestId')) or {}).get('responseBody'))


def first_cloud_before(events):
    starts = [
        e for e in events
        if e.get('type') == 'fetch-start'
        and e.get('method') == 'GET'
        and '/rest/v1/propcontrol_records' in str(e.get('url', ''))
    ]
    if not starts:
        return None
    ends = {e.get('requestId'): e for e in events if e.get('type') == 'fetch-end'}
    return parse_json((ends.get(starts[0].get('requestId')) or {}).get('responseBody'))


def first_stack_frame(stack):
    lines = str(stack or '').splitlines()[1:]
    return next((line.strip() for line in lines if line.strip()), 'UNKNOWN')


meta = {r.get('label'): r for r in read_jsonl(trace / 'run-meta.jsonl') if r.get('label')}
raw = []
for path in sorted(trace.glob('case*.jsonl')):
    raw.extend(read_jsonl(path))

per_run = []
posts = []
stop_reasons = []

for row in sorted(raw, key=lambda r: r.get('label', '')):
    label = row.get('label', '')
    m = meta.get(label, {})
    events = row.get('fullTrace') or []
    after_probe = row.get('cloudAfterProbe') or {}
    cloud_after = after_probe.get('json') if isinstance(after_probe, dict) else None
    if cloud_after is None and isinstance(after_probe, dict):
        cloud_after = parse_json(after_probe.get('body'))
    run_before = first_cloud_before(events)

    per_run.append({
        'scenario': m.get('scenario'),
        'run': m.get('run'),
        'label': label,
        'candidateSha': os.environ.get('CANDIDATE', ''),
        'validationSha': os.environ.get('VALIDATION_SHA', os.environ.get('GITHUB_SHA', '')),
        'processBrowserContextMode': {
            'process': m.get('processMode'),
            'browser': m.get('browserMode'),
            'context': m.get('contextMode'),
            'processPid': row.get('processPid'),
        },
        'testReturnCode': m.get('rc'),
        'postCount': row.get('postCount', 0),
        'eventSequence': events,
        'timer700': row.get('timerEvents', []),
        'syncDirtyReads': row.get('syncReads', []),
        'bootstrapEvents': row.get('bootstrapEvents', []),
        'serviceWorkers': row.get('serviceWorkers', []),
        'finalSync': row.get('finalSync'),
        'runtimeFinal': row.get('runtime'),
        'cloudFixtureBefore': run_before,
        'cloudFixtureAfter': cloud_after,
        'cloudAfterProbe': after_probe,
        'cdp': row.get('cdp', []),
    })

    for index, post in enumerate(row.get('posts') or [], 1):
        ids = org_ids(post.get('body'))
        before = latest_cloud_before(events, post.get('seq'))
        body = str(post.get('body') or '')
        cloud_effect = 'NOT_PROVEN'
        if before is not None and cloud_after is not None:
            cloud_effect = 'UNCHANGED' if before == cloud_after else 'CHANGED'

        timer_before = [
            e for e in row.get('timerEvents', [])
            if (e.get('seq') or 0) < (post.get('seq') or 0)
        ]
        sync_before = [
            e for e in row.get('syncReads', [])
            if (e.get('seq') or 0) < (post.get('seq') or 0)
        ]

        trace = {
            'run': m.get('run'),
            'scenario': m.get('scenario'),
            'label': label,
            'postIndex': index,
            'candidateSha': os.environ.get('CANDIDATE', ''),
            'eventOrigin': first_stack_frame(post.get('stack')),
            'requestMethod': post.get('method'),
            'requestUrl': post.get('url'),
            'requestBody': post.get('body'),
            'organization_id': ids,
            'payloadClass': post.get('payloadClass'),
            'payloadStructuralDifferences': post.get('payloadDifferences', []),
            'semanticIdempotent': post.get('semanticIdempotent'),
            'dirtyBefore': post.get('dirtyBefore'),
            'localSnapshotBeforePost': post.get('snapshot'),
            'cloudFixtureBefore': before,
            'cloudFixtureAfter': cloud_after,
            'replaceRelation': post.get('replaceRelation'),
            'precedingReplace': post.get('precedingReplace'),
            'followingReplace': post.get('followingReplace'),
            'jsStack': post.get('stack'),
            'cdpInitiator': post.get('cdpInitiator'),
            'responseStatus': post.get('responseStatus'),
            'monoMs': post.get('monoMs'),
            'timer700BeforePost': timer_before,
            'timer700All': row.get('timerEvents', []),
            'syncDirtyReadsBeforePost': sync_before,
            'syncDirtyReadsAll': row.get('syncReads', []),
            'bootstrapEvents': row.get('bootstrapEvents', []),
            'serviceWorkers': row.get('serviceWorkers', []),
            'finalSync': row.get('finalSync'),
            'runtimeFinal': row.get('runtime'),
            'fullEventSequence': events,
            'cloudEffect': cloud_effect,
        }
        posts.append(trace)

        if post.get('payloadClass') == 'STALE_LOCAL':
            stop_reasons.append('STALE_LOCAL_SENT')
        if 'A35_STALE_OWNER_LOCAL_DATA' in body:
            stop_reasons.append('STALE_OWNER_PAYLOAD')
        if ids and ids != ['a35-downgrade-org']:
            stop_reasons.append('WRONG_OR_CROSS_TENANT')
        if post.get('dirtyBefore') is False and post.get('payloadClass') == 'STALE_LOCAL':
            stop_reasons.append('DIRTY_FALSE_EXPLICIT_STALE_SAVE')

scenarios = [
    'F isolated / fresh process-browser-context',
    'A-E -> F / shared architecture',
    'A-E -> F / fresh browser-context',
    'Full Closure relevant architecture',
]
matrix = []
for scenario in scenarios:
    rr = [r for r in per_run if r.get('scenario') == scenario]
    pp = [p for p in posts if p.get('scenario') == scenario]
    matrix.append({
        'scenario': scenario,
        'runs': len(rr),
        'POST=0': sum(r.get('postCount', 0) == 0 for r in rr),
        'POST=1+': sum(r.get('postCount', 0) > 0 for r in rr),
        'payloadClasses': sorted({p.get('payloadClass') for p in pp if p.get('payloadClass')}),
        'origins': sorted({p.get('eventOrigin') for p in pp if p.get('eventOrigin')}),
    })

(out / 'reproduction-matrix.json').write_text(json.dumps(matrix, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
with (out / 'per-run.jsonl').open('w', encoding='utf-8') as handle:
    for row in per_run:
        handle.write(json.dumps(row, ensure_ascii=False) + '\n')
with (out / 'post-traces.jsonl').open('w', encoding='utf-8') as handle:
    for row in posts:
        handle.write(json.dumps(row, ensure_ascii=False) + '\n')

environment = {
    'candidateSha': os.environ.get('CANDIDATE', ''),
    'validationSha': os.environ.get('VALIDATION_SHA', os.environ.get('GITHUB_SHA', '')),
    'productBranch': os.environ.get('PRODUCT_BRANCH', ''),
    'validationBranch': os.environ.get('VALIDATION_BRANCH', ''),
    'runnerOS': os.environ.get('RUNNER_OS', ''),
    'runnerArch': os.environ.get('RUNNER_ARCH', ''),
    'nodeVersion': os.popen('node --version').read().strip(),
    'v3PreloadSha256': os.environ.get('V3_PRELOAD_SHA256', ''),
    'stopReasons': sorted(set(stop_reasons)),
}
(out / 'environment.json').write_text(json.dumps(environment, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')

classes = Counter(p.get('payloadClass') for p in posts)
wrong_tenant = sum(bool(p.get('organization_id')) and p.get('organization_id') != ['a35-downgrade-org'] for p in posts)
cloud_mutation = sum(p.get('cloudEffect') == 'CHANGED' for p in posts)
stale_count = sum(p.get('payloadClass') == 'STALE_LOCAL' for p in posts)
complete_chains = sum(
    all(p.get(key) is not None for key in (
        'requestBody', 'dirtyBefore', 'replaceRelation', 'jsStack',
        'cloudFixtureBefore', 'cloudFixtureAfter'
    ))
    for p in posts
)
summary = [
    f'CANDIDATE={os.environ.get("CANDIDATE", "")}',
    f'VALIDATION_SHA={os.environ.get("VALIDATION_SHA", os.environ.get("GITHUB_SHA", ""))}',
    f'TOTAL_RUNS={len(per_run)}',
    f'TOTAL_POSTS={len(posts)}',
    f'COMPLETE_CAUSAL_CHAINS={complete_chains}',
    'PAYLOAD_CLASSES=' + json.dumps(dict(classes), sort_keys=True),
    f'STALE_POST_COUNT={stale_count}',
    f'WRONG_TENANT_COUNT={wrong_tenant}',
    f'CLOUD_MUTATION_COUNT={cloud_mutation}',
    f'STOP_REASONS={json.dumps(sorted(set(stop_reasons)))}',
    'CAUSE=NOT PROVEN',
]
(out / 'final-summary.txt').write_text('\n'.join(summary) + '\n', encoding='utf-8')

print('\n'.join(summary))
