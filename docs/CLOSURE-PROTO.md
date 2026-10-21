# CLOSURE-PROTO — F7/F8b shared-chunk MVP (box · Asia/Shanghai)

Constraint: **BOX ONLY**.

## Verdict: **ENABLE** (Option B MVP)

> F10–F12 advances: see **`verify/CLOSURE-ADVANCE.md`**.

| Case | importerCount | Path | Wall | generated | Pages / chunk | Label |
|------|---------------|------|------|-----------|---------------|-------|
| `unifast-probe.js` body mark | **3** (routeA+p1+p2) | `closure-shared-chunk` | **~2.3 ms** | 1 | **only** `modules/utils/unifast-probe.js` sha-changed | **Measured** F8b |
| same, `CLOSURE_MAX=2` | **3** > 2 | `shared-module-multi-page` full | **~1638 ms** | 1006 | full path (probe bytes may == cold if comment stripped) | **Measured** F8b |
| `shared-popup` Vue SFC | **500** | full | **~1771 ms** | 1007 | — | **Measured** F7 |
| util with `import` | see F10 | **closure-chunk** | **~2.3 ms** | 1 | only util chunk | **ENABLE** → `CLOSURE-ADVANCE.md` |

Ratio: over-threshold full / closure-multi ≈ **723×**.

## Fixture change (F8b)

`pkg0/p1.vue` + `pkg0/p2.vue` (and `fixture-source-backup`) now `import {probeMul} from "@/modules/utils/unifast-probe.js"` so reverseDeps importerCount = **3**. Prior F7 one-importer (~2.4 ms) is historical.

## What was built

`optimize/lib/optc-ext-closure.mjs` + `optc-ext-vite.mjs` `watchChange`:

1. reverseDeps importerCount ∈ `[1, CLOSURE_MAX]` (default **3**)
2. script util only (`.js/.mjs/.ts`), **not** `.vue`
3. export name set(cold CJS) == export name set(new ESM) else fail-closed → full
4. Prefer **cold-body-patch** into existing dist chunk; else simple ESM→CJS transform
5. Update importer fingerprint contentHashes; **skip Vite**
6. Pages left untouched (Option B)

## Honest blockers / Unverified

- Vue SFC script-only ≤CLOSURE_MAX → **F12 ENABLE** (`CLOSURE-ADVANCE.md`); template/over-threshold → full
- Export add/remove → full (Measured)
- Source with static imports → **F10 ENABLE**; re-export/default still fail-closed
- importerCount > threshold → full (F8b Measured)
- Option A inlined page rebundle → **BLOCKED** (F11)
- Leaf / multi-chunk util → **F11 ENABLE**
- WeChat runtime **Unverified**

## Artifacts

- `verify/closure-proto.json`
- reports: `box-fixture-f8b-closure-multi`, `box-fixture-f8b-closure-over`, `box-fixture-f7-optc-closure`
- plugins: fixture/project `scripts/vite-plugins/optc-ext-closure.mjs`

## Re-run

```bash
cd compile-optimization/fixture
BENCH_BACKUP=../fixture-source-backup BENCH_MODE=optc-ext \
  node bench/run.cjs box-fixture-f8b-closure-multi perf-optc-closure-multi
UNI_FAST_OPTC_CLOSURE_MAX=2 BENCH_BACKUP=../fixture-source-backup BENCH_MODE=optc-ext \
  node bench/run.cjs box-fixture-f8b-closure-over perf-optc-closure-over
```
