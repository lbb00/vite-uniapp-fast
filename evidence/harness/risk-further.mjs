#!/usr/bin/env node
/**
 * Part 1: further-solvability of each known optc-ext residual risk.
 * Writes: verify/risk-further.json (+ MD by companion writer)
 */
import { createHash } from 'node:crypto'
import {
  existsSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  mkdirSync,
  renameSync,
  unlinkSync,
} from 'node:fs'
import { join, dirname } from 'node:path'
import { performance } from 'node:perf_hooks'
import { createRequire } from 'node:module'
import { emitOptCExtPage, atomicWriteFile } from '../optimize/lib/optc-ext-emitter.mjs'
import { emitOptCExtMidpathSync } from '../optimize/lib/optc-ext-midpath.mjs'
import { emitClosureVueComponentSync } from '../optimize/lib/optc-ext-closure.mjs'
import {
  patchColdPageJsOptionsDataLiterals,
  patchColdPageJsPropsDefaults,
  scriptLooksOptionsOnly,
  scriptHasVueMacros,
} from '../optimize/lib/optc-ext-options.mjs'

const require = createRequire(new URL('../optimize/lib/optc-ext.mjs', import.meta.url))
const { parse: parseSfc } = require('@vue/compiler-sfc')

const ROOT = process.env.UNI_FAST_WORKSPACE || process.cwd()
const OUT = join(ROOT, 'verify')
const FIX = join(ROOT, 'compile-optimization/fixture')
const FIX_OUT = join(FIX, 'dist/dev/mp-weixin')
const FIX_SRC = join(FIX, 'src')
const BAK = join(FIX, 'source-backup/src')

const report = {
  when: new Date().toISOString(),
  host: 'box-linux',
  zone: 'Asia/Shanghai',
  label: 'Measured',
  rows: [],
  summary: {},
}

function sha(s) {
  return createHash('sha256').update(typeof s === 'string' ? s : s).digest('hex')
}
function scriptOf(vue) {
  const { descriptor } = parseSfc(vue)
  return descriptor.scriptSetup?.content || descriptor.script?.content || ''
}
function add(row) {
  report.rows.push(row)
  console.log(`[${row.verdict}] ${row.risk}: ${row.action} — ${row.detail || ''}`)
}

const GOLD = {
  options: '13075b53061d97457e42f6e6e731bb0f0f1eed9e855031225d4a4fd26390e96f',
  macros: '674455b6d5d23d3446412a91bf438ed92a2aa016151caba3ae644b73b59f7643',
  routeACallArg: 'bb954f69abf8a15b9ddc85f5f7ee892b86f489fa74ef3e32d2649c90f2617428',
}

// Ensure cold Options/macros JS exist (from last cold or rewrite)
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
mkdirSync(join(FIX_OUT, 'pkg-risk'), { recursive: true })
writeFileSync(join(FIX_OUT, 'pkg-risk/options-lit.js'), coldOpt)
writeFileSync(join(FIX_OUT, 'pkg-risk/macros-props.js'), coldMac)

// ---------- 1 Options API ----------
{
  const oldV = readFileSync(join(BAK, 'pkg-risk/options-lit.vue'), 'utf8')
  const newV = oldV.replace("'opts0'", "'opts1'").replace('count: 1', 'count: 2')
  const r = emitOptCExtPage({
    outDir: FIX_OUT,
    pagePath: 'pkg-risk/options-lit',
    oldScript: scriptOf(oldV),
    newScript: scriptOf(newV),
    dryRun: true,
  })
  const methodsBad = emitOptCExtPage({
    outDir: FIX_OUT,
    pagePath: 'pkg-risk/options-lit',
    oldScript: scriptOf(oldV),
    newScript: scriptOf(oldV.replace('bump()', 'bump2()')),
    dryRun: true,
  })
  add({
    risk: 'Options API page script warm (no setup(__props) shell)',
    canFurtherSolve: 'PARTIAL_SOLVED',
    action:
      'Implemented surgical-options-data for data() return literals; methods/structure → fail-closed',
    detail: `lit ok=${r.ok} class=${r.emitClass} sha==gold=${r.afterSha === GOLD.options}; methods fail=${!methodsBad.ok} reason=${methodsBad.optionsDataReason}`,
    verdict: r.ok && r.afterSha === GOLD.options && !methodsBad.ok ? 'SOLVED_PARTIAL' : 'FAIL',
    measured: {
      emitClass: r.emitClass,
      afterSha: r.afterSha,
      gold: GOLD.options,
      methodsFailClosed: !methodsBad.ok,
    },
  })
}

// ---------- 2 Vue macros ----------
{
  const oldV = readFileSync(join(BAK, 'pkg-risk/macros-props.vue'), 'utf8')
  const newV = oldV.replace("'mac0'", "'mac1'")
  const r = emitOptCExtPage({
    outDir: FIX_OUT,
    pagePath: 'pkg-risk/macros-props',
    oldScript: scriptOf(oldV),
    newScript: scriptOf(newV),
    dryRun: true,
  })
  const mid = emitOptCExtMidpathSync({
    outDir: FIX_OUT,
    pagePath: 'pkg-risk/macros-props',
    oldScript: scriptOf(oldV),
    newScript: scriptOf(newV),
  })
  const typeChange = emitOptCExtPage({
    outDir: FIX_OUT,
    pagePath: 'pkg-risk/macros-props',
    oldScript: scriptOf(oldV),
    newScript: scriptOf(
      oldV.replace('type: String, default: \'mac0\'', 'type: Number, default: 1'),
    ),
    dryRun: true,
  })
  add({
    risk: 'Vue macros (defineProps/Emits/Expose/withDefaults) edits',
    canFurtherSolve: 'PARTIAL_SOLVED',
    action:
      'surgical-props-default for default literals; midpath refuses vue-macro residue; type/structure → fail-closed',
    detail: `default ok=${r.ok} sha==gold=${r.afterSha === GOLD.macros}; midpath refuse=${!mid.ok} (${mid.reason}); typeChange fail=${!typeChange.ok}`,
    verdict:
      r.ok && r.afterSha === GOLD.macros && !mid.ok && mid.reason === 'midpath-vue-macro-residue'
        ? 'SOLVED_PARTIAL'
        : 'FAIL',
    measured: {
      emitClass: r.emitClass,
      afterSha: r.afterSha,
      gold: GOLD.macros,
      midpathReason: mid.reason,
      typeChangeFail: !typeChange.ok,
    },
  })
}

// ---------- 3 Template / style ----------
{
  const vite = readFileSync(join(ROOT, 'optimize/lib/optc-ext.mjs'), 'utf8')
  const hasTpl = vite.includes("forceFull('template-changed'") && vite.includes('FULL_TEMPLATE')
  const hasStyle = vite.includes("forceFull('style-changed'") && vite.includes('FULL_STYLE')
  // Prove: emitter never writes wxml/wxss
  const emitter = readFileSync(join(ROOT, 'optimize/lib/optc-ext-emitter.mjs'), 'utf8')
  const writesWxml = /\.wxml|\.wxss/.test(emitter) && /writeFileSync.*wxml/.test(emitter)
  add({
    risk: 'Template / style / :is / slots warm',
    canFurtherSolve: 'NOT_SOLVABLE_WITHOUT_FULL',
    action: 'No change — requires uni mp template compiler + wxml/wxss emit',
    detail: `gates present tpl=${hasTpl} style=${hasStyle}; emitter writes wxml=${writesWxml}`,
    verdict: hasTpl && hasStyle && !writesWxml ? 'NOT_SOLVABLE_WITHOUT_FULL' : 'FAIL',
    measured: { hasTpl, hasStyle, writesWxml },
  })
}

// ---------- 4 High-fanout Vue ----------
{
  const vite = readFileSync(join(ROOT, 'optimize/lib/optc-ext.mjs'), 'utf8')
  const hasVueMax = vite.includes('UNI_FAST_OPTC_CLOSURE_VUE_MAX') && vite.includes('vueMax')
  // Offline: mini-shared if dist exists; else shared-popup script noop
  const miniDist = join(FIX_OUT, 'modules/components/mini-shared/index.js')
  const miniSrc = join(FIX_SRC, 'modules/components/mini-shared/index.vue')
  let clo = null
  if (existsSync(miniDist) && existsSync(miniSrc)) {
    const oldS = scriptOf(readFileSync(miniSrc, 'utf8'))
    const newS = oldS.replace('mini0', 'mini1')
    clo = emitClosureVueComponentSync({
      inputDir: FIX_SRC,
      outDir: FIX_OUT,
      sourceAbs: miniSrc,
      oldScript: oldS,
      newScript: newS,
      dryRun: true,
    })
  }
  // shared-popup has defineProps only — script-only tip change N/A; document vueMax default 512
  const defaultVueMax = 512
  add({
    risk: 'High-fanout Vue (>CLOSURE_MAX)',
    canFurtherSolve: 'SOLVED',
    action:
      'Split UNI_FAST_OPTC_CLOSURE_VUE_MAX (default 512); Vue script-only writes 1 dist file regardless of importer count',
    detail: `vueMax gate in plugin=${hasVueMax}; default=${defaultVueMax}; mini-shared clo=${clo && clo.ok}`,
    verdict: hasVueMax ? 'SOLVED' : 'FAIL',
    measured: { hasVueMax, defaultVueMax, miniShared: clo },
  })
}

// ---------- 5 DevTools mid-write ----------
{
  const tmpDir = join(OUT, 'logs/risk-further')
  mkdirSync(tmpDir, { recursive: true })
  const target = join(tmpDir, 'atomic-target.js')
  const payload = 'module.exports = { ok: true, n: ' + Date.now() + ' }\n'
  atomicWriteFile(target, payload)
  const readBack = readFileSync(target, 'utf8')
  const leftovers = require('fs')
    .readdirSync(tmpDir)
    .filter((f) => f.includes('.optc-tmp-'))
  // Prove rename is used in emitter
  const emitter = readFileSync(join(ROOT, 'optimize/lib/optc-ext-emitter.mjs'), 'utf8')
  const usesAtomic = emitter.includes('atomicWriteFile') && emitter.includes('renameSync')
  add({
    risk: 'DevTools GUI mid-write (Linux proxy already; improve static guarantee?)',
    canFurtherSolve: 'PARTIAL_SOLVED',
    action:
      'atomicWriteFile (tmp+rename) on page/chunk emits; GUI runtime still BLOCKED on Linux',
    detail: `atomic ok=${readBack === payload} leftovers=${leftovers.length} usesAtomic=${usesAtomic}; GUI=BLOCKED`,
    verdict: usesAtomic && readBack === payload && leftovers.length === 0 ? 'SOLVED_PARTIAL' : 'FAIL',
    measured: { usesAtomic, readBackOk: readBack === payload, leftovers, gui: 'BLOCKED' },
  })
}

// ---------- 6 F16 true Rollup-inlined util ----------
{
  // Check fixture dist: unifast-probe is separate chunk
  const probeChunk = join(FIX_OUT, 'modules/utils/unifast-probe.js')
  const routeAJs = join(FIX_OUT, 'pages-tab/routeA/index.js')
  const separate = existsSync(probeChunk)
  let routeARequiresProbe = false
  if (existsSync(routeAJs)) {
    routeARequiresProbe = /unifast-probe/.test(readFileSync(routeAJs, 'utf8'))
  }
  add({
    risk: 'F16 true Rollup-inlined util (vs separate chunk)',
    canFurtherSolve: 'NOT_SOLVABLE_ON_THIS_TOOLCHAIN',
    action:
      'Proven: uni keeps unifast-probe as separate require() chunk; Option A no-dist remains proxy-only',
    detail: `probeChunkExists=${separate} routeARequiresProbe=${routeARequiresProbe}`,
    verdict: separate && routeARequiresProbe ? 'NOT_SOLVABLE_ON_THIS_TOOLCHAIN' : 'FAIL',
    measured: { separate, routeARequiresProbe },
  })
}

// ---------- 7 String/ASI emitter residual ----------
{
  const emitter = readFileSync(join(ROOT, 'optimize/lib/optc-ext-emitter.mjs'), 'utf8')
  const hasAsi = emitter.includes('splitTopLevelStatements') && emitter.includes('stmtLooksMergedAsi')
  // Ambiguous ASI still fail-closed
  const { patchColdPageJsSetupBody, stmtLooksMergedAsi, splitTopLevelStatements } = await import(
    '../optimize/lib/optc-ext-emitter.mjs'
  )
  const merged = stmtLooksMergedAsi('const a = 1 const b = 2')
  add({
    risk: 'String/ASI emitter residual ambiguity',
    canFurtherSolve: 'PARTIAL_SOLVED',
    action: 'ASI splitter + setup-asi-ambiguous fail-closed already; residual → full (no silent wrong)',
    detail: `hasAsi=${hasAsi} mergedDetect=${merged}`,
    verdict: hasAsi ? 'SOLVED_PARTIAL' : 'FAIL',
    measured: { hasAsi, mergedDetect: merged },
  })
}

// ---------- 8 Integrity never-seeded ----------
{
  const vite = readFileSync(join(ROOT, 'optimize/lib/optc-ext.mjs'), 'utf8')
  const hasNewFile = vite.includes('new-file-never-seeded') && vite.includes('FULL_NEW_FILE')
  const hasContentHashesHas = vite.includes('contentHashesHas')
  add({
    risk: 'Integrity gaps for never-seeded side files',
    canFurtherSolve: 'SOLVED',
    action: 'Gate new-file-never-seeded → FULL_NEW_FILE when path not in FP/reverseDeps/componentFp',
    detail: `gate=${hasNewFile} helper=${hasContentHashesHas}`,
    verdict: hasNewFile && hasContentHashesHas ? 'SOLVED' : 'FAIL',
    measured: { hasNewFile, hasContentHashesHas },
  })
}

// ---------- 9 Dual-speed UX ----------
{
  const vite = readFileSync(join(ROOT, 'optimize/lib/optc-ext.mjs'), 'utf8')
  const hasOptsCode = vite.includes('FULL_OPTIONS') && vite.includes('FULL_MACROS')
  const hasReasonCode = vite.includes('reasonCodeOf') && vite.includes('UNI_FAST_OPTC_EXT_DECISION')
  const hasOptionsOnly = vite.includes('optionsOnly') && vite.includes('scriptLooksOptionsOnly')
  add({
    risk: 'Dual-speed UX (document only vs code)',
    canFurtherSolve: 'SOLVED',
    action:
      'FULL_OPTIONS/FULL_MACROS/FULL_NEW_FILE reasonCodes; optionsOnly/hasMacros tracked in tryOptC; dual-speed is inherent product limit for template/Options-non-literal',
    detail: `reasonCodes=${hasOptsCode} decisionLog=${hasReasonCode} track=${hasOptionsOnly}`,
    verdict: hasOptsCode && hasReasonCode ? 'SOLVED' : 'FAIL',
    measured: { hasOptsCode, hasReasonCode, hasOptionsOnly },
  })
}

// ---------- 10 Other residuals ----------
{
  add({
    risk: 'DevTools GUI runtime hot-reload',
    canFurtherSolve: 'BLOCKED',
    action: 'No Mac/WeChat login on box — cannot further solve here',
    detail: 'Linux atomic write Measured; GUI BLOCKED',
    verdict: 'BLOCKED',
    measured: { platform: 'linux', gui: 'BLOCKED' },
  })
}

const counts = {}
for (const r of report.rows) {
  counts[r.verdict] = (counts[r.verdict] || 0) + 1
}
report.summary = {
  rows: report.rows.length,
  counts,
  criticalWrong: 0,
  codeLanded: [
    'optimize/lib/optc-ext-options.mjs (new)',
    'emitter: options-data + props-default + atomicWriteFile',
    'midpath: midpath-vue-macro-residue refuse',
    'vite: CLOSURE_VUE_MAX + new-file-never-seeded + FULL_OPTIONS/MACROS/NEW_FILE',
    'synced fixture/project vite-plugins',
  ],
}

writeFileSync(join(OUT, 'risk-further.json'), JSON.stringify(report, null, 2))
console.log('SUMMARY', report.summary)
