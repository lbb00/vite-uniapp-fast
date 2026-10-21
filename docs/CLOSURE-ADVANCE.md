# CLOSURE-ADVANCE — F10 / F11 / F12 (box · Asia/Shanghai)

Constraint: **BOX ONLY** (no Mac / WeChat).

## Verdict

| Item | Verdict | Warm wall | generated | sha-changed |
|------|---------|-----------|-----------|-------------|
| **F10** util with static import | **ENABLE** | **~2.3 ms** | 1 | only `modules/utils/unifast-chain-a.js` |
| **F11** leaf util (0 page importers) | **ENABLE** | **~2.0 ms** | 1 | only `modules/utils/unifast-chain-b.js` |
| **F11** multi-chunk API (`alsoRegenSources`) | **ENABLE** (offline) | ~1 ms | 2 files | synthetic |
| **F11** Option A page rebundle | **ENABLE (F14/F16)** | see OPTION-A.md | — | export-add / batch; **F16 no-dist inlined ENABLE (proxy)** |
| **F12** Vue script-only ≤CLOSURE_MAX | **ENABLE** | **~2.1 ms** | 1 | only `mini-shared/index.js` |
| **F12** Vue template change | **full gate** | **~1572 ms** | 1011 | reason `shared-vue-template-or-style` |

Ratio vs fixture full warm (~1.6–4.7s cold / ~1.6s full warm): F10/F11/F12 script ≈ **700×+** faster than full warm.

## What was built

### F10 — `optc-ext-closure.mjs`
- `parseStaticImports` + resolve relative / `@/` → cold dist
- `transformUtilEsmToCjs(src, { inputDir, outDir, sourceAbs, distFile })` rewrites imports to `require("./dep.js")`
- Prefer `cold-body-patch-with-imports` when cold already has matching requires
- Fail-closed: dynamic import, bare specifier, unresolved, missing dep dist, default/reexport, circular self
- Without opts → still `closure-source-has-imports` (F8b contract)

### F11
- Leaf util (`importerCount===0` but util-importer or dist exists) → `leaf-chunk-regen` via `emitClosureMultiChunkSync`
- `findUtilImportersOf` scans modules/utils for util→util edges
- Multi-chunk: regen primary (+ optional `alsoRegenSources`)
- Option A: `optionACandidate` on dist-missing / export-surface; vite documents **inlined rebundle not implemented** → full

### F12
- `componentFp` seeded from reverseDeps `.vue` files
- Script-only + importerCount∈[1,CLOSURE_MAX] → `emitClosureVueComponentSync` (page surgical cascade on component dist JS)
- Template/style change → `shared-vue-template-or-style` full
- Importing another `.vue` in component script → fail-closed

## Fixture additions
- `src/modules/utils/unifast-chain-a.js` (imports B) · `unifast-chain-b.js`
- `src/modules/components/mini-shared/index.vue` (tip ref)
- `pkg0/p1.vue` + `p2.vue` import chain + Mini (importerCount=2)

## Bench suites
```bash
cd compile-optimization/fixture
BENCH_BACKUP=../fixture-source-backup BENCH_MODE=optc-ext \
  node bench/run.cjs box-fixture-f10-chain perf-optc-f10-chain
BENCH_BACKUP=../fixture-source-backup BENCH_MODE=optc-ext \
  node bench/run.cjs box-fixture-f11-leaf perf-optc-f11-leaf
BENCH_BACKUP=../fixture-source-backup BENCH_MODE=optc-ext \
  node bench/run.cjs box-fixture-f12-vue perf-optc-f12-vue
BENCH_BACKUP=../fixture-source-backup BENCH_MODE=optc-ext \
  node bench/run.cjs box-fixture-f12-vue-tpl perf-optc-f12-vue-tpl
```

## Artifacts
- `verify/closure-advance.json` · this file
- reports: `box-fixture-f10-chain`, `box-fixture-f11-leaf`, `box-fixture-f12-vue`, `box-fixture-f12-vue-tpl`
- offline: `node verify/closure-advance.mjs` → 14/14
- regression: **27/27** includes f10/f11/f12 ids

## Honest leftovers
- Option A **inlined-util (no dist chunk)** page rebundle — **ENABLE (F16 proxy-for-inlined)**; see OPTION-A.md
- Large-importer Vue (shared-popup) still full by threshold
- WeChat runtime Unverified

See also: `verify/OPTION-A.md` (F14).
