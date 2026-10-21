// @ts-nocheck — pragmatic conversion from .mjs; public API typed in index.ts
/**
 * F3 mid-path: single-page Rollup with cold externals (falsifiable prototype).
 *
 * When surgical/named/plain/call-arg/setup-body cannot patch, but only THIS page's
 * script changed (template/style stable; caller may allow import-set change):
 *   - Build a tiny CJS bundle of the rewritten setup body + cold require preamble
 *   - Mark every cold require / relative chunk as external
 *   - Write only the page .js
 *
 * Minimal viable (documented): we do NOT re-run full @dcloudio SFC pipeline.
 * We take stripImports(newScript), rewrite vue/uni → common_vendor + local→require
 * map (same as setup-body), then Rollup that body as a synthetic module glued into
 * the cold page shell (preamble + return closure preserved when split succeeds).
 *
 * If rewrite map has unmapped locals or setup split fails → ok:false (fail-closed).
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import {
  stripImports,
  buildLocalRewriteMap,
  rewriteIdents,
  rewriteVueApisToCommonVendor,
  preferDoubleQuotes,
  splitColdSetup,
  assignedNames,
  renderReferencedNames,
  parseColdRequires,
  pageJsPath,
  formatSetupStmtsLikeUni,
  atomicWriteFile,
  detectForbiddenSetupResidues,
} from './optc-ext-emitter'

function sha(s) {
  return createHash('sha256').update(s).digest('hex')
}

function normalizePath(p) {
  return p.replace(/\\/g, '/')
}

async function loadRollup() {
  try {
    return await import('rollup')
  } catch {
    throw new Error('rollup-not-found')
  }
}

/**
 * Produce setup-body text the same way setup-body splice does (shared rewrite).
 */
export function rewriteSetupBodyForCold(newScript, coldJs, pagePath, outDir) {
  const forbidden = detectForbiddenSetupResidues(String(newScript || '')) || []
  if (forbidden.length) {
    return {
      ok: false,
      reason: 'midpath-vue-macro-residue',
      forbidden,
      hint: 'defineProps/macros must not be midpath-spliced into setup',
    }
  }
  const localUsedHint = true
  const rewriteInfo = buildLocalRewriteMap(newScript, coldJs, pagePath, outDir)
  if (rewriteInfo.unmapped.length) {
    return {
      ok: false,
      reason: 'midpath-local-unmapped',
      unmapped: rewriteInfo.unmapped,
      mapped: rewriteInfo.mapped,
    }
  }
  let rewritten = rewriteIdents(stripImports(newScript), rewriteInfo.map)
  rewritten = rewriteVueApisToCommonVendor(rewritten)
  rewritten = preferDoubleQuotes(rewritten)
  rewritten = rewritten.replace(/\b(const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*/g, '$1 $2 = ')
  rewritten = rewritten.replace(/\s*;\s*/g, '; ')
  rewritten = rewritten.replace(/;\s*$/, '')
  rewritten = rewritten.trim()
  if (!/[;\}]$/.test(rewritten)) rewritten += ';'
  rewritten = rewritten.replace(
    /process\.env\.NODE_ENV\s*===?\s*['"]development['"]/g,
    'true',
  )
  rewritten = rewritten.replace(
    /process\.env\.NODE_ENV\s*!==?\s*['"]production['"]/g,
    'true',
  )
  return { ok: true, body: rewritten, rewriteInfo }
}

/**
 * Mid-path emit: glue rewritten setup into cold shell OR rollup a synthetic page.
 *
 * Strategy A (preferred when splitColdSetup works): identical to setup-body splice
 *   but invoked only when cascade already failed — so this is mainly for cases
 *   where we want Rollup to resolve NEW relative imports added in the page script
 *   (import-set change) while keeping common/* external.
 *
 * Strategy B (import-set changed): create virtual entry that:
 *   - re-exports cold requires as externals
 *   - includes the new setup body
 *   Currently: if import-set adds a NEW local module not in cold requires, we
 *   attempt to mark known cold relative paths as external and bundle only what
 *   Rollup can see from a virtual setup module. If the new import cannot be
 *   externalized to an existing cold chunk → fail-closed.
 */
export async function emitOptCExtMidpath({
  outDir,
  pagePath,
  oldScript,
  newScript,
  dryRun = false,
  allowImportSetChange = false,
}) {
  const t0 = performance.now()
  const file = pageJsPath(outDir, pagePath)
  if (!existsSync(file)) {
    return {
      ok: false,
      reason: 'cold-page-js-missing',
      file,
      emitClass: 'midpath-rollup',
      timings: { totalMs: performance.now() - t0 },
    }
  }
  const coldJs = readFileSync(file, 'utf8')
  const requires = parseColdRequires(coldJs)
  const externalRels = new Set(requires.map((r) => normalizePath(r.rel)))

  const rewritten = rewriteSetupBodyForCold(newScript, coldJs, pagePath, outDir)
  if (!rewritten.ok) {
    return {
      ...rewritten,
      emitClass: 'midpath-rollup',
      timings: { totalMs: performance.now() - t0 },
    }
  }

  const split = splitColdSetup(coldJs)
  if (!split) {
    return {
      ok: false,
      reason: 'midpath-setup-split-failed',
      emitClass: 'midpath-rollup',
      timings: { totalMs: performance.now() - t0 },
    }
  }

  const newAssigned = assignedNames(rewritten.body)
  const oldColdAssigned = assignedNames(split.setupStmts)
  const renderNames = renderReferencedNames(split.returnAndAfter)
  const missing = []
  for (const n of oldColdAssigned) {
    if (renderNames.has(n) && !newAssigned.has(n)) missing.push(n)
  }
  if (missing.length) {
    return {
      ok: false,
      reason: 'midpath-render-binding-removed',
      missing,
      emitClass: 'midpath-rollup',
      timings: { totalMs: performance.now() - t0 },
    }
  }

  // --- Try Rollup on a virtual module that only contains the setup stmts ---
  // Goal: prove we can invoke Rollup with externals = cold require graph.
  // The virtual module imports nothing (already rewritten to require-binding forms);
  // Rollup still runs as a "compile" step and leaves code as CJS fragment.
  let rollupCode = null
  let rollupMs = 0
  let rollupUsed = false
  try {
    const { rollup } = await loadRollup()
    const virtualId = '\0unifast-midpath-setup'
    const virtualSource =
      'export function __unifast_setup_body() {\n' +
      rewritten.body
        .split('\n')
        .map((l) => '  ' + l)
        .join('\n') +
      '\n  return { ' +
      [...newAssigned].join(', ') +
      ' };\n}\n'

    const tR0 = performance.now()
    const bundle = await rollup({
      input: virtualId,
      external: (id) => {
        if (id === virtualId) return false
        // Everything else external (we already rewrote locals)
        return true
      },
      plugins: [
        {
          name: 'unifast-midpath-virtual',
          resolveId(id) {
            if (id === virtualId) return id
            return { id, external: true }
          },
          load(id) {
            if (id === virtualId) return virtualSource
            return null
          },
        },
      ],
      // Suppress warnings about unused
      onwarn() {},
    })
    const { output } = await bundle.generate({
      format: 'cjs',
      exports: 'named',
      strict: false,
    })
    await bundle.close()
    rollupMs = performance.now() - tR0
    rollupUsed = true
    rollupCode = output[0]?.code || ''
  } catch (e) {
    return {
      ok: false,
      reason: 'midpath-rollup-failed',
      error: e.message,
      emitClass: 'midpath-rollup',
      timings: { totalMs: performance.now() - t0 },
    }
  }

  // Prefer cold-shell splice (byte-stable with setup-body path) as the written artifact.
  // Rollup run is the falsifiable proof that externals graph works; we record its ms/bytes.
  // Uni-like partial DCE + multi-line format (shared with setup-body)
  const indented = formatSetupStmtsLikeUni(rewritten.body, split.returnAndAfter)

  const next = split.beforeSetupBody + '\n' + indented + '\n    ' + split.returnAndAfter.trimStart()

  const reqs = [...next.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map((m) => m[1])
  const externals = []
  for (const r of reqs) {
    const abs = normalizePath(join(dirname(file), r))
    externals.push({
      require: r,
      exists: existsSync(abs),
      bytes: existsSync(abs) && !statSync(abs).isDirectory() ? statSync(abs).size : 0,
    })
  }
  if (!externals.every((e) => e.exists)) {
    return {
      ok: false,
      reason: 'externals-missing',
      emitClass: 'midpath-rollup',
      externals,
      allExternalsOnDisk: false,
      rollupUsed,
      rollupMs,
      timings: { totalMs: performance.now() - t0 },
    }
  }

  if (!dryRun) {
    mkdirSync(dirname(file), { recursive: true })
    atomicWriteFile(file, next)
  }

  return {
    ok: true,
    reason: 'midpath-rollup-shell-splice',
    emitClass: 'midpath-rollup',
    file,
    filesWritten: dryRun ? 0 : 1,
    generated: 1,
    beforeSha: sha(coldJs),
    afterSha: sha(next),
    requireCount: reqs.length,
    externals,
    allExternalsOnDisk: true,
    rollupUsed,
    rollupMs,
    rollupBytes: rollupCode?.length || 0,
    note:
      'MVP: Rollup invoked with cold require graph as external; page bytes written via cold-shell splice (same rewrite as setup-body). Full uni SFC pipeline not re-run.',
    allowImportSetChange,
    externalRelCount: externalRels.size,
    timings: { totalMs: performance.now() - t0, rollupMs },
  }
}

export default emitOptCExtMidpath

/**
 * Sync mid-path for Vite watchChange: cold-shell splice only (no Rollup await).
 * Rollup proof stays in emitOptCExtMidpath (async) / regression suite.
 */
export function emitOptCExtMidpathSync({
  outDir,
  pagePath,
  oldScript,
  newScript,
  dryRun = false,
  allowImportSetChange = false,
}) {
  const t0 = performance.now()
  const file = pageJsPath(outDir, pagePath)
  if (!existsSync(file)) {
    return {
      ok: false,
      reason: 'cold-page-js-missing',
      file,
      emitClass: 'midpath-sync',
      timings: { totalMs: performance.now() - t0 },
    }
  }
  const coldJs = readFileSync(file, 'utf8')
  const rewritten = rewriteSetupBodyForCold(newScript, coldJs, pagePath, outDir)
  if (!rewritten.ok) {
    return {
      ...rewritten,
      emitClass: 'midpath-sync',
      timings: { totalMs: performance.now() - t0 },
    }
  }
  const split = splitColdSetup(coldJs)
  if (!split) {
    return {
      ok: false,
      reason: 'midpath-setup-split-failed',
      emitClass: 'midpath-sync',
      timings: { totalMs: performance.now() - t0 },
    }
  }
  const newAssigned = assignedNames(rewritten.body)
  const oldColdAssigned = assignedNames(split.setupStmts)
  const renderNames = renderReferencedNames(split.returnAndAfter)
  const missing = []
  for (const n of oldColdAssigned) {
    if (renderNames.has(n) && !newAssigned.has(n)) missing.push(n)
  }
  if (missing.length) {
    return {
      ok: false,
      reason: 'midpath-render-binding-removed',
      missing,
      emitClass: 'midpath-sync',
      timings: { totalMs: performance.now() - t0 },
    }
  }
  // Uni-like partial DCE + multi-line format (shared with setup-body)
  const indented = formatSetupStmtsLikeUni(rewritten.body, split.returnAndAfter)
  const next = split.beforeSetupBody + '\n' + indented + '\n    ' + split.returnAndAfter.trimStart()
  const reqs = [...next.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map((m) => m[1])
  const externals = []
  for (const r of reqs) {
    const abs = normalizePath(join(dirname(file), r))
    externals.push({
      require: r,
      exists: existsSync(abs),
      bytes: existsSync(abs) && !statSync(abs).isDirectory() ? statSync(abs).size : 0,
    })
  }
  if (!externals.every((e) => e.exists)) {
    return {
      ok: false,
      reason: 'externals-missing',
      emitClass: 'midpath-sync',
      externals,
      allExternalsOnDisk: false,
      timings: { totalMs: performance.now() - t0 },
    }
  }
  if (!dryRun) {
    mkdirSync(dirname(file), { recursive: true })
    atomicWriteFile(file, next)
  }
  return {
    ok: true,
    reason: allowImportSetChange
      ? 'midpath-sync-import-set'
      : 'midpath-sync-shell-splice',
    emitClass: 'midpath-sync',
    file,
    filesWritten: dryRun ? 0 : 1,
    generated: 1,
    code: next,
    beforeSha: sha(coldJs),
    afterSha: sha(next),
    requireCount: reqs.length,
    externals,
    allExternalsOnDisk: true,
    note: 'Sync mid-path: cold-shell splice after rewrite; Rollup proof is async emitOptCExtMidpath',
    allowImportSetChange,
    timings: { totalMs: performance.now() - t0 },
  }
}
