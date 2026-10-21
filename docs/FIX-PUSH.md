# FIX-PUSH — optc-ext remediation F1–F8 (box · 2026-10-15 Asia/Shanghai)

Constraint: **BOX ONLY** — no Mac / no WeChat / no machineId.

## Verdict table

| Workstream | Verdict | Key metrics (Measured unless noted) | Artifacts |
|------------|---------|-------------------------------------|-----------|
| **F1** Harden regression | **ENABLE** | **24/24** PASS · sha-align 12/12 PASS | `verify/regression-suite.{mjs,json,md}` · `verify/sha-align-verify.*` |
| **F2** Expand cold anchors | **ENABLE** | `surgical-plain-literal` · `surgical-call-arg` (probeMul 21→22 byte-eq cold in-place · cascade ~2.1ms) | `optimize/lib/optc-ext-emitter.mjs` |
| **F3** Mid-path Rollup | **ENABLE** (MVP) | rollupUsed=true · rollupMs≈25 · total≈166ms ≪ fixture full warm **1603ms** (Measured ref) · generated=1 · requires OK | `optimize/lib/optc-ext-midpath.mjs` · wired in `optc-ext-vite.mjs` |
| **F4** Shared-change gate | **ENABLE** | small util → F7; Vue/over-threshold → `shared-module-multi-page` full | `optimize/lib/optc-ext-vite.mjs` reverseDeps |
| **F5** Evidence | **ENABLE** | this file + updated `EVIDENCE-SUMMARY.md` | `verify/FIX-PUSH.md` · `verify/EVIDENCE-SUMMARY.md` |
| **F6** Warm Vite + SHA | **ENABLE** | call-arg **~12.9ms** · midpath-forced **~4.5ms** · baseline **~1628ms** · SHA **MATCH** `bb954f69…` all three | `verify/MIDPATH-WARM.md` · `verify/midpath-warm.json` |
| **F7** Closure proto | **ENABLE** (Option B MVP) | probe 1-importer **~2.4ms** closure-chunk; Vue SFC 500-importer **~1771ms** full | `verify/CLOSURE-PROTO.md` · `verify/closure-proto.json` · `optimize/lib/optc-ext-closure.mjs` |
| **F8a** Complex midpath SHA | **MATCH Measured** | baseline **~1694ms** vs natural setup-body **~9.3ms** / forced midpath **~5.5ms**; all SHA **`a0bfb44b…`** 735 B · byte-identical | `verify/MIDPATH-COMPLEX.md` · `verify/midpath-complex.json` · `logs/sha-anatomy/` |
| **F8b** Multi-importer closure | **ENABLE** | importerCount **3** closure **~2.3ms** only probe chunk; `CLOSURE_MAX=2` → full **~1638ms**; import-stretch **BLOCKED** | `verify/CLOSURE-PROTO.md` (updated) · `closure-proto.json` |

## F1 — Regression suite

- Single entry: `node verify/regression-suite.mjs`
- Asserts: surgical string / surgical-named SHA vs gold / probeMul call-arg / setup-body fallback / fail-closed (incomplete, arity, DCE-missing, externals-missing **no write**) / only page `.js` changes
- No regressions found after F2–F4; suite green.

## F2 — New emit classes

Cascade order (Measured):

1. `surgical` — string ref literals  
2. `surgical-named` — named `ref(true|false|num|…)`  
3. **`surgical-plain-literal`** — `const x = <literal>`  
4. **`surgical-call-arg`** — mapped local calls e.g. `probeMul(n)` → `modules_utils_unifastProbe.probeMul(n)` in-place  
5. `setup-body` / `setup-body-local-imports`  
6. fail → F3 midpath / full  

Fail-closed when ambiguous (unmapped callee, incomplete diff, missing cold site).

**Re-measure (offline emitter, Measured):**

| Case | Wall | Class |
|------|------|-------|
| surgical string | ~1.7–5.6 ms | surgical |
| surgical-named (project bool) | ~2–4 ms | surgical-named · SHA==gold |
| probeMul call-arg | ~2.1 ms | surgical-call-arg · byte-eq cold patch |
| Fixture warm local-import (F6) | **12.9 ms** | **surgical-call-arg** · SHA==uni baseline |

## F3 — Mid-path (what we actually built)

**Not** a full `@dcloudio` SFC re-pipeline.

MVP:

1. Rewrite setup body with the same local→require / vue→`common_vendor` map as setup-body  
2. **Async:** Rollup a virtual CJS module with `external: true` for everything except the virtual entry (proves Rollup + cold external graph)  
3. **Write path:** cold-shell splice (preamble + return closure preserved) — sync variant for Vite `watchChange`  
4. Vite: on `import-set-changed` or cascade-fail → try `emitOptCExtMidpathSync` before `forceFull`

SHA vs uni warm: **MATCH Measured** for probeMul call-arg (F6) **and** complex setup rewrite (F8a) after `formatSetupStmtsLikeUni`.

## F4 — Shared gate

- Seed builds `reverseDeps`: abs import path → Set(pagePath)  
- Non-page script util with `1 ≤ importerCount ≤ CLOSURE_MAX` (default 3) → **F7 closure-chunk** regen  
- Vue SFC / over-threshold / export-surface change → `forceFull('shared-module-multi-page')`  
- Shared Vue component still full: **Measured** (~1771ms fixture)

## Sync

Plugin copies updated:

- `compile-optimization/{fixture,project}/scripts/vite-plugins/optc-ext-emitter.mjs`  
- `…/optc-ext.mjs` (vite)  
- `…/optc-ext-midpath.mjs`  
- `…/optc-ext-closure.mjs` (F7 new)

## Remaining gaps

| Gap | Label |
|-----|-------|
| WeChat DevTools mid-write runtime | **Unverified** (user: no Mac) |
| Full Vite warm rebench after call-arg | **Measured** F6 (fixture); project spot-check skipped (no probeMul page) |
| True closure rebuild for shared chunks | **ENABLE MVP** Option B chunk-regen (F7); Vue/SFC/over-threshold still full |
| Midpath byte-SHA == uni warm | **MATCH Measured** for call-arg (F6) and complex setup (F8a) |
| Import-set midpath when new export absent from cold chunk | **fail-closed** Measured (`cold-chunk-export-missing` → midpath-local-unmapped → full) |

## F6 — Warm Vite rebench (Measured)

| Mode | Suite | Wall | emitClass | SHA |
|------|-------|------|-----------|-----|
| baseline | perf-optc-local-import | 1627.9 ms | (uni full) | `bb954f69…` |
| optc-ext | perf-optc-local-import | **12.9 ms** | **surgical-call-arg** | **== baseline** |
| optc-ext + `UNI_FAST_OPTC_FORCE_MIDPATH=1` | perf-optc-midpath | **4.5 ms** | **midpath-sync** | **== baseline** |

Regression offline: 21/21 PASS including `f6-call-arg-vs-midpath-offline`.

Details: `verify/MIDPATH-WARM.md`.

## F7 — Closure rebuild prototype (Measured ENABLE MVP)

Option B: regenerate **one** shared dist chunk when export surface stable and importerCount ≤ 3.

| Edit | importers | Path | Wall |
|------|-----------|------|------|
| unifast-probe body comment | 1 | closure-chunk / cold-body-patch | **2.4 ms** |
| shared-popup template | 500 | full / over-threshold | **1771 ms** |

Manifest: closure step changes **only** `modules/utils/unifast-probe.js`.

Details: `verify/CLOSURE-PROTO.md`.

## How to re-verify (updated)

```bash
node verify/regression-suite.mjs
node verify/sha-align-verify.mjs
# warm (from fixture/)
BENCH_BACKUP=../fixture-source-backup BENCH_MODE=optc-ext node bench/run.cjs f6-callarg perf-optc-local-import
UNI_FAST_OPTC_FORCE_MIDPATH=1 BENCH_BACKUP=../fixture-source-backup BENCH_MODE=optc-ext node bench/run.cjs f6-mid perf-optc-midpath
BENCH_BACKUP=../fixture-source-backup BENCH_MODE=optc-ext node bench/run.cjs f7-clo perf-optc-closure
```

## F8a — Complex midpath SHA · MATCH Measured (closed)

Edit: `scriptComplexSetup` — restructure + setup-only `setupOnlyMark=ref(777)` (not in template). Opt B page-only.

| Mode | Wall | emitClass | routeA SHA |
|------|------|-----------|----------|
| baseline uni | **1694.4 ms** · gen 1007 | — | `a0bfb44b…` 735 B |
| optc natural | **9.3 ms** · gen 1 | setup-body-local-imports | **`a0bfb44b…` MATCH** |
| FORCE_MIDPATH | **5.5 ms** · gen 1 | midpath-sync | **`a0bfb44b…` MATCH** (nat==mid==uni) |

**Fix:** `formatSetupStmtsLikeUni` — partial DCE (drop unused setup-only binding names, keep side-effect RHS) + uni multi-line `;\n    ` format; shared by setup-body + midpath.

**Honest residual:** heuristic liveness DCE may still diverge on edits outside this class; escape hatches unchanged. F6 call-arg MATCH still holds.

## F8b — Multi-importer closure · ENABLE Measured

Fixture `pkg0/p1`+`p2` now import `unifast-probe` → importerCount **3**.

| Case | Wall | Path | Disk |
|------|------|------|------|
| sharedModule (max=3) | **2.3 ms** | closure-chunk / cold-body-patch | **only** `modules/utils/unifast-probe.js` |
| sharedModule (max=2) | **1638 ms** | full / over-threshold | path=full (comment may strip → 0 content churn) |
| util + `import` stretch | — | **BLOCKED** `closure-source-has-imports` | not implemented |

Vue SFC closure still **out of scope**.

## How to re-verify (F8)

```bash
node verify/regression-suite.mjs
cd compile-optimization/fixture
BENCH_BACKUP=../fixture-source-backup BENCH_MODE=baseline node bench/run.cjs f8a-base perf-optc-midpath-complex
BENCH_BACKUP=../fixture-source-backup BENCH_MODE=optc-ext node bench/run.cjs f8a-nat perf-optc-midpath-complex
UNI_FAST_OPTC_FORCE_MIDPATH=1 BENCH_BACKUP=../fixture-source-backup BENCH_MODE=optc-ext node bench/run.cjs f8a-mid perf-optc-midpath-complex
BENCH_BACKUP=../fixture-source-backup BENCH_MODE=optc-ext node bench/run.cjs f8b-multi perf-optc-closure-multi
UNI_FAST_OPTC_CLOSURE_MAX=2 BENCH_BACKUP=../fixture-source-backup BENCH_MODE=optc-ext node bench/run.cjs f8b-over perf-optc-closure-over
```


## F10–F12 (2026-10-15 CST) — Measured ENABLE

See `verify/CLOSURE-ADVANCE.md`.

| ID | What | Warm | Notes |
|----|------|------|-------|
| F10 | Util with static import → require() externals | **~2.3 ms** gen1 | only chain-a; `cold-body-patch-with-imports` |
| F11 | Leaf util 0 page importers + multi-chunk API | **~2.0 ms** gen1 | only chain-b; Option A inlined **BLOCKED** |
| F12 | Vue script-only ≤CLOSURE_MAX | **~2.1 ms** surgical | mini-shared; template → full ~1572 ms |

Regression **27/27**. Plugins synced to fixture/project `scripts/vite-plugins/`.

## F14 — Option A (Measured ENABLE)

| Path | Wall | Notes |
|------|------|-------|
| export-add chunk-only (warm) | **~1.9 ms** | `option-a-export-add` · generated=1 |
| page uses new export (warm) | **~6.5 ms** | `setup-body-local-imports` |
| offline batch add+page | **~2–10 ms** | `emitOptionABatchSync` |
| offline rename+page | **~3.2 ms** | surface rename-or-mixed |
| stale page after rename | fail-closed | `option-a-page-imports-missing-export` |
| inlined util no-dist | **BLOCKED** | honesty |

Details: `verify/OPTION-A.md` · `option-a.json`.

## F15 — Project spot-check (Measured ENABLE)

| Case | Wall | Result |
|------|------|--------|
| surgical-named routeA true→false | **~5.6 ms** | surgical-named |
| roundtrip → gold | **~3.7 ms** | SHA == `4ff68d48…` |
| leaf closure unifast-spot-probe | **~2.0 ms** | cold-body-patch |
| export-add spot probe | **~2.4 ms** | add-only |

`verify/project-spotcheck.json`. Probe file: `project/src/modules/utils/unifast-spot-probe.js` (bench-only).

Regression: **29/29** PASS including F14.
