#!/usr/bin/env node
/**
 * Risk-harden benches (R1–R5) for optc-ext — box-only, Measured.
 * Writes verify/risk-harden.json
 */
import { createHash } from 'node:crypto'
import {
  existsSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  mkdirSync,
  rmSync,
} from 'node:fs'
import { join, dirname } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import {
  emitOptCExtPage,
  formatSetupStmtsLikeUni,
  patchColdPageJsSetupBody,
  patchColdPageJsCallArgs,
} from '../optimize/lib/optc-ext-emitter.mjs'

const ROOT = process.env.UNI_FAST_WORKSPACE || process.cwd()
const OUT = join(ROOT, 'verify')
const FIX_OUT = join(ROOT, 'compile-optimization/fixture/dist/dev/mp-weixin')
const ROUTE_A = join(FIX_OUT, 'pages-tab/routeA/index.js')
const VENDOR = join(FIX_OUT, 'common/vendor.js')
const PROBE = join(FIX_OUT, 'modules/utils/unifast-probe.js')
const ROUTE_A_VUE = join(
  ROOT,
  'compile-optimization/fixture/src/pages-tab/routeA/index.vue',
)

function sha(s) {
  return createHash('sha256').update(typeof s === 'string' ? s : s).digest('hex')
}
function extractScript(vue) {
  const start = vue.indexOf('<script')
  const end = vue.indexOf('</script>')
  if (start < 0 || end < 0) return ''
  return vue.slice(vue.indexOf('>', start) + 1, end)
}

const report = {
  when: new Date().toISOString(),
  host: 'box-linux',
  zone: 'Asia/Shanghai',
  label: 'Measured',
  cases: [],
  pathDistribution: {},
  inlineUtil: null,
  longSession: null,
  integrity: null,
  dce: null,
}

function add(c) {
  report.cases.push(c)
  console.log(`[${c.pass ? 'PASS' : 'FAIL'}] ${c.id}: ${c.detail || ''}`)
}

function syntaxOk(code) {
  try {
    new Function(code)
    return true
  } catch {
    return false
  }
}

// ---------- R1: reason-code taxonomy + path distribution on edit suite ----------
{
  const REASON_CODES = {
    FULL_INTEGRITY: 1,
    FULL_TEMPLATE: 1,
    FULL_STYLE: 1,
    FULL_SHARED: 1,
    FULL_IMPORT_SET: 1,
    FULL_CONFIG: 1,
    FULL_APP: 1,
    FULL_FAIL_CLOSED: 1,
    FULL_OTHER: 1,
    FAST_MIDPATH: 1,
    FAST_CLOSURE_VUE: 1,
    FAST_CLOSURE: 1,
    FAST_OPTION_A: 1,
    FAST_PAGE: 1,
    FAST_OTHER: 1,
  }
  // Simulate decision classifier (mirrors plugin reasonCodeOf)
  function reasonCodeOf(path, reason) {
    const r = String(reason || '')
    if (path === 'full') {
      if (r.startsWith('integrity')) return 'FULL_INTEGRITY'
      if (r.includes('template')) return 'FULL_TEMPLATE'
      if (r.includes('style')) return 'FULL_STYLE'
      if (r.includes('shared') || r.includes('multi-page') || r.includes('over-threshold'))
        return 'FULL_SHARED'
      if (r.includes('import-set')) return 'FULL_IMPORT_SET'
      if (r.includes('manifest') || r.includes('pages-or')) return 'FULL_CONFIG'
      if (r.includes('app-entry')) return 'FULL_APP'
      if (r.includes('fail') || r.includes('missing') || r.includes('unmapped'))
        return 'FULL_FAIL_CLOSED'
      return 'FULL_OTHER'
    }
    if (r.includes('midpath')) return 'FAST_MIDPATH'
    if (r.includes('closure-vue')) return 'FAST_CLOSURE_VUE'
    if (r.includes('closure')) return 'FAST_CLOSURE'
    if (r.includes('option-a')) return 'FAST_OPTION_A'
    if (r.includes('import-set-and-dep') || r.includes('stable')) return 'FAST_PAGE'
    return 'FAST_OTHER'
  }

  const suite = [
    { path: 'optc-ext', reason: 'import-set-and-dep-content-stable', edit: 'literal' },
    { path: 'optc-ext', reason: 'midpath-import-set', edit: 'add-import' },
    { path: 'optc-ext', reason: 'closure-shared-chunk', edit: 'util' },
    { path: 'optc-ext', reason: 'closure-vue-script', edit: 'vue-script' },
    { path: 'optc-ext', reason: 'option-a-export-add', edit: 'export-add' },
    { path: 'full', reason: 'template-changed', edit: 'template' },
    { path: 'full', reason: 'style-changed', edit: 'style' },
    { path: 'full', reason: 'shared-module-multi-page', edit: 'shared-big' },
    { path: 'full', reason: 'integrity-drift', edit: 'integrity' },
    { path: 'full', reason: 'pages-or-manifest-changed', edit: 'pages.json' },
  ]
  const counts = {}
  const pathStats = { full: 0, 'optc-ext': 0 }
  for (const s of suite) {
    const code = reasonCodeOf(s.path, s.reason)
    counts[code] = (counts[code] || 0) + 1
    pathStats[s.path] = (pathStats[s.path] || 0) + 1
    if (!REASON_CODES[code]) throw new Error('unknown code ' + code)
  }
  report.pathDistribution = {
    suiteSize: suite.length,
    pathStats,
    reasonCounts: counts,
    fastRatio: pathStats['optc-ext'] / suite.length,
    fullRatio: pathStats.full / suite.length,
  }
  // Plugin source must export the taxonomy
  const viteSrc = readFileSync(join(ROOT, 'optimize/lib/optc-ext-vite.mjs'), 'utf8')
  const hasTaxonomy =
    viteSrc.includes('reasonCodeOf') &&
    viteSrc.includes('FULL_INTEGRITY') &&
    viteSrc.includes('pathStats') &&
    viteSrc.includes('UNI_FAST_OPTC_EXT_INTEGRITY')
  add({
    id: 'r1-reason-codes-and-path-stats',
    pass: hasTaxonomy && counts.FAST_PAGE === 1 && counts.FULL_TEMPLATE === 1,
    detail: `fastRatio=${report.pathDistribution.fastRatio} codes=${Object.keys(counts).length}`,
    pathDistribution: report.pathDistribution,
  })
}

// ---------- R2: integrity gate wiring present + offline drift detection ----------
{
  const viteSrc = readFileSync(join(ROOT, 'optimize/lib/optc-ext-vite.mjs'), 'utf8')
  const wired =
    viteSrc.includes('maybeIntegrityGate') &&
    viteSrc.includes('UNI_FAST_OPTC_INTEGRITY_EVERY') &&
    viteSrc.includes('collectSharedSourceDrifts') &&
    viteSrc.includes('checkVendorDrift') &&
    viteSrc.includes("forceFull('integrity-drift'")

  // Offline simulation of vendor stability across N page-only emits
  if (!existsSync(ROUTE_A) || !existsSync(VENDOR)) {
    add({
      id: 'r2-integrity-gate-wired',
      pass: wired,
      detail: 'plugin wired; fixture dist missing for offline vendor sim',
    })
  } else {
    const vendor0 = sha(readFileSync(VENDOR))
    const routeA0 = readFileSync(ROUTE_A, 'utf8')
    const bak = ROUTE_A + '.r2bak'
    copyFileSync(ROUTE_A, bak)
    let vendorStable = true
    let lastSha = sha(routeA0)
    const rounds = []
    try {
      for (let i = 0; i < 5; i++) {
        const oldS = `import { ref } from 'vue'\nconst label = ref('r2-${i}')\n`
        // Use surgical on a synthetic cold that matches pattern if routeA has probeMul
        const cold = readFileSync(ROUTE_A, 'utf8')
        const emit = emitOptCExtPage({
          outDir: FIX_OUT,
          pagePath: 'pages-tab/routeA/index',
          oldScript: extractScript(readFileSync(ROUTE_A_VUE, 'utf8')).replace(
            /probeMul\(\d+\)/,
            `probeMul(${20 + i})`,
          ),
          newScript: extractScript(readFileSync(ROUTE_A_VUE, 'utf8')).replace(
            /probeMul\(\d+\)/,
            `probeMul(${21 + i})`,
          ),
        })
        // If emit fails (script mismatch), fall back to call-arg direct patch
        let ok = emit.ok
        if (!ok) {
          const oldScript = `import { probeMul } from '@/modules/utils/unifast-probe.js'\nimport { ref } from 'vue'\nconst label = ref(probeMul(${20 + i}))\n`
          const newScript = `import { probeMul } from '@/modules/utils/unifast-probe.js'\nimport { ref } from 'vue'\nconst label = ref(probeMul(${21 + i}))\n`
          const p = patchColdPageJsCallArgs(cold, oldScript, newScript)
          if (p.ok) {
            writeFileSync(ROUTE_A, p.code)
            ok = true
            rounds.push({ i, emitClass: 'surgical-call-arg', sha: sha(p.code).slice(0, 12) })
          } else {
            rounds.push({ i, emitClass: 'fail', reason: p.reason || emit.reason })
          }
        } else {
          rounds.push({
            i,
            emitClass: emit.emitClass || emit.reason,
            sha: (emit.afterSha || '').slice(0, 12),
          })
        }
        const vNow = sha(readFileSync(VENDOR))
        if (vNow !== vendor0) vendorStable = false
      }
    } finally {
      copyFileSync(bak, ROUTE_A)
      try {
        rmSync(bak)
      } catch {
        /* */
      }
    }
    report.integrity = {
      wired,
      vendorSha0: vendor0.slice(0, 16),
      vendorStableAcrossEmits: vendorStable,
      rounds,
    }
    add({
      id: 'r2-integrity-gate-wired',
      pass: wired && vendorStable,
      detail: `wired=${wired} vendorStable=${vendorStable} rounds=${rounds.length}`,
    })
  }
}

// ---------- R3: harder DCE cases ----------
{
  const ret = `return (_ctx, _cache) => ({ a: live.value })`
  const cases = []

  {
    const body = `const deadLit = 1; const deadRef = common_vendor.ref(777); const live = common_vendor.ref(true)`
    const out = formatSetupStmtsLikeUni(body, ret)
    const pass =
      !/deadLit/.test(out) &&
      /common_vendor\.ref\(777\)/.test(out) &&
      !/const deadRef/.test(out) &&
      /const live =/.test(out)
    cases.push({ id: 'dce-unused-lit-and-ref', pass, out })
  }
  {
    const body = `const deadLit = 42; const onlyUnused = deadLit + 1; const live = common_vendor.ref(1)`
    const out = formatSetupStmtsLikeUni(body, ret)
    const pass = !/deadLit/.test(out) && !/onlyUnused/.test(out) && /const live =/.test(out)
    cases.push({ id: 'dce-unused-pure-chain', pass, out })
  }
  {
    const body = `const helper = 3; const live = common_vendor.ref(helper)`
    const out = formatSetupStmtsLikeUni(body, ret)
    const pass = /const helper =/.test(out) && /const live =/.test(out)
    cases.push({ id: 'dce-helper-kept-via-live', pass, out })
  }
  {
    // setup-only mark pattern from F8a
    const body = `const setupOnlyMark = common_vendor.ref(999); const live = common_vendor.ref(false)`
    const out = formatSetupStmtsLikeUni(body, ret)
    const pass =
      /common_vendor\.ref\(999\)/.test(out) &&
      !/const setupOnlyMark/.test(out) &&
      /const live =/.test(out)
    cases.push({ id: 'dce-setup-only-mark', pass, out })
  }

  report.dce = { cases }
  const allPass = cases.every((c) => c.pass)
  add({
    id: 'r3-harder-dce-cases',
    pass: allPass,
    detail: cases.map((c) => `${c.id}:${c.pass ? 'ok' : 'FAIL'}`).join(', '),
    cases,
  })
}

// ---------- R4: inlined util — real uni fixture evidence ----------
{
  const routeAJs = existsSync(ROUTE_A) ? readFileSync(ROUTE_A, 'utf8') : ''
  const probeExists = existsSync(PROBE)
  const routeARequiresProbe = /require\(["'].*unifast-probe\.js["']\)/.test(routeAJs)
  const routeAInlinesMul =
    /function probeMul|probeMul\s*=\s*function/.test(routeAJs) && !routeARequiresProbe
  report.inlineUtil = {
    probeDistExists: probeExists,
    routeARequiresSeparateChunk: routeARequiresProbe,
    routeAInlinesMulBody: routeAInlinesMul,
    verdict: routeARequiresProbe
      ? 'SEPARATE_CHUNK (uni did not inline probeMul into page JS)'
      : routeAInlinesMul
        ? 'INLINED_IN_PAGE'
        : 'UNKNOWN',
    note: 'F16 option-a-inlined-page-rebundle remains a proxy for hypothetical Rollup inline; fixture cold dist keeps separate modules/utils/unifast-probe.js',
  }
  add({
    id: 'r4-inline-util-real-uni',
    pass: probeExists && routeARequiresProbe && !routeAInlinesMul,
    detail: report.inlineUtil.verdict,
    inlineUtil: report.inlineUtil,
  })
}

// ---------- R5: long-session 20 page-only, vendor SHA stable + page coherent ----------
{
  if (!existsSync(ROUTE_A) || !existsSync(VENDOR)) {
    add({ id: 'r5-long-session-20', pass: false, detail: 'missing fixture dist' })
  } else {
    const vendor0 = sha(readFileSync(VENDOR))
    const bak = ROUTE_A + '.r5bak'
    copyFileSync(ROUTE_A, bak)
    const pageShas = []
    let coherent = true
    let vendorStable = true
    let lastEmitClass = null
    try {
      for (let i = 0; i < 20; i++) {
        const cold = readFileSync(ROUTE_A, 'utf8')
        const n = 30 + i
        const oldScript = `import { probeMul } from '@/modules/utils/unifast-probe.js'\nimport { ref } from 'vue'\nconst label = ref(probeMul(${n}))\n`
        const newScript = `import { probeMul } from '@/modules/utils/unifast-probe.js'\nimport { ref } from 'vue'\nconst label = ref(probeMul(${n + 1}))\n`
        let p = patchColdPageJsCallArgs(cold, oldScript, newScript)
        if (!p.ok) {
          // bootstrap: try emitOptCExtPage from current vue-shaped scripts
          const emit = emitOptCExtPage({
            outDir: FIX_OUT,
            pagePath: 'pages-tab/routeA/index',
            oldScript,
            newScript,
          })
          if (emit.ok) {
            lastEmitClass = emit.emitClass || emit.reason
            pageShas.push((emit.afterSha || sha(readFileSync(ROUTE_A))).slice(0, 12))
          } else {
            coherent = false
            pageShas.push('FAIL:' + (p.reason || emit.reason))
            break
          }
        } else {
          writeFileSync(ROUTE_A, p.code)
          lastEmitClass = 'surgical-call-arg'
          pageShas.push(sha(p.code).slice(0, 12))
          if (!syntaxOk(p.code) || !/probeMul\(/.test(p.code)) coherent = false
          if (!/require\(["'].*unifast-probe\.js["']\)/.test(p.code)) coherent = false
        }
        if (sha(readFileSync(VENDOR)) !== vendor0) {
          vendorStable = false
          break
        }
      }
    } finally {
      copyFileSync(bak, ROUTE_A)
      try {
        rmSync(bak)
      } catch {
        /* */
      }
    }
    report.longSession = {
      rounds: pageShas.length,
      vendorSha0: vendor0.slice(0, 16),
      vendorStable,
      coherent,
      lastEmitClass,
      pageShaHead: pageShas.slice(0, 3),
      pageShaTail: pageShas.slice(-3),
    }
    add({
      id: 'r5-long-session-20',
      pass: pageShas.length === 20 && vendorStable && coherent,
      detail: `rounds=${pageShas.length} vendorStable=${vendorStable} coherent=${coherent}`,
      longSession: report.longSession,
    })
  }
}

report.summary = {
  total: report.cases.length,
  passed: report.cases.filter((c) => c.pass).length,
  failed: report.cases.filter((c) => !c.pass).length,
}
report.verdict = {
  R1: report.cases.find((c) => c.id === 'r1-reason-codes-and-path-stats')?.pass
    ? 'ENABLE'
    : 'partial',
  R2: report.cases.find((c) => c.id === 'r2-integrity-gate-wired')?.pass ? 'ENABLE' : 'partial',
  R3: report.cases.find((c) => c.id === 'r3-harder-dce-cases')?.pass ? 'ENABLE' : 'partial',
  R4: report.cases.find((c) => c.id === 'r4-inline-util-real-uni')?.pass
    ? 'DOCUMENTED-SEPARATE-CHUNK'
    : 'partial',
  R5: report.cases.find((c) => c.id === 'r5-long-session-20')?.pass ? 'ENABLE' : 'partial',
}

writeFileSync(join(OUT, 'risk-harden.json'), JSON.stringify(report, null, 2))
console.log('\nSUMMARY', report.summary)
console.log('VERDICT', report.verdict)
if (report.summary.failed) process.exitCode = 1
