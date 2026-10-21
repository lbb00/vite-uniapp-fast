# MIDPATH-COMPLEX — F8a complex midpath SHA (closed)

Constraint: **BOX ONLY** — no Mac / WeChat. Zone: Asia/Shanghai.

## Verdict: **MATCH Measured**

Complex page-script edit (Opt B still page-only) is **byte-identical** to uni warm baseline after partial-DCE + uni multi-line format in `formatSetupStmtsLikeUni`.

| Path | Wall (warm) | generated | viteSkipped | emitClass | SHA vs uni |
|------|-------------|-----------|-------------|-----------|------------|
| **baseline** (uni) | **~1694.4 ms** | 1007 | false | — | gold `a0bfb44b…` (735 B) |
| **optc natural** | **~9.3 ms** | 1 | true | `setup-body-local-imports` | **MATCH** `a0bfb44b…` (735 B) |
| **optc FORCE_MIDPATH** | **~5.5 ms** | 1 | true | `midpath-sync` | **MATCH** `a0bfb44b…` (same) |

Speedup vs baseline: natural **~182.3×**, midpath **~310.7×**.

## Edit (fixture)

`scriptComplexSetup` on `pages-tab/routeA/index.vue`:

```text
const label=ref(probeMul(21))
→
const _unifastBase=probeMul(21);const setupOnlyMark=ref(777);const label=ref(_unifastBase)
```

- Template / style / import-set / dep content **unchanged** → Opt B page-only.
- Not explainable by surgical / named / plain / call-arg (structure + new binding).
- Natural cascade → **setup-body**; forced midpath skips cascade — both share `formatSetupStmtsLikeUni`.

## Anatomy (Measured) — closed

- `firstDiffOffset`: **null** (byte-identical)
- **uni + optc:** keep `_unifastBase`; **partial DCE** drops binding name `setupOnlyMark` but keeps side-effect `common_vendor.ref(777);`; multi-line formatting.
- Natural setup-body and forced midpath are **byte-identical to each other and to uni**.

### Fix

`formatSetupStmtsLikeUni` in `optc-ext-emitter.mjs` (used by setup-body + midpath splice):

1. Split top-level stmts (string/comment aware).
2. If `const|let|var name = rhs` and `name` is not referenced by preserved render/return **and** not referenced by other setup stmts → drop binding name (keep RHS when it has calls/side effects; omit pure unused literals).
3. Emit each stmt on its own line with 4-space indent + trailing `;` (uni style).

## Remaining irreducible (honest)

This closes the F8a fixture complex class. Broader uni DCE (e.g. pure-literal const that uni omits in other pages, or Rollup-only transforms) may still diverge on edits outside this binding-liveness heuristic — fail-closed / midpath / full remain the escape hatches. F6 call-arg MATCH unchanged.

Artifacts: `verify/midpath-complex.json`, `verify/logs/sha-anatomy/midpath-complex.json`, `f8a-*-routeA.js`, reports `box-fixture-f8a-*`.

## Re-run

```bash
cd compile-optimization/fixture
BENCH_BACKUP=../fixture-source-backup BENCH_MODE=baseline \
  node bench/run.cjs box-fixture-f8a-baseline-complex perf-optc-midpath-complex
BENCH_BACKUP=../fixture-source-backup BENCH_MODE=optc-ext \
  node bench/run.cjs box-fixture-f8a-optc-natural perf-optc-midpath-complex
UNI_FAST_OPTC_FORCE_MIDPATH=1 BENCH_BACKUP=../fixture-source-backup BENCH_MODE=optc-ext \
  node bench/run.cjs box-fixture-f8a-optc-midpath perf-optc-midpath-complex
```
