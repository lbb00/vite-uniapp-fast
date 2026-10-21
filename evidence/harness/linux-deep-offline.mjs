#!/usr/bin/env node
/**
 * Linux-only offline emitter stress + structure checks (no Vite / no Mac).
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs'
import { join, dirname, normalize } from 'node:path'
import { performance } from 'node:perf_hooks'
import {
  emitOptCExtPage,
  extractSrcRefLiterals,
  parseColdRequires,
  buildLocalRewriteMap,
  splitColdSetup,
  localImportsUsedInSetup,
  patchColdPageJs,
  patchColdPageJsSetupBody,
} from '../optimize/lib/optc-ext-emitter.mjs'

const WS = process.env.UNI_FAST_WORKSPACE || process.cwd()
const ROOT = WS + '/compile-optimization'
const OUT = WS + '/verify'
const results = {
  when: new Date().toISOString(),
  host: 'box-linux',
  workstreams: {},
}

function sha(s) {
  return createHash('sha256').update(s).digest('hex')
}

function extractScript(vue) {
  const start = vue.indexOf('<script')
  const end = vue.indexOf('</script>')
  if (start < 0 || end < 0) return ''
  const openEnd = vue.indexOf('>', start)
  return vue.slice(openEnd + 1, end)
}

function listProjectRoutes() {
  const pj = JSON.parse(readFileSync(join(ROOT, 'project/src/pages.json'), 'utf8'))
  const pages = []
  for (const x of pj.pages || []) pages.push(x.path)
  for (const s of pj.subPackages || pj.subpackages || []) {
    for (const x of s.pages || []) pages.push(normalize(join(s.root, x.path)).replace(/\\/g, '/'))
  }
  return [...new Set(pages)]
}

function resolveVue(srcRoot, pagePath) {
  const candidates = [
    join(srcRoot, pagePath + '.vue'),
    join(srcRoot, pagePath + '/index.vue'),
  ]
  // pagePath already includes index sometimes
  if (pagePath.endsWith('/index')) {
    candidates.push(join(srcRoot, pagePath + '.vue'))
  }
  for (const c of candidates) if (existsSync(c)) return c
  return null
}

function resolveDistJs(outDir, pagePath) {
  const c = join(outDir, pagePath + '.js')
  return existsSync(c) ? c : null
}

function classifyPage(srcRoot, outDir, pagePath) {
  const vuePath = resolveVue(srcRoot, pagePath)
  const jsPath = resolveDistJs(outDir, pagePath)
  if (!vuePath || !jsPath) {
    return { pagePath, status: 'missing', vuePath, jsPath }
  }
  const vue = readFileSync(vuePath, 'utf8')
  const script = extractScript(vue)
  const coldJs = readFileSync(jsPath, 'utf8')
  const refs = extractSrcRefLiterals(script)
  const locals = localImportsUsedInSetup(script)
  const split = splitColdSetup(coldJs)
  let rewrite = null
  try {
    rewrite = buildLocalRewriteMap(script, coldJs, pagePath, outDir)
  } catch (e) {
    rewrite = { error: e.message, mapped: [], unmapped: [{ error: e.message }] }
  }

  // Trivial surgical probe: flip first string ref if any
  let surgical = null
  let setupBody = null
  if (refs.length) {
    const oldScript = script
    const newScript = script.replace(
      /\bref\(\s*(['"])([^'"]*)\1\s*\)/,
      (_, q, v) => `ref(${q}${v}_probe${q})`,
    )
    surgical = patchColdPageJs(coldJs, oldScript, newScript)
    setupBody = patchColdPageJsSetupBody(coldJs, oldScript, newScript, { pagePath, outDir })
  } else {
    // Try a non-literal: flip ref(false)↔ref(true) if present
    if (/\bref\(\s*false\s*\)/.test(script)) {
      const newScript = script.replace(/\bref\(\s*false\s*\)/, 'ref(true)')
      surgical = patchColdPageJs(coldJs, script, newScript)
      setupBody = patchColdPageJsSetupBody(coldJs, script, newScript, { pagePath, outDir })
    } else if (/\bref\(\s*true\s*\)/.test(script)) {
      const newScript = script.replace(/\bref\(\s*true\s*\)/, 'ref(false)')
      surgical = patchColdPageJs(coldJs, script, newScript)
      setupBody = patchColdPageJsSetupBody(coldJs, script, newScript, { pagePath, outDir })
    }
  }

  const pageOnlyCapable =
    (surgical && surgical.ok) || (setupBody && setupBody.ok)

  return {
    pagePath,
    status: 'ok',
    bytes: coldJs.length,
    stringRefCount: refs.length,
    localImportUsedCount: locals.length,
    hasSetupSplit: !!split,
    localMapped: rewrite?.mapped?.length || 0,
    localUnmapped: rewrite?.unmapped?.length || 0,
    unmappedSample: (rewrite?.unmapped || []).slice(0, 3),
    surgicalOk: !!(surgical && surgical.ok),
    surgicalReason: surgical?.reason || surgical?.ok === false ? surgical?.reason : null,
    setupBodyOk: !!(setupBody && setupBody.ok),
    setupBodyReason: setupBody?.reason || null,
    setupBodyEmitClass: setupBody?.emitClass || null,
    pageOnlyCapable,
    preferPath: surgical?.ok ? 'surgical' : setupBody?.ok ? setupBody.emitClass || 'setup-body' : 'full',
  }
}

function syntaxCheck(file) {
  const code = readFileSync(file, 'utf8')
  try {
    // Strip "use strict" ok; new Function parse
    new Function(code)
    return { ok: true, bytes: code.length }
  } catch (e) {
    return { ok: false, error: e.message, bytes: code.length }
  }
}

function requireResolveCheck(pageJs) {
  const code = readFileSync(pageJs, 'utf8')
  const dir = dirname(pageJs)
  const reqs = [...code.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map((m) => m[1])
  const details = []
  for (const r of reqs) {
    const abs = normalize(join(dir, r))
    details.push({ require: r, abs, exists: existsSync(abs) })
  }
  return {
    requireCount: reqs.length,
    allExist: details.every((d) => d.exists),
    missing: details.filter((d) => !d.exists),
    details,
  }
}

// --- D: coverage sample ---
function runCoverage() {
  const srcRoot = join(ROOT, 'project/src')
  const outDir = join(ROOT, 'project/dist/dev/mp-weixin')
  if (!existsSync(outDir)) {
    return { error: 'project dist missing', label: 'Unverified' }
  }
  const routes = listProjectRoutes()
  // Sample: all tab pages + every Nth + deep pages
  const tabs = routes.filter((r) => r.startsWith('pages-tab/'))
  const deep = routes.filter((r) => r.split('/').length >= 5)
  const step = Math.max(1, Math.floor(routes.length / 25))
  const stride = routes.filter((_, i) => i % step === 0)
  const sampleSet = [...new Set([...tabs.slice(0, 8), ...deep.slice(0, 8), ...stride])].slice(0, 40)

  const rows = []
  let crashes = 0
  for (const pagePath of sampleSet) {
    try {
      rows.push(classifyPage(srcRoot, outDir, pagePath))
    } catch (e) {
      crashes++
      rows.push({ pagePath, status: 'crash', error: e.message })
    }
  }
  const ok = rows.filter((r) => r.status === 'ok')
  const capable = ok.filter((r) => r.pageOnlyCapable)
  const surgical = ok.filter((r) => r.surgicalOk)
  const setupBody = ok.filter((r) => r.setupBodyOk)
  const unmapped = ok.filter((r) => r.localUnmapped > 0)
  const missing = rows.filter((r) => r.status === 'missing')

  return {
    label: 'Measured',
    totalRoutes: routes.length,
    sampleSize: sampleSet.length,
    sample: sampleSet,
    classifiedOk: ok.length,
    missing: missing.length,
    crashes,
    pageOnlyCapable: capable.length,
    pageOnlyCapablePct: ok.length ? +(100 * capable.length / ok.length).toFixed(1) : 0,
    surgicalCapable: surgical.length,
    setupBodyCapable: setupBody.length,
    withUnmappedLocals: unmapped.length,
    preferBreakdown: {
      surgical: ok.filter((r) => r.preferPath === 'surgical').length,
      'setup-body': ok.filter((r) => r.preferPath === 'setup-body' || r.preferPath === 'setup-body-local-imports').length,
      full: ok.filter((r) => r.preferPath === 'full').length,
    },
    rows,
  }
}

// --- A: deep product compare from manifests + live dist ---
function runProductCompare() {
  const reports = join(ROOT, 'reports')
  function loadPair(coldName, afterName) {
    const cold = JSON.parse(readFileSync(join(reports, coldName), 'utf8'))
    const after = JSON.parse(readFileSync(join(reports, afterName), 'utf8'))
    return { cold, after }
  }
  function diffManifest(label, cold, after, sampleN = 20) {
    const all = new Set([...Object.keys(cold), ...Object.keys(after)])
    const shaChanged = []
    const mtimeOnly = []
    for (const k of all) {
      if (!cold[k] || !after[k]) continue
      if (cold[k].sha256 !== after[k].sha256) shaChanged.push(k)
      else if (cold[k].mtimeNs !== after[k].mtimeNs) mtimeOnly.push(k)
    }
    const fam = [
      'pages-tab/routeA/index.js',
      'pages-tab/routeA/index.json',
      'pages-tab/routeA/index.wxml',
      'pages-tab/routeA/index.wxss',
      'common/vendor.js',
      'app.js',
      'app.json',
      'app.wxss',
    ]
    const family = {}
    for (const f of fam) {
      const a = cold[f], b = after[f]
      family[f] = !a || !b ? 'absent' : a.sha256 === b.sha256 ? 'byte-identical' : 'sha-changed'
    }
    const pages = Object.keys(cold).filter((k) => /\/index\.js$/.test(k) && k !== 'pages-tab/routeA/index.js')
    const stride = Math.max(1, Math.floor(pages.length / sampleN))
    const sample = pages.filter((_, i) => i % stride === 0).slice(0, sampleN)
    const sampleStable = sample.filter(
      (p) => cold[p].sha256 === after[p].sha256 && cold[p].mtimeNs === after[p].mtimeNs,
    )
    return {
      label,
      filesCold: Object.keys(cold).length,
      filesAfter: Object.keys(after).length,
      shaChangedCount: shaChanged.length,
      shaChangedFiles: shaChanged,
      mtimeOnlyCount: mtimeOnly.length,
      family,
      sampleOtherPages: `${sampleStable.length}/${sample.length}`,
      onlyIntendedPageJs:
        shaChanged.length === 1 && shaChanged[0] === 'pages-tab/routeA/index.js',
    }
  }

  const pairs = []
  const tryPair = (label, coldRel, afterRel) => {
    const c = join(reports, coldRel)
    const a = join(reports, afterRel)
    if (existsSync(c) && existsSync(a)) {
      const { cold, after } = { cold: JSON.parse(readFileSync(c, 'utf8')), after: JSON.parse(readFileSync(a, 'utf8')) }
      pairs.push(diffManifest(label, cold, after))
    }
  }
  tryPair('fixture-optc-local-import', 'box-fixture-optc-ext-local-import/cold.files.json', 'box-fixture-optc-ext-local-import/scriptLocalImport.files.json')
  tryPair('project-optc-local-import', 'box-project-optc-ext-local-import/cold.files.json', 'box-project-optc-ext-local-import/scriptLocalImport.files.json')
  tryPair('fixture-optc-script1', 'box-fixture-optc-ext-v4/cold.files.json', 'box-fixture-optc-ext-v4/script1.files.json')
  tryPair('project-optc-script1', 'box-project-optc-ext-v3/cold.files.json', 'box-project-optc-ext-v3/script1.files.json')

  return { label: 'Measured', pairs }
}

// --- E: syntax on current dist pages ---
function runSyntaxChecks() {
  const checks = []
  const targets = [
    join(ROOT, 'fixture/dist/dev/mp-weixin/pages-tab/routeA/index.js'),
    join(ROOT, 'fixture/dist/dev/mp-weixin/common/vendor.js'),
    join(ROOT, 'project/dist/dev/mp-weixin/pages-tab/routeA/index.js'),
    join(ROOT, 'project/dist/dev/mp-weixin/common/vendor.js'),
    join(ROOT, 'project/dist/dev/mp-weixin/app.js'),
  ]
  for (const t of targets) {
    if (!existsSync(t)) {
      checks.push({ file: t, status: 'missing' })
      continue
    }
    const syn = syntaxCheck(t)
    const reqs = t.endsWith('index.js') && t.includes('pages-tab/routeA') ? requireResolveCheck(t) : null
    checks.push({ file: t, syntax: syn, requires: reqs })
  }
  return { label: 'Measured', checks, miniProgramRuntime: 'Unverified (no WeChat; Linux structure only)' }
}

// --- Offline emit stress: broken require fallthrough ---
function runFallthroughOffline() {
  const outDir = join(ROOT, 'fixture/dist/dev/mp-weixin')
  const pagePath = 'pages-tab/routeA/index'
  const vuePath = join(ROOT, 'fixture/src/pages-tab/routeA/index.vue')
  const jsPath = join(outDir, pagePath + '.js')
  if (!existsSync(jsPath) || !existsSync(vuePath)) {
    return { label: 'Unverified', reason: 'fixture dist or src missing' }
  }
  // Restore-ish: read current; build old/new scripts from backup + edit
  const backupVue = readFileSync(join(ROOT, 'fixture-source-backup/src/pages-tab/routeA/index.vue'), 'utf8')
  const oldScript = extractScript(backupVue)
  const newScript = oldScript.replace(/probeMul\(\s*21\s*\)/, 'probeMul(22)')

  // Ensure cold-like JS: if current already has 22, we still test emit cascade fail closed
  // Break a required chunk path temporarily
  const coldJs = readFileSync(jsPath, 'utf8')
  const reqs = parseColdRequires(coldJs)
  const probeReq = reqs.find((r) => r.rel.includes('unifastProbe') || r.rel.includes('unifast-probe'))
  const cases = []

  // Case: emit with dryRun against current
  const dry = emitOptCExtPage({
    outDir,
    pagePath,
    oldScript,
    newScript: newScript.includes('probeMul(22)') ? newScript : oldScript.replace(/probeMul\(\s*\d+\s*\)/, 'probeMul(99)'),
    dryRun: true,
  })
  cases.push({ name: 'dry-emit-local-import', ok: dry.ok, reason: dry.reason, emitClass: dry.emitClass })

  // Case: missing cold page js
  const miss = emitOptCExtPage({
    outDir,
    pagePath: 'pages-tab/routeA/does-not-exist',
    oldScript,
    newScript,
    dryRun: true,
  })
  cases.push({ name: 'missing-cold-page', ok: miss.ok, reason: miss.reason })

  // Case: render-binding removed
  const renamed = oldScript.replace(/\bconst\s+label\s*=/, 'const labelRenamed=')
  const fail = emitOptCExtPage({
    outDir,
    pagePath,
    oldScript,
    newScript: renamed,
    dryRun: true,
  })
  cases.push({
    name: 'render-binding-removed',
    ok: fail.ok,
    reason: fail.reason,
    setupBodyReason: fail.setupBodyReason || fail.setupBodyDetail?.reason,
  })

  return { label: 'Measured', probeReq: probeReq || null, cases }
}

// --- Project routeA SHA anatomy vs optc (bytes we have) ---
function runProjectShaAnatomyPrep() {
  // Current dist routeA is optc local-import (flagA true). Compare size/tokens to cold manifest meta.
  const routeAPath = join(ROOT, 'project/dist/dev/mp-weixin/pages-tab/routeA/index.js')
  if (!existsSync(routeAPath)) return { label: 'Unverified', reason: 'no dist routeA' }
  const code = readFileSync(routeAPath, 'utf8')
  const coldMeta = JSON.parse(
    readFileSync(join(ROOT, 'reports/box-project-optc-ext-local-import/cold.files.json'), 'utf8'),
  )['pages-tab/routeA/index.js']
  const afterMeta = JSON.parse(
    readFileSync(join(ROOT, 'reports/box-project-optc-ext-local-import/scriptLocalImport.files.json'), 'utf8'),
  )['pages-tab/routeA/index.js']
  return {
    label: 'Measured-meta',
    note: 'Full byte-SHA vs uni-warm deferred to baseline warm gold run',
    optcSha: sha(code),
    optcBytes: code.length,
    coldMeta,
    afterMeta,
    containsFlagATrue: /flagA\s*=\s*common_vendor\.ref\(\s*true\s*\)/.test(code),
    requireCount: parseColdRequires(code).length,
  }
}

results.workstreams.A_productCompare = runProductCompare()
results.workstreams.D_coverage = runCoverage()
results.workstreams.E_syntax = runSyntaxChecks()
results.workstreams.C_fallthroughOffline = runFallthroughOffline()
results.workstreams.A_projectShaPrep = runProjectShaAnatomyPrep()

mkdirSync(OUT, { recursive: true })
writeFileSync(join(OUT, 'linux-deep-offline-partial.json'), JSON.stringify(results, null, 2))
console.log(JSON.stringify({
  A: results.workstreams.A_productCompare.pairs?.map((p) => ({
    label: p.label,
    shaChanged: p.shaChangedCount,
    onlyPage: p.onlyIntendedPageJs,
    sample: p.sampleOtherPages,
  })),
  D: {
    sample: results.workstreams.D_coverage.sampleSize,
    capablePct: results.workstreams.D_coverage.pageOnlyCapablePct,
    breakdown: results.workstreams.D_coverage.preferBreakdown,
    crashes: results.workstreams.D_coverage.crashes,
  },
  E: results.workstreams.E_syntax.checks.map((c) => ({
    file: c.file?.split('/').slice(-3).join('/'),
    syntax: c.syntax?.ok,
    reqs: c.requires?.allExist,
  })),
  C: results.workstreams.C_fallthroughOffline.cases,
}, null, 2))
