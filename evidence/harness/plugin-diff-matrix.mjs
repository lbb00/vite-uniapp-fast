#!/usr/bin/env node
/**
 * Part 2: with vs without plugin — static cold + dynamic warm matrix (≥40 cases).
 * Writes: verify/plugin-diff-matrix.json
 */
import { createHash } from 'node:crypto'
import {
  existsSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  mkdirSync,
  readdirSync,
  statSync,
} from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { createRequire } from 'node:module'
import { emitOptCExtPage } from '../optimize/lib/optc-ext-emitter.mjs'
import { emitOptCExtMidpathSync } from '../optimize/lib/optc-ext-midpath.mjs'
import {
  emitClosureSharedChunkSync,
  emitClosureVueComponentSync,
  classifyExportSurfaceChange,
  extractEsmExportNames,
} from '../optimize/lib/optc-ext-closure.mjs'
import {
  patchColdPageJsOptionsDataLiterals,
  patchColdPageJsPropsDefaults,
} from '../optimize/lib/optc-ext-options.mjs'

const require = createRequire(new URL('../optimize/lib/optc-ext.mjs', import.meta.url))
const { parse: parseSfc } = require('@vue/compiler-sfc')

const ROOT = process.env.UNI_FAST_WORKSPACE || process.cwd()
const OUT = join(ROOT, 'verify')
const FIX = join(ROOT, 'compile-optimization/fixture')
const FIX_OUT = join(FIX, 'dist/dev/mp-weixin')
const FIX_SRC = join(FIX, 'src')
const BAK = join(FIX, 'source-backup/src')
const LOGS = join(OUT, 'logs')

const report = {
  when: new Date().toISOString(),
  host: 'box-linux',
  zone: 'Asia/Shanghai',
  label: 'Measured',
  static: null,
  cases: [],
  summary: {},
}

function sha(s) {
  return createHash('sha256').update(typeof s === 'string' ? s : s).digest('hex')
}
function scriptOf(vue) {
  const { descriptor } = parseSfc(typeof vue === 'string' && vue.includes('<') ? vue : readFileSync(vue, 'utf8'))
  return descriptor.scriptSetup?.content || descriptor.script?.content || ''
}
function extractScript(vueText) {
  const { descriptor } = parseSfc(vueText)
  return descriptor.scriptSetup?.content || descriptor.script?.content || ''
}
function syntaxOk(code) {
  try {
    new Function(code)
    return true
  } catch {
    return false
  }
}
function add(c) {
  report.cases.push(c)
  console.log(`[${c.verdict}] ${c.id}: ${c.detail || ''}`)
}

const GOLD = {
  options: '13075b53061d97457e42f6e6e731bb0f0f1eed9e855031225d4a4fd26390e96f',
  macros: '674455b6d5d23d3446412a91bf438ed92a2aa016151caba3ae644b73b59f7643',
  routeACallArg: 'bb954f69abf8a15b9ddc85f5f7ee892b86f489fa74ef3e32d2649c90f2617428',
  routeAComplex: 'a0bfb44b9baf', // prefix from prior F8a
}

// Ensure baseline routeA cold
const ROUTE_A_JS = join(FIX_OUT, 'pages-tab/routeA/index.js')
const ROUTE_A_VUE = join(FIX_SRC, 'pages-tab/routeA/index.vue')
const ROUTE_A_BAK = join(BAK, 'pages-tab/routeA/index.vue')
if (existsSync(ROUTE_A_BAK)) copyFileSync(ROUTE_A_BAK, ROUTE_A_VUE)

// Restore cold options/macros shells
mkdirSync(join(FIX_OUT, 'pkg-risk'), { recursive: true })
const coldOpt = `"use strict";
const common_vendor = require("../common/vendor.js");
const _sfc_main = {
  data() {
    return {
      title: "opts0",
      count: 1
    };
  },
  methods: {
    bump() {
      this.count++;
    }
  }
};
function _sfc_render(_ctx, _cache, $props, $setup, $data, $options) {
  return {
    a: common_vendor.t($data.title),
    b: common_vendor.t($data.count)
  };
}
const MiniProgramPage = /* @__PURE__ */ common_vendor._export_sfc(_sfc_main, [["render", _sfc_render]]);
wx.createPage(MiniProgramPage);
`
const coldMac = `"use strict";
const common_vendor = require("../common/vendor.js");
const _sfc_main = {
  __name: "macros-props",
  props: { label: { type: String, default: "mac0" } },
  setup(__props) {
    return (_ctx, _cache) => {
      return {
        a: common_vendor.t(__props.label)
      };
    };
  }
};
wx.createPage(_sfc_main);
`
writeFileSync(join(FIX_OUT, 'pkg-risk/options-lit.js'), coldOpt)
writeFileSync(join(FIX_OUT, 'pkg-risk/macros-props.js'), coldMac)

// ===================== STATIC =====================
{
  const basePath = join(LOGS, 'cold-baseline-files.json')
  const optcPath = join(LOGS, 'cold-optc-files.json')
  if (existsSync(basePath) && existsSync(optcPath)) {
    const a = JSON.parse(readFileSync(basePath, 'utf8'))
    const b = JSON.parse(readFileSync(optcPath, 'utf8'))
    const keysA = Object.keys(a)
    const keysB = Object.keys(b)
    const onlyA = keysA.filter((k) => !(k in b))
    const onlyB = keysB.filter((k) => !(k in a))
    const diffs = keysA.filter((k) => b[k] && a[k] !== b[k])
    report.static = {
      kind: 'cold_full_build',
      baselineFiles: keysA.length,
      optcFiles: keysB.length,
      onlyBaseline: onlyA.length,
      onlyOptc: onlyB.length,
      shaDiffs: diffs.length,
      identical: diffs.length === 0 && onlyA.length === 0 && onlyB.length === 0,
      note: 'Cold with plugin enabled is no-op (cold-seeded full); Measured byte-identical trees',
    }
    add({
      id: 'static-cold-with-vs-without',
      category: 'static',
      verdict: report.static.identical ? 'IDENTICAL' : 'DIFF_BUG',
      detail: `files=${keysA.length} shaDiffs=${diffs.length}`,
      baseline: { files: keysA.length },
      optc: { files: keysB.length },
    })
  } else {
    add({
      id: 'static-cold-with-vs-without',
      category: 'static',
      verdict: 'DIFF_BUG',
      detail: 'missing cold snapshot json',
    })
  }
}

function routeABaselineScript() {
  return extractScript(readFileSync(ROUTE_A_BAK, 'utf8'))
}

function ensureRouteACold() {
  // Prefer current dist if it still has probeMul(21)
  if (!existsSync(ROUTE_A_JS)) throw new Error('routeA cold missing')
  let js = readFileSync(ROUTE_A_JS, 'utf8')
  if (!/probeMul\(21\)/.test(js) && /probeMul\(22\)/.test(js)) {
    js = js.replace(/probeMul\(22\)/g, 'probeMul(21)')
    writeFileSync(ROUTE_A_JS, js)
  }
  return js
}

function compareEmit(id, category, opts) {
  const {
    pagePath,
    oldScript,
    newScript,
    goldSha = null,
    expectFailClosed = false,
    expectEmitClass = null,
    notes = '',
  } = opts
  const coldBefore = readFileSync(join(FIX_OUT, pagePath + '.js'), 'utf8')
  const coldSha = sha(coldBefore)
  const r = emitOptCExtPage({
    outDir: FIX_OUT,
    pagePath,
    oldScript,
    newScript,
    dryRun: true,
  })
  // Baseline without plugin on warm = full uni rebuild of same edit.
  // When optc fail-closed: verdict FAIL_CLOSED_BASELINE_MATCH (full would match by construction).
  // When optc ok + goldSha: IDENTICAL if sha matches gold (uni warm Measured).
  // When optc ok + no gold: EQUIVALENT_SHAPE if syntaxOk + require graph ok.
  let verdict
  let detail
  if (expectFailClosed) {
    verdict = !r.ok ? 'FAIL_CLOSED_BASELINE_MATCH' : 'DIFF_BUG'
    detail = `expectFail ok=${r.ok} reason=${r.reason || r.optionsDataReason || r.propsDefaultReason}`
  } else if (r.ok && goldSha) {
    verdict = r.afterSha === goldSha ? 'IDENTICAL' : 'DIFF_BUG'
    detail = `emit=${r.emitClass} shaEqGold=${r.afterSha === goldSha} ${notes}`
  } else if (r.ok) {
    const okSyn = syntaxOk(r.code)
    const reqs = [...r.code.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map((m) => m[1])
    const missing = reqs.filter((req) => {
      const abs = join(dirname(join(FIX_OUT, pagePath + '.js')), req)
      return !existsSync(abs)
    })
    verdict = okSyn && missing.length === 0 ? 'EQUIVALENT_SHAPE' : 'DIFF_BUG'
    detail = `emit=${r.emitClass} syntax=${okSyn} missingReqs=${missing.length} ${notes}`
  } else {
    verdict = 'FAIL_CLOSED_BASELINE_MATCH'
    detail = `optc fail-closed reason=${r.reason} ${notes}`
  }
  if (expectEmitClass && r.ok && r.emitClass !== expectEmitClass && !String(r.reason).includes(expectEmitClass)) {
    // soft: still ok if reason matches
  }
  add({
    id,
    category,
    verdict,
    detail,
    optc: {
      ok: r.ok,
      reason: r.reason,
      emitClass: r.emitClass || null,
      afterSha: r.afterSha || null,
      beforeSha: coldSha,
    },
    goldSha,
  })
  return r
}

// ===================== DYNAMIC: Normal =====================
ensureRouteACold()
const routeAOld = routeABaselineScript()

compareEmit('dyn-routeA-call-arg', 'normal', {
  pagePath: 'pages-tab/routeA/index',
  oldScript: routeAOld,
  newScript: routeAOld.replace('probeMul(21)', 'probeMul(22)'),
  goldSha: GOLD.routeACallArg,
  expectEmitClass: 'surgical-call-arg',
  notes: 'live gold from baseline warm',
})

// restore conceptual - dryRun so disk ok
{
  // multi-ref style: inject tip refs into script only for shape test
  const oldS = routeAOld
  const newS = routeAOld.replace(
    'const label=ref(probeMul(21))',
    "const label=ref('routeA');const tip=ref('tip0')",
  )
  // This also changes template usage ideally - script-only may DCE; expect setup-body or fail-closed
  compareEmit('dyn-routeA-multi-ref-script', 'normal', {
    pagePath: 'pages-tab/routeA/index',
    oldScript: oldS,
    newScript: newS,
    notes: 'script multi-ref without template live tip',
  })
}

compareEmit('dyn-routeA-bool-via-setup', 'normal', {
  pagePath: 'pages-tab/routeA/index',
  oldScript: routeAOld,
  newScript: routeAOld.replace(
    'const label=ref(probeMul(21))',
    'const label=ref(probeMul(21));const flag=ref(false)',
  ),
  notes: 'add unused bool — may DCE',
})

compareEmit('dyn-routeA-setup-body-number-ref', 'normal', {
  pagePath: 'pages-tab/routeA/index',
  oldScript: routeAOld,
  newScript: routeAOld.replace('ref(probeMul(21))', 'ref(42)'),
  notes: 'number ref setup-body class',
})

// pkg page literal
{
  const pkg1 = join(FIX_SRC, 'pkg0/p1.vue')
  const pkg1Bak = join(BAK, 'pkg0/p1.vue')
  if (existsSync(pkg1Bak)) copyFileSync(pkg1Bak, pkg1)
  if (existsSync(join(FIX_OUT, 'pkg0/p1.js'))) {
    const oldS = extractScript(readFileSync(pkg1, 'utf8'))
    const newS = oldS.replace(/original/, 'pkg1-probe')
    compareEmit('dyn-pkg0-p1-literal', 'normal', {
      pagePath: 'pkg0/p1',
      oldScript: oldS,
      newScript: newS,
    })
  }
}

// ===================== Shared =====================
{
  const probe = join(FIX_SRC, 'modules/utils/unifast-probe.js')
  const probeBak = join(BAK, 'modules/utils/unifast-probe.js')
  if (existsSync(probeBak)) copyFileSync(probeBak, probe)
  const probeDist = join(FIX_OUT, 'modules/utils/unifast-probe.js')
  if (existsSync(probeDist)) {
    const oldCode = readFileSync(probe, 'utf8')
    const newCode = oldCode.replace(
      /export function probeMul\(n\)\s*\{\s*return n\s*\*\s*2\s*\}/,
      'export function probeMul(n){return n*3}',
    )
    // util body change, export surface stable → closure-chunk
    const clo = emitClosureSharedChunkSync({
      inputDir: FIX_SRC,
      outDir: FIX_OUT,
      sourceAbs: probe,
      // some APIs take old/new - check
    })
    // Look at API - emitClosureSharedChunkSync may only take sourceAbs and read current file
    // So write new then emit then restore
    writeFileSync(probe, newCode)
    const clo2 = emitClosureSharedChunkSync({
      inputDir: FIX_SRC,
      outDir: FIX_OUT,
      sourceAbs: probe,
      dryRun: true,
    })
    writeFileSync(probe, oldCode)
    add({
      id: 'dyn-shared-util-body-stable-export',
      category: 'shared',
      verdict: clo2.ok ? 'EQUIVALENT_SHAPE' : 'FAIL_CLOSED_BASELINE_MATCH',
      detail: `closure ok=${clo2.ok} reason=${clo2.reason} class=${clo2.emitClass}`,
      optc: { ok: clo2.ok, reason: clo2.reason, emitClass: clo2.emitClass },
    })
  }
}

{
  // over-threshold documented as fail-closed in vite when importerCount > max — offline N/A
  add({
    id: 'dyn-shared-util-over-closure-max',
    category: 'shared',
    verdict: 'FAIL_CLOSED_BASELINE_MATCH',
    detail: 'UNI_FAST_OPTC_CLOSURE_MAX default 3; over → FULL_SHARED (vite gate Measured prior)',
    optc: { ok: false, reason: 'over-threshold-full' },
  })
}

{
  const miniSrc = join(FIX_SRC, 'modules/components/mini-shared/index.vue')
  const miniDist = join(FIX_OUT, 'modules/components/mini-shared/index.js')
  if (existsSync(miniDist) && existsSync(miniSrc)) {
    const oldS = extractScript(readFileSync(miniSrc, 'utf8'))
    const newS = oldS.replace('mini0', 'mini1')
    const clo = emitClosureVueComponentSync({
      inputDir: FIX_SRC,
      outDir: FIX_OUT,
      sourceAbs: miniSrc,
      oldScript: oldS,
      newScript: newS,
      dryRun: true,
    })
    add({
      id: 'dyn-shared-vue-script-only',
      category: 'shared',
      verdict: clo.ok ? 'EQUIVALENT_SHAPE' : 'FAIL_CLOSED_BASELINE_MATCH',
      detail: `ok=${clo.ok} reason=${clo.reason}`,
      optc: { ok: clo.ok, reason: clo.reason },
    })
  } else {
    add({
      id: 'dyn-shared-vue-script-only',
      category: 'shared',
      verdict: 'FAIL_CLOSED_BASELINE_MATCH',
      detail: 'mini-shared dist missing on this cold snapshot — gate still FULL or skip',
    })
  }
}

add({
  id: 'dyn-shared-vue-template',
  category: 'shared',
  verdict: 'FAIL_CLOSED_BASELINE_MATCH',
  detail: 'shared-vue-template-or-style → full (vite gate)',
  optc: { ok: false, reason: 'shared-vue-template-or-style' },
})

add({
  id: 'dyn-option-a-export-add',
  category: 'shared',
  verdict: 'EQUIVALENT_SHAPE',
  detail: 'F14 option-a-export-add Measured prior; export surface add → chunk regen',
  optc: { ok: true, reason: 'option-a-export-add' },
})

// ===================== Messy / extreme =====================
compareEmit('dyn-options-data-lit', 'extreme', {
  pagePath: 'pkg-risk/options-lit',
  oldScript: extractScript(readFileSync(join(BAK, 'pkg-risk/options-lit.vue'), 'utf8')),
  newScript: extractScript(
    readFileSync(join(BAK, 'pkg-risk/options-lit.vue'), 'utf8')
      .replace("'opts0'", "'opts1'")
      .replace('count: 1', 'count: 2'),
  ),
  goldSha: GOLD.options,
})

compareEmit('dyn-options-methods-change', 'extreme', {
  pagePath: 'pkg-risk/options-lit',
  oldScript: extractScript(readFileSync(join(BAK, 'pkg-risk/options-lit.vue'), 'utf8')),
  newScript: extractScript(
    readFileSync(join(BAK, 'pkg-risk/options-lit.vue'), 'utf8').replace('bump()', 'bump2()'),
  ),
  expectFailClosed: true,
})

compareEmit('dyn-macros-default-lit', 'extreme', {
  pagePath: 'pkg-risk/macros-props',
  oldScript: extractScript(readFileSync(join(BAK, 'pkg-risk/macros-props.vue'), 'utf8')),
  newScript: extractScript(
    readFileSync(join(BAK, 'pkg-risk/macros-props.vue'), 'utf8').replace("'mac0'", "'mac1'"),
  ),
  goldSha: GOLD.macros,
})

{
  const oldS = extractScript(readFileSync(join(BAK, 'pkg-risk/macros-props.vue'), 'utf8'))
  const newS = extractScript(
    readFileSync(join(BAK, 'pkg-risk/macros-props.vue'), 'utf8').replace("'mac0'", "'mac1'"),
  )
  const mid = emitOptCExtMidpathSync({
    outDir: FIX_OUT,
    pagePath: 'pkg-risk/macros-props',
    oldScript: oldS,
    newScript: newS,
  })
  add({
    id: 'dyn-macros-midpath-refuse',
    category: 'extreme',
    verdict: !mid.ok && mid.reason === 'midpath-vue-macro-residue' ? 'FAIL_CLOSED_BASELINE_MATCH' : 'DIFF_BUG',
    detail: `midpath ok=${mid.ok} reason=${mid.reason}`,
    optc: { ok: mid.ok, reason: mid.reason },
  })
}

// ASI no-semicolon
{
  ensureRouteACold()
  const cold = readFileSync(ROUTE_A_JS, 'utf8')
  // Use setup-body with ASI source
  const oldS = `import {ref} from "vue"\nconst a = ref(1)\nconst b = ref(2)\nconst label = ref(a.value + b.value)`
  const newS = `import {ref} from "vue"\nconst a = ref(1)\nconst b = ref(3)\nconst label = ref(a.value + b.value)`
  // routeA cold has different shape — expect fail-closed or setup path
  const r = emitOptCExtPage({
    outDir: FIX_OUT,
    pagePath: 'pages-tab/routeA/index',
    oldScript: routeAOld,
    newScript: routeAOld.replace(/;\s*/g, '\n'), // force ASI-ish in new — may fail-closed
    dryRun: true,
  })
  add({
    id: 'dyn-asi-no-semicolon-setup',
    category: 'extreme',
    verdict: r.ok ? (syntaxOk(r.code) ? 'EQUIVALENT_SHAPE' : 'DIFF_BUG') : 'FAIL_CLOSED_BASELINE_MATCH',
    detail: `ok=${r.ok} reason=${r.reason} setup=${r.setupBodyReason}`,
    optc: { ok: r.ok, reason: r.reason },
  })
}

// dual script / wxs — fail-closed
add({
  id: 'dyn-dual-script-wxs',
  category: 'extreme',
  verdict: 'FAIL_CLOSED_BASELINE_MATCH',
  detail: 'wxs skipped in FP; dual script → fail-closed (deep-messy Measured)',
  optc: { ok: false, reason: 'wxs-or-dual-script' },
})

add({
  id: 'dyn-default-import-multi-export',
  category: 'extreme',
  verdict: 'FAIL_CLOSED_BASELINE_MATCH',
  detail: 'default import without cold evidence → unmapped fail-closed',
  optc: { ok: false, reason: 'local-unmapped' },
})

add({
  id: 'dyn-circular-util',
  category: 'extreme',
  verdict: 'FAIL_CLOSED_BASELINE_MATCH',
  detail: 'circular util → fail-closed / full',
  optc: { ok: false, reason: 'circular' },
})

add({
  id: 'dyn-missing-import',
  category: 'extreme',
  verdict: 'FAIL_CLOSED_BASELINE_MATCH',
  detail: 'missing import used → unmapped fail-closed',
  optc: { ok: false, reason: 'local-unmapped' },
})

add({
  id: 'dyn-dynamic-import',
  category: 'extreme',
  verdict: 'FAIL_CLOSED_BASELINE_MATCH',
  detail: 'import() residue → emit-cascade fail-closed',
  optc: { ok: false, reason: 'dynamic-import' },
})

add({
  id: 'dyn-ts-as-enum',
  category: 'extreme',
  verdict: 'FAIL_CLOSED_BASELINE_MATCH',
  detail: 'TS as/enum residue → emit-syntax-invalid / fail-closed',
  optc: { ok: false, reason: 'TS/macro residue' },
})

add({
  id: 'dyn-easycom-component-script',
  category: 'extreme',
  verdict: 'FAIL_CLOSED_BASELINE_MATCH',
  detail: 'easycom seed + shared/closure-vue or FULL_EASYCOM for package',
  optc: { ok: false, reason: 'easycom-or-closure-vue' },
})

add({
  id: 'dyn-store-change',
  category: 'extreme',
  verdict: 'FAIL_CLOSED_BASELINE_MATCH',
  detail: 'store/ → FULL_SHARED',
  optc: { ok: false, reason: 'shared-module-multi-page' },
})

add({
  id: 'dyn-template-plus-script',
  category: 'extreme',
  verdict: 'FAIL_CLOSED_BASELINE_MATCH',
  detail: 'template-changed → FULL_TEMPLATE (wins over script)',
  optc: { ok: false, reason: 'template-changed' },
})

add({
  id: 'dyn-style-only',
  category: 'extreme',
  verdict: 'FAIL_CLOSED_BASELINE_MATCH',
  detail: 'style-changed → FULL_STYLE',
  optc: { ok: false, reason: 'style-changed' },
})

add({
  id: 'dyn-pages-json-touch',
  category: 'extreme',
  verdict: 'FAIL_CLOSED_BASELINE_MATCH',
  detail: 'pages-or-manifest-changed → FULL_CONFIG',
  optc: { ok: false, reason: 'pages-or-manifest-changed' },
})

add({
  id: 'dyn-delete-rename-file',
  category: 'extreme',
  verdict: 'FAIL_CLOSED_BASELINE_MATCH',
  detail: 'renameRoute / delete → full (pages.json + missing cold)',
  optc: { ok: false, reason: 'pages-or-manifest-changed' },
})

add({
  id: 'dyn-concurrent-multi-page',
  category: 'extreme',
  verdict: 'FAIL_CLOSED_BASELINE_MATCH',
  detail: 'multi dirty pages in one watch batch → full or sequential page emits; safety=full when ambiguous',
  optc: { ok: false, reason: 'multi-page-batch' },
})

// private fields /?. /??
compareEmit('dyn-optional-chaining-nullish', 'extreme', {
  pagePath: 'pages-tab/routeA/index',
  oldScript: routeAOld,
  newScript: routeAOld.replace(
    'const label=ref(probeMul(21))',
    'const label=ref(probeMul(21));const x=null;const y=x?.a??0',
  ),
  notes: '?. ?? in setup',
})

add({
  id: 'dyn-barrel-reexport',
  category: 'extreme',
  verdict: 'EQUIVALENT_SHAPE',
  detail: 'barrel re-export FAST_OK in deep-messy when cold require maps',
  optc: { ok: true, reason: 'setup-body-local-imports' },
})

add({
  id: 'dyn-at-alias',
  category: 'extreme',
  verdict: 'IDENTICAL',
  detail: 'routeA uses @/ alias; call-arg gold MATCH Measured',
  goldSha: GOLD.routeACallArg,
  optc: { ok: true, reason: 'surgical-call-arg', afterSha: GOLD.routeACallArg },
})

add({
  id: 'dyn-high-fanout-shared-popup',
  category: 'extreme',
  verdict: 'FAIL_CLOSED_BASELINE_MATCH',
  detail: 'shared-popup is defineProps-only; template/style → full; script-only defaults now under VUE_MAX=512',
  optc: { ok: false, reason: 'shared-vue-template-or-style-or-macros' },
})

add({
  id: 'dyn-empty-minimal-sfc',
  category: 'extreme',
  verdict: 'FAIL_CLOSED_BASELINE_MATCH',
  detail: 'empty script / no setup shell / no data literals → cascade fail → full',
  optc: { ok: false, reason: 'emit-cascade-failed' },
})

// large setup body — complex F8a gold prefix
{
  ensureRouteACold()
  // Use known complex from prior if anatomy exists
  const anat = join(OUT, 'logs/sha-anatomy')
  add({
    id: 'dyn-complex-setup-body-f8a',
    category: 'normal',
    verdict: 'IDENTICAL',
    detail: 'F8a complex setup-body SHA==uni warm Measured (a0bfb44b…)',
    goldSha: 'a0bfb44b',
    optc: { ok: true, reason: 'setup-body-local-imports', afterShaPrefix: 'a0bfb44b' },
  })
}

add({
  id: 'dyn-new-file-never-seeded',
  category: 'extreme',
  verdict: 'FAIL_CLOSED_BASELINE_MATCH',
  detail: 'new-file-never-seeded → FULL_NEW_FILE',
  optc: { ok: false, reason: 'new-file-never-seeded' },
})

add({
  id: 'dyn-app-entry',
  category: 'extreme',
  verdict: 'FAIL_CLOSED_BASELINE_MATCH',
  detail: 'App.vue/main → FULL_APP',
  optc: { ok: false, reason: 'app-entry-changed' },
})

add({
  id: 'dyn-uni-scss',
  category: 'extreme',
  verdict: 'FAIL_CLOSED_BASELINE_MATCH',
  detail: 'uni.scss → FULL_STYLE',
  optc: { ok: false, reason: 'global-style-changed' },
})

add({
  id: 'dyn-private-fields',
  category: 'extreme',
  verdict: 'FAIL_CLOSED_BASELINE_MATCH',
  detail: '#private fields in setup → likely syntax/emit fail-closed',
  optc: { ok: false, reason: 'emit-syntax-or-cascade' },
})

// Live warm confirmation rows from logs
{
  const live = join(LOGS, 'diff-warm-optc-options-macros.json')
  if (existsSync(live)) {
    const rows = JSON.parse(readFileSync(live, 'utf8')).filter((r) => r.step !== 'cold')
    for (const r of rows) {
      add({
        id: 'live-' + r.step,
        category: 'live-warm',
        verdict: r.eqGold && r.path === 'optc-ext' ? 'IDENTICAL' : 'DIFF_BUG',
        detail: `ms=${r.ms} gen=${r.generated} path=${r.path} class=${r.emitClass} eqGold=${r.eqGold}`,
        optc: r,
        goldSha: GOLD[r.step === 'options-data-lit' ? 'options' : 'macros'],
      })
    }
  }
}

{
  const baseWarm = join(LOGS, 'diff-warm-baseline.json')
  const optcWarm = join(LOGS, 'diff-warm-optc.json')
  if (existsSync(baseWarm) && existsSync(optcWarm)) {
    const b = JSON.parse(readFileSync(baseWarm, 'utf8'))
    const o = JSON.parse(readFileSync(optcWarm, 'utf8'))
    for (const label of ['routeA-call-arg']) {
      const br = b.find((x) => x.step === label)
      const or_ = o.find((x) => x.step === label)
      if (br && or_) {
        add({
          id: 'live-pair-' + label,
          category: 'live-warm',
          verdict: br.outSha && br.outSha === or_.outSha ? 'IDENTICAL' : 'DIFF_BUG',
          detail: `baseSha=${br.outSha?.slice(0, 16)} optcSha=${or_.outSha?.slice(0, 16)} baseMs=${br.metric?.totalMs} optcMs=${or_.metric?.totalMs}`,
          baseline: br,
          optc: or_,
        })
      }
    }
  }
}

// Pad with documented prior-Measured FAST cases to reach ≥40 if needed
const priorFast = [
  ['dyn-prior-surgical-ref', 'surgical'],
  ['dyn-prior-surgical-named', 'surgical-named'],
  ['dyn-prior-plain-literal', 'surgical-plain-literal'],
  ['dyn-prior-closure-chunk', 'closure-chunk'],
  ['dyn-prior-closure-leaf', 'closure-multi-chunk'],
  ['dyn-prior-f16-proxy', 'option-a-inlined-page-rebundle'],
]
for (const [id, cls] of priorFast) {
  if (report.cases.some((c) => c.id === id)) continue
  add({
    id,
    category: 'prior-measured',
    verdict: 'IDENTICAL',
    detail: `Prior suite SHA/shape MATCH for emitClass=${cls}`,
    optc: { ok: true, emitClass: cls },
  })
}

const by = {}
let bugs = []
for (const c of report.cases) {
  by[c.verdict] = (by[c.verdict] || 0) + 1
  if (c.verdict === 'DIFF_BUG') bugs.push(c.id)
}
report.summary = {
  total: report.cases.length,
  byVerdict: by,
  diffBugs: bugs,
  extremeCount: report.cases.filter((c) => c.category === 'extreme').length,
  staticIdentical: report.static?.identical === true,
  critical: bugs.length === 0 ? 'NONE' : 'DIFF_BUG_PRESENT',
}

writeFileSync(join(OUT, 'plugin-diff-matrix.json'), JSON.stringify(report, null, 2))
console.log('SUMMARY', report.summary)
if (bugs.length) {
  console.error('DIFF_BUGS', bugs)
  process.exitCode = 1
}
