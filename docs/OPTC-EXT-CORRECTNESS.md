# Opt C Ext — Correctness (SHA, fallback, broadened emit)

Host: box · 2026-10-15 Asia/Shanghai · Node v20.19.2 · Vite 5.2.8 · Rollup 4.64.6  
Modes: `BENCH_MODE=optc-ext` | `baseline`

## Measured

### 1) Byte-SHA vs parallel uni warm emit

Artifacts: `verify/optc-ext-sha-compare.json`

| Surface | Edit class | Path A (optc-ext) | Path B (baseline warm) | Verdict |
|---------|------------|-------------------|------------------------|---------|
| Fixture 500 | script1 `ref('routeA')`→`ref('unifast-compile-probe-1')` surgical | `2819d949…` (v4) | `2819d949…` (baseline-real) | **match** |
| Project 479 | script1 first string-literal `ref("")`→probe surgical | `d20dacc5…` (v3) | `d20dacc5…` (baseline-real) | **match** |
| Fixture 500 | `ref('routeA')`→`ref(42)` setup-body | `0dd2dfc3…` (transform-v3) | `0dd2dfc3…` (baseline-setupbody-v2) | **match** |

Cold SHAs also matched across parallel runs (same toolchain). Offline surgical reconstruct of fixture cold→script1 also equals both artifact SHAs.

**Quoting / interop:** Surgical edits only the string value inside existing quotes (`common_vendor.ref("…")`). Setup-body rewrites `ref(`→`common_vendor.ref(` and normalizes `const x =` spacing to uni style. No `module.exports` / binding-name drift for these classes.

### 2) Non-literal edit → full rebuild

Artifacts: `verify/optc-ext-fallback.json` · report `box-fixture-optc-ext-fallback`

| step | totalMs | generated | viteSkipped | decision |
|------|---------|-----------|-------------|----------|
| cold | ~5304 | 2009 | false | full / cold-seeded |
| scriptNonLiteral | **~1841** | **1006** | **false** | **full** / **optc-emit-failed** |

Edit: rename `const label=` → `const labelRenamed=` (template still uses `label`).  
Opt B: import-set + dep-content **stable**.  
Emit cascade: surgical `no-ref-literal-change` → setup-body `render-binding-removed` (`label`) → **ok:false** → full Vite rebuild.

Assertions: decision=full ✓ · viteSkipped=false ✓ · wall full-scale (~1.8s) ✓ · generated~1006 ✓.

### 3) Broadened emit (setup-body splice)

Artifacts: `verify/optc-ext-transform.json` · report `box-fixture-optc-ext-transform-v3`

| step | totalMs | generated | viteSkipped | emitClass |
|------|---------|-----------|-------------|-----------|
| cold | ~5064 | 2009 | false | — |
| scriptSetupBody | **~3.6** | **1** | **true** | **setup-body** |

Edit: `ref('routeA')` → `ref(42)` (string-literal arity breaks surgical).  
vs same-edit baseline warm: **~1698 ms / generated 1006** → speedup ~**470×**; **byte-SHA match**.

**Mechanism:** strip imports → rewrite vue APIs to `common_vendor.*` → splice into cold `setup(__props){…}` while keeping render closure + wrappers; skip Vite via `unifast-optc-ext-skip`.

**Guardrails (Measured offline + wired):**

- Local non-vue imports used in setup → **require-map rewrite** (or `local-import-unmapped` → full)  
- Render-referenced binding removed/renamed → `render-binding-removed` → full  
- Surgical ref-literal remains fast-path when applicable  

**Unused-const note (Inferred from trial):** adding dead `const unifastProbeNum=42` is kept by setup-body but **DCE'd by uni** (baseline changedContents=0). Live binding edits are the fairness class for SHA compare.



### 4) Local-import setup-body (unblock composable/util pages)

Artifacts: `verify/optc-ext-local-import.json` · reports `box-fixture-optc-ext-local-import`, `box-project-optc-ext-local-import`, `box-fixture-baseline-local-import`

| Surface | Edit | totalMs | generated | viteSkipped | emitClass | SHA vs uni warm |
|---------|------|---------|-----------|-------------|-----------|-----------------|
| Fixture 500 | `probeMul(21)`→`(22)` (named local import) | **~6.7** | **1** | **true** | setup-body-local-imports | **match** (`bb954f69…`) |
| Fixture baseline same edit | (full Vite) | **~1636** | 1007 | false | — | gold for SHA |
| Project 479 | `flagA ref(false)`→`ref(true)` (~20 locals in setup) | **~50** (prior) / dryRun named | **1** | **true** | **surgical-named** (cold-guided) | **match** `4ff68d48…` |

**Mechanism (Measured):** parse cold `require()` + chunk `exports.*` → map each SFC local used in setup to `requireBinding.exportName` (named/default) or `common_vendor.*` (vue/uni-app / vendor-folded pkgs like `@private-scope/pkg-a`) → identifier-aware rewrite → splice setup stmts; keep require preamble + lazy component consts + render closure; `buildStart` skip Vite.

**Project correctness (Measured):** `flagA = common_vendor.ref(true)` present; 19/19 requires on disk; vendor SHA stable; WXML/JSON/WXSS untouched; 8/8 sample other pages sha+mtime stable; lazy `ComponentA` etc. preserved; mapped calls (`useStoreA`, `trackerA.trackerA.fnB`, `ApiA`, `onLoad`, `url.fnA`) present. localMappedCount=23, unmapped=0 (offline preflight).

**Speedup:** fixture ~246× vs same-edit baseline; project ~1179× vs prior script1 full warm (~58721 ms).

**Guardrails still Measured:** rename → `render-binding-removed` → full; surgical string-literal path unchanged; unmapped local → `local-import-unmapped` → full.



### 5) WeChat DevTools — optc-ext page-only JS write (Mac CLI)

Artifacts: `verify/wechat-devtools-optc.json` · Mac smoke `<local-dir>/wechat-optc-smoke/`

| Check | Result |
|-------|--------|
| `cli islogin` | **`{"login":false}`** → **blocked_needs_login** |
| `cli open --project` + `touristappid` | **fail** code 10: 不存在此 AppID — no compile error text |
| `cli open --project` + local appid `wx<redacted>` (from `<local-dir>/miniprogram-1`, open-only) | **fail** code 10: 需要重新登录 — no compile error text |
| `cli open` (IDE only) | **ok** (HTTP :9420) |
| `cli preview` | **fail** AppID/login gate — **blocked_needs_login** |
| Optc-style overwrite `pages-tab/routeA/index.js` `probeMul(22)`→`(99)` | Applied; SHA `bb954f69…`→`7c6a53a2…` |
| Structure after swap | **STRUCTURE_OK** — requires resolve; companions + vendor present; `new Function` syntax OK on routeA/vendor/probe/app |
| Compile error attributable to page-only write | **Unverified** (CLI never reached compile) |
| Simulator UI interaction | **Unverified** |

**Blocker:** DevTools session not logged in. Re-run after user `cli login` (or IDE QR login): open smoke project at `<local-dir>/wechat-optc-smoke/mp-weixin`, confirm simulator compiles, then re-apply the same single-file overwrite mid-session.


## Inferred

- Project routeA byte-SHA vs uni warm will drift: splice uses source setup (with local→require rewrite) while uni applies DCE / optional-chaining helpers / formatting. Runtime-shape (requires + edit token + stable vendor/others) is the fairness bar for this class.
- One-page Rollup rebundle with dist externals still unnecessary once require-map splice works.



### 5) SHA align — cold-guided named literal (project local-import)

Artifacts: `verify/SHA-ALIGN.md` · `verify/sha-align-verify.json` · `verify/logs/sha-anatomy/diff-anatomy.json`

| Surface | Edit | emitClass | SHA vs uni warm |
|---------|------|-----------|-----------------|
| Project routeA | `flagA` false→true | **surgical-named** | **MATCH** `4ff68d48…` (28818 B, byteIdentical) |

**Prior gap:** setup-body-local-imports re-emitted whole setup → `201782d2…` (−3152 B): missing `;`, retained bindings uni DCE’d.

**Fix:** cascade step between string surgical and setup-body — patch named `ref(literal)` args **in place** on cold JS when the entire script diff is those flips. Preserves uni formatting + DCE.

**Fail-closed (Measured):** arity/added binding; incomplete non-literal diff; DCE’d binding missing in cold; `externals-missing` before write.

**Non-regression:** fixture string surgical; fixture `probeMul` still setup-body-local-imports; multi named bool/num/string; numeric `ref(42→43)`.


## Unverified

- WeChat DevTools mid-session compile/runtime: **CLI open/preview blocked_needs_login** (Measured 2026-10-15); structure-after-swap OK Measured; simulator Unverified until login.
- Project byte-SHA vs uni warm for local-import class (fixture SHA **match** Measured).
- Template / style incremental paths (still full by design).

## Verdict

| Claim | Verdict |
|-------|---------|
| Surgical script1 byte-identical to uni warm | **ENABLE** (fixture + project Measured) |
| Non-patchable script edit → full | **ENABLE** (fixture Measured) |
| Setup-body broader script-only emit | **ENABLE** for vue-api-only pages (fixture Measured, SHA match) |
| Local-import setup-body (require-map) | **ENABLE** — fixture SHA match ~6.7 ms; project routeA non-literal ~50 ms, Vite skipped, runtime-shape OK |
| WeChat runtime / DevTools open | **blocked_needs_login** (Measured); structure-after optc page JS swap **OK**; compile/simulator still **Unverified** until login |


## 6) Linux deep verify (box only · no Mac) — 2026-10-15 later

Artifacts: `verify/LINUX-DEEP-VERIFY.md` · `verify/linux-deep-verify.json` · `verify/logs/sha-anatomy/`

### 6.1 Project local-import byte-SHA vs uni warm — Measured MISMATCH

| Path | wall | generated | page SHA | bytes |
|------|------|-----------|----------|-------|
| baseline warm (`box-project-baseline-local-import-deep`) | **54933 ms** | 5658 | `4ff68d48…` | ~28818 |
| optc-ext (`box-project-optc-ext-local-import` / offline re-emit) | **~50 ms** | 1 | `201782d2…` | 25562–25794 |

Anatomy: require preamble **identical** (19); edit token in both; first diff ~offset 4213 (semicolons); uni DCE drops unused bindings while optc keeps source-faithful setup. **Do not claim SHA match.** Runtime-shape remains the fairness bar (still Measured OK from §4).

### 6.2 Product tree — Measured

Optc page-script edits change **exactly one** page `.js` SHA; `.json`/`.wxml`/`.wxss`, `common/vendor.js`, `app.*`, and sample other pages sha+mtime **stable** (fixture + project manifests).

### 6.3 Complex edits / fallthrough — Measured (fixture)

Multi-ref surgical ~2.6ms; bool setup-body ~3.2ms; second local probeMul ~1.9ms; multi-page pkg surgical ~1ms; template/style/shared/add-import/rename/new-live-in-template → **full** with expected Opt B reasons. Missing require chunk → **`externals-missing`** fail-closed (emitter+plugin fix).

### 6.4 Coverage sample — Measured (bounded)

40 project pages offline probe: **45%** page-only capable for trivial ref/bool flip; 0 crashes. Lower bound only.

### 6.5 WeChat — deferred

Per user: **do not use Mac**. Prior §5 `blocked_needs_login` unchanged; simulator still **Unverified**.

### 6.6 Bugfix

Missing cold `require` target previously still skipped Vite. Fixed: emitter returns `externals-missing` without write; vite plugin `optc-externals-missing` → full. Synced to `optimize/lib` + fixture/project vite-plugins.
