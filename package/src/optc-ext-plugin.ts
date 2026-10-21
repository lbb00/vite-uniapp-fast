// @ts-nocheck — pragmatic conversion from .mjs; public API typed in index.ts
/**
 * BENCH_MODE=optc-ext — True Opt C for uni mp-weixin watch.
 *
 * Cold: full uni build; seed Opt B fingerprints (+ script text for literal diff).
 * Warm stable page script edit:
 *   1. Patch only the dirty page's on-disk .js (string surgical / named-literal / setup-body)
 *   2. Replace Rollup input with a virtual noop so Vite/Rollup does NOT rebuild
 *      the page closure (common/*, components stay as cold externals on disk)
 * Mid-path (F3): import-set / cascade-fail → midpath-sync shell splice when rewrite+externals OK.
 * Shared gate (F4/F7/F10–F12): script util ≤CLOSURE_MAX → closure-chunk (imports OK if cold externals);
 *   leaf util (0 page importers) still chunk-regen; Vue script-only ≤CLOSURE_MAX → closure-vue;
 *   else / template|style / over-threshold → full.
 * F14 Option A: export-add chunk regen; util+pages batch → chunk + page midpath/surgical;
 *   export rename with pages updated → option-a-batch; else fail-closed full.
 * F16 Option A no-dist: util with pages but no dist chunk → page-only inlined rebundle (proxy).
 * UNI_FAST_OPTC_FORCE_MIDPATH=1: after Opt B stable, skip surgical cascade and use midpath (F6 exercise).
 * Fallback: template/style/dep-content/unrecoverable → full rebuild (original input).
 */
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  utimesSync,
  openSync,
  closeSync,
  statSync,
  readdirSync,
} from 'node:fs'
import { dirname, join, relative, resolve, extname } from 'node:path'
import { parse as parseSfc } from '@vue/compiler-sfc'
import { performance } from 'node:perf_hooks'
import { emitOptCExtPage } from './optc-ext-emitter'
import { emitOptCExtMidpathSync } from './optc-ext-midpath'
import {
  emitClosureSharedChunkSync,
  emitClosureMultiChunkSync,
  emitClosureVueComponentSync,
  emitOptionABatchSync,
  emitOptionANoDistPageRebundleSync,
  classifyExportSurfaceChange,
  extractEsmExportNames,
  extractNamedImportsForResolved,
  parseVueScriptParts,
  findUtilImportersOf,
  resolveSharedDistChunk,
} from './optc-ext-closure'
import {
  loadEasycomConfig,
  extractTemplateComponentTags,
  resolveEasycomTag,
  seedEasycomIntoFingerprints,
} from './optc-ext-easycom'

const IMPORT_RE =
  /(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g

function sha(s) {
  return createHash('sha256').update(s).digest('hex')
}

import {
  scriptLooksOptionsOnly,
  scriptHasVueMacros,
} from './optc-ext-options'

function normalizePath(p) {
  return p.replace(/\\/g, '/')
}

function extractCjsRequires(code) {
  const specs = []
  let m
  const re = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  while ((m = re.exec(code))) {
    if (m[1]) specs.push(m[1])
  }
  return [...new Set(specs)].sort()
}

function extractStaticImports(code) {
  const specs = []
  let m
  const re = new RegExp(IMPORT_RE.source, 'g')
  while ((m = re.exec(code))) {
    const spec = m[1] || m[2]
    if (spec) specs.push(spec)
  }
  // Include static CJS require() — otherwise Opt B falsely treats require inject as import-set-stable
  // and surgical tip-only misses the new require (HASH_DIFF_BUG / imp.require_in_setup).
  for (const spec of extractCjsRequires(code)) specs.push(spec)
  return [...new Set(specs)].sort()
}

function parseVueSections(filePath) {
  if (statSync(filePath).isDirectory()) throw new Error('EISDIR: ' + filePath)
  const raw = readFileSync(filePath, 'utf8')
  if (!filePath.endsWith('.vue')) {
    return {
      raw,
      template: '',
      style: '',
      script: raw,
      templateHash: sha(''),
      styleHash: sha(''),
      scriptHash: sha(raw),
    }
  }
  const { descriptor } = parseSfc(raw, { filename: filePath })
  const template = descriptor.template?.content || ''
  const style = descriptor.styles.map((s) => s.content || '').join('\n')
  const script = [descriptor.script?.content, descriptor.scriptSetup?.content]
    .filter(Boolean)
    .join('\n')
  return {
    raw,
    template,
    style,
    script,
    templateHash: sha(template),
    styleHash: sha(style),
    scriptHash: sha(script),
  }
}

function resolveSpecifier(importerAbs, spec, inputDir, aliases) {
  if (spec.startsWith('@/')) {
    return normalizePath(resolve(inputDir, spec.slice(2)))
  }
  for (const [key, val] of aliases) {
    if (spec === key || spec.startsWith(key + '/')) {
      return normalizePath(resolve(val, spec.slice(key.length).replace(/^\//, '')))
    }
  }
  if (!spec.startsWith('.')) return null
  let resolved = normalizePath(resolve(dirname(importerAbs), spec))
  if (!extname(resolved)) {
    for (const ext of ['.vue', '.js', '.ts', '.mjs', '.json']) {
      if (existsSync(resolved + ext)) return resolved + ext
    }
    if (existsSync(join(resolved, 'index.vue'))) return normalizePath(join(resolved, 'index.vue'))
    if (existsSync(join(resolved, 'index.js'))) return normalizePath(join(resolved, 'index.js'))
  }
  return existsSync(resolved) ? resolved : null
}

function fingerprintScript(script, pageAbs, inputDir, aliases) {
  const specs = extractStaticImports(script)
  const contentHashes = {}
  for (const spec of specs) {
    const abs = resolveSpecifier(pageAbs, spec, inputDir, aliases)
    if (abs && existsSync(abs)) {
      try {
        if (statSync(abs).isDirectory()) continue
        contentHashes[abs] = sha(readFileSync(abs))
      } catch {
        /* skip */
      }
    }
  }
  const pathKey = specs.join('\0')
  const contentKey = Object.keys(contentHashes)
    .sort()
    .map((k) => k + '=' + contentHashes[k])
    .join('\0')
  return {
    specs,
    contentHashes,
    pathOnlyDigest: sha(pathKey),
    digest: sha(pathKey + '\n' + contentKey),
  }
}


function listPagesFromJson(inputDir) {
  const pagesJson = JSON.parse(readFileSync(join(inputDir, 'pages.json'), 'utf8'))
  const pages = []
  for (const p of pagesJson.pages || []) {
    const path = typeof p === 'string' ? p : p.path
    if (path && !path.startsWith('ext://')) pages.push(normalizePath(path))
  }
  for (const sub of pagesJson.subPackages || pagesJson.subpackages || []) {
    const root = sub.root || ''
    for (const p of sub.pages || []) {
      const path = typeof p === 'string' ? p : p.path
      if (!path || path.startsWith('ext://')) continue
      pages.push(normalizePath(join(root, path)))
    }
  }
  return [...new Set(pages)]
}

function pageFileCandidates(inputDir, pagePath) {
  const base = join(inputDir, pagePath)
  const out = []
  for (const ext of ['.vue', '.nvue', '.js', '.ts']) {
    if (existsSync(base + ext)) out.push(normalizePath(base + ext))
  }
  return out
}

function touch(file) {
  mkdirSync(dirname(file), { recursive: true })
  if (!existsSync(file)) closeSync(openSync(file, 'a'))
  const now = new Date()
  utimesSync(file, now, now)
}

const SKIP_ENTRY = '\0unifast-optc-ext-skip-entry'

function createInitialState() {
  return {
    enabled: true,
    mode: 'optc-ext',
    active: false,
    dirtyPages: [],
    reason: 'init',
    reasonCode: 'init',
    path: 'full',
    round: 0,
    lastDecision: null,
    seeded: false,
    pageCount: 0,
    viteSkipped: false,
    lastEmit: null,
    skipRebuild: false,
    // Risk-harden: dual-speed observability + integrity
    pathStats: { full: 0, 'optc-ext': 0, incremental: 0 },
    reasonCounts: {},
    pageOnlyEmitCount: 0,
    integrityChecks: 0,
    lastIntegrity: null,
    vendorShaAtSeed: null,
    integrityForcedFull: 0,
  }
}

/**
 * @param {{ inputDir?: string, outDir?: string, aliases?: Record<string,string> }} [opts]
 */
export function createOptCExtPlugin(opts = {}) {
  const state = createInitialState()
  globalThis.__UNI_FAST_OPTC_EXT__ = state
  globalThis.__UNI_FAST_PAGE_INC__ = state // metrics compat

  let inputDir = opts.inputDir || process.env.UNI_INPUT_DIR || ''
  let outDir = opts.outDir || process.env.UNI_OUTPUT_DIR || ''
  let aliases = Object.entries(opts.aliases || {})
  let allPages = []
  let pageFiles = new Map()
  let fingerprints = new Map()
  let originalInput = null
  let inputCaptured = false
  let round = 0
  let watchChangeAt = 0
  let watchKeep = []
  /** abs file → Set of pagePaths that import it (F4 shared-change gate) */
  let reverseDeps = new Map()
  /** abs .vue component → { templateHash, styleHash, script, scriptHash } for F12 */
  let componentFp = new Map()
  /** F14: coalesce multi-file watchChange in one microtask (utils before pages). */
  let pendingWatchIds = []
  let watchFlushScheduled = false

  function collectWatchKeep(root) {
    const out = []
    const exts = new Set(['.vue', '.nvue', '.js', '.ts', '.mjs', '.scss', '.sass', '.css', '.json'])
    function walk(dir, depth) {
      if (depth > 14) return
      let entries
      try {
        entries = readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const e of entries) {
        if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue
        const p = join(dir, e.name)
        if (e.isDirectory()) walk(p, depth + 1)
        else if (exts.has(extname(e.name))) out.push(normalizePath(p))
      }
    }
    if (root) walk(root, 0)
    return out
  }

  function refreshAliasFromConfig(config) {
    const a = config?.resolve?.alias
    const map = {}
    if (Array.isArray(a)) {
      for (const item of a) {
        if (item && item.find && item.replacement) map[String(item.find)] = String(item.replacement)
      }
    } else if (a && typeof a === 'object') {
      Object.assign(map, a)
    }
    if (!map['@'] && inputDir) map['@'] = inputDir
    aliases = Object.entries(map)
  }

  function seedAll() {
    fingerprints.clear()
    pageFiles.clear()
    allPages = listPagesFromJson(inputDir)
    state.pageCount = allPages.length
    let seededOk = 0
    let seededErr = 0
    for (const pagePath of allPages) {
      try {
        const files = pageFileCandidates(inputDir, pagePath)
        for (const f of files) pageFiles.set(f, pagePath)
        if (!files.length) continue
        if (statSync(files[0]).isDirectory()) {
          seededErr++
          continue
        }
        const sections = parseVueSections(files[0])
        const fp = fingerprintScript(sections.script, files[0], inputDir, aliases)
        fingerprints.set(pagePath, {
          file: files[0],
          templateHash: sections.templateHash,
          styleHash: sections.styleHash,
          scriptHash: sections.scriptHash,
          script: sections.script,
          fp,
        })
        seededOk++
      } catch (e) {
        seededErr++
        console.warn('[unifast-optc-ext] seed skip', pagePath, e.message)
      }
    }
    // F4: reverse dep index — which pages import each resolved file
    reverseDeps = new Map()
    for (const [pagePath, meta] of fingerprints) {
      const hashes = meta.fp?.contentHashes || {}
      for (const abs of Object.keys(hashes)) {
        const n = normalizePath(abs)
        if (!reverseDeps.has(n)) reverseDeps.set(n, new Set())
        reverseDeps.get(n).add(pagePath)
      }
    }
    state.sharedMultiPageCount = [...reverseDeps.values()].filter((s) => s.size > 1).length
    state.reverseDepFiles = reverseDeps.size
    // F12: seed Vue component fingerprints for script-only closure
    componentFp = new Map()
    for (const abs of reverseDeps.keys()) {
      if (!/\.vue$/i.test(abs)) continue
      try {
        const parts = parseVueScriptParts(readFileSync(abs, 'utf8'))
        componentFp.set(normalizePath(abs), {
          templateHash: parts.templateHash,
          styleHash: parts.styleHash,
          script: parts.script,
          scriptHash: parts.scriptHash,
        })
      } catch (e) {
        console.warn('[unifast-optc-ext] componentFp seed skip', abs, e.message)
      }
    }
    state.componentFpCount = componentFp.size
    // Close easycom/integrity gap: template-only components → reverseDeps + contentHashes
    try {
      const easy = seedEasycomIntoFingerprints(inputDir, fingerprints, reverseDeps, aliases)
      state.easycomSeedEdges = easy.edgeCount
      state.easycomSeedFiles = easy.fileCount
      state.easycomExternalFiles = (easy.externalPaths || []).length
      state.easycomAutoscan = easy.easycom?.autoscan !== false
      state.easycomCustomRules = Object.keys(easy.easycom?.custom || {}).length
      // refresh multi-page count after easycom edges
      state.sharedMultiPageCount = [...reverseDeps.values()].filter((s) => s.size > 1).length
      state.reverseDepFiles = reverseDeps.size
      // seed componentFp for easycom vue files newly added
      for (const abs of reverseDeps.keys()) {
        if (!/\.vue$/i.test(abs)) continue
        if (componentFp.has(normalizePath(abs))) continue
        try {
          const parts = parseVueScriptParts(readFileSync(abs, 'utf8'))
          componentFp.set(normalizePath(abs), {
            templateHash: parts.templateHash,
            styleHash: parts.styleHash,
            script: parts.script,
            scriptHash: parts.scriptHash,
          })
        } catch {
          /* skip */
        }
      }
      state.componentFpCount = componentFp.size
    } catch (e) {
      console.warn('[unifast-optc-ext] easycom seed failed', e.message)
      state.easycomSeedError = e.message
    }
    state.seeded = true
    state.seededOk = seededOk
    state.seededErr = seededErr
    watchKeep = collectWatchKeep(inputDir)
    state.watchKeepCount = watchKeep.length
    snapshotVendorSha()
    state.pageOnlyEmitCount = 0
    state.integrityChecks = 0
  }

  function reasonCodeOf(path, reason) {
    const r = String(reason || '')
    if (path === 'full') {
      if (r.startsWith('integrity')) return 'FULL_INTEGRITY'
      if (r.includes('template')) return 'FULL_TEMPLATE'
      if (r.includes('style')) return 'FULL_STYLE'
      if (r.includes('shared') || r.includes('multi-page') || r.includes('over-threshold'))
        return 'FULL_SHARED'
      if (r.includes('import-set') || r.includes('cjs-require')) return 'FULL_IMPORT_SET'
      if (r.includes('manifest') || r.includes('pages-or')) return 'FULL_CONFIG'
      if (r.includes('app-entry')) return 'FULL_APP'
      if (r.includes('global-style')) return 'FULL_STYLE'
      if (r.includes('easycom-external')) return 'FULL_EASYCOM'
      if (r.includes('options-api') || r.includes('options-only')) return 'FULL_OPTIONS'
      if (r.includes('vue-macro') || r.includes('macros')) return 'FULL_MACROS'
      if (r.includes('new-file') || r.includes('never-seeded')) return 'FULL_NEW_FILE'
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

  function setDecision(path, reason, extra = {}) {
    const reasonCode = reasonCodeOf(path, reason)
    state.path = path
    state.reason = reason
    state.reasonCode = reasonCode
    state.active = path === 'optc-ext' || path === 'incremental'
    if (!state.pathStats) state.pathStats = { full: 0, 'optc-ext': 0, incremental: 0 }
    if (!state.reasonCounts) state.reasonCounts = {}
    state.pathStats[path] = (state.pathStats[path] || 0) + 1
    state.reasonCounts[reasonCode] = (state.reasonCounts[reasonCode] || 0) + 1
    state.lastDecision = {
      path,
      reason,
      reasonCode,
      dirtyPages: [...state.dirtyPages],
      ...extra,
      at: new Date().toISOString(),
    }
  }

  function forceFull(reason, extra) {
    state.dirtyPages = []
    state.skipRebuild = false
    state.viteSkipped = false
    setDecision('full', reason, extra)
  }

  function snapshotVendorSha() {
    try {
      const v = join(outDir, 'common/vendor.js')
      if (outDir && existsSync(v)) {
        state.vendorShaAtSeed = sha(readFileSync(v))
      }
    } catch {
      /* ignore */
    }
  }

  function collectSharedSourceDrifts() {
    const drifts = []
    for (const [, meta] of fingerprints) {
      const hashes = meta.fp?.contentHashes || {}
      for (const abs of Object.keys(hashes)) {
        const expected = hashes[abs]
        if (!existsSync(abs)) {
          drifts.push({ abs, kind: 'missing-source' })
          continue
        }
        try {
          if (statSync(abs).isDirectory()) continue
          const now = sha(readFileSync(abs))
          if (now !== expected) {
            drifts.push({
              abs,
              kind: 'source-hash-mismatch',
              expected: String(expected).slice(0, 16),
              now: now.slice(0, 16),
            })
          }
        } catch (e) {
          drifts.push({ abs, kind: 'read-error', message: e.message })
        }
      }
    }
    return drifts
  }

  function checkVendorDrift() {
    if (!state.vendorShaAtSeed || !outDir) return null
    const v = join(outDir, 'common/vendor.js')
    if (!existsSync(v)) return { kind: 'vendor-missing' }
    const now = sha(readFileSync(v))
    if (now !== state.vendorShaAtSeed) {
      return {
        kind: 'vendor-sha-mismatch',
        expected: state.vendorShaAtSeed.slice(0, 16),
        now: now.slice(0, 16),
      }
    }
    return null
  }

  /**
   * After N successful page-only/closure emits, re-verify shared import content
   * hashes vs seed fingerprints and that common/vendor.js did not drift.
   * Env: UNI_FAST_OPTC_INTEGRITY_EVERY (default 10; 0 disables).
   * On drift → fail-closed full.
   */
  function maybeIntegrityGate(context = {}) {
    state.pageOnlyEmitCount = (state.pageOnlyEmitCount || 0) + 1
    const every = Number(process.env.UNI_FAST_OPTC_INTEGRITY_EVERY ?? 10)
    if (!Number.isFinite(every) || every <= 0) return false
    if (state.pageOnlyEmitCount % every !== 0) return false
    state.integrityChecks = (state.integrityChecks || 0) + 1
    const drifts = collectSharedSourceDrifts()
    const vendorDrift = checkVendorDrift()
    const payload = {
      pageOnlyEmitCount: state.pageOnlyEmitCount,
      integrityChecks: state.integrityChecks,
      driftCount: drifts.length,
      drifts: drifts.slice(0, 12),
      vendorDrift,
      context,
      at: new Date().toISOString(),
    }
    state.lastIntegrity = payload
    console.log('UNI_FAST_OPTC_EXT_INTEGRITY ' + JSON.stringify(payload))
    if (drifts.length || vendorDrift) {
      state.integrityForcedFull = (state.integrityForcedFull || 0) + 1
      forceFull('integrity-drift', {
        driftCount: drifts.length,
        vendorDrift,
        pageOnlyEmitCount: state.pageOnlyEmitCount,
      })
      return true
    }
    return false
  }

  function commitFastPath(reason, extra = {}) {
    setDecision('optc-ext', reason, extra)
    maybeIntegrityGate({ reason, pagePath: extra.pagePath || extra.file || null })
  }


  function hasConditionalCompileDirectiveChange(oldScript, newScript) {
    const re = /#ifdef\b|#ifndef\b|#endif\b/
    const o = re.test(oldScript || '')
    const n = re.test(newScript || '')
    if (o !== n) return true
    if (!n) return false
    // same presence — any script hash change with directives → full (uni preprocessor)
    return (oldScript || '') !== (newScript || '')
  }

  function tryOptC(pagePath, fileAbs) {
    const prev = fingerprints.get(pagePath)
    const sections = parseVueSections(fileAbs)
    const nextFp = fingerprintScript(sections.script, fileAbs, inputDir, aliases)

    if (!prev) {
      fingerprints.set(pagePath, {
        file: fileAbs,
        templateHash: sections.templateHash,
        styleHash: sections.styleHash,
        scriptHash: sections.scriptHash,
        script: sections.script,
        fp: nextFp,
      })
      forceFull('no-prior-fingerprint', { pagePath })
      return
    }

    if (sections.templateHash !== prev.templateHash) {
      Object.assign(prev, {
        templateHash: sections.templateHash,
        styleHash: sections.styleHash,
        scriptHash: sections.scriptHash,
        script: sections.script,
        fp: nextFp,
      })
      forceFull('template-changed', { pagePath })
      return
    }
    if (sections.styleHash !== prev.styleHash) {
      Object.assign(prev, {
        templateHash: sections.templateHash,
        styleHash: sections.styleHash,
        scriptHash: sections.scriptHash,
        script: sections.script,
        fp: nextFp,
      })
      forceFull('style-changed', { pagePath })
      return
    }

    if (hasConditionalCompileDirectiveChange(prev.script, sections.script)) {
      Object.assign(prev, {
        templateHash: sections.templateHash,
        styleHash: sections.styleHash,
        scriptHash: sections.scriptHash,
        script: sections.script,
        fp: nextFp,
      })
      forceFull('conditional-compile-changed', { pagePath })
      return
    }

    // CJS require() set change: fail-closed full (do not surgical tip-only / midpath-miss require emit)
    {
      const prevRequireList = extractCjsRequires(prev.script || '')
      const nextRequireList = extractCjsRequires(sections.script || '')
      if (prevRequireList.join('\0') !== nextRequireList.join('\0')) {
        Object.assign(prev, {
          templateHash: sections.templateHash,
          styleHash: sections.styleHash,
          scriptHash: sections.scriptHash,
          script: sections.script,
          fp: nextFp,
        })
        forceFull('cjs-require-set-changed', {
          pagePath,
          prevRequires: prevRequireList,
          nextRequires: nextRequireList,
        })
        return
      }
    }

    const pathStable = prev.fp.pathOnlyDigest === nextFp.pathOnlyDigest
    const contentStable = prev.fp.digest === nextFp.digest
    const optionsOnly = scriptLooksOptionsOnly(sections.script)
    const hasMacros = scriptHasVueMacros(sections.script)

    if (!pathStable) {
      // F3: try mid-path before full when only import-set shifted (template/style stable)
      const mid = emitOptCExtMidpathSync({
        outDir,
        pagePath,
        oldScript: prev.script,
        newScript: sections.script,
        allowImportSetChange: true,
      })
      if (mid.ok && mid.allExternalsOnDisk !== false) {
        prev.fp = nextFp
        prev.scriptHash = sections.scriptHash
        prev.script = sections.script
        state.dirtyPages = [pagePath]
        state.skipRebuild = true
        state.viteSkipped = true
        state.__benchEmitted = false
        state.lastEmit = { ...mid, emitMs: mid.timings?.totalMs || 0, watchChangeAt }
        commitFastPath('midpath-import-set', {
          pagePath,
          pathStable,
          contentStable,
          emitReason: mid.reason,
          emitClass: mid.emitClass,
          filesWritten: mid.filesWritten,
          afterSha: mid.afterSha,
          allExternalsOnDisk: mid.allExternalsOnDisk,
          requireCount: mid.requireCount,
          viteSkipped: true,
          midpath: true,
        })
        console.log(
          'UNI_FAST_OPTC_EXT_EMIT ' +
            JSON.stringify({
              pagePath,
              filesWritten: mid.filesWritten,
              emitMs: mid.timings?.totalMs,
              emitClass: mid.emitClass,
              reason: mid.reason,
              afterSha: mid.afterSha,
              midpath: true,
            })
        )
        return
      }
      prev.fp = nextFp
      prev.scriptHash = sections.scriptHash
      prev.script = sections.script
      forceFull('import-set-changed', {
        pagePath,
        pathStable,
        contentStable,
        midpathAttempt: { ok: mid.ok, reason: mid.reason },
      })
      return
    }
    if (!contentStable) {
      prev.fp = nextFp
      prev.scriptHash = sections.scriptHash
      prev.script = sections.script
      forceFull('dep-content-changed', { pagePath, pathStable, contentStable })
      return
    }

    // Opt B stable → True Opt C emit + skip Vite rebuild
    // F6: optional force midpath (skip F2 surgical cascade) for warm rebench
    if (process.env.UNI_FAST_OPTC_FORCE_MIDPATH === '1') {
      const mid = emitOptCExtMidpathSync({
        outDir,
        pagePath,
        oldScript: prev.script,
        newScript: sections.script,
        allowImportSetChange: false,
      })
      if (mid.ok && mid.allExternalsOnDisk !== false) {
        prev.fp = nextFp
        prev.scriptHash = sections.scriptHash
        prev.script = sections.script
        state.dirtyPages = [pagePath]
        state.skipRebuild = true
        state.viteSkipped = true
        state.__benchEmitted = false
        state.lastEmit = { ...mid, emitMs: mid.timings?.totalMs || 0, watchChangeAt }
        commitFastPath('midpath-forced', {
          pagePath,
          pathStable,
          contentStable,
          emitReason: mid.reason,
          emitClass: mid.emitClass,
          filesWritten: mid.filesWritten,
          afterSha: mid.afterSha,
          allExternalsOnDisk: mid.allExternalsOnDisk,
          requireCount: mid.requireCount,
          viteSkipped: true,
          midpath: true,
          forced: true,
        })
        console.log(
          'UNI_FAST_OPTC_EXT_EMIT ' +
            JSON.stringify({
              pagePath,
              filesWritten: mid.filesWritten,
              emitMs: mid.timings?.totalMs,
              emitClass: mid.emitClass,
              reason: mid.reason,
              afterSha: mid.afterSha,
              midpath: true,
              forced: true,
            })
        )
        return
      }
      prev.fp = nextFp
      prev.scriptHash = sections.scriptHash
      prev.script = sections.script
      forceFull('optc-force-midpath-failed', {
        pagePath,
        midpathAttempt: { ok: mid.ok, reason: mid.reason },
      })
      return
    }

    const emitStart = performance.now()
    const emit = emitOptCExtPage({
      outDir,
      pagePath,
      oldScript: prev.script,
      newScript: sections.script,
    })
    const emitMs = performance.now() - emitStart

    if (!emit.ok) {
      // F3: mid-path fallback when cold patches cannot explain the script diff
      const mid = emitOptCExtMidpathSync({
        outDir,
        pagePath,
        oldScript: prev.script,
        newScript: sections.script,
        allowImportSetChange: false,
      })
      if (mid.ok && mid.allExternalsOnDisk !== false) {
        prev.fp = nextFp
        prev.scriptHash = sections.scriptHash
        prev.script = sections.script
        state.dirtyPages = [pagePath]
        state.skipRebuild = true
        state.viteSkipped = true
        state.__benchEmitted = false
        state.lastEmit = { ...mid, emitMs: mid.timings?.totalMs || 0, watchChangeAt }
        commitFastPath('midpath-after-cascade-fail', {
          pagePath,
          pathStable,
          contentStable,
          emitReason: mid.reason,
          emitClass: mid.emitClass,
          priorCascadeReason: emit.reason,
          filesWritten: mid.filesWritten,
          afterSha: mid.afterSha,
          allExternalsOnDisk: mid.allExternalsOnDisk,
          requireCount: mid.requireCount,
          viteSkipped: true,
          midpath: true,
        })
        console.log(
          'UNI_FAST_OPTC_EXT_EMIT ' +
            JSON.stringify({
              pagePath,
              filesWritten: mid.filesWritten,
              emitMs: mid.timings?.totalMs,
              emitClass: mid.emitClass,
              reason: mid.reason,
              priorCascadeReason: emit.reason,
              afterSha: mid.afterSha,
              midpath: true,
            })
        )
        return
      }
      prev.fp = nextFp
      prev.scriptHash = sections.scriptHash
      prev.script = sections.script
      forceFull('optc-emit-failed', {
        pagePath,
        emitReason: emit.reason,
        emit,
        midpathAttempt: { ok: mid.ok, reason: mid.reason },
      })
      return
    }

    // Fail closed: never leave page-only JS that requires missing cold chunks.
    if (emit.allExternalsOnDisk === false) {
      prev.fp = nextFp
      prev.scriptHash = sections.scriptHash
      prev.script = sections.script
      forceFull('optc-externals-missing', {
        pagePath,
        emitReason: emit.reason,
        missing: (emit.externals || []).filter((e) => !e.exists),
        emit,
      })
      return
    }

    prev.scriptHash = sections.scriptHash
    prev.script = sections.script
    prev.fp = nextFp
    state.dirtyPages = [pagePath]
    state.skipRebuild = true
    state.viteSkipped = true
    state.__benchEmitted = false
    state.lastEmit = { ...emit, emitMs, watchChangeAt }
    commitFastPath('import-set-and-dep-content-stable', {
      pagePath,
      pathStable,
      contentStable,
      emitReason: emit.reason,
      emitClass: emit.emitClass || emit.reason,
      filesWritten: emit.filesWritten,
      afterSha: emit.afterSha,
      allExternalsOnDisk: emit.allExternalsOnDisk,
      requireCount: emit.requireCount,
      viteSkipped: true,
    })
    console.log(
      'UNI_FAST_OPTC_EXT_EMIT ' +
        JSON.stringify({
          pagePath,
          filesWritten: emit.filesWritten,
          emitMs,
          emitClass: emit.emitClass || emit.reason,
          reason: emit.reason,
          changes: emit.changes,
          afterSha: emit.afterSha,
          allExternalsOnDisk: emit.allExternalsOnDisk,
          requireCount: emit.requireCount,
        })
    )
  }

  function absToPage(id) {
    const clean = normalizePath(id.split('?')[0])
    if (pageFiles.has(clean)) return pageFiles.get(clean)
    if (inputDir && clean.startsWith(normalizePath(inputDir))) {
      const rel = relative(inputDir, clean)
      const noExt = normalizePath(rel).replace(/\.(vue|nvue|js|ts)$/, '')
      if (fingerprints.has(noExt)) return noExt
    }
    return null
  }


  function contentHashesHas(absPath) {
    const n = normalizePath(absPath)
    for (const meta of fingerprints.values()) {
      if (meta?.fp?.contentHashes && meta.fp.contentHashes[n]) return true
    }
    return false
  }

  function handleOneWatchFile(clean) {
      if (!inputDir) return
      if (clean.endsWith('pages.json') || clean.endsWith('manifest.json')) {
        forceFull('pages-or-manifest-changed', { file: clean })
        return
      }
      if (clean.endsWith('App.vue') || clean.endsWith('/main.js') || clean.endsWith('/main.ts')) {
        forceFull('app-entry-changed', { file: clean })
        return
      }
      // Global style / theme tokens often pulled into every page wxss (not in script FP)
      if (
        clean.endsWith('uni.scss') ||
        clean.endsWith('uni.less') ||
        clean.endsWith('/theme.scss') ||
        clean.endsWith('/variables.scss')
      ) {
        forceFull('global-style-changed', { file: clean })
        return
      }

      const pagePath = absToPage(clean)
      if (pagePath) {
        tryOptC(pagePath, clean)
        return
      }

      if (clean.startsWith(normalizePath(inputDir))) {
        // Never-seeded side file: first sight of a path not in FP/reverseDeps/componentFp → full once
        {
          const known =
            reverseDeps.has(clean) ||
            componentFp.has(clean) ||
            contentHashesHas(clean) ||
            pageFiles.has(clean)
          const isSource =
            /\.(vue|nvue|js|mjs|ts|tsx|jsx|json|scss|sass|less|css)$/i.test(clean)
          if (!known && isSource && !clean.endsWith('pages.json') && !clean.endsWith('manifest.json')) {
            // Seed lightly then force full so integrity graph catches up
            try {
              const st = statSync(clean)
              if (st.isFile()) {
                forceFull('new-file-never-seeded', {
                  file: normalizePath(relative(inputDir, clean)),
                  hint: 'Path not in cold FP/reverseDeps — fail-closed full to seed',
                })
                return
              }
            } catch {
              /* ignore */
            }
          }
        }
        // F4/F7/F10–F12: shared-change gate + closure-chunk / closure-vue
        const importers = reverseDeps.get(clean)
        const importerCount = importers ? importers.size : 0
        const rel = normalizePath(relative(inputDir, clean))
        const closureMax = Number(process.env.UNI_FAST_OPTC_CLOSURE_MAX || 3)
        const looksSharedPath =
          /(^|\/)(components|modules|utils|common|libs|shared|store|mixins|plugins|composables|services|hooks|uni_modules)(\/|$)/.test(
            rel,
          )
        const isVueSfc = /\.vue$/i.test(clean)
        const isScriptUtil = /\.(js|mjs|ts)$/i.test(clean)

        // F12: Vue SFC script-only with small importer set
        // Independent of UNI_FAST_OPTC_CLOSURE_MAX (no fallback): default 512.
        const vueMax = Number(process.env.UNI_FAST_OPTC_CLOSURE_VUE_MAX || 512)
        // Vue script-only regen writes ONE component dist file; importer count is not O(n) cost.
        // Default vueMax=512 (was shared CLOSURE_MAX=3) — Measured: a shared component with ~500 importers.
        if (isVueSfc && importerCount >= 1 && importerCount <= vueMax) {
          const prevComp = componentFp.get(clean)
          const parts = parseVueScriptParts(readFileSync(clean, 'utf8'))
          if (!prevComp) {
            componentFp.set(clean, {
              templateHash: parts.templateHash,
              styleHash: parts.styleHash,
              script: parts.script,
              scriptHash: parts.scriptHash,
            })
            forceFull('shared-vue-no-prior-fp', {
              file: rel,
              importerCount,
              hint: 'F12: first sight of component — full once to seed',
            })
            return
          }
          if (
            parts.templateHash !== prevComp.templateHash ||
            parts.styleHash !== prevComp.styleHash
          ) {
            componentFp.set(clean, {
              templateHash: parts.templateHash,
              styleHash: parts.styleHash,
              script: parts.script,
              scriptHash: parts.scriptHash,
            })
            forceFull('shared-vue-template-or-style', {
              file: rel,
              importerCount,
              templateChanged: parts.templateHash !== prevComp.templateHash,
              styleChanged: parts.styleHash !== prevComp.styleHash,
            })
            return
          }
          if (parts.scriptHash === prevComp.scriptHash) {
            // noop
            state.skipRebuild = true
            state.viteSkipped = true
            commitFastPath('closure-vue-noop', { file: rel })
            return
          }
          const clo = emitClosureVueComponentSync({
            inputDir,
            outDir,
            sourceAbs: clean,
            oldScript: prevComp.script,
            newScript: parts.script,
          })
          if (clo.ok) {
            componentFp.set(clean, {
              templateHash: parts.templateHash,
              styleHash: parts.styleHash,
              script: parts.script,
              scriptHash: parts.scriptHash,
            })
            const nextHash = sha(readFileSync(clean))
            for (const pagePath of importers) {
              const meta = fingerprints.get(pagePath)
              if (!meta?.fp?.contentHashes) continue
              meta.fp.contentHashes[clean] = nextHash
              const contentKey = Object.keys(meta.fp.contentHashes)
                .sort()
                .map((k) => k + '=' + meta.fp.contentHashes[k])
                .join('\0')
              meta.fp.digest = sha((meta.fp.specs || []).join('\0') + '\n' + contentKey)
            }
            state.dirtyPages = [...importers].slice(0, 8)
            state.skipRebuild = true
            state.viteSkipped = true
            state.__benchEmitted = false
            state.lastEmit = {
              ...clo,
              emitMs: clo.timings?.totalMs || 0,
              watchChangeAt,
              importerCount,
            }
            commitFastPath('closure-vue-script', {
              file: rel,
              importerCount,
              importers: [...importers].slice(0, 8),
              emitReason: clo.reason,
              emitClass: clo.emitClass,
              writeMode: clo.writeMode,
              pageEmitClass: clo.pageEmitClass,
              filesWritten: clo.filesWritten,
              afterSha: clo.afterSha,
              viteSkipped: true,
              closureRebuild: 'vue-script-only',
            })
            console.log(
              'UNI_FAST_OPTC_EXT_EMIT ' +
                JSON.stringify({
                  file: rel,
                  filesWritten: clo.filesWritten,
                  emitMs: clo.timings?.totalMs,
                  emitClass: clo.emitClass,
                  pageEmitClass: clo.pageEmitClass,
                  reason: clo.reason,
                  afterSha: clo.afterSha,
                  importerCount,
                  closureVue: true,
                }),
            )
            return
          }
          componentFp.set(clean, {
            templateHash: parts.templateHash,
            styleHash: parts.styleHash,
            script: parts.script,
            scriptHash: parts.scriptHash,
          })
          forceFull('shared-vue-closure-failed', {
            file: rel,
            importerCount,
            closureAttempt: { ok: clo.ok, reason: clo.reason, pageEmitClass: clo.pageEmitClass },
          })
          return
        }

        // F7/F10/F11: script util closure (page importers 1..max OR leaf with dist chunk)
        const utilImporters =
          isScriptUtil && !isVueSfc ? findUtilImportersOf(inputDir, clean) : []
        const canTryUtilClosure =
          isScriptUtil &&
          !isVueSfc &&
          (importerCount <= closureMax) &&
          (importerCount >= 1 ||
            utilImporters.length > 0 ||
            !!resolveSharedDistChunk(inputDir, outDir, clean))

        if (canTryUtilClosure && importerCount <= closureMax) {
          // F11: if primary imports other locals that also appear dirty — only one file per watchChange;
          // multi-chunk helper: regen primary; related cold externals must exist (fail-closed inside).
          const clo =
            utilImporters.length > 0 && importerCount === 0
              ? emitClosureMultiChunkSync({
                  inputDir,
                  outDir,
                  sourceAbs: clean,
                  alsoRegenSources: [],
                })
              : emitClosureSharedChunkSync({
                  inputDir,
                  outDir,
                  sourceAbs: clean,
                })
          if (clo.ok) {
            const nextHash = sha(readFileSync(clean))
            for (const pagePath of importers || []) {
              const meta = fingerprints.get(pagePath)
              if (!meta?.fp?.contentHashes) continue
              meta.fp.contentHashes[clean] = nextHash
              const contentKey = Object.keys(meta.fp.contentHashes)
                .sort()
                .map((k) => k + '=' + meta.fp.contentHashes[k])
                .join('\0')
              meta.fp.digest = sha((meta.fp.specs || []).join('\0') + '\n' + contentKey)
            }
            // Also refresh pages that import util-importers of this leaf (best-effort fingerprint)
            if (importerCount === 0 && utilImporters.length) {
              for (const uAbs of utilImporters) {
                const uImps = reverseDeps.get(normalizePath(uAbs))
                if (!uImps) continue
                for (const pagePath of uImps) {
                  const meta = fingerprints.get(pagePath)
                  if (!meta?.fp?.contentHashes) continue
                  // leaf content change is transitive; mark digest dirty-stable by hashing leaf into meta if present
                  if (meta.fp.contentHashes[clean] != null) {
                    meta.fp.contentHashes[clean] = nextHash
                  }
                }
              }
            }
            state.dirtyPages = importers ? [...importers].slice(0, 8) : []
            state.skipRebuild = true
            state.viteSkipped = true
            state.__benchEmitted = false
            state.lastEmit = {
              ...clo,
              emitMs: clo.timings?.totalMs || 0,
              watchChangeAt,
              importerCount,
              utilImporterCount: utilImporters.length,
            }
            commitFastPath('closure-shared-chunk', {
              file: rel,
              importerCount,
              utilImporterCount: utilImporters.length,
              importers: importers ? [...importers].slice(0, 8) : [],
              emitReason: clo.reason,
              emitClass: clo.emitClass,
              writeMode: clo.writeMode,
              filesWritten: clo.filesWritten,
              importCount: clo.importCount,
              afterSha: clo.afterSha,
              viteSkipped: true,
              closureRebuild: importerCount === 0 ? 'leaf-chunk-regen' : 'chunk-regen',
            })
            console.log(
              'UNI_FAST_OPTC_EXT_EMIT ' +
                JSON.stringify({
                  file: rel,
                  filesWritten: clo.filesWritten,
                  emitMs: clo.timings?.totalMs,
                  emitClass: clo.emitClass,
                  reason: clo.reason,
                  writeMode: clo.writeMode,
                  importCount: clo.importCount,
                  afterSha: clo.afterSha,
                  importerCount,
                  utilImporterCount: utilImporters.length,
                  closure: true,
                }),
            )
            return
          }

          // F14 Option A: export-add → chunk regen; rename/mixed → chunk + page re-emit
          if (
            clo.optionACandidate &&
            importerCount >= 1 &&
            importerCount <= closureMax
          ) {
            // F16: no dedicated dist chunk → page-only inlined rebundle (proxy-for-inlined)
            if (clo.reason === 'closure-dist-chunk-missing') {
              const pageUpdatesNd = []
              let pagesReadyNd = true
              for (const pagePath of importers) {
                const meta = fingerprints.get(pagePath)
                if (!meta?.file) {
                  pagesReadyNd = false
                  break
                }
                let sections
                try {
                  sections = parseVueSections(meta.file)
                } catch {
                  pagesReadyNd = false
                  break
                }
                pageUpdatesNd.push({
                  pagePath,
                  pageAbs: meta.file,
                  oldScript: meta.script || '',
                  newScript: sections.script,
                })
              }
              if (!pagesReadyNd) {
                forceFull('shared-module-option-a-blocked', {
                  file: rel,
                  importerCount,
                  reason: 'option-a-inlined-pages-not-ready',
                  hint: 'F16 no-dist: missing page fingerprint/file',
                })
                return
              }
              const usedNd = emitOptionANoDistPageRebundleSync({
                inputDir,
                outDir,
                sourceAbs: clean,
                pageUpdates: pageUpdatesNd,
                requireNoDist: true,
              })
              if (usedNd.ok) {
                const nextHash = sha(readFileSync(clean))
                for (const pr of usedNd.pageResults || []) {
                  const meta = fingerprints.get(pr.pagePath)
                  if (!meta) continue
                  if (pr.emitClass && pr.emitClass !== 'noop') {
                    try {
                      const sections = parseVueSections(meta.file)
                      const nextFp = fingerprintScript(
                        sections.script,
                        meta.file,
                        inputDir,
                        aliases,
                      )
                      meta.script = sections.script
                      meta.scriptHash = sections.scriptHash
                      meta.fp = nextFp
                    } catch {
                      /* keep */
                    }
                  }
                  if (meta.fp?.contentHashes) {
                    meta.fp.contentHashes[clean] = nextHash
                    const contentKey = Object.keys(meta.fp.contentHashes)
                      .sort()
                      .map((k) => k + '=' + meta.fp.contentHashes[k])
                      .join('\0')
                    meta.fp.digest = sha((meta.fp.specs || []).join('\0') + '\n' + contentKey)
                  }
                }
                for (const pagePath of importers) {
                  const meta = fingerprints.get(pagePath)
                  if (!meta?.fp?.contentHashes) continue
                  meta.fp.contentHashes[clean] = nextHash
                  const contentKey = Object.keys(meta.fp.contentHashes)
                    .sort()
                    .map((k) => k + '=' + meta.fp.contentHashes[k])
                    .join('\0')
                  meta.fp.digest = sha((meta.fp.specs || []).join('\0') + '\n' + contentKey)
                }
                state.dirtyPages = [
                  ...new Set([
                    ...importers,
                    ...(usedNd.pageResults || [])
                      .filter((p) => p.ok && p.changed)
                      .map((p) => p.pagePath),
                  ]),
                ].slice(0, 8)
                state.skipRebuild = true
                state.viteSkipped = true
                state.__benchEmitted = false
                state.lastEmit = {
                  ...usedNd,
                  emitMs: usedNd.timings?.totalMs || 0,
                  watchChangeAt,
                  importerCount,
                  optionA: 'inlined-no-dist-page-rebundle',
                }
                commitFastPath('option-a-inlined-page-rebundle', {
                  file: rel,
                  importerCount,
                  emitReason: usedNd.reason,
                  emitClass: usedNd.emitClass,
                  filesWritten: usedNd.filesWritten,
                  pageResults: usedNd.pageResults,
                  afterSha: usedNd.afterSha,
                  viteSkipped: true,
                  proxyForInlined: true,
                  optionA: 'inlined-no-dist-page-rebundle',
                })
                console.log(
                  'UNI_FAST_OPTC_EXT_EMIT ' +
                    JSON.stringify({
                      file: rel,
                      filesWritten: usedNd.filesWritten,
                      emitMs: usedNd.timings?.totalMs,
                      emitClass: usedNd.emitClass,
                      reason: usedNd.reason,
                      pageEmits: (usedNd.pageResults || []).filter((p) => p.ok && p.changed)
                        .length,
                      afterSha: usedNd.afterSha,
                      importerCount,
                      optionA: 'inlined-no-dist-page-rebundle',
                      proxyForInlined: true,
                    }),
                )
                return
              }
              forceFull('shared-module-option-a-blocked', {
                file: rel,
                importerCount,
                closureAttempt: { ok: clo.ok, reason: clo.reason },
                optionAAttempt: {
                  ok: usedNd.ok,
                  reason: usedNd.reason,
                  pageResults: usedNd.pageResults,
                },
                hint: 'F16 no-dist inlined page rebundle failed — fail-closed to full',
              })
              return
            }

            const coldExports = clo.coldExports || []
            const srcExports =
              clo.srcExports ||
              (existsSync(clean) ? extractEsmExportNames(readFileSync(clean, 'utf8')) : [])
            const surface = classifyExportSurfaceChange(coldExports, srcExports)

            // Build pageUpdates from disk vs fingerprints (pages may already be edited in same batch)
            const pageUpdates = []
            let pagesReady = true
            for (const pagePath of importers) {
              const meta = fingerprints.get(pagePath)
              if (!meta?.file) {
                pagesReady = false
                break
              }
              let sections
              try {
                sections = parseVueSections(meta.file)
              } catch (e) {
                pagesReady = false
                break
              }
              const used = extractNamedImportsForResolved(
                sections.script,
                meta.file,
                inputDir,
                clean,
              )
              const missing = used.filter((n) => !srcExports.includes(n))
              if (missing.length) {
                forceFull('shared-module-option-a-blocked', {
                  file: rel,
                  importerCount,
                  surface,
                  reason: 'option-a-page-imports-missing-export',
                  missing,
                  pagePath,
                  hint: 'Page still imports removed/renamed export — fail-closed full',
                })
                return
              }
              pageUpdates.push({
                pagePath,
                pageAbs: meta.file,
                oldScript: meta.script || '',
                newScript: sections.script,
              })
            }
            if (!pagesReady) {
              forceFull('shared-module-option-a-blocked', {
                file: rel,
                importerCount,
                surface,
                hint: 'Option A: missing page fingerprint/file',
              })
              return
            }

            const dirtyPages = pageUpdates.filter((p) => p.oldScript !== p.newScript)
            const allowAdd = surface.kind === 'add-only'
            const allowAny =
              surface.kind === 'rename-or-mixed' ||
              surface.kind === 'remove-only' ||
              process.env.UNI_FAST_OPTC_OPTION_A === '1'

            // add-only with no page script drift → chunk-only (extended Option B)
            if (allowAdd && dirtyPages.length === 0) {
              const cloAdd = emitClosureSharedChunkSync({
                inputDir,
                outDir,
                sourceAbs: clean,
                allowExportAdd: true,
              })
              if (cloAdd.ok) {
                const nextHash = sha(readFileSync(clean))
                for (const pagePath of importers) {
                  const meta = fingerprints.get(pagePath)
                  if (!meta?.fp?.contentHashes) continue
                  meta.fp.contentHashes[clean] = nextHash
                  const contentKey = Object.keys(meta.fp.contentHashes)
                    .sort()
                    .map((k) => k + '=' + meta.fp.contentHashes[k])
                    .join('\0')
                  meta.fp.digest = sha((meta.fp.specs || []).join('\0') + '\n' + contentKey)
                }
                state.dirtyPages = [...importers].slice(0, 8)
                state.skipRebuild = true
                state.viteSkipped = true
                state.__benchEmitted = false
                state.lastEmit = {
                  ...cloAdd,
                  emitMs: cloAdd.timings?.totalMs || 0,
                  watchChangeAt,
                  importerCount,
                  optionA: 'export-add-chunk-only',
                }
                commitFastPath('option-a-export-add', {
                  file: rel,
                  importerCount,
                  surface,
                  emitReason: cloAdd.reason,
                  emitClass: cloAdd.emitClass,
                  writeMode: cloAdd.writeMode,
                  exportSurfaceMode: cloAdd.exportSurfaceMode,
                  filesWritten: cloAdd.filesWritten,
                  afterSha: cloAdd.afterSha,
                  viteSkipped: true,
                  optionA: 'export-add-chunk-only',
                })
                console.log(
                  'UNI_FAST_OPTC_EXT_EMIT ' +
                    JSON.stringify({
                      file: rel,
                      filesWritten: cloAdd.filesWritten,
                      emitMs: cloAdd.timings?.totalMs,
                      emitClass: cloAdd.emitClass,
                      reason: cloAdd.reason,
                      exportSurfaceMode: cloAdd.exportSurfaceMode,
                      afterSha: cloAdd.afterSha,
                      importerCount,
                      optionA: 'export-add-chunk-only',
                    }),
                )
                return
              }
            }

            // Strong Option A: chunk (add or rename) + re-emit dirty pages
            if (allowAdd || allowAny || dirtyPages.length > 0) {
              const used = emitOptionABatchSync({
                inputDir,
                outDir,
                sourceAbs: clean,
                pageUpdates:
                  dirtyPages.length > 0
                    ? dirtyPages
                    : allowAdd
                      ? []
                      : pageUpdates /* rename: verify all pages noop+imports OK */,
                allowExportAdd: true,
                allowExportSurfaceChange: surface.kind !== 'add-only' || dirtyPages.length > 0,
              })
              if (used.ok) {
                const nextHash = sha(readFileSync(clean))
                for (const pr of used.pageResults || []) {
                  const meta = fingerprints.get(pr.pagePath)
                  if (!meta) continue
                  if (pr.emitClass && pr.emitClass !== 'noop') {
                    try {
                      const sections = parseVueSections(meta.file)
                      const nextFp = fingerprintScript(
                        sections.script,
                        meta.file,
                        inputDir,
                        aliases,
                      )
                      meta.script = sections.script
                      meta.scriptHash = sections.scriptHash
                      meta.fp = nextFp
                    } catch {
                      /* keep */
                    }
                  }
                  if (meta.fp?.contentHashes) {
                    meta.fp.contentHashes[clean] = nextHash
                    const contentKey = Object.keys(meta.fp.contentHashes)
                      .sort()
                      .map((k) => k + '=' + meta.fp.contentHashes[k])
                      .join('\0')
                    meta.fp.digest = sha((meta.fp.specs || []).join('\0') + '\n' + contentKey)
                  }
                }
                // also refresh importers that were noop
                for (const pagePath of importers) {
                  const meta = fingerprints.get(pagePath)
                  if (!meta?.fp?.contentHashes) continue
                  meta.fp.contentHashes[clean] = nextHash
                  const contentKey = Object.keys(meta.fp.contentHashes)
                    .sort()
                    .map((k) => k + '=' + meta.fp.contentHashes[k])
                    .join('\0')
                  meta.fp.digest = sha((meta.fp.specs || []).join('\0') + '\n' + contentKey)
                }
                state.dirtyPages = [
                  ...new Set([
                    ...importers,
                    ...(used.pageResults || [])
                      .filter((p) => p.emitClass && p.emitClass !== 'noop')
                      .map((p) => p.pagePath),
                  ]),
                ].slice(0, 8)
                state.skipRebuild = true
                state.viteSkipped = true
                state.__benchEmitted = false
                state.lastEmit = {
                  ...used,
                  emitMs: used.timings?.totalMs || 0,
                  watchChangeAt,
                  importerCount,
                  optionA: dirtyPages.length ? 'chunk-plus-pages' : 'chunk-surface',
                }
                commitFastPath('option-a-batch', {
                  file: rel,
                  importerCount,
                  surface,
                  emitReason: used.reason,
                  emitClass: used.emitClass,
                  exportSurfaceMode: used.exportSurfaceMode,
                  filesWritten: used.filesWritten,
                  pageResults: used.pageResults,
                  afterSha: used.afterSha,
                  viteSkipped: true,
                  optionA: dirtyPages.length ? 'chunk-plus-pages' : 'chunk-surface',
                })
                console.log(
                  'UNI_FAST_OPTC_EXT_EMIT ' +
                    JSON.stringify({
                      file: rel,
                      filesWritten: used.filesWritten,
                      emitMs: used.timings?.totalMs,
                      emitClass: used.emitClass,
                      reason: used.reason,
                      exportSurfaceMode: used.exportSurfaceMode,
                      pageEmits: (used.pageResults || []).filter(
                        (p) => p.emitClass && p.emitClass !== 'noop',
                      ).length,
                      afterSha: used.afterSha,
                      importerCount,
                      optionA: dirtyPages.length ? 'chunk-plus-pages' : 'chunk-surface',
                    }),
                )
                return
              }
              forceFull('shared-module-option-a-blocked', {
                file: rel,
                importerCount,
                surface,
                closureAttempt: { ok: clo.ok, reason: clo.reason },
                optionAAttempt: {
                  ok: used.ok,
                  reason: used.reason,
                  pageResults: used.pageResults,
                },
                hint: 'F14 Option A failed — fail-closed to full',
              })
              return
            }

            forceFull('shared-module-option-a-blocked', {
              file: rel,
              importerCount,
              surface,
              closureAttempt: { ok: clo.ok, reason: clo.reason },
              hint: 'F14 Option A: surface change not safely patchable — full',
            })
            return
          }

          forceFull('shared-module-closure-failed', {
            file: rel,
            importerCount,
            utilImporterCount: utilImporters.length,
            importers: importers ? [...importers].slice(0, 8) : [],
            closureRebuild: 'failed-to-full',
            closureAttempt: {
              ok: clo.ok,
              reason: clo.reason,
              coldExports: clo.coldExports,
              srcExports: clo.srcExports,
            },
          })
          return
        }

        if (looksSharedPath || importerCount >= 1 || isVueSfc) {
          forceFull('shared-module-multi-page', {
            file: rel,
            importerCount,
            importers: importers ? [...importers].slice(0, 8) : [],
            closureRebuild: importerCount > closureMax ? 'over-threshold-full' : 'stub-full',
            closureMax,
            vueMax: Number(process.env.UNI_FAST_OPTC_CLOSURE_VUE_MAX || 512),
            hint: isVueSfc
              ? importerCount > Number(process.env.UNI_FAST_OPTC_CLOSURE_VUE_MAX || 512)
                ? 'Vue SFC over CLOSURE_VUE_MAX importers → full'
                : 'Vue SFC → full (script-only path not taken)'
              : 'Shared/util/component change → full (importerCount over threshold or not script util)',
          })
          return
        }
        forceFull('non-page-or-shared-changed', { file: rel, importerCount })
      } else {
        // Outside inputDir (e.g. node_modules/@dcloudio/uni-ui via easycom custom)
        const n = normalizePath(clean)
        const importers = reverseDeps.get(n)
        if (importers && importers.size > 0) {
          forceFull('easycom-external-changed', {
            file: n,
            importerCount: importers.size,
            hint: 'easycom/custom component outside src — fail-closed full',
          })
          return
        }
        if (
          /node_modules\/@dcloudio\//.test(n) ||
          /node_modules\/(@[^/]+\/)?uni-/.test(n)
        ) {
          forceFull('easycom-external-changed', {
            file: n,
            hint: 'uni/dcloudio package change outside src — fail-closed full',
          })
          return
        }
      }
    
  }

  function flushWatchBatch(ids) {
    watchChangeAt = performance.now()
    const cleaned = []
    for (const id of ids) {
      const c = normalizePath(String(id).split('?')[0])
      if (c && !cleaned.includes(c)) cleaned.push(c)
    }
    // Utils / shared first, pages second — Option A chunk before page midpath
    cleaned.sort((a, b) => {
      const ap = absToPage(a) ? 1 : 0
      const bp = absToPage(b) ? 1 : 0
      return ap - bp
    })
    for (const clean of cleaned) {
      handleOneWatchFile(clean)
      // If a non-page forced full, stop; pages may still run after successful util skip
      if (state.path === 'full' && !state.skipRebuild && !absToPage(clean)) break
    }
  }


  return {
    name: 'unifast-optc-ext',
    enforce: 'pre',

    configResolved(config) {
      inputDir = normalizePath(opts.inputDir || process.env.UNI_INPUT_DIR || config.root || inputDir)
      outDir = normalizePath(
        opts.outDir || process.env.UNI_OUTPUT_DIR || join(config.root, 'dist/dev/mp-weixin')
      )
      refreshAliasFromConfig(config)
      try {
        allPages = listPagesFromJson(inputDir)
        state.pageCount = allPages.length
        for (const pagePath of allPages) {
          for (const f of pageFileCandidates(inputDir, pagePath)) pageFiles.set(f, pagePath)
        }
      } catch (e) {
        console.warn('[unifast-optc-ext] pages.json parse failed:', e.message)
      }
      globalThis.__UNI_FAST_OPTC_EXT__ = state
      globalThis.__UNI_FAST_PAGE_INC__ = state
    },

    options(rollupOptions) {
      // Capture the real uni input once (cold). Never replace it — skip path
      // aborts the rebuild in buildStart so the previous module graph stays watched.
      if (!inputCaptured && rollupOptions.input && rollupOptions.input !== SKIP_ENTRY) {
        originalInput = rollupOptions.input
        inputCaptured = true
      }
      return null
    },

    buildStart() {
      round++
      state.round = round
      if (round === 1) {
        state.active = false
        state.dirtyPages = []
        state.skipRebuild = false
        state.viteSkipped = false
        setDecision('full', 'cold')
      }
      if (state.skipRebuild) {
        // Abort immediately. Do NOT re-add thousands of watch files here —
        // that stalls chokidar on large projects. Throwing before the graph
        // rebuild leaves the previous (full) watcher set intact.
        globalThis.__UNI_FAST_OPTC_EXT__ = state
        globalThis.__UNI_FAST_PAGE_INC__ = state
        const err = new Error('unifast-optc-ext-skip')
        err.unifastOptcSkip = true
        throw err
      }
      globalThis.__UNI_FAST_OPTC_EXT__ = state
      globalThis.__UNI_FAST_PAGE_INC__ = state
    },

    watchChange(id) {
      if (!inputDir) return
      // F14: coalesce ids that arrive in the same synchronous turn (multi writeFileSync).
      pendingWatchIds.push(id)
      if (!watchFlushScheduled) {
        watchFlushScheduled = true
        queueMicrotask(() => {
          watchFlushScheduled = false
          const ids = pendingWatchIds
          pendingWatchIds = []
          flushWatchBatch(ids)
        })
      }
    },

    generateBundle() {
      // Full rebuilds write normally. Skip path never reaches generateBundle.
    },

    writeBundle() {
      if (round === 1 && !state.seeded) {
        try {
          seedAll()
          setDecision('full', 'cold-seeded', {
            seededPages: fingerprints.size,
            seededOk: state.seededOk,
            seededErr: state.seededErr,
          })
        } catch (e) {
          console.warn('[unifast-optc-ext] seed failed:', e.message)
        }
      } else if (state.path === 'optc-ext' && state.dirtyPages.length) {
        // fingerprints already updated in tryOptC
      } else if (state.path === 'full' && round > 1) {
        // After a full warm rebuild, re-seed dirty/all page scripts from disk
        for (const pagePath of allPages) {
          const files = pageFileCandidates(inputDir, pagePath)
          if (!files.length) continue
          try {
            if (statSync(files[0]).isDirectory()) continue
            const sections = parseVueSections(files[0])
            const fp = fingerprintScript(sections.script, files[0], inputDir, aliases)
            fingerprints.set(pagePath, {
              file: files[0],
              templateHash: sections.templateHash,
              styleHash: sections.styleHash,
              scriptHash: sections.scriptHash,
              script: sections.script,
              fp,
            })
          } catch {
            /* skip */
          }
        }
      }
      globalThis.__UNI_FAST_OPTC_EXT__ = state
      globalThis.__UNI_FAST_PAGE_INC__ = state
    },

    closeBundle: {
      order: 'post',
      sequential: true,
      handler() {
        // After a skipped rebuild, clear skip flag so a subsequent full path works.
        // Keep viteSkipped/lastEmit for metrics in this same closeBundle tick.
        const decision = {
          round,
          path: state.path,
          reason: state.reason,
          reasonCode: state.reasonCode || reasonCodeOf(state.path, state.reason),
          dirtyPages: state.dirtyPages,
          active: state.active,
          seeded: state.seeded,
          pageCount: state.pageCount,
          viteSkipped: state.viteSkipped,
          pathStats: state.pathStats,
          reasonCounts: state.reasonCounts,
          pageOnlyEmitCount: state.pageOnlyEmitCount,
          integrityChecks: state.integrityChecks,
          integrityForcedFull: state.integrityForcedFull,
          lastIntegrity: state.lastIntegrity
            ? {
                pageOnlyEmitCount: state.lastIntegrity.pageOnlyEmitCount,
                driftCount: state.lastIntegrity.driftCount,
                vendorDrift: state.lastIntegrity.vendorDrift,
              }
            : null,
          vendorShaAtSeed: state.vendorShaAtSeed
            ? String(state.vendorShaAtSeed).slice(0, 16)
            : null,
          lastEmit: state.lastEmit
            ? {
                filesWritten: state.lastEmit.filesWritten,
                emitMs: state.lastEmit.emitMs,
                afterSha: state.lastEmit.afterSha,
                changes: state.lastEmit.changes,
                allExternalsOnDisk: state.lastEmit.allExternalsOnDisk,
                requireCount: state.lastEmit.requireCount,
                emitClass: state.lastEmit.emitClass || state.lastEmit.reason,
              }
            : null,
          lastDecision: state.lastDecision,
        }
        console.log('UNI_FAST_OPTC_EXT_DECISION ' + JSON.stringify(decision))
        console.log('UNI_FAST_PAGE_INC_DECISION ' + JSON.stringify(decision))
        // Reset skip so next watchChange starts clean; metrics reads state before this if order ok.
        // Actually metrics closeBundle also order post — keep skip info until after metrics.
        // Clear skipRebuild so next full rebuild uses original input; leave lastEmit for metrics.
        state.skipRebuild = false
        globalThis.__UNI_FAST_OPTC_EXT__ = state
        globalThis.__UNI_FAST_PAGE_INC__ = state
      },
    },
  }
}

export {
  loadEasycomConfig,
  extractTemplateComponentTags,
  resolveEasycomTag,
  seedEasycomIntoFingerprints,
} from './optc-ext-easycom'

export default createOptCExtPlugin
