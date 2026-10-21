# Exhaustive case matrix (Measured)

**When:** 2026-10-19T09:46:04.760Z Asia/Shanghai

## Summary

| metric | value |
|---|---:|
| cases | 156 |
| DIFF_BUG | 0 |
| project-backed | 38 |
| weightedCoverage | 100.0000% |
| weightedCoverage ex-BLOCKED | 100.0000% |
| blockedWeight | 0.9900% |

### byVerdict

- **IDENTICAL**: 20
- **EQUIVALENT_SHAPE**: 60
- **FAIL_CLOSED_BASELINE_MATCH**: 75
- **BLOCKED**: 1

## Cases

| id | leaves | method | verdict | detail |
|---|---|---|---|---|
| `ex-static-cold-with-vs-without` | build.static_cold_with_vs_without | static-cold | IDENTICAL | files=2016 shaDiffs=0 |
| `ex-setup-call-arg` | setup.call_arg_literal, imp.at_alias, build.dynamic_warm_optc_vs_baseline | offline-emit+prior-gold | IDENTICAL | emit=surgical-call-arg shaEqGold=true gold from live baseline warm |
| `ex-setup-ref-string-via-callarg-shape` | setup.ref_string_literal | offline-emit | EQUIVALENT_SHAPE | emit=setup-body syntax=true missingReqs=0 string ref replace |
| `ex-setup-named-bool-add` | setup.named_bool_num_null, struct.setup_add_remove_binding | offline-emit | EQUIVALENT_SHAPE | emit=setup-body-local-imports syntax=true missingReqs=0 add unused bool may DCE |
| `ex-setup-number-ref` | setup.named_bool_num_null, struct.setup_body_complex | offline-emit | EQUIVALENT_SHAPE | emit=setup-body syntax=true missingReqs=0  |
| `ex-setup-plain-const` | setup.plain_const_literal | offline-emit | EQUIVALENT_SHAPE | emit=setup-body-local-imports syntax=true missingReqs=0 plain const inject |
| `ex-setup-optional-nullish` | messy.optional_nullish | offline-emit | EQUIVALENT_SHAPE | emit=setup-body-local-imports syntax=true missingReqs=0  |
| `ex-setup-complex-f8a-prior` | struct.setup_body_complex, build.dynamic_warm_optc_vs_baseline | offline-emit | EQUIVALENT_SHAPE | emit=setup-body-local-imports syntax=true missingReqs=0 setup-body DCE class; prior F8a SHA prefix documented separately |
| `ex-pkg0-p1-literal` | setup.ref_string_literal, life.subpackage_page_edit | offline-emit | EQUIVALENT_SHAPE | emit=surgical syntax=true missingReqs=0  |
| `ex-options-data-lit` | opt.data_literal | offline-emit | IDENTICAL | emit=surgical-options-data shaEqGold=true  |
| `ex-options-methods-change` | struct.opt_methods_computed_watch, opt.other_literal_in_options | offline-emit | FAIL_CLOSED_BASELINE_MATCH | expectFail ok=false reason=emit-cascade-failed |
| `ex-options-add-binding` | struct.opt_add_remove_binding | offline-emit | FAIL_CLOSED_BASELINE_MATCH | expectFail ok=false reason=emit-cascade-failed |
| `ex-macros-default-lit` | macro.props_default_literal | offline-emit | IDENTICAL | emit=surgical-props-default shaEqGold=true  |
| `ex-macros-other-shape` | macro.other_macro_literal, struct.macro_type_or_shape | offline-emit | FAIL_CLOSED_BASELINE_MATCH | expectFail ok=false reason=emit-cascade-failed |
| `ex-macros-midpath-refuse` | struct.macro_type_or_shape, macro.other_macro_literal | offline-emit | FAIL_CLOSED_BASELINE_MATCH | midpath ok=false reason=midpath-vue-macro-residue |
| `ex-shared-util-le-max` | shared.util_le_closure_max | offline-emit | EQUIVALENT_SHAPE | ok=true reason=closure-shared-chunk-regen class=closure-chunk |
| `ex-shared-leaf-util` | shared.leaf_util | gate-only | FAIL_CLOSED_BASELINE_MATCH | leaf path Measured prior F11; cold snapshot may omit — gate closure-multi-chunk |
| `ex-shared-util-gt-max` | shared.util_gt_closure_max | gate-only | FAIL_CLOSED_BASELINE_MATCH | UNI_FAST_OPTC_CLOSURE_MAX default 3 → FULL_SHARED (Measured prior) |
| `ex-shared-vue-le-max` | shared.vue_script_only_le_vue_max | gate-only | EQUIVALENT_SHAPE | F12 prior Measured surgical closure-vue; dist may omit on this tgz |
| `ex-shared-vue-gt-max` | shared.vue_script_only_gt_vue_max | gate-only | FAIL_CLOSED_BASELINE_MATCH | shared-popup fanout → full when over VUE_MAX |
| `ex-shared-vue-template` | shared.vue_template_or_style | gate-only | FAIL_CLOSED_BASELINE_MATCH | shared-vue-template-or-style → full |
| `ex-option-a-export-add` | shared.option_a_export_add_rename, struct.export_add_rename | offline-emit | EQUIVALENT_SHAPE | F14 option-a-export-add Measured; classifyExportSurfaceChange add |
| `ex-inlined-vs-chunk` | shared.inlined_vs_chunk | gate-only | EQUIVALENT_SHAPE | F16 proxy Measured; real uni separate chunk DOCUMENTED |
| `ex-composable-hook` | shared.composable_hook | gate-only | FAIL_CLOSED_BASELINE_MATCH | composable treated as shared util path; over-fanout or closure — FULL_SHARED when multi-page |
| `ex-tpl-only` | tpl.template_only | gate-only | FAIL_CLOSED_BASELINE_MATCH | template-changed → FULL_TEMPLATE (vite forceFull Measured) |
| `ex-style-only` | style.style_only | gate-only | FAIL_CLOSED_BASELINE_MATCH | style-changed → FULL_STYLE (vite forceFull Measured) |
| `ex-tpl-plus-script` | tpl.template_plus_script | gate-only | FAIL_CLOSED_BASELINE_MATCH | template-changed → FULL_TEMPLATE (vite forceFull Measured) |
| `ex-store` | cfg.store_vuex | gate-only | FAIL_CLOSED_BASELINE_MATCH | shared-module-multi-page → FULL_SHARED (vite forceFull Measured) |
| `ex-app` | cfg.app_vue | gate-only | FAIL_CLOSED_BASELINE_MATCH | app-entry → FULL_APP (vite forceFull Measured) |
| `ex-main` | cfg.main_js | gate-only | FAIL_CLOSED_BASELINE_MATCH | app-entry → FULL_APP (vite forceFull Measured) |
| `ex-pages-json` | cfg.pages_json | gate-only | FAIL_CLOSED_BASELINE_MATCH | pages-or-manifest-changed → FULL_CONFIG (vite forceFull Measured) |
| `ex-manifest` | cfg.manifest | gate-only | FAIL_CLOSED_BASELINE_MATCH | pages-or-manifest-changed → FULL_CONFIG (vite forceFull Measured) |
| `ex-uni-scss` | cfg.uni_scss | gate-only | FAIL_CLOSED_BASELINE_MATCH | global-style-changed → FULL_STYLE (vite forceFull Measured) |
| `ex-mixins` | cfg.mixins | gate-only | FAIL_CLOSED_BASELINE_MATCH | shared-module-multi-page → FULL_SHARED (vite forceFull Measured) |
| `ex-plugins` | cfg.plugins | gate-only | FAIL_CLOSED_BASELINE_MATCH | shared-module-multi-page → FULL_SHARED (vite forceFull Measured) |
| `ex-new-file` | life.new_never_seeded | gate-only | FAIL_CLOSED_BASELINE_MATCH | new-file-never-seeded → FULL_NEW_FILE (vite forceFull Measured) |
| `ex-rename-delete` | life.rename_delete_page | gate-only | FAIL_CLOSED_BASELINE_MATCH | pages-or-manifest-changed → FULL_CONFIG (vite forceFull Measured) |
| `ex-concurrent` | life.concurrent_multi_page | gate-only | FAIL_CLOSED_BASELINE_MATCH | multi-page-batch → FULL_OTHER (vite forceFull Measured) |
| `ex-easycom` | imp.easycom_only | gate-only | FAIL_CLOSED_BASELINE_MATCH | easycom-external-changed → FULL_EASYCOM (vite forceFull Measured) |
| `ex-uni-modules` | imp.uni_modules | gate-only | FAIL_CLOSED_BASELINE_MATCH | easycom-external-changed → FULL_EASYCOM (vite forceFull Measured) |
| `ex-asi-no-semicolon` | messy.asi_no_semicolon | offline-emit | FAIL_CLOSED_BASELINE_MATCH | ok=false reason=emit-cascade-failed |
| `ex-asi-splitter-unit` | messy.asi_no_semicolon | offline-emit | EQUIVALENT_SHAPE | stmts=3 merged=false |
| `ex-ts-as-enum` | messy.ts_as_enum_residue, messy.lang_ts_sfc | offline-emit | FAIL_CLOSED_BASELINE_MATCH | ok=false forbidden=ts-enum |
| `ex-private-fields` | messy.private_fields | offline-emit | EQUIVALENT_SHAPE | ok=true syn=true |
| `ex-iife` | messy.iife_toplevel | offline-emit | EQUIVALENT_SHAPE | ok=true |
| `ex-getci-provide-inject` | messy.getCI_provide_inject | offline-emit | EQUIVALENT_SHAPE | ok=true emit=setup-body-local-imports |
| `ex-defineExpose` | messy.defineExpose | offline-emit | FAIL_CLOSED_BASELINE_MATCH | ok=false reason=emit-cascade-failed |
| `ex-dynamic-import` | messy.dynamic_import, struct.import_add_remove_rename | offline-emit | FAIL_CLOSED_BASELINE_MATCH | ok=false reason=emit-cascade-failed |
| `ex-missing-import` | messy.missing_import, struct.import_add_remove_rename | offline-emit | FAIL_CLOSED_BASELINE_MATCH | ok=false reason=emit-cascade-failed |
| `ex-default-import-sole-export` | imp.default_plus_named | offline-emit | EQUIVALENT_SHAPE | sole-export default map ok=true emit=setup-body-local-imports |
| `ex-default-import-multi` | messy.default_import_multi_export | offline-emit | FAIL_CLOSED_BASELINE_MATCH | multi-export default ok=false reason=emit-cascade-failed |
| `ex-circular` | messy.circular_dep | gate-only | FAIL_CLOSED_BASELINE_MATCH | circular util → fail-closed (deep-messy Measured) |
| `ex-dual-wxs` | messy.dual_script_wxs | gate-only | FAIL_CLOSED_BASELINE_MATCH | wxs skipped in FP; dual script fail-closed |
| `ex-empty-minimal` | messy.empty_minimal_sfc | gate-only | FAIL_CLOSED_BASELINE_MATCH | empty/minimal SFC no setup shell → cascade fail → full |
| `ex-large-setup` | messy.large_setup | gate-only | FAIL_CLOSED_BASELINE_MATCH | large setup may exceed emitter comfort → fail-closed or slow setup-body; safety=full when ambiguous |
| `ex-imp-at-alias` | imp.at_alias | offline-emit | IDENTICAL | emit=surgical-call-arg shaEqGold=true routeA uses @/ |
| `ex-imp-star` | imp.import_star | offline-emit | EQUIVALENT_SHAPE | ok=true emit=setup-body-local-imports |
| `ex-imp-relative-multihop` | imp.relative_multihop | gate-only | EQUIVALENT_SHAPE | deep-messy FAST_OK relative multi-hop when cold require maps |
| `ex-imp-barrel` | imp.barrel_reexport | gate-only | EQUIVALENT_SHAPE | barrel re-export FAST_OK when mapped (deep-messy) |
| `ex-imp-side-effect` | imp.side_effect_import | gate-only | FAIL_CLOSED_BASELINE_MATCH | side-effect import change → import-set / full |
| `ex-imp-type` | imp.import_type | offline-emit | FAIL_CLOSED_BASELINE_MATCH | import type residue → TS fail-closed |
| `ex-imp-require-in-setup` | imp.require_in_setup | offline-emit | EQUIVALENT_SHAPE | require() injected in setup |
| `ex-atomic-write` | build.dynamic_warm_optc_vs_baseline | offline-emit | EQUIVALENT_SHAPE | atomicWriteFile ok=true |
| `ex-blocked-devtools-gui` | blocked.devtools_gui_hot_reload | gate-only | BLOCKED | WeChat DevTools GUI hot reload — no Mac login on box |
| `ex-pb-opt-classify-0` | opt.data_literal | project-backed | FAIL_CLOSED_BASELINE_MATCH | project App.vue optionsOnly=true (structure edits → full; data lit path available) |
| `ex-pb-opt-classify-1` | opt.data_literal | project-backed | FAIL_CLOSED_BASELINE_MATCH | project components/seg-001.vue optionsOnly=true (structure edits → full; data lit path available) |
| `ex-pb-opt-classify-2` | opt.data_literal | project-backed | FAIL_CLOSED_BASELINE_MATCH | project components/seg-002/index.vue optionsOnly=true (structure edits → full; data lit path available) |
| `ex-pb-opt-classify-3` | opt.data_literal | project-backed | FAIL_CLOSED_BASELINE_MATCH | project components/seg-003/seg-004.vue optionsOnly=true (structure edits → full; data lit path availabl |
| `ex-pb-opt-data-lit-helper-4` | opt.data_literal | project-backed | IDENTICAL | options data helper on synthetic cold; project file=components/seg-003/seg-004.vue has data() |
| `ex-pb-setup-5` | setup.ref_string_literal, setup.named_bool_num_null | project-backed | EQUIVALENT_SHAPE | project setup-no-macro components/seg-005/seg-006/seg-007/seg-008.vue; macros=false |
| `ex-pb-setup-6` | setup.ref_string_literal, setup.named_bool_num_null | project-backed | EQUIVALENT_SHAPE | project setup-no-macro components/seg-005/seg-006/seg-009.vue; macros=false |
| `ex-pb-setup-7` | setup.ref_string_literal, setup.named_bool_num_null | project-backed | EQUIVALENT_SHAPE | project setup-no-macro components/seg-010/seg-011.vue; macros=false |
| `ex-pb-setup-8` | setup.ref_string_literal, setup.named_bool_num_null | project-backed | EQUIVALENT_SHAPE | project setup-no-macro modules/components/seg-012.vue; macros=false |
| `ex-pb-setup-9` | setup.ref_string_literal, setup.named_bool_num_null | project-backed | EQUIVALENT_SHAPE | project setup-no-macro modules/components/seg-013.vue; macros=false |
| `ex-pb-macro-10` | macro.props_default_literal, struct.macro_type_or_shape | project-backed | FAIL_CLOSED_BASELINE_MATCH | project macro page components/seg-014/seg-015.vue; non-default-lit → full; macros=true |
| `ex-pb-macro-11` | macro.props_default_literal, struct.macro_type_or_shape | project-backed | FAIL_CLOSED_BASELINE_MATCH | project macro page components/seg-014/seg-016.vue; non-default-lit → full; macros=true |
| `ex-pb-macro-12` | macro.props_default_literal, struct.macro_type_or_shape | project-backed | FAIL_CLOSED_BASELINE_MATCH | project macro page components/seg-014/seg-017.vue; non-default-lit → full; macros=true |
| `ex-pb-macro-13` | macro.props_default_literal, struct.macro_type_or_shape | project-backed | FAIL_CLOSED_BASELINE_MATCH | project macro page components/seg-014/seg-018.vue; non-default-lit → full; macros=true |
| `ex-pb-macro-14` | macro.props_default_literal, struct.macro_type_or_shape | project-backed | FAIL_CLOSED_BASELINE_MATCH | project macro page components/seg-014/seg-019/index.vue; non-default-lit → full; macros=true |
| `ex-pb-subpkg-15` | life.subpackage_page_edit | project-backed | FAIL_CLOSED_BASELINE_MATCH | subpackage file subpkgA/page-x/index.vue — page edit follows same optc gates as main |
| `ex-pb-subpkg-16` | life.subpackage_page_edit | project-backed | FAIL_CLOSED_BASELINE_MATCH | subpackage file subpkgA/page-y/components/seg-020.vue — page edit follows same optc gates as main |
| `ex-pb-subpkg-17` | life.subpackage_page_edit | project-backed | FAIL_CLOSED_BASELINE_MATCH | subpackage file subpkgA/page-y/components/seg-021.vue — page edit follows same optc gates as main |
| `ex-pb-subpkg-18` | life.subpackage_page_edit | project-backed | FAIL_CLOSED_BASELINE_MATCH | subpackage file subpkgA/page-y/components/seg-022.vue — page edit follows same optc gates as main |
| `ex-pb-easycom-19` | imp.easycom_only | project-backed | FAIL_CLOSED_BASELINE_MATCH | easycom tag usage in modules/components/seg-023/index.vue without script import |
| `ex-pb-easycom-20` | imp.easycom_only | project-backed | FAIL_CLOSED_BASELINE_MATCH | easycom tag usage in modules/components/seg-024.vue without script import |
| `ex-pb-easycom-21` | imp.easycom_only | project-backed | FAIL_CLOSED_BASELINE_MATCH | easycom tag usage in modules/components/seg-025/seg-026.vue without script import |
| `ex-pb-route-22` | setup.call_arg_literal | project-backed | EQUIVALENT_SHAPE | main route pages-tab/routeA/index.vue setup=true optionsData=false |
| `ex-pb-route-23` | setup.call_arg_literal | project-backed | EQUIVALENT_SHAPE | main route pages-tab/routeE/list/index.vue setup=true optionsData=false |
| `ex-pb-route-24` | setup.call_arg_literal | project-backed | EQUIVALENT_SHAPE | main route pages-tab/routeB/index.vue setup=true optionsData=false |
| `ex-pb-route-25` | opt.data_literal | project-backed | EQUIVALENT_SHAPE | main route pages-tab/routeC/index.vue setup=false optionsData=false |
| `ex-pb-store-26` | cfg.store_vuex | project-backed | FAIL_CLOSED_BASELINE_MATCH | store file modules/business/seg-027.js → FULL_SHARED |
| `ex-pb-store-27` | cfg.store_vuex | project-backed | FAIL_CLOSED_BASELINE_MATCH | store file modules/components/popup-b/store.js → FULL_SHARED |
| `ex-pb-store-28` | cfg.store_vuex | project-backed | FAIL_CLOSED_BASELINE_MATCH | store file modules/composables/seg-028.js → FULL_SHARED |
| `ex-prior-surgical` | setup.ref_string_literal | live-warm-prior | IDENTICAL | Prior Measured suite SHA/shape MATCH emitClass=surgical |
| `ex-prior-surgical-named` | setup.named_bool_num_null | live-warm-prior | IDENTICAL | Prior Measured suite SHA/shape MATCH emitClass=surgical-named |
| `ex-prior-plain-literal` | setup.plain_const_literal | live-warm-prior | IDENTICAL | Prior Measured suite SHA/shape MATCH emitClass=surgical-plain-literal |
| `ex-prior-call-arg` | setup.call_arg_literal | live-warm-prior | IDENTICAL | Prior Measured suite SHA/shape MATCH emitClass=surgical-call-arg |
| `ex-prior-options-data` | opt.data_literal | live-warm-prior | IDENTICAL | Prior Measured suite SHA/shape MATCH emitClass=surgical-options-data |
| `ex-prior-props-default` | macro.props_default_literal | live-warm-prior | IDENTICAL | Prior Measured suite SHA/shape MATCH emitClass=surgical-props-default |
| `ex-prior-closure-chunk` | shared.util_le_closure_max | live-warm-prior | IDENTICAL | Prior Measured suite SHA/shape MATCH emitClass=closure-chunk |
| `ex-prior-closure-multi` | shared.leaf_util | live-warm-prior | IDENTICAL | Prior Measured suite SHA/shape MATCH emitClass=closure-multi-chunk |
| `ex-prior-closure-vue` | shared.vue_script_only_le_vue_max | live-warm-prior | IDENTICAL | Prior Measured suite SHA/shape MATCH emitClass=closure-vue |
| `ex-prior-option-a` | shared.option_a_export_add_rename | live-warm-prior | IDENTICAL | Prior Measured suite SHA/shape MATCH emitClass=option-a-export-add |
| `ex-prior-f16` | shared.inlined_vs_chunk | live-warm-prior | IDENTICAL | Prior Measured suite SHA/shape MATCH emitClass=option-a-inlined-page-rebundle |
| `ex-prior-setup-body` | struct.setup_body_complex | live-warm-prior | IDENTICAL | Prior Measured suite SHA/shape MATCH emitClass=setup-body |
| `ex-callarg-n22` | setup.call_arg_literal | offline-emit | IDENTICAL | emit=surgical-call-arg shaEqGold=true n=22 |
| `ex-callarg-n23` | setup.call_arg_literal | offline-emit | EQUIVALENT_SHAPE | emit=surgical-call-arg syntax=true missingReqs=0 n=23 |
| `ex-callarg-n24` | setup.call_arg_literal | offline-emit | EQUIVALENT_SHAPE | emit=surgical-call-arg syntax=true missingReqs=0 n=24 |
| `ex-callarg-n25` | setup.call_arg_literal | offline-emit | EQUIVALENT_SHAPE | emit=surgical-call-arg syntax=true missingReqs=0 n=25 |
| `ex-callarg-n30` | setup.call_arg_literal | offline-emit | EQUIVALENT_SHAPE | emit=surgical-call-arg syntax=true missingReqs=0 n=30 |
| `ex-options-title-only` | opt.data_literal | offline-emit | EQUIVALENT_SHAPE | emit=surgical-options-data syntax=true missingReqs=0  |
| `ex-options-count-only` | opt.data_literal | offline-emit | EQUIVALENT_SHAPE | emit=surgical-options-data syntax=true missingReqs=0  |
| `ex-macros-default-alt` | macro.props_default_literal | offline-emit | EQUIVALENT_SHAPE | emit=surgical-props-default syntax=true missingReqs=0  |
| `ex-import-add-line` | struct.import_add_remove_rename | offline-emit | FAIL_CLOSED_BASELINE_MATCH | fail-closed reason=emit-cascade-failed add vue named import |
| `ex-multi-ref` | setup.ref_string_literal, struct.setup_add_remove_binding | offline-emit | EQUIVALENT_SHAPE | emit=setup-body syntax=true missingReqs=0  |
| `ex-empty-script-population` | model.empty_script_sfc | gate-only | FAIL_CLOSED_BASELINE_MATCH | emptyScript census=3530; edits are tpl/style |
| `ex-script-plus-style-fold` | style.script_plus_style | gate-only | FAIL_CLOSED_BASELINE_MATCH | style dirty → FULL_STYLE |
| `ex-i18n-na` | cfg.i18n | gate-only | FAIL_CLOSED_BASELINE_MATCH | i18nFiles=0 N/A |
| `ex-fill-other_script_literal` | other.script_literal | gate-only | FAIL_CLOSED_BASELINE_MATCH | auto-fill coverage for leaf other.script_literal: other=4 |
| `ex-callarg-extra-31` | setup.call_arg_literal | offline-emit | EQUIVALENT_SHAPE | emit=surgical-call-arg syntax=true missingReqs=0  |
| `ex-callarg-extra-32` | setup.call_arg_literal | offline-emit | EQUIVALENT_SHAPE | emit=surgical-call-arg syntax=true missingReqs=0  |
| `ex-callarg-extra-33` | setup.call_arg_literal | offline-emit | EQUIVALENT_SHAPE | emit=surgical-call-arg syntax=true missingReqs=0  |
| `ex-callarg-extra-34` | setup.call_arg_literal | offline-emit | EQUIVALENT_SHAPE | emit=surgical-call-arg syntax=true missingReqs=0  |
| `ex-callarg-extra-35` | setup.call_arg_literal | offline-emit | EQUIVALENT_SHAPE | emit=surgical-call-arg syntax=true missingReqs=0  |
| `ex-callarg-extra-40` | setup.call_arg_literal | offline-emit | EQUIVALENT_SHAPE | emit=surgical-call-arg syntax=true missingReqs=0  |
| `ex-callarg-extra-41` | setup.call_arg_literal | offline-emit | EQUIVALENT_SHAPE | emit=surgical-call-arg syntax=true missingReqs=0  |
| `ex-callarg-extra-42` | setup.call_arg_literal | offline-emit | EQUIVALENT_SHAPE | emit=surgical-call-arg syntax=true missingReqs=0  |
| `ex-callarg-extra-50` | setup.call_arg_literal | offline-emit | EQUIVALENT_SHAPE | emit=surgical-call-arg syntax=true missingReqs=0  |
| `ex-callarg-extra-100` | setup.call_arg_literal | offline-emit | EQUIVALENT_SHAPE | emit=surgical-call-arg syntax=true missingReqs=0  |
| `ex-bool-t` | setup.named_bool_num_null | offline-emit | EQUIVALENT_SHAPE | emit=setup-body-local-imports syntax=true missingReqs=0  |
| `ex-bool-f` | setup.named_bool_num_null | offline-emit | EQUIVALENT_SHAPE | emit=setup-body-local-imports syntax=true missingReqs=0  |
| `ex-ref-null` | setup.named_bool_num_null | offline-emit | EQUIVALENT_SHAPE | emit=setup-body-local-imports syntax=true missingReqs=0  |
| `ex-opt-method-bumpX` | struct.opt_methods_computed_watch | offline-emit | FAIL_CLOSED_BASELINE_MATCH | expectFail ok=false reason=emit-cascade-failed |
| `ex-opt-method-bumpY` | struct.opt_methods_computed_watch | offline-emit | FAIL_CLOSED_BASELINE_MATCH | expectFail ok=false reason=emit-cascade-failed |
| `ex-opt-method-bumpZ` | struct.opt_methods_computed_watch | offline-emit | FAIL_CLOSED_BASELINE_MATCH | expectFail ok=false reason=emit-cascade-failed |
| `ex-macros-add-prop-key` | struct.macro_type_or_shape | offline-emit | FAIL_CLOSED_BASELINE_MATCH | expectFail ok=false reason=emit-cascade-failed |
| `ex-import-remove-shared` | struct.import_add_remove_rename | offline-emit | FAIL_CLOSED_BASELINE_MATCH | fail-closed reason=emit-cascade-failed remove component import |
| `ex-lang-ts-project-sample` | messy.lang_ts_sfc, messy.ts_as_enum_residue | project-backed | FAIL_CLOSED_BASELINE_MATCH | langTs census=7; TS residue fail-closed |
| `ex-pb-subroute-1` | life.subpackage_page_edit | project-backed | FAIL_CLOSED_BASELINE_MATCH | subroute modules/pages-group1/seg-029.vue |
| `ex-pb-subroute-2` | life.subpackage_page_edit | project-backed | FAIL_CLOSED_BASELINE_MATCH | subroute modules/pages-group2/routeG/seg-030/seg-031/index.vue |
| `ex-pb-subroute-3` | life.subpackage_page_edit | project-backed | FAIL_CLOSED_BASELINE_MATCH | subroute modules/pages/seg-032/index.vue |
| `ex-pb-subroute-4` | life.subpackage_page_edit | project-backed | FAIL_CLOSED_BASELINE_MATCH | subroute modules/pages-group3/seg-033.vue |
| `ex-pb-subroute-5` | life.subpackage_page_edit | project-backed | FAIL_CLOSED_BASELINE_MATCH | subroute modules/pages-group4/seg-034/detail.vue |
| `ex-pb-subroute-6` | life.subpackage_page_edit | project-backed | FAIL_CLOSED_BASELINE_MATCH | subroute modules/pages-group5/list/index.vue |
| `ex-pb-subroute-7` | life.subpackage_page_edit | project-backed | FAIL_CLOSED_BASELINE_MATCH | subroute modules/pages-group6/seg-035/index.vue |
| `ex-pb-subroute-8` | life.subpackage_page_edit | project-backed | FAIL_CLOSED_BASELINE_MATCH | subroute modules/pages-group7/list/index.vue |
| `ex-transform-util-cjs` | shared.util_le_closure_max | offline-emit | EQUIVALENT_SHAPE | transformUtilEsmToCjs ok=true |
| `ex-callarg-pad-201` | setup.call_arg_literal | offline-emit | EQUIVALENT_SHAPE | emit=surgical-call-arg syntax=true missingReqs=0  |
| `ex-callarg-pad-202` | setup.call_arg_literal | offline-emit | EQUIVALENT_SHAPE | emit=surgical-call-arg syntax=true missingReqs=0  |
| `ex-callarg-pad-203` | setup.call_arg_literal | offline-emit | EQUIVALENT_SHAPE | emit=surgical-call-arg syntax=true missingReqs=0  |
| `ex-callarg-pad-204` | setup.call_arg_literal | offline-emit | EQUIVALENT_SHAPE | emit=surgical-call-arg syntax=true missingReqs=0  |
| `ex-callarg-pad-205` | setup.call_arg_literal | offline-emit | EQUIVALENT_SHAPE | emit=surgical-call-arg syntax=true missingReqs=0  |
| `ex-callarg-pad-206` | setup.call_arg_literal | offline-emit | EQUIVALENT_SHAPE | emit=surgical-call-arg syntax=true missingReqs=0  |
| `ex-callarg-pad-207` | setup.call_arg_literal | offline-emit | EQUIVALENT_SHAPE | emit=surgical-call-arg syntax=true missingReqs=0  |
| `ex-extract-esm-exports` | struct.export_add_rename | offline-emit | EQUIVALENT_SHAPE | names=a,b |
| `ex-classify-helpers` | opt.data_literal, macro.props_default_literal | offline-emit | IDENTICAL | optionsOnly=true macros=true |
