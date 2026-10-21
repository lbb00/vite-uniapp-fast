#!/usr/bin/env bash
set -euo pipefail
# Workspace root: UNI_FAST_WORKSPACE, defaults to the current directory.
WS="${UNI_FAST_WORKSPACE:-$PWD}"
ROOT="$WS/compile-optimization/fixture"
cd "$ROOT"
export BENCH_BACKUP=../fixture-source-backup
export BENCH_HEAP_MB=4096
export BENCH_COLD_TIMEOUT_MS=180000
export BENCH_WARM_TIMEOUT_MS=180000
LOG="$WS/verify/logs/honest-hash-gaps.log"
mkdir -p "$(dirname "$LOG")"
: > "$LOG"

run_dual() {
  local name="$1" suite="$2"
  shift 2 || true
  local extra_env=("$@")
  echo "=== DUAL $name suite=$suite env=${extra_env[*]:-} ===" | tee -a "$LOG"
  # baseline
  env "${extra_env[@]}" BENCH_MODE=baseline node bench/run.cjs "box-hash-${name}-baseline" "$suite" >>"$LOG" 2>&1 \
    || echo "WARN baseline $name exit=$?" | tee -a "$LOG"
  # optc
  env "${extra_env[@]}" BENCH_MODE=optc-ext UNI_FAST_OPTC_EXT=1 node bench/run.cjs "box-hash-${name}-optc-ext" "$suite" >>"$LOG" 2>&1 \
    || echo "WARN optc $name exit=$?" | tee -a "$LOG"
  # quick verdict
  python3 - <<PY
import json,os
from pathlib import Path
name="$name"
# find step files besides cold
base=Path("../reports")/f"box-hash-{name}-baseline"
optc=Path("../reports")/f"box-hash-{name}-optc-ext"
steps=[p.name.replace('.files.json','') for p in base.glob('*.files.json') if p.name!='cold.files.json']
print("steps", steps)
for step in steps:
  bf=base/f"{step}.files.json"
  of=optc/f"{step}.files.json"
  if not bf.exists() or not of.exists():
    print(name, step, "MISSING_PAIR")
    continue
  b=json.load(open(bf)); o=json.load(open(of))
  keys=sorted(set(b)|set(o))
  diff=sum(1 for k in keys if b.get(k,{}).get("sha256")!=o.get(k,{}).get("sha256"))
  # metrics reason
  try:
    om=json.load(open(optc/"metrics.json"))
    warm=[x for x in om if x.get("step")==step]
    reason=(warm[0].get("optcExt") or {}).get("reason") if warm else None
    skipped=warm[0].get("viteSkipped") if warm else None
  except Exception as e:
    reason=str(e); skipped=None
  print(f"{name}/{step}: files={len(keys)} diff={diff} viteSkipped={skipped} reason={reason}")
PY
}

# P0: ifdef (content-changing), closure-over, vue-gt
run_dual ifdef perf-hash-ifdef
run_dual closure-over perf-hash-closure-over UNI_FAST_OPTC_CLOSURE_MAX=2
run_dual vue-gt perf-hash-vue-gt UNI_FAST_OPTC_CLOSURE_VUE_MAX=10

# P0 messy / gate leaves
for pair in \
  "messy-ts:perf-hash-messy-ts" \
  "messy-priv:perf-hash-messy-priv" \
  "messy-dyn:perf-hash-messy-dyn" \
  "messy-circ:perf-hash-messy-circ" \
  "messy-missing:perf-hash-messy-missing" \
  "messy-defmulti:perf-hash-messy-defmulti" \
  "messy-langts:perf-hash-messy-langts" \
  "messy-wxs:perf-hash-messy-wxs" \
  "messy-getci:perf-hash-messy-getci" \
  "messy-side:perf-hash-messy-side" \
  "messy-imptype:perf-hash-messy-imptype" \
  "messy-uni:perf-hash-messy-uni" \
  "messy-mixins:perf-hash-messy-mixins" \
  "messy-other:perf-hash-messy-other" \
  "messy-provide:perf-hash-messy-provide" \
  "script1:perf-hash-script1" \
  "setupbody:perf-hash-setupbody"
 do
  name=${pair%%:*}; suite=${pair##*:}
  run_dual "$name" "$suite"
 done

echo ALL_DONE | tee -a "$LOG"
