# Linux deep verify — optc-ext (box only · 2026-10-15 Asia/Shanghai)

Constraint: **no Mac / no WeChat DevTools / no machineId**. All claims labeled Measured / Inferred / Unverified.

Artifacts: `verify/linux-deep-verify.json` · `verify/SHA-ALIGN.md` · `verify/sha-align-verify.json` · `verify/logs/sha-anatomy/` · reports under `compile-optimization/reports/box-fixture-optc-*` · `box-project-baseline-local-import-deep`.

---

## Verdict table

| Claim | Verdict | Evidence |
|-------|---------|----------|
| Optc-ext writes **only** intended page JS (companions/vendor/app/others stable) | **ENABLE** Measured | A: 4/4 report pairs `shaChanged==1` and only `pages-tab/routeA/index.js` (or pkg page) |
| Project local-import **byte-SHA == uni warm** | **MATCH** Measured | gold==optc `4ff68d48…` (28818B) via **surgical-named** cold-guided patch; prior setup-body was `201782d2…` MISMATCH |
| Project local-import **runtime-shape** (requires + edit token + stable others) | **ENABLE** Measured | 19/19 requires identical preamble; `flagA=ref(true)` in both; sample 20/20 other pages stable |
| Fixture complex edits (≥5) | **ENABLE** Measured | B table below |
| Multi-page sequential page-only | **ENABLE** Measured | pkg0/p1 + p2 surgical ~1–2ms; routeA token retained |
| Shared-module / template / style / rename / add-import → full | **ENABLE** Measured | decisions + full-scale walls |
| Missing cold require → fail closed | **ENABLE** Measured (after fix) | `externals-missing`; no write |
| WeChat simulator mid-session | **Unverified** | deferred per user (no Mac) |
| True mini-program runtime | **Unverified** | Linux `new Function` + require resolve only |

---

## A) Deep product-file compare

### Manifest pairs (cold → after optc-ext) — Measured

| Suite | files | sha-changed | only intended page JS? | sample other pages sha+mtime | family (json/wxml/wxss/vendor/app.*) |
|-------|-------|-------------|------------------------|------------------------------|--------------------------------------|
| fixture local-import | 2010 | 1 | yes (`pages-tab/routeA/index.js`) | n/a (pkg pages not `*/index.js`) | all **byte-identical** except page `.js` |
| project local-import | 10797 | 1 | yes | **20/20** | all **byte-identical** except page `.js` |
| fixture script1 surgical | 2009 | 1 | yes | — | stable companions |
| project script1 surgical | 10797 | 1 | yes | **20/20** | stable companions |

Require chunks referenced by edited project routeA: **19/19 STABLE** under optc local-import (Measured from manifests).

### Project local-import vs uni warm — SHA anatomy — Measured

| | baseline warm (uni) | optc-ext **surgical-named** (new) | prior setup-body-local-imports |
|--|---------------------|-----------------------------------|--------------------------------|
| report | `box-project-baseline-local-import-deep` | `verify/sha-align-verify.json` | `box-project-optc-ext-local-import` |
| wall | **54933 ms** · gen **5658** | dryRun emit · gen **1** (warm path same class historically ~50 ms) | **~50 ms** · gen **1** |
| page SHA | `4ff68d48…` | **`4ff68d48…` MATCH** | `201782d2…` MISMATCH |
| bytes | 28818 | **28818** · `byteIdentical` | 25562 |

**Resolution** (`verify/SHA-ALIGN.md` · `verify/logs/sha-anatomy/diff-anatomy.json`):

- Root cause of prior mismatch: full setup re-emit dropped uni `;` style and kept bindings uni had DCE’d.
- Fix: cold-guided **named literal** in-place patch (`flagA` `false→true`) preserves cold/uni formatting + DCE.
- Cold `6a8dbfbb…` + single `ref(false)→ref(true)` on `flagA` == gold (Measured).

---

## B) Complex script edits

### Fixture (BENCH_MODE=optc-ext) — Measured

| Case | step | totalMs | generated | viteSkipped | decision / emitClass |
|------|------|---------|-----------|-------------|----------------------|
| Local import ×2 | scriptLocalImport | ~5.5 | 1 | true | setup-body-local-imports |
| | scriptLocalImport2 | ~1.9 | 1 | true | setup-body-local-imports |
| Template-only | template | ~2209 | 1007 | false | **template-changed** → full |
| Style-only | style | ~1857 | 1007 | false | **style-changed** → full |
| Shared module | sharedModule | ~1824 | 1006 | false | **non-page-or-shared-changed** → full (output sha-changed 0: comment-only) |
| Multi-page p1 | scriptPkg1 | ~1.6 | 1 | true | **surgical** `original→pkg1-probe` |
| Multi-page p2 | scriptPkg2 | ~0.9 | 1 | true | **surgical** `original→pkg2-probe` |
| Enrich multi-ref | enrichMultiRef | ~2001 | 1006 | false | template-changed → full |
| Multi string refs | scriptMultiRef | **~2.6** | 1 | true | **surgical** routeA→routeA2 + tip0→tip1 |
| Bool flip | scriptBoolFlip | **~3.2** | 1 | true | **setup-body** flag false→true |
| Add import+dep | scriptAddImport | ~1603 | 1007 | false | **dep-content-changed** → full |
| New live in template | scriptNewLiveBinding | ~1764 | 1007 | false | **template-changed** → full |
| Rename route | renameRoute | ~1734 | 1009 | false | **pages-or-manifest-changed** → full |

Reports: `box-fixture-optc-deep` · `…-multiref` · `…-addimport` · `…-newlive` · `…-rename`.

### Project — Measured / Inferred

| Case | Result |
|------|--------|
| flagA false→true (local-import) optc | **surgical-named** · SHA==gold `4ff68d48…` · gen 1 (prior wall ~50 ms was setup-body path) |
| Same edit baseline warm | **54933 ms** · gen 5658 · SHA gold above |
| Other complex classes on project | **Inferred** same Opt B gates as fixture (template/style/shared/import-set); not re-timed this round (heap/cold cost) |

---

## C) Multi-page + filesystem fallthrough

| Check | Result | Label |
|-------|--------|-------|
| Sequential edits pkg0/p1 then p2 in one watch | each page-only; other pages (incl. routeA with probeMul(23)) stable | Measured |
| Rename route `p1`→`p1-renamed` | full · pages-or-manifest-changed · ~1.7s | Measured |
| Delete required cold chunk then emit | **before:** wrote anyway; **after fix:** `ok:false` `externals-missing`, filesWritten=0, page unchanged; plugin `optc-externals-missing`→full | Measured |

**Bugfix:** missing cold require still skipped Vite. Cause: emit returned ok without gating on `allExternalsOnDisk`. Fix: emitter refuses write; vite plugin forceFull.

---

## D) Offline emitter coverage (≥20 project pages) — Measured

Sample **40** routes (tabs + deep + stride) of **479** total; **0 crashes**.

| Metric | Value |
|--------|------:|
| classified ok | 40 |
| page-only capable (trivial probe) | **18 / 40 = 45%** |
| prefer surgical | 16 |
| prefer setup-body* | 2 |
| prefer full (probe could not patch) | 22 |

**Bound:** “capable” = offline surgical or setup-body succeeded for a **trivial string-ref flip** or true/false flip. Pages with **0 string refs** and no bool ref probe → counted full even if some other edit class might patch. Treat 45% as **lower bound** for trivial ref-shaped edits, not global edit coverage.

---

## E) Syntax / module-shape (Linux) — Measured

| File | `new Function` parse | requires resolve |
|------|----------------------|------------------|
| fixture routeA / vendor | OK | routeA OK |
| project routeA / vendor / app | OK | routeA 19/19 OK |

**Unverified:** WeChat mini-program runtime / simulator.

---

## Bugfixes this round

1. **`externals-missing` fail-closed** — `optimize/lib/optc-ext-{emitter,vite}.mjs` + fixture/project vite-plugins copies. Cause: page-only path skipped Vite while a `require()` target was absent.

---

## Remaining Unverified (Linux-only scope)

- WeChat DevTools / simulator (explicitly deferred — no Mac).
- Project wall clocks for template/style/shared (Inferred from fixture gates).
- Coverage beyond trivial ref/bool probe.
- Whether uni would accept optc JS at runtime despite SHA mismatch (structure OK Measured; runtime Unverified).
