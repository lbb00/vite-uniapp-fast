#!/usr/bin/env node
/**
 * F14/F16 Option A offline + optional warm verification (box-only).
 */
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  cpSync,
} from 'node:fs'
import { join, dirname } from 'node:path'
import { performance } from 'node:perf_hooks'
import {
  classifyExportSurfaceChange,
  extractEsmExportNames,
  extractCjsExportNames,
  extractNamedImportsForResolved,
  emitClosureSharedChunkSync,
  emitOptionABatchSync,
  emitOptionANoDistPageRebundleSync,
  patchInlinedUtilInPageJs,
  resolveSharedDistChunk,
} from '../optimize/lib/optc-ext-closure.mjs'

const ROOT = process.env.UNI_FAST_WORKSPACE || process.cwd()
const CCO = join(ROOT, 'compile-optimization')
const FIX_SRC = join(CCO, 'fixture/src')
const FIX_OUT = join(CCO, 'fixture/dist/dev/mp-weixin')
const OUT = join(ROOT, 'verify')
const TMP = join(OUT, 'logs/option-a-tmp')

function sha(s) {
  return createHash('sha256').update(s).digest('hex')
}
function syntaxOk(code) {
  try {
    new Function(code)
    return true
  } catch {
    return false
  }
}

const report = {
  when: new Date().toISOString(),
  host: 'box-linux',
  zone: 'Asia/Shanghai',
  f14: null,
  cases: [],
  walls: {},
}

function add(c) {
  report.cases.push(c)
  console.log(`[${c.pass ? 'PASS' : 'FAIL'}] ${c.id}: ${c.detail || c.reason || ''}`)
}

// --- classify ---
{
  const s1 = classifyExportSurfaceChange(['a'], ['a', 'b'])
  add({
    id: 'f14-classify-add-only',
    pass: s1.kind === 'add-only' && s1.added.join() === 'b',
    detail: JSON.stringify(s1),
  })
  const s2 = classifyExportSurfaceChange(['a'], ['b'])
  add({
    id: 'f14-classify-rename',
    pass: s2.kind === 'rename-or-mixed' && s2.removed.join() === 'a' && s2.added.join() === 'b',
    detail: JSON.stringify(s2),
  })
}

// --- synthetic export-add chunk ---
{
  rmSync(TMP, { recursive: true, force: true })
  const inputDir = join(TMP, 'src')
  const outDir = join(TMP, 'dist')
  mkdirSync(join(inputDir, 'modules/utils'), { recursive: true })
  mkdirSync(join(outDir, 'modules/utils'), { recursive: true })
  mkdirSync(join(outDir, 'pages-tab/routeA'), { recursive: true })

  const srcProbe = join(inputDir, 'modules/utils/unifast-probe.js')
  const distProbe = join(outDir, 'modules/utils/unifast-probe.js')
  const pagePath = 'pages-tab/routeA/index'
  const pageAbs = join(inputDir, 'pages-tab/routeA/index.vue')
  mkdirSync(dirname(pageAbs), { recursive: true })

  writeFileSync(srcProbe, 'export function probeMul(n) {\n  return n\n}\n')
  writeFileSync(
    distProbe,
    '"use strict";\nfunction probeMul(n) {\n  return n;\n}\nexports.probeMul = probeMul;\n',
  )
  const coldPage = `"use strict";
const common_vendor = require("../../common/vendor.js");
const modules_utils_unifastProbe = require("../../modules/utils/unifast-probe.js");
require("../../modules/components/shared-popup/index.js");
const _sfc_main = {
  __name: "index",
  setup(__props) {
    const label = common_vendor.ref(modules_utils_unifastProbe.probeMul(21));
    return () => {};
  }
};
exports.default = _sfc_main;
`
  writeFileSync(join(outDir, 'pages-tab/routeA/index.js'), coldPage)
  // companions
  for (const ext of ['.json', '.wxml', '.wxss']) {
    writeFileSync(join(outDir, 'pages-tab/routeA/index' + ext), '{}')
  }
  mkdirSync(join(outDir, 'common'), { recursive: true })
  mkdirSync(join(outDir, 'modules/components/shared-popup'), { recursive: true })
  writeFileSync(join(outDir, 'common/vendor.js'), '"use strict";\nexports.ref = (v) => ({ value: v });\n')
  writeFileSync(
    join(outDir, 'modules/components/shared-popup/index.js'),
    '"use strict";\nexports.default = {};\n',
  )

  const oldScript =
    'import {ref} from "vue";import Shared from "@/modules/components/shared-popup/index.vue";import {probeMul} from "@/modules/utils/unifast-probe.js";const label=ref(probeMul(21))'
  writeFileSync(
    pageAbs,
    `<template><view/></template><script setup>${oldScript}</script>`,
  )

  // Export add on util only
  writeFileSync(
    srcProbe,
    'export function probeMul(n) {\n  return n\n}\nexport function probeAdd(n){return n}\n',
  )
  const t0 = performance.now()
  const addOnly = emitClosureSharedChunkSync({
    inputDir,
    outDir,
    sourceAbs: srcProbe,
    allowExportAdd: true,
  })
  const addMs = performance.now() - t0
  report.walls.exportAddChunkMs = addMs
  const distAfter = readFileSync(distProbe, 'utf8')
  add({
    id: 'f14-export-add-chunk',
    pass:
      addOnly.ok &&
      addOnly.exportSurfaceMode === 'add-only' &&
      /exports\.probeAdd\s*=/.test(distAfter) &&
      /exports\.probeMul\s*=/.test(distAfter) &&
      syntaxOk(distAfter),
    detail: `ms=${addMs.toFixed(2)} mode=${addOnly.exportSurfaceMode} reason=${addOnly.reason}`,
    wallMs: addMs,
  })

  // Strict mode still fail-closed without allowExportAdd
  writeFileSync(
    distProbe,
    '"use strict";\nfunction probeMul(n) {\n  return n;\n}\nexports.probeMul = probeMul;\n',
  )
  writeFileSync(
    srcProbe,
    'export function probeMul(n) {\n  return n\n}\nexport function probeAdd(n){return n}\n',
  )
  const strict = emitClosureSharedChunkSync({
    inputDir,
    outDir,
    sourceAbs: srcProbe,
  })
  add({
    id: 'f14-export-add-fail-closed-without-flag',
    pass: !strict.ok && strict.reason === 'closure-export-surface-changed' && strict.optionACandidate,
    detail: strict.reason,
  })

  // Restore dist with add, then Option A batch: util already has add + page uses probeAdd
  writeFileSync(
    distProbe,
    '"use strict";\nfunction probeMul(n) {\n  return n;\n}\nexports.probeMul = probeMul;\n',
  )
  writeFileSync(
    srcProbe,
    'export function probeMul(n) {\n  return n\n}\nexport function probeAdd(n){return n}\n',
  )
  const newScript =
    'import {ref} from "vue";import Shared from "@/modules/components/shared-popup/index.vue";import {probeMul,probeAdd} from "@/modules/utils/unifast-probe.js";const label=ref(probeAdd(probeMul(21)))'
  writeFileSync(
    pageAbs,
    `<template><view/></template><script setup>${newScript}</script>`,
  )

  const used = extractNamedImportsForResolved(newScript, pageAbs, inputDir, srcProbe)
  add({
    id: 'f14-extract-named-imports',
    pass: used.includes('probeMul') && used.includes('probeAdd'),
    detail: used.join(','),
  })

  const t1 = performance.now()
  const batch = emitOptionABatchSync({
    inputDir,
    outDir,
    sourceAbs: srcProbe,
    pageUpdates: [
      {
        pagePath,
        pageAbs,
        oldScript,
        newScript,
      },
    ],
    allowExportAdd: true,
    allowExportSurfaceChange: false, // add-only
  })
  const batchMs = performance.now() - t1
  report.walls.optionABatchMs = batchMs
  const pageJs = readFileSync(join(outDir, pagePath + '.js'), 'utf8')
  const pageOk =
    batch.ok &&
    /probeAdd/.test(pageJs) &&
    syntaxOk(pageJs) &&
    (batch.pageResults || []).some((p) => p.ok && p.emitClass && p.emitClass !== 'noop')
  add({
    id: 'f14-option-a-batch-add-plus-page',
    pass: pageOk,
    detail: `ms=${batchMs.toFixed(2)} files=${batch.filesWritten} pages=${JSON.stringify(batch.pageResults)} chunkMode=${batch.exportSurfaceMode}`,
    wallMs: batchMs,
    afterSha: batch.afterSha,
  })

  // Rename path: probeMul → probeMul2 + page update
  writeFileSync(
    distProbe,
    '"use strict";\nfunction probeMul(n) {\n  return n;\n}\nexports.probeMul = probeMul;\n',
  )
  writeFileSync(
    join(outDir, pagePath + '.js'),
    coldPage,
  )
  writeFileSync(
    srcProbe,
    'export function probeMul2(n) {\n  return n * 2\n}\n',
  )
  const renameOld =
    'import {ref} from "vue";import Shared from "@/modules/components/shared-popup/index.vue";import {probeMul} from "@/modules/utils/unifast-probe.js";const label=ref(probeMul(21))'
  const renameNew =
    'import {ref} from "vue";import Shared from "@/modules/components/shared-popup/index.vue";import {probeMul2} from "@/modules/utils/unifast-probe.js";const label=ref(probeMul2(21))'
  const t2 = performance.now()
  const ren = emitOptionABatchSync({
    inputDir,
    outDir,
    sourceAbs: srcProbe,
    pageUpdates: [
      { pagePath, pageAbs, oldScript: renameOld, newScript: renameNew },
    ],
    allowExportAdd: true,
    allowExportSurfaceChange: true,
  })
  const renMs = performance.now() - t2
  report.walls.optionARenameMs = renMs
  const distRen = readFileSync(distProbe, 'utf8')
  const pageRen = readFileSync(join(outDir, pagePath + '.js'), 'utf8')
  add({
    id: 'f14-option-a-rename-plus-page',
    pass:
      ren.ok &&
      /exports\.probeMul2\s*=/.test(distRen) &&
      !/exports\.probeMul\s*=/.test(distRen) &&
      /probeMul2/.test(pageRen) &&
      syntaxOk(distRen) &&
      syntaxOk(pageRen),
    detail: `ms=${renMs.toFixed(2)} surface=${ren.exportSurfaceMode} pages=${JSON.stringify(ren.pageResults?.map((p) => p.emitClass))}`,
    wallMs: renMs,
  })

  // Fail-closed: rename util but page still uses old name
  writeFileSync(
    distProbe,
    '"use strict";\nfunction probeMul(n) {\n  return n;\n}\nexports.probeMul = probeMul;\n',
  )
  writeFileSync(srcProbe, 'export function probeMul2(n) {\n  return n\n}\n')
  const bad = emitOptionABatchSync({
    inputDir,
    outDir,
    sourceAbs: srcProbe,
    pageUpdates: [
      { pagePath, pageAbs, oldScript: renameOld, newScript: renameOld },
    ],
    allowExportSurfaceChange: true,
  })
  add({
    id: 'f14-option-a-rename-page-stale-fail-closed',
    pass: !bad.ok && bad.reason === 'option-a-page-imports-missing-export',
    detail: bad.reason,
  })
}

// --- fixture cold dist spot (if present) ---
{
  const probeSrc = join(FIX_SRC, 'modules/utils/unifast-probe.js')
  const probeDist = join(FIX_OUT, 'modules/utils/unifast-probe.js')
  if (existsSync(probeSrc) && existsSync(probeDist)) {
    const bakSrc = readFileSync(probeSrc, 'utf8')
    const bakDist = readFileSync(probeDist, 'utf8')
    try {
      if (!bakSrc.includes('probeAdd')) {
        writeFileSync(
          probeSrc,
          bakSrc.trimEnd() + '\nexport function probeAdd(n){return n}\n',
        )
      }
      const t0 = performance.now()
      const r = emitClosureSharedChunkSync({
        inputDir: FIX_SRC,
        outDir: FIX_OUT,
        sourceAbs: probeSrc,
        allowExportAdd: true,
      })
      const ms = performance.now() - t0
      report.walls.fixtureExportAddMs = ms
      add({
        id: 'f14-fixture-export-add-chunk',
        pass: r.ok && (r.exportSurfaceMode === 'add-only' || r.exportSurfaceMode === 'same'),
        detail: `ms=${ms.toFixed(2)} mode=${r.exportSurfaceMode} reason=${r.reason}`,
        wallMs: ms,
      })
    } finally {
      writeFileSync(probeSrc, bakSrc)
      writeFileSync(probeDist, bakDist)
    }
  } else {
    add({ id: 'f14-fixture-export-add-chunk', pass: true, skipped: true, detail: 'SKIP no fixture dist' })
  }
}


// --- F16 no-dist / inlined util page rebundle (proxy-for-inlined) ---
{
  const TMP16 = join(OUT, 'logs/option-a-f16-tmp')
  rmSync(TMP16, { recursive: true, force: true })
  const inputDir = join(TMP16, 'src')
  const outDir = join(TMP16, 'dist')
  mkdirSync(join(inputDir, 'modules/utils'), { recursive: true })
  mkdirSync(join(inputDir, 'pages-tab/routeA'), { recursive: true })
  mkdirSync(join(inputDir, 'pages-tab/pkg0'), { recursive: true })
  mkdirSync(join(outDir, 'pages-tab/routeA'), { recursive: true })
  mkdirSync(join(outDir, 'pages-tab/pkg0'), { recursive: true })
  mkdirSync(join(outDir, 'common'), { recursive: true })
  mkdirSync(join(outDir, 'modules/components/shared-popup'), { recursive: true })

  const srcUtil = join(inputDir, 'modules/utils/unifast-inline-hint.js')
  writeFileSync(srcUtil, 'export function inlineHint(n) {\n  return n + 1\n}\n')
  // deliberately NO dist chunk for util
  writeFileSync(join(outDir, 'common/vendor.js'), '"use strict";\nexports.ref=(v)=>({value:v});\n')
  writeFileSync(
    join(outDir, 'modules/components/shared-popup/index.js'),
    '"use strict";\nexports.default={};\n',
  )

  function makeCold(extra = '') {
    return `"use strict";
const common_vendor = require("../../common/vendor.js");
require("../../modules/components/shared-popup/index.js");
function inlineHint(n) {
  return n + 1;
}
${extra}const _sfc_main = {
  __name: "index",
  setup(__props) {
    const label = common_vendor.ref(inlineHint(21));
    return () => {};
  }
};
exports.default = _sfc_main;
`
  }

  writeFileSync(join(outDir, 'pages-tab/routeA/index.js'), makeCold())
  for (const ext of ['.json', '.wxml', '.wxss']) {
    writeFileSync(join(outDir, 'pages-tab/routeA/index' + ext), '{}')
    writeFileSync(join(outDir, 'pages-tab/pkg0/p1' + ext), '{}')
  }
  writeFileSync(join(outDir, 'pages-tab/pkg0/p1.js'), makeCold())

  const script =
    'import {ref} from "vue";import Shared from "@/modules/components/shared-popup/index.vue";import {inlineHint} from "@/modules/utils/unifast-inline-hint.js";const label=ref(inlineHint(21))'
  const routeAAbs = join(inputDir, 'pages-tab/routeA/index.vue')
  const p1Abs = join(inputDir, 'pages-tab/pkg0/p1.vue')
  writeFileSync(routeAAbs, `<template><view/></template><script setup>${script}</script>`)
  writeFileSync(p1Abs, `<template><view/></template><script setup>${script}</script>`)

  add({
    id: 'f16-no-dist-detected',
    pass: resolveSharedDistChunk(inputDir, outDir, srcUtil) == null,
    detail: 'resolveSharedDistChunk=null',
  })

  // util body change → page-only patch
  writeFileSync(srcUtil, 'export function inlineHint(n) {\n  return n + 99\n}\n')
  const t0 = performance.now()
  const r1 = emitOptionANoDistPageRebundleSync({
    inputDir,
    outDir,
    sourceAbs: srcUtil,
    pageUpdates: [
      { pagePath: 'pages-tab/routeA/index', pageAbs: routeAAbs, oldScript: script, newScript: script },
      { pagePath: 'pages-tab/pkg0/p1', pageAbs: p1Abs, oldScript: script, newScript: script },
    ],
  })
  const ms1 = performance.now() - t0
  report.walls.f16InlinedTwoPagesMs = ms1
  const routeAJs = readFileSync(join(outDir, 'pages-tab/routeA/index.js'), 'utf8')
  const p1Js = readFileSync(join(outDir, 'pages-tab/pkg0/p1.js'), 'utf8')
  const vendorBefore = sha(readFileSync(join(outDir, 'common/vendor.js')))
  add({
    id: 'f16-inlined-util-page-rebundle',
    pass:
      r1.ok &&
      r1.proxyForInlined === true &&
      r1.filesWritten === 2 &&
      /n \+ 99/.test(routeAJs) &&
      /n \+ 99/.test(p1Js) &&
      syntaxOk(routeAJs) &&
      syntaxOk(p1Js) &&
      !existsSync(join(outDir, 'modules/utils/unifast-inline-hint.js')),
    detail: `ms=${ms1.toFixed(2)} files=${r1.filesWritten} reason=${r1.reason} pages=${JSON.stringify(r1.pageResults?.map((p) => p.patchedFns))}`,
    wallMs: ms1,
  })
  add({
    id: 'f16-only-page-js-changed',
    pass: sha(readFileSync(join(outDir, 'common/vendor.js'))) === vendorBefore,
    detail: 'vendor sha stable',
  })

  // fail-closed: no anchor in page
  writeFileSync(join(outDir, 'pages-tab/routeA/index.js'), makeCold().replace(/function inlineHint[\s\S]*?\n\}/, ''))
  writeFileSync(srcUtil, 'export function inlineHint(n) {\n  return n + 3\n}\n')
  const bad = emitOptionANoDistPageRebundleSync({
    inputDir,
    outDir,
    sourceAbs: srcUtil,
    pageUpdates: [
      { pagePath: 'pages-tab/routeA/index', pageAbs: routeAAbs, oldScript: script, newScript: script },
    ],
  })
  add({
    id: 'f16-no-anchor-fail-closed',
    pass: !bad.ok && bad.reason === 'option-a-inlined-no-anchor',
    detail: bad.reason,
  })

  // fail-closed: dist exists → refuse this path
  mkdirSync(join(outDir, 'modules/utils'), { recursive: true })
  writeFileSync(
    join(outDir, 'modules/utils/unifast-inline-hint.js'),
    '"use strict";\nfunction inlineHint(n){return n+1}\nexports.inlineHint=inlineHint;\n',
  )
  writeFileSync(join(outDir, 'pages-tab/routeA/index.js'), makeCold())
  writeFileSync(srcUtil, 'export function inlineHint(n) {\n  return n + 7\n}\n')
  const distExists = emitOptionANoDistPageRebundleSync({
    inputDir,
    outDir,
    sourceAbs: srcUtil,
    pageUpdates: [
      { pagePath: 'pages-tab/routeA/index', pageAbs: routeAAbs, oldScript: script, newScript: script },
    ],
  })
  add({
    id: 'f16-dist-exists-fail-closed',
    pass: !distExists.ok && distExists.reason === 'option-a-inlined-dist-exists',
    detail: distExists.reason,
  })

  // patch helper unit
  const p = patchInlinedUtilInPageJs(
    'function inlineHint(n) {\n  return n + 1;\n}\n',
    'export function inlineHint(n) {\n  return n + 42\n}\n',
  )
  add({
    id: 'f16-patch-helper',
    pass: p.ok && p.changed && /n \+ 42/.test(p.code),
    detail: `patched=${p.patched}`,
  })
}

const passed = report.cases.filter((c) => c.pass).length
const failed = report.cases.filter((c) => !c.pass).length
report.f14 =
  failed === 0
    ? 'ENABLE'
    : report.cases.some((c) => c.id.includes('batch') && c.pass)
      ? 'PARTIAL'
      : 'BLOCKED'
const f16pass = report.cases.filter((c) => c.id.startsWith('f16-') && c.pass).length
const f16total = report.cases.filter((c) => c.id.startsWith('f16-')).length
report.f16 =
  f16total && f16pass === f16total
    ? 'ENABLE'
    : f16pass
      ? 'PARTIAL'
      : 'BLOCKED'
report.summary = {
  passed,
  failed,
  total: report.cases.length,
  verdict: report.f14,
  f16: report.f16,
  f16pass,
  f16total,
}

writeFileSync(join(OUT, 'option-a.json'), JSON.stringify(report, null, 2))
console.log('\nF14 verdict:', report.f14, `${passed}/${report.cases.length}`)
process.exit(failed ? 1 : 0)
