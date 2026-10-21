// @ts-nocheck — pragmatic conversion from .mjs; public API typed in index.ts
import { atomicWriteFile } from './optc-ext-emitter'
/**
 * F7/F10/F11/F12 closure mid-path (falsifiable):
 * - F7: shared util, no imports → cold-body-patch / ESM→CJS, pages untouched
 * - F10: util with static imports → rewrite to require() externals matching cold dist
 * - F11: leaf util (0 page importers) still regen its chunk; multi-chunk A→B externals;
 *        Option A notch: no dist chunk + ≤CLOSURE_MAX importers → re-emit pages (caller)
 * - F16: no-dist / inlined util → emitOptionANoDistPageRebundleSync (proxy-for-inlined page patch)
 * - F12: Vue SFC script-only + ≤CLOSURE_MAX → surgical/setup-body on component dist JS
 *
 * Fail-closed: dynamic import, export add/remove, unresolved external, default/reexport,
 *              Vue template/style change, over-threshold importers.
 */
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  statSync,
  readdirSync,
} from 'node:fs'
import { dirname, join, relative, basename, resolve, extname } from 'node:path'
import { performance } from 'node:perf_hooks'
import {
  emitOptCExtPage,
  patchColdPageJs,
  patchColdPageJsNamedLiterals,
  patchColdPageJsPlainLiterals,
  patchColdPageJsCallArgs,
  patchColdPageJsSetupBody,
} from './optc-ext-emitter'
// atomicWriteFile re-exported usage below
import { emitOptCExtMidpathSync } from './optc-ext-midpath'

function sha(s) {
  return createHash('sha256').update(s).digest('hex')
}

function normalizePath(p) {
  return p.replace(/\\/g, '/')
}

/** Named exports from ESM util source (functions/consts + export { }). */
export function extractEsmExportNames(code) {
  const names = new Set()
  for (const m of code.matchAll(/export\s+function\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1])
  for (const m of code.matchAll(/export\s+(?:async\s+)?function\s*\*\s*([A-Za-z_$][\w$]*)/g))
    names.add(m[1])
  for (const m of code.matchAll(/export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1])
  for (const m of code.matchAll(/export\s+class\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1])
  for (const m of code.matchAll(/export\s+\{([^}]+)\}/g)) {
    for (const part of m[1].split(',')) {
      const bit = part.trim()
      if (!bit) continue
      const as = bit.split(/\s+as\s+/)
      const exported = (as[1] || as[0]).trim()
      if (exported && exported !== 'default') names.add(exported)
    }
  }
  return [...names].sort()
}

/** exports.foo / exports["foo"] from cold CJS chunk */
export function extractCjsExportNames(code) {
  const names = new Set()
  for (const m of code.matchAll(/exports\.([A-Za-z_$][\w$]*)\s*=/g)) names.add(m[1])
  for (const m of code.matchAll(/exports\[\s*['"]([^'"]+)['"]\s*\]\s*=/g)) names.add(m[1])
  return [...names].sort()
}

function sameSet(a, b) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/**
 * Classify export surface delta between cold CJS names and new ESM names.
 * @returns {{ kind: 'same'|'add-only'|'remove-only'|'rename-or-mixed', added: string[], removed: string[] }}
 */
export function classifyExportSurfaceChange(coldExports, srcExports) {
  const cold = new Set(coldExports || [])
  const src = new Set(srcExports || [])
  const added = []
  const removed = []
  for (const n of src) if (!cold.has(n)) added.push(n)
  for (const n of cold) if (!src.has(n)) removed.push(n)
  added.sort()
  removed.sort()
  if (!added.length && !removed.length) return { kind: 'same', added, removed }
  if (added.length && !removed.length) return { kind: 'add-only', added, removed }
  if (!added.length && removed.length) return { kind: 'remove-only', added, removed }
  return { kind: 'rename-or-mixed', added, removed }
}

/**
 * Named imports from page/util script that resolve to targetAbs (works on single-line SFC scripts).
 */
export function extractNamedImportsForResolved(script, importerAbs, inputDir, targetAbs) {
  const names = []
  const target = normalizePath(targetAbs)
  const re = /import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g
  let m
  while ((m = re.exec(String(script || '')))) {
    const r = resolveUtilImportSpec(importerAbs, m[2], inputDir)
    if (!r.ok || normalizePath(r.abs) !== target) continue
    for (const part of m[1].split(',')) {
      const bit = part.trim()
      if (!bit) continue
      const as = bit.split(/\s+as\s+/)
      const imported = as[0].trim()
      if (imported) names.push(imported)
    }
  }
  return [...new Set(names)]
}

function stripCommentsForGate(code) {
  return String(code)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
}

/**
 * Parse static ESM import statements (statement-level). Fail on dynamic import().
 * Returns { ok, imports: [{spec, names: string[]|null (null=namespace), defaultName, sideEffect}], reason }
 */
export function parseStaticImports(code) {
  const gate = stripCommentsForGate(code)
  if (/\bimport\s*\(/.test(gate)) {
    return { ok: false, reason: 'closure-dynamic-import', imports: [] }
  }
  const imports = []
  // Side-effect: import 'x'
  for (const m of code.matchAll(/^\s*import\s+['"]([^'"]+)['"]\s*;?\s*$/gm)) {
    imports.push({ spec: m[1], names: [], defaultName: null, sideEffect: true, raw: m[0] })
  }
  // import Default from 'x'
  for (const m of code.matchAll(
    /^\s*import\s+([A-Za-z_$][\w$]*)\s+from\s+['"]([^'"]+)['"]\s*;?\s*$/gm,
  )) {
    imports.push({
      spec: m[2],
      names: [],
      defaultName: m[1],
      sideEffect: false,
      raw: m[0],
    })
  }
  // import * as NS from 'x'
  for (const m of code.matchAll(
    /^\s*import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+['"]([^'"]+)['"]\s*;?\s*$/gm,
  )) {
    imports.push({
      spec: m[2],
      names: null,
      defaultName: m[1],
      sideEffect: false,
      namespace: true,
      raw: m[0],
    })
  }
  // import { a, b as c } from 'x'
  for (const m of code.matchAll(
    /^\s*import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]\s*;?\s*$/gm,
  )) {
    const names = []
    for (const part of m[1].split(',')) {
      const bit = part.trim()
      if (!bit) continue
      const as = bit.split(/\s+as\s+/)
      names.push({
        imported: as[0].trim(),
        local: (as[1] || as[0]).trim(),
      })
    }
    imports.push({
      spec: m[2],
      names,
      defaultName: null,
      sideEffect: false,
      raw: m[0],
    })
  }
  // import Default, { a } from 'x'
  for (const m of code.matchAll(
    /^\s*import\s+([A-Za-z_$][\w$]*)\s*,\s*\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]\s*;?\s*$/gm,
  )) {
    const names = []
    for (const part of m[2].split(',')) {
      const bit = part.trim()
      if (!bit) continue
      const as = bit.split(/\s+as\s+/)
      names.push({
        imported: as[0].trim(),
        local: (as[1] || as[0]).trim(),
      })
    }
    imports.push({
      spec: m[3],
      names,
      defaultName: m[1],
      sideEffect: false,
      raw: m[0],
    })
  }
  return { ok: true, imports }
}

/**
 * Resolve import specifier to abs source path under inputDir.
 * Supports relative and @/ alias (inputDir root).
 */
export function resolveUtilImportSpec(importerAbs, spec, inputDir) {
  const input = normalizePath(inputDir)
  if (spec.startsWith('@/')) {
    const cand = normalizePath(join(input, spec.slice(2)))
    return resolveWithExt(cand)
  }
  if (spec.startsWith('/')) {
    const cand = normalizePath(join(input, spec.replace(/^\//, '')))
    return resolveWithExt(cand)
  }
  if (!spec.startsWith('.')) {
    // bare package — treat as vendor/external only if we can map to common/vendor
    return { ok: false, reason: 'closure-bare-specifier', spec }
  }
  const cand = normalizePath(resolve(dirname(importerAbs), spec))
  return resolveWithExt(cand)
}

function resolveWithExt(base) {
  const b = normalizePath(base)
  if (existsSync(b) && !statSync(b).isDirectory()) return { ok: true, abs: b }
  for (const ext of ['.js', '.mjs', '.ts', '.json']) {
    if (existsSync(b + ext) && !statSync(b + ext).isDirectory()) {
      return { ok: true, abs: normalizePath(b + ext) }
    }
  }
  for (const idx of ['index.js', 'index.mjs', 'index.ts']) {
    const p = join(b, idx)
    if (existsSync(p)) return { ok: true, abs: normalizePath(p) }
  }
  return { ok: false, reason: 'closure-unresolved-import', spec: b }
}

/**
 * Map source abs under inputDir → dist chunk under outDir (relpath preserve).
 */
export function resolveSharedDistChunk(inputDir, outDir, sourceAbs) {
  const rel = normalizePath(relative(inputDir, sourceAbs))
  if (!rel || rel.startsWith('..')) return null
  const candidates = [
    join(outDir, rel),
    join(outDir, rel.replace(/\.ts$/, '.js')),
    join(outDir, rel.replace(/\.mjs$/, '.js')),
  ]
  for (const c of candidates) {
    if (existsSync(c) && !statSync(c).isDirectory()) return normalizePath(c)
  }
  const base = basename(rel)
  const guess = join(outDir, dirname(rel), base)
  if (existsSync(guess) && !statSync(guess).isDirectory()) return normalizePath(guess)
  return null
}

/**
 * Relative require path from one dist file to another (posix, leading ./).
 */
export function relRequireBetween(fromDistFile, toDistFile) {
  let rel = normalizePath(relative(dirname(fromDistFile), toDistFile))
  if (!rel.startsWith('.')) rel = './' + rel
  return rel
}

/**
 * Scan inputDir for other .js/.mjs/.ts utils that statically import targetAbs.
 * Used for F11 leaf/multi-chunk awareness (util→util importers).
 */
export function findUtilImportersOf(inputDir, targetAbs, { maxFiles = 400 } = {}) {
  const target = normalizePath(targetAbs)
  const found = []
  const roots = [
    join(inputDir, 'modules'),
    join(inputDir, 'utils'),
    join(inputDir, 'common'),
    join(inputDir, 'libs'),
    join(inputDir, 'shared'),
  ].filter((r) => existsSync(r))
  if (!roots.length) roots.push(inputDir)

  let scanned = 0
  function walk(dir, depth) {
    if (depth > 8 || scanned >= maxFiles || found.length >= 20) return
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const ent of entries) {
      if (scanned >= maxFiles) return
      const p = join(dir, ent.name)
      if (ent.isDirectory()) {
        if (ent.name === 'node_modules' || ent.name === 'dist') continue
        walk(p, depth + 1)
        continue
      }
      if (!/\.(js|mjs|ts)$/i.test(ent.name)) continue
      scanned++
      const abs = normalizePath(p)
      if (abs === target) continue
      let code
      try {
        code = readFileSync(abs, 'utf8')
      } catch {
        continue
      }
      const parsed = parseStaticImports(code)
      if (!parsed.ok) continue
      for (const im of parsed.imports) {
        const r = resolveUtilImportSpec(abs, im.spec, inputDir)
        if (r.ok && r.abs === target) {
          found.push(abs)
          break
        }
      }
    }
  }
  for (const r of roots) walk(r, 0)
  return found
}

/**
 * ESM util → uni-like CJS, with static imports rewritten to require(relative cold path).
 */
export function transformUtilEsmToCjs(src, opts = {}) {
  const code = String(src)
  const gate = stripCommentsForGate(code)
  if (/\bexport\s+\*\s+from\b/.test(gate)) {
    return { ok: false, reason: 'closure-reexport' }
  }
  if (/\bexport\s+\{[^}]*\}\s*from\b/.test(gate)) {
    return { ok: false, reason: 'closure-reexport' }
  }
  if (/\bexport\s+default\b/.test(gate)) {
    return { ok: false, reason: 'closure-default-export' }
  }

  const parsed = parseStaticImports(code)
  if (!parsed.ok) return { ok: false, reason: parsed.reason, imports: [] }

  const { inputDir, outDir, sourceAbs, distFile } = opts
  const requireLines = []
  const resolvedExternals = []

  if (parsed.imports.length) {
    if (!inputDir || !outDir || !sourceAbs || !distFile) {
      return { ok: false, reason: 'closure-source-has-imports' }
    }
    for (const im of parsed.imports) {
      const r = resolveUtilImportSpec(sourceAbs, im.spec, inputDir)
      if (!r.ok) {
        return { ok: false, reason: r.reason || 'closure-unresolved-import', spec: im.spec }
      }
      // vendor / vue → common/vendor.js
      let depDist = resolveSharedDistChunk(inputDir, outDir, r.abs)
      if (!depDist && (im.spec === 'vue' || im.spec === '@dcloudio/uni-app' || im.spec.startsWith('@dcloudio/'))) {
        const vendor = join(outDir, 'common/vendor.js')
        if (existsSync(vendor)) depDist = normalizePath(vendor)
      }
      if (!depDist) {
        return {
          ok: false,
          reason: 'closure-external-dist-missing',
          spec: im.spec,
          resolvedAbs: r.abs,
        }
      }
      // circular: depDist === distFile
      if (normalizePath(depDist) === normalizePath(distFile)) {
        return { ok: false, reason: 'closure-circular-self', spec: im.spec }
      }
      const rel = relRequireBetween(distFile, depDist)
      resolvedExternals.push({ spec: im.spec, abs: r.abs, dist: depDist, rel })

      if (im.sideEffect) {
        requireLines.push(`require("${rel}");`)
        continue
      }
      if (im.namespace || (im.names === null && im.defaultName)) {
        requireLines.push(`const ${im.defaultName} = require("${rel}");`)
        continue
      }
      if (im.defaultName && (!im.names || !im.names.length)) {
        // default import of a CJS module — uni named-exports style often has no .default
        return { ok: false, reason: 'closure-default-import', spec: im.spec }
      }
      if (im.names && im.names.length) {
        const locals = im.names.map((n) =>
          n.imported === n.local ? n.local : `${n.imported}: ${n.local}`,
        )
        requireLines.push(`const { ${locals.join(', ')} } = require("${rel}");`)
        continue
      }
      return { ok: false, reason: 'closure-import-shape', spec: im.spec }
    }
  }

  const exportNames = extractEsmExportNames(code)
  if (!exportNames.length) {
    return { ok: false, reason: 'closure-no-named-exports' }
  }

  let body = code
  // Strip import lines
  for (const im of parsed.imports) {
    body = body.replace(im.raw, '')
  }
  body = body.replace(/\bexport\s+(async\s+)?function\b/g, '$1function')
  body = body.replace(/\bexport\s+(const|let|var|class)\b/g, '$1')
  body = body.replace(/^\s*export\s*\{[^}]+\}\s*;?\s*$/gm, '')
  body = body.trim()
  if (!body.endsWith('\n')) body += '\n'
  const exportLines = exportNames.map((n) => `exports.${n} = ${n};`).join('\n')
  const preamble = requireLines.length ? requireLines.join('\n') + '\n' : ''
  const next = `"use strict";\n${preamble}${body}${exportLines}\n`

  for (const n of exportNames) {
    const decl =
      new RegExp(`\\b(?:function|const|let|var|class)\\s+${n}\\b`).test(body) ||
      new RegExp(`\\b${n}\\s*=`).test(body)
    if (!decl) {
      return { ok: false, reason: 'closure-export-binding-missing', name: n }
    }
  }
  try {
    new Function(next)
  } catch (e) {
    return { ok: false, reason: 'closure-cjs-syntax', error: e.message }
  }
  return {
    ok: true,
    code: next,
    exportNames,
    importCount: parsed.imports.length,
    resolvedExternals,
  }
}

/**
 * Option B: rewrite one shared dist chunk from its ESM source.
 * F10: allows static imports when cold externals resolve.
 * Pages left untouched when export surface stable.
 */


function normalizeReturnSemicolonsLikeUni(code) {
  // Uni/rollup emit `return expr;` — cold-body-patch may omit the semicolon.
  return String(code).replace(/\breturn\s+([^;\n]+?)\s*\n(\s*)\}/g, (m, expr, ws) => {
    const e = expr.trimEnd()
    if (e.endsWith(';')) return m
    return `return ${e};\n${ws}}`
  })
}

function stripJsCommentsLikeRollup(code) {
  // Approximate rollup/esbuild comment stripping for CJS util chunks (string-aware).
  let out = ''
  let i = 0
  const s = String(code)
  while (i < s.length) {
    const c = s[i]
    const n = s[i + 1]
    if (c === "'" || c === '"' || c === '`') {
      const q = c
      out += c
      i++
      while (i < s.length) {
        const ch = s[i]
        out += ch
        if (ch === '\\') { out += s[i + 1] || ''; i += 2; continue }
        if (ch === q) { i++; break }
        i++
      }
      continue
    }
    if (c === '/' && n === '/') {
      i += 2
      while (i < s.length && s[i] !== '\n') i++
      continue
    }
    if (c === '/' && n === '*') {
      i += 2
      while (i + 1 < s.length && !(s[i] === '*' && s[i + 1] === '/')) i++
      i += 2
      continue
    }
    out += c
    i++
  }
  return out
}

export function emitClosureSharedChunkSync({
  inputDir,
  outDir,
  sourceAbs,
  dryRun = false,
  /** F14: allow only-added named exports (chunk regen via transform). */
  allowExportAdd = false,
  /** F14 Option A: allow any export surface change (add/remove/rename) when pages re-emitted. */
  allowExportSurfaceChange = false,
}) {
  const t0 = performance.now()
  const srcPath = normalizePath(sourceAbs)
  if (!existsSync(srcPath)) {
    return {
      ok: false,
      reason: 'closure-source-missing',
      sourceAbs: srcPath,
      emitClass: 'closure-chunk',
      timings: { totalMs: performance.now() - t0 },
    }
  }
  const distFile = resolveSharedDistChunk(inputDir, outDir, srcPath)
  if (!distFile) {
    return {
      ok: false,
      reason: 'closure-dist-chunk-missing',
      sourceAbs: srcPath,
      emitClass: 'closure-chunk',
      optionACandidate: true,
      timings: { totalMs: performance.now() - t0 },
    }
  }
  const coldChunk = readFileSync(distFile, 'utf8')
  const newSrc = readFileSync(srcPath, 'utf8')
  const coldExports = extractCjsExportNames(coldChunk)
  const srcExports = extractEsmExportNames(newSrc)
  const surface = classifyExportSurfaceChange(coldExports, srcExports)
  let exportSurfaceMode = 'same'
  if (surface.kind !== 'same') {
    if (allowExportSurfaceChange) {
      exportSurfaceMode = surface.kind
      // Fall through: must use transform path (cold-body-patch assumes same export names).
    } else if (allowExportAdd && surface.kind === 'add-only') {
      exportSurfaceMode = 'add-only'
    } else {
      return {
        ok: false,
        reason: 'closure-export-surface-changed',
        coldExports,
        srcExports,
        surface,
        emitClass: 'closure-chunk',
        optionACandidate: true,
        timings: { totalMs: performance.now() - t0 },
      }
    }
  }

  const parsed = parseStaticImports(newSrc)
  if (!parsed.ok) {
    return {
      ok: false,
      reason: parsed.reason,
      emitClass: 'closure-chunk',
      timings: { totalMs: performance.now() - t0 },
    }
  }

  // Prefer cold-body-patch when NO imports and simple export functions
  // (only when export surface unchanged — add/rename must rebuild export lines)
  let next = null
  let writeMode = null
  if (!parsed.imports.length && exportSurfaceMode === 'same') {
    const simpleFns = [
      ...newSrc.matchAll(
        /export\s+function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{([\s\S]*?)\n\}/g,
      ),
    ]
    if (simpleFns.length && simpleFns.length === coldExports.length) {
      let patched = coldChunk
      let allOk = true
      for (const m of simpleFns) {
        const name = m[1]
        const params = m[2]
        const bodyInner = m[3]
        const re = new RegExp(
          `(function\\s+${name}\\s*\\()([^)]*)(\\)\\s*\\{)([\\s\\S]*?)(\\n\\})`,
        )
        if (!re.test(patched)) {
          allOk = false
          break
        }
        patched = patched.replace(re, `$1${params}$3${bodyInner}$5`)
      }
      if (allOk) {
        try {
          new Function(patched)
          next = patched
          writeMode = 'cold-body-patch'
        } catch {
          /* fall through */
        }
      }
    }
  }

  if (!next) {
    // F10: also try cold-body-patch when imports stable and cold already has matching requires
    if (parsed.imports.length && exportSurfaceMode === 'same') {
      const simpleFns = [
        ...newSrc.matchAll(
          /export\s+function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{([\s\S]*?)\n\}/g,
        ),
      ]
      if (simpleFns.length) {
        let patched = coldChunk
        let allOk = true
        for (const m of simpleFns) {
          const name = m[1]
          const params = m[2]
          const bodyInner = m[3]
          const re = new RegExp(
            `(function\\s+${name}\\s*\\()([^)]*)(\\)\\s*\\{)([\\s\\S]*?)(\\n\\})`,
          )
          if (!re.test(patched)) {
            allOk = false
            break
          }
          patched = patched.replace(re, `$1${params}$3${bodyInner}$5`)
        }
        // Ensure every import's cold require still present (prefix check)
        if (allOk) {
          for (const im of parsed.imports) {
            const r = resolveUtilImportSpec(srcPath, im.spec, inputDir)
            if (!r.ok) {
              allOk = false
              break
            }
            const depDist = resolveSharedDistChunk(inputDir, outDir, r.abs)
            if (!depDist) {
              allOk = false
              break
            }
            const rel = relRequireBetween(distFile, depDist)
            if (!patched.includes(`require("${rel}")`) && !patched.includes(`require('${rel}')`)) {
              // cold may use different relative form — still allow if basename matches
              const base = basename(depDist)
              if (!new RegExp(`require\\(['"][^'"]*${base.replace('.', '\\.')}['"]\\)`).test(patched)) {
                allOk = false
                break
              }
            }
          }
        }
        if (allOk) {
          try {
            new Function(patched)
            next = patched
            writeMode = 'cold-body-patch-with-imports'
          } catch {
            /* fall through */
          }
        }
      }
    }
  }

  let transformed = null
  if (!next) {
    transformed = transformUtilEsmToCjs(newSrc, {
      inputDir,
      outDir,
      sourceAbs: srcPath,
      distFile,
    })
    if (!transformed.ok) {
      return {
        ...transformed,
        emitClass: 'closure-chunk',
        distFile,
        optionACandidate:
          transformed.reason === 'closure-source-has-imports' ||
          transformed.reason === 'closure-external-dist-missing',
        timings: { totalMs: performance.now() - t0 },
      }
    }
    next = transformed.code
    writeMode = transformed.importCount
      ? 'transform-cjs-with-requires'
      : 'transform-cjs'
  }

  // F11: if this util imports other utils whose dist is missing → already failed.
  // Also collect related chunk paths for reporting (A→B externals stay on disk).
  const relatedChunks = (transformed?.resolvedExternals || []).map((e) => e.dist)

  next = normalizeReturnSemicolonsLikeUni(stripJsCommentsLikeRollup(next))
  // If comment-only edit, next may equal cold — still OK (SHA matches uni which strips comments)
  if (!dryRun) {
    mkdirSync(dirname(distFile), { recursive: true })
    atomicWriteFile(distFile, next)
  }
  return {
    ok: true,
    reason: 'closure-shared-chunk-regen',
    emitClass: 'closure-chunk',
    file: distFile,
    sourceAbs: srcPath,
    filesWritten: dryRun ? 0 : 1,
    filesWrittenList: dryRun ? [] : [distFile],
    relatedChunks,
    generated: 1,
    beforeSha: sha(coldChunk),
    afterSha: sha(next),
    exportNames: srcExports,
    writeMode,
    importCount: parsed.imports.length,
    allExternalsOnDisk: true,
    requireCount: (next.match(/require\(/g) || []).length,
    exportSurfaceMode,
    surface,
    note:
      exportSurfaceMode !== 'same'
        ? `F14: chunk regen with export surface ${exportSurfaceMode}; pages may need Option A re-emit`
        : parsed.imports.length > 0
          ? 'F10: util with static imports → require() externals; pages untouched'
          : 'F7 Option B: regenerate single shared dist chunk; pages untouched',
    timings: { totalMs: performance.now() - t0 },
  }
}

/**
 * F11 multi-chunk: regen changed util + ensure imported deps have cold chunks.
 * If `alsoRegenSources` provided (abs paths of related utils that also changed),
 * regen those too (stable export surface each).
 */
export function emitClosureMultiChunkSync({
  inputDir,
  outDir,
  sourceAbs,
  alsoRegenSources = [],
  dryRun = false,
}) {
  const t0 = performance.now()
  const written = []
  const results = []
  const primary = emitClosureSharedChunkSync({
    inputDir,
    outDir,
    sourceAbs,
    dryRun,
  })
  results.push(primary)
  if (!primary.ok) {
    return {
      ...primary,
      emitClass: 'closure-multi-chunk',
      results,
      timings: { totalMs: performance.now() - t0 },
    }
  }
  if (primary.file) written.push(primary.file)

  for (const abs of alsoRegenSources) {
    if (normalizePath(abs) === normalizePath(sourceAbs)) continue
    const r = emitClosureSharedChunkSync({
      inputDir,
      outDir,
      sourceAbs: abs,
      dryRun,
    })
    results.push(r)
    if (!r.ok) {
      return {
        ok: false,
        reason: 'closure-multi-chunk-dep-failed',
        depReason: r.reason,
        emitClass: 'closure-multi-chunk',
        results,
        timings: { totalMs: performance.now() - t0 },
      }
    }
    if (r.file) written.push(r.file)
  }

  return {
    ok: true,
    reason: 'closure-multi-chunk-regen',
    emitClass: 'closure-multi-chunk',
    filesWritten: dryRun ? 0 : written.length,
    filesWrittenList: dryRun ? [] : written,
    afterSha: primary.afterSha,
    writeMode: primary.writeMode,
    results,
    note: 'F11: primary util (+ optional related utils) chunk regen; pages untouched',
    timings: { totalMs: performance.now() - t0 },
  }
}

/**
 * F12: Vue SFC script-only patch onto component dist JS (same surgical cascade as pages).
 * Caller must guarantee template+style unchanged and supply oldScript/newScript.
 */
export function emitClosureVueComponentSync({
  inputDir,
  outDir,
  sourceAbs,
  oldScript,
  newScript,
  dryRun = false,
}) {
  const t0 = performance.now()
  const srcPath = normalizePath(sourceAbs)
  if (!/\.vue$/i.test(srcPath)) {
    return {
      ok: false,
      reason: 'closure-vue-not-vue',
      emitClass: 'closure-vue',
      timings: { totalMs: performance.now() - t0 },
    }
  }
  if (!existsSync(srcPath)) {
    return {
      ok: false,
      reason: 'closure-vue-source-missing',
      emitClass: 'closure-vue',
      timings: { totalMs: performance.now() - t0 },
    }
  }
  // dist: modules/components/foo/index.vue → modules/components/foo/index.js
  const rel = normalizePath(relative(inputDir, srcPath))
  if (!rel || rel.startsWith('..')) {
    return {
      ok: false,
      reason: 'closure-vue-outside-input',
      emitClass: 'closure-vue',
      timings: { totalMs: performance.now() - t0 },
    }
  }
  const pagePath = rel.replace(/\.vue$/i, '')
  const distFile = join(outDir, pagePath + '.js')
  if (!existsSync(distFile)) {
    return {
      ok: false,
      reason: 'closure-vue-dist-missing',
      emitClass: 'closure-vue',
      file: distFile,
      timings: { totalMs: performance.now() - t0 },
    }
  }

  // Reject local .vue SFC imports in component script (need graph) — scan specs robustly
  const scriptText = String(newScript || '')
  const vueImportSpecs = []
  for (const m of scriptText.matchAll(
    /(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+\.vue)['"]/g,
  )) {
    vueImportSpecs.push(m[1])
  }
  if (vueImportSpecs.length) {
    return {
      ok: false,
      reason: 'closure-vue-imports-sfc',
      spec: vueImportSpecs[0],
      emitClass: 'closure-vue',
      timings: { totalMs: performance.now() - t0 },
    }
  }
  // Also reject dynamic import()
  if (/\bimport\s*\(/.test(scriptText)) {
    return {
      ok: false,
      reason: 'closure-vue-dynamic-import',
      emitClass: 'closure-vue',
      timings: { totalMs: performance.now() - t0 },
    }
  }

  const emit = emitOptCExtPage({
    outDir,
    pagePath,
    oldScript: oldScript || '',
    newScript: newScript || '',
    dryRun,
  })
  if (!emit.ok) {
    return {
      ok: false,
      reason: emit.reason || 'closure-vue-emit-failed',
      emitClass: 'closure-vue',
      pageEmitClass: emit.emitClass,
      cascadeReason: emit.reason,
      timings: { totalMs: performance.now() - t0 },
    }
  }
  // Component companions must remain (json/wxml/wxss) — we only wrote js
  const companions = ['.json', '.wxml', '.wxss'].map((ext) => join(outDir, pagePath + ext))
  const missingComp = companions.filter((c) => !existsSync(c))
  if (missingComp.length) {
    return {
      ok: false,
      reason: 'closure-vue-companions-missing',
      missing: missingComp,
      emitClass: 'closure-vue',
      timings: { totalMs: performance.now() - t0 },
    }
  }
  return {
    ok: true,
    reason: 'closure-vue-script-only',
    emitClass: 'closure-vue',
    file: distFile,
    sourceAbs: srcPath,
    filesWritten: emit.filesWritten ?? (dryRun ? 0 : 1),
    generated: 1,
    beforeSha: emit.beforeSha,
    afterSha: emit.afterSha,
    writeMode: emit.emitClass,
    pageEmitClass: emit.emitClass,
    allExternalsOnDisk: emit.allExternalsOnDisk,
    requireCount: emit.requireCount,
    note: 'F12 MVP: script-only Vue component → page-style surgical cascade on dist JS; template/style untouched',
    timings: { totalMs: performance.now() - t0, emitMs: emit.timings?.totalMs },
  }
}

/**
 * Parse vue file into template/style/script hashes + script text (lightweight, no full SFC dep).
 */
export function parseVueScriptParts(vueSource) {
  const text = String(vueSource)
  const templateMatch = text.match(/<template\b[^>]*>([\s\S]*?)<\/template>/i)
  const template = templateMatch ? templateMatch[0] : ''
  const styleMatches = [...text.matchAll(/<style\b[^>]*>[\s\S]*?<\/style>/gi)].map((m) => m[0])
  const style = styleMatches.join('\n')
  // HARDEN (deep-messy m4): skip wxs / module= scripts; prefer <script setup>; join all JS scripts.
  const scriptBlocks = []
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi
  let sm
  while ((sm = re.exec(text))) {
    const attrs = sm[1] || ''
    if (/\blang\s*=\s*["']wxs["']/i.test(attrs)) continue
    if (/\bmodule\s*=/.test(attrs)) continue
    scriptBlocks.push({ attrs, body: sm[2] || '', setup: /\bsetup\b/i.test(attrs) })
  }
  let script = ''
  if (scriptBlocks.length) {
    const setups = scriptBlocks.filter((b) => b.setup)
    const normals = scriptBlocks.filter((b) => !b.setup)
    // Match page parseVueSections spirit: normal script then script-setup
    script = [...normals, ...setups].map((b) => b.body).join('\n')
  }
  return {
    template,
    style,
    script,
    templateHash: sha(template),
    styleHash: sha(style),
    scriptHash: sha(script),
  }
}


/**
 * F14 Option A: regenerate shared util chunk (export add/rename OK) then re-emit affected pages.
 * Caller supplies pageUpdates with old/new scripts (from fingerprints + disk).
 * Fail-closed if a page still imports a removed export or both cascade+midpath fail.
 */
export function emitOptionABatchSync({
  inputDir,
  outDir,
  sourceAbs,
  pageUpdates = [],
  dryRun = false,
  allowExportAdd = true,
  allowExportSurfaceChange = true,
}) {
  const t0 = performance.now()
  const srcPath = normalizePath(sourceAbs)
  const clo = emitClosureSharedChunkSync({
    inputDir,
    outDir,
    sourceAbs: srcPath,
    dryRun,
    allowExportAdd,
    allowExportSurfaceChange,
  })
  if (!clo.ok) {
    return {
      ok: false,
      reason: clo.reason || 'option-a-chunk-failed',
      emitClass: 'option-a-batch',
      chunk: clo,
      timings: { totalMs: performance.now() - t0 },
    }
  }

  const srcExports = clo.exportNames || extractEsmExportNames(readFileSync(srcPath, 'utf8'))
  const pageResults = []
  const written = [...(clo.filesWrittenList || (clo.file ? [clo.file] : []))]

  for (const pu of pageUpdates) {
    const pagePath = pu.pagePath
    const oldScript = pu.oldScript ?? ''
    const newScript = pu.newScript ?? ''
    const pageAbs = pu.pageAbs || null

    if (pageAbs) {
      const used = extractNamedImportsForResolved(newScript, pageAbs, inputDir, srcPath)
      const missing = used.filter((n) => !srcExports.includes(n))
      if (missing.length) {
        pageResults.push({
          pagePath,
          ok: false,
          reason: 'option-a-page-imports-missing-export',
          missing,
          used,
        })
        return {
          ok: false,
          reason: 'option-a-page-imports-missing-export',
          emitClass: 'option-a-batch',
          chunk: clo,
          pageResults,
          timings: { totalMs: performance.now() - t0 },
        }
      }
    }

    if (oldScript === newScript) {
      pageResults.push({ pagePath, ok: true, reason: 'option-a-page-noop', emitClass: 'noop' })
      continue
    }

    let emit = emitOptCExtPage({
      outDir,
      pagePath,
      oldScript,
      newScript,
      dryRun,
    })
    if (!emit.ok || emit.allExternalsOnDisk === false) {
      const mid = emitOptCExtMidpathSync({
        outDir,
        pagePath,
        oldScript,
        newScript,
        allowImportSetChange: true,
        dryRun,
      })
      if (mid.ok && mid.allExternalsOnDisk !== false) {
        emit = mid
      } else {
        pageResults.push({
          pagePath,
          ok: false,
          reason: 'option-a-page-emit-failed',
          cascadeReason: emit.reason,
          midpathReason: mid.reason,
        })
        return {
          ok: false,
          reason: 'option-a-page-emit-failed',
          emitClass: 'option-a-batch',
          chunk: clo,
          pageResults,
          timings: { totalMs: performance.now() - t0 },
        }
      }
    }

    const f = emit.file || join(outDir, pagePath + '.js')
    if (!dryRun) written.push(normalizePath(f))
    pageResults.push({
      pagePath,
      ok: true,
      reason: emit.reason,
      emitClass: emit.emitClass,
      afterSha: emit.afterSha,
      allExternalsOnDisk: emit.allExternalsOnDisk,
    })
  }

  return {
    ok: true,
    reason: 'option-a-batch',
    emitClass: 'option-a-batch',
    chunk: clo,
    pageResults,
    filesWritten: dryRun ? 0 : new Set(written).size,
    filesWrittenList: dryRun ? [] : [...new Set(written)],
    exportNames: srcExports,
    exportSurfaceMode: clo.exportSurfaceMode,
    afterSha: clo.afterSha,
    writeMode: clo.writeMode,
    generated: (dryRun ? 0 : 1) + pageResults.filter((p) => p.emitClass && p.emitClass !== 'noop').length,
    note: 'F14 Option A: chunk regen (export surface may change) + page surgical/midpath re-emit',
    timings: { totalMs: performance.now() - t0 },
  }
}


/**
 * Extract simple `export function name(params) { body }` from ESM util (brace-balanced).
 * Used to patch inlined copies inside page JS (proxy for uni Rollup inline).
 */
export function extractSimpleExportedFunctions(utilSrc) {
  const out = []
  const re = /export\s+function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/g
  let m
  while ((m = re.exec(utilSrc))) {
    const name = m[1]
    const params = m[2]
    let i = m.index + m[0].length
    let depth = 1
    while (i < utilSrc.length && depth > 0) {
      const c = utilSrc[i]
      if (c === '{') depth++
      else if (c === '}') depth--
      i++
    }
    if (depth !== 0) continue
    const bodyInner = utilSrc.slice(m.index + m[0].length, i - 1)
    out.push({ name, params, bodyInner, end: i })
  }
  return out
}

/**
 * Patch inlined `function name(params){body}` copies inside page JS from util ESM source.
 * Returns { ok, code, patched[], missing[] }.
 */
export function patchInlinedUtilInPageJs(pageJs, utilSrc) {
  const fns = extractSimpleExportedFunctions(utilSrc)
  if (!fns.length) {
    return { ok: false, reason: 'option-a-inlined-no-simple-exports', code: pageJs, patched: [], missing: [] }
  }
  let next = pageJs
  const patched = []
  const missing = []
  for (const fn of fns) {
    const re = new RegExp(
      `(function\\s+${fn.name}\\s*\\()([^)]*)(\\)\\s*\\{)([\\s\\S]*?)(\\n\\})`,
    )
    if (!re.test(next)) {
      // try single-line closing brace without leading newline
      const re2 = new RegExp(
        `(function\\s+${fn.name}\\s*\\()([^)]*)(\\)\\s*\\{)([\\s\\S]*?)(\\})`,
      )
      if (!re2.test(next)) {
        missing.push(fn.name)
        continue
      }
      next = next.replace(re2, `$1${fn.params}$3${fn.bodyInner}$5`)
      patched.push(fn.name)
      continue
    }
    next = next.replace(re, `$1${fn.params}$3${fn.bodyInner}$5`)
    patched.push(fn.name)
  }
  if (!patched.length) {
    return {
      ok: false,
      reason: 'option-a-inlined-no-anchor',
      code: pageJs,
      patched,
      missing,
    }
  }
  try {
    new Function(next)
  } catch (e) {
    return {
      ok: false,
      reason: 'option-a-inlined-syntax',
      error: e.message,
      code: pageJs,
      patched,
      missing,
    }
  }
  return { ok: true, code: next, patched, missing, changed: next !== pageJs }
}

/**
 * F16 Option A no-dist / inlined-util page rebundle (proxy for uni inline).
 * When shared util has **no** dedicated dist chunk but pages import it:
 *   - do NOT invent a chunk
 *   - for each affected page (caller enforces ≤CLOSURE_MAX): optionally cascade
 *     page script edits, then patch inlined `function exportName` bodies from util source
 *   - page-only writes; skip Vite graph
 * Fail-closed: dist exists, missing export imports, no inlined anchor, emit/syntax fail.
 *
 * Honesty label: `proxy-for-inlined` — synthetic/cold pages with inlined fn bodies;
 * true Rollup graph-inline may still differ.
 */
export function emitOptionANoDistPageRebundleSync({
  inputDir,
  outDir,
  sourceAbs,
  pageUpdates = [],
  dryRun = false,
  /** When true, refuse if a dist chunk actually exists (strict no-dist). Default true. */
  requireNoDist = true,
}) {
  const t0 = performance.now()
  const srcPath = normalizePath(sourceAbs)
  if (!existsSync(srcPath)) {
    return {
      ok: false,
      reason: 'closure-source-missing',
      emitClass: 'option-a-inlined-page-rebundle',
      timings: { totalMs: performance.now() - t0 },
    }
  }
  const distFile = resolveSharedDistChunk(inputDir, outDir, srcPath)
  if (requireNoDist && distFile) {
    return {
      ok: false,
      reason: 'option-a-inlined-dist-exists',
      distFile,
      emitClass: 'option-a-inlined-page-rebundle',
      hint: 'Use emitOptionABatchSync / closure-chunk when dist exists',
      timings: { totalMs: performance.now() - t0 },
    }
  }
  if (!pageUpdates.length) {
    return {
      ok: false,
      reason: 'option-a-inlined-no-pages',
      emitClass: 'option-a-inlined-page-rebundle',
      timings: { totalMs: performance.now() - t0 },
    }
  }

  const utilSrc = readFileSync(srcPath, 'utf8')
  const srcExports = extractEsmExportNames(utilSrc)
  const pageResults = []
  const written = []

  for (const pu of pageUpdates) {
    const pagePath = pu.pagePath
    const oldScript = pu.oldScript ?? ''
    const newScript = pu.newScript ?? ''
    const pageAbs = pu.pageAbs || null
    const file = join(outDir, pagePath + '.js')

    if (pageAbs) {
      const used = extractNamedImportsForResolved(newScript, pageAbs, inputDir, srcPath)
      const missingImps = used.filter((n) => !srcExports.includes(n))
      if (missingImps.length) {
        pageResults.push({
          pagePath,
          ok: false,
          reason: 'option-a-page-imports-missing-export',
          missing: missingImps,
          used,
        })
        return {
          ok: false,
          reason: 'option-a-page-imports-missing-export',
          emitClass: 'option-a-inlined-page-rebundle',
          pageResults,
          timings: { totalMs: performance.now() - t0 },
        }
      }
    }

    if (!existsSync(file)) {
      pageResults.push({ pagePath, ok: false, reason: 'cold-page-js-missing' })
      return {
        ok: false,
        reason: 'cold-page-js-missing',
        emitClass: 'option-a-inlined-page-rebundle',
        pageResults,
        timings: { totalMs: performance.now() - t0 },
      }
    }

    const coldJs = readFileSync(file, 'utf8')
    const beforeSha = sha(coldJs)
    let workingJs = coldJs
    let cascade = null

    // Page script drift → try surgical/setup-body/midpath (dry) for in-memory next bytes
    if (oldScript !== newScript) {
      cascade = emitOptCExtPage({
        outDir,
        pagePath,
        oldScript,
        newScript,
        dryRun: true,
      })
      if (cascade.ok && cascade.allExternalsOnDisk !== false && cascade.code) {
        workingJs = cascade.code
      } else {
        const mid = emitOptCExtMidpathSync({
          outDir,
          pagePath,
          oldScript,
          newScript,
          allowImportSetChange: true,
          dryRun: true,
        })
        if (mid.ok && mid.allExternalsOnDisk !== false && mid.code) {
          cascade = mid
          workingJs = mid.code
        }
        // else keep coldJs — util-only inlined patch may still apply
      }
    }

    const patched = patchInlinedUtilInPageJs(workingJs, utilSrc)
    if (!patched.ok) {
      pageResults.push({
        pagePath,
        ok: false,
        reason: patched.reason || 'option-a-inlined-no-anchor',
        missing: patched.missing,
        cascadeReason: cascade?.reason || null,
      })
      return {
        ok: false,
        reason: patched.reason || 'option-a-inlined-no-anchor',
        emitClass: 'option-a-inlined-page-rebundle',
        pageResults,
        timings: { totalMs: performance.now() - t0 },
      }
    }

    const next = patched.code
    const afterSha = sha(next)
    if (!dryRun) {
      mkdirSync(dirname(file), { recursive: true })
      atomicWriteFile(file, next)
      written.push(normalizePath(file))
    }

    pageResults.push({
      pagePath,
      ok: true,
      reason:
        oldScript !== newScript && cascade?.ok
          ? 'option-a-inlined-cascade-plus-patch'
          : 'option-a-inlined-util-patch',
      emitClass: 'option-a-inlined-page-rebundle',
      beforeSha,
      afterSha,
      changed: beforeSha !== afterSha,
      patchedFns: patched.patched,
      missingFns: patched.missing,
      cascadeReason: cascade?.reason || null,
      cascadeEmitClass: cascade?.emitClass || null,
    })
  }

  const anyChange = pageResults.some((p) => p.ok && p.changed)
  if (!anyChange) {
    return {
      ok: false,
      reason: 'option-a-inlined-noop',
      emitClass: 'option-a-inlined-page-rebundle',
      pageResults,
      note: 'Util source produced no page byte change — fail-closed (avoid silent skip)',
      timings: { totalMs: performance.now() - t0 },
    }
  }

  return {
    ok: true,
    reason: 'option-a-inlined-page-rebundle',
    emitClass: 'option-a-inlined-page-rebundle',
    proxyForInlined: true,
    note:
      'F16 proxy-for-inlined: no dist chunk → page-only rebundle by patching inlined function bodies (+ optional page cascade). Not a full Rollup graph-inline.',
    pageResults,
    filesWritten: dryRun ? 0 : written.length,
    filesWrittenList: dryRun ? [] : written,
    exportNames: srcExports,
    generated: dryRun ? 0 : written.length,
    afterSha: pageResults.find((p) => p.ok)?.afterSha,
    timings: { totalMs: performance.now() - t0 },
  }
}

export default emitClosureSharedChunkSync
