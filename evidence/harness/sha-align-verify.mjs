#!/usr/bin/env node
/**
 * SHA-align verification: cold-guided named literal patch vs uni warm gold.
 * Box-only; no Mac / WeChat.
 */
import { createHash } from 'node:crypto'
import {
  existsSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  mkdirSync,
  unlinkSync,
  renameSync,
} from 'node:fs'
import { join, dirname } from 'node:path'
import {
  emitOptCExtPage,
  patchColdPageJs,
  patchColdPageJsNamedLiterals,
  patchColdPageJsSetupBody,
  patchColdPageJsCallArgs,
  extractSrcNamedRefLiterals,
} from '../optimize/lib/optc-ext-emitter.mjs'

const ROOT = process.env.UNI_FAST_WORKSPACE || process.cwd()
const CCO = join(ROOT, 'compile-optimization')
const OUT = join(ROOT, 'verify')
const ANAT = join(OUT, 'logs/sha-anatomy')

function sha(s) {
  return createHash('sha256').update(typeof s === 'string' ? s : s).digest('hex')
}
function shaFile(p) {
  return sha(readFileSync(p))
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
  claim: 'project local-import flagA false→true byte-SHA vs uni warm via surgical-named cold-guided patch',
  cases: [],
}

function add(c) {
  report.cases.push(c)
  const mark = c.pass ? 'PASS' : 'FAIL'
  console.log(`[${mark}] ${c.id}: ${c.detail || c.verdict || ''}`)
}

// --- Case A: project flagA named patch == gold ---
{
  const cold = readFileSync(join(ANAT, 'project-routeA-cold-reconstructed.js'), 'utf8')
  const gold = readFileSync(join(ANAT, 'project-routeA-baseline-warm.js'), 'utf8')
  const goldSha = sha(gold)
  const oldScript = extractScript(
    readFileSync(join(CCO, 'source-backup/src/pages-tab/routeA/index.vue'), 'utf8'),
  )
  const newScript = extractScript(
    readFileSync(join(CCO, 'project/src/pages-tab/routeA/index.vue'), 'utf8'),
  )
  const named = patchColdPageJsNamedLiterals(cold, oldScript, newScript)
  const surgical = patchColdPageJs(cold, oldScript, newScript)
  const pass =
    named.ok &&
    named.reason === 'named-literal-patch' &&
    named.afterSha === goldSha &&
    named.code === gold &&
    !surgical.ok
  add({
    id: 'project-flagA-named-vs-gold',
    pass,
    verdict: pass ? 'MATCH_Measured' : 'MISMATCH',
    detail: `named=${named.ok}/${named.reason} after=${named.afterSha?.slice(0, 16)} gold=${goldSha.slice(0, 16)} bytes=${named.code?.length}/${gold.length}`,
    goldSha,
    optcSha: named.afterSha,
    emitClass: named.emitClass,
    changes: named.changes,
    surgicalReason: surgical.reason,
  })

  // emit cascade on restored cold file (dryRun)
  const projOut = join(CCO, 'project/dist/dev/mp-weixin')
  const pageJs = join(projOut, 'pages-tab/routeA/index.js')
  const backupLive = readFileSync(pageJs)
  writeFileSync(pageJs, cold)
  try {
    const emit = emitOptCExtPage({
      outDir: projOut,
      pagePath: 'pages-tab/routeA/index',
      oldScript,
      newScript,
      dryRun: true,
    })
    const passE =
      emit.ok &&
      emit.emitClass === 'surgical-named' &&
      emit.afterSha === goldSha &&
      emit.generated === 1
    add({
      id: 'project-emit-cascade-surgical-named',
      pass: passE,
      verdict: passE ? 'MATCH_Measured' : 'FAIL',
      detail: `ok=${emit.ok} class=${emit.emitClass} reason=${emit.reason} sha=${emit.afterSha?.slice(0, 16)} gen=${emit.generated}`,
      emitClass: emit.emitClass,
      afterSha: emit.afterSha,
      allExternalsOnDisk: emit.allExternalsOnDisk,
      requireCount: emit.requireCount,
    })
  } finally {
    writeFileSync(pageJs, backupLive)
  }
}

// --- Case B: fixture string surgical still matches prior SHA path ---
{
  const fixtureOut = join(CCO, 'fixture/dist/dev/mp-weixin')
  const pageJs = join(fixtureOut, 'pages-tab/routeA/index.js')
  const vuePath = join(CCO, 'fixture/src/pages-tab/routeA/index.vue')
  // Use report artifact for script1 if available; else offline surgical on a synthetic page
  // Synthetic minimal cold + scripts for string surgical regression
  const cold = `const common_vendor = require("../../common/vendor.js");
const _sfc_main = {
  __name: "index",
  setup(__props) {
    const label = common_vendor.ref("hello");
    return ($props, $setup) => {
      return common_vendor.e({ a: label.value });
    };
  }
};
Component(common_vendor._export_sfc(_sfc_main, [["render"]]));
`
  const oldScript = `import { ref } from 'vue'\nconst label = ref('hello')\n`
  const newScript = `import { ref } from 'vue'\nconst label = ref('hello-probe')\n`
  const surgical = patchColdPageJs(cold, oldScript, newScript)
  const named = patchColdPageJsNamedLiterals(cold, oldScript, newScript)
  // string change: surgical should win; named also can succeed — cascade prefers surgical
  const pass = surgical.ok && surgical.reason === 'ref-literal-patch' && surgical.code.includes('hello-probe')
  add({
    id: 'fixture-style-string-surgical',
    pass,
    detail: `surgical=${surgical.ok}/${surgical.reason} named=${named.ok}/${named.reason}`,
    surgicalAfterSha: surgical.afterSha,
    namedOk: named.ok,
  })
}

// --- Case C: named bool flip on fixture-like local-import page preserves cold prefs ---
{
  const cold = `const common_vendor = require("../../common/vendor.js");
const utils = require("../../modules/utils/unifast-probe.js");
const _sfc_main = {
  __name: "index",
  setup(__props) {
    const flag = common_vendor.ref(false);
    const n = utils.probeMul(21);
    return ($props, $setup) => {
      return { flag, n };
    };
  }
};
`
  const oldScript = `import { ref } from 'vue'\nimport { probeMul } from '@/modules/utils/unifast-probe.js'\nconst flag = ref(false)\nconst n = probeMul(21)\n`
  const newScript = `import { ref } from 'vue'\nimport { probeMul } from '@/modules/utils/unifast-probe.js'\nconst flag = ref(true)\nconst n = probeMul(21)\n`
  const named = patchColdPageJsNamedLiterals(cold, oldScript, newScript)
  const setupBody = patchColdPageJsSetupBody(cold, oldScript, newScript, {
    pagePath: 'pages-tab/routeA/index',
    outDir: join(CCO, 'fixture/dist/dev/mp-weixin'),
  })
  const expected = cold.replace('common_vendor.ref(false)', 'common_vendor.ref(true)')
  const pass = named.ok && named.code === expected && named.afterSha === sha(expected)
  add({
    id: 'local-import-bool-prefers-named-over-setup-body',
    pass,
    detail: `named=${named.ok} setupBodyAlso=${setupBody.ok} byteEqExpected=${named.code === expected}`,
    namedReason: named.reason,
    setupBodyReason: setupBody.reason,
  })
}

// --- Case D: multi named refs ---
{
  const cold = `setup(__props) {
    const a = common_vendor.ref(1);
    const b = common_vendor.ref(false);
    const c = common_vendor.ref("x");
    return ( ) => ({ a, b, c });
  }`
  const oldScript = `const a = ref(1)\nconst b = ref(false)\nconst c = ref('x')\n`
  const newScript = `const a = ref(2)\nconst b = ref(true)\nconst c = ref("y")\n`
  const named = patchColdPageJsNamedLiterals(cold, oldScript, newScript)
  const pass =
    named.ok &&
    named.changes?.length === 3 &&
    named.code.includes('ref(2)') &&
    named.code.includes('ref(true)') &&
    named.code.includes('ref("y")')
  add({
    id: 'multi-named-ref-literals',
    pass,
    detail: `changes=${named.changes?.length} reason=${named.reason}`,
    changes: named.changes,
  })
}

// --- Case E: fail-closed when bindings added / incomplete body diff ---
{
  const cold = `setup(__props) {
    const flag = common_vendor.ref(false);
    return () => ({ flag });
  }`
  // E1: new named binding added
  {
    const oldScript = `import { ref } from 'vue'\nconst flag = ref(false)\n`
    const newScript = `import { ref } from 'vue'\nconst flag = ref(true)\nconst extra = ref(1)\n`
    const named = patchColdPageJsNamedLiterals(cold, oldScript, newScript)
    const pass = !named.ok && (named.reason === 'named-ref-arity-mismatch' || named.reason === 'named-ref-added')
    add({
      id: 'named-fail-closed-arity-or-added',
      pass,
      detail: `reason=${named.reason}`,
    })
  }
  // E2: same named set but extra non-ref statement
  {
    const oldScript = `import { ref } from 'vue'\nconst flag = ref(false)\n`
    const newScript = `import { ref } from 'vue'\nconst flag = ref(true)\nconsole.log(1)\n`
    const named = patchColdPageJsNamedLiterals(cold, oldScript, newScript)
    const pass = !named.ok && named.reason === 'named-literal-incomplete-diff'
    add({
      id: 'named-fail-closed-incomplete-diff',
      pass,
      detail: `reason=${named.reason}`,
    })
  }
}

// --- Case F: DCE'd binding missing in cold → fail closed ---
{
  const cold = `setup(__props) {
    common_vendor.ref(false);
    const keep = common_vendor.ref(1);
    return () => ({ keep });
  }`
  const oldScript = `const dropped = ref(false)\nconst keep = ref(1)\n`
  const newScript = `const dropped = ref(true)\nconst keep = ref(1)\n`
  const named = patchColdPageJsNamedLiterals(cold, oldScript, newScript)
  const pass = !named.ok && named.reason === 'cold-named-ref-missing'
  add({
    id: 'named-fail-closed-dce-missing',
    pass,
    detail: `reason=${named.reason} name=${named.name}`,
  })
}

// --- Case G: externals-missing still fail-closed via emit ---
{
  const tmp = '/tmp/optc-ext-externals-missing'
  mkdirSync(join(tmp, 'pages-tab/routeA'), { recursive: true })
  const pageJs = join(tmp, 'pages-tab/routeA/index.js')
  // cold with require that does not exist
  writeFileSync(
    pageJs,
    `const common_vendor = require("../../common/vendor.js");
const _sfc_main = { setup(__props) { const flag = common_vendor.ref(false); return () => ({ flag }); } };
`,
  )
  const emit = emitOptCExtPage({
    outDir: tmp,
    pagePath: 'pages-tab/routeA/index',
    oldScript: 'const flag = ref(false)\n',
    newScript: 'const flag = ref(true)\n',
    dryRun: true,
  })
  const pass = !emit.ok && emit.reason === 'externals-missing'
  add({
    id: 'externals-missing-fail-closed',
    pass,
    detail: `reason=${emit.reason} class=${emit.emitClass}`,
  })
}

// --- Case H: fixture live local-import path still setup-body for probeMul edit ---
{
  const fixtureOut = join(CCO, 'fixture/dist/dev/mp-weixin')
  const pageJs = join(fixtureOut, 'pages-tab/routeA/index.js')
  const vue = readFileSync(join(CCO, 'fixture/src/pages-tab/routeA/index.vue'), 'utf8')
  const script = extractScript(vue)
  if (existsSync(pageJs) && /probeMul/.test(script)) {
    const coldJs = readFileSync(pageJs, 'utf8')
    const oldScript = script.includes('probeMul(21)')
      ? script
      : script.replace(/probeMul\(\s*\d+\s*\)/, 'probeMul(21)')
    const newScript = oldScript.replace(/probeMul\(\s*\d+\s*\)/, 'probeMul(22)')
    const named = patchColdPageJsNamedLiterals(coldJs, oldScript, newScript)
    const setup = patchColdPageJsSetupBody(coldJs, oldScript, newScript, {
      pagePath: 'pages-tab/routeA/index',
      outDir: fixtureOut,
    })
    // F2: probeMul arg flip → surgical-call-arg (cold in-place); setup-body remains fallback
    const call = patchColdPageJsCallArgs(coldJs, oldScript, newScript, {
      pagePath: 'pages-tab/routeA/index',
      outDir: fixtureOut,
    })
    const pass = !named.ok && call.ok && call.emitClass === 'surgical-call-arg' && setup.ok
    add({
      id: 'fixture-local-import-probeMul-call-arg',
      pass,
      detail: `named=${named.reason} call=${call.reason}/${call.emitClass} setupFallback=${setup.emitClass}`,
      callAfterSha: call.afterSha,
      setupAfterSha: setup.afterSha,
    })

    // Also compare to baseline report artifact if present
    const baseArt = join(
      CCO,
      'reports/box-fixture-baseline-local-import/scriptLocalImport.files.json',
    )
    const optcArt = join(
      CCO,
      'reports/box-fixture-optc-ext-local-import/scriptLocalImport.files.json',
    )
    if (existsSync(baseArt) && existsSync(optcArt) && setup.ok) {
      const baseFiles = JSON.parse(readFileSync(baseArt, 'utf8'))
      const optcFiles = JSON.parse(readFileSync(optcArt, 'utf8'))
      const baseRouteA = (baseFiles.files || baseFiles).find?.(
        (f) => f.path?.endsWith('pages-tab/routeA/index.js') || f === 'pages-tab/routeA/index.js',
      )
      // artifacts vary; just record prior report SHAs from result.json
      let prior = {}
      for (const [label, p] of [
        ['baseline', join(CCO, 'reports/box-fixture-baseline-local-import/result.json')],
        ['optc', join(CCO, 'reports/box-fixture-optc-ext-local-import/result.json')],
      ]) {
        if (existsSync(p)) prior[label] = JSON.parse(readFileSync(p, 'utf8'))
      }
      add({
        id: 'fixture-local-import-prior-reports-note',
        pass: true,
        detail: 'Prior bench reports retained; probeMul class now surgical-call-arg (F2); setup-body is fallback',
        priorKeys: Object.keys(prior),
      })
    }
  } else {
    add({
      id: 'fixture-local-import-probeMul-call-arg',
      pass: false,
      detail: 'fixture routeA missing or no probeMul',
    })
  }
}

// --- Case I: setup-body numeric ref(42) style still works when not named-only ---
{
  const cold = `setup(__props) {
    const label = common_vendor.ref(42);
    return () => ({ label });
  }`
  const oldScript = `const label = ref(42)\n`
  const newScript = `const label = ref(43)\n`
  const named = patchColdPageJsNamedLiterals(cold, oldScript, newScript)
  const pass = named.ok && named.code.includes('ref(43)')
  add({
    id: 'named-numeric-ref-flip',
    pass,
    detail: `reason=${named.reason} codeHas43=${named.code?.includes('ref(43)')}`,
  })
}

report.summary = {
  total: report.cases.length,
  passed: report.cases.filter((c) => c.pass).length,
  failed: report.cases.filter((c) => !c.pass).length,
}
report.projectLocalImportByteSha = {
  verdict: report.cases.find((c) => c.id === 'project-flagA-named-vs-gold')?.verdict,
  goldSha: report.cases.find((c) => c.id === 'project-flagA-named-vs-gold')?.goldSha,
  optcSha: report.cases.find((c) => c.id === 'project-flagA-named-vs-gold')?.optcSha,
  emitClass: 'surgical-named',
  mechanism: 'cold-guided named ref(literal) in-place patch (preserves uni DCE+formatting)',
}

writeFileSync(join(OUT, 'sha-align-verify.json'), JSON.stringify(report, null, 2))
console.log('\nSUMMARY', report.summary)
console.log('projectLocalImportByteSha', report.projectLocalImportByteSha.verdict)
if (report.summary.failed) process.exitCode = 1
