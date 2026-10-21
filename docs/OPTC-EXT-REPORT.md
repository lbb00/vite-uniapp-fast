# True Opt C (optc-ext) — skip Vite rebuild, page-only emit

Host: box · 2026-10-15 Asia/Shanghai · Node v20.19.2 · Rollup 4.64.6 · Vite 5.2.8  
Flag: `BENCH_MODE=optc-ext`

## What was wired

| Piece | Path |
|-------|------|
| Emitter | `optimize/lib/optc-ext-emitter.mjs` — surgical / setup-body / **setup-body-local-imports** (cold require map) |
| Vite plugin | `optimize/lib/optc-ext-vite.mjs` → `{fixture,project}/scripts/vite-plugins/optc-ext.mjs` |
| Metrics | `{fixture,project}/bench/metrics.mjs` (emits on aborted rebuild) |
| Gate | Opt B content fingerprint (reuse of page-inc logic) |

**Mechanism (Measured):**

1. **Cold:** full uni mp-weixin build; seed per-page SFC hashes + Opt B fingerprints **and** script text for literal diff.
2. **Warm stable page script edit:** Opt B says import-set + direct-dep content stable → **surgical `ref('…')` literal patch** on the cold `dist/.../<page>.js` (bench probe is proven to appear as `common_vendor.ref("…")` in page JS) → write **1 file** → `buildStart` (`enforce: 'pre'`) throws `unifast-optc-ext-skip` so Vite/Rollup **does not** build graph or generate.
3. **Externals:** existing `require('../../common/vendor.js')` and other cold chunks stay on disk untouched.
4. **Fallback:** template/style/import-set/dep-content/shared/non-page → `path=full`, normal Vite rebuild.

## Measured

### Fixture (500 pages) — `verify/optc-ext-fixture.json` · report `box-fixture-optc-ext-v4`

| step | totalMs | generated | viteSkipped | decision |
|------|---------|-----------|-------------|----------|
| cold | **5236** | 2009 | false | full / cold-seeded |
| script1 | **~2** | **1** | **true** (abortedRebuild) | **optc-ext** |
| component | **1606** | 1007 | false | **full** / non-page-or-shared-changed |

| metric | baseline | page-inc | **optc-ext** |
|--------|----------|----------|--------------|
| script1 wall | 1646 ms | 610 ms | **~2 ms** |
| generated | 1006 | 8 | **1** |
| updatedMtimes | 1006 | 8 | **1** |

**Correctness (script1):** pageEditPresent, vendorShaStable, other page untouched, WXML/JSON untouched, routeA JS changed — **all true**. Shared component → full — **true**.

### Project (479 routes, heap 8192) — `verify/optc-ext-project.json` · report `box-project-optc-ext-v3`

| step | totalMs | generated | viteSkipped | decision |
|------|---------|-----------|-------------|----------|
| cold | **120037** (~120 s) | 10707 | false | full / cold-seeded |
| script1 | **~4** | **1** | **true** (abortedRebuild) | **optc-ext** |
| component | **63920** (~64 s) | 5659 | false | **full** / non-page-or-shared-changed |

| metric | baseline | page-inc | **optc-ext** |
|--------|----------|----------|--------------|
| script1 wall | **58721 ms** | 54490 ms | **~4 ms** |
| generated | 5658 | 546 | **1** |
| graph / emit | graphMs 43853 | graphMs 4724 | emitMs **~2.6**, rebuild aborted |

**Correctness (script1):** pageEditPresent, vendorShaStable, WXML/JSON untouched, 8/8 other sample pages sha+mtime stable, changedContents=1, updatedMtimes=1, requireCount=19 all on disk — **all true**. Shared component → full rebuild — **true**.

**Target check:** wall ≪ 10 s **yes**; stretch &lt; 2 s **yes**; generated≈1 **yes**; Vite full rebuild skipped **yes**.

## Inferred

- Page-inc’s remaining project cost was routeA **closure generate** (~546 chunks / ~50 s). Skipping Vite entirely removes that.
- Surgical literal patch is valid for the **bench script1 edit class** (string-literal `ref()` change present 1:1 in cold page JS). Broader script edits (non-literal / AST-shape changes) must fall back to full (or a future real uni transform emit).
- Abort-via-throw keeps the previous Rollup watch graph (do **not** re-`addWatchFile` thousands of paths on skip — that stalled project component fallback).

## Correctness follow-up (2026-10-15)

See `verify/OPTC-EXT-CORRECTNESS.md`, `verify/optc-ext-sha-compare.json`, `verify/optc-ext-fallback.json`, `verify/optc-ext-transform.json`.

| Item | Result |
|------|--------|
| Byte-SHA surgical vs uni warm | **match** fixture + project |
| Non-literal rename → full | **Measured** fixture ~1841 ms, generated 1006, viteSkipped=false |
| Setup-body `ref(42)` emit | **Measured** ~3.6 ms, generated 1, **byte-SHA match** vs uni warm |
| Emitter cascade | surgical → setup-body → full |



## Local-import unblock (2026-10-15)

See `verify/optc-ext-local-import.json` + `OPTC-EXT-CORRECTNESS.md` §4.

| Surface | Edit | baseline wall | **optc-ext** | generated | SHA |
|---------|------|---------------|--------------|-----------|-----|
| Fixture | `probeMul(21→22)` | 1636 ms / 1007 | **~6.7 ms** / 1 | 1 | **match** |
| Project routeA | `flagA ref(false→true)` | ~58–64 s class | **~50 ms** / 1 | 1 | shape OK; SHA Unverified |

Previously `local-import-in-setup` forced full rebuild on <private-app> routeA. Now 23 locals map onto cold `require`/`common_vendor` forms; Vite skipped.

## Unverified

- WeChat DevTools runtime after mid-session page-only write.
- Project local-import byte-SHA vs uni warm (fixture SHA match Measured; project shape Measured).
- Combining with write-skip `fs` mode (unnecessary once generate is skipped).

## Verdict

| Surface | Verdict |
|---------|---------|
| Fixture | **ENABLE** — script1 **1646→~2 ms**, generated **1006→1**, Vite skipped, shared→full |
| Project | **ENABLE** — script1 **58721→~4 ms** (≈14000×), generated **5658→1**, Vite skipped, shared→full (~64 s) |
| Overall | True Opt C wall-clock goal met for stable page script edits of the proven literal class |

## Artifact index

| file | what |
|------|------|
| `verify/optc-ext-fixture.json` | fixture numbers + correctness |
| `verify/optc-ext-project.json` | project numbers + target checks |
| `verify/optc-ext-sha-compare.json` | byte-SHA vs uni warm (surgical + setup-body) |
| `verify/optc-ext-fallback.json` | non-literal → full rebuild |
| `verify/optc-ext-transform.json` | setup-body broadened emit |
| `verify/optc-ext-local-import.json` | local-import require-map emit |
| `verify/OPTC-EXT-CORRECTNESS.md` | correctness dossier |
| `verify/OPTC-EXT-REPORT.md` | this report |
| `optimize/lib/optc-ext-emitter.mjs` | surgical + setup-body cascade |
| `optimize/lib/optc-ext-vite.mjs` | gate + skip plugin |
| `optimize/OPTIMIZATIONS.md` | appendix updated |
