# Risk further-solvability (Measured · 2026-10-19 Asia/Shanghai)

**Machine:** `verify/risk-further.json` · harness `verify/risk-further.mjs`  
**CRITICAL_WRONG:** 0

## Row table

| Risk | Can further solve? | Action taken | Verdict |
|------|-------------------|--------------|---------|
| Options API page script warm (no `setup(__props)`) | **PARTIAL** | `surgical-options-data` for `data()` return literals; methods/structure fail-closed | **SOLVED_PARTIAL** — lit SHA==uni gold `13075b53…`; live warm ~12ms gen1 |
| Vue macros (`defineProps`/…) | **PARTIAL** | `surgical-props-default` for `default` literals; midpath refuses `vue-macro` residue | **SOLVED_PARTIAL** — SHA==gold `674455b6…`; live ~7ms; type/structure → full |
| Template / style / `:is` / slots | **NO** | None — needs uni mp template→wxml/wxss | **NOT_SOLVABLE_WITHOUT_FULL** |
| High-fanout Vue (`>CLOSURE_MAX`) | **YES** | `UNI_FAST_OPTC_CLOSURE_VUE_MAX` default **512** (1 dist file write) | **SOLVED** |
| DevTools mid-write static guarantee | **PARTIAL** | `atomicWriteFile` (tmp+`renameSync`) on page/chunk emits | **SOLVED_PARTIAL**; GUI still **BLOCKED** |
| F16 true Rollup-inlined util | **NO on this toolchain** | Uni keeps `unifast-probe` as separate `require()` chunk | **NOT_SOLVABLE_ON_THIS_TOOLCHAIN** (proxy remains) |
| String/ASI emitter residual | **PARTIAL** | ASI splitter + `setup-asi-ambiguous` fail-closed (prior); residual → full | **SOLVED_PARTIAL** |
| Integrity never-seeded side files | **YES** | `new-file-never-seeded` → `FULL_NEW_FILE` | **SOLVED** |
| Dual-speed UX | **YES (codes)** | `FULL_OPTIONS` / `FULL_MACROS` / `FULL_NEW_FILE` + `optionsOnly` track | **SOLVED** (dual-speed remains product fact for template / Options non-literal) |
| DevTools GUI hot-reload | **BLOCKED** | No Mac login | **BLOCKED** |

## Code landed

1. `optimize/lib/optc-ext-options.mjs` (**new**)
2. `optc-ext-emitter.mjs` — Options/props cascade + `atomicWriteFile`
3. `optc-ext-midpath.mjs` — `midpath-vue-macro-residue`
4. `optc-ext.mjs` / `optc-ext-vite.mjs` — `CLOSURE_VUE_MAX`, new-file gate, reasonCodes
5. Synced → `compile-optimization/{fixture,project}/scripts/vite-plugins/`

## Live SHA proofs (optc vs uni baseline warm)

| Edit | Baseline SHA | Optc SHA | Path | ms / gen |
|------|--------------|----------|------|----------|
| Options data lit | `13075b53…` | **same** | optc-ext / surgical-options-data | ~12 / 1 |
| Macros default lit | `674455b6…` | **same** | optc-ext / surgical-props-default | ~7 / 1 |
| RouteA call-arg | `bb954f69…` | **same** | optc-ext / surgical-call-arg | ~4 / 1 vs baseline ~854 / 1013 |
