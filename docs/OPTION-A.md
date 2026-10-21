# OPTION-A — F14 / F16 (box · Asia/Shanghai)

Constraint: **BOX ONLY** (no Mac / WeChat).

## Verdict

| Item | Verdict | Warm / offline wall | generated | notes |
|------|---------|---------------------|-----------|-------|
| **F14 export-add chunk-only** | **ENABLE** | **~1.9 ms** warm | 1 | only `modules/utils/unifast-probe.js` |
| **F14 page use new export** | **ENABLE** | **~6.5 ms** warm | 1 | `setup-body-local-imports` after chunk has export |
| **F14 offline batch add+page** | **ENABLE** | **~2–10 ms** | 2 files | `emitOptionABatchSync` |
| **F14 offline rename+page** | **ENABLE** | **~3.2 ms** | 2 files | `allowExportSurfaceChange` |
| **F14 stale page after rename** | **fail-closed** | — | — | `option-a-page-imports-missing-export` → full |
| **F16 inlined util (no dist) page rebundle** | **ENABLE** (proxy) | **~2.2 ms** offline (2 pages) | page JS only | `emitOptionANoDistPageRebundleSync` · label **proxy-for-inlined** |

Ratio vs fixture full warm (~1.6s): export-add ≈ **800×+**; F16 two-page inlined ≈ **700×+**.

## F16 — no-dist / inlined util (was BLOCKED)

### Problem
Some utils are imported by pages but have **no** dedicated dist chunk (uni/Rollup inlined, or cold mapping missing). Changing that source could not closure-patch a chunk → fell to full.

### Approach (Measured)
1. Detect: `resolveSharedDistChunk` → null + page importers ∈ [1, CLOSURE_MAX] + `optionACandidate`.
2. **No chunk invent**: for each affected page, optionally run surgical→midpath on page script drift, then **`patchInlinedUtilInPageJs`** — cold-body-style replace of inlined `function exportName(...){...}` from util ESM.
3. Fail-closed: dist exists (wrong path), missing export imports, no inlined anchor, syntax fail, noop (no byte change), over-threshold (vite).
4. Fixture: synthetic cold page with inlined `inlineHint` + src util **without** dist — honest **proxy-for-inlined** (true Rollup graph-inline not required to enable the branch).

### API
- `extractSimpleExportedFunctions` / `patchInlinedUtilInPageJs`
- `emitOptionANoDistPageRebundleSync({ requireNoDist: true })`
- Vite: on `clo.reason === 'closure-dist-chunk-missing'` → F16 path before F14 chunk/batch

## What was built (F14 reminder)

### `optc-ext-closure.mjs`
- `classifyExportSurfaceChange` → `same` | `add-only` | `remove-only` | `rename-or-mixed`
- `emitClosureSharedChunkSync({ allowExportAdd, allowExportSurfaceChange })`
- `emitOptionABatchSync` — chunk regen then page surgical → midpath cascade
- **`emitOptionANoDistPageRebundleSync`** — F16 page-only inlined patch

### `optc-ext-vite.mjs` / `optc-ext.mjs`
- Microtask batch: coalesce same-turn watch ids; **utils before pages**
- On `optionACandidate`:
  1. **`closure-dist-chunk-missing` → F16 inlined page rebundle**
  2. add-only + no dirty pages → `option-a-export-add` (chunk-only)
  3. dirty pages / rename → `option-a-batch` (chunk + page re-emit)
  4. else fail-closed full

## Offline bench (Measured · F16)

```bash
cd <workspace> && node verify/option-a.mjs
# f16-inlined-util-page-rebundle ~2.18 ms · 2 pages · vendor stable
```

| step | totalMs | reason | filesWritten |
|------|---------|--------|--------------|
| f16 two pages util body | **2.18** | `option-a-inlined-page-rebundle` | 2 (routeA + p1) |
| f16 no-anchor | fail-closed | `option-a-inlined-no-anchor` | 0 |
| f16 dist-exists | fail-closed | `option-a-inlined-dist-exists` | 0 |

## Artifacts
- `verify/option-a.json` · this file
- `verify/logs/f16-option-a-run.log` · `f16-smoke-tmp` / `option-a-f16-tmp`
- regression: **30/30** includes `f16-inlined-no-dist-page-rebundle`

## Honest leftovers
- **True uni Rollup graph-inline** not reproduced on fixture cold dist (all probed utils emit separate chunks) — F16 is **proxy-for-inlined** (no-dist + inlined fn bodies in page JS)
- Vite debounce across separate async writes still two rounds (suite uses split steps)
- WeChat runtime Unverified
