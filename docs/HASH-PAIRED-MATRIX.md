# Hash-paired matrix (Measured · Asia/Shanghai)

**Harness:** `verify/hash-paired-matrix.mjs` → `verify/hash-paired-matrix.json`
**When:** 2026-10-20T09:08:08.269Z
**Bar:** paired baselineSha256+optcSha256; honest excludes reuse/cold-dup/companion mis-map

## Coverage
| Metric | Value |
|--------|-------|
| hashWeightedCoverageMechanical | 100% |
| **hashWeightedCoverageHonest** (ex-BLOCKED) | **100%** |
| uncoveredWeightHonest | 0% |
| HASH_DIFF_BUG | **0** |
| reuse still counting | **0** |
| projectBackedStratifiedHash | 16 |

## Static cold
| equalCount | **2024** |
| diffCount | **0** |

## Dynamic by verdict
| Verdict | Count |
|---------|-------|
| IDENTICAL_HASH | 69 |
| FAIL_CLOSED_HASH_MATCH | 42 |
| HASH_DIFF_EXPECTED | 1 |
| BLOCKED | 1 |

## Cases (counting)
| ID | Verdict | Leaves | Outputs |
|----|---------|--------|---------|
| hash-static-cold-with-vs-without | IDENTICAL_HASH | build.static_cold_with_vs_without | *merkle*:EQ(07cea3da) |
| hash-tpl | FAIL_CLOSED_HASH_MATCH | tpl.template_only, tpl.slot_vfor_vif_complex | pages-tab/routeA/index.wxml:EQ(f26b2499); pages-tab/routeA/index.js:EQ(69baa029) |
| hash-style | FAIL_CLOSED_HASH_MATCH | style.style_only | pages-tab/routeA/index.wxss:EQ(98b1ae8c); pages-tab/routeA/index.js:EQ(69baa029) |
| hash-scss | FAIL_CLOSED_HASH_MATCH | style.style_only, style.scss_lang_deep, cfg.uni_scss | pages-tab/routeA/index.wxss:EQ(4e7e5718); pages-tab/routeA/index.js:EQ(69baa029) |
| hash-combo | FAIL_CLOSED_HASH_MATCH | tpl.template_plus_script | pages-tab/routeA/index.wxml:EQ(538d7918); pages-tab/routeA/index.js:EQ(8d3e25ff) |
| hash-opt-data | IDENTICAL_HASH | opt.data_literal | pkg-risk/options-lit.js:EQ(13075b53) |
| hash-opt-methods | FAIL_CLOSED_HASH_MATCH | opt.other_literal_in_options, struct.opt_methods_computed_watch, struct.opt_add_remove_binding | pkg-risk/options-lit.js:EQ(97020164) |
| hash-macro | IDENTICAL_HASH | macro.props_default_literal | pkg-risk/macros-props.js:EQ(674455b6) |
| hash-macro-emits | FAIL_CLOSED_HASH_MATCH | macro.other_macro_literal, struct.macro_type_or_shape, messy.defineExpose | pkg-risk/macros-props.js:EQ(d3a1b0a8) |
| hash-script1 | IDENTICAL_HASH | setup.ref_string_literal | pages-tab/routeA/index.js:EQ(76824488) |
| hash-callarg | IDENTICAL_HASH | setup.call_arg_literal | pages-tab/routeA/index.js:EQ(bb954f69) |
| hash-setupbody | IDENTICAL_HASH | setup.named_bool_num_null, struct.setup_body_complex | pages-tab/routeA/index.js:EQ(38cbe333) |
| hash-complex | IDENTICAL_HASH | struct.setup_body_complex, setup.plain_const_literal, messy.optional_nullish, messy.iife_toplevel, messy.large_setup | pages-tab/routeA/index.js:EQ(a0bfb44b) |
| hash-shared | IDENTICAL_HASH | shared.util_le_closure_max, shared.leaf_util, shared.composable_hook | modules/utils/unifast-probe.js:EQ(eab8221e) |
| hash-pkg | IDENTICAL_HASH | life.subpackage_page_edit, setup.ref_string_literal | pkg0/p1.js:EQ(6a0079d2) |
| hash-vue-script | IDENTICAL_HASH | shared.vue_script_only_le_vue_max | modules/components/mini-shared/index.js:EQ(6d04e127) |
| hash-vue-tpl | FAIL_CLOSED_HASH_MATCH | shared.vue_template_or_style | modules/components/mini-shared/index.wxml:EQ(9d7a9e16); modules/components/mini-shared/index.js:EQ(442ba33e) |
| hash-nonlit | FAIL_CLOSED_HASH_MATCH | struct.setup_add_remove_binding, messy.asi_no_semicolon, messy.empty_minimal_sfc | pages-tab/routeA/index.js:EQ(431fb687) |
| hash-pages | FAIL_CLOSED_HASH_MATCH | cfg.pages_json, cfg.manifest, life.new_never_seeded, life.rename_delete_page | app.json:EQ(c2b1f433) |
| hash-ifdef | FAIL_CLOSED_HASH_MATCH | build.ifdef_conditional_compile, struct.setup_lifecycle_hooks | pages-tab/routeA/index.js:EQ(7a508f0b) |
| hash-slot | FAIL_CLOSED_HASH_MATCH | tpl.slot_vfor_vif_complex, tpl.template_only | pages-tab/routeA/index.wxml:EQ(948c948e); pages-tab/routeA/index.js:EQ(9abf9f44) |
| hash-onload | FAIL_CLOSED_HASH_MATCH | life.page_onload_onshow_literal, struct.setup_lifecycle_hooks, life.form_submit_handler_literal | pages-tab/routeA/index.js:EQ(44765e4e) |
| hash-store | FAIL_CLOSED_HASH_MATCH | cfg.store_vuex, cfg.vuex_mapstate_edit, shared.mixin_options_merge | pages-tab/routeA/index.js:EQ(7ba4d08b) |
| hash-addimport | FAIL_CLOSED_HASH_MATCH | struct.import_add_remove_rename, struct.export_add_rename, shared.option_a_export_add_rename | pages-tab/routeA/index.js:EQ(c9e52521); modules/utils/unifast-probe.js:EQ(b2f6fa95) |
| hash-app | FAIL_CLOSED_HASH_MATCH | cfg.app_vue, cfg.main_js, cfg.plugins | app.js:EQ(35ce9932); app.json:EQ(75879d16) |
| hash-easycom | FAIL_CLOSED_HASH_MATCH | imp.easycom_only, shared.vue_template_or_style, messy.chart_canvas_map | modules/components/shared-popup/index.wxml:EQ(646e9540); modules/components/shared-popup/index.js:EQ(4d4d6743) |
| hash-concurrent | FAIL_CLOSED_HASH_MATCH | life.concurrent_multi_page, life.subpackage_page_edit | pkg0/p1.js:EQ(7f8ba995); pkg0/p2.js:EQ(17773b99) |
| hash-gap-ifdef | FAIL_CLOSED_HASH_MATCH | build.ifdef_conditional_compile, struct.setup_lifecycle_hooks | pages-tab/routeA/index.js:EQ(7a508f0b) |
| hash-gap-closure-over | FAIL_CLOSED_HASH_MATCH | shared.util_gt_closure_max | modules/utils/unifast-probe.js:EQ(eab8221e); pages-tab/routeA/index.js:EQ(69baa029) |
| hash-gap-vue-gt | FAIL_CLOSED_HASH_MATCH | shared.vue_script_only_gt_vue_max | modules/components/shared-popup/index.js:EQ(aaea503c) |
| hash-gap-messy-ts | FAIL_CLOSED_HASH_MATCH | messy.ts_as_enum_residue | pages-tab/routeA/index.js:EQ(4511c4e2) |
| hash-gap-messy-priv | IDENTICAL_HASH | messy.private_fields | pages-tab/routeA/index.js:EQ(8c6119a5) |
| hash-gap-messy-dyn | IDENTICAL_HASH | messy.dynamic_import | pages-tab/routeA/index.js:EQ(8c6119a5) |
| hash-gap-messy-circ | FAIL_CLOSED_HASH_MATCH | messy.circular_dep | modules/utils/unifast-circ-a.js:EQ(77f5eec3); modules/utils/unifast-circ-b.js:EQ(77f5eec3) |
| hash-gap-messy-missing | FAIL_CLOSED_HASH_MATCH | messy.missing_import, life.new_never_seeded | modules/utils/unifast-new-unseeded.js:EQ(77f5eec3); pages-tab/routeA/index.js:EQ(8c6119a5) |
| hash-gap-messy-defmulti | FAIL_CLOSED_HASH_MATCH | messy.default_import_multi_export | modules/utils/unifast-multi-export.js:EQ(77f5eec3); pages-tab/routeA/index.js:EQ(8c6119a5) |
| hash-gap-messy-langts | FAIL_CLOSED_HASH_MATCH | messy.lang_ts_sfc | pages-tab/routeA/index.js:EQ(4511c4e2) |
| hash-gap-messy-wxs | FAIL_CLOSED_HASH_MATCH | messy.dual_script_wxs | pages-tab/routeA/index.js:EQ(dc1a7329); pages-tab/routeA/index.wxml:EQ(a865201e) |
| hash-gap-messy-getci | IDENTICAL_HASH | messy.getCI_provide_inject | pages-tab/routeA/index.js:EQ(8c6119a5) |
| hash-gap-messy-side | FAIL_CLOSED_HASH_MATCH | imp.side_effect_import | pages-tab/routeA/index.js:EQ(b19202fd) |
| hash-gap-messy-imptype | FAIL_CLOSED_HASH_MATCH | imp.import_type | pages-tab/routeA/index.js:EQ(4511c4e2) |
| hash-gap-messy-uni | FAIL_CLOSED_HASH_MATCH | imp.uni_modules | pages-tab/routeA/index.js:EQ(82309c60); pages-tab/routeA/index.wxml:EQ(83d81e80) |
| hash-gap-messy-mixins | FAIL_CLOSED_HASH_MATCH | cfg.mixins, shared.mixin_options_merge | mixins/unifast-mixin.js:EQ(ec4dffc2); pkg-risk/options-lit.js:EQ(66283a80) |
| hash-gap-messy-other | FAIL_CLOSED_HASH_MATCH | other.script_literal | modules/utils/unifast-probe-helper.js:EQ(77f5eec3); pages-tab/routeA/index.js:EQ(8c6119a5) |
| hash-gap-messy-provide | FAIL_CLOSED_HASH_MATCH | messy.getCI_provide_inject | pages-tab/routeA/index.js:EQ(f1362b86) |
| hash-gap-script1 | IDENTICAL_HASH | setup.ref_string_literal, build.dynamic_warm_optc_vs_baseline | pages-tab/routeA/index.js:EQ(76824488) |
| hash-gap-setupbody | IDENTICAL_HASH | setup.named_bool_num_null, struct.setup_body_complex | pages-tab/routeA/index.js:EQ(38cbe333) |
| hash-gap-imp-star | IDENTICAL_HASH | imp.import_star | pages-tab/routeA/index.js:EQ(8c6119a5) |
| hash-gap-imp-rel | FAIL_CLOSED_HASH_MATCH | imp.relative_multihop | pages-tab/routeA/index.js:EQ(8c6119a5) |
| hash-gap-imp-barrel | FAIL_CLOSED_HASH_MATCH | imp.barrel_reexport | pages-tab/routeA/index.js:EQ(8c6119a5) |
| hash-gap-imp-defnamed | FAIL_CLOSED_HASH_MATCH | imp.default_plus_named | pages-tab/routeA/index.js:EQ(8c6119a5) |
| hash-gap-imp-require | FAIL_CLOSED_HASH_MATCH | imp.require_in_setup | pages-tab/routeA/index.js:EQ(e46ca248) |
| hash-gap-inlined-vs-chunk | FAIL_CLOSED_HASH_MATCH | shared.inlined_vs_chunk | modules/utils/unifast-probe.js:EQ(eab8221e) |
| hash-hist-fixture-script1 | IDENTICAL_HASH | setup.ref_string_literal, build.dynamic_warm_optc_vs_baseline | pages-tab/routeA/index.js:EQ(2819d949) |
| hash-hist-fixture-callarg | IDENTICAL_HASH | setup.call_arg_literal | pages-tab/routeA/index.js:EQ(bb954f69) |
| hash-hist-fixture-setupbody | IDENTICAL_HASH | struct.setup_body_complex, setup.named_bool_num_null | pages-tab/routeA/index.js:EQ(0dd2dfc3) |
| hash-hist-fixture-complex-f8a | IDENTICAL_HASH | struct.setup_body_complex | pages-tab/routeA/index.js:EQ(a0bfb44b) |
| hash-hist-fixture-localimport | IDENTICAL_HASH | setup.call_arg_literal, imp.at_alias | pages-tab/routeA/index.js:EQ(bb954f69) |
| hash-hist-project-script1 | IDENTICAL_HASH | setup.ref_string_literal, life.subpackage_page_edit | pages-tab/routeA/index.js:EQ(d20dacc5) |
| hash-hist-project-flaga-gold | IDENTICAL_HASH | setup.named_bool_num_null, setup.call_arg_literal | pages-tab/routeA/index.js:EQ(4ff68d48) |
| hash-hist-project-strat-script1 | IDENTICAL_HASH | setup.ref_string_literal | pages-tab/routeA/index.js:EQ(d20dacc5) |
| hash-hist-project-strat-namedBoolRouteA | IDENTICAL_HASH | setup.named_bool_num_null | pages-tab/routeA/index.js:EQ(4ff68d48) |
| hash-hist-project-strat-routeBNamedBool | IDENTICAL_HASH | setup.named_bool_num_null | pages-tab/routeB/index.js:EQ(0de89cf7) |
| hash-hist-project-strat-stepE | IDENTICAL_HASH | setup.named_bool_num_null | pages-tab/routeE/list/index.js:EQ(9d411edd) |
| hash-hist-project-strat-routeCToken | IDENTICAL_HASH | setup.ref_string_literal | pages-tab/routeC/index.js:EQ(53ddc006) |
| hash-hist-project-strat-meAlipayNull | IDENTICAL_HASH | setup.named_bool_num_null | pages-tab/routeD/index.js:EQ(4d95f375) |
| hash-hist-project-strat-popupVisible | IDENTICAL_HASH | setup.named_bool_num_null, shared.vue_script_only_le_vue_max | modules/components/shared-popup/index.js:EQ(7e45c72f) |
| hash-hist-project-strat-authShowFlow | IDENTICAL_HASH | setup.named_bool_num_null, life.subpackage_page_edit | modules/pages/seg-036/index.js:EQ(ef751e67) |
| hash-hist-project-strat-template | FAIL_CLOSED_HASH_MATCH | tpl.template_only | pages-tab/routeA/index.wxml:EQ(ad23caac); pages-tab/routeA/index.js:EQ(6a8dbfbb) |
| hash-hist-project-strat-style | FAIL_CLOSED_HASH_MATCH | style.style_only | pages-tab/routeA/index.wxss:EQ(fe65ec13); pages-tab/routeA/index.js:EQ(3c2b39ce) |
| hash-hist-project-strat-sharedStyle | FAIL_CLOSED_HASH_MATCH | style.scss_lang_deep, cfg.uni_scss | pages-tab/routeA/index.wxss:EQ(b8ba5d00); app.wxss:EQ(fa517a92) |
| hash-hist-project-strat-component | FAIL_CLOSED_HASH_MATCH | shared.vue_template_or_style, imp.easycom_only | modules/components/shared-popup/index.wxml:EQ(326ba91e); modules/components/shared-popup/index.js:EQ(3bfb716f) |
| hash-hist-project-strat-appTouch | FAIL_CLOSED_HASH_MATCH | cfg.app_vue | app.js:EQ(0ebacc44) |
| hash-live-log-routeA-call-arg | IDENTICAL_HASH | setup.call_arg_literal | pages-tab/routeA/index.js:EQ(bb954f69) |
| hash-live-log-options-data-lit | IDENTICAL_HASH | opt.data_literal | pkg-risk/options-lit.js:EQ(13075b53) |
| hash-live-log-macros-default-lit | IDENTICAL_HASH | macro.props_default_literal | pkg-risk/macros-props.js:EQ(674455b6) |
| hash-offline-options-data-vs-gold | IDENTICAL_HASH | opt.data_literal | pkg-risk/options-lit.js:EQ(13075b53) |
| hash-offline-macros-default-vs-gold | IDENTICAL_HASH | macro.props_default_literal | pkg-risk/macros-props.js:EQ(674455b6) |
| hash-extra-fixture-baseline-real-script1 | IDENTICAL_HASH | setup.ref_string_literal | pages-tab/routeA/index.js:EQ(2819d949) |
| hash-extra-fixture-f6-baseline-callarg-scriptLocalImport | IDENTICAL_HASH | setup.call_arg_literal | pages-tab/routeA/index.js:EQ(bb954f69) |
| hash-extra-fixture-f8a-baseline-complex-scriptComplexSetup | IDENTICAL_HASH | struct.setup_body_complex | pages-tab/routeA/index.js:EQ(a0bfb44b) |
| hash-extra-project-baseline-real-script1 | IDENTICAL_HASH | setup.ref_string_literal | pages-tab/routeA/index.js:EQ(d20dacc5) |
| hash-extra-fixture-baseline-local-import-scriptLocalImport | IDENTICAL_HASH | setup.call_arg_literal | pages-tab/routeA/index.js:EQ(bb954f69) |
| hash-anatomy-f8a-natural | IDENTICAL_HASH | struct.setup_body_complex | pages-tab/routeA/index.js:EQ(a0bfb44b) |
| hash-anatomy-f8a-midpath | IDENTICAL_HASH | struct.setup_body_complex | pages-tab/routeA/index.js:EQ(a0bfb44b) |

## Uncovered leaves (honest)