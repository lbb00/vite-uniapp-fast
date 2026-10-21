#!/usr/bin/env bash
set -euo pipefail
# Workspace root: UNI_FAST_WORKSPACE, defaults to the current directory.
WS="${UNI_FAST_WORKSPACE:-$PWD}"
cd "$WS/compile-optimization/fixture"
export BENCH_BACKUP=../fixture-source-backup
export BENCH_HEAP_MB=4096
export BENCH_COLD_TIMEOUT_MS=180000
export BENCH_WARM_TIMEOUT_MS=180000
LOG="$WS/verify/logs/honest-hash-rerun.log"
mkdir -p "$(dirname "$LOG")"
: > "$LOG"
run_dual() {
  local name="$1" suite="$2"; shift 2 || true
  echo "=== DUAL $name $suite $* ===" | tee -a "$LOG"
  env "$@" BENCH_MODE=baseline node bench/run.cjs "box-hash-${name}-baseline" "$suite" >>"$LOG" 2>&1 || echo "WARN base $name $?" | tee -a "$LOG"
  env "$@" BENCH_MODE=optc-ext UNI_FAST_OPTC_EXT=1 node bench/run.cjs "box-hash-${name}-optc-ext" "$suite" >>"$LOG" 2>&1 || echo "WARN optc $name $?" | tee -a "$LOG"
  python3 - <<PY
import json
from pathlib import Path
name="$name"
base=Path("../reports")/f"box-hash-{name}-baseline"
optc=Path("../reports")/f"box-hash-{name}-optc-ext"
steps=[p.name.replace('.files.json','') for p in base.glob('*.files.json') if p.name!='cold.files.json']
for step in steps:
  bf=base/f"{step}.files.json"; of=optc/f"{step}.files.json"
  if not of.exists():
    print(name, step, 'OPTC_MISSING'); continue
  b=json.load(open(bf)); o=json.load(open(of))
  c=json.load(open(optc/'cold.files.json'))
  diff=sum(1 for k in set(b)|set(o) if b.get(k,{}).get('sha256')!=o.get(k,{}).get('sha256'))
  coldch=[k for k in set(c)|set(o) if c.get(k,{}).get('sha256')!=o.get(k,{}).get('sha256')]
  om=json.load(open(optc/'metrics.json'))
  warm=next(x for x in om if x.get('step')==step)
  print(f"{name}/{step}: diff={diff} vsCold={len(coldch)} skip={warm.get('viteSkipped')} reason={(warm.get('optcExt') or {}).get('reason')}")
PY
}
for pair in \
  "messy-priv:perf-hash-messy-priv" \
  "messy-getci:perf-hash-messy-getci" \
  "messy-side:perf-hash-messy-side" \
  "messy-imptype:perf-hash-messy-imptype" \
  "messy-provide:perf-hash-messy-provide" \
  "messy-langts:perf-hash-messy-langts" \
  "messy-ts:perf-hash-messy-ts" \
  "messy-wxs:perf-hash-messy-wxs" \
  "messy-other:perf-hash-messy-other" \
  "script1:perf-hash-script1" \
  "setupbody:perf-hash-setupbody"
 do
  run_dual "${pair%%:*}" "${pair##*:}"
 done
echo ALL_RERUN_DONE | tee -a "$LOG"
