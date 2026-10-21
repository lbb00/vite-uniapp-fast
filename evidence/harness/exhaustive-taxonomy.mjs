#!/usr/bin/env node
/**
 * Step 1: Measured census → weighted warm-dev taxonomy.
 * Weight unit: percentage points of warm-edit developer actions (sum → 100 after L1 norm).
 * Pre-norm budget ≈ 100 with blocked reserved at 1.0 pp.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.env.UNI_FAST_WORKSPACE || process.cwd()
const SRC = join(ROOT, 'compile-optimization/project/src')
const OUT = join(ROOT, 'verify')

function walk(dir, acc = []) {
  let ents
  try {
    ents = readdirSync(dir, { withFileTypes: true })
  } catch {
    return acc
  }
  for (const e of ents) {
    if (['node_modules', 'dist', '.git', '__tests__'].includes(e.name)) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, acc)
    else acc.push(p)
  }
  return acc
}

const allFiles = walk(SRC)
const vueFiles = allFiles.filter((f) => f.endsWith('.vue'))
const pagesJson = JSON.parse(readFileSync(join(SRC, 'pages.json'), 'utf8'))
const mainPages = pagesJson.pages || []
const subPackages = pagesJson.subPackages || pagesJson.subpackages || []
let subPageCount = 0
for (const sp of subPackages) subPageCount += (sp.pages || []).length
const easycom = pagesJson.easycom || {}
const subRoots = subPackages.map((s) => (s.root || '').replace(/^\//, '').replace(/\/$/, ''))

const C = {
  totalVue: 0,
  optionsOnly: 0,
  setupNoMacro: 0,
  setupMacro: 0,
  emptyScript: 0,
  other: 0,
  langTs: 0,
  wxs: 0,
  dualScript: 0,
  macrosProps: 0,
  macrosEmits: 0,
  macrosExpose: 0,
  macrosWithDefaults: 0,
  dataFn: 0,
  methodsBlock: 0,
  computedBlock: 0,
  watchBlock: 0,
  atAlias: 0,
  relativeImp: 0,
  importStar: 0,
  importType: 0,
  sideEffectImp: 0,
  dynamicImport: 0,
  optionalChaining: 0,
  nullish: 0,
  privateField: 0,
  getCI: 0,
  provide: 0,
  inject: 0,
  mapVuex: 0,
  useStore: 0,
  piniaish: 0,
  composableImp: 0,
  mixinImp: 0,
  storeImp: 0,
  noSemiHeavy: 0,
  largeSetup: 0,
  hasStyle: 0,
  hasTemplate: 0,
  componentsPath: 0,
  pagesPath: 0,
  underModules: 0,
  subpkgVue: 0,
}

function scriptsOf(text) {
  let s = ''
  const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi
  let m
  while ((m = re.exec(text))) s += m[1] + '\n'
  return s
}

for (const f of vueFiles) {
  const text = readFileSync(f, 'utf8')
  const rel = relative(SRC, f)
  C.totalVue++
  if (subRoots.some((r) => r && rel.startsWith(r + '/'))) C.subpkgVue++
  if (/^components\/|\/components\//.test(rel)) C.componentsPath++
  if (/^pages|^modules\/pages/.test(rel)) C.pagesPath++
  if (/^modules\//.test(rel)) C.underModules++
  const scriptTags = [...text.matchAll(/<script\b([^>]*)>/gi)]
  if (scriptTags.length > 1) C.dualScript++
  if (/lang\s*=\s*["']ts["']/i.test(text)) C.langTs++
  if (/lang\s*=\s*["']wxs["']/i.test(text)) C.wxs++
  if (/<template[\s>]/i.test(text)) C.hasTemplate++
  if (/<style[\s>]/i.test(text)) C.hasStyle++
  const scripts = scriptsOf(text)
  const setupTag = /<script\b[^>]*\bsetup\b/i.test(text)
  const macros =
    /\bdefineProps\b|\bdefineEmits\b|\bdefineExpose\b|\bwithDefaults\b|\bdefineOptions\b/.test(scripts)
  const hasExport = /export\s+default\s*\{/.test(scripts)
  const hasData = /\bdata\s*\(\s*\)\s*\{/.test(scripts)
  if (!scripts.trim()) C.emptyScript++
  else if (setupTag) {
    if (macros) C.setupMacro++
    else C.setupNoMacro++
  } else if (hasExport || hasData) C.optionsOnly++
  else C.other++
  if (/\bdefineProps\b/.test(scripts)) C.macrosProps++
  if (/\bdefineEmits\b/.test(scripts)) C.macrosEmits++
  if (/\bdefineExpose\b/.test(scripts)) C.macrosExpose++
  if (/\bwithDefaults\b/.test(scripts)) C.macrosWithDefaults++
  if (/\bdata\s*\(\s*\)\s*\{/.test(scripts)) C.dataFn++
  if (/\bmethods\s*:\s*\{/.test(scripts)) C.methodsBlock++
  if (/\bcomputed\s*:\s*\{/.test(scripts)) C.computedBlock++
  if (/\bwatch\s*:\s*\{/.test(scripts)) C.watchBlock++
  if (/from\s+['"]@\//.test(scripts) || /import\s+['"]@\//.test(scripts)) C.atAlias++
  if (/from\s+['"]\.\.?\//.test(scripts)) C.relativeImp++
  if (/import\s+\*\s+as\b/.test(scripts)) C.importStar++
  if (/import\s+type\b/.test(scripts)) C.importType++
  if (/^import\s+['"][^'"]+['"]\s*;?\s*$/m.test(scripts)) C.sideEffectImp++
  if (/import\s*\(/.test(scripts)) C.dynamicImport++
  if (/\?\./.test(scripts)) C.optionalChaining++
  if (/\?\?/.test(scripts)) C.nullish++
  if (/#[a-zA-Z_]/.test(scripts)) C.privateField++
  if (/\bgetCurrentInstance\b/.test(scripts)) C.getCI++
  if (/\bprovide\s*\(/.test(scripts)) C.provide++
  if (/\binject\s*\(/.test(scripts)) C.inject++
  if (/\bmapState\b|\bmapGetters\b|\bmapActions\b|\bmapMutations\b/.test(scripts)) C.mapVuex++
  if (/\buseStore\b/.test(scripts)) C.useStore++
  if (/\bdefineStore\b|from\s+['"]pinia['"]/.test(scripts)) C.piniaish++
  if (/composables?\/|\/hooks\//.test(scripts)) C.composableImp++
  if (/mixin/i.test(scripts) && /from\s+['"]/.test(scripts)) C.mixinImp++
  if (/store\/|storeA|vuex|mapState|useStore/.test(scripts)) C.storeImp++
  const lines = scripts.split('\n').length
  if (lines > 200) C.largeSetup++
  const semis = (scripts.match(/;/g) || []).length
  const nlines = scripts
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('//') && !l.trim().startsWith('import')).length
  if (nlines > 15 && semis / Math.max(1, nlines) < 0.3) C.noSemiHeavy++
}

const scriptBearing = C.optionsOnly + C.setupNoMacro + C.setupMacro + C.other
const storeFiles = allFiles.filter((f) => /\/(store|storeA)\//.test(f) || /\/store\.(js|ts)$/.test(f)).length
const mixinFiles = allFiles.filter((f) => /mixin/i.test(relative(SRC, f))).length
const pluginFiles = allFiles.filter((f) => /\/plugins\//.test(f)).length
const i18nFiles = allFiles.filter((f) => /i18n|locale/i.test(relative(SRC, f))).length
const utilJs = allFiles.filter((f) => /\/utils\/|\/libs\/|\/helpers\//.test(f) && /\.(js|ts)$/.test(f)).length

const EDIT_PP = {
  script_literal_expr: 35.0,
  script_structure: 11.0,
  template_only: 17.0,
  style_only: 9.5,
  template_plus_script: 7.5,
  shared_util_composable: 6.5,
  shared_vue_component: 3.5,
  store_global_config: 2.5,
  new_rename_delete_batch: 1.5,
  build_modes: 1.0,
  messy_extreme: 2.0,
  imports_refs_facets: 2.0,
  blocked_devtools: 1.0,
}
// sum = 100 exactly
const priorSum = Object.values(EDIT_PP).reduce((a, b) => a + b, 0)

const optShare = C.optionsOnly / scriptBearing
const setupNoShare = C.setupNoMacro / scriptBearing
const setupMacShare = C.setupMacro / scriptBearing
const otherShare = C.other / scriptBearing

const leaves = []
function add(id, category, weight, censusNote, extra = {}) {
  leaves.push({
    id,
    category,
    weight: +Number(weight).toFixed(4),
    censusNote,
    coveredByCaseIds: [],
    ...extra,
  })
}

// --- script literals 35 ---
add('opt.data_literal', 'page-script+edit', EDIT_PP.script_literal_expr * optShare * 0.7, `Options=${C.optionsOnly}; data() literal warm tweak`)
add('opt.other_literal_in_options', 'page-script+edit', EDIT_PP.script_literal_expr * optShare * 0.3, `Options non-data literal`)
add('setup.ref_string_literal', 'page-script+edit', EDIT_PP.script_literal_expr * setupNoShare * 0.45, `setupNoMacro=${C.setupNoMacro}`)
add('setup.named_bool_num_null', 'page-script+edit', EDIT_PP.script_literal_expr * setupNoShare * 0.25, `named bool/num/null ref`)
add('setup.call_arg_literal', 'page-script+edit', EDIT_PP.script_literal_expr * setupNoShare * 0.2, `call-arg`)
add('setup.plain_const_literal', 'page-script+edit', EDIT_PP.script_literal_expr * setupNoShare * 0.1, `plain const`)
add('macro.props_default_literal', 'page-script+edit', EDIT_PP.script_literal_expr * setupMacShare * 0.55, `setupMacro=${C.setupMacro}; defineProps=${C.macrosProps}`)
add('macro.other_macro_literal', 'page-script+edit', EDIT_PP.script_literal_expr * setupMacShare * 0.45, `emits=${C.macrosEmits} expose=${C.macrosExpose} withDefaults=${C.macrosWithDefaults}`)
if (otherShare > 0) add('other.script_literal', 'page-script+edit', EDIT_PP.script_literal_expr * otherShare, `other=${C.other}`)
else add('other.script_literal', 'page-script+edit', 0, `other=${C.other}`, { na: true })

// --- structure 11 ---
add('struct.opt_methods_computed_watch', 'edit-kinds', EDIT_PP.script_structure * optShare * 0.45, `methods=${C.methodsBlock} computed=${C.computedBlock} watch=${C.watchBlock}`)
add('struct.opt_add_remove_binding', 'edit-kinds', EDIT_PP.script_structure * optShare * 0.25, `Options add/remove binding`)
add('struct.setup_body_complex', 'edit-kinds', EDIT_PP.script_structure * (setupNoShare + setupMacShare) * 0.35, `complex setup-body`)
add('struct.setup_add_remove_binding', 'edit-kinds', EDIT_PP.script_structure * (setupNoShare + setupMacShare) * 0.2, `setup add/remove binding`)
add('struct.import_add_remove_rename', 'edit-kinds', EDIT_PP.script_structure * 0.25, `import add/remove/rename`)
add('struct.export_add_rename', 'edit-kinds', EDIT_PP.script_structure * 0.08, `export-add/rename`)
add('struct.macro_type_or_shape', 'edit-kinds', EDIT_PP.script_structure * setupMacShare * 0.35, `macro type/shape`)

// --- tpl/style ---
add('tpl.template_only', 'edit-kinds', EDIT_PP.template_only, `hasTemplate=${C.hasTemplate}`)
add('style.style_only', 'edit-kinds', EDIT_PP.style_only, `hasStyle=${C.hasStyle}`)
add('tpl.template_plus_script', 'edit-kinds', EDIT_PP.template_plus_script, `template+script`)
add('model.empty_script_sfc', 'page-script-models', 0, `emptyScript=${C.emptyScript} weight in tpl/style`, { na: true })
add('style.script_plus_style', 'edit-kinds', 0, `folded into style_only when style dirty`, { na: true })

// --- shared util 6.5 ---
add('shared.util_le_closure_max', 'shared', EDIT_PP.shared_util_composable * 0.45, `utilJs≈${utilJs}`)
add('shared.util_gt_closure_max', 'shared', EDIT_PP.shared_util_composable * 0.2, `over CLOSURE_MAX`)
add('shared.leaf_util', 'shared', EDIT_PP.shared_util_composable * 0.15, `leaf util`)
add('shared.composable_hook', 'shared', EDIT_PP.shared_util_composable * 0.2, `composableImp≈${C.composableImp}`)

// --- shared vue 3.5 ---
add('shared.vue_script_only_le_vue_max', 'shared', EDIT_PP.shared_vue_component * 0.45, `componentsPath=${C.componentsPath}`)
add('shared.vue_script_only_gt_vue_max', 'shared', EDIT_PP.shared_vue_component * 0.15, `high fanout Vue`)
add('shared.vue_template_or_style', 'shared', EDIT_PP.shared_vue_component * 0.25, `shared vue tpl/style`)
add('shared.option_a_export_add_rename', 'shared', EDIT_PP.shared_vue_component * 0.1, `Option A`)
add('shared.inlined_vs_chunk', 'shared', EDIT_PP.shared_vue_component * 0.05, `F16 proxy vs separate chunk`)

// --- config 2.5 ---
add('cfg.store_vuex', 'config-global', EDIT_PP.store_global_config * 0.36, `storeFiles=${storeFiles} mapVuex≈${C.mapVuex}`)
add('cfg.app_vue', 'config-global', EDIT_PP.store_global_config * 0.12, `App.vue`)
add('cfg.main_js', 'config-global', EDIT_PP.store_global_config * 0.1, `main.js`)
add('cfg.pages_json', 'config-global', EDIT_PP.store_global_config * 0.15, `routes=${mainPages.length + subPageCount}`)
add('cfg.manifest', 'config-global', EDIT_PP.store_global_config * 0.08, `manifest`)
add('cfg.uni_scss', 'config-global', EDIT_PP.store_global_config * 0.08, `uni.scss`)
add('cfg.mixins', 'config-global', EDIT_PP.store_global_config * 0.06, `mixinFiles=${mixinFiles}`)
add('cfg.plugins', 'config-global', EDIT_PP.store_global_config * 0.03, `pluginFiles=${pluginFiles}`)
if (i18nFiles > 0) add('cfg.i18n', 'config-global', EDIT_PP.store_global_config * 0.02, `i18nFiles=${i18nFiles}`)
else add('cfg.i18n', 'config-global', 0, `i18nFiles=0`, { na: true })

// --- lifecycle 1.5 ---
add('life.new_never_seeded', 'lifecycle', EDIT_PP.new_rename_delete_batch * 0.35, `new never-seeded`)
add('life.rename_delete_page', 'lifecycle', EDIT_PP.new_rename_delete_batch * 0.35, `rename/delete`)
add('life.concurrent_multi_page', 'lifecycle', EDIT_PP.new_rename_delete_batch * 0.2, `multi-page batch`)
add('life.subpackage_page_edit', 'lifecycle', EDIT_PP.new_rename_delete_batch * 0.1, `subpkg=${subPackages.length} subPages=${subPageCount}`)

// --- build 1.0 ---
add('build.static_cold_with_vs_without', 'build-modes', EDIT_PP.build_modes * 0.4, `cold with vs without`)
add('build.dynamic_warm_optc_vs_baseline', 'build-modes', EDIT_PP.build_modes * 0.6, `warm optc vs baseline`)

// --- messy 2.0 ---
add('messy.asi_no_semicolon', 'messy-extreme', EDIT_PP.messy_extreme * 0.18, `noSemiHeavy≈${C.noSemiHeavy}`)
add('messy.ts_as_enum_residue', 'messy-extreme', EDIT_PP.messy_extreme * 0.08, `langTs=${C.langTs}`)
add('messy.private_fields', 'messy-extreme', EDIT_PP.messy_extreme * 0.05, `privateField≈${C.privateField}`)
add('messy.optional_nullish', 'messy-extreme', EDIT_PP.messy_extreme * 0.12, `?.≈${C.optionalChaining} ??≈${C.nullish}`)
add('messy.iife_toplevel', 'messy-extreme', EDIT_PP.messy_extreme * 0.05, `IIFE`)
add('messy.getCI_provide_inject', 'messy-extreme', EDIT_PP.messy_extreme * 0.1, `getCI=${C.getCI}`)
add('messy.defineExpose', 'messy-extreme', EDIT_PP.messy_extreme * 0.08, `expose=${C.macrosExpose}`)
add('messy.empty_minimal_sfc', 'messy-extreme', EDIT_PP.messy_extreme * 0.08, `emptyScript=${C.emptyScript}`)
add('messy.large_setup', 'messy-extreme', EDIT_PP.messy_extreme * 0.1, `largeSetup=${C.largeSetup}`)
add('messy.dual_script_wxs', 'messy-extreme', EDIT_PP.messy_extreme * 0.05, `dual=${C.dualScript} wxs=${C.wxs}`)
add('messy.dynamic_import', 'messy-extreme', EDIT_PP.messy_extreme * 0.04, `dynamicImport=${C.dynamicImport}`)
add('messy.circular_dep', 'messy-extreme', EDIT_PP.messy_extreme * 0.04, `circular`)
add('messy.missing_import', 'messy-extreme', EDIT_PP.messy_extreme * 0.04, `missing import`)
add('messy.default_import_multi_export', 'messy-extreme', EDIT_PP.messy_extreme * 0.04, `default import multi-export`)
if (C.langTs > 0) add('messy.lang_ts_sfc', 'messy-extreme', EDIT_PP.messy_extreme * 0.05, `langTs=${C.langTs}`)
else add('messy.lang_ts_sfc', 'messy-extreme', 0, `langTs=0`, { na: true })

// --- import facets 2.0 ---
add('imp.at_alias', 'imports-refs', EDIT_PP.imports_refs_facets * 0.2, `atAlias≈${C.atAlias}`)
add('imp.relative_multihop', 'imports-refs', EDIT_PP.imports_refs_facets * 0.1, `relativeImp≈${C.relativeImp}`)
add('imp.barrel_reexport', 'imports-refs', EDIT_PP.imports_refs_facets * 0.1, `barrel`)
add('imp.import_star', 'imports-refs', EDIT_PP.imports_refs_facets * 0.06, `importStar≈${C.importStar}`)
add('imp.default_plus_named', 'imports-refs', EDIT_PP.imports_refs_facets * 0.1, `default+named`)
add('imp.side_effect_import', 'imports-refs', EDIT_PP.imports_refs_facets * 0.06, `sideEffect≈${C.sideEffectImp}`)
add('imp.import_type', 'imports-refs', EDIT_PP.imports_refs_facets * 0.04, `importType≈${C.importType}`)
add('imp.uni_modules', 'imports-refs', EDIT_PP.imports_refs_facets * 0.08, `uni_modules`)
add('imp.easycom_only', 'imports-refs', EDIT_PP.imports_refs_facets * 0.2, `easycom autoscan`)
add('imp.require_in_setup', 'imports-refs', EDIT_PP.imports_refs_facets * 0.06, `require in setup`)

// --- blocked 1.0 ---
add('blocked.devtools_gui_hot_reload', 'blocked', EDIT_PP.blocked_devtools, `WeChat DevTools GUI — BLOCKED (no Mac login)`, { blocked: true })

for (const l of leaves) {
  if (l.na) l.weight = 0
}

const sumPos = leaves.reduce((s, l) => s + l.weight, 0)
for (const l of leaves) {
  if (l.weight > 0) l.weight = +((l.weight / sumPos) * 100).toFixed(4)
}
const sum2 = +leaves.reduce((s, l) => s + l.weight, 0).toFixed(4)
const drift = +(100 - sum2).toFixed(4)
if (Math.abs(drift) >= 0.0001) {
  const top = leaves.filter((l) => l.weight > 0 && !l.blocked).sort((a, b) => b.weight - a.weight)[0]
  top.weight = +(top.weight + drift).toFixed(4)
}

const report = {
  when: new Date().toISOString(),
  zone: 'Asia/Shanghai',
  label: 'Measured',
  weightDefinition: {
    surface: 'warm-edit developer actions while watch/dev compile runs on <private-app> (project/src)',
    formula:
      'Pre-norm percentage points: EditPrior_pp(editClass)×StratumShare for script leaves; EditPrior_pp alone for template/style/shared/config/lifecycle/build/messy/import; blocked=1.0pp reserved. Then L1-normalize positive weights to 100%.',
    editPriorsPercentagePoints: EDIT_PP,
    editPriorsSum: priorSum,
    stratumShares: {
      optionsOnly: +optShare.toFixed(6),
      setupNoMacro: +setupNoShare.toFixed(6),
      setupMacro: +setupMacShare.toFixed(6),
      other: +otherShare.toFixed(6),
      scriptBearing,
      emptyScript: C.emptyScript,
    },
  },
  census: {
    ...C,
    scriptBearing,
    mainPages: mainPages.length,
    subPackages: subPackages.length,
    subPages: subPageCount,
    routeTotal: mainPages.length + subPageCount,
    storeFiles,
    mixinFiles,
    pluginFiles,
    i18nFiles,
    utilJs,
    easycom: { autoscan: easycom.autoscan !== false, customKeys: Object.keys(easycom.custom || {}).length },
    totalFilesUnderSrc: allFiles.length,
  },
  leafCount: leaves.length,
  weightSum: +leaves.reduce((s, l) => s + l.weight, 0).toFixed(4),
  blockedWeight: +leaves.filter((l) => l.blocked).reduce((s, l) => s + l.weight, 0).toFixed(4),
  naLeafCount: leaves.filter((l) => l.na).length,
  leaves,
}

writeFileSync(join(OUT, 'exhaustive-taxonomy.json'), JSON.stringify(report, null, 2))
let md = `# Exhaustive taxonomy (Measured · <private-app>)\n\n`
md += `**When:** ${report.when} Asia/Shanghai · **weightSum=${report.weightSum}%** · **blockedWeight=${report.blockedWeight}%**\n\n`
md += `## Weight definition\n\n${report.weightDefinition.formula}\n\n`
md += `Surface: \`${report.weightDefinition.surface}\`\n\n`
md += `### Edit priors (percentage points, pre-norm, sum=${priorSum})\n\n| class | pp |\n|---|---:|\n`
for (const [k, v] of Object.entries(EDIT_PP)) md += `| ${k} | ${v} |\n`
md += `\n### Stratum (script-bearing=${scriptBearing})\n\n| stratum | n | share |\n|---|---:|---:|\n`
md += `| optionsOnly | ${C.optionsOnly} | ${(optShare * 100).toFixed(2)}% |\n`
md += `| setupNoMacro | ${C.setupNoMacro} | ${(setupNoShare * 100).toFixed(2)}% |\n`
md += `| setupMacro | ${C.setupMacro} | ${(setupMacShare * 100).toFixed(2)}% |\n`
md += `| other | ${C.other} | ${(otherShare * 100).toFixed(2)}% |\n`
md += `| emptyScript | ${C.emptyScript} | (edits → tpl/style) |\n`
md += `\n### Census\n\nvue **${C.totalVue}** · routes **${mainPages.length + subPageCount}** · subPackages **${subPackages.length}** · storeFiles **${storeFiles}** · mixinFiles **${mixinFiles}** · atAlias **${C.atAlias}** · noSemiHeavy **${C.noSemiHeavy}** · largeSetup **${C.largeSetup}** · langTs **${C.langTs}** · wxs **${C.wxs}** · easycom autoscan **${easycom.autoscan !== false}**\n\n`
md += `## Leaves\n\n| id | cat | weight% | note |\n|---|---|---:|---|\n`
for (const l of leaves) {
  md += `| \`${l.id}\` | ${l.category} | ${l.weight.toFixed(4)}${l.blocked ? ' BLOCKED' : ''}${l.na ? ' N/A' : ''} | ${String(l.censusNote).replace(/\|/g, '/')} |\n`
}
writeFileSync(join(OUT, 'EXHAUSTIVE-TAXONOMY.md'), md)
console.log(JSON.stringify({ leafCount: leaves.length, weightSum: report.weightSum, blockedWeight: report.blockedWeight, naLeafCount: report.naLeafCount, priorSum }, null, 2))
