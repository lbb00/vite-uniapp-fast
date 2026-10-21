// @ts-nocheck — pragmatic conversion from .mjs; public API typed in index.ts
/**
 * Options API + defineProps-default literal surgical patches for cold mp-weixin page JS.
 *
 * Measured cold shapes (fixture pkg-risk, Compiler 5.x / vite-plugin-uni):
 *   Options: `_sfc_main = { data() { return { title: "…", count: 1 }; }, methods: {…} }`
 *            + `_sfc_render` — NO setup(__props).
 *   Macros:  `_sfc_main = { props: { label: { type: String, default: "…" } }, setup(__props) {…} }`
 *
 * Only pure data()/props.default literals are FAST; methods/structure/types → fail-closed.
 */
import { createHash } from 'node:crypto'

function sha(s) {
  return createHash('sha256').update(s).digest('hex')
}

/** Match a JS literal at index: string / number / true / false / null */
export function matchLiteralAt(code, i) {
  const s = code.slice(i)
  if (s[0] === '"' || s[0] === "'") {
    const q = s[0]
    let j = 1
    while (j < s.length) {
      if (s[j] === '\\') {
        j += 2
        continue
      }
      if (s[j] === q) {
        return { litRaw: s.slice(0, j + 1), litNorm: s.slice(1, j), length: j + 1, kind: 'string' }
      }
      j++
    }
    return null
  }
  if (s.startsWith('true') && !/[A-Za-z0-9_$]/.test(s[4] || '')) {
    return { litRaw: 'true', litNorm: 'true', length: 4, kind: 'bool' }
  }
  if (s.startsWith('false') && !/[A-Za-z0-9_$]/.test(s[5] || '')) {
    return { litRaw: 'false', litNorm: 'false', length: 5, kind: 'bool' }
  }
  if (s.startsWith('null') && !/[A-Za-z0-9_$]/.test(s[4] || '')) {
    return { litRaw: 'null', litNorm: 'null', length: 4, kind: 'null' }
  }
  const num = s.match(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/)
  if (num) {
    return { litRaw: num[0], litNorm: num[0], length: num[0].length, kind: 'number' }
  }
  return null
}

/**
 * Extract `key: <literal>` pairs from Options `data() { return { … } }` in source script.
 */
export function extractSrcDataReturnLiterals(script) {
  const out = []
  // Find data() { return { ... } }
  const dataRe = /\bdata\s*\(\s*\)\s*\{/
  const dm = dataRe.exec(script)
  if (!dm) return out
  let i = dm.index + dm[0].length
  // Find return {
  const retIdx = script.indexOf('return', i)
  if (retIdx < 0) return out
  const braceOpen = script.indexOf('{', retIdx)
  if (braceOpen < 0) return out
  i = braceOpen + 1
  let depth = 1
  const bodyStart = i
  while (i < script.length && depth > 0) {
    const c = script[i]
    if (c === '"' || c === "'") {
      const lit = matchLiteralAt(script, i)
      if (!lit) break
      i += lit.length
      continue
    }
    if (c === '{') depth++
    else if (c === '}') depth--
    i++
  }
  const body = script.slice(bodyStart, i - 1)
  // Parse key: literal at top level of return object
  let j = 0
  while (j < body.length) {
    while (j < body.length && /[\s,]/.test(body[j])) j++
    const keyM = body.slice(j).match(/^([A-Za-z_$][\w$]*)\s*:/)
    if (!keyM) break
    const key = keyM[1]
    j += keyM[0].length
    while (j < body.length && /\s/.test(body[j])) j++
    const lit = matchLiteralAt(body, j)
    if (!lit) {
      // non-literal value — skip this key (nested/expr); fail-closed at patch if this key changed
      // advance to next comma/brace at depth 0
      let d = 0
      while (j < body.length) {
        const c = body[j]
        if (c === '"' || c === "'") {
          const L = matchLiteralAt(body, j)
          if (L) {
            j += L.length
            continue
          }
        }
        if (c === '{' || c === '(' || c === '[') d++
        else if (c === '}' || c === ')' || c === ']') d--
        else if (c === ',' && d === 0) {
          j++
          break
        }
        j++
      }
      out.push({ key, litRaw: null, litNorm: null, nonLiteral: true })
      continue
    }
    out.push({ key, litRaw: lit.litRaw, litNorm: lit.litNorm, kind: lit.kind, nonLiteral: false })
    j += lit.length
  }
  return out
}

/**
 * Extract defineProps default literals: `name: { … default: <lit> }` or `name: { default: <lit> }`.
 */
export function extractSrcPropsDefaultLiterals(script) {
  const out = []
  if (!/\bdefineProps\s*\(/.test(script) && !/\bprops\s*:/.test(script)) return out
  // Prefer defineProps({ ... })
  let start = -1
  const dp = /\bdefineProps\s*\(\s*\{/.exec(script)
  if (dp) start = dp.index + dp[0].length
  else {
    const pr = /\bprops\s*:\s*\{/.exec(script)
    if (pr) start = pr.index + pr[0].length
  }
  if (start < 0) return out
  let i = start
  let depth = 1
  const bodyStart = i
  while (i < script.length && depth > 0) {
    const c = script[i]
    if (c === '"' || c === "'") {
      const lit = matchLiteralAt(script, i)
      if (!lit) break
      i += lit.length
      continue
    }
    if (c === '{') depth++
    else if (c === '}') depth--
    i++
  }
  const body = script.slice(bodyStart, i - 1)
  // Find prop keys and their default: lit
  const propKeyRe = /([A-Za-z_$][\w$]*)\s*:\s*\{/g
  let m
  while ((m = propKeyRe.exec(body))) {
    const key = m[1]
    const objStart = m.index + m[0].length
    let k = objStart
    let d = 1
    while (k < body.length && d > 0) {
      const c = body[k]
      if (c === '"' || c === "'") {
        const lit = matchLiteralAt(body, k)
        if (!lit) break
        k += lit.length
        continue
      }
      if (c === '{') d++
      else if (c === '}') d--
      k++
    }
    const objBody = body.slice(objStart, k - 1)
    const defM = /\bdefault\s*:\s*/.exec(objBody)
    if (!defM) continue
    const lit = matchLiteralAt(objBody, defM.index + defM[0].length)
    if (!lit) {
      out.push({ key, litRaw: null, litNorm: null, nonLiteral: true })
      continue
    }
    out.push({
      key,
      litRaw: lit.litRaw,
      litNorm: lit.litNorm,
      kind: lit.kind,
      nonLiteral: false,
    })
  }
  return out
}

function extractColdObjectKeyLiterals(coldJs, objectHintRe) {
  /** Find first object matching hint, return Map key → {valueStart,valueEnd,litRaw} for literal props */
  const m = objectHintRe.exec(coldJs)
  if (!m) return null
  // Find opening { after match
  let i = m.index + m[0].length
  // For data() { return { — hint should include up to return {
  while (i < coldJs.length && coldJs[i] !== '{') i++
  if (coldJs[i] !== '{') return null
  i++
  let depth = 1
  const bodyStart = i
  while (i < coldJs.length && depth > 0) {
    const c = coldJs[i]
    if (c === '"' || c === "'") {
      const lit = matchLiteralAt(coldJs, i)
      if (!lit) return null
      i += lit.length
      continue
    }
    if (c === '{') depth++
    else if (c === '}') depth--
    i++
  }
  const absEnd = i - 1
  const pairs = new Map()
  let j = bodyStart
  while (j < absEnd) {
    while (j < absEnd && /[\s,]/.test(coldJs[j])) j++
    const keyM = coldJs.slice(j, absEnd).match(/^([A-Za-z_$][\w$]*)\s*:/)
    if (!keyM) break
    const key = keyM[1]
    j += keyM[0].length
    while (j < absEnd && /\s/.test(coldJs[j])) j++
    const lit = matchLiteralAt(coldJs, j)
    if (!lit) {
      let d = 0
      while (j < absEnd) {
        const c = coldJs[j]
        if (c === '"' || c === "'") {
          const L = matchLiteralAt(coldJs, j)
          if (L) {
            j += L.length
            continue
          }
        }
        if (c === '{' || c === '(' || c === '[') d++
        else if (c === '}' || c === ')' || c === ']') d--
        else if (c === ',' && d === 0) {
          j++
          break
        }
        j++
      }
      continue
    }
    pairs.set(key, {
      litRaw: lit.litRaw,
      litNorm: lit.litNorm,
      valueStart: j,
      valueEnd: j + lit.length,
    })
    j += lit.length
  }
  return pairs
}

/**
 * Patch Options data() return literals in cold page JS.
 */
export function patchColdPageJsOptionsDataLiterals(coldJs, oldScript, newScript) {
  if (/setup\s*\(\s*__props/.test(coldJs)) {
    return { ok: false, reason: 'options-data-not-options-shell' }
  }
  const oldL = extractSrcDataReturnLiterals(oldScript)
  const newL = extractSrcDataReturnLiterals(newScript)
  if (!oldL.length && !newL.length) {
    return { ok: false, reason: 'options-data-no-data-return' }
  }
  if (oldL.length !== newL.length) {
    return { ok: false, reason: 'options-data-key-arity-mismatch', oldCount: oldL.length, newCount: newL.length }
  }
  const changes = []
  for (let i = 0; i < oldL.length; i++) {
    if (oldL[i].key !== newL[i].key) {
      return { ok: false, reason: 'options-data-key-order-changed', from: oldL[i].key, to: newL[i].key }
    }
    if (oldL[i].nonLiteral || newL[i].nonLiteral) {
      if (oldL[i].litNorm !== newL[i].litNorm || oldL[i].nonLiteral !== newL[i].nonLiteral) {
        return { ok: false, reason: 'options-data-non-literal-change', key: oldL[i].key }
      }
      continue
    }
    if (oldL[i].litNorm !== newL[i].litNorm) {
      changes.push({
        key: oldL[i].key,
        from: oldL[i].litNorm,
        to: newL[i].litNorm,
        toRaw: newL[i].litRaw,
        fromRaw: oldL[i].litRaw,
      })
    }
  }
  // Also detect methods / other script surface change beyond data literals
  const stripData = (s) =>
    s
      .replace(/\bdata\s*\(\s*\)\s*\{[\s\S]*?\n\s*\}/, '')
      .replace(/\s+/g, ' ')
      .trim()
  // Rough: if methods body text changed (ignoring whitespace), fail-closed
  const oldMethods = (oldScript.match(/\bmethods\s*:\s*\{[\s\S]*\}\s*(?:,\s*)?\}?\s*$/) || [])[0] || ''
  const newMethods = (newScript.match(/\bmethods\s*:\s*\{[\s\S]*\}\s*(?:,\s*)?\}?\s*$/) || [])[0] || ''
  if (oldMethods.replace(/\s+/g, '') !== newMethods.replace(/\s+/g, '')) {
    // Allow if only difference is inside data — methods extract may be greedy; compare without data values
    const om = oldScript.replace(/\bdata\s*\(\s*\)\s*\{[\s\S]*?\n\s*\},?/, 'data(){},')
    const nm = newScript.replace(/\bdata\s*\(\s*\)\s*\{[\s\S]*?\n\s*\},?/, 'data(){},')
    if (om.replace(/\s+/g, '') !== nm.replace(/\s+/g, '')) {
      return { ok: false, reason: 'options-non-data-script-changed' }
    }
  }
  if (!changes.length) {
    return { ok: false, reason: 'options-data-no-literal-change' }
  }
  const coldPairs = extractColdObjectKeyLiterals(
    coldJs,
    /\bdata\s*\(\s*\)\s*\{\s*return\s*/,
  )
  if (!coldPairs) {
    return { ok: false, reason: 'options-data-cold-return-missing' }
  }
  let next = coldJs
  // Apply from end to start
  const ops = []
  for (const ch of changes) {
    const cold = coldPairs.get(ch.key)
    if (!cold) {
      return { ok: false, reason: 'options-data-cold-key-missing', key: ch.key }
    }
    if (cold.litNorm !== ch.from) {
      return {
        ok: false,
        reason: 'options-data-cold-value-mismatch',
        key: ch.key,
        expected: ch.from,
        actual: cold.litNorm,
      }
    }
    ops.push({ ...ch, valueStart: cold.valueStart, valueEnd: cold.valueEnd })
  }
  ops.sort((a, b) => b.valueStart - a.valueStart)
  for (const op of ops) {
    // Preserve cold quote style for strings
    let replacement = op.toRaw
    if (op.toRaw.startsWith("'") || op.toRaw.startsWith('"')) {
      const coldSlice = next.slice(op.valueStart, op.valueEnd)
      const q = coldSlice[0]
      if (q === '"' || q === "'") {
        replacement = q + op.to + q
      }
    }
    next = next.slice(0, op.valueStart) + replacement + next.slice(op.valueEnd)
  }
  return {
    ok: true,
    reason: 'options-data-literal-patch',
    emitClass: 'surgical-options-data',
    changes: changes.map((c) => ({ key: c.key, from: c.from, to: c.to })),
    beforeSha: sha(coldJs),
    afterSha: sha(next),
    code: next,
  }
}

/**
 * Patch props.default literals (defineProps) in cold page/component JS.
 */
export function patchColdPageJsPropsDefaults(coldJs, oldScript, newScript) {
  const oldL = extractSrcPropsDefaultLiterals(oldScript)
  const newL = extractSrcPropsDefaultLiterals(newScript)
  if (!oldL.length && !newL.length) {
    return { ok: false, reason: 'props-default-none' }
  }
  if (oldL.length !== newL.length) {
    return { ok: false, reason: 'props-default-arity-mismatch' }
  }
  const changes = []
  for (let i = 0; i < oldL.length; i++) {
    if (oldL[i].key !== newL[i].key) {
      return { ok: false, reason: 'props-default-key-order-changed' }
    }
    if (oldL[i].nonLiteral || newL[i].nonLiteral) {
      if (oldL[i].litNorm !== newL[i].litNorm) {
        return { ok: false, reason: 'props-default-non-literal-change', key: oldL[i].key }
      }
      continue
    }
    if (oldL[i].litNorm !== newL[i].litNorm) {
      changes.push({
        key: oldL[i].key,
        from: oldL[i].litNorm,
        to: newL[i].litNorm,
        toRaw: newL[i].litRaw,
      })
    }
  }
  // If anything other than defaults changed in defineProps / script, fail-closed
  const normProps = (s) =>
    s
      .replace(/\bdefault\s*:\s*(['"]).*?\1/g, 'default:""')
      .replace(/\bdefault\s*:\s*(true|false|null|-?\d+(?:\.\d+)?)/g, 'default:0')
      .replace(/\s+/g, '')
  if (normProps(oldScript) !== normProps(newScript)) {
    return { ok: false, reason: 'props-non-default-script-changed' }
  }
  if (!changes.length) {
    return { ok: false, reason: 'props-default-no-change' }
  }
  // Cold: props: { label: { type: String, default: "mac0" } }
  let next = coldJs
  const applied = []
  for (const ch of changes) {
    // Find default for this key in cold
    const keyRe = new RegExp(
      '\\b' + ch.key + '\\s*:\\s*\\{[^}]*?\\bdefault\\s*:\\s*',
    )
    const km = keyRe.exec(next)
    if (!km) {
      return { ok: false, reason: 'props-default-cold-key-missing', key: ch.key }
    }
    const litStart = km.index + km[0].length
    const lit = matchLiteralAt(next, litStart)
    if (!lit || lit.litNorm !== ch.from) {
      return {
        ok: false,
        reason: 'props-default-cold-mismatch',
        key: ch.key,
        expected: ch.from,
        actual: lit && lit.litNorm,
      }
    }
    let replacement = ch.toRaw
    if (lit.kind === 'string') {
      const q = next[litStart]
      replacement = q + ch.to + q
    }
    next = next.slice(0, litStart) + replacement + next.slice(litStart + lit.length)
    applied.push({ key: ch.key, from: ch.from, to: ch.to })
  }
  return {
    ok: true,
    reason: 'props-default-literal-patch',
    emitClass: 'surgical-props-default',
    changes: applied,
    beforeSha: sha(coldJs),
    afterSha: sha(next),
    code: next,
  }
}

/** Source looks like Options-only (no script setup). */
export function scriptLooksOptionsOnly(script) {
  if (/<script\s+setup\b/.test(script)) return false
  // script body passed in may already be stripped of tags
  if (/\bsetup\s*\(/.test(script) && /\bdefineProps\b|\bref\s*\(/.test(script)) return false
  return /\bexport\s+default\s*\{/.test(script) || /\bdata\s*\(\s*\)\s*\{/.test(script)
}

export function scriptHasVueMacros(script) {
  return /\b(defineProps|defineEmits|defineExpose|withDefaults|defineOptions|defineSlots)\b/.test(
    script,
  )
}
