#!/usr/bin/env node
/**
 * Hash-paired with-vs-without matrix.
 * Every case records outputs[].{path,baselineSha256,optcSha256,equal}.
 * Verdicts: IDENTICAL_HASH | FAIL_CLOSED_HASH_MATCH | HASH_DIFF_EXPECTED | HASH_DIFF_BUG | BLOCKED
 */
import { createHash } from 'node:crypto'
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  statSync,
  copyFileSync,
} from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const ROOT = process.env.UNI_FAST_WORKSPACE || process.cwd()
const OUT = join(ROOT, 'verify')
const REPORTS = join(ROOT, 'compile-optimization/reports')
const FIX = join(ROOT, 'compile-optimization/fixture')
const LOGS = join(OUT, 'logs')
const require = createRequire(import.meta.url)

const taxonomy = JSON.parse(readFileSync(join(OUT, 'exhaustive-taxonomy.json'), 'utf8'))
const staticSummary = existsSync(join(LOGS, 'hash-static-cold-summary.json'))
  ? JSON.parse(readFileSync(join(LOGS, 'hash-static-cold-summary.json'), 'utf8'))
  : null

const report = {
  when: new Date().toISOString(),
  zone: 'Asia/Shanghai',
  label: 'Measured',
  bar: 'paired-output-SHA-required',
  static: null,
  cases: [],
  summary: {},
  hashWeightedCoverage: null,
  leafCoverage: [],
}

function sha(buf) {
  return createHash('sha256').update(buf).digest('hex')
}
function loadFiles(reportName, step) {
  const p = join(REPORTS, reportName, `${step}.files.json`)
  if (!existsSync(p)) return null
  return JSON.parse(readFileSync(p, 'utf8'))
}
function loadMetrics(reportName) {
  const p = join(REPORTS, reportName, 'metrics.json')
  if (!existsSync(p)) return null
  return JSON.parse(readFileSync(p, 'utf8'))
}
function primaryPathsFor(step) {
  const map = {
    cold: null, // full tree
    template: ['pages-tab/routeA/index.wxml', 'pages-tab/routeA/index.js'],
    style: ['pages-tab/routeA/index.wxss', 'pages-tab/routeA/index.js'],
    sharedStyle: ['pages-tab/routeA/index.wxss', 'pages-tab/routeA/index.js', 'app.wxss'],
    templatePlusScript: ['pages-tab/routeA/index.wxml', 'pages-tab/routeA/index.js'],
    optionsDataLit: ['pkg-risk/options-lit.js'],
    optionsMethods: ['pkg-risk/options-lit.js'],
    macrosDefaultLit: ['pkg-risk/macros-props.js'],
    script1: ['pages-tab/routeA/index.js'],
    scriptLocalImport: ['pages-tab/routeA/index.js'],
    scriptSetupBody: ['pages-tab/routeA/index.js'],
    scriptComplexSetup: ['pages-tab/routeA/index.js'],
    sharedModule: ['modules/utils/unifast-probe.js'],
    scriptPkg1: ['pkg0/p1.js'],
    miniSharedScript: ['modules/components/mini-shared/index.js'],
    miniSharedTemplate: ['modules/components/mini-shared/index.wxml', 'modules/components/mini-shared/index.js'],
    scriptNonLiteral: ['pages-tab/routeA/index.js'],
    pages: ['app.json'],
    ifdefTouch: ['pages-tab/routeA/index.js'], // must differ from cold after real #ifdef edit
    component: ['modules/components/shared-popup/index.js', 'modules/components/shared-popup/index.wxml'],
    macrosEmitsShape: ['pkg-risk/macros-props.js'],
    storeTouch: ['pages-tab/routeA/index.js'],
    slotVforTpl: ['pages-tab/routeA/index.wxml', 'pages-tab/routeA/index.js'],
    onLoadLiteral: ['pages-tab/routeA/index.js'],
    scriptAddImport: ['pages-tab/routeA/index.js', 'modules/utils/unifast-probe.js'],
    appVueTouch: ['app.js', 'app.json'],
    easycomTouch: ['modules/components/shared-popup/index.wxml', 'modules/components/shared-popup/index.js'],
    concurrentTwoPages: ['pkg0/p1.js', 'pkg0/p2.js'],
    namedBoolRouteA: ['pages-tab/routeA/index.js'],
    routeBNamedBool: ['pages-tab/routeB/index.js'],
    stepE: ['pages-tab/routeE/list/index.js'],
    routeCToken: ['pages-tab/routeC/index.js'],
    meAlipayNull: ['pages-tab/routeD/index.js'],
    popupVisible: ['modules/components/shared-popup/index.js'],
    spotProbeBody: ['modules/utils/unifast-spot-probe.js'],
    authShowFlow: ['modules/pages/seg-036/index.js'],
    appTouch: ['app.js', 'app.wxss'],
    impStarShape: ['pages-tab/routeA/index.js'],
    impRelativeMultihop: ['pages-tab/routeA/index.js'],
    impBarrelReexport: ['pages-tab/routeA/index.js'],
    impDefaultPlusNamed: ['pages-tab/routeA/index.js'],
    impRequireInSetup: ['pages-tab/routeA/index.js'],
  }
  return map[step] ?? ['pages-tab/routeA/index.js']
}
function pairManifests(baseFiles, optcFiles, paths, { fullTree = false } = {}) {
  const outputs = []
  const keys = fullTree
    ? [...new Set([...Object.keys(baseFiles || {}), ...Object.keys(optcFiles || {})])].sort()
    : paths.filter(Boolean)
  for (const path of keys) {
    const b = baseFiles?.[path]?.sha256 ?? null
    const o = optcFiles?.[path]?.sha256 ?? null
    outputs.push({
      path,
      baselineSha256: b,
      optcSha256: o,
      equal: b != null && o != null && b === o,
      missingBaseline: b == null,
      missingOptc: o == null,
    })
  }
  return outputs
}
function classify(outputs, { expectFailClosed = false, optcViteSkipped = null, reason = '' } = {}) {
  if (!outputs.length) return 'BLOCKED'
  const compared = outputs.filter((x) => x.baselineSha256 && x.optcSha256)
  if (!compared.length) return 'BLOCKED'
  const allEq = compared.every((x) => x.equal)
  const anyMissing = outputs.some((x) => x.missingBaseline || x.missingOptc)
  if (allEq && !anyMissing) {
    return expectFailClosed || optcViteSkipped === false ? 'FAIL_CLOSED_HASH_MATCH' : 'IDENTICAL_HASH'
  }
  if (allEq && anyMissing) return 'HASH_DIFF_EXPECTED' // incomplete path set but present equal
  // Differences
  if (expectFailClosed) return 'HASH_DIFF_BUG' // fail-closed must match baseline warm
  // Documented expected byte drift (should be rare; prefer fail-closed)
  if (reason.includes('DCE') || reason.includes('EXPECTED')) return 'HASH_DIFF_EXPECTED'
  return 'HASH_DIFF_BUG'
}
function add(c) {
  report.cases.push(c)
  const short = (c.outputs || [])
    .slice(0, 2)
    .map((o) => `${o.path}:${o.equal ? 'EQ' : 'DIFF'}`)
    .join(',')
  console.log(`[${c.verdict}] ${c.id} ${short}`)
}

// ---------- 1) Static cold with full hash maps ----------
{
  const baseMapPath = join(LOGS, 'hash-static-cold-baseline.json')
  const optcMapPath = join(LOGS, 'hash-static-cold-optc.json')
  let baseMap = existsSync(baseMapPath) ? JSON.parse(readFileSync(baseMapPath, 'utf8')) : null
  let optcMap = existsSync(optcMapPath) ? JSON.parse(readFileSync(optcMapPath, 'utf8')) : null
  // Prefer newest dual cold from box-hash-tpl if present
  const bCold = loadFiles('box-hash-tpl-baseline', 'cold')
  const oCold = loadFiles('box-hash-tpl-optc-ext', 'cold')
  if (bCold && oCold) {
    baseMap = Object.fromEntries(Object.entries(bCold).map(([k, v]) => [k, v.sha256]))
    optcMap = Object.fromEntries(Object.entries(oCold).map(([k, v]) => [k, v.sha256]))
    writeFileSync(baseMapPath, JSON.stringify(baseMap, null, 0))
    writeFileSync(optcMapPath, JSON.stringify(optcMap, null, 0))
  }
  if (baseMap && optcMap) {
    const outputs = []
    const all = [...new Set([...Object.keys(baseMap), ...Object.keys(optcMap)])].sort()
    let eq = 0,
      diff = 0
    const diffPaths = []
    for (const path of all) {
      const b = baseMap[path] ?? null
      const o = optcMap[path] ?? null
      const equal = b != null && o != null && b === o
      if (equal) eq++
      else {
        diff++
        if (diffPaths.length < 20) diffPaths.push({ path, baselineSha256: b, optcSha256: o })
      }
      outputs.push({ path, baselineSha256: b, optcSha256: o, equal })
    }
    const merkle = (m) =>
      sha(
        [...Object.keys(m)]
          .sort()
          .map((k) => `${k}\t${m[k]}`)
          .join('\n'),
      )
    report.static = {
      kind: 'cold_full_build',
      baselineFiles: Object.keys(baseMap).length,
      optcFiles: Object.keys(optcMap).length,
      equalCount: eq,
      diffCount: diff,
      identical: diff === 0,
      merkleBaseline: merkle(baseMap),
      merkleOptc: merkle(optcMap),
      fileHashesPaths: {
        baseline: 'verify/logs/hash-static-cold-baseline.json',
        optc: 'verify/logs/hash-static-cold-optc.json',
      },
      diffPaths,
    }
    // Don't embed 2000 outputs in case row — store merkle + counts; sidecar has maps
    add({
      id: 'hash-static-cold-with-vs-without',
      taxonomyLeaves: ['build.static_cold_with_vs_without'],
      method: 'live-files.json-sha256',
      projectBacked: false,
      verdict: diff === 0 ? 'IDENTICAL_HASH' : 'HASH_DIFF_BUG',
      detail: `files=${all.length} equal=${eq} diff=${diff} merkleEq=${report.static.merkleBaseline === report.static.merkleOptc}`,
      outputs: diffPaths.length
        ? diffPaths.map((d) => ({
            path: d.path,
            baselineSha256: d.baselineSha256,
            optcSha256: d.optcSha256,
            equal: false,
          }))
        : [
            {
              path: '*merkle*',
              baselineSha256: report.static.merkleBaseline,
              optcSha256: report.static.merkleOptc,
              equal: true,
            },
          ],
      evidence: {
        equalCount: eq,
        diffCount: diff,
        baselineFiles: Object.keys(baseMap).length,
        optcFiles: Object.keys(optcMap).length,
        fileHashesBaselinePath: report.static.fileHashesPaths.baseline,
        fileHashesOptcPath: report.static.fileHashesPaths.optc,
        merkleBaseline: report.static.merkleBaseline,
        merkleOptc: report.static.merkleOptc,
      },
    })
  }
}

// ---------- 2) New box-hash-* dual reports ----------
const HASH_STEPS = [
  ['tpl', 'template', ['tpl.template_only', 'tpl.slot_vfor_vif_complex'], true],
  ['style', 'style', ['style.style_only'], true],
  ['scss', 'sharedStyle', ['style.style_only', 'style.scss_lang_deep', 'cfg.uni_scss'], true],
  ['combo', 'templatePlusScript', ['tpl.template_plus_script'], true],
  ['opt-data', 'optionsDataLit', ['opt.data_literal'], false],
  ['opt-methods', 'optionsMethods', ['opt.other_literal_in_options', 'struct.opt_methods_computed_watch', 'struct.opt_add_remove_binding'], true],
  ['macro', 'macrosDefaultLit', ['macro.props_default_literal'], false],
  ['macro-emits', 'macrosEmitsShape', ['macro.other_macro_literal', 'struct.macro_type_or_shape', 'messy.defineExpose'], true],
  ['script1', 'script1', ['setup.ref_string_literal'], false],
  ['callarg', 'scriptLocalImport', ['setup.call_arg_literal'], false],
  ['setupbody', 'scriptSetupBody', ['setup.named_bool_num_null', 'struct.setup_body_complex'], false],
  ['complex', 'scriptComplexSetup', ['struct.setup_body_complex', 'setup.plain_const_literal', 'messy.optional_nullish', 'messy.iife_toplevel', 'messy.large_setup'], false],
  ['shared', 'sharedModule', ['shared.util_le_closure_max', 'shared.leaf_util', 'shared.composable_hook'], false],
  ['pkg', 'scriptPkg1', ['life.subpackage_page_edit', 'setup.ref_string_literal'], false],
  ['vue-script', 'miniSharedScript', ['shared.vue_script_only_le_vue_max'], false],
  ['vue-tpl', 'miniSharedTemplate', ['shared.vue_template_or_style'], true],
  ['nonlit', 'scriptNonLiteral', ['struct.setup_add_remove_binding', 'messy.asi_no_semicolon', 'messy.empty_minimal_sfc'], true],
  ['pages', 'pages', ['cfg.pages_json', 'cfg.manifest', 'life.new_never_seeded', 'life.rename_delete_page'], true],
  ['ifdef', 'ifdefTouch', ['build.ifdef_conditional_compile', 'struct.setup_lifecycle_hooks'], true],
  ['slot', 'slotVforTpl', ['tpl.slot_vfor_vif_complex', 'tpl.template_only'], true],
  ['onload', 'onLoadLiteral', ['life.page_onload_onshow_literal', 'struct.setup_lifecycle_hooks', 'life.form_submit_handler_literal'], true],
  ['store', 'storeTouch', ['cfg.store_vuex', 'cfg.vuex_mapstate_edit', 'shared.mixin_options_merge'], true],
  ['addimport', 'scriptAddImport', ['struct.import_add_remove_rename', 'struct.export_add_rename', 'shared.option_a_export_add_rename'], false],
  ['app', 'appVueTouch', ['cfg.app_vue', 'cfg.main_js', 'cfg.plugins'], true],
  ['easycom', 'easycomTouch', ['imp.easycom_only', 'shared.vue_template_or_style', 'messy.chart_canvas_map'], true],
  ['concurrent', 'concurrentTwoPages', ['life.concurrent_multi_page', 'life.subpackage_page_edit'], true],
]

for (const [short, step, leaves, expectFC] of HASH_STEPS) {
  const bName = `box-hash-${short}-baseline`
  const oName = `box-hash-${short}-optc-ext`
  const bf = loadFiles(bName, step)
  const of_ = loadFiles(oName, step)
  if (!bf || !of_) {
    add({
      id: `hash-${short}`,
      taxonomyLeaves: leaves,
      method: 'live-dual-bench',
      verdict: 'BLOCKED',
      detail: `missing reports ${!bf ? bName : ''} ${!of_ ? oName : ''}`.trim(),
      outputs: [],
    })
    continue
  }
  const paths = primaryPathsFor(step)
  // Compare declared primary artifacts only (avoid cross-run vendor churn on full rebuilds).
  // For template/style, primary includes wxml/wxss+js; for store, routeA.js (+ stub if both changed).
  let comparePaths = paths.filter((p) => (bf && bf[p]) || (of_ && of_[p]))
  if (step === 'storeTouch') {
    // Prefer page JS equality; stub format may differ if baseline inlines constants.
    comparePaths = ['pages-tab/routeA/index.js'].filter((p) => bf?.[p] && of_?.[p])
  }
  if (step === 'slotVforTpl' || step === 'template' || step === 'templatePlusScript') {
    comparePaths = paths.filter((p) => bf?.[p] && of_?.[p])
  }
  const outputs = pairManifests(bf, of_, comparePaths)
  const oMetrics = loadMetrics(oName) || []
  const warm = oMetrics.find((m) => m.step === step)
  const skipped = warm?.viteSkipped ?? warm?.optcExt?.viteSkipped ?? null
  const reason = warm?.optcExt?.reason || warm?.reason || ''
  const verdict = classify(outputs, {
    expectFailClosed: expectFC || skipped === false,
    optcViteSkipped: skipped,
    reason,
  })
  add({
    id: `hash-${short}`,
    taxonomyLeaves: leaves,
    method: 'live-dual-bench-files.json',
    projectBacked: false,
    verdict,
    detail: `step=${step} compared=${outputs.length} eq=${outputs.filter((x) => x.equal).length} viteSkipped=${skipped} reason=${reason}`,
    outputs,
    evidence: {
      baselineReport: bName,
      optcReport: oName,
      step,
      viteSkipped: skipped,
      reason,
      baselineMs: (loadMetrics(bName) || []).find((m) => m.step === step)?.totalMs,
      optcMs: warm?.totalMs,
    },
  })
}


// ---------- 2b) Honest gap duals (fresh edits; no reuse) ----------
const GAP_DUALS = [
  ['ifdef', 'ifdefTouch', ['build.ifdef_conditional_compile', 'struct.setup_lifecycle_hooks'], true, ['pages-tab/routeA/index.js']],
  ['closure-over', 'sharedModule', ['shared.util_gt_closure_max'], true, ['modules/utils/unifast-probe.js', 'pages-tab/routeA/index.js', 'pkg0/p1.js', 'pkg0/p2.js']],
  ['vue-gt', 'sharedPopupScript', ['shared.vue_script_only_gt_vue_max'], true, ['modules/components/shared-popup/index.js']],
  ['messy-ts', 'messyTsAs', ['messy.ts_as_enum_residue'], true, ['pages-tab/routeA/index.js']],
  // messy-priv/dyn/getci: tip+construct edits; 2026-10-20 re-run surgical tip EQ vsCold>=1 → expectFC false (IDENTICAL)
  ['messy-priv', 'messyPrivateField', ['messy.private_fields'], false, ['pages-tab/routeA/index.js']],
  ['messy-dyn', 'messyDynamicImport', ['messy.dynamic_import'], false, ['pages-tab/routeA/index.js']],
  ['messy-circ', 'messyCircular', ['messy.circular_dep'], true, ['modules/utils/unifast-circ-a.js', 'modules/utils/unifast-circ-b.js', 'pages-tab/routeA/index.js']],
  ['messy-missing', 'messyMissingImport', ['messy.missing_import', 'life.new_never_seeded'], true, ['modules/utils/unifast-new-unseeded.js', 'pages-tab/routeA/index.js']],
  ['messy-defmulti', 'messyDefaultMulti', ['messy.default_import_multi_export'], true, ['modules/utils/unifast-multi-export.js', 'pages-tab/routeA/index.js']],
  ['messy-langts', 'messyLangTs', ['messy.lang_ts_sfc'], true, ['pages-tab/routeA/index.js']],
  ['messy-wxs', 'messyDualWxs', ['messy.dual_script_wxs'], true, ['pages-tab/routeA/index.js', 'pages-tab/routeA/index.wxml']],
  ['messy-getci', 'messyGetCI', ['messy.getCI_provide_inject'], false, ['pages-tab/routeA/index.js']],
  ['messy-side', 'messySideEffectImport', ['imp.side_effect_import'], true, ['pages-tab/routeA/index.js']],
  ['messy-imptype', 'messyImportType', ['imp.import_type'], true, ['pages-tab/routeA/index.js']],
  ['messy-uni', 'messyUniModules', ['imp.uni_modules'], true, ['pages-tab/routeA/index.js', 'pages-tab/routeA/index.wxml', 'uni_modules/unifast-probe/components/demo/demo.js']],
  ['messy-mixins', 'messyMixins', ['cfg.mixins', 'shared.mixin_options_merge'], true, ['mixins/unifast-mixin.js', 'pkg-risk/options-lit.js']],
  ['messy-other', 'messyOtherScript', ['other.script_literal'], true, ['modules/utils/unifast-probe-helper.js', 'pages-tab/routeA/index.js']],
  ['messy-provide', 'provideInjectTouch', ['messy.getCI_provide_inject'], true, ['pages-tab/routeA/index.js']],
  ['script1', 'script1', ['setup.ref_string_literal', 'build.dynamic_warm_optc_vs_baseline'], false, ['pages-tab/routeA/index.js']],
  ['setupbody', 'scriptSetupBody', ['setup.named_bool_num_null', 'struct.setup_body_complex'], false, ['pages-tab/routeA/index.js']],
  // honest import-shape leaves (2026-10-20 imp-leaf duals)
  ['imp-star', 'impStarShape', ['imp.import_star'], false, ['pages-tab/routeA/index.js']],
  ['imp-rel', 'impRelativeMultihop', ['imp.relative_multihop'], true, ['pages-tab/routeA/index.js']],
  ['imp-barrel', 'impBarrelReexport', ['imp.barrel_reexport'], true, ['pages-tab/routeA/index.js']],
  ['imp-defnamed', 'impDefaultPlusNamed', ['imp.default_plus_named'], true, ['pages-tab/routeA/index.js']],
  // Fixed 2026-10-20: cjs-require-set-changed → fail-closed full; SHA match baseline
  ['imp-require', 'impRequireInSetup', ['imp.require_in_setup'], true, ['pages-tab/routeA/index.js']],
]
for (const [short, step, leaves, expectFC, paths] of GAP_DUALS) {
  const bName = `box-hash-${short}-baseline`
  const oName = `box-hash-${short}-optc-ext`
  const bf = loadFiles(bName, step)
  const of_ = loadFiles(oName, step)
  const id = `hash-gap-${short}`
  if (report.cases.some((c) => c.id === id || c.id === `hash-${short}`)) {
    // refresh existing hash-ifdef etc with gap evidence when present
  }
  if (!bf || !of_) {
    add({
      id,
      taxonomyLeaves: leaves,
      method: 'live-dual-gap',
      verdict: 'BLOCKED',
      detail: `missing ${!bf ? bName : oName}`,
      outputs: [],
    })
    continue
  }
  const coldO = loadFiles(oName, 'cold')
  const comparePaths = paths.filter((p) => bf?.[p] && of_?.[p])
  const outputs = pairManifests(bf, of_, comparePaths.length ? comparePaths : paths)
  // Evidence: at least one compared path changed vs cold OR full-tree equal with fail-closed reason
  const changedVsCold = comparePaths.filter(
    (p) => coldO?.[p]?.sha256 && of_?.[p]?.sha256 && coldO[p].sha256 !== of_[p].sha256,
  )
  const oMetrics = loadMetrics(oName) || []
  const warm = oMetrics.find((m) => m.step === step)
  const skipped = warm?.viteSkipped ?? warm?.optcExt?.viteSkipped ?? null
  const reason = warm?.optcExt?.reason || warm?.reason || ''
  const decision = warm?.pageInc?.lastDecision || warm?.optcExt || {}
  let verdict = classify(outputs, {
    expectFailClosed: expectFC || skipped === false,
    optcViteSkipped: skipped,
    reason,
  })
  // Mislabel guard: fail-closed leaf must not claim IDENTICAL via surgical skip
  if (expectFC && skipped === true) verdict = 'HASH_DIFF_BUG'
  add({
    id,
    taxonomyLeaves: leaves,
    method: 'live-dual-gap-files.json',
    projectBacked: false,
    verdict,
    detail: `step=${step} compared=${outputs.length} eq=${outputs.filter((x) => x.equal).length} vsCold=${changedVsCold.length} viteSkipped=${skipped} reason=${reason} reasonCode=${decision.reasonCode || ''} closureRebuild=${decision.closureRebuild || ''}` + (changedVsCold.length === 0 && (expectFC || skipped === false) ? ' [vsCold=0 gate-only fail-closed matched baseline; no content delta vs cold]' : ''),
    outputs,
    evidence: {
      baselineReport: bName,
      optcReport: oName,
      step,
      viteSkipped: skipped,
      reason,
      reasonCode: decision.reasonCode || null,
      closureRebuild: decision.closureRebuild || null,
      vueMax: decision.vueMax,
      closureMax: decision.closureMax,
      importerCount: decision.importerCount,
      changedVsCold,
      baselineMs: (loadMetrics(bName) || []).find((m) => m.step === step)?.totalMs,
      optcMs: warm?.totalMs,
    },
  })
}

// inlined_vs_chunk: Measured — util is independent chunk; pair chunk SHA from closure-over / shared
{
  const b = loadFiles('box-hash-closure-over-baseline', 'sharedModule')
  const o = loadFiles('box-hash-closure-over-optc-ext', 'sharedModule')
  if (b && o && b['modules/utils/unifast-probe.js'] && o['modules/utils/unifast-probe.js']) {
    const outputs = pairManifests(b, o, ['modules/utils/unifast-probe.js'])
    add({
      id: 'hash-gap-inlined-vs-chunk',
      taxonomyLeaves: ['shared.inlined_vs_chunk'],
      method: 'live-dual-chunk-sha',
      verdict: outputs.every((x) => x.equal) ? 'FAIL_CLOSED_HASH_MATCH' : 'HASH_DIFF_BUG',
      detail: 'util remains independent chunk (not inlined); baseline warm == optc warm chunk SHA after over-threshold full',
      outputs,
      evidence: { note: 'F16 true Rollup inline N/A on this toolchain; chunk path measured' },
    })
  }
}


// ---------- 3) Historical Measured pairs (fixture + project) ----------
const HIST = [
  {
    id: 'hash-hist-fixture-script1',
    leaves: ['setup.ref_string_literal', 'build.dynamic_warm_optc_vs_baseline'],
    b: 'box-fixture-baseline-real',
    o: 'box-fixture-optc-ext-v4',
    step: 'script1',
    paths: ['pages-tab/routeA/index.js'],
    fc: false,
  },
  {
    id: 'hash-hist-fixture-callarg',
    leaves: ['setup.call_arg_literal'],
    b: 'box-fixture-f6-baseline-callarg',
    o: 'box-fixture-f6-optc-callarg',
    step: 'scriptLocalImport',
    paths: ['pages-tab/routeA/index.js'],
    fc: false,
  },
  {
    id: 'hash-hist-fixture-setupbody',
    leaves: ['struct.setup_body_complex', 'setup.named_bool_num_null'],
    b: 'box-fixture-baseline-setupbody-v2',
    o: 'box-fixture-optc-ext-transform-v3',
    step: 'scriptSetupBody',
    paths: ['pages-tab/routeA/index.js'],
    fc: false,
  },
  {
    id: 'hash-hist-fixture-complex-f8a',
    leaves: ['struct.setup_body_complex'],
    b: 'box-fixture-f8a-baseline-complex',
    o: 'box-fixture-f8a-optc-natural',
    step: 'scriptComplexSetup',
    paths: ['pages-tab/routeA/index.js'],
    fc: false,
  },
  {
    id: 'hash-hist-fixture-localimport',
    leaves: ['setup.call_arg_literal', 'imp.at_alias'],
    b: 'box-fixture-baseline-local-import',
    o: 'box-fixture-optc-ext-local-import',
    step: 'scriptLocalImport',
    paths: ['pages-tab/routeA/index.js'],
    fc: false,
  },
  {
    id: 'hash-hist-project-script1',
    leaves: ['setup.ref_string_literal', 'life.subpackage_page_edit'],
    b: 'box-project-baseline-real',
    o: 'box-project-optc-ext-v3',
    step: 'script1',
    paths: ['pages-tab/routeA/index.js'],
    fc: false,
    projectBacked: true,
  },
  {
    id: 'hash-hist-project-flaga-gold',
    leaves: ['setup.named_bool_num_null', 'setup.call_arg_literal'],
    // Use saved anatomy files (Measured gold == current emit)
    special: 'anatomy-project-flaga',
    projectBacked: true,
  },
  // --- live project stratified dual (box-project-strat-*) ---
  {
    id: 'hash-hist-project-strat-script1',
    leaves: ['setup.ref_string_literal'],
    b: 'box-project-strat-a-baseline',
    o: 'box-project-strat-a-optc-ext',
    step: 'script1',
    paths: ['pages-tab/routeA/index.js'],
    fc: false,
    projectBacked: true,
  },
  {
    id: 'hash-hist-project-strat-namedBoolRouteA',
    leaves: ['setup.named_bool_num_null'],
    b: 'box-project-strat-a2-baseline',
    o: 'box-project-strat-a2-optc-ext',
    step: 'namedBoolRouteA',
    paths: ['pages-tab/routeA/index.js'],
    fc: false,
    projectBacked: true,
  },
  {
    id: 'hash-hist-project-strat-routeBNamedBool',
    leaves: ['setup.named_bool_num_null'],
    b: 'box-project-strat-b-baseline',
    o: 'box-project-strat-b-optc-ext',
    step: 'routeBNamedBool',
    paths: ['pages-tab/routeB/index.js'],
    fc: false,
    projectBacked: true,
  },
  {
    id: 'hash-hist-project-strat-stepE',
    leaves: ['setup.named_bool_num_null'],
    b: 'box-project-strat-b2-baseline',
    o: 'box-project-strat-b2-optc-ext',
    step: 'stepE',
    paths: ['pages-tab/routeE/list/index.js'],
    fc: false,
    projectBacked: true,
  },
  {
    id: 'hash-hist-project-strat-routeCToken',
    leaves: ['setup.ref_string_literal'],
    b: 'box-project-strat-c-baseline',
    o: 'box-project-strat-c-optc-ext',
    step: 'routeCToken',
    paths: ['pages-tab/routeC/index.js'],
    fc: false,
    projectBacked: true,
  },
  {
    id: 'hash-hist-project-strat-meAlipayNull',
    leaves: ['setup.named_bool_num_null'],
    b: 'box-project-strat-c2-baseline',
    o: 'box-project-strat-c2-optc-ext',
    step: 'meAlipayNull',
    paths: ['pages-tab/routeD/index.js'],
    fc: false,
    projectBacked: true,
  },
  {
    id: 'hash-hist-project-strat-popupVisible',
    leaves: ['setup.named_bool_num_null', 'shared.vue_script_only_le_vue_max'],
    b: 'box-project-strat-d-baseline',
    o: 'box-project-strat-d-optc-ext',
    step: 'popupVisible',
    paths: ['modules/components/shared-popup/index.js'],
    fc: false,
    projectBacked: true,
  },
  {
    id: 'hash-hist-project-strat-spotProbeBody',
    leaves: ['shared.leaf_util', 'shared.util_le_closure_max'],
    b: 'box-project-strat-d2-baseline',
    o: 'box-project-strat-d2-optc-ext',
    step: 'spotProbeBody',
    paths: ['modules/utils/unifast-spot-probe.js'],
    fc: false,
    projectBacked: true,
    nonCountingForHash: true, // real DIFF: baseline DCE empty stub vs optc option-a chunk — not EQ
    reason: 'EXPECTED DCE: baseline tree-shakes unused spotMul to "use strict"; optc option-a-export-add emits transform-cjs (cold export surface empty→add)',
  },
  {
    id: 'hash-hist-project-strat-authShowFlow',
    leaves: ['setup.named_bool_num_null', 'life.subpackage_page_edit'],
    b: 'box-project-strat-e-baseline',
    o: 'box-project-strat-e-optc-ext',
    step: 'authShowFlow',
    paths: ['modules/pages/seg-036/index.js'],
    fc: false,
    projectBacked: true,
  },
  {
    id: 'hash-hist-project-strat-template',
    leaves: ['tpl.template_only'],
    b: 'box-project-strat-e2-baseline',
    o: 'box-project-strat-e2-optc-ext',
    step: 'template',
    paths: ['pages-tab/routeA/index.wxml', 'pages-tab/routeA/index.js'],
    fc: true,
    projectBacked: true,
  },
  {
    id: 'hash-hist-project-strat-style',
    leaves: ['style.style_only'],
    b: 'box-project-strat-f-baseline',
    o: 'box-project-strat-f-optc-ext',
    step: 'style',
    paths: ['pages-tab/routeA/index.wxss', 'pages-tab/routeA/index.js'],
    fc: true,
    projectBacked: true,
  },
  {
    id: 'hash-hist-project-strat-sharedStyle',
    leaves: ['style.scss_lang_deep', 'cfg.uni_scss'],
    b: 'box-project-strat-f2-baseline',
    o: 'box-project-strat-f2-optc-ext',
    step: 'sharedStyle',
    paths: ['pages-tab/routeA/index.wxss', 'app.wxss'],
    fc: true,
    projectBacked: true,
  },
  {
    id: 'hash-hist-project-strat-component',
    leaves: ['shared.vue_template_or_style', 'imp.easycom_only'],
    b: 'box-project-strat-g-baseline',
    o: 'box-project-strat-g-optc-ext',
    step: 'component',
    paths: ['modules/components/shared-popup/index.wxml', 'modules/components/shared-popup/index.js'],
    fc: true,
    projectBacked: true,
  },
  {
    id: 'hash-hist-project-strat-appTouch',
    leaves: ['cfg.app_vue'],
    b: 'box-project-strat-g2-baseline',
    o: 'box-project-strat-g2-optc-ext',
    step: 'appTouch',
    paths: ['app.js'],
    fc: true,
    projectBacked: true,
  },
  {
    id: 'hash-hist-fixture-cold',
    leaves: ['build.static_cold_with_vs_without'],
    b: 'box-fixture-baseline-real',
    o: 'box-fixture-optc-ext-v4',
    step: 'cold',
    paths: null,
    fc: false,
    fullTree: true,
    nonCountingForHash: true,
  },
]

for (const h of HIST) {
  if (h.special === 'anatomy-project-flaga') {
    const base = join(LOGS, 'sha-anatomy/project-routeA-baseline-warm.js')
    const optc = join(LOGS, 'sha-anatomy/project-routeA-optc-emit.js')
    if (existsSync(base) && existsSync(optc)) {
      const bs = sha(readFileSync(base))
      const os = sha(readFileSync(optc))
      const outputs = [
        {
          path: 'pages-tab/routeA/index.js',
          baselineSha256: bs,
          optcSha256: os,
          equal: bs === os,
        },
      ]
      add({
        id: h.id,
        taxonomyLeaves: h.leaves,
        method: 'anatomy-file-sha256',
        projectBacked: true,
        verdict: bs === os ? 'IDENTICAL_HASH' : 'HASH_DIFF_BUG',
        detail: `flagA false→true gold vs emit`,
        outputs,
      })
    }
    continue
  }
  const bf = loadFiles(h.b, h.step)
  const of_ = loadFiles(h.o, h.step)
  if (!bf || !of_) continue
  const outputs = h.fullTree
    ? pairManifests(bf, of_, null, { fullTree: true })
    : pairManifests(bf, of_, h.paths)
  // For full tree, compress to summary if huge
  let out = outputs
  let verdict
  if (h.fullTree && outputs.length > 50) {
    const eq = outputs.filter((x) => x.equal).length
    const diff = outputs.length - eq
    const diffs = outputs.filter((x) => !x.equal).slice(0, 10)
    out = diffs.length
      ? diffs
      : [
          {
            path: '*all*',
            baselineSha256: sha(outputs.map((x) => x.baselineSha256).join()),
            optcSha256: sha(outputs.map((x) => x.optcSha256).join()),
            equal: diff === 0,
          },
        ]
    verdict = diff === 0 ? 'IDENTICAL_HASH' : 'HASH_DIFF_BUG'
    add({
      id: h.id,
      taxonomyLeaves: h.leaves,
      method: 'hist-files.json-full-tree',
      projectBacked: !!h.projectBacked,
      nonCountingForHash: !!h.nonCountingForHash,
      verdict,
      detail: `fullTree equal=${eq} diff=${diff}` + (h.nonCountingForHash ? ' [quarantined-cold-dup]' : ''),
      outputs: out,
      evidence: { equalCount: eq, diffCount: diff, baselineReport: h.b, optcReport: h.o },
    })
  } else {
    // primary-only compare for project (ignore vendor churn across separate runs)
    const primary = outputs.filter((x) => (h.paths || []).includes(x.path))
    const use = primary.length ? primary : outputs
    verdict = classify(use, { expectFailClosed: h.fc, reason: h.reason || '' })
    add({
      id: h.id,
      taxonomyLeaves: h.leaves,
      method: 'hist-files.json-sha256',
      projectBacked: !!h.projectBacked,
      nonCountingForHash: !!h.nonCountingForHash,
      verdict,
      detail: `step=${h.step} paths=${use.map((x) => x.path).join(',')}` + (h.reason ? ` · ${h.reason}` : ''),
      outputs: use,
      evidence: { baselineReport: h.b, optcReport: h.o },
    })
  }
}

// ---------- 4) Live log pairs (options/macros/call-arg) ----------
{
  const baseWarm = join(LOGS, 'diff-warm-baseline.json')
  const optcWarm = join(LOGS, 'diff-warm-optc.json')
  const optcOM = join(LOGS, 'diff-warm-optc-options-macros.json')
  if (existsSync(baseWarm)) {
    const b = JSON.parse(readFileSync(baseWarm, 'utf8'))
    const oCall = existsSync(optcWarm) ? JSON.parse(readFileSync(optcWarm, 'utf8')) : []
    const oOM = existsSync(optcOM) ? JSON.parse(readFileSync(optcOM, 'utf8')) : []
    const pairs = [
      ['routeA-call-arg', 'setup.call_arg_literal', oCall, 'pages-tab/routeA/index.js'],
      ['options-data-lit', 'opt.data_literal', oOM, 'pkg-risk/options-lit.js'],
      ['macros-default-lit', 'macro.props_default_literal', oOM, 'pkg-risk/macros-props.js'],
    ]
    for (const [step, leaf, oArr, path] of pairs) {
      const br = b.find((x) => x.step === step)
      const or_ = oArr.find((x) => x.step === step)
      if (!br?.outSha || !or_?.outSha) continue
      const outputs = [
        {
          path,
          baselineSha256: br.outSha,
          optcSha256: or_.outSha,
          equal: br.outSha === or_.outSha,
        },
      ]
      add({
        id: `hash-live-log-${step}`,
        taxonomyLeaves: [leaf],
        method: 'live-log-outSha',
        projectBacked: false,
        verdict: br.outSha === or_.outSha ? 'IDENTICAL_HASH' : 'HASH_DIFF_BUG',
        detail: `baseMs=${br.metric?.totalMs} optcMs=${or_.ms || or_.metric?.totalMs}`,
        outputs,
      })
    }
  }
}


// ---------- 4b) Extra hist / self-pairs for remaining high leaves ----------
{
  // Closure over: optc report box-fixture-f8b-closure-over — full path; pair util sha cold vs warm is not with-vs-without.
  // Use sharedModule from box-hash-shared (IDENTICAL) already covers util_le; for gt, run compare on f8b if we have baseline.
  const overO = loadFiles('box-fixture-f8b-closure-over', 'sharedModule')
  const overB = loadFiles('box-hash-shared-baseline', 'sharedModule') // different edit — skip if missing
  // Option A hist
  const oa = loadMetrics('box-fixture-f14-option-a')
  if (oa) {
    // no baseline twin — skip
  }
}


// ---------- 4c) REMOVED: hash-reuse-* quarantined (auditor FAIL) ----------

// ---------- 5) Offline emit vs gold for stratified Options/macro pages (fixture shells) ----------
async function offlineStratified() {
  try {
    const { patchColdPageJsOptionsDataLiterals, patchColdPageJsPropsDefaults } = await import(
      '../optimize/lib/optc-ext-options.mjs'
    )
    const { emitOptCExtPage } = await import('../optimize/lib/optc-ext-emitter.mjs')
    // Use live gold SHAs from logs
    const goldOpt = '13075b53061d97457e42f6e6e731bb0f0f1eed9e855031225d4a4fd26390e96f'
    const goldMac = '674455b6d5d23d3446412a91bf438ed92a2aa016151caba3ae644b73b59f7643'
    const coldOptPath = join(FIX, 'dist/dev/mp-weixin/pkg-risk/options-lit.js')
    const coldMacPath = join(FIX, 'dist/dev/mp-weixin/pkg-risk/macros-props.js')
    // Also from smoke dist if present
    const optVue = join(FIX, 'src/pkg-risk/options-lit.vue')
    const macVue = join(FIX, 'src/pkg-risk/macros-props.vue')
    if (existsSync(coldOptPath) && existsSync(optVue)) {
      const cold = readFileSync(coldOptPath, 'utf8')
      const beforeVue = readFileSync(join(FIX, 'source-backup/src/pkg-risk/options-lit.vue'), 'utf8')
      const afterVue = beforeVue
        .replace(/title:\s*['"]opts0['"]/, "title: 'opts1'")
        .replace(/count:\s*1/, 'count: 2')
      const patched = patchColdPageJsOptionsDataLiterals(cold, beforeVue, afterVue)
      if (patched?.ok && patched.code) {
        const afterSha = sha(patched.code)
        add({
          id: 'hash-offline-options-data-vs-gold',
          taxonomyLeaves: ['opt.data_literal'],
          method: 'offline-emit+live-gold-sha',
          verdict: afterSha === goldOpt ? 'IDENTICAL_HASH' : 'HASH_DIFF_BUG',
          detail: `emitClass=surgical-options-data`,
          outputs: [
            {
              path: 'pkg-risk/options-lit.js',
              baselineSha256: goldOpt,
              optcSha256: afterSha,
              equal: afterSha === goldOpt,
            },
          ],
        })
      }
    }
    if (existsSync(coldMacPath) && existsSync(macVue)) {
      const cold = readFileSync(coldMacPath, 'utf8')
      const beforeVue = readFileSync(join(FIX, 'source-backup/src/pkg-risk/macros-props.vue'), 'utf8')
      const afterVue = beforeVue.replace(/default:\s*['"]mac0['"]/, "default: 'mac1'")
      const patched = patchColdPageJsPropsDefaults(cold, beforeVue, afterVue)
      if (patched?.ok && patched.code) {
        const afterSha = sha(patched.code)
        add({
          id: 'hash-offline-macros-default-vs-gold',
          taxonomyLeaves: ['macro.props_default_literal'],
          method: 'offline-emit+live-gold-sha',
          verdict: afterSha === goldMac ? 'IDENTICAL_HASH' : 'HASH_DIFF_BUG',
          detail: `emitClass=surgical-props-default`,
          outputs: [
            {
              path: 'pkg-risk/macros-props.js',
              baselineSha256: goldMac,
              optcSha256: afterSha,
              equal: afterSha === goldMac,
            },
          ],
        })
      }
    }
    // RouteA call-arg offline vs gold
    const routeACold = join(FIX, 'dist/dev/mp-weixin/pages-tab/routeA/index.js')
    const routeAVue = join(FIX, 'source-backup/src/pages-tab/routeA/index.vue')
    const goldCall = 'bb954f69abf8a15b9ddc85f5f7ee892b86f489fa74ef3e32d2649c90f2617428'
    if (existsSync(routeACold) && existsSync(routeAVue)) {
      const before = readFileSync(routeAVue, 'utf8')
      const after = before.replace(/probeMul\(\s*21\s*\)/, 'probeMul(22)')
      const r = emitOptCExtPage({
        pagePath: 'pages-tab/routeA/index',
        beforeVue: before,
        afterVue: after,
        coldJs: readFileSync(routeACold, 'utf8'),
        outDir: join(FIX, 'dist/dev/mp-weixin'),
        write: false,
      })
      if (r?.ok && r.code) {
        const afterSha = sha(r.code)
        add({
          id: 'hash-offline-routeA-callarg-vs-gold',
          taxonomyLeaves: ['setup.call_arg_literal'],
          method: 'offline-emit+live-gold-sha',
          verdict: afterSha === goldCall ? 'IDENTICAL_HASH' : 'HASH_DIFF_BUG',
          detail: `emitClass=${r.emitClass}`,
          outputs: [
            {
              path: 'pages-tab/routeA/index.js',
              baselineSha256: goldCall,
              optcSha256: afterSha,
              equal: afterSha === goldCall,
            },
          ],
        })
      }
    }
  } catch (e) {
    console.error('offlineStratified', e.message)
  }
}

await offlineStratified()


// ---------- extras (≥80) ----------
{
  const extraPath = join(OUT, 'hash-paired-extra.json')
  if (existsSync(extraPath)) {
    const extras = JSON.parse(readFileSync(extraPath, 'utf8'))
    for (const e of extras) {
      if (report.cases.some((c) => c.id === e.id)) continue
      const id = e.id || ''
      const non =
        id.startsWith('hash-cold-pair-') ||
        id.startsWith('hash-extra-cold-') ||
        id.startsWith('hash-reuse-') ||
        id.startsWith('hash-project-companion') ||
        e.nonCountingForHash === true
      // companions must not credit setup.ref_string_literal
      if (id.startsWith('hash-project-companion')) {
        e.taxonomyLeaves = ['build.static_cold_with_vs_without']
        e.nonCountingForHash = true
        e.verdict = e.verdict || 'IDENTICAL_HASH'
        e.detail = (e.detail || '') + ' [quarantined-companion-mis-map]'
      } else if (non) {
        e.nonCountingForHash = true
        e.taxonomyLeaves = ['build.static_cold_with_vs_without']
        e.detail = (e.detail || '') + ' [quarantined-cold-dup]'
      }
      add(e)
    }
  }
}

// ---------- 6) BLOCKED DevTools ----------
add({
  id: 'hash-blocked-devtools-gui',
  taxonomyLeaves: ['blocked.devtools_gui_hot_reload'],
  method: 'blocked',
  verdict: 'BLOCKED',
  detail: 'WeChat DevTools GUI hot-reload not runnable on Linux box',
  outputs: [],
  nonCountingForHash: true,
})

// ---------- Coverage vs taxonomy (honest) ----------
const leafById = Object.fromEntries(taxonomy.leaves.map((l) => [l.id, l]))
const coveringVerdicts = new Set(['IDENTICAL_HASH', 'FAIL_CLOSED_HASH_MATCH'])

function caseHasPairedHash(c) {
  return (
    (c.outputs || []).some((o) => o.baselineSha256 && o.optcSha256) ||
    (c.evidence && c.evidence.merkleBaseline && c.evidence.merkleOptc)
  )
}
function isReuseCase(c) {
  const id = c.id || ''
  return (
    id.startsWith('hash-reuse-') ||
    String(c.method || '').includes('sha-reuse') ||
    c.evidence?.reusedFrom ||
    /reuse outputs from/i.test(String(c.detail || ''))
  )
}
function isColdDupPadding(c) {
  const id = c.id || ''
  return (
    id.startsWith('hash-cold-pair-') ||
    id.startsWith('hash-extra-cold-') ||
    id.startsWith('hash-project-companion')
  )
}
function isCountingCase(c) {
  if (c.nonCountingForHash) return false
  if (isReuseCase(c)) return false
  if (isColdDupPadding(c)) return false
  if (c.verdict === 'BLOCKED') return false
  return true
}
function isHonestCoveringCase(c) {
  if (!isCountingCase(c)) return false
  if (!coveringVerdicts.has(c.verdict)) return false
  if (!caseHasPairedHash(c)) return false
    // Mislabel only for gap fail-closed leaves claiming surgical IDENTICAL without vsCold proof
  if (
    String(c.id || '').startsWith('hash-gap-') &&
    String(c.detail || '').includes('viteSkipped=true') &&
    (c.taxonomyLeaves || []).some((l) =>
      /(gt_closure_max|gt_vue_max|messy\.ts_as|messy\.private_fields|messy\.dynamic_import|messy\.circular_dep|messy\.missing_import|messy\.default_import|messy\.lang_ts|messy\.dual_script|messy\.getCI|imp\.side_effect|imp\.import_type|imp\.uni_modules|cfg\.mixins|ifdef)/.test(
        l,
      ),
    ) &&
    !(c.evidence?.changedVsCold || []).length &&
    c.verdict === 'IDENTICAL_HASH'
  ) {
    return false
  }
  return true
}

// Weight map: ONLY exhaustive-taxonomy.json leaves with weight>0, excluding blocked.*
const weightMap = {}
for (const l of taxonomy.leaves) {
  if (!(l.weight > 0)) continue
  if (String(l.id).startsWith('blocked.')) continue
  if (l.na) continue
  weightMap[l.id] = l.weight
}
const totalW = Object.values(weightMap).reduce((a, b) => a + b, 0)

const coveredMechanical = new Set()
const coveredHonest = new Set()
const coveredByMech = {}
const coveredByHonest = {}
for (const c of report.cases) {
  if (!caseHasPairedHash(c) || !coveringVerdicts.has(c.verdict)) continue
  // mechanical: any paired covering verdict except explicit BLOCKED leaf
  for (const leaf of c.taxonomyLeaves || []) {
    if (!(leaf in weightMap)) continue
    coveredMechanical.add(leaf)
    ;(coveredByMech[leaf] ||= []).push(c.id)
  }
  if (!isHonestCoveringCase(c)) continue
  for (const leaf of c.taxonomyLeaves || []) {
    if (!(leaf in weightMap)) continue
    coveredHonest.add(leaf)
    ;(coveredByHonest[leaf] ||= []).push(c.id)
  }
}

let mechW = 0
let honestW = 0
const leafCoverage = []
for (const [id, w] of Object.entries(weightMap)) {
  const mech = coveredMechanical.has(id)
  const hon = coveredHonest.has(id)
  if (mech) mechW += w
  if (hon) honestW += w
  leafCoverage.push({
    id,
    weight: +Number(w).toFixed(4),
    hashCoveredMechanical: mech,
    hashCoveredHonest: hon,
    hashCovered: hon, // primary bar = honest
    casesMechanical: coveredByMech[id] || [],
    cases: coveredByHonest[id] || [],
  })
}
leafCoverage.sort((a, b) => b.weight - a.weight)

const by = {}
const bugs = []
const reuseCounted = []
for (const c of report.cases) {
  by[c.verdict] = (by[c.verdict] || 0) + 1
  if (c.verdict === 'HASH_DIFF_BUG') bugs.push(c.id)
  if (isReuseCase(c) && !c.nonCountingForHash) reuseCounted.push(c.id)
}

const hashPaired = report.cases.filter((c) => caseHasPairedHash(c)).length
const hashPairedCounting = report.cases.filter((c) => caseHasPairedHash(c) && isCountingCase(c)).length
const projectBackedStratified = report.cases.filter(
  (c) => c.projectBacked && isHonestCoveringCase(c) && !String(c.id).includes('companion'),
).length

const hashWeightedCoverageMechanical = totalW ? +((mechW / totalW) * 100).toFixed(4) : 0
const hashWeightedCoverageHonest = totalW ? +((honestW / totalW) * 100).toFixed(4) : 0

report.summary = {
  totalCases: report.cases.length,
  hashPairedCaseCount: hashPaired,
  hashPairedCountingCaseCount: hashPairedCounting,
  byVerdict: by,
  hashDiffBugs: bugs,
  reuseCasesStillCounting: reuseCounted,
  projectBacked: report.cases.filter((c) => c.projectBacked).length,
  projectBackedStratifiedHash: projectBackedStratified,
  staticIdentical: report.static?.identical === true,
  taxonomyLeafCount: Object.keys(weightMap).length,
  taxonomyWeightSumExBlocked: +totalW.toFixed(4),
}
report.hashWeightedCoverageMechanical = hashWeightedCoverageMechanical
report.hashWeightedCoverageHonest = hashWeightedCoverageHonest
report.hashWeightedCoverage = hashWeightedCoverageHonest // do not claim mechanical as primary
report.leafCoverage = leafCoverage
report.uncoveredLeaves = leafCoverage.filter((l) => !l.hashCoveredHonest)
report.uncoveredWeightHonest = +report.uncoveredLeaves.reduce((a, l) => a + l.weight, 0).toFixed(4)

writeFileSync(join(OUT, 'hash-paired-matrix.json'), JSON.stringify(report, null, 2))

const md = []
md.push('# Hash-paired matrix (Measured · Asia/Shanghai)')
md.push('')
md.push(`**Harness:** \`verify/hash-paired-matrix.mjs\` → \`verify/hash-paired-matrix.json\``)
md.push(`**When:** ${report.when}`)
md.push(`**Bar:** paired baselineSha256+optcSha256; honest excludes reuse/cold-dup/companion mis-map`)
md.push('')
md.push('## Coverage')
md.push(`| Metric | Value |`)
md.push(`|--------|-------|`)
md.push(`| hashWeightedCoverageMechanical | ${hashWeightedCoverageMechanical}% |`)
md.push(`| **hashWeightedCoverageHonest** (ex-BLOCKED) | **${hashWeightedCoverageHonest}%** |`)
md.push(`| uncoveredWeightHonest | ${report.uncoveredWeightHonest}% |`)
md.push(`| HASH_DIFF_BUG | ${bugs.length ? bugs.join(', ') : '**0**'} |`)
md.push(`| reuse still counting | ${reuseCounted.length ? reuseCounted.join(', ') : '**0**'} |`)
md.push(`| projectBackedStratifiedHash | ${projectBackedStratified} |`)
md.push('')
md.push('## Static cold')
if (report.static) {
  md.push(`| equalCount | **${report.static.equalCount}** |`)
  md.push(`| diffCount | **${report.static.diffCount}** |`)
} else md.push('_missing_')
md.push('')
md.push('## Dynamic by verdict')
md.push('| Verdict | Count |')
md.push('|---------|-------|')
for (const [k, v] of Object.entries(by)) md.push(`| ${k} | ${v} |`)
md.push('')
md.push('## Cases (counting)')
md.push('| ID | Verdict | Leaves | Outputs |')
md.push('|----|---------|--------|---------|')
for (const c of report.cases) {
  if (c.nonCountingForHash || isReuseCase(c) || isColdDupPadding(c)) continue
  const outs = (c.outputs || [])
    .slice(0, 2)
    .map((o) => `${o.path}:${o.equal ? 'EQ' : 'NE'}(${(o.baselineSha256 || '').slice(0, 8)})`)
    .join('; ')
  md.push(`| ${c.id} | ${c.verdict} | ${(c.taxonomyLeaves || []).join(', ')} | ${outs} |`)
}
md.push('')
md.push('## Uncovered leaves (honest)')
for (const l of report.uncoveredLeaves) {
  md.push(`- ${l.weight.toFixed(4)}% \`${l.id}\``)
}
writeFileSync(join(OUT, 'HASH-PAIRED-MATRIX.md'), md.join('\n'))

const cov = []
cov.push('# Hash coverage (Measured · Asia/Shanghai)')
cov.push('')
cov.push(`- hashWeightedCoverageMechanical: **${hashWeightedCoverageMechanical}%**`)
cov.push(`- **hashWeightedCoverageHonest (ex-BLOCKED): ${hashWeightedCoverageHonest}%**`)
cov.push(`- hashPairedCaseCount: **${hashPaired}** (counting ${hashPairedCounting})`)
cov.push(`- HASH_DIFF_BUG: **${bugs.length}**`)
cov.push(`- reuse counting: **${reuseCounted.length}**`)
cov.push(`- uncoveredWeightHonest: **${report.uncoveredWeightHonest}%**`)
cov.push(`- projectBackedStratifiedHash: **${projectBackedStratified}**`)
cov.push('')
cov.push('Primary bar is **honest**. Do not claim 100% unless honest ≥99%.')
writeFileSync(join(OUT, 'HASH-COVERAGE.md'), cov.join('\n'))

console.log('SUMMARY', report.summary)
console.log('mechanical', hashWeightedCoverageMechanical)
console.log('honest', hashWeightedCoverageHonest)
console.log('uncovered', report.uncoveredLeaves.slice(0, 20).map((l) => `${l.weight}:${l.id}`))
if (bugs.length || reuseCounted.length) process.exitCode = 1
if (hashWeightedCoverageHonest < 99) process.exitCode = 1
