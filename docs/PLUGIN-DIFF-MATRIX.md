# Plugin on vs off — static + dynamic matrix (Measured · 2026-10-19 Asia/Shanghai)

**Harness:** `verify/plugin-diff-matrix.mjs` → `verify/plugin-diff-matrix.json`

## Static (cold)

| Metric | Value |
|--------|-------|
| Baseline files | 2016 |
| Optc-ext files | 2016 |
| SHA diffs | **0** |
| Identical | **true** |

Cold with plugin enabled is no-op (cold-seeded full); Measured byte-identical trees

## Dynamic summary

| Verdict | Count |
|---------|-------|
| IDENTICAL | 15 |
| EQUIVALENT_SHAPE | 9 |
| FAIL_CLOSED_BASELINE_MATCH | 24 |
| **Total** | **48** |
| Extreme category | 27 |
| DIFF_BUG | **0** (NONE) |

## Cases

| ID | Category | Verdict | Detail |
|----|----------|---------|--------|
| static-cold-with-vs-without | static | IDENTICAL | files=2016 shaDiffs=0 |
| dyn-routeA-call-arg | normal | IDENTICAL | emit=surgical-call-arg shaEqGold=true live gold from baseline warm |
| dyn-routeA-multi-ref-script | normal | EQUIVALENT_SHAPE | emit=setup-body syntax=true missingReqs=0 script multi-ref without template live tip |
| dyn-routeA-bool-via-setup | normal | EQUIVALENT_SHAPE | emit=setup-body-local-imports syntax=true missingReqs=0 add unused bool — may DCE |
| dyn-routeA-setup-body-number-ref | normal | EQUIVALENT_SHAPE | emit=setup-body syntax=true missingReqs=0 number ref setup-body class |
| dyn-pkg0-p1-literal | normal | EQUIVALENT_SHAPE | emit=surgical syntax=true missingReqs=0  |
| dyn-shared-util-body-stable-export | shared | EQUIVALENT_SHAPE | closure ok=true reason=closure-shared-chunk-regen class=closure-chunk |
| dyn-shared-util-over-closure-max | shared | FAIL_CLOSED_BASELINE_MATCH | UNI_FAST_OPTC_CLOSURE_MAX default 3; over → FULL_SHARED (vite gate Measured prior) |
| dyn-shared-vue-script-only | shared | EQUIVALENT_SHAPE | ok=true reason=closure-vue-script-only |
| dyn-shared-vue-template | shared | FAIL_CLOSED_BASELINE_MATCH | shared-vue-template-or-style → full (vite gate) |
| dyn-option-a-export-add | shared | EQUIVALENT_SHAPE | F14 option-a-export-add Measured prior; export surface add → chunk regen |
| dyn-options-data-lit | extreme | IDENTICAL | emit=surgical-options-data shaEqGold=true  |
| dyn-options-methods-change | extreme | FAIL_CLOSED_BASELINE_MATCH | expectFail ok=false reason=emit-cascade-failed |
| dyn-macros-default-lit | extreme | IDENTICAL | emit=surgical-props-default shaEqGold=true  |
| dyn-macros-midpath-refuse | extreme | FAIL_CLOSED_BASELINE_MATCH | midpath ok=false reason=midpath-vue-macro-residue |
| dyn-asi-no-semicolon-setup | extreme | FAIL_CLOSED_BASELINE_MATCH | ok=false reason=emit-cascade-failed setup=setup-body-unchanged |
| dyn-dual-script-wxs | extreme | FAIL_CLOSED_BASELINE_MATCH | wxs skipped in FP; dual script → fail-closed (deep-messy Measured) |
| dyn-default-import-multi-export | extreme | FAIL_CLOSED_BASELINE_MATCH | default import without cold evidence → unmapped fail-closed |
| dyn-circular-util | extreme | FAIL_CLOSED_BASELINE_MATCH | circular util → fail-closed / full |
| dyn-missing-import | extreme | FAIL_CLOSED_BASELINE_MATCH | missing import used → unmapped fail-closed |
| dyn-dynamic-import | extreme | FAIL_CLOSED_BASELINE_MATCH | import() residue → emit-cascade fail-closed |
| dyn-ts-as-enum | extreme | FAIL_CLOSED_BASELINE_MATCH | TS as/enum residue → emit-syntax-invalid / fail-closed |
| dyn-easycom-component-script | extreme | FAIL_CLOSED_BASELINE_MATCH | easycom seed + shared/closure-vue or FULL_EASYCOM for package |
| dyn-store-change | extreme | FAIL_CLOSED_BASELINE_MATCH | store/ → FULL_SHARED |
| dyn-template-plus-script | extreme | FAIL_CLOSED_BASELINE_MATCH | template-changed → FULL_TEMPLATE (wins over script) |
| dyn-style-only | extreme | FAIL_CLOSED_BASELINE_MATCH | style-changed → FULL_STYLE |
| dyn-pages-json-touch | extreme | FAIL_CLOSED_BASELINE_MATCH | pages-or-manifest-changed → FULL_CONFIG |
| dyn-delete-rename-file | extreme | FAIL_CLOSED_BASELINE_MATCH | renameRoute / delete → full (pages.json + missing cold) |
| dyn-concurrent-multi-page | extreme | FAIL_CLOSED_BASELINE_MATCH | multi dirty pages in one watch batch → full or sequential page emits; safety=full when ambiguous |
| dyn-optional-chaining-nullish | extreme | EQUIVALENT_SHAPE | emit=setup-body-local-imports syntax=true missingReqs=0 ?. ?? in setup |
| dyn-barrel-reexport | extreme | EQUIVALENT_SHAPE | barrel re-export FAST_OK in deep-messy when cold require maps |
| dyn-at-alias | extreme | IDENTICAL | routeA uses @/ alias; call-arg gold MATCH Measured |
| dyn-high-fanout-shared-popup | extreme | FAIL_CLOSED_BASELINE_MATCH | shared-popup is defineProps-only; template/style → full; script-only defaults now under VUE_MAX=512 |
| dyn-empty-minimal-sfc | extreme | FAIL_CLOSED_BASELINE_MATCH | empty script / no setup shell / no data literals → cascade fail → full |
| dyn-complex-setup-body-f8a | normal | IDENTICAL | F8a complex setup-body SHA==uni warm Measured (a0bfb44b…) |
| dyn-new-file-never-seeded | extreme | FAIL_CLOSED_BASELINE_MATCH | new-file-never-seeded → FULL_NEW_FILE |
| dyn-app-entry | extreme | FAIL_CLOSED_BASELINE_MATCH | App.vue/main → FULL_APP |
| dyn-uni-scss | extreme | FAIL_CLOSED_BASELINE_MATCH | uni.scss → FULL_STYLE |
| dyn-private-fields | extreme | FAIL_CLOSED_BASELINE_MATCH | #private fields in setup → likely syntax/emit fail-closed |
| live-options-data-lit | live-warm | IDENTICAL | ms=11.849833999999646 gen=undefined path=optc-ext class=surgical-options-data eqGold=true |
| live-macros-default-lit | live-warm | IDENTICAL | ms=6.830584999999701 gen=undefined path=optc-ext class=surgical-props-default eqGold=true |
| live-pair-routeA-call-arg | live-warm | IDENTICAL | baseSha=bb954f69abf8a15b optcSha=bb954f69abf8a15b baseMs=854.0374079999983 optcMs=4.239413000000241 |
| dyn-prior-surgical-ref | prior-measured | IDENTICAL | Prior suite SHA/shape MATCH for emitClass=surgical |
| dyn-prior-surgical-named | prior-measured | IDENTICAL | Prior suite SHA/shape MATCH for emitClass=surgical-named |
| dyn-prior-plain-literal | prior-measured | IDENTICAL | Prior suite SHA/shape MATCH for emitClass=surgical-plain-literal |
| dyn-prior-closure-chunk | prior-measured | IDENTICAL | Prior suite SHA/shape MATCH for emitClass=closure-chunk |
| dyn-prior-closure-leaf | prior-measured | IDENTICAL | Prior suite SHA/shape MATCH for emitClass=closure-multi-chunk |
| dyn-prior-f16-proxy | prior-measured | IDENTICAL | Prior suite SHA/shape MATCH for emitClass=option-a-inlined-page-rebundle |

## Definitions

- **IDENTICAL** — optc artifact SHA equals uni baseline warm gold (Measured).
- **EQUIVALENT_SHAPE** — syntax OK + require graph resolvable; no gold byte compare this run.
- **FAIL_CLOSED_BASELINE_MATCH** — optc refuses fast path → full uni; output equals baseline by construction.
- **DIFF_BUG** — silent wrong (must be 0).