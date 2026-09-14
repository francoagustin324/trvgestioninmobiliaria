#!/usr/bin/env bash
set -euo pipefail

: "${A35_PRELOAD:?A35_PRELOAD required}"
: "${A35_TRACE_DIR:?A35_TRACE_DIR required}"
: "${A35_EVIDENCE_DIR:?A35_EVIDENCE_DIR required}"

mkdir -p "$A35_TRACE_DIR" "$A35_EVIDENCE_DIR"
authority="dist/tests/sec-fix-a3-5-stale-role-fallback-authority.test.js"
ownerless="dist/tests/sec-fix-a3-5-ownerless-normalization.test.js"

check_stop() {
  local out="$1"
  python - "$out" "$A35_EVIDENCE_DIR/STOP" <<'PY'
import json, pathlib, sys
rows=[json.loads(x) for x in pathlib.Path(sys.argv[1]).read_text().splitlines() if x.strip()]
reasons=[]
for row in rows:
    for p in row.get('posts', []):
        body=p.get('body') or ''
        cls=p.get('payloadClass')
        if cls == 'STALE_LOCAL': reasons.append('STALE_LOCAL_SENT')
        if 'A35_STALE_OWNER_LOCAL_DATA' in body: reasons.append('STALE_OWNER_PAYLOAD')
        try:
            parsed=json.loads(body) if isinstance(body, str) else body
            items=parsed if isinstance(parsed, list) else [parsed]
            ids={str(x.get('organization_id','')) for x in items if isinstance(x,dict) and x.get('organization_id') is not None}
            if ids and ids != {'a35-downgrade-org'}: reasons.append('WRONG_OR_CROSS_TENANT')
        except Exception:
            pass
        if p.get('dirtyBefore') is False and cls == 'STALE_LOCAL':
            reasons.append('DIRTY_FALSE_EXPLICIT_STALE_SAVE')
if reasons:
    pathlib.Path(sys.argv[2]).write_text('\n'.join(sorted(set(reasons)))+'\n', encoding='utf-8')
PY
}

run_one() {
  local label="$1" scenario="$2" runnum="$3" processmode="$4" browsermode="$5" contextmode="$6" fresh="$7" pattern="$8"
  shift 8
  local out="$A35_TRACE_DIR/$label.jsonl"
  local log="$A35_TRACE_DIR/$label.log"
  local rc=0
  local args=(--test --test-concurrency=1)
  if [[ -n "$pattern" ]]; then args+=(--test-name-pattern="$pattern"); fi

  set +e
  A35_PROBE_LABEL="$label" \
  A35_PROBE_OUTPUT="$out" \
  A35_PROBE_FRESH_BROWSER_PER_CONTEXT="$fresh" \
  NODE_OPTIONS="--import=$A35_PRELOAD" \
    node "${args[@]}" "$@" >"$log" 2>&1
  rc=$?
  set -e

  printf '{"label":"%s","scenario":"%s","run":%s,"processMode":"%s","browserMode":"%s","contextMode":"%s","rc":%s}\n' \
    "$label" "$scenario" "$runnum" "$processmode" "$browsermode" "$contextmode" "$rc" >> "$A35_TRACE_DIR/run-meta.jsonl"

  if [[ ! -s "$out" ]]; then
    echo "HARNESS_NO_TRACE=$label RC=$rc" | tee -a "$A35_EVIDENCE_DIR/harness-errors.txt"
    cat "$log" >> "$A35_EVIDENCE_DIR/harness-errors.txt"
    return 2
  fi

  check_stop "$out"
  grep -E 'CONTROL_F_|A35_CONTROL_F_CAUSAL_RESULT=' "$log" || true
  return 0
}

for n in $(seq 1 10); do
  [[ -f "$A35_EVIDENCE_DIR/STOP" ]] && break
  run_one "case1-isolated-$n" "F isolated / fresh process-browser-context" "$n" \
    "fresh node process" "fresh browser" "fresh context" "0" 'A3\.5 F:' "$authority" || break
done

for n in $(seq 1 5); do
  [[ -f "$A35_EVIDENCE_DIR/STOP" ]] && break
  run_one "case2-ae-then-f-$n" "A-E -> F / shared architecture" "$n" \
    "fresh node process per observation" "shared browser within A-F invocation" "fresh context per control" "0" "" "$authority" || break
done

for n in $(seq 1 5); do
  [[ -f "$A35_EVIDENCE_DIR/STOP" ]] && break
  run_one "case3-fresh-browser-$n" "A-E -> F / fresh browser-context" "$n" \
    "fresh node process per observation" "fresh browser per context" "fresh context per control" "1" "" "$authority" || break
done

for n in $(seq 1 5); do
  [[ -f "$A35_EVIDENCE_DIR/STOP" ]] && break
  run_one "case4-full-closure-$n" "Full Closure relevant architecture" "$n" \
    "fresh node process per observation" "validation full-closure architecture" "fresh contexts" "0" "" "$authority" "$ownerless" || break
done

if [[ -f "$A35_EVIDENCE_DIR/STOP" ]]; then
  echo "SECURITY_STOP=YES"
  cat "$A35_EVIDENCE_DIR/STOP"
fi
