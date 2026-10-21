#!/usr/bin/env bash
# Close remaining honest uncovered import leaves via light fixture duals.
set -euo pipefail
# Workspace root: UNI_FAST_WORKSPACE, defaults to the current directory.
WS="${UNI_FAST_WORKSPACE:-$PWD}"
ROOT="$WS/compile-optimization/fixture"
cd "$ROOT"
export BENCH_BACKUP=../fixture-source-backup
# Keep heap modest — box ~15Gi with other agents; avoid OOM
export BENCH_HEAP_MB="${BENCH_HEAP_MB:-3072}"
export BENCH_COLD_TIMEOUT_MS=180000
export BENCH_WARM_TIMEOUT_MS=180000
LOG="$WS/verify/logs/imp-leaf-duals.log"
mkdir -p "$(dirname "$LOG")" "$WS/verify/logs"
: > "$LOG"

run_dual() {
  local name="$1" suite="$2"
  echo "=== DUAL $name suite=$suite heap=$BENCH_HEAP_MB $(date -Iseconds) ===" | tee -a "$LOG"
  free -h | head -2 | tee -a "$LOG"
  env BENCH_MODE=baseline node bench/run.cjs "box-hash-${name}-baseline" "$suite" >>"$LOG" 2>&1 \
    || echo "WARN baseline $name exit=$?" | tee -a "$LOG"
  env BENCH_MODE=optc-ext UNI_FAST_OPTC_EXT=1 node bench/run.cjs "box-hash-${name}-optc-ext" "$suite" >>"$LOG" 2>&1 \
    || echo "WARN optc $name exit=$?" | tee -a "$LOG"
  python3 - <<PY
import json
from pathlib import Path
name="$name"
base=Path("../reports")/f"box-hash-{name}-baseline"
optc=Path("../reports")/f"box-hash-{name}-optc-ext"
steps=[p.name.replace(".files.json","") for p in base.glob("*.files.json") if p.name!="cold.files.json"]
print("steps", steps)
for step in steps:
  bf=base/f"{step}.files.json"; of=optc/f"{step}.files.json"
  if not bf.exists() or not of.exists():
    print(name, step, "MISSING_PAIR"); continue
  b=json.load(open(bf)); o=json.load(open(of))
  keys=sorted(set(b)|set(o))
  diff=sum(1 for k in keys if b.get(k,{}).get("sha256")!=o.get(k,{}).get("sha256"))
  cold=json.load(open(optc/"cold.files.json")) if (optc/"cold.files.json").exists() else {}
  vsCold=sum(1 for k in set(cold)|set(o) if cold.get(k,{}).get("sha256")!=o.get(k,{}).get("sha256"))
  try:
    om=json.load(open(optc/"metrics.json"))
    warm=[x for x in om if x.get("step")==step]
    reason=(warm[0].get("optcExt") or {}).get("reason") if warm else None
    skipped=warm[0].get("viteSkipped") if warm else None
  except Exception as e:
    reason=str(e); skipped=None
  print(f"{name}/{step}: files={len(keys)} diff={diff} vsCold={vsCold} viteSkipped={skipped} reason={reason}")
PY
}

# Five uncovered import leaves
run_dual imp-star perf-hash-imp-star
run_dual imp-rel perf-hash-imp-rel
run_dual imp-barrel perf-hash-imp-barrel
run_dual imp-defnamed perf-hash-imp-defnamed
run_dual imp-require perf-hash-imp-require

# Deferred messy content-changing tip edits that reported vsCold=0 (re-prove edit effect)
for pair in \
  "messy-priv:perf-hash-messy-priv" \
  "messy-dyn:perf-hash-messy-dyn" \
  "messy-circ:perf-hash-messy-circ" \
  "messy-missing:perf-hash-messy-missing" \
  "messy-defmulti:perf-hash-messy-defmulti" \
  "messy-getci:perf-hash-messy-getci" \
  "messy-other:perf-hash-messy-other"
do
  name=${pair%%:*}; suite=${pair##*:}
  run_dual "$name" "$suite"
done

echo ALL_DONE $(date -Iseconds) | tee -a "$LOG"
