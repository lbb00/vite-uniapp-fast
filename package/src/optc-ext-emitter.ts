// @ts-nocheck — pragmatic conversion from .mjs; public API typed in index.ts
/**
 * True Opt C page-only emitter for uni mp-weixin cold dist.
 *
 * Paths (Measured cascade):
 *  1. Surgical ref('…') / common_vendor.ref("…") string-literal patch (bench script1 class)
 *  2. Cold-guided named ref literal patch: bool/num/null/string by binding name
 *     (preserves uni formatting + DCE; closes local-import page SHA vs warm)
 *  3. Plain const literal: const x = <literal> flips (surgical-plain-literal)
 *  4. Mapped call-arg: localImportFn(n) → coldExpr(n) in-place (surgical-call-arg)
 *  5. Setup-body splice: rewrite vue/uni APIs → common_vendor.*; map local imports to
 *     cold requireBinding.export forms; replace setup stmts while keeping render
 *     closure + require preamble; formatSetupStmtsLikeUni partial-DCE + uni multi-line
 *     (F8a: unused setup-only bindings → bare side-effect RHS; SHA==uni warm)
 *  6. Options data() return literals (no setup(__props) shell) - surgical-options-data
 *  7. defineProps default literals - surgical-props-default
 * Falls back (ok:false) when none apply - caller may try mid-path Rollup or full-rebuild.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, renameSync } from 'node:fs'
import { dirname, join, normalize as pathNormalize } from 'node:path'
import {
  patchColdPageJsOptionsDataLiterals,
  patchColdPageJsPropsDefaults,
  scriptLooksOptionsOnly,
  scriptHasVueMacros,
} from './optc-ext-options'

const SRC_REF_RE = /\bref\(\s*(['"])([^'"]*)\1\s*\)/g
const COLD_REF_RE = /\b(?:[\w$]+\.)?ref\(\s*(['"])(.*?)\1\s*\)/g

const VUE_APIS = [
  'ref',
  'computed',
  'reactive',
  'readonly',
  'shallowRef',
  'shallowReactive',
  'shallowReadonly',
  'toRef',
  'toRefs',
  'toValue',
  'unref',
  'isRef',
  'watch',
  'watchEffect',
  'watchPostEffect',
  'watchSyncEffect',
  'onBeforeMount',
  'onMounted',
  'onBeforeUpdate',
  'onUpdated',
  'onBeforeUnmount',
  'onUnmounted',
  'onActivated',
  'onDeactivated',
  'onErrorCaptured',
  'provide',
  'inject',
  'nextTick',
  'getCurrentInstance',
  'useAttrs',
  'useSlots',
  'useCssModule',
  'useCssVars',
]

/** @dcloudio/uni-app lifecycle / page APIs also land on common_vendor in mp emit. */
const UNI_APIS = [
  'onLoad',
  'onShow',
  'onHide',
  'onUnload',
  'onPullDownRefresh',
  'onReachBottom',
  'onShareAppMessage',
  'onShareTimeline',
  'onAddToFavorites',
  'onPageScroll',
  'onResize',
  'onTabItemTap',
  'onNavigationBarButtonTap',
  'onBackPress',
  'onInit',
  'onReady',
  'onLaunch',
  'onError',
  'onPageNotFound',
  'onUnhandledRejection',
  'onThemeChange',
]

const VENDOR_APIS = new Set([...VUE_APIS, ...UNI_APIS])

function sha(s) {
  return createHash('sha256').update(s).digest('hex')
}

function normalizePath(p) {
  return p.replace(/\\/g, '/')
}

export function extractSrcRefLiterals(script) {
  const out = []
  const re = new RegExp(SRC_REF_RE.source, 'g')
  let m
  while ((m = re.exec(script))) out.push({ quote: m[1], value: m[2], index: m.index })
  return out
}

export function extractColdRefLiterals(code) {
  const out = []
  const re = new RegExp(COLD_REF_RE.source, 'g')
  let m
  while ((m = re.exec(code))) {
    out.push({
      quote: m[1],
      value: m[2],
      index: m.index,
      full: m[0],
      valueStart: m.index + m[0].indexOf(m[1] + m[2] + m[1]) + 1,
      valueEnd: m.index + m[0].indexOf(m[1] + m[2] + m[1]) + 1 + m[2].length,
    })
  }
  return out
}

/**
 * Map source ref-literal edits onto cold page JS by ordinal alignment of
 * string-literal ref() calls (ignores ref(false)/ref(x) without quotes).
 */
export function patchColdPageJs(coldJs, oldScript, newScript) {
  const oldRefs = extractSrcRefLiterals(oldScript)
  const newRefs = extractSrcRefLiterals(newScript)
  if (oldRefs.length !== newRefs.length) {
    return {
      ok: false,
      reason: 'ref-arity-mismatch',
      oldCount: oldRefs.length,
      newCount: newRefs.length,
    }
  }
  const changes = []
  for (let i = 0; i < oldRefs.length; i++) {
    if (oldRefs[i].value !== newRefs[i].value) {
      changes.push({ index: i, from: oldRefs[i].value, to: newRefs[i].value })
    }
  }
  if (!changes.length) {
    return { ok: false, reason: 'no-ref-literal-change' }
  }

  const coldRefs = extractColdRefLiterals(coldJs)
  if (coldRefs.length < oldRefs.length) {
    return {
      ok: false,
      reason: 'cold-ref-underflow',
      coldCount: coldRefs.length,
      srcCount: oldRefs.length,
    }
  }

  let offset = 0
  const aligned = []
  for (let i = 0; i < oldRefs.length; i++) {
    let found = -1
    for (let j = offset; j < coldRefs.length; j++) {
      if (coldRefs[j].value === oldRefs[i].value) {
        found = j
        break
      }
    }
    if (found < 0) {
      return {
        ok: false,
        reason: 'cold-ref-value-missing',
        missing: oldRefs[i].value,
        atSrcIndex: i,
      }
    }
    aligned.push(found)
    offset = found + 1
  }

  let next = coldJs
  const applied = []
  const ops = changes
    .map((ch) => {
      const cr = coldRefs[aligned[ch.index]]
      return { ...ch, valueStart: cr.valueStart, valueEnd: cr.valueEnd, quote: cr.quote }
    })
    .sort((a, b) => b.valueStart - a.valueStart)

  for (const op of ops) {
    const slice = next.slice(op.valueStart, op.valueEnd)
    if (slice !== op.from) {
      return {
        ok: false,
        reason: 'cold-slice-mismatch',
        expected: op.from,
        actual: slice,
      }
    }
    next = next.slice(0, op.valueStart) + op.to + next.slice(op.valueEnd)
    applied.push({ from: op.from, to: op.to })
  }

  return {
    ok: true,
    reason: 'ref-literal-patch',
    changes: applied.reverse(),
    beforeSha: sha(coldJs),
    afterSha: sha(next),
    code: next,
  }
}

/** Match one ref() literal arg; returns { litRaw, litNorm, length } or null. */
export function matchRefLitAt(code, i) {
  const s = code.slice(i)
  if (s.startsWith('true') && !/[A-Za-z0-9_$]/.test(s[4] || '')) {
    return { litRaw: 'true', litNorm: 'true', length: 4 }
  }
  if (s.startsWith('false') && !/[A-Za-z0-9_$]/.test(s[5] || '')) {
    return { litRaw: 'false', litNorm: 'false', length: 5 }
  }
  if (s.startsWith('null') && !/[A-Za-z0-9_$]/.test(s[4] || '')) {
    return { litRaw: 'null', litNorm: 'null', length: 4 }
  }
  if (s.startsWith('undefined') && !/[A-Za-z0-9_$]/.test(s[9] || '')) {
    return { litRaw: 'undefined', litNorm: 'undefined', length: 9 }
  }
  const num = s.match(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/)
  if (num) {
    return { litRaw: num[0], litNorm: num[0], length: num[0].length }
  }
  const q = s[0]
  if (q === '"' || q === "'") {
    let j = 1
    while (j < s.length) {
      if (s[j] === '\\') {
        j += 2
        continue
      }
      if (s[j] === q) {
        const litRaw = s.slice(0, j + 1)
        return {
          litRaw,
          litNorm: { type: 'str', value: litRaw.slice(1, -1) },
          length: litRaw.length,
        }
      }
      j++
    }
  }
  return null
}

/**
 * Named `const|let|var ident = ref(LITERAL)` from SFC script (no vendor prefix).
 */
export function extractSrcNamedRefLiterals(script) {
  const out = []
  const headRe = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*ref\(\s*/g
  let m
  while ((m = headRe.exec(script))) {
    const lit = matchRefLitAt(script, m.index + m[0].length)
    if (!lit) continue
    const after = m.index + m[0].length + lit.length
    // require closing )
    let k = after
    while (k < script.length && /[ \t]/.test(script[k])) k++
    if (script[k] !== ')') continue
    const valueStart = m.index + m[0].length
    out.push({
      name: m[1],
      litRaw: lit.litRaw,
      litNorm: lit.litNorm,
      index: m.index,
      valueStart,
      valueEnd: valueStart + lit.length,
    })
  }
  return out
}

/**
 * Named bindings in cold page JS: `const ident = common_vendor.ref(LITERAL)`.
 */
export function extractColdNamedRefLiterals(code) {
  const out = []
  const headRe = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:[\w$]+\.)?ref\(\s*/g
  let m
  while ((m = headRe.exec(code))) {
    const lit = matchRefLitAt(code, m.index + m[0].length)
    if (!lit) continue
    let k = m.index + m[0].length + lit.length
    while (k < code.length && /[ \t]/.test(code[k])) k++
    if (code[k] !== ')') continue
    const valueStart = m.index + m[0].length
    out.push({
      name: m[1],
      litRaw: lit.litRaw,
      litNorm: lit.litNorm,
      index: m.index,
      valueStart,
      valueEnd: valueStart + lit.length,
      full: code.slice(m.index, k + 1),
    })
  }
  return out
}

/** Normalize literal text for equality (strings → content; others → as-is). */
export function normalizeRefLit(litRaw) {
  const hit = matchRefLitAt(String(litRaw).trim(), 0)
  if (hit && hit.length === String(litRaw).trim().length) return hit.litNorm
  return String(litRaw).trim()
}

function refLitNormEqual(a, b) {
  if (a && typeof a === 'object' && b && typeof b === 'object') {
    return a.type === b.type && a.value === b.value
  }
  return a === b
}

/** Format a normalized lit for cold emit, preserving an existing quote char when string. */
function formatRefLitForCold(litNorm, preferQuote = '"') {
  if (litNorm && typeof litNorm === 'object' && litNorm.type === 'str') {
    const q = preferQuote === "'" ? "'" : '"'
    const inner = litNorm.value
    if (q === '"') return `"${inner.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
    return `'${inner.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
  }
  return String(litNorm)
}

/**
 * Replace the literal arg of `const name = ref(...)` in SFC script (first match).
 */
export function replaceSrcNamedRefLit(script, name, newLitRaw) {
  const headRe = new RegExp(
    String.raw`\b(?:const|let|var)\s+${name}\s*=\s*ref\(\s*`,
  )
  const m = headRe.exec(script)
  if (!m) return null
  const lit = matchRefLitAt(script, m.index + m[0].length)
  if (!lit) return null
  const valueStart = m.index + m[0].length
  const valueEnd = valueStart + lit.length
  let k = valueEnd
  while (k < script.length && /[ \t]/.test(script[k])) k++
  if (script[k] !== ')') return null
  return script.slice(0, valueStart) + newLitRaw + script.slice(valueEnd)
}

/**
 * Cold-guided in-place patch for named ref(true|false|num|null|string) flips.
 * Preserves uni cold formatting and DCE (unlike full setup-body re-emit).
 * Only succeeds when every script diff is explained by those named literal flips.
 */
export function patchColdPageJsNamedLiterals(coldJs, oldScript, newScript) {
  const oldNamed = extractSrcNamedRefLiterals(oldScript)
  const newNamed = extractSrcNamedRefLiterals(newScript)
  if (!oldNamed.length && !newNamed.length) {
    return { ok: false, reason: 'no-named-ref-literals' }
  }
  const oldBy = new Map(oldNamed.map((x) => [x.name, x]))
  const newBy = new Map(newNamed.map((x) => [x.name, x]))
  if (oldBy.size !== oldNamed.length || newBy.size !== newNamed.length) {
    return { ok: false, reason: 'named-ref-duplicate-binding' }
  }
  if (oldBy.size !== newBy.size) {
    return {
      ok: false,
      reason: 'named-ref-arity-mismatch',
      oldCount: oldBy.size,
      newCount: newBy.size,
    }
  }
  const changes = []
  for (const [name, ov] of oldBy) {
    const nv = newBy.get(name)
    if (!nv) {
      return { ok: false, reason: 'named-ref-removed', name }
    }
    if (!refLitNormEqual(ov.litNorm, nv.litNorm)) {
      changes.push({
        name,
        from: ov.litRaw,
        to: nv.litRaw,
        fromNorm: ov.litNorm,
        toNorm: nv.litNorm,
      })
    }
  }
  for (const name of newBy.keys()) {
    if (!oldBy.has(name)) {
      return { ok: false, reason: 'named-ref-added', name }
    }
  }
  if (!changes.length) {
    return { ok: false, reason: 'no-named-literal-change' }
  }

  let projected = oldScript
  for (const ch of changes) {
    const next = replaceSrcNamedRefLit(projected, ch.name, ch.to)
    if (next == null) {
      return { ok: false, reason: 'src-named-replace-failed', name: ch.name }
    }
    projected = next
  }
  if (stripImports(projected) !== stripImports(newScript)) {
    return {
      ok: false,
      reason: 'named-literal-incomplete-diff',
      changeCount: changes.length,
      hint: 'Script differs beyond named ref(literal) flips — use setup-body or full rebuild',
    }
  }

  const coldNamed = extractColdNamedRefLiterals(coldJs)
  const coldBy = new Map()
  for (const c of coldNamed) {
    if (!coldBy.has(c.name)) coldBy.set(c.name, c)
  }

  const ops = []
  for (const ch of changes) {
    const cr = coldBy.get(ch.name)
    if (!cr) {
      return {
        ok: false,
        reason: 'cold-named-ref-missing',
        name: ch.name,
        hint: 'Binding may have been DCE’d in cold emit',
      }
    }
    if (!refLitNormEqual(cr.litNorm, ch.fromNorm)) {
      return {
        ok: false,
        reason: 'cold-named-lit-mismatch',
        name: ch.name,
        expected: ch.from,
        actual: cr.litRaw,
      }
    }
    const preferQuote =
      typeof ch.toNorm === 'object' && ch.toNorm.type === 'str'
        ? cr.litRaw[0] === "'" || cr.litRaw[0] === '"'
          ? cr.litRaw[0]
          : '"'
        : '"'
    const replacement = formatRefLitForCold(ch.toNorm, preferQuote)
    ops.push({
      name: ch.name,
      from: ch.from,
      to: ch.to,
      valueStart: cr.valueStart,
      valueEnd: cr.valueEnd,
      replacement,
    })
  }

  let next = coldJs
  ops.sort((a, b) => b.valueStart - a.valueStart)
  const applied = []
  for (const op of ops) {
    const slice = next.slice(op.valueStart, op.valueEnd)
    const sliceNorm = normalizeRefLit(slice)
    const expectNorm = normalizeRefLit(op.from)
    if (!refLitNormEqual(sliceNorm, expectNorm) && slice !== op.from) {
      return {
        ok: false,
        reason: 'cold-named-slice-mismatch',
        name: op.name,
        expected: op.from,
        actual: slice,
      }
    }
    next = next.slice(0, op.valueStart) + op.replacement + next.slice(op.valueEnd)
    applied.push({ name: op.name, from: op.from, to: op.replacement })
  }

  return {
    ok: true,
    reason: 'named-literal-patch',
    emitClass: 'surgical-named',
    changes: applied.reverse(),
    beforeSha: sha(coldJs),
    afterSha: sha(next),
    code: next,
  }
}

/** Strip import declarations; return remaining script body. */
export function stripImports(script) {
  let s = String(script)
  // import … from '…';
  s = s.replace(/\bimport\s+[\s\S]*?\s+from\s+['"][^'"]+['"]\s*;?/g, '\n')
  // import '…';
  s = s.replace(/\bimport\s+['"][^'"]+['"]\s*;?/g, '\n')
  // import(… ) dynamic left alone
  return s.replace(/\n{2,}/g, '\n').trim()
}

export function extractImportSpecs(script) {
  const specs = []
  const re =
    /\bimport\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  let m
  while ((m = re.exec(script))) specs.push(m[1] || m[2])
  return [...new Set(specs)]
}

/**
 * Local (non-vue) imports whose imported names appear in setup stmts.
 */
export function localImportsUsedInSetup(script) {
  const body = stripImports(script)
  const used = []
  const re =
    /\bimport\s+(?:(\w+)|\{([^}]+)\}|\*\s+as\s+(\w+))\s+from\s+['"]([^'"]+)['"]/g
  let m
  while ((m = re.exec(script))) {
    const spec = m[4]
    if (spec === 'vue' || spec === '@dcloudio/uni-app' || spec.startsWith('vue/')) continue
    const names = []
    if (m[1]) names.push(m[1])
    if (m[3]) names.push(m[3])
    if (m[2]) {
      for (const part of m[2].split(',')) {
        const bit = part.trim()
        if (!bit) continue
        const as = bit.split(/\s+as\s+/)
        names.push((as[1] || as[0]).trim())
      }
    }
    for (const name of names) {
      if (!name) continue
      if (new RegExp(`\\b${name}\\b`).test(body)) {
        used.push({ name, spec })
      }
    }
  }
  return used
}

/** Parse structured import decls from SFC script. */
export function parseImportDecls(script) {
  const decls = []
  const re =
    /\bimport\s+(?:(\w+)\s*,\s*)?(?:(\*\s+as\s+(\w+))|(\{([^}]*)\})|(\w+))\s+from\s+['"]([^'"]+)['"]|\bimport\s+['"]([^'"]+)['"]/g
  let m
  while ((m = re.exec(script))) {
    const spec = m[7] || m[8]
    if (!spec) continue
    if (m[8] && !m[7]) {
      decls.push({ kind: 'side-effect', spec, local: null, imported: null })
      continue
    }
    // default + namespace / named: `import Foo, { bar } from`
    if (m[1]) {
      decls.push({ kind: 'default', spec, local: m[1], imported: null })
    }
    if (m[3]) {
      decls.push({ kind: 'namespace', spec, local: m[3], imported: null })
    } else if (m[5] != null) {
      for (const part of m[5].split(',')) {
        const bit = part.trim()
        if (!bit) continue
        const as = bit.split(/\s+as\s+/)
        const imported = as[0].trim()
        const local = (as[1] || as[0]).trim()
        decls.push({ kind: 'named', spec, local, imported })
      }
    } else if (m[6] && !m[1]) {
      // bare default `import Foo from`
      decls.push({ kind: 'default', spec, local: m[6], imported: null })
    }
  }
  return decls
}

export function parseColdRequires(coldJs) {
  const out = []
  const re = /const\s+([A-Za-z_$][\w$]*)\s*=\s*require\(['"]([^'"]+)['"]\)/g
  let m
  while ((m = re.exec(coldJs))) {
    out.push({ binding: m[1], rel: normalizePath(m[2]) })
  }
  return out
}

export function parseColdLazyComponents(coldJs) {
  const out = []
  const re = /const\s+([A-Za-z_$][\w$]*)\s*=\s*\(\)\s*=>\s*['"]([^'"]+)['"]/g
  let m
  while ((m = re.exec(coldJs))) {
    out.push({ binding: m[1], rel: normalizePath(m[2]) })
  }
  return out
}

/** Read `exports.NAME =` keys from a cold chunk file. */
export function readColdChunkExports(chunkAbs) {
  if (!existsSync(chunkAbs) || statSync(chunkAbs).isDirectory()) return []
  const code = readFileSync(chunkAbs, 'utf8')
  const names = []
  const re = /exports\.([A-Za-z_$][\w$]*)\s*=/g
  let m
  while ((m = re.exec(code))) names.push(m[1])
  return [...new Set(names)]
}

/**
 * Normalize an import specifier to a dist-relative path key (no leading ./).
 * pagePath e.g. pages-tab/routeA/index ; outDir is mp-weixin root.
 */
export function specToCandidateKeys(spec, pagePath) {
  const keys = new Set()
  let s = spec
  if (s.startsWith('@/')) s = s.slice(2)
  else if (s.startsWith('./') || s.startsWith('../')) {
    const pageDir = pagePath.includes('/') ? pagePath.replace(/\/[^/]+$/, '') : ''
    s = normalizePath(join(pageDir, s))
  } else if (s.startsWith('@')) {
    // bare package like @private-scope/pkg-a — keep as package key
    keys.add(s)
    keys.add(s.replace(/^@[^/]+\//, ''))
    return [...keys]
  } else if (!s.includes('/')) {
    // bare package ui-lib
    keys.add(s)
    return [...keys]
  }
  s = normalizePath(s).replace(/^\.\//, '')
  s = s.replace(/\.(vue|tsx|ts|jsx|mjs)$/i, '')
  keys.add(s)
  keys.add(s + '.js')
  keys.add(s.replace(/\/index$/, ''))
  keys.add(s + '/index')
  keys.add(s + '/index.js')
  // kebab ↔ already as-is; also try without .js
  if (s.endsWith('.js')) keys.add(s.slice(0, -3))
  return [...keys]
}

/**
 * Match import spec to a cold require by comparing normalized path suffixes.
 */
export function matchRequireForSpec(spec, pagePath, requires) {
  const keys = specToCandidateKeys(spec, pagePath)
  for (const r of requires) {
    // r.rel is like ../../services/apis/api-a.js — resolve against page file dir
    const pageDir = pagePath.includes('/') ? pagePath.replace(/\/[^/]+$/, '') : ''
    const absFromPage = normalizePath(pathNormalize(join(pageDir, r.rel)))
    // strip leading junk from normalize of ../..
    let cleaned = absFromPage
    while (cleaned.startsWith('../')) cleaned = cleaned.slice(3)
    while (cleaned.startsWith('..')) cleaned = cleaned.slice(2)
    cleaned = cleaned.replace(/^\//, '')
    const candidates = [
      cleaned,
      cleaned.replace(/\.js$/, ''),
      cleaned.replace(/\/index\.js$/, ''),
      cleaned.replace(/\/index$/, ''),
      r.rel,
      r.rel.replace(/^\.\.\//, '').replace(/^\.\.\//, ''),
    ]
    for (const c of candidates) {
      const cn = normalizePath(c).replace(/^\.\//, '')
      for (const k of keys) {
        if (cn === k || cn.endsWith('/' + k) || k.endsWith('/' + cn) || cn.replace(/\.js$/, '') === k) {
          return r
        }
      }
    }
  }
  // Secondary: match by trailing path segments of keys against require rel
  for (const r of requires) {
    const rel = r.rel.replace(/^\.\.\//g, '').replace(/^\.\//, '')
    // collapse ../../ from pages-tab/routeA → two levels up
    const parts = r.rel.split('/')
    let ups = 0
    for (const p of parts) if (p === '..') ups++
    const rest = parts.filter((p) => p !== '..' && p !== '.').join('/')
    for (const k of keys) {
      if (rest === k || rest === k + '.js' || rest.replace(/\.js$/, '') === k) return r
      if (rest.endsWith('/' + k) || rest.endsWith('/' + k + '.js')) return r
    }
  }
  return null
}

/**
 * Build localName → coldExpr rewrite map using cold requires + chunk exports.
 * @returns {{ map: Record<string,string>, unmapped: Array, mapped: Array }}
 */
export function buildLocalRewriteMap(script, coldJs, pagePath, outDir) {
  const requires = parseColdRequires(coldJs)
  const lazys = parseColdLazyComponents(coldJs)
  const decls = parseImportDecls(script)
  const body = stripImports(script)
  const map = Object.create(null)
  const mapped = []
  const unmapped = []

  // vue / uni-app → common_vendor (handled separately in rewriteVueApis, but named imports too)
  for (const d of decls) {
    if (!d.local) continue
    if (d.spec === 'vue' || d.spec === '@dcloudio/uni-app' || (d.spec && d.spec.startsWith('vue/'))) {
      const exportName = d.imported || d.local
      map[d.local] = `common_vendor.${exportName}`
      mapped.push({ local: d.local, expr: map[d.local], via: 'vendor-api', spec: d.spec })
    }
  }

  for (const d of decls) {
    if (!d.local) continue
    if (d.spec === 'vue' || d.spec === '@dcloudio/uni-app' || (d.spec && d.spec.startsWith('vue/'))) {
      continue
    }
    // Skip if not used in setup body (template-only component imports)
    if (!new RegExp(`\\b${d.local}\\b`).test(body)) {
      continue
    }
    if (map[d.local]) continue

    // Lazy component: local name usually equals cold lazy const
    const lazyHit = lazys.find((l) => l.binding === d.local)
    if (lazyHit) {
      // Components used in setup (rare) — identity; const exists outside setup
      map[d.local] = d.local
      mapped.push({ local: d.local, expr: d.local, via: 'lazy-component', spec: d.spec })
      continue
    }

    const req = matchRequireForSpec(d.spec, pagePath, requires)
    if (req) {
      if (d.kind === 'named') {
        const chunkAbs = normalizePath(join(dirname(join(outDir, pagePath + '.js')), req.rel))
        const exports = readColdChunkExports(chunkAbs)
        // Fail-closed: if chunk advertises exports and imported name is absent, do not map
        if (exports.length && d.imported && !exports.includes(d.imported)) {
          unmapped.push({
            local: d.local,
            spec: d.spec,
            kind: d.kind,
            imported: d.imported,
            reason: 'cold-chunk-export-missing',
            exportsSample: exports.slice(0, 8),
          })
          continue
        }
        map[d.local] = `${req.binding}.${d.imported}`
        mapped.push({ local: d.local, expr: map[d.local], via: 'require-named', spec: d.spec })
        continue
      }
      if (d.kind === 'namespace') {
        map[d.local] = req.binding
        mapped.push({ local: d.local, expr: map[d.local], via: 'require-ns', spec: d.spec })
        continue
      }
      if (d.kind === 'default') {
        const chunkAbs = normalizePath(join(dirname(join(outDir, pagePath + '.js')), req.rel))
        const exports = readColdChunkExports(chunkAbs)
        let exportName = null
        if (exports.includes(d.local)) exportName = d.local
        else if (exports.length === 1) exportName = exports[0]
        else {
          // Learn from cold setup: look for req.binding.SOMETHING used
          const setupSplit = splitColdSetup(coldJs)
          const setup = setupSplit ? setupSplit.setupStmts : coldJs
          const propRe = new RegExp(`\\b${req.binding}\\.([A-Za-z_$][\\w$]*)`, 'g')
          const props = new Set()
          let pm
          while ((pm = propRe.exec(setup))) props.add(pm[1])
          if (props.size === 1) exportName = [...props][0]
          else if (props.has(d.local)) exportName = d.local
          else if (exports.length) {
            // Prefer export that appears in setup props
            for (const e of exports) {
              if (props.has(e)) {
                exportName = e
                break
              }
            }
            // HARDEN (deep-messy c5): never guess exports[0] when multiple
            // exports and no cold usage evidence — leave unmapped → fail-closed.
          }
        }
        if (exportName) {
          map[d.local] = `${req.binding}.${exportName}`
          mapped.push({
            local: d.local,
            expr: map[d.local],
            via: 'require-default',
            spec: d.spec,
            exportName,
            exports,
          })
          continue
        }
      }
    }

    // Folded into common_vendor (e.g. @private-scope/pkg-a → common_vendor.url)
    if (d.kind === 'named') {
      const candidate = `common_vendor.${d.imported}`
      if (coldJs.includes(candidate) || coldJs.includes(`common_vendor.${d.imported}`)) {
        map[d.local] = candidate
        mapped.push({ local: d.local, expr: candidate, via: 'vendor-fold-named', spec: d.spec })
        continue
      }
    }
    if (d.kind === 'default') {
      const candidate = `common_vendor.${d.local}`
      if (coldJs.includes(candidate)) {
        map[d.local] = candidate
        mapped.push({ local: d.local, expr: candidate, via: 'vendor-fold-default', spec: d.spec })
        continue
      }
    }

    unmapped.push({ local: d.local, spec: d.spec, kind: d.kind, imported: d.imported })
  }

  return { map, mapped, unmapped, requires, lazys }
}

/**
 * Replace free identifiers with cold expressions. Skips strings, comments,
 * property access (.ident), and object keys (ident:).
 */
export function rewriteIdents(code, rewriteMap) {
  const names = Object.keys(rewriteMap).sort((a, b) => b.length - a.length)
  if (!names.length) return code
  const nameSet = new Set(names)
  let out = ''
  let i = 0
  const len = code.length

  function isIdentStart(c) {
    return /[A-Za-z_$]/.test(c)
  }
  function isIdent(c) {
    return /[A-Za-z0-9_$]/.test(c)
  }

  while (i < len) {
    const c = code[i]
    // strings
    if (c === '"' || c === "'" || c === '`') {
      const q = c
      out += c
      i++
      while (i < len) {
        if (code[i] === '\\') {
          out += code[i] + (code[i + 1] || '')
          i += 2
          continue
        }
        out += code[i]
        if (code[i] === q) {
          i++
          break
        }
        i++
      }
      continue
    }
    // line comment
    if (c === '/' && code[i + 1] === '/') {
      while (i < len && code[i] !== '\n') {
        out += code[i]
        i++
      }
      continue
    }
    // block comment
    if (c === '/' && code[i + 1] === '*') {
      out += '/*'
      i += 2
      while (i < len && !(code[i] === '*' && code[i + 1] === '/')) {
        out += code[i]
        i++
      }
      out += '*/'
      i += 2
      continue
    }
    // identifier
    if (isIdentStart(c)) {
      let j = i + 1
      while (j < len && isIdent(code[j])) j++
      const ident = code.slice(i, j)
      // preceded by '.' ? → property access, keep
      let k = i - 1
      while (k >= 0 && /[ \t]/.test(code[k])) k--
      const prev = k >= 0 ? code[k] : ''
      // followed by ':' at same level → object key (rough: skip whitespace)
      let n = j
      while (n < len && /[ \t]/.test(code[n])) n++
      const next = code[n]
      if (prev === '.') {
        out += ident
        i = j
        continue
      }
      if (next === ':' && nameSet.has(ident)) {
        // object key or label — keep (url: path)
        out += ident
        i = j
        continue
      }
      if (nameSet.has(ident)) {
        out += rewriteMap[ident]
        i = j
        continue
      }
      out += ident
      i = j
      continue
    }
    out += c
    i++
  }
  return out
}

export function rewriteVueApisToCommonVendor(code) {
  let s = code
  for (const api of VENDOR_APIS) {
    // avoid double-prefixing common_vendor.ref(
    s = s.replace(new RegExp(`(?<!\\.)\\b${api}\\s*\\(`, 'g'), `common_vendor.${api}(`)
  }
  return s
}

/** Prefer double-quoted string literals to match uni cold emit style. */
export function preferDoubleQuotes(code) {
  return code.replace(/(['"])((?:\\.|(?!\1).)*)\1/g, (all, q, inner) => {
    if (q === '"') return all
    if (inner.includes('"') && !inner.includes("'")) return all
    return `"${inner.replace(/"/g, '\\"')}"`
  })
}

/**
 * Split cold page JS into: beforeSetupBody | setupStmts | returnAndAfter
 * where returnAndAfter starts at `return (` inside setup (render closure).
 */
export function splitColdSetup(coldJs) {
  const setupRe = /setup\s*\(\s*__props\s*(?:,\s*\{[^}]*\})?\s*\)\s*\{/
  const m = setupRe.exec(coldJs)
  if (!m) return null
  const bodyStart = m.index + m[0].length

  // Scan for `return (` at brace depth 0 within setup body (string/comment aware)
  let i = bodyStart
  let depth = 0
  let returnAt = -1
  const len = coldJs.length
  while (i < len) {
    const c = coldJs[i]
    if (c === '"' || c === "'" || c === '`') {
      const q = c
      i++
      while (i < len) {
        if (coldJs[i] === '\\') {
          i += 2
          continue
        }
        if (coldJs[i] === q) {
          i++
          break
        }
        i++
      }
      continue
    }
    if (c === '/' && coldJs[i + 1] === '/') {
      i += 2
      while (i < len && coldJs[i] !== '\n') i++
      continue
    }
    if (c === '/' && coldJs[i + 1] === '*') {
      i += 2
      while (i < len && !(coldJs[i] === '*' && coldJs[i + 1] === '/')) i++
      i += 2
      continue
    }
    if (c === '{') {
      depth++
      i++
      continue
    }
    if (c === '}') {
      if (depth === 0) {
        // end of setup without finding return — fail
        return null
      }
      depth--
      i++
      continue
    }
    if (depth === 0 && coldJs.startsWith('return', i) && /\breturn\s*\(/.test(coldJs.slice(i, i + 16))) {
      returnAt = i
      break
    }
    i++
  }
  if (returnAt < 0) return null

  return {
    beforeSetupBody: coldJs.slice(0, bodyStart),
    setupStmts: coldJs.slice(bodyStart, returnAt),
    returnAndAfter: coldJs.slice(returnAt),
    bodyStart,
    returnAt,
  }
}

/**
 * Binding names assigned in setup stmts (const/let/var x =).
 */
export function assignedNames(stmts) {
  const names = new Set()
  const re = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g
  let m
  while ((m = re.exec(stmts))) names.add(m[1])
  return names
}

/**
 * Names referenced in the render closure that must remain assigned in setup.
 */
export function renderReferencedNames(returnAndAfter) {
  // Heuristic: stop at end of setup's return arrow function — use first 2k of return
  const slice = returnAndAfter.slice(0, 8000)
  const names = new Set()
  const re = /\b([A-Za-z_$][\w$]*)\b/g
  let m
  while ((m = re.exec(slice))) {
    const n = m[1]
    if (
      n === 'return' ||
      n === '_ctx' ||
      n === '_cache' ||
      n === 'common_vendor' ||
      n === 'void' ||
      n === 'null' ||
      n === 'true' ||
      n === 'false' ||
      n === 'Math'
    ) {
      continue
    }
    names.add(n)
  }
  return names
}

/** Match a standalone literal at position i (same as ref lit matcher). */
export function matchPlainLitAt(code, i) {
  return matchRefLitAt(code, i)
}

/**
 * Named `const|let|var ident = LITERAL` in SFC (not `ref(...)`, not calls).
 * Only pure literal RHS — fail-closed for expressions.
 */
export function extractSrcPlainConstLiterals(script) {
  const out = []
  const headRe = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*/g
  let m
  while ((m = headRe.exec(script))) {
    // Skip if this is `= ref(` (handled by named-ref path)
    const afterEq = script.slice(m.index + m[0].length)
    if (/^ref\s*\(/.test(afterEq)) continue
    if (/^(?:reactive|computed|shallowRef|readonly)\s*\(/.test(afterEq)) continue
    const lit = matchPlainLitAt(script, m.index + m[0].length)
    if (!lit) continue
    // Require end of statement-ish: ; or newline or EOF, optional trailing comment
    let k = m.index + m[0].length + lit.length
    while (k < script.length && /[ \t]/.test(script[k])) k++
    if (k < script.length && script[k] !== ';' && script[k] !== '\n' && script[k] !== '\r') {
      // allow end of file
      if (k < script.length) continue
    }
    const valueStart = m.index + m[0].length
    out.push({
      name: m[1],
      litRaw: lit.litRaw,
      litNorm: lit.litNorm,
      index: m.index,
      valueStart,
      valueEnd: valueStart + lit.length,
    })
  }
  return out
}

/**
 * Cold: `const|let|var ident = LITERAL` (no vendor.ref wrapper).
 */
export function extractColdPlainConstLiterals(code) {
  const out = []
  const headRe = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*/g
  let m
  while ((m = headRe.exec(code))) {
    const afterEq = code.slice(m.index + m[0].length)
    // Skip require(...), ref(...), calls, objects
    if (/^(?:[\w$]+\.)?ref\s*\(/.test(afterEq)) continue
    if (/^require\s*\(/.test(afterEq)) continue
    if (/^(?:reactive|computed|shallowRef|readonly)\s*\(/.test(afterEq)) continue
    if (/^[({\[]/.test(afterEq)) continue
    // Skip `foo.bar(...)` or `foo(...)` call RHS
    if (/^[A-Za-z_$][\w$.]*\s*\(/.test(afterEq)) continue
    const lit = matchPlainLitAt(code, m.index + m[0].length)
    if (!lit) continue
    let k = m.index + m[0].length + lit.length
    while (k < code.length && /[ \t]/.test(code[k])) k++
    if (k < code.length && code[k] !== ';' && code[k] !== '\n' && code[k] !== '\r' && code[k] !== ',') {
      continue
    }
    const valueStart = m.index + m[0].length
    out.push({
      name: m[1],
      litRaw: lit.litRaw,
      litNorm: lit.litNorm,
      index: m.index,
      valueStart,
      valueEnd: valueStart + lit.length,
    })
  }
  return out
}

export function replaceSrcPlainConstLit(script, name, newLitRaw) {
  const headRe = new RegExp(
    String.raw`\b(?:const|let|var)\s+${name}\s*=\s*`,
  )
  const m = headRe.exec(script)
  if (!m) return null
  const afterEq = script.slice(m.index + m[0].length)
  if (/^ref\s*\(/.test(afterEq)) return null
  const lit = matchPlainLitAt(script, m.index + m[0].length)
  if (!lit) return null
  const valueStart = m.index + m[0].length
  const valueEnd = valueStart + lit.length
  return script.slice(0, valueStart) + newLitRaw + script.slice(valueEnd)
}

/**
 * Cold-guided in-place patch for plain `const name = LITERAL` flips (no ref()).
 * emitClass: surgical-plain-literal
 */
export function patchColdPageJsPlainLiterals(coldJs, oldScript, newScript) {
  const oldPlain = extractSrcPlainConstLiterals(oldScript)
  const newPlain = extractSrcPlainConstLiterals(newScript)
  if (!oldPlain.length && !newPlain.length) {
    return { ok: false, reason: 'no-plain-const-literals' }
  }
  const oldBy = new Map(oldPlain.map((x) => [x.name, x]))
  const newBy = new Map(newPlain.map((x) => [x.name, x]))
  if (oldBy.size !== oldPlain.length || newBy.size !== newPlain.length) {
    return { ok: false, reason: 'plain-const-duplicate-binding' }
  }
  if (oldBy.size !== newBy.size) {
    return {
      ok: false,
      reason: 'plain-const-arity-mismatch',
      oldCount: oldBy.size,
      newCount: newBy.size,
    }
  }
  const changes = []
  for (const [name, ov] of oldBy) {
    const nv = newBy.get(name)
    if (!nv) return { ok: false, reason: 'plain-const-removed', name }
    if (!refLitNormEqual(ov.litNorm, nv.litNorm)) {
      changes.push({
        name,
        from: ov.litRaw,
        to: nv.litRaw,
        fromNorm: ov.litNorm,
        toNorm: nv.litNorm,
      })
    }
  }
  for (const name of newBy.keys()) {
    if (!oldBy.has(name)) return { ok: false, reason: 'plain-const-added', name }
  }
  if (!changes.length) {
    return { ok: false, reason: 'no-plain-literal-change' }
  }

  let projected = oldScript
  for (const ch of changes) {
    const next = replaceSrcPlainConstLit(projected, ch.name, ch.to)
    if (next == null) {
      return { ok: false, reason: 'src-plain-replace-failed', name: ch.name }
    }
    projected = next
  }
  if (stripImports(projected) !== stripImports(newScript)) {
    return {
      ok: false,
      reason: 'plain-literal-incomplete-diff',
      changeCount: changes.length,
      hint: 'Script differs beyond plain const literal flips',
    }
  }

  const coldPlain = extractColdPlainConstLiterals(coldJs)
  const coldBy = new Map()
  for (const c of coldPlain) {
    if (!coldBy.has(c.name)) coldBy.set(c.name, c)
  }

  const ops = []
  for (const ch of changes) {
    const cr = coldBy.get(ch.name)
    if (!cr) {
      return {
        ok: false,
        reason: 'cold-plain-const-missing',
        name: ch.name,
        hint: 'Binding may have been DCE’d or is not a plain literal in cold',
      }
    }
    if (!refLitNormEqual(cr.litNorm, ch.fromNorm)) {
      return {
        ok: false,
        reason: 'cold-plain-lit-mismatch',
        name: ch.name,
        expected: ch.from,
        actual: cr.litRaw,
      }
    }
    const preferQuote =
      typeof ch.toNorm === 'object' && ch.toNorm.type === 'str'
        ? cr.litRaw[0] === "'" || cr.litRaw[0] === '"'
          ? cr.litRaw[0]
          : '"'
        : '"'
    const replacement = formatRefLitForCold(ch.toNorm, preferQuote)
    ops.push({
      name: ch.name,
      from: ch.from,
      to: ch.to,
      valueStart: cr.valueStart,
      valueEnd: cr.valueEnd,
      replacement,
    })
  }

  let next = coldJs
  ops.sort((a, b) => b.valueStart - a.valueStart)
  const applied = []
  for (const op of ops) {
    const slice = next.slice(op.valueStart, op.valueEnd)
    const sliceNorm = normalizeRefLit(slice)
    const expectNorm = normalizeRefLit(op.from)
    if (!refLitNormEqual(sliceNorm, expectNorm) && slice !== op.from) {
      return {
        ok: false,
        reason: 'cold-plain-slice-mismatch',
        name: op.name,
        expected: op.from,
        actual: slice,
      }
    }
    next = next.slice(0, op.valueStart) + op.replacement + next.slice(op.valueEnd)
    applied.push({ name: op.name, from: op.from, to: op.replacement })
  }

  return {
    ok: true,
    reason: 'plain-literal-patch',
    emitClass: 'surgical-plain-literal',
    changes: applied.reverse(),
    beforeSha: sha(coldJs),
    afterSha: sha(next),
    code: next,
  }
}

/**
 * Extract simple callee(LITERAL[, LITERAL...]) calls from script body.
 * Only all-literal args; fail-closed on complex args.
 */
export function extractSrcLiteralCalls(script) {
  const body = stripImports(script)
  const out = []
  // ident(... ) — single identifier callee (local import or local fn)
  const callRe = /\b([A-Za-z_$][\w$]*)\s*\(\s*/g
  let m
  while ((m = callRe.exec(body))) {
    const callee = m[1]
    // skip keywords / vue APIs that use non-literal or are handled elsewhere
    if (VENDOR_APIS.has(callee)) continue
    if (callee === 'ref' || callee === 'require' || callee === 'Component') continue
    const argsStart = m.index + m[0].length
    const args = []
    let pos = argsStart
    let aborted = false
    if (body[pos] === ')') {
      // zero-arg — skip (no literal to flip)
      continue
    }
    while (pos < body.length) {
      while (pos < body.length && /[ \t\n\r]/.test(body[pos])) pos++
      const lit = matchPlainLitAt(body, pos)
      if (!lit) {
        aborted = true
        break
      }
      args.push({
        litRaw: lit.litRaw,
        litNorm: lit.litNorm,
        valueStart: pos,
        valueEnd: pos + lit.length,
      })
      pos += lit.length
      while (pos < body.length && /[ \t\n\r]/.test(body[pos])) pos++
      if (body[pos] === ',') {
        pos++
        continue
      }
      if (body[pos] === ')') break
      aborted = true
      break
    }
    if (aborted || body[pos] !== ')') continue
    out.push({
      callee,
      args,
      index: m.index,
      fullEnd: pos + 1,
      full: body.slice(m.index, pos + 1),
    })
  }
  return out
}

/**
 * Find cold occurrences of `coldExpr(LITERAL...)` matching a mapped local call.
 * coldExpr may be `modules_utils_unifastProbe.probeMul` (dotted).
 */
export function findColdMappedCalls(coldJs, coldExpr, arity) {
  const out = []
  // Escape dots in coldExpr for regex
  const esc = coldExpr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const headRe = new RegExp(esc + String.raw`\s*\(\s*`, 'g')
  let m
  while ((m = headRe.exec(coldJs))) {
    const args = []
    let pos = m.index + m[0].length
    let aborted = false
    if (coldJs[pos] === ')') {
      if (arity === 0) {
        out.push({ args: [], index: m.index, argsStart: pos, fullEnd: pos + 1 })
      }
      continue
    }
    while (pos < coldJs.length) {
      while (pos < coldJs.length && /[ \t\n\r]/.test(coldJs[pos])) pos++
      const lit = matchPlainLitAt(coldJs, pos)
      if (!lit) {
        aborted = true
        break
      }
      args.push({
        litRaw: lit.litRaw,
        litNorm: lit.litNorm,
        valueStart: pos,
        valueEnd: pos + lit.length,
      })
      pos += lit.length
      while (pos < coldJs.length && /[ \t\n\r]/.test(coldJs[pos])) pos++
      if (coldJs[pos] === ',') {
        pos++
        continue
      }
      if (coldJs[pos] === ')') break
      aborted = true
      break
    }
    if (aborted || coldJs[pos] !== ')') continue
    if (args.length !== arity) continue
    out.push({ args, index: m.index, argsStart: m.index + m[0].length, fullEnd: pos + 1 })
  }
  return out
}

function replaceSrcCallArg(script, callee, argIndex, newLitRaw, occurrence = 0) {
  // Operate on full script but match like extractSrcLiteralCalls on stripImports coords is hard.
  // Simpler: walk full script with same call pattern (imports rarely have such calls).
  const callRe = new RegExp(String.raw`\b${callee}\s*\(\s*`, 'g')
  let m
  let seen = 0
  while ((m = callRe.exec(script))) {
    let pos = m.index + m[0].length
    const args = []
    let aborted = false
    if (script[pos] === ')') continue
    while (pos < script.length) {
      while (pos < script.length && /[ \t\n\r]/.test(script[pos])) pos++
      const lit = matchPlainLitAt(script, pos)
      if (!lit) {
        aborted = true
        break
      }
      args.push({ valueStart: pos, valueEnd: pos + lit.length, litRaw: lit.litRaw })
      pos += lit.length
      while (pos < script.length && /[ \t\n\r]/.test(script[pos])) pos++
      if (script[pos] === ',') {
        pos++
        continue
      }
      if (script[pos] === ')') break
      aborted = true
      break
    }
    if (aborted || script[pos] !== ')') continue
    if (seen === occurrence) {
      if (argIndex >= args.length) return null
      const a = args[argIndex]
      return script.slice(0, a.valueStart) + newLitRaw + script.slice(a.valueEnd)
    }
    seen++
  }
  return null
}

/**
 * Cold-guided in-place patch for mapped local call literal args, e.g. probeMul(21→22).
 * Prefer over setup-body when the entire script diff is explained by those arg flips.
 * emitClass: surgical-call-arg
 * opts: { pagePath, outDir } required for local→cold mapping.
 */
export function patchColdPageJsCallArgs(coldJs, oldScript, newScript, opts = {}) {
  const pagePath = opts.pagePath || ''
  const outDir = opts.outDir || ''
  if (!pagePath || !outDir) {
    return { ok: false, reason: 'call-arg-need-page-context' }
  }

  const oldCalls = extractSrcLiteralCalls(oldScript)
  const newCalls = extractSrcLiteralCalls(newScript)
  if (!oldCalls.length && !newCalls.length) {
    return { ok: false, reason: 'no-literal-calls' }
  }

  // Align by ordinal per callee
  const oldByCallee = new Map()
  for (const c of oldCalls) {
    if (!oldByCallee.has(c.callee)) oldByCallee.set(c.callee, [])
    oldByCallee.get(c.callee).push(c)
  }
  const newByCallee = new Map()
  for (const c of newCalls) {
    if (!newByCallee.has(c.callee)) newByCallee.set(c.callee, [])
    newByCallee.get(c.callee).push(c)
  }

  // Build rewrite map from newScript (import set should be stable for this path)
  const rewriteInfo = buildLocalRewriteMap(newScript, coldJs, pagePath, outDir)
  // Also allow callees that appear as cold identity (same name) without import — rare

  const argChanges = []
  for (const [callee, oList] of oldByCallee) {
    const nList = newByCallee.get(callee)
    if (!nList || nList.length !== oList.length) {
      return {
        ok: false,
        reason: 'call-arg-arity-mismatch',
        callee,
        oldCount: oList.length,
        newCount: nList?.length || 0,
      }
    }
    const coldExpr = rewriteInfo.map[callee]
    if (!coldExpr) {
      // Callee not a mapped local import — cannot cold-patch safely
      // Check if any arg changed; if so, fail closed
      for (let i = 0; i < oList.length; i++) {
        for (let a = 0; a < oList[i].args.length; a++) {
          if (!refLitNormEqual(oList[i].args[a].litNorm, nList[i].args[a].litNorm)) {
            return {
              ok: false,
              reason: 'call-arg-unmapped-callee',
              callee,
              hint: 'Callee not in cold rewrite map',
            }
          }
        }
      }
      continue
    }
    for (let i = 0; i < oList.length; i++) {
      if (oList[i].args.length !== nList[i].args.length) {
        return {
          ok: false,
          reason: 'call-arg-count-mismatch',
          callee,
          occurrence: i,
        }
      }
      for (let a = 0; a < oList[i].args.length; a++) {
        if (!refLitNormEqual(oList[i].args[a].litNorm, nList[i].args[a].litNorm)) {
          argChanges.push({
            callee,
            coldExpr,
            occurrence: i,
            argIndex: a,
            from: oList[i].args[a].litRaw,
            to: nList[i].args[a].litRaw,
            fromNorm: oList[i].args[a].litNorm,
            toNorm: nList[i].args[a].litNorm,
            arity: oList[i].args.length,
          })
        }
      }
    }
  }
  for (const callee of newByCallee.keys()) {
    if (!oldByCallee.has(callee)) {
      return { ok: false, reason: 'call-arg-callee-added', callee }
    }
  }
  if (!argChanges.length) {
    return { ok: false, reason: 'no-call-arg-change' }
  }

  // Project old → new via arg replacements; must fully explain stripImports diff
  let projected = oldScript
  for (const ch of argChanges) {
    const next = replaceSrcCallArg(projected, ch.callee, ch.argIndex, ch.to, ch.occurrence)
    if (next == null) {
      return {
        ok: false,
        reason: 'src-call-arg-replace-failed',
        callee: ch.callee,
        argIndex: ch.argIndex,
      }
    }
    projected = next
  }
  if (stripImports(projected) !== stripImports(newScript)) {
    return {
      ok: false,
      reason: 'call-arg-incomplete-diff',
      changeCount: argChanges.length,
      hint: 'Script differs beyond mapped call literal-arg flips — use setup-body or mid-path',
    }
  }

  // Locate cold call sites and patch
  const ops = []
  for (const ch of argChanges) {
    const sites = findColdMappedCalls(coldJs, ch.coldExpr, ch.arity)
    if (sites.length <= ch.occurrence) {
      return {
        ok: false,
        reason: 'cold-call-site-missing',
        callee: ch.callee,
        coldExpr: ch.coldExpr,
        occurrence: ch.occurrence,
        found: sites.length,
      }
    }
    const site = sites[ch.occurrence]
    const arg = site.args[ch.argIndex]
    if (!arg) {
      return { ok: false, reason: 'cold-call-arg-missing', callee: ch.callee }
    }
    if (!refLitNormEqual(arg.litNorm, ch.fromNorm)) {
      return {
        ok: false,
        reason: 'cold-call-arg-mismatch',
        callee: ch.callee,
        expected: ch.from,
        actual: arg.litRaw,
      }
    }
    const preferQuote =
      typeof ch.toNorm === 'object' && ch.toNorm.type === 'str'
        ? arg.litRaw[0] === "'" || arg.litRaw[0] === '"'
          ? arg.litRaw[0]
          : '"'
        : '"'
    const replacement = formatRefLitForCold(ch.toNorm, preferQuote)
    ops.push({
      callee: ch.callee,
      coldExpr: ch.coldExpr,
      argIndex: ch.argIndex,
      from: ch.from,
      to: ch.to,
      valueStart: arg.valueStart,
      valueEnd: arg.valueEnd,
      replacement,
    })
  }

  let nextCode = coldJs
  ops.sort((a, b) => b.valueStart - a.valueStart)
  const applied = []
  for (const op of ops) {
    const slice = nextCode.slice(op.valueStart, op.valueEnd)
    const sliceNorm = normalizeRefLit(slice)
    const expectNorm = normalizeRefLit(op.from)
    if (!refLitNormEqual(sliceNorm, expectNorm) && slice !== op.from) {
      return {
        ok: false,
        reason: 'cold-call-slice-mismatch',
        callee: op.callee,
        expected: op.from,
        actual: slice,
      }
    }
    nextCode =
      nextCode.slice(0, op.valueStart) + op.replacement + nextCode.slice(op.valueEnd)
    applied.push({
      callee: op.callee,
      coldExpr: op.coldExpr,
      argIndex: op.argIndex,
      from: op.from,
      to: op.replacement,
    })
  }

  return {
    ok: true,
    reason: 'call-arg-patch',
    emitClass: 'surgical-call-arg',
    changes: applied.reverse(),
    beforeSha: sha(coldJs),
    afterSha: sha(nextCode),
    code: nextCode,
    localMapped: rewriteInfo.mapped,
    localMappedCount: rewriteInfo.mapped.length,
  }
}


/**
 * Split top-level statements on `;` **or ASI newlines** (string / comment / nest aware).
 * Measured deep-messy: semicolon-only split merged `const a=1\nconst b=…` into one decl
 * and DCE dropped `const a`, leaving `a` as TDZ/ReferenceError — silent wrong on ASI sources
 * (project census ~1724 ASI-leaning vue scripts).
 */
export function splitTopLevelStatements(code) {
  const stmts = []
  let start = 0
  let i = 0
  const len = code.length
  let depth = 0

  const STMT_KW =
    /^(?:const|let|var|function|async\s+function|class|if|else|for|while|do|switch|try|catch|finally|throw|return|break|continue|debugger|import|export|void|with|await)\b/

  function isIdentStart(ch) {
    return ch && /[A-Za-z_$]/.test(ch)
  }

  /** Next non-space at idx looks like a new statement (ASI). */
  function looksLikeStmtStart(idx) {
    let j = idx
    while (j < len && (code[j] === ' ' || code[j] === '\t' || code[j] === '\r')) j++
    if (j >= len) return false
    // line comments / block comments → skip and retry
    if (code[j] === '/' && code[j + 1] === '/') {
      while (j < len && code[j] !== '\n') j++
      return looksLikeStmtStart(j + 1)
    }
    if (code[j] === '/' && code[j + 1] === '*') {
      j += 2
      while (j < len && !(code[j] === '*' && code[j + 1] === '/')) j++
      return looksLikeStmtStart(j + 2)
    }
    const slice = code.slice(j, j + 24)
    if (STMT_KW.test(slice)) return true
    // bare call / assign starting at line — ASI separates from prior stmt
    if (isIdentStart(code[j])) return true
    return false
  }

  /** Line ends in a token that ASI will NOT insert semicolon before next line. */
  function asiNoSplitAfter(before) {
    const t = before.replace(/\s+$/, '')
    if (!t) return true
    // trailing binary/unary/punct that continues expression
    if (/[,.\\+\-*/%&|^?:=!<>~]$/.test(t)) return true
    // incomplete scientific notation
    if (/\b(?:0[xXbB])?[0-9.]+e[+-]?$/i.test(t)) return true
    // control without block body yet: `if (x)` / `while (x)` / `for (...)` / `else` / `do` / `catch` / `finally` / `try`
    if (/(?:^|[^$\w])(?:if|for|while|catch|switch|function|async\s+function)\s*\([^)]*\)$/.test(t)) return true
    if (/(?:^|[^$\w])(?:else|do|try|finally)\s*$/.test(t)) return true
    if (/(?:^|[^$\w])(?:else\s+if)\s*\([^)]*\)$/.test(t)) return true
    // arrow with expression body continuing: `=>`
    if (/=>\s*$/.test(t)) return true
    // open paren/bracket already handled by depth; hanging `return`/`throw`/`break`/`continue`/`yield`
    if (/(?:^|[^$\w])(?:return|throw|yield|break|continue)\s*$/.test(t)) return true
    return false
  }

  while (i < len) {
    const c = code[i]
    if (c === '"' || c === "'" || c === '`') {
      const q = c
      i++
      while (i < len) {
        if (code[i] === '\\') {
          i += 2
          continue
        }
        if (q === '`' && code[i] === '$' && code[i + 1] === '{') {
          // template expression — bump depth via normal `{` path by falling through after skip? 
          // Simpler: scan nested ${} with local depth
          i += 2
          let td = 1
          while (i < len && td > 0) {
            if (code[i] === '\\') {
              i += 2
              continue
            }
            if (code[i] === '"' || code[i] === "'") {
              const qq = code[i++]
              while (i < len) {
                if (code[i] === '\\') {
                  i += 2
                  continue
                }
                if (code[i] === qq) {
                  i++
                  break
                }
                i++
              }
              continue
            }
            if (code[i] === '{') td++
            else if (code[i] === '}') td--
            i++
          }
          continue
        }
        if (code[i] === q) {
          i++
          break
        }
        i++
      }
      continue
    }
    if (c === '/' && code[i + 1] === '/') {
      i += 2
      while (i < len && code[i] !== '\n') i++
      continue
    }
    if (c === '/' && code[i + 1] === '*') {
      i += 2
      while (i < len && !(code[i] === '*' && code[i + 1] === '/')) i++
      i += 2
      continue
    }
    // regex literal heuristic at depth 0 expression positions — skip to avoid `/` as div
    // (best-effort; fail-closed residual check catches leftovers)
    if (c === '(' || c === '[' || c === '{') {
      depth++
      i++
      continue
    }
    if (c === ')' || c === ']' || c === '}') {
      if (depth > 0) depth--
      i++
      continue
    }
    if (c === ';' && depth === 0) {
      const s = code.slice(start, i).trim()
      if (s) stmts.push(s)
      i++
      start = i
      continue
    }
    if (c === '\n' && depth === 0) {
      const before = code.slice(start, i)
      const trimmed = before.trim()
      if (trimmed && looksLikeStmtStart(i + 1) && !asiNoSplitAfter(trimmed)) {
        stmts.push(trimmed)
        start = i + 1
      }
      i++
      continue
    }
    i++
  }
  const tail = code.slice(start).trim()
  if (tail) stmts.push(tail)
  return stmts
}

/** True if a stmt still embeds another top-level-looking decl/control after a newline — splitter failed. */
export function stmtLooksMergedAsi(stmt) {
  return /\n\s*(?:const|let|var|function|async\s+function|class|if|for|while|switch|try|return|throw|export|import)\b/.test(
    String(stmt || ''),
  )
}


/** Pure literal RHS (no calls) — uni may omit unused ones entirely. */
export function isPureLiteralExpr(rhs) {
  const t = String(rhs || '').trim()
  if (!t) return false
  if (t === 'true' || t === 'false' || t === 'null' || t === 'undefined') return true
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(t)) return true
  if (/^(['"])(?:\\.|[^\\])*?\1$/.test(t)) return true
  return false
}

/** Dead-binding RHS with no calls/new/assignment → safe to drop entirely (R3). */
function isSideEffectFreeExpr(rhs) {
  const t = String(rhs || '').trim()
  if (!t) return false
  if (isPureLiteralExpr(t)) return true
  // reject anything that may run code
  if (/\b(new|await|yield|delete|void|typeof)\b/.test(t)) return false
  if (/[!=<>]=|[+]{2}|[-]{2}/.test(t)) return false
  if (/[`]/.test(t)) return false // template literals may embed calls
  if (/\(/.test(t)) return false // any call
  if (/=/.test(t)) return false
  // allow idents, member chains, binary arithmetic/logic on those
  if (/^[A-Za-z_$][\w$]*(?:\s*\.[A-Za-z_$][\w$]*)*(?:\s*[+\-*/%&|^?:<>]+\s*[A-Za-z_$0-9.\s]*)*$/.test(t)) {
    return true
  }
  // simple binary of literals/idents
  if (/^[A-Za-z_$0-9.\s+\-*/%()]+$/.test(t) && !/\(/.test(t)) return true
  return false
}

/**
 * Uni-like partial DCE + multi-line setup stmt format (Measured F8a + R3).
 * - Iterative liveness from render/return; dead pure literals fully dropped;
 *   dead impure keep bare RHS; live keep `const name = rhs`.
 * - Statements separated by `;\n` with 4-space indent (matches uni warm).
 */

/** Residues that must not be written into mp-weixin page JS (deep-messy harden). */
export function detectForbiddenSetupResidues(code) {
  const s = String(code || '')
  const hits = []
  if (/\bexport\s+(default\b|async\s+function\b|function\b|const\b|let\b|var\b|class\b|{)/.test(s)) {
    hits.push('export')
  }
  if (/\b(defineProps|defineEmits|defineExpose|withDefaults|defineOptions|defineSlots)\b/.test(s)) {
    hits.push('vue-macro')
  }
  if (/\benum\s+[A-Za-z_$]/.test(s)) hits.push('ts-enum')
  if (/\bimport\s*\(/.test(s)) hits.push('dynamic-import')
  // TypeScript `as` assertions: ) as T | "x" as T | 1 as T | as const
  if (
    /\)\s*as\s+[A-Za-z_$]/.test(s) ||
    /['"][^'"]*['"]\s*as\s+[A-Za-z_$]/.test(s) ||
    /\d\s+as\s+[A-Za-z_$]/.test(s) ||
    /\bas\s+const\b/.test(s)
  ) {
    hits.push('ts-as')
  }
  if (/\b(interface|type)\s+[A-Za-z_$]/.test(s)) hits.push('ts-type')
  // Private fields (#foo) — not #ifdef/#ifndef/#endif
  if (/#[A-Za-z_$]/.test(s.replace(/#(?:ifdef|ifndef|endif)\b/g, ''))) hits.push('private-field')
  if (/\bgetCurrentInstance\b/.test(s)) hits.push('getCurrentInstance')
  if (/\bprovide\s*\(/.test(s) || /\binject\s*\(/.test(s)) hits.push('provide-inject')
  // Side-effect import: import 'x' / import "x"
  if (/\bimport\s+['"]/.test(s)) hits.push('side-effect-import')
  // import type
  if (/\bimport\s+type\b/.test(s)) hits.push('import-type')
  return hits.length ? hits : null
}

export function formatSetupStmtsLikeUni(rewrittenBody, returnAndAfter = '') {
  let body = String(rewrittenBody || '').trim()
  if (!body) return ''
  body = body.replace(/\b(const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*/g, '$1 $2 = ')
  // Normalize prior `; ` joins into splittable form without inventing newlines yet
  body = body.replace(/\s*;\s*/g, '; ')
  body = body.replace(/;\s*$/, '')

  const stmts = splitTopLevelStatements(body)
  // Fail-closed residual: any stmt that still nests another decl/control after newline
  for (const raw of stmts) {
    if (stmtLooksMergedAsi(raw)) {
      const err = new Error('setup-asi-ambiguous')
      err.code = 'setup-asi-ambiguous'
      err.stmtHead = String(raw).slice(0, 120)
      throw err
    }
  }
  const declRe = /^(const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([\s\S]+)$/
  const parsed = stmts.map((raw) => {
    const stmt = raw.trim().replace(/;$/, '')
    const dm = declRe.exec(stmt)
    if (!dm) return { kind: 'bare', stmt, name: null, rhs: null }
    return {
      kind: 'decl',
      stmt,
      declKind: dm[1],
      name: dm[2],
      rhs: dm[3].trim().replace(/;$/, ''),
    }
  }).filter((p) => p.stmt)

  // Iterative liveness (R3 harden): start from render/return refs; a decl is live
  // only if its name is referenced by return or by another *live* decl/bare stmt.
  // Dead pure-literal decls drop; dead impure decls keep bare RHS (side effects).
  const live = new Set(renderReferencedNames(returnAndAfter || ''))
  let changed = true
  let guard = 0
  while (changed && guard++ < 64) {
    changed = false
    // Collect text of statements that stay in "named" form this round
    const keptTexts = []
    for (const p of parsed) {
      if (p.kind === 'bare') keptTexts.push(p.stmt)
      else if (live.has(p.name)) keptTexts.push(p.declKind + ' ' + p.name + ' = ' + p.rhs)
      else if (!isSideEffectFreeExpr(p.rhs)) keptTexts.push(p.rhs) // side-effect keep
    }
    const corpus = keptTexts.join('\n') + '\n' + (returnAndAfter || '')
    for (const p of parsed) {
      if (p.kind !== 'decl' || live.has(p.name)) continue
      const nameRe = new RegExp(`\\b${p.name.replace(/[$]/g, '\\$&')}\\b`)
      // referenced from return or from another kept stmt that is not solely this decl's rhs-drop
      if (nameRe.test(returnAndAfter || '')) {
        live.add(p.name)
        changed = true
        continue
      }
      for (const p2 of parsed) {
        if (p2 === p) continue
        let text = ''
        if (p2.kind === 'bare') text = p2.stmt
        else if (live.has(p2.name)) text = p2.rhs
        else continue // dead decl not yet contributing name refs via bare rhs names... 
        // Also scan bare-rhs of dead impure: they can keep callees live
        if (p2.kind === 'decl' && !live.has(p2.name) && !isPureLiteralExpr(p2.rhs)) {
          text = p2.rhs
        }
        if (text && nameRe.test(text)) {
          live.add(p.name)
          changed = true
          break
        }
      }
    }
  }

  const out = []
  for (const p of parsed) {
    if (p.kind === 'bare') {
      out.push(p.stmt)
      continue
    }
    if (live.has(p.name)) {
      out.push(`${p.declKind} ${p.name} = ${p.rhs}`)
    } else if (isSideEffectFreeExpr(p.rhs)) {
      continue // full DCE
    } else {
      out.push(p.rhs) // partial DCE
    }
  }
  return out.map((s) => '    ' + s + ';').join('\n')
}

/**
 * Setup-body splice with local-import → cold requireBinding rewrite.
 * opts: { pagePath, outDir } required for local-import mapping.
 */
export function patchColdPageJsSetupBody(coldJs, oldScript, newScript, opts = {}) {
  const pagePath = opts.pagePath || ''
  const outDir = opts.outDir || ''

  const localUsed = localImportsUsedInSetup(newScript)
  let rewriteInfo = { map: {}, mapped: [], unmapped: [] }
  if (localUsed.length) {
    if (!pagePath || !outDir) {
      return {
        ok: false,
        reason: 'local-import-in-setup',
        localUsed,
        hint: 'Need pagePath+outDir to map local imports onto cold requires',
      }
    }
    rewriteInfo = buildLocalRewriteMap(newScript, coldJs, pagePath, outDir)
    if (rewriteInfo.unmapped.length) {
      return {
        ok: false,
        reason: 'local-import-unmapped',
        localUsed,
        unmapped: rewriteInfo.unmapped,
        mapped: rewriteInfo.mapped,
        hint: 'Some setup locals could not be mapped to cold require/vendor forms',
      }
    }
  }

  const split = splitColdSetup(coldJs)
  if (!split) {
    return { ok: false, reason: 'setup-split-failed' }
  }

  const oldBody = stripImports(oldScript)
  const newBody = stripImports(newScript)
  if (!newBody) {
    return { ok: false, reason: 'empty-setup-body' }
  }
  if (oldBody === newBody) {
    return { ok: false, reason: 'setup-body-unchanged' }
  }

  // Rewrite local imports first (longer names), then vue/uni APIs
  let rewritten = rewriteIdents(newBody, rewriteInfo.map)
  rewritten = rewriteVueApisToCommonVendor(rewritten)
  rewritten = preferDoubleQuotes(rewritten)
  // Match uni cold emit spacing: `const label = common_vendor.ref(42);`
  rewritten = rewritten.replace(/\b(const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*/g, '$1 $2 = ')
  rewritten = rewritten.replace(/\s*;\s*/g, '; ')
  rewritten = rewritten.replace(/;\s*$/, '')
  // Ensure trailing semicolon style similar to cold
  rewritten = rewritten.trim()
  if (!/[;\}]$/.test(rewritten)) rewritten += ';'

  // Inline process.env.NODE_ENV in development (uni cold does this)
  rewritten = rewritten.replace(
    /process\.env\.NODE_ENV\s*===?\s*['"]development['"]/g,
    'true',
  )
  rewritten = rewritten.replace(
    /process\.env\.NODE_ENV\s*!==?\s*['"]production['"]/g,
    'true',
  )

  // HARDEN (deep-messy m3/m5–m9): refuse to splice TS/macros/export/dynamic-import
  // remnants that would produce illegal or runtime-broken page JS.
  const forbidden = detectForbiddenSetupResidues(rewritten)
  if (forbidden) {
    return {
      ok: false,
      reason: 'setup-forbidden-residue',
      forbidden,
      hint: 'TS/macro/export/dynamic-import residue — fail-closed to full uni rebuild',
    }
  }

  // assignedNames BEFORE partial DCE so we still catch removed render bindings
  const newAssigned = assignedNames(rewritten)
  const oldColdAssigned = assignedNames(split.setupStmts)
  const renderNames = renderReferencedNames(split.returnAndAfter)
  const missing = []
  for (const n of oldColdAssigned) {
    if (renderNames.has(n) && !newAssigned.has(n)) missing.push(n)
  }
  if (missing.length) {
    return {
      ok: false,
      reason: 'render-binding-removed',
      missing,
    }
  }

  // Uni-like partial DCE + multi-line format (drops unused setup-only binding names)
  let indented
  try {
    indented = formatSetupStmtsLikeUni(rewritten, split.returnAndAfter)
  } catch (e) {
    if (e && e.code === 'setup-asi-ambiguous') {
      return {
        ok: false,
        reason: 'setup-asi-ambiguous',
        stmtHead: e.stmtHead,
        hint: 'ASI/no-semicolon setup could not be split safely — fail-closed to full',
      }
    }
    throw e
  }

  const next = split.beforeSetupBody + '\n' + indented + '\n    ' + split.returnAndAfter.trimStart()

  return {
    ok: true,
    reason: localUsed.length ? 'setup-body-local-imports' : 'setup-body-splice',
    changes: [{ from: oldBody.slice(0, 80), to: newBody.slice(0, 80) }],
    beforeSha: sha(coldJs),
    afterSha: sha(next),
    code: next,
    newAssigned: [...newAssigned],
    emitClass: localUsed.length ? 'setup-body-local-imports' : 'setup-body',
    localMapped: rewriteInfo.mapped,
    localMappedCount: rewriteInfo.mapped.length,
  }
}

export function pageJsPath(outDir, pagePath) {
  return normalizePath(join(outDir, pagePath + '.js'))
}

/**
 * Emit only the dirty page JS into UNI_OUTPUT_DIR. External chunks stay on disk.
 * Cascade: surgical string-ref → named literal → plain const literal → call-arg → setup-body → fail.
 */
/**
 * Atomic replace: write temp beside target then rename (narrows mid-write window for DevTools/FS watchers).
 */
export function atomicWriteFile(file, contents) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = file + '.optc-tmp-' + process.pid + '-' + Date.now()
  writeFileSync(tmp, contents)
  renameSync(tmp, file)
}

export function emitOptCExtPage({
  outDir,
  pagePath,
  oldScript,
  newScript,
  dryRun = false,
}) {
  const t0 = performance.now()
  const file = pageJsPath(outDir, pagePath)
  if (!existsSync(file)) {
    return {
      ok: false,
      reason: 'cold-page-js-missing',
      file,
      timings: { totalMs: performance.now() - t0 },
    }
  }
  const coldJs = readFileSync(file, 'utf8')

  let patch = patchColdPageJs(coldJs, oldScript, newScript)
  let namedReason = null
  let plainReason = null
  let callArgReason = null
  if (!patch.ok) {
    const namedPatch = patchColdPageJsNamedLiterals(coldJs, oldScript, newScript)
    namedReason = namedPatch.reason
    if (namedPatch.ok) {
      patch = namedPatch
    }
  }
  if (!patch.ok) {
    const plainPatch = patchColdPageJsPlainLiterals(coldJs, oldScript, newScript)
    plainReason = plainPatch.reason
    if (plainPatch.ok) {
      patch = plainPatch
    }
  }
  if (!patch.ok) {
    const callPatch = patchColdPageJsCallArgs(coldJs, oldScript, newScript, {
      pagePath,
      outDir,
    })
    callArgReason = callPatch.reason
    if (callPatch.ok) {
      patch = callPatch
    }
  }
  let setupBodyReason = null
  let optionsReason = null
  let propsReason = null
  if (!patch.ok) {
    const setupPatch = patchColdPageJsSetupBody(coldJs, oldScript, newScript, {
      pagePath,
      outDir,
    })
    setupBodyReason = setupPatch.reason
    if (setupPatch.ok) {
      patch = setupPatch
    }
  }
  if (!patch.ok) {
    const optPatch = patchColdPageJsOptionsDataLiterals(coldJs, oldScript, newScript)
    optionsReason = optPatch.reason
    if (optPatch.ok) {
      patch = optPatch
    }
  }
  if (!patch.ok) {
    const propsPatch = patchColdPageJsPropsDefaults(coldJs, oldScript, newScript)
    propsReason = propsPatch.reason
    if (propsPatch.ok) {
      patch = propsPatch
    }
  }
  if (!patch.ok) {
    return {
      ok: false,
      reason: 'emit-cascade-failed',
      surgicalReason: patch.reason,
      namedLiteralReason: namedReason,
      plainLiteralReason: plainReason,
      callArgReason: callArgReason,
      setupBodyReason,
      optionsDataReason: optionsReason,
      propsDefaultReason: propsReason,
      optionsOnlySource: scriptLooksOptionsOnly(oldScript || newScript),
      hasVueMacros: scriptHasVueMacros(oldScript || '') || scriptHasVueMacros(newScript || ''),
      file,
      timings: { totalMs: performance.now() - t0 },
    }
  }

  const tPatch = performance.now()

  const reqs = [...patch.code.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map((m) => m[1])
  const externals = []
  for (const r of reqs) {
    const abs = normalizePath(join(dirname(file), r))
    externals.push({
      require: r,
      exists: existsSync(abs),
      bytes: existsSync(abs) && !statSync(abs).isDirectory() ? statSync(abs).size : 0,
    })
  }
  // HARDEN: refuse to write syntactically invalid page JS (TS/macro leaks, etc.).
  try {
    // eslint-disable-next-line no-new-func
    new Function(patch.code)
  } catch (err) {
    return {
      ok: false,
      reason: 'emit-syntax-invalid',
      syntaxError: String(err && err.message ? err.message : err),
      file,
      beforeSha: patch.beforeSha,
      afterSha: patch.afterSha,
      emitClass: patch.emitClass || patch.reason,
      changes: patch.changes,
      timings: { totalMs: performance.now() - t0, patchMs: tPatch - t0 },
    }
  }

  // Fail closed before write: missing cold chunks must not leave a page-only emit.
  if (!externals.every((e) => e.exists)) {
    return {
      ok: false,
      reason: 'externals-missing',
      file,
      beforeSha: patch.beforeSha,
      afterSha: patch.afterSha,
      requireCount: reqs.length,
      externals,
      allExternalsOnDisk: false,
      emitClass: patch.emitClass || patch.reason,
      changes: patch.changes,
      timings: { totalMs: performance.now() - t0, patchMs: tPatch - t0 },
    }
  }
  if (!dryRun) {
    atomicWriteFile(file, patch.code)
  }
  const tWrite = performance.now()

  const editTokens = []
  if (patch.changes) {
    for (const c of patch.changes) {
      if (c.to) editTokens.push(String(c.to))
    }
  }
  // Also detect probe-like tokens from new script literals
  const newRefs = extractSrcRefLiterals(newScript)
  for (const r of newRefs) if (r.value) editTokens.push(r.value)
  if (/unifastProbeNum\s*=\s*(\d+)/.test(newScript)) {
    editTokens.push('unifastProbeNum')
    editTokens.push(RegExp.$1)
  }
  // Non-literal probes: ref(true)/ref(false) flips, numeric markers
  const numProbe = newScript.match(/unifastLocalImportProbe\s*=\s*(\d+)/)
  if (numProbe) {
    editTokens.push('unifastLocalImportProbe')
    editTokens.push(numProbe[1])
  }
  if (/\bref\(\s*true\s*\)/.test(newScript) && !/\bref\(\s*true\s*\)/.test(oldScript)) {
    editTokens.push('true')
  }

  return {
    ok: true,
    reason: patch.reason,
    emitClass:
      patch.emitClass ||
      (patch.reason === 'ref-literal-patch'
        ? 'surgical'
        : patch.reason === 'named-literal-patch'
          ? 'surgical-named'
          : patch.reason === 'plain-literal-patch'
            ? 'surgical-plain-literal'
            : patch.reason === 'call-arg-patch'
              ? 'surgical-call-arg'
              : patch.reason),
    file,
    filesWritten: dryRun ? 0 : 1,
    generated: 1,
    changes: patch.changes,
    code: patch.code,
    beforeSha: patch.beforeSha,
    afterSha: patch.afterSha,
    pageEditPresent: editTokens.some((t) => t && patch.code.includes(t)),
    requireCount: reqs.length,
    externals,
    allExternalsOnDisk: externals.every((e) => e.exists),
    viteSkipped: true,
    localMappedCount: patch.localMappedCount || 0,
    localMapped: patch.localMapped || [],
    timings: {
      totalMs: tWrite - t0,
      patchMs: tPatch - t0,
      writeMs: tWrite - tPatch,
    },
  }
}

export default emitOptCExtPage
