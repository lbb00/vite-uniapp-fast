#!/usr/bin/env node
/**
 * F10–F12 advance verification (box-only).
 * Offline unit + optional warm (set RUN_WARM=1 after cold dist present).
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
  parseStaticImports,
  transformUtilEsmToCjs,
  emitClosureSharedChunkSync,
  emitClosureMultiChunkSync,
  emitClosureVueComponentSync,
  extractEsmExportNames,
  extractCjsExportNames,
  findUtilImportersOf,
  resolveSharedDistChunk,
} from '../optimize/lib/optc-ext-closure.mjs'

const ROOT = process.env.UNI_FAST_WORKSPACE || process.cwd()
const CCO = join(ROOT, 'compile-optimization')
const FIX_SRC = join(CCO, 'fixture/src')
const FIX_OUT = join(CCO, 'fixture/dist/dev/mp-weixin')
const OUT = join(ROOT, 'verify')
const TMP = join(OUT, 'logs/closure-advance-tmp')

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
  f10: null,
  f11: null,
  f12: null,
  cases: [],
  walls: {},
}

function add(c) {
  report.cases.push(c)
  console.log(`[${c.pass ? 'PASS' : 'FAIL'}] ${c.id}: ${c.detail || c.reason || ''}`)
}

// ---------- F10 offline synthetic ----------
{
  rmSync(TMP, { recursive: true, force: true })
  const inputDir = join(TMP, 'src')
  const outDir = join(TMP, 'dist')
  mkdirSync(join(inputDir, 'modules/utils'), { recursive: true })
  mkdirSync(join(outDir, 'modules/utils'), { recursive: true })

  const srcB = join(inputDir, 'modules/utils/unifast-chain-b.js')
  const srcA = join(inputDir, 'modules/utils/unifast-chain-a.js')
  const distB = join(outDir, 'modules/utils/unifast-chain-b.js')
  const distA = join(outDir, 'modules/utils/unifast-chain-a.js')

  writeFileSync(
    srcB,
    'export function chainBase(n) {\n  return n\n}\n',
  )
  writeFileSync(
    srcA,
    "import { chainBase } from './unifast-chain-b.js'\nexport function chainMul(n) {\n  return chainBase(n)\n}\n",
  )
  writeFileSync(
    distB,
    '"use strict";\nfunction chainBase(n) {\n  return n;\n}\nexports.chainBase = chainBase;\n',
  )
  writeFileSync(
    distA,
    '"use strict";\nconst { chainBase } = require("./unifast-chain-b.js");\nfunction chainMul(n) {\n  return chainBase(n);\n}\nexports.chainMul = chainMul;\n',
  )

  const parsed = parseStaticImports(readFileSync(srcA, 'utf8'))
  add({
    id: 'f10-parse-static-import',
    pass: parsed.ok && parsed.imports.length === 1,
    detail: `imports=${parsed.imports.length}`,
  })

  // Old transform without opts should fail-closed on imports
  const bare = transformUtilEsmToCjs(readFileSync(srcA, 'utf8'))
  add({
    id: 'f10-transform-without-opts-fail-closed',
    pass: !bare.ok && bare.reason === 'closure-source-has-imports',
    detail: `reason=${bare.reason}`,
  })

  const withOpts = transformUtilEsmToCjs(readFileSync(srcA, 'utf8'), {
    inputDir,
    outDir,
    sourceAbs: srcA,
    distFile: distA,
  })
  add({
    id: 'f10-transform-with-requires',
    pass:
      withOpts.ok &&
      withOpts.importCount === 1 &&
      /require\("\.\/unifast-chain-b\.js"\)/.test(withOpts.code) &&
      syntaxOk(withOpts.code),
    detail: `ok=${withOpts.ok} importCount=${withOpts.importCount} mode=requires`,
  })

  // Body mark → cold-body-patch-with-imports preferred
  writeFileSync(
    srcA,
    "import { chainBase } from './unifast-chain-b.js'\nexport function chainMul(n) {\n  return chainBase(n) /* F10_MARK */\n}\n",
  )
  const beforeA = sha(readFileSync(distA))
  const beforeB = sha(readFileSync(distB))
  const t0 = performance.now()
  const clo = emitClosureSharedChunkSync({
    inputDir,
    outDir,
    sourceAbs: srcA,
    dryRun: false,
  })
  const ms = performance.now() - t0
  const afterA = sha(readFileSync(distA))
  const afterB = sha(readFileSync(distB))
  const onlyA = beforeA !== afterA && beforeB === afterB
  add({
    id: 'f10-closure-util-with-import',
    pass:
      clo.ok &&
      clo.emitClass === 'closure-chunk' &&
      onlyA &&
      /F10_MARK/.test(readFileSync(distA, 'utf8')) &&
      ms < 50,
    emitClass: clo.emitClass,
    detail: `ok=${clo.ok} writeMode=${clo.writeMode} importCount=${clo.importCount} onlyA=${onlyA} ms=${ms.toFixed(2)}`,
    wallMs: ms,
    beforeSha: beforeA,
    afterSha: afterA,
  })
  report.walls.f10_offline_ms = ms
  report.f10 = {
    verdict: clo.ok && onlyA ? 'ENABLE' : 'BLOCKED',
    writeMode: clo.writeMode,
    wallMs: ms,
    onlyChunkChanged: onlyA,
  }

  // unresolved external fail-closed
  writeFileSync(
    srcA,
    "import { missing } from './no-such.js'\nexport function chainMul(n) {\n  return n\n}\n",
  )
  // keep export surface match for cold
  writeFileSync(
    distA,
    '"use strict";\nfunction chainMul(n) {\n  return n;\n}\nexports.chainMul = chainMul;\n',
  )
  const bad = emitClosureSharedChunkSync({
    inputDir,
    outDir,
    sourceAbs: srcA,
    dryRun: true,
  })
  add({
    id: 'f10-unresolved-fail-closed',
    pass:
      !bad.ok &&
      (bad.reason === 'closure-unresolved-import' ||
        bad.reason === 'closure-external-dist-missing'),
    detail: `reason=${bad.reason}`,
  })

  // dynamic import
  writeFileSync(
    srcA,
    "export async function chainMul(n) {\n  const m = await import('./unifast-chain-b.js')\n  return m.chainBase(n)\n}\n",
  )
  // export name still chainMul — but dynamic
  const dyn = parseStaticImports(readFileSync(srcA, 'utf8'))
  add({
    id: 'f10-dynamic-import-fail-closed',
    pass: !dyn.ok && dyn.reason === 'closure-dynamic-import',
    detail: `reason=${dyn.reason}`,
  })
}

// ---------- F11 leaf + multi-chunk offline ----------
{
  const inputDir = join(TMP, 'src')
  const outDir = join(TMP, 'dist')
  const srcB = join(inputDir, 'modules/utils/unifast-chain-b.js')
  const srcA = join(inputDir, 'modules/utils/unifast-chain-a.js')
  const distB = join(outDir, 'modules/utils/unifast-chain-b.js')
  const distA = join(outDir, 'modules/utils/unifast-chain-a.js')

  // restore good sources + dist
  writeFileSync(srcB, 'export function chainBase(n) {\n  return n\n}\n')
  writeFileSync(
    srcA,
    "import { chainBase } from './unifast-chain-b.js'\nexport function chainMul(n) {\n  return chainBase(n)\n}\n",
  )
  writeFileSync(
    distB,
    '"use strict";\nfunction chainBase(n) {\n  return n;\n}\nexports.chainBase = chainBase;\n',
  )
  writeFileSync(
    distA,
    '"use strict";\nconst { chainBase } = require("./unifast-chain-b.js");\nfunction chainMul(n) {\n  return chainBase(n);\n}\nexports.chainMul = chainMul;\n',
  )

  const utilImps = findUtilImportersOf(inputDir, srcB)
  add({
    id: 'f11-find-util-importers',
    pass: utilImps.some((p) => p.endsWith('unifast-chain-a.js')),
    detail: `importers=${utilImps.map((p) => p.split('/').pop()).join(',')}`,
  })

  writeFileSync(srcB, 'export function chainBase(n) {\n  return n /* F11_MARK */\n}\n')
  const beforeA = sha(readFileSync(distA))
  const beforeB = sha(readFileSync(distB))
  const t0 = performance.now()
  const clo = emitClosureSharedChunkSync({
    inputDir,
    outDir,
    sourceAbs: srcB,
    dryRun: false,
  })
  const ms = performance.now() - t0
  const afterA = sha(readFileSync(distA))
  const afterB = sha(readFileSync(distB))
  const onlyB = beforeB !== afterB && beforeA === afterA
  add({
    id: 'f11-leaf-chunk-only',
    pass: clo.ok && onlyB && /F11_MARK/.test(readFileSync(distB, 'utf8')) && ms < 50,
    detail: `ok=${clo.ok} writeMode=${clo.writeMode} onlyB=${onlyB} ms=${ms.toFixed(2)}`,
    wallMs: ms,
  })
  report.walls.f11_leaf_ms = ms

  // multi-chunk API: regen A after restoring A mark (B already marked OK)
  writeFileSync(
    srcA,
    "import { chainBase } from './unifast-chain-b.js'\nexport function chainMul(n) {\n  return chainBase(n) /* F11_MULTI */\n}\n",
  )
  const multi = emitClosureMultiChunkSync({
    inputDir,
    outDir,
    sourceAbs: srcA,
    alsoRegenSources: [srcB],
    dryRun: false,
  })
  add({
    id: 'f11-multi-chunk-regen',
    pass:
      multi.ok &&
      multi.emitClass === 'closure-multi-chunk' &&
      (multi.filesWritten || 0) >= 1 &&
      /F11_MULTI/.test(readFileSync(distA, 'utf8')),
    detail: `ok=${multi.ok} filesWritten=${multi.filesWritten} class=${multi.emitClass} ms=${multi.timings?.totalMs?.toFixed?.(2)}`,
    wallMs: multi.timings?.totalMs,
  })
  report.f11 = {
    verdict: clo.ok && onlyB && multi.ok ? 'ENABLE' : 'PARTIAL',
    leafOnlyChunk: onlyB,
    multiOk: multi.ok,
    optionA: 'BLOCKED (documented: inlined-util rebundle not implemented)',
    wallMsLeaf: ms,
    wallMsMulti: multi.timings?.totalMs,
  }

  // Option A candidacy: dist missing
  const missing = emitClosureSharedChunkSync({
    inputDir,
    outDir,
    sourceAbs: join(inputDir, 'modules/utils/no-dist.js'),
    dryRun: true,
  })
  // create source without dist
  writeFileSync(join(inputDir, 'modules/utils/no-dist.js'), 'export function x(){return 1}\n')
  const missing2 = emitClosureSharedChunkSync({
    inputDir,
    outDir,
    sourceAbs: join(inputDir, 'modules/utils/no-dist.js'),
    dryRun: true,
  })
  add({
    id: 'f11-option-a-candidate-dist-missing',
    pass: !missing2.ok && missing2.reason === 'closure-dist-chunk-missing' && missing2.optionACandidate,
    detail: `reason=${missing2.reason} optionACandidate=${missing2.optionACandidate}`,
  })
}

// ---------- F12 Vue offline ----------
{
  const inputDir = join(TMP, 'src')
  const outDir = join(TMP, 'dist')
  const vueDir = join(inputDir, 'modules/components/mini-shared')
  mkdirSync(vueDir, { recursive: true })
  mkdirSync(join(outDir, 'modules/components/mini-shared'), { recursive: true })
  const vuePath = join(vueDir, 'index.vue')
  const distJs = join(outDir, 'modules/components/mini-shared/index.js')
  writeFileSync(
    vuePath,
    '<template><view class="mini">{{tip}}</view></template><script setup>import {ref} from "vue";const tip=ref("mini0")</script><style scoped>.mini{padding:1px}</style>',
  )
  // uni-like cold component JS
  const coldJs = `"use strict";
const common_vendor = require("../../../common/vendor.js");
const _sfc_main = {
  __name: "index",
  setup(__props) {
    const tip = common_vendor.ref("mini0");
    return (_ctx, _cache) => {
      return {
        a: common_vendor.t(tip.value)
      };
    };
  }
};
const Component = /* @__PURE__ */ common_vendor._export_sfc(_sfc_main, [["__scopeId", "data-v-mini"]]);
wx.createComponent(Component);
`
  writeFileSync(distJs, coldJs)
  writeFileSync(join(outDir, 'modules/components/mini-shared/index.json'), '{}')
  writeFileSync(join(outDir, 'modules/components/mini-shared/index.wxml'), '<view>{{a}}</view>')
  writeFileSync(join(outDir, 'modules/components/mini-shared/index.wxss'), '.mini{padding:1px}')
  mkdirSync(join(outDir, 'common'), { recursive: true })
  if (!existsSync(join(outDir, 'common/vendor.js'))) {
    writeFileSync(join(outDir, 'common/vendor.js'), '"use strict";\nexports.ref = (v) => ({ value: v });\nexports.t = (v) => v;\nexports._export_sfc = (s) => s;\n')
  }

  const oldScript = 'import {ref} from "vue";const tip=ref("mini0")'
  const newScript = 'import {ref} from "vue";const tip=ref("mini1")'
  const before = sha(readFileSync(distJs))
  const t0 = performance.now()
  const clo = emitClosureVueComponentSync({
    inputDir,
    outDir,
    sourceAbs: vuePath,
    oldScript,
    newScript,
    dryRun: false,
  })
  const ms = performance.now() - t0
  const after = sha(readFileSync(distJs))
  const code = readFileSync(distJs, 'utf8')
  add({
    id: 'f12-vue-script-only-surgical',
    pass:
      clo.ok &&
      clo.emitClass === 'closure-vue' &&
      before !== after &&
      /mini1/.test(code) &&
      !/mini0/.test(code) &&
      existsSync(join(outDir, 'modules/components/mini-shared/index.wxml')),
    detail: `ok=${clo.ok} pageEmitClass=${clo.pageEmitClass} writeMode=${clo.writeMode} ms=${ms.toFixed(2)}`,
    wallMs: ms,
  })
  report.walls.f12_offline_ms = ms

  // template change should be rejected by vite gate; emit itself only sees script —
  // fail path: imports another SFC
  const bad = emitClosureVueComponentSync({
    inputDir,
    outDir,
    sourceAbs: vuePath,
    oldScript,
    newScript: 'import X from "../other.vue";const tip=ref("mini1")',
    dryRun: true,
  })
  add({
    id: 'f12-vue-imports-sfc-fail-closed',
    pass: !bad.ok && bad.reason === 'closure-vue-imports-sfc',
    detail: `reason=${bad.reason}`,
  })

  report.f12 = {
    verdict: clo.ok ? 'ENABLE' : 'BLOCKED',
    pageEmitClass: clo.pageEmitClass,
    wallMs: ms,
    note: clo.ok
      ? 'script-only surgical on component dist JS; template/style gate in vite plugin'
      : clo.reason,
  }
}

// ---------- Fixture live dist checks if present ----------
{
  const chainA = join(FIX_SRC, 'modules/utils/unifast-chain-a.js')
  const chainB = join(FIX_SRC, 'modules/utils/unifast-chain-b.js')
  const distA = join(FIX_OUT, 'modules/utils/unifast-chain-a.js')
  const distB = join(FIX_OUT, 'modules/utils/unifast-chain-b.js')
  const miniVue = join(FIX_SRC, 'modules/components/mini-shared/index.vue')
  const miniJs = join(FIX_OUT, 'modules/components/mini-shared/index.js')
  report.fixtureDist = {
    chainA: existsSync(distA),
    chainB: existsSync(distB),
    miniJs: existsSync(miniJs),
    chainASrc: existsSync(chainA),
    miniVue: existsSync(miniVue),
  }
  if (existsSync(distA) && existsSync(chainA)) {
    const orig = readFileSync(chainA, 'utf8')
    const bak = readFileSync(distA, 'utf8')
    const marked = orig.includes('F10_MARK')
      ? orig
      : orig.replace('return chainBase(n)', 'return chainBase(n) /* F10_MARK */')
    writeFileSync(chainA, marked)
    const clo = emitClosureSharedChunkSync({
      inputDir: FIX_SRC,
      outDir: FIX_OUT,
      sourceAbs: chainA,
      dryRun: true,
    })
    writeFileSync(chainA, orig)
    add({
      id: 'f10-fixture-dist-dryrun',
      pass: clo.ok,
      detail: `ok=${clo.ok} reason=${clo.reason} writeMode=${clo.writeMode} importCount=${clo.importCount}`,
    })
  } else {
    add({
      id: 'f10-fixture-dist-dryrun',
      pass: true,
      skipped: true,
      detail: 'SKIP — fixture dist missing chain chunks (run cold first)',
    })
  }
  if (existsSync(distB) && existsSync(chainB)) {
    const imps = findUtilImportersOf(FIX_SRC, chainB)
    add({
      id: 'f11-fixture-util-importers',
      pass: imps.some((p) => p.includes('unifast-chain-a')),
      detail: `count=${imps.length}`,
    })
  }
}

const passed = report.cases.filter((c) => c.pass).length
const failed = report.cases.filter((c) => !c.pass).length
report.summary = { passed, failed, total: report.cases.length }
report.verdict = {
  F10: report.f10?.verdict || 'UNKNOWN',
  F11: report.f11?.verdict || 'UNKNOWN',
  F12: report.f12?.verdict || 'UNKNOWN',
}

writeFileSync(join(OUT, 'closure-advance.json'), JSON.stringify(report, null, 2))
console.log('\nSUMMARY', report.summary, report.verdict)
if (failed) process.exitCode = 1
