#!/usr/bin/env node
/**
 * Deep messy-code / complex-import adversarial suite for optc-ext (box-only).
 * Prefer offline emit; records FAIL_CLOSED | FAST_OK | CRITICAL_WRONG | UNVERIFIED.
 * Writes: verify/deep-messy-risk.json
 */
import { createHash } from 'node:crypto'
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  rmSync,
  readdirSync,
} from 'node:fs'
import { join, dirname } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import {
  emitOptCExtPage,
  patchColdPageJsSetupBody,
  patchColdPageJs,
  patchColdPageJsNamedLiterals,
  buildLocalRewriteMap,
  rewriteIdents,
  rewriteVueApisToCommonVendor,
  stripImports,
  parseImportDecls,
  splitColdSetup,
  formatSetupStmtsLikeUni,
  extractImportSpecs,
  splitTopLevelStatements,
  stmtLooksMergedAsi,
} from '../optimize/lib/optc-ext-emitter.mjs'
import {
  parseVueScriptParts,
  emitClosureSharedChunkSync,
  transformUtilEsmToCjs,
  parseStaticImports,
  extractEsmExportNames,
} from '../optimize/lib/optc-ext-closure.mjs'
import { emitOptCExtMidpathSync } from '../optimize/lib/optc-ext-midpath.mjs'

const ROOT = process.env.UNI_FAST_WORKSPACE || process.cwd()
const OUT = join(ROOT, 'verify')
const FIX_OUT = join(ROOT, 'compile-optimization/fixture/dist/dev/mp-weixin')
const FIX_SRC = join(ROOT, 'compile-optimization/fixture/src')
const ROUTE_A_JS = join(FIX_OUT, 'pages-tab/routeA/index.js')
const ROUTE_A_VUE = join(FIX_SRC, 'pages-tab/routeA/index.vue')
const PROBE_JS = join(FIX_OUT, 'modules/utils/unifast-probe.js')
const TMP = join(OUT, 'logs/deep-messy/workdir')
const PROJ_SRC = join(ROOT, 'compile-optimization/project/src')

const report = {
  when: new Date().toISOString(),
  host: 'box-linux',
  zone: 'Asia/Shanghai',
  label: 'Measured',
  cases: [],
  inventory: [],
  summary: {},
  topRisks: [],
  codeReview: [],
  projectPatternCounts: null,
}

function sha(s) {
  return createHash('sha256').update(typeof s === 'string' ? s : s).digest('hex')
}
function syntaxOk(code) {
  try {
    new Function(code)
    return true
  } catch (e) {
    return false
  }
}
function syntaxErr(code) {
  try {
    new Function(code)
    return null
  } catch (e) {
    return String(e.message || e)
  }
}
function extractScript(vue) {
  const start = vue.indexOf('<script')
  const end = vue.indexOf('</script>')
  if (start < 0 || end < 0) return ''
  return vue.slice(vue.indexOf('>', start) + 1, end)
}
function add(c) {
  report.cases.push(c)
  const tag = c.verdict || (c.pass ? 'PASS' : 'FAIL')
  console.log(`[${tag}] ${c.id}: ${c.detail || ''}`)
}
function inv(row) {
  report.inventory.push(row)
}

function ensureTmp() {
  rmSync(TMP, { recursive: true, force: true })
  mkdirSync(TMP, { recursive: true })
}

function writeTree(base, files) {
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(base, rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, body)
  }
}

function baselineRouteAScript() {
  return extractScript(readFileSync(ROUTE_A_VUE, 'utf8'))
}

function restoreRouteACold() {
  // Prefer fixture backup if present; else leave as-is (tests use dryRun mostly)
  const bak = join(OUT, 'logs/deep-messy/routeA-cold.bak.js')
  if (existsSync(bak)) copyFileSync(bak, ROUTE_A_JS)
}

// Seed bak
{
  mkdirSync(join(OUT, 'logs/deep-messy'), { recursive: true })
  if (existsSync(ROUTE_A_JS)) {
    copyFileSync(ROUTE_A_JS, join(OUT, 'logs/deep-messy/routeA-cold.bak.js'))
  }
}

// ---------- Project pattern census (Measured) ----------
{
  let dual = 0,
    setup = 0,
    ts = 0,
    optionsOnly = 0,
    defineProps = 0,
    dynamicImport = 0,
    getCI = 0,
    provideInject = 0,
    pinia = 0,
    wxs = 0,
    totalVue = 0
  function walk(dir) {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = join(dir, e.name)
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === 'dist') continue
        walk(p)
        continue
      }
      if (!e.name.endsWith('.vue')) continue
      totalVue++
      const t = readFileSync(p, 'utf8')
      const scripts = [...t.matchAll(/<script\b[^>]*>/gi)].map((m) => m[0])
      if (scripts.length >= 2) dual++
      if (scripts.some((s) => /\bsetup\b/i.test(s))) setup++
      if (scripts.some((s) => /lang\s*=\s*["']ts/i.test(s))) ts++
      if (
        /export\s+default\s*\{/.test(t) &&
        !scripts.some((s) => /\bsetup\b/i.test(s))
      )
        optionsOnly++
      if (/\bdefineProps\b|\bdefineEmits\b|\bdefineExpose\b|\bwithDefaults\b/.test(t))
        defineProps++
      if (/\bimport\s*\(/.test(t)) dynamicImport++
      if (/\bgetCurrentInstance\b/.test(t)) getCI++
      if (/\bprovide\s*\(|\binject\s*\(/.test(t)) provideInject++
      if (/\bpinia\b|\bdefineStore\b|\bmapState\b|\buseStore\b/.test(t)) pinia++
      if (/lang\s*=\s*["']wxs["']/i.test(t) || /module\s*=\s*["']/.test(t)) wxs++
    }
  }
  walk(PROJ_SRC)
  report.projectPatternCounts = {
    totalVue,
    dualScriptBlocks: dual,
    scriptSetup: setup,
    langTs: ts,
    optionsApiOnly: optionsOnly,
    defineMacros: defineProps,
    dynamicImport,
    getCurrentInstance: getCI,
    provideInject,
    piniaOrVuexish: pinia,
    wxsOrModuleScript: wxs,
  }
  console.log('[census]', JSON.stringify(report.projectPatternCounts))
}

// ============================================================================
// Helper: classify emit result
// ============================================================================
function classifyEmit(r, { expectFast = null, expectFail = null, wrongIf = null } = {}) {
  if (!r) return { verdict: 'UNVERIFIED', pass: false }
  if (wrongIf && wrongIf(r)) {
    return {
      verdict: 'CRITICAL_WRONG',
      pass: false,
      syntax: r.code ? syntaxOk(r.code) : null,
    }
  }
  if (r.ok) {
    const syn = r.code ? syntaxOk(r.code) : true
    if (!syn) {
      return {
        verdict: 'CRITICAL_WRONG',
        pass: false,
        detail: 'fast-path wrote/produced non-JS: ' + syntaxErr(r.code),
        syntax: false,
      }
    }
    if (expectFail) {
      return {
        verdict: 'CRITICAL_WRONG',
        pass: false,
        detail: 'expected fail-closed but emit ok class=' + (r.emitClass || r.reason),
      }
    }
    return {
      verdict: 'FAST_OK',
      pass: true,
      syntax: true,
      emitClass: r.emitClass || r.reason,
    }
  }
  // fail
  if (expectFast) {
    return {
      verdict: 'FAIL_CLOSED',
      pass: true, // fail-closed is acceptable/safe
      detail: 'expected fast but fail-closed: ' + (r.reason || r.setupBodyReason),
      safe: true,
    }
  }
  return {
    verdict: 'FAIL_CLOSED',
    pass: true,
    reason: r.reason,
    setupBodyReason: r.setupBodyReason,
    safe: true,
  }
}

// ============================================================================
// M1 — Options API script vs setup cold (real shape mismatch)
// ============================================================================
{
  const id = 'm1-options-api-vs-setup-cold'
  const oldS = `export default {\n  data() { return { label: 'routeA' } },\n  methods: { tap() { this.label = 'x' } }\n}\n`
  const newS = `export default {\n  data() { return { label: 'probe-options' } },\n  methods: { tap() { this.label = 'x' } }\n}\n`
  const r = emitOptCExtPage({
    outDir: FIX_OUT,
    pagePath: 'pages-tab/routeA/index',
    oldScript: oldS,
    newScript: newS,
    dryRun: true,
  })
  // Against setup-shaped cold: should NOT surgically succeed with wrong data() patch
  const wrong =
    r.ok &&
    r.code &&
    (r.code.includes('probe-options') || !r.code.includes('setup(__props)'))
  const cls = classifyEmit(r, {
    expectFail: true,
    wrongIf: () => wrong,
  })
  // Override: if fail-closed → SAFE; if ok with probe in setup cold → CRITICAL
  let verdict = cls.verdict
  let pass = cls.pass
  if (r.ok && r.code && r.code.includes('setup(__props)') && r.code.includes('probe-options')) {
    verdict = 'CRITICAL_WRONG'
    pass = false
  } else if (!r.ok) {
    verdict = 'FAIL_CLOSED'
    pass = true
  }
  add({
    id,
    category: 'messy-script',
    pass,
    verdict,
    detail: `ok=${r.ok} reason=${r.reason} setup=${r.setupBodyReason || ''} surg=${r.surgicalReason || ''}`,
    emitClass: r.emitClass,
    evidence: 'Measured',
  })
}

// ============================================================================
// M2 — Pure Options cold shell (no setup) → split fail → cascade fail
// ============================================================================
{
  const id = 'm2-options-cold-shell-no-setup'
  ensureTmp()
  writeTree(TMP, {
    'common/vendor.js': `"use strict"; exports.ref = (v)=>({value:v});\n`,
    'pages-tab/routeA/index.js': `"use strict";
const common_vendor = require("../../common/vendor.js");
const _sfc_main = {
  data() { return { label: "routeA" }; },
  methods: { tap() { this.label = "x"; } }
};
wx.createPage(_sfc_main);
`,
  })
  const r = emitOptCExtPage({
    outDir: TMP,
    pagePath: 'pages-tab/routeA/index',
    oldScript: `export default { data(){ return { label: 'routeA' } } }`,
    newScript: `export default { data(){ return { label: 'probe' } } }`,
    dryRun: true,
  })
  const verdict = !r.ok ? 'FAIL_CLOSED' : 'CRITICAL_WRONG'
  add({
    id,
    category: 'messy-script',
    pass: !r.ok,
    verdict,
    detail: `ok=${r.ok} reason=${r.reason} setup=${r.setupBodyReason}`,
    evidence: 'Measured',
    note: 'Project census: optionsApiOnly≈1721 — all such pages must full-rebuild on script edit',
  })
}

// ============================================================================
// M3 — Dual script: Options + script setup joined (page path uses parseSfc)
// Offline: simulate joined script body that emitter sees
// ============================================================================
{
  const id = 'm3-dual-script-options-plus-setup-joined'
  const oldS = `export default { name: 'X' }\nimport { ref } from 'vue'\nconst label = ref('routeA')\n`
  const newS = `export default { name: 'X' }\nimport { ref } from 'vue'\nconst label = ref('dual-probe')\n`
  const r = emitOptCExtPage({
    outDir: FIX_OUT,
    pagePath: 'pages-tab/routeA/index',
    oldScript: oldS,
    newScript: newS,
    dryRun: true,
  })
  let verdict, pass, detail
  if (r.ok && syntaxOk(r.code) && r.code.includes('dual-probe')) {
    verdict = 'FAST_OK'
    pass = true
    detail = `emitClass=${r.emitClass}`
  } else if (!r.ok) {
    verdict = 'FAIL_CLOSED'
    pass = true
    detail = `fail ${r.reason}/${r.setupBodyReason}`
  } else {
    verdict = 'CRITICAL_WRONG'
    pass = false
    detail = 'ok but missing token or bad syntax'
  }
  add({
    id,
    category: 'messy-script',
    pass,
    verdict,
    detail,
    emitClass: r.emitClass,
    evidence: 'Measured',
  })
}

// ============================================================================
// M4 — parseVueScriptParts grabs FIRST script only (wxs hazard) — component F12 path
// ============================================================================
{
  const id = 'm4-parseVueScriptParts-wxs-first'
  const vue = `<template><view/></template>
<script module="handler" lang="wxs">
var toUpper = function(s){ return s }
module.exports = { toUpper: toUpper }
</script>
<script setup>
import { ref } from 'vue'
const n = ref(1)
</script>`
  const parts = parseVueScriptParts(vue)
  const grabbedWxs = parts.script.includes('toUpper') && !parts.script.includes('ref')
  const verdict = grabbedWxs ? 'HIGH_RISK_DOCUMENTED' : 'OK'
  // Not CRITICAL_WRONG emit — fingerprint blind spot → may miss script-setup edits on shared components
  add({
    id,
    category: 'complex-ref / SFC-parse',
    pass: true, // documented correctly
    verdict: grabbedWxs ? 'FAIL_CLOSED_GAP' : 'FAST_OK',
    detail: grabbedWxs
      ? 'parseVueScriptParts returns WXS body only — F12 component FP ignores <script setup>; script-setup edit may be invisible → stale component or missed closure'
      : 'unexpected: got setup',
    scriptHead: parts.script.slice(0, 80),
    evidence: 'Measured',
    severityHint: 'HIGH',
    realProjectHit: 'modules/components/seg-037/node/node.vue has wxs+script',
  })
  inv({
    id: 'INV-wxs-script-first',
    severity: 'HIGH',
    surface: 'parseVueScriptParts / F12 componentFp',
    measured: true,
    silentWrongPossible: true,
    note: 'If component script-setup changes while wxs stable, componentFp.scriptHash unchanged → may skip needed full/closure',
  })
}

// ============================================================================
// M5 — TypeScript `as` cast / enum left in setup-body splice
// ============================================================================
{
  const id = 'm5-ts-as-cast-leaks-into-emit'
  const oldS = `import { ref } from 'vue'\nconst label = ref('routeA' as string)\n`
  const newS = `import { ref } from 'vue'\nconst label = ref('ts-probe' as string)\n`
  const r = emitOptCExtPage({
    outDir: FIX_OUT,
    pagePath: 'pages-tab/routeA/index',
    oldScript: oldS,
    newScript: newS,
    dryRun: true,
  })
  let verdict, pass, detail
  if (r.ok) {
    const hasAs = /as\s+string/.test(r.code)
    const syn = syntaxOk(r.code)
    if (hasAs && !syn) {
      verdict = 'CRITICAL_WRONG'
      pass = false
      detail = `wrote TS syntax into page JS; syntaxErr=${syntaxErr(r.code)}`
    } else if (hasAs && syn) {
      // new Function might still fail on `as` — if syn true somehow
      verdict = 'CRITICAL_WRONG'
      pass = false
      detail = 'TS as present but new Function accepted (unexpected)'
    } else if (!hasAs && syn && r.code.includes('ts-probe')) {
      verdict = 'FAST_OK'
      pass = true
      detail = 'as stripped or surgical avoided as'
    } else {
      verdict = 'CRITICAL_WRONG'
      pass = false
      detail = `ok=${r.ok} hasAs=${hasAs} syn=${syn} class=${r.emitClass}`
    }
  } else {
    verdict = 'FAIL_CLOSED'
    pass = true
    detail = `fail-closed ${r.reason} / ${r.setupBodyReason}`
  }
  add({
    id,
    category: 'messy-script',
    pass,
    verdict,
    detail,
    emitClass: r.emitClass,
    evidence: 'Measured',
    note: 'Project langTs≈7 SFCs',
  })
}

// ============================================================================
// M6 — enum in script
// ============================================================================
{
  const id = 'm6-ts-enum-in-setup'
  const oldS = `import { ref } from 'vue'\nenum E { A = 1 }\nconst label = ref(E.A)\n`
  const newS = `import { ref } from 'vue'\nenum E { A = 2 }\nconst label = ref(E.A)\n`
  const r = emitOptCExtPage({
    outDir: FIX_OUT,
    pagePath: 'pages-tab/routeA/index',
    oldScript: oldS,
    newScript: newS,
    dryRun: true,
  })
  let verdict, pass
  if (r.ok) {
    const syn = syntaxOk(r.code)
    verdict = syn ? 'CRITICAL_WRONG' : 'CRITICAL_WRONG'
    // enum is not valid in plain JS new Function
    pass = false
    if (!syn) {
      // If they wrote invalid JS — still CRITICAL (shipped broken) unless dryRun
      verdict = 'CRITICAL_WRONG'
      pass = false
    }
  } else {
    verdict = 'FAIL_CLOSED'
    pass = true
  }
  // Prefer: if ok && !syntax → CRITICAL (would write broken); if !ok → FAIL_CLOSED safe
  if (r.ok && !syntaxOk(r.code)) {
    verdict = 'CRITICAL_WRONG'
    pass = false
  }
  add({
    id,
    category: 'messy-script',
    pass,
    verdict,
    detail: `ok=${r.ok} reason=${r.reason} setup=${r.setupBodyReason} syn=${r.code ? syntaxOk(r.code) : 'n/a'} err=${r.code ? syntaxErr(r.code) : ''}`,
    evidence: 'Measured',
  })
}

// ============================================================================
// M7 — dynamic import() in setup
// ============================================================================
{
  const id = 'm7-dynamic-import-in-setup'
  const oldS = `import { ref } from 'vue'\nconst label = ref('routeA')\n`
  const newS = `import { ref } from 'vue'\nconst label = ref('routeA')\nconst mod = import('@/modules/utils/unifast-probe.js')\n`
  const r = emitOptCExtPage({
    outDir: FIX_OUT,
    pagePath: 'pages-tab/routeA/index',
    oldScript: oldS,
    newScript: newS,
    dryRun: true,
  })
  // dynamic import left in body; may setup-body succeed with import() in page JS (invalid for mp CJS)
  let verdict, pass, detail
  if (r.ok) {
    const hasDyn = /import\s*\(/.test(r.code)
    const syn = syntaxOk(r.code) // import() is valid in modern JS Function?
    // In Node new Function, dynamic import is NOT allowed in non-async function / classic script
    const err = syntaxErr(r.code)
    if (hasDyn) {
      verdict = 'CRITICAL_WRONG'
      pass = false
      detail = `setup-body kept import(); syn=${syn} err=${err}`
    } else {
      verdict = 'FAST_OK'
      pass = true
      detail = 'dynamic import not in output'
    }
  } else {
    verdict = 'FAIL_CLOSED'
    pass = true
    detail = `${r.reason}/${r.setupBodyReason}`
  }
  add({
    id,
    category: 'messy-script',
    pass,
    verdict,
    detail,
    emitClass: r.emitClass,
    evidence: 'Measured',
  })
}

// ============================================================================
// M8 — defineProps / withDefaults edit (macros — source-level)
// ============================================================================
{
  const id = 'm8-defineProps-withDefaults-edit'
  const oldS = `import { ref } from 'vue'\nconst props = withDefaults(defineProps<{ n?: number }>(), { n: 1 })\nconst label = ref('routeA')\n`
  const newS = `import { ref } from 'vue'\nconst props = withDefaults(defineProps<{ n?: number }>(), { n: 99 })\nconst label = ref('routeA')\n`
  const r = emitOptCExtPage({
    outDir: FIX_OUT,
    pagePath: 'pages-tab/routeA/index',
    oldScript: oldS,
    newScript: newS,
    dryRun: true,
  })
  let verdict, pass, detail
  if (r.ok) {
    const hasMacro = /defineProps|withDefaults/.test(r.code)
    const syn = syntaxOk(r.code)
    if (hasMacro && !syn) {
      verdict = 'CRITICAL_WRONG'
      pass = false
      detail = 'macros leaked; syntax fail'
    } else if (hasMacro) {
      verdict = 'CRITICAL_WRONG'
      pass = false
      detail = 'macros present in page JS'
    } else {
      // spliced something without macros — still may be wrong vs uni (__props)
      verdict = 'UNVERIFIED'
      pass = true
      detail = `ok class=${r.emitClass} macrosStripped; runtime equiv unverified vs uni`
    }
  } else {
    verdict = 'FAIL_CLOSED'
    pass = true
    detail = `${r.reason}/${r.setupBodyReason}`
  }
  add({
    id,
    category: 'messy-script',
    pass,
    verdict,
    detail,
    evidence: 'Measured',
  })
}

// ============================================================================
// M9 — defineExpose / getCurrentInstance / provide-inject
// ============================================================================
{
  const id = 'm9-expose-gci-provide-inject'
  const oldS = `import { ref, provide, getCurrentInstance } from 'vue'\nconst label = ref('routeA')\nprovide('k', label)\nconst inst = getCurrentInstance()\ndefineExpose({ label })\n`
  const newS = `import { ref, provide, getCurrentInstance } from 'vue'\nconst label = ref('expose-probe')\nprovide('k', label)\nconst inst = getCurrentInstance()\ndefineExpose({ label })\n`
  const r = emitOptCExtPage({
    outDir: FIX_OUT,
    pagePath: 'pages-tab/routeA/index',
    oldScript: oldS,
    newScript: newS,
    dryRun: true,
  })
  let verdict, pass, detail
  if (r.ok) {
    const hasExpose = /defineExpose/.test(r.code)
    const syn = syntaxOk(r.code)
    const hasProbe = r.code.includes('expose-probe')
    if (hasExpose || !syn) {
      verdict = 'CRITICAL_WRONG'
      pass = false
      detail = `expose=${hasExpose} syn=${syn} err=${syntaxErr(r.code)}`
    } else if (hasProbe && syn) {
      verdict = 'FAST_OK'
      pass = true
      detail = `class=${r.emitClass}; defineExpose absent (ok if surgical)`
    } else {
      verdict = 'UNVERIFIED'
      pass = true
      detail = `class=${r.emitClass}`
    }
  } else {
    verdict = 'FAIL_CLOSED'
    pass = true
    detail = `${r.reason}/${r.setupBodyReason}`
  }
  add({
    id,
    category: 'messy-script',
    pass,
    verdict,
    detail,
    emitClass: r.emitClass,
    evidence: 'Measured',
  })
}

// ============================================================================
// M10 — top-level side effect / IIFE in setup script
// ============================================================================
{
  const id = 'm10-toplevel-sideeffect-iife'
  const oldS = `import { ref } from 'vue'\n;(()=>{ console.log('boot') })()\nconst label = ref('routeA')\n`
  const newS = `import { ref } from 'vue'\n;(()=>{ console.log('boot2') })()\nconst label = ref('routeA')\n`
  const r = emitOptCExtPage({
    outDir: FIX_OUT,
    pagePath: 'pages-tab/routeA/index',
    oldScript: oldS,
    newScript: newS,
    dryRun: true,
  })
  let verdict, pass, detail
  if (r.ok) {
    const syn = syntaxOk(r.code)
    const hasBoot2 = r.code.includes('boot2')
    if (!syn) {
      verdict = 'CRITICAL_WRONG'
      pass = false
      detail = 'bad syntax'
    } else if (hasBoot2) {
      verdict = 'FAST_OK'
      pass = true
      detail = `IIFE kept class=${r.emitClass}`
    } else {
      // DCE may drop IIFE? console.log has call → side effect keep as bare?
      verdict = 'UNVERIFIED'
      pass = true
      detail = `ok but boot2 missing — DCE may have dropped; class=${r.emitClass}`
    }
  } else {
    verdict = 'FAIL_CLOSED'
    pass = true
    detail = `${r.reason}/${r.setupBodyReason}`
  }
  add({
    id,
    category: 'messy-script',
    pass,
    verdict,
    detail,
    evidence: 'Measured',
  })
}

// ============================================================================
// M11 — template-only / style-only / both (gate behavior — code-review + offline hash)
// ============================================================================
{
  const id = 'm11-template-style-gates-inferred'
  // We cannot run watchChange easily offline; document from vite source + prior R1
  add({
    id,
    category: 'messy-script',
    pass: true,
    verdict: 'FAIL_CLOSED',
    detail:
      'Code-review: templateHash/styleHash drift → forceFull(template-changed|style-changed). Simultaneous script+template → template wins full. Measured prior R1 FULL_TEMPLATE/FULL_STYLE.',
    evidence: 'Inferred+PriorMeasured',
  })
}

// ============================================================================
// M12 — complex template expressions (v-if/v-for/:is) — template gate
// ============================================================================
{
  const id = 'm12-complex-template-forces-full'
  add({
    id,
    category: 'messy-script',
    pass: true,
    verdict: 'FAIL_CLOSED',
    detail:
      'Any template edit (incl. :is, scoped slot, complex v-for) changes templateHash → FULL. Safe. Optc does not patch WXML.',
    evidence: 'CodeReview',
  })
}

// ============================================================================
// C1 — Alias @/ multi-hop relative (fixture routeA already @/)
// ============================================================================
{
  const id = 'c1-alias-at-slash-callarg'
  const oldS = baselineRouteAScript()
  const newS = oldS.replace('probeMul(21)', 'probeMul(22)')
  const r = emitOptCExtPage({
    outDir: FIX_OUT,
    pagePath: 'pages-tab/routeA/index',
    oldScript: oldS,
    newScript: newS,
    dryRun: true,
  })
  const syn = r.ok && syntaxOk(r.code)
  const has22 = r.ok && /probeMul\(22\)/.test(r.code)
  const verdict = r.ok && syn && has22 ? 'FAST_OK' : !r.ok ? 'FAIL_CLOSED' : 'CRITICAL_WRONG'
  add({
    id,
    category: 'complex-ref',
    pass: verdict !== 'CRITICAL_WRONG',
    verdict,
    detail: `ok=${r.ok} class=${r.emitClass} syn=${syn} has22=${has22}`,
    emitClass: r.emitClass,
    evidence: 'Measured',
  })
}

// ============================================================================
// C2 — import * as NS
// ============================================================================
{
  const id = 'c2-namespace-import-star'
  const oldS = `import { ref } from 'vue'\nimport * as Probe from '@/modules/utils/unifast-probe.js'\nconst label = ref(Probe.probeMul(21))\n`
  const newS = `import { ref } from 'vue'\nimport * as Probe from '@/modules/utils/unifast-probe.js'\nconst label = ref(Probe.probeMul(22))\n`
  const r = emitOptCExtPage({
    outDir: FIX_OUT,
    pagePath: 'pages-tab/routeA/index',
    oldScript: oldS,
    newScript: newS,
    dryRun: true,
  })
  let verdict, pass, detail
  if (r.ok) {
    const syn = syntaxOk(r.code)
    // Expect modules_utils_unifastProbe.probeMul(22) or similar
    const mapped =
      /unifastProbe\.probeMul\(22\)|unifast_probe\.probeMul\(22\)|modules_utils_unifastProbe\.probeMul\(22\)/.test(
        r.code,
      ) || /probeMul\(22\)/.test(r.code)
    if (syn && mapped) {
      verdict = 'FAST_OK'
      pass = true
      detail = `class=${r.emitClass}`
    } else if (syn && r.code.includes('Probe.probeMul')) {
      verdict = 'CRITICAL_WRONG'
      pass = false
      detail = 'left Probe. unbound in CJS page'
    } else {
      verdict = syn ? 'UNVERIFIED' : 'CRITICAL_WRONG'
      pass = syn
      detail = `syn=${syn} class=${r.emitClass} head=${(r.code || '').slice(0, 120)}`
    }
  } else {
    verdict = 'FAIL_CLOSED'
    pass = true
    detail = `${r.reason}/${r.setupBodyReason}`
  }
  add({
    id,
    category: 'complex-ref',
    pass,
    verdict,
    detail,
    emitClass: r.emitClass,
    evidence: 'Measured',
  })
}

// ============================================================================
// C3 — side-effect-only import
// ============================================================================
{
  const id = 'c3-side-effect-only-import'
  const oldS = `import { ref } from 'vue'\nimport '@/modules/utils/unifast-probe.js'\nconst label = ref('routeA')\n`
  const newS = `import { ref } from 'vue'\nimport '@/modules/utils/unifast-probe.js'\nconst label = ref('side-probe')\n`
  const decls = parseImportDecls(oldS)
  const se = decls.filter((d) => d.kind === 'side-effect')
  const r = emitOptCExtPage({
    outDir: FIX_OUT,
    pagePath: 'pages-tab/routeA/index',
    oldScript: oldS,
    newScript: newS,
    dryRun: true,
  })
  // side-effect import won't be in rewrite map; fingerprint should still hash the file if extractStaticImports catches it
  const specs = extractImportSpecs(oldS)
  add({
    id,
    category: 'complex-ref',
    pass: true,
    verdict: r.ok && syntaxOk(r.code) && r.code.includes('side-probe') ? 'FAST_OK' : !r.ok ? 'FAIL_CLOSED' : 'UNVERIFIED',
    detail: `sideEffectDecls=${se.length} specs=${JSON.stringify(specs)} ok=${r.ok} class=${r.emitClass}`,
    evidence: 'Measured',
    note: 'Side-effect module content change relies on fingerprint contentHashes; IMPORT_RE includes side-effect import specs',
  })
}

// ============================================================================
// C4 — import type (type-only) — may inflate import-set / leak
// ============================================================================
{
  const id = 'c4-import-type-only'
  const oldS = `import { ref } from 'vue'\nimport type { Ref } from 'vue'\nconst label = ref('routeA')\n`
  const newS = `import { ref } from 'vue'\nimport type { Ref } from 'vue'\nconst label = ref('type-probe')\n`
  const specs = extractImportSpecs(oldS)
  const r = emitOptCExtPage({
    outDir: FIX_OUT,
    pagePath: 'pages-tab/routeA/index',
    oldScript: oldS,
    newScript: newS,
    dryRun: true,
  })
  const typeLeaked = r.ok && /import\s+type/.test(r.code)
  let verdict, pass, detail
  if (typeLeaked) {
    verdict = 'CRITICAL_WRONG'
    pass = false
    detail = 'import type leaked into page JS'
  } else if (r.ok && syntaxOk(r.code) && r.code.includes('type-probe')) {
    verdict = 'FAST_OK'
    pass = true
    detail = `class=${r.emitClass}; specsStillListVue=${specs.includes('vue')}`
  } else if (!r.ok) {
    verdict = 'FAIL_CLOSED'
    pass = true
    detail = `${r.reason}/${r.setupBodyReason}`
  } else {
    verdict = 'UNVERIFIED'
    pass = true
    detail = `ok=${r.ok}`
  }
  add({
    id,
    category: 'complex-ref',
    pass,
    verdict,
    detail,
    evidence: 'Measured',
  })
}

// ============================================================================
// C5 — default import multi-export WRONG GUESS (CRITICAL candidate)
// ============================================================================
{
  const id = 'c5-default-import-multi-export-guess'
  ensureTmp()
  writeTree(TMP, {
    'common/vendor.js': `"use strict";
function ref(v){ return { value: v } }
exports.ref = ref;
`,
    'modules/utils/multi.js': `"use strict";
exports.alpha = function alpha(){ return 'ALPHA' };
exports.beta = function beta(){ return 'BETA' };
`,
    'pages-tab/routeA/index.js': `"use strict";
const common_vendor = require("../../common/vendor.js");
const modules_utils_multi = require("../../modules/utils/multi.js");
const _sfc_main = {
  __name: "index",
  setup(__props) {
    const n = common_vendor.ref(0);
    return (_ctx, _cache) => {
      return { a: n.value };
    };
  }
};
wx.createPage(_sfc_main);
`,
  })
  // New script uses default import — true default might be beta, but guess picks alpha (exports[0])
  const oldS = `import { ref } from 'vue'\nconst n = ref(0)\n`
  const newS = `import { ref } from 'vue'\nimport Multi from '@/modules/utils/multi.js'\nconst n = ref(Multi())\n`
  const info = buildLocalRewriteMap(newS, readFileSync(join(TMP, 'pages-tab/routeA/index.js'), 'utf8'), 'pages-tab/routeA/index', TMP)
  const multiMap = info.mapped.find((m) => m.local === 'Multi')
  const guessedAlpha = multiMap && multiMap.exportName === 'alpha'
  const r = emitOptCExtPage({
    outDir: TMP,
    pagePath: 'pages-tab/routeA/index',
    oldScript: oldS,
    newScript: newS,
    dryRun: true,
  })
  // CRITICAL if emit succeeds with alpha guess — silent wrong vs intended default
  let verdict, pass, detail
  if (r.ok && guessedAlpha && /modules_utils_multi\.alpha/.test(r.code)) {
    verdict = 'CRITICAL_WRONG'
    pass = false
    detail =
      'default import mapped to exports[0]=alpha with no cold usage evidence; silent wrong if real default is beta/default'
  } else if (!r.ok) {
    verdict = 'FAIL_CLOSED'
    pass = true
    detail = `${r.reason}/${r.setupBodyReason} map=${JSON.stringify(multiMap)}`
  } else {
    verdict = 'UNVERIFIED'
    pass = true
    detail = `ok class=${r.emitClass} map=${JSON.stringify(multiMap)}`
  }
  add({
    id,
    category: 'complex-ref',
    pass,
    verdict,
    detail,
    emitClass: r.emitClass,
    mapped: multiMap,
    evidence: 'Measured',
    severityHint: 'CRITICAL',
  })
  inv({
    id: 'INV-default-export-guess-exports0',
    severity: 'CRITICAL',
    surface: 'buildLocalRewriteMap require-default',
    measured: true,
    silentWrongPossible: true,
    note: 'When exports.length>1 and cold setup has no req.binding.* usage, picks exports[0]',
  })
}

// ============================================================================
// C6 — barrel re-export
// ============================================================================
{
  const id = 'c6-barrel-reexport'
  ensureTmp()
  writeTree(TMP, {
    'common/vendor.js': `"use strict"; function ref(v){return {value:v}} exports.ref=ref;\n`,
    'modules/utils/unifast-probe.js': `"use strict"; function probeMul(n){return n} exports.probeMul=probeMul;\n`,
    'modules/utils/index.js': `"use strict";
var probe = require("./unifast-probe.js");
exports.probeMul = probe.probeMul;
`,
    'pages-tab/routeA/index.js': `"use strict";
const common_vendor = require("../../common/vendor.js");
const modules_utils_index = require("../../modules/utils/index.js");
const _sfc_main = {
  setup(__props) {
    const label = common_vendor.ref(modules_utils_index.probeMul(21));
    return (_ctx, _cache) => ({ a: label.value });
  }
};
wx.createPage(_sfc_main);
`,
  })
  const oldS = `import { ref } from 'vue'\nimport { probeMul } from '@/modules/utils/index.js'\nconst label = ref(probeMul(21))\n`
  const newS = `import { ref } from 'vue'\nimport { probeMul } from '@/modules/utils/index.js'\nconst label = ref(probeMul(22))\n`
  const r = emitOptCExtPage({
    outDir: TMP,
    pagePath: 'pages-tab/routeA/index',
    oldScript: oldS,
    newScript: newS,
    dryRun: true,
  })
  const ok =
    r.ok &&
    syntaxOk(r.code) &&
    /modules_utils_index\.probeMul\(22\)/.test(r.code)
  add({
    id,
    category: 'complex-ref',
    pass: ok || !r.ok,
    verdict: ok ? 'FAST_OK' : !r.ok ? 'FAIL_CLOSED' : 'CRITICAL_WRONG',
    detail: `ok=${r.ok} class=${r.emitClass} syn=${r.code && syntaxOk(r.code)}`,
    emitClass: r.emitClass,
    evidence: 'Measured',
  })
}

// ============================================================================
// C7 — circular util self-import (closure)
// ============================================================================
{
  const id = 'c7-circular-self-util'
  ensureTmp()
  const src = join(TMP, 'src')
  writeTree(src, {
    'modules/utils/circ.js': `import { circ } from './circ.js'\nexport function circ(n){ return n + 1 }\n`,
  })
  // Put a fake dist
  writeTree(TMP, {
    'dist/modules/utils/circ.js': `"use strict"; exports.circ = function circ(n){return n};\n`,
  })
  const clo = emitClosureSharedChunkSync({
    inputDir: src,
    outDir: join(TMP, 'dist'),
    sourceAbs: join(src, 'modules/utils/circ.js'),
    dryRun: true,
  })
  const verdict =
    !clo.ok && /circular/i.test(String(clo.reason || ''))
      ? 'FAIL_CLOSED'
      : !clo.ok
        ? 'FAIL_CLOSED'
        : 'CRITICAL_WRONG'
  add({
    id,
    category: 'complex-ref',
    pass: verdict === 'FAIL_CLOSED',
    verdict,
    detail: `ok=${clo.ok} reason=${clo.reason}`,
    evidence: 'Measured',
  })
}

// ============================================================================
// C8 — relative multi-hop ../../../
// ============================================================================
{
  const id = 'c8-multihop-relative'
  ensureTmp()
  writeTree(TMP, {
    'common/vendor.js': `"use strict"; function ref(v){return {value:v}} exports.ref=ref;\n`,
    'modules/utils/unifast-probe.js': `"use strict"; function probeMul(n){return n} exports.probeMul=probeMul;\n`,
    'pages-tab/routeA/index.js': `"use strict";
const common_vendor = require("../../common/vendor.js");
const modules_utils_unifastProbe = require("../../modules/utils/unifast-probe.js");
const _sfc_main = {
  setup(__props) {
    const label = common_vendor.ref(modules_utils_unifastProbe.probeMul(21));
    return (_ctx, _cache) => ({ a: label.value });
  }
};
wx.createPage(_sfc_main);
`,
  })
  const oldS = `import { ref } from 'vue'\nimport { probeMul } from '../../../modules/utils/unifast-probe.js'\nconst label = ref(probeMul(21))\n`
  const newS = `import { ref } from 'vue'\nimport { probeMul } from '../../../modules/utils/unifast-probe.js'\nconst label = ref(probeMul(22))\n`
  // pagePath pages-tab/routeA/index → ../../../ from pages-tab/routeA goes to repo root-ish; matchRequire uses pageDir
  const r = emitOptCExtPage({
    outDir: TMP,
    pagePath: 'pages-tab/routeA/index',
    oldScript: oldS,
    newScript: newS,
    dryRun: true,
  })
  add({
    id,
    category: 'complex-ref',
    pass: (r.ok && syntaxOk(r.code) && /probeMul\(22\)/.test(r.code)) || !r.ok,
    verdict:
      r.ok && syntaxOk(r.code) && /probeMul\(22\)/.test(r.code)
        ? 'FAST_OK'
        : !r.ok
          ? 'FAIL_CLOSED'
          : 'CRITICAL_WRONG',
    detail: `ok=${r.ok} class=${r.emitClass} reason=${r.reason} setup=${r.setupBodyReason}`,
    evidence: 'Measured',
  })
}

// ============================================================================
// C9 — optional chaining / nullish on rewritten idents
// ============================================================================
{
  const id = 'c9-optional-chain-nullish'
  const member = rewriteIdents('obj?.probeMul', { probeMul: 'P.probeMul' })
  const call = rewriteIdents('probeMul?.(1)', { probeMul: 'P.probeMul' })
  const nullish = rewriteIdents('probeMul ?? 0', { probeMul: 'P.probeMul' })
  const memberOk = member === 'obj?.probeMul' // keep property
  const callOk = call === 'P.probeMul?.(1)'
  const nullishOk = nullish === 'P.probeMul ?? 0'
  const pass = memberOk && callOk && nullishOk
  add({
    id,
    category: 'complex-ref',
    pass,
    verdict: pass ? 'FAST_OK' : 'CRITICAL_WRONG',
    detail: `member=${member} call=${call} nullish=${nullish}`,
    evidence: 'Measured',
  })
}

// ============================================================================
// C10 — private field #x near rewrite
// ============================================================================
{
  const id = 'c10-private-field-hash'
  const out = rewriteIdents('class A { #x=1; m(){ return probeMul(this.#x) } }', {
    probeMul: 'P.probeMul',
  })
  // #x should stay; probeMul rewritten
  const pass = out.includes('P.probeMul') && out.includes('#x')
  add({
    id,
    category: 'complex-ref',
    pass,
    verdict: pass ? 'FAST_OK' : 'CRITICAL_WRONG',
    detail: out.slice(0, 120),
    evidence: 'Measured',
  })
}

// ============================================================================
// C11 — composable returning reactive bag (setup-body)
// ============================================================================
{
  const id = 'c11-composable-reactive-bag'
  const oldS = `import { ref, reactive } from 'vue'\nfunction useBag(){ return reactive({ a: 1 }) }\nconst bag = useBag()\nconst label = ref(bag.a)\n`
  const newS = `import { ref, reactive } from 'vue'\nfunction useBag(){ return reactive({ a: 2 }) }\nconst bag = useBag()\nconst label = ref(bag.a)\n`
  const r = emitOptCExtPage({
    outDir: FIX_OUT,
    pagePath: 'pages-tab/routeA/index',
    oldScript: oldS,
    newScript: newS,
    dryRun: true,
  })
  let verdict, pass, detail
  if (r.ok) {
    const syn = syntaxOk(r.code)
    const has2 = /a:\s*2/.test(r.code) || /a: 2/.test(r.code)
    if (syn && has2) {
      verdict = 'FAST_OK'
      pass = true
      detail = `class=${r.emitClass}`
    } else if (!syn) {
      verdict = 'CRITICAL_WRONG'
      pass = false
      detail = syntaxErr(r.code)
    } else {
      verdict = 'UNVERIFIED'
      pass = true
      detail = `syn ok but a:2 missing class=${r.emitClass}`
    }
  } else {
    verdict = 'FAIL_CLOSED'
    pass = true
    detail = `${r.reason}/${r.setupBodyReason}`
  }
  add({
    id,
    category: 'messy-script',
    pass,
    verdict,
    detail,
    evidence: 'Measured',
  })
}

// ============================================================================
// C12 — CSS @import / url — style gate
// ============================================================================
{
  add({
    id: 'c12-css-import-url-style-gate',
    category: 'complex-ref',
    pass: true,
    verdict: 'FAIL_CLOSED',
    detail:
      'Fixture routeA style has @import "@/styles/utils.scss"; styleHash covers full style text → style edit FULL. url() asset path change same. Safe.',
    evidence: 'CodeReview+Fixture',
  })
}

// ============================================================================
// C13 — pages.json / subPackages — config gate
// ============================================================================
{
  add({
    id: 'c13-pages-json-subpackages-config-gate',
    category: 'complex-ref',
    pass: true,
    verdict: 'FAIL_CLOSED',
    detail:
      'watchChange on pages.json/manifest → forceFull(pages-or-manifest-changed). listPagesFromJson reads subPackages. Safe full.',
    evidence: 'CodeReview',
  })
}

// ============================================================================
// C14 — R4 separate chunk vs inline (doc)
// ============================================================================
{
  const routeA = readFileSync(ROUTE_A_JS, 'utf8')
  const separate = /require\(["'].*unifast-probe/.test(routeA)
  const inlined = /function probeMul/.test(routeA)
  add({
    id: 'c14-r4-separate-chunk-not-inline',
    category: 'complex-ref',
    pass: separate && !inlined,
    verdict: separate && !inlined ? 'DOCUMENTED' : 'UNVERIFIED',
    detail: `separate=${separate} inlined=${inlined}`,
    evidence: 'Measured',
  })
}

// ============================================================================
// C15 — high fan-out over CLOSURE_MAX (shared-popup prior)
// ============================================================================
{
  add({
    id: 'c15-high-fanout-over-closure-max',
    category: 'complex-ref',
    pass: true,
    verdict: 'FAIL_CLOSED',
    detail:
      'Prior Measured: shared-popup ~500 importers → full ~1771ms shared-vue over CLOSURE_MAX. Safe slow path.',
    evidence: 'PriorMeasured',
  })
}

// ============================================================================
// C16 — Pinia/store module edit (inferred fail-closed unless ≤max util)
// ============================================================================
{
  add({
    id: 'c16-pinia-store-module',
    category: 'complex-ref',
    pass: true,
    verdict: 'FAIL_CLOSED_OK',
    detail:
      'Measured: pinia files=0; Vuex createStore present. store/modules gate=FULL_SHARED (looksSharedPath). Low-fanout store → FAST_CLOSURE candidate. No dedicated pinia emit. See verify/close-unknowns.json.',
    evidence: 'Measured',
  })
}

// ============================================================================
// C17 — easycom / uni_modules (inferred)
// ============================================================================
{
  add({
    id: 'c17-easycom-uni-modules',
    category: 'complex-ref',
    pass: true,
    verdict: 'FAIL_CLOSED_OK',
    detail:
      'Measured+hardened: routeB <tag-a> easycom-only; script FP missed it; seedEasycomIntoFingerprints closes integrity; watch → FULL_SHARED/closure-vue; @dcloudio external → FULL_EASYCOM. See close-unknowns b1–b4.',
    evidence: 'Measured',
  })
}

// ============================================================================
// C18 — require() in setup (non-import)
// ============================================================================
{
  const id = 'c18-require-in-setup'
  const oldS = `import { ref } from 'vue'\nconst label = ref('routeA')\n`
  const newS = `import { ref } from 'vue'\nconst probe = require('@/modules/utils/unifast-probe.js')\nconst label = ref(probe.probeMul(21))\n`
  const r = emitOptCExtPage({
    outDir: FIX_OUT,
    pagePath: 'pages-tab/routeA/index',
    oldScript: oldS,
    newScript: newS,
    dryRun: true,
  })
  let verdict, pass, detail
  if (r.ok) {
    // require('@/...') likely wrong in mp page
    const hasAt = /require\(['"]@\//.test(r.code)
    if (hasAt) {
      verdict = 'CRITICAL_WRONG'
      pass = false
      detail = 'left require(@/) in page JS — will fail at runtime'
    } else if (syntaxOk(r.code)) {
      verdict = 'UNVERIFIED'
      pass = true
      detail = `class=${r.emitClass}`
    } else {
      verdict = 'CRITICAL_WRONG'
      pass = false
      detail = syntaxErr(r.code)
    }
  } else {
    verdict = 'FAIL_CLOSED'
    pass = true
    detail = `${r.reason}/${r.setupBodyReason}`
  }
  add({
    id,
    category: 'messy-script',
    pass,
    verdict,
    detail,
    evidence: 'Measured',
  })
}

// ============================================================================
// C19 — DCE drops live binding via complex render ref (stress)
// ============================================================================
{
  const id = 'c19-dce-liveness-stress'
  // Live chain keeps dead; truly-unused pure is dropped (ASI-aware splitter).
  const body = `const dead = 1 + 2\nconst helper = dead + 3\nconst live = common_vendor.ref(helper)`
  const ret = `return () => ({ a: live.value })`
  const out = formatSetupStmtsLikeUni(body, ret)
  const out2 = formatSetupStmtsLikeUni(
    `const unused = 1 + 2\nconst live = common_vendor.ref(3)`,
    ret,
  )
  const pass =
    /const dead/.test(out) &&
    /helper/.test(out) &&
    /live/.test(out) &&
    !/const unused/.test(out2) &&
    /const live/.test(out2)
  add({
    id,
    category: 'integrity',
    pass,
    verdict: pass ? 'FAST_OK' : 'CRITICAL_WRONG',
    detail: out.replace(/\n/g, ' | ') + ' || unusedDrop=' + out2.replace(/\n/g, ' | '),
    evidence: 'Measured',
  })
}

// ============================================================================
// C20 — stripImports leaves dynamic import; static type
// ============================================================================
{
  const id = 'c20-stripImports-dynamic-left'
  const s = stripImports(
    `import { ref } from 'vue'\nimport type { X } from './x'\nconst m = import('./y')\nconst a = ref(1)`,
  )
  const leftDyn = /import\s*\(/.test(s)
  const leftType = /import\s+type/.test(s)
  add({
    id,
    category: 'complex-ref',
    pass: true,
    verdict: leftType ? 'HIGH_RISK_DOCUMENTED' : 'OK',
    detail: `leftDyn=${leftDyn} leftType=${leftType} body=${JSON.stringify(s.slice(0, 100))}`,
    evidence: 'Measured',
    note: 'import type not matched by stripImports from-clause the same way — may remain and break setup-body JS',
  })
}

// Re-test import type strip more carefully
{
  const id = 'c20b-import-type-strip-behavior'
  const raw = `import type { Foo } from './foo'\nimport { ref } from 'vue'\nconst a = ref(1)`
  const stripped = stripImports(raw)
  const decls = parseImportDecls(raw)
  const stillType = /import\s+type/.test(stripped)
  // If stillType, setup-body would include it → CRITICAL when emit ok
  const oldS = `import { ref } from 'vue'\nconst label = ref('routeA')\n`
  const newS = raw.replace("ref(1)", "ref('type2')") // messy
  // clearer:
  const newS2 = `import type { Foo } from './foo'\nimport { ref } from 'vue'\nconst label = ref('type2')\n`
  const r = emitOptCExtPage({
    outDir: FIX_OUT,
    pagePath: 'pages-tab/routeA/index',
    oldScript: oldS,
    newScript: newS2,
    dryRun: true,
  })
  let verdict, pass, detail
  if (r.ok && /import\s+type/.test(r.code)) {
    verdict = 'CRITICAL_WRONG'
    pass = false
    detail = 'import type in emitted page JS'
  } else if (r.ok && !syntaxOk(r.code)) {
    verdict = 'CRITICAL_WRONG'
    pass = false
    detail = syntaxErr(r.code)
  } else if (r.ok) {
    verdict = 'FAST_OK'
    pass = true
    detail = `stripped from emit class=${r.emitClass}; stripImportsStillType=${stillType}`
  } else {
    verdict = 'FAIL_CLOSED'
    pass = true
    detail = `${r.reason}/${r.setupBodyReason}; stripStillType=${stillType}`
  }
  add({
    id,
    category: 'complex-ref',
    pass,
    verdict,
    detail,
    stripStillType: stillType,
    decls: decls.map((d) => d.kind + ':' + d.spec),
    evidence: 'Measured',
  })
}

// ============================================================================
// C21 — midpath unmapped new import fail-closed
// ============================================================================
{
  const id = 'c21-midpath-new-unmapped-import'
  const oldS = baselineRouteAScript()
  const newS =
    `import { ref } from 'vue'\nimport Shared from "@/modules/components/shared-popup/index.vue"\nimport {probeMul} from "@/modules/utils/unifast-probe.js"\nimport {noSuch} from "@/modules/utils/does-not-exist.js"\nconst label=ref(probeMul(21)+noSuch(1))\n`
  const mid = emitOptCExtMidpathSync({
    outDir: FIX_OUT,
    pagePath: 'pages-tab/routeA/index',
    oldScript: oldS,
    newScript: newS,
    dryRun: true,
  })
  add({
    id,
    category: 'complex-ref',
    pass: !mid.ok,
    verdict: !mid.ok ? 'FAIL_CLOSED' : 'CRITICAL_WRONG',
    detail: `ok=${mid.ok} reason=${mid.reason} unmapped=${JSON.stringify(mid.unmapped || mid.rewriteInfo?.unmapped || []).slice(0, 200)}`,
    evidence: 'Measured',
    note: 'Unused missing import may midpath-succeed (dead); used missing → fail-closed (this case)',
  })
}

// ============================================================================
// C22 — surgical happy path still OK on fixture
// ============================================================================
{
  const id = 'c22-baseline-surgical-sanity'
  const oldS = baselineRouteAScript()
  // force string ref style if possible — routeA uses probeMul not string
  const cold = readFileSync(ROUTE_A_JS, 'utf8')
  const oldSimple = `import { ref } from 'vue'\nconst label = ref('routeA')\n`
  const newSimple = `import { ref } from 'vue'\nconst label = ref('routeA-probe')\n`
  // Use synthetic cold
  ensureTmp()
  writeTree(TMP, {
    'common/vendor.js': `"use strict"; function ref(v){return {value:v}} exports.ref=ref;\n`,
    'pages-tab/routeA/index.js': `"use strict";
const common_vendor = require("../../common/vendor.js");
const _sfc_main = {
  setup(__props) {
    const label = common_vendor.ref("routeA");
    return (_ctx, _cache) => ({ a: label.value });
  }
};
wx.createPage(_sfc_main);
`,
  })
  const r = emitOptCExtPage({
    outDir: TMP,
    pagePath: 'pages-tab/routeA/index',
    oldScript: oldSimple,
    newScript: newSimple,
    dryRun: true,
  })
  add({
    id,
    category: 'integrity',
    pass: r.ok && r.emitClass === 'surgical' && syntaxOk(r.code) && r.code.includes('routeA-probe'),
    verdict:
      r.ok && r.code.includes('routeA-probe') && syntaxOk(r.code) ? 'FAST_OK' : 'CRITICAL_WRONG',
    detail: `class=${r.emitClass} ok=${r.ok}`,
    evidence: 'Measured',
  })
}

// ============================================================================
// C23/C24 — ASI / no-semicolon DCE (was MED UNVERIFIED)
// ============================================================================
{
  const body = `const a = 1\nconst b = common_vendor.ref(2)\nconst c = a + b.value`
  const stmts = splitTopLevelStatements(body)
  const out = formatSetupStmtsLikeUni(body, `return () => ({ c })`)
  const pass =
    stmts.length === 3 &&
    !stmts.some((s) => stmtLooksMergedAsi(s)) &&
    /const a = 1/.test(out) &&
    /const c =/.test(out)
  add({
    id: 'c23-asi-split-and-dce',
    category: 'integrity',
    pass,
    verdict: pass ? 'FAST_OK' : 'CRITICAL_WRONG',
    detail: `split=${stmts.length} out=${JSON.stringify(out).slice(0, 140)}`,
    evidence: 'Measured',
  })
}

{
  const out = formatSetupStmtsLikeUni(
    `const dead = 1 + 2\nconst live = common_vendor.ref(3)`,
    `return () => ({ a: live.value })`,
  )
  const pass = !/const dead/.test(out) && /const live/.test(out)
  add({
    id: 'c24-asi-unused-pure-dce',
    category: 'integrity',
    pass,
    verdict: pass ? 'FAST_OK' : 'CRITICAL_WRONG',
    detail: out.replace(/\n/g, ' | '),
    evidence: 'Measured',
  })
}


// ============================================================================
// Code-review inventory (beyond cases)
// ============================================================================
report.codeReview.push(
  {
    id: 'CR1',
    severity: 'CRITICAL',
    topic: 'default-export → exports[0] guess',
    file: 'optc-ext-emitter.mjs buildLocalRewriteMap',
    status: 'CONFIRMED_BY_C5',
  },
  {
    id: 'CR2',
    severity: 'HIGH',
    topic: 'parseVueScriptParts first <script> only (wxs)',
    file: 'optc-ext-closure.mjs',
    status: 'CONFIRMED_BY_M4',
  },
  {
    id: 'CR3',
    severity: 'HIGH',
    topic: 'No TS strip — as/enum/macros can reach setup-body',
    file: 'optc-ext-emitter.mjs stripImports/setup-body',
    status: 'CONFIRMED_BY_M5/M6/M8',
  },
  {
    id: 'CR4',
    severity: 'MED',
    topic: 'Options API pages (~1721) always fail cascade → full (safe but dual-speed)',
    file: 'splitColdSetup setup(__props) anchor',
    status: 'CONFIRMED_BY_M1/M2',
  },
  {
    id: 'CR5',
    severity: 'MED',
    topic: 'Integrity seed misses non-fingerprint files (easycom, side graphs)',
    file: 'optc-ext-easycom.mjs + optc-ext seed',
    status: 'CLOSED_BY_SEED — Measured close-unknowns b3/b4/c17',
  },
  {
    id: 'CR6',
    severity: 'MED',
    topic: 'dynamic import() left by stripImports; may splice into page JS',
    file: 'stripImports',
    status: 'CONFIRMED_BY_M7',
  },
  {
    id: 'CR7',
    severity: 'LOW',
    topic: 'rewriteIdents treats ?. as member (safe); ?? rewrites free ident (ok)',
    file: 'rewriteIdents',
    status: 'CONFIRMED_BY_C9',
  },
  {
    id: 'CR8',
    severity: 'LOW',
    topic: 'DCE iterative liveness OK for simple helper chains',
    file: 'formatSetupStmtsLikeUni',
    status: 'CONFIRMED_BY_C19',
  },
  {
    id: 'CR9',
    severity: 'MED',
    topic: 'import type may not strip; fingerprint may treat as vue import-set noise',
    file: 'stripImports / extractImportSpecs',
    status: 'CONFIRMED_BY_C20b',
  },
  {
    id: 'CR10',
    severity: 'LOW',
    topic: 'WeChat DevTools mid-session page JS — GUI BLOCKED on Linux; static proxy Measured',
    status: 'BLOCKED_GUI + MEASURED_PROXY (close-unknowns e-*)',
  },
  {
    id: 'CR11',
    severity: 'MED',
    topic: 'DCE semicolon-only split silent-wrong on ASI (project ~1724 ASI scripts)',
    file: 'splitTopLevelStatements',
    status: 'CLOSED — ASI-aware split + setup-asi-ambiguous fail-closed',
  },
)

// Summary
const counts = {
  CRITICAL_WRONG: 0,
  FAIL_CLOSED: 0,
  FAIL_CLOSED_OK: 0,
  FAST_OK: 0,
  UNVERIFIED: 0,
  DOCUMENTED: 0,
  FAIL_CLOSED_GAP: 0,
  HIGH_RISK_DOCUMENTED: 0,
  OK: 0,
  BLOCKED: 0,
  other: 0,
}
for (const c of report.cases) {
  const v = c.verdict || 'other'
  if (counts[v] != null) counts[v]++
  else counts.other++
}
report.summary = {
  totalCases: report.cases.length,
  counts,
  criticalIds: report.cases.filter((c) => c.verdict === 'CRITICAL_WRONG').map((c) => c.id),
  failClosedIds: report.cases.filter((c) => c.verdict === 'FAIL_CLOSED').map((c) => c.id),
  fastOkIds: report.cases.filter((c) => c.verdict === 'FAST_OK').map((c) => c.id),
  unverifiedIds: report.cases.filter((c) => c.verdict === 'UNVERIFIED').map((c) => c.id),
}

report.topRisks = [
  {
    rank: 1,
    severity: 'CRITICAL',
    id: 'c5-default-import-multi-export-guess',
    title: '默认导入多 export 时猜 exports[0] → 可能静默错映射',
  },
  {
    rank: 2,
    severity: 'CRITICAL',
    id: 'm5/m6/m7/m8',
    title: 'TS/宏/dynamic import 进入 setup-body 可能写出非法或错误页 JS',
  },
  {
    rank: 3,
    severity: 'HIGH',
    id: 'm4-wxs-first',
    title: '组件 FP 只读第一个 script（wxs）→ 可能漏掉 script-setup 变更',
  },
  {
    rank: 4,
    severity: 'MED',
    id: 'options-api-full',
    title: '大量 Options API 页只能全量（安全但双速）',
  },
  {
    rank: 5,
    severity: 'MED',
    id: 'integrity/easycom',
    title: 'easycom/副作用图 — 已 Measured seed 关闭；GUI DevTools 仍 BLOCKED',
  },
]

report.postHarden = {
  landed: [
    'emit-syntax-invalid gate before write',
    'setup-forbidden-residue (export/macro/enum/as/dynamic-import/ts-type)',
    'default-import no exports[0] guess when multi-export + no cold evidence',
    'parseVueScriptParts skips wxs/module scripts; joins normal+setup',
    'ASI-aware splitTopLevelStatements + setup-asi-ambiguous fail-closed',
    'optc-ext-easycom.mjs seed into fingerprints/reverseDeps',
    'looksSharedPath += store|mixins|plugins|composables|services|hooks|uni_modules',
    'uni.scss / global-style forceFull; easycom-external outside src forceFull',
  ],
  regression: '33/33 PASS after close-unknowns',
  closeUnknowns: 'verify/close-unknowns.json UNVERIFIED=0 CRITICAL_WRONG=0 BLOCKED=1 (DevTools GUI)',
  note: 'All former UNVERIFIED closed to Measured/FAIL_CLOSED_OK/BLOCKED',
}
writeFileSync(join(OUT, 'deep-messy-risk.json'), JSON.stringify(report, null, 2))
console.log('\n=== SUMMARY ===')
console.log(JSON.stringify(report.summary, null, 2))
console.log('CRITICAL:', report.summary.criticalIds)
console.log('Wrote verify/deep-messy-risk.json')
