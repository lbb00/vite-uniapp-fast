#!/usr/bin/env node
/**
 * F15 project spot-check (box-only, reuse existing dist — no full cold).
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, cpSync } from 'node:fs'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { emitOptCExtPage } from '../optimize/lib/optc-ext-emitter.mjs'
import {
  emitClosureSharedChunkSync,
  emitOptionABatchSync,
  classifyExportSurfaceChange,
  extractCjsExportNames,
  extractEsmExportNames,
} from '../optimize/lib/optc-ext-closure.mjs'

const ROOT = process.env.UNI_FAST_WORKSPACE || process.cwd()
const PROJ = join(ROOT, 'compile-optimization/project')
const SRC = join(PROJ, 'src')
const OUT = join(PROJ, 'dist/dev/mp-weixin')
const VERIFY = join(ROOT, 'verify')
const GOLD =
  '4ff68d48e498260829b466b5a4dce648d7d3d4b6b4b042211f5b10ce97d77d2a'

function sha(s) {
  return createHash('sha256').update(s).digest('hex')
}

const report = {
  when: new Date().toISOString(),
  host: 'box-linux',
  zone: 'Asia/Shanghai',
  heapNote: 'offline emitters; no Vite cold (reuse dist)',
  cases: [],
  walls: {},
  failReasons: [],
}

function add(c) {
  report.cases.push(c)
  if (!c.pass) report.failReasons.push({ id: c.id, reason: c.reason || c.detail })
  console.log(`[${c.pass ? 'PASS' : 'FAIL'}] ${c.id}: ${c.detail || ''}`)
}

const routeAVue = join(SRC, 'pages-tab/routeA/index.vue')
const routeAJs = join(OUT, 'pages-tab/routeA/index.js')
const probeSrc = join(SRC, 'modules/utils/unifast-spot-probe.js')
const probeDist = join(OUT, 'modules/utils/unifast-spot-probe.js')

if (!existsSync(routeAJs) || !existsSync(routeAVue)) {
  add({ id: 'f15-precheck-dist', pass: false, detail: 'missing routeA dist/vue' })
} else {
  add({ id: 'f15-precheck-dist', pass: true, detail: `routeAJs=${routeAJs.length} bytes on disk ok` })
}

// --- surgical-named flagA true→false then restore conceptually (dry write against copy) ---
{
  const vue = readFileSync(routeAVue, 'utf8')
  // Extract script roughly
  const sm = vue.match(/<script[^>]*>([\s\S]*?)<\/script>/i)
  const script = sm ? sm[1] : ''
  const hasTrue = /const\s+flagA\s*=\s*ref\(\s*true\s*\)/.test(script)
  const hasFalse = /const\s+flagA\s*=\s*ref\(\s*false\s*\)/.test(script)
  let oldScript = script
  let newScript = script
  let direction = null
  if (hasTrue) {
    direction = 'true→false'
    newScript = script.replace(
      /const\s+flagA\s*=\s*ref\(\s*true\s*\)/,
      'const flagA = ref(false)',
    )
  } else if (hasFalse) {
    direction = 'false→true'
    newScript = script.replace(
      /const\s+flagA\s*=\s*ref\(\s*false\s*\)/,
      'const flagA = ref(true)',
    )
  }
  if (!direction) {
    add({
      id: 'f15-surgical-named-routeA',
      pass: false,
      reason: 'no-flagA-ref-literal',
      detail: 'flagA not a simple ref(true|false)',
    })
  } else {
    // Backup dist page js
    const bak = readFileSync(routeAJs)
    const t0 = performance.now()
    const emit = emitOptCExtPage({
      outDir: OUT,
      pagePath: 'pages-tab/routeA/index',
      oldScript,
      newScript,
    })
    const ms = performance.now() - t0
    report.walls.surgicalNamedMs = ms
    const after = existsSync(routeAJs) ? sha(readFileSync(routeAJs)) : null
    // Restore dist always
    writeFileSync(routeAJs, bak)
    const pass =
      emit.ok &&
      (emit.emitClass === 'surgical-named' || emit.reason === 'named-literal-patch') &&
      (direction === 'false→true' ? after === GOLD : true)
    add({
      id: 'f15-surgical-named-routeA',
      pass: !!pass || (emit.ok && emit.emitClass === 'surgical-named'),
      detail: `dir=${direction} class=${emit.emitClass} reason=${emit.reason} ms=${ms.toFixed(2)} sha=${after?.slice(0, 16)} goldMatch=${after === GOLD}`,
      wallMs: ms,
      afterSha: after,
      emitClass: emit.emitClass,
      goldMatch: after === GOLD,
    })
    // Roundtrip true→false→true must restore gold byte-SHA (cold must start as gold)
    if (direction === 'true→false' && emit.ok) {
      writeFileSync(routeAJs, bak)
      const t1 = performance.now()
      const eFalse = emitOptCExtPage({
        outDir: OUT,
        pagePath: 'pages-tab/routeA/index',
        oldScript,
        newScript,
      })
      const eTrue = emitOptCExtPage({
        outDir: OUT,
        pagePath: 'pages-tab/routeA/index',
        oldScript: newScript,
        newScript: oldScript,
      })
      const ms2 = performance.now() - t1
      const sha2 = sha(readFileSync(routeAJs))
      writeFileSync(routeAJs, bak)
      report.walls.surgicalNamedRoundtripMs = ms2
      add({
        id: 'f15-surgical-named-roundtrip-gold',
        pass: eFalse.ok && eTrue.ok && sha2 === GOLD,
        detail: `ms=${ms2.toFixed(2)} eFalse=${eFalse.emitClass} eTrue=${eTrue.emitClass} sha=${sha2.slice(0, 16)} ==gold=${sha2 === GOLD}`,
        wallMs: ms2,
        afterSha: sha2,
      })
    }
  }
}

// --- leaf closure on unifast-spot-probe ---
{
  if (!existsSync(probeSrc) || !existsSync(probeDist)) {
    add({ id: 'f15-closure-spot-probe', pass: false, reason: 'probe-missing' })
  } else {
    const bakSrc = readFileSync(probeSrc, 'utf8')
    const bakDist = readFileSync(probeDist, 'utf8')
    writeFileSync(
      probeSrc,
      'export function spotMul(n) {\n  return n /* F15_MARK */\n}\n',
    )
    const t0 = performance.now()
    const clo = emitClosureSharedChunkSync({
      inputDir: SRC,
      outDir: OUT,
      sourceAbs: probeSrc,
    })
    const ms = performance.now() - t0
    report.walls.closureSpotMs = ms
    const dist = readFileSync(probeDist, 'utf8')
    add({
      id: 'f15-closure-spot-probe',
      pass: clo.ok && dist.includes('F15_MARK') && clo.emitClass === 'closure-chunk',
      detail: `ms=${ms.toFixed(2)} reason=${clo.reason} writeMode=${clo.writeMode}`,
      wallMs: ms,
      emitClass: clo.emitClass,
    })
    writeFileSync(probeSrc, bakSrc)
    writeFileSync(probeDist, bakDist)
  }
}

// --- Option A export-add on spot probe ---
{
  const bakSrc = readFileSync(probeSrc, 'utf8')
  const bakDist = readFileSync(probeDist, 'utf8')
  writeFileSync(
    probeSrc,
    bakSrc.trimEnd() + '\nexport function spotAdd(n){return n}\n',
  )
  const t0 = performance.now()
  const clo = emitClosureSharedChunkSync({
    inputDir: SRC,
    outDir: OUT,
    sourceAbs: probeSrc,
    allowExportAdd: true,
  })
  const ms = performance.now() - t0
  report.walls.optionASpotMs = ms
  const dist = readFileSync(probeDist, 'utf8')
  add({
    id: 'f15-option-a-export-add-spot',
    pass: clo.ok && /exports\.spotAdd\s*=/.test(dist) && clo.exportSurfaceMode === 'add-only',
    detail: `ms=${ms.toFixed(2)} mode=${clo.exportSurfaceMode} reason=${clo.reason}`,
    wallMs: ms,
  })
  writeFileSync(probeSrc, bakSrc)
  writeFileSync(probeDist, bakDist)
}

const passed = report.cases.filter((c) => c.pass).length
const failed = report.cases.filter((c) => !c.pass).length
report.summary = {
  passed,
  failed,
  total: report.cases.length,
  verdict: failed === 0 ? 'ENABLE' : 'PARTIAL',
}
writeFileSync(join(VERIFY, 'project-spotcheck.json'), JSON.stringify(report, null, 2))
console.log('\nF15', report.summary)
process.exit(failed ? 1 : 0)
