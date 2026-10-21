'use strict';

var node_crypto = require('node:crypto');
var node_fs = require('node:fs');
var node_path = require('node:path');
var compilerSfc = require('@vue/compiler-sfc');
var node_perf_hooks = require('node:perf_hooks');

function sha$5(s) {
  return node_crypto.createHash("sha256").update(s).digest("hex");
}
function matchLiteralAt(code, i) {
  const s = code.slice(i);
  if (s[0] === '"' || s[0] === "'") {
    const q = s[0];
    let j = 1;
    while (j < s.length) {
      if (s[j] === "\\") {
        j += 2;
        continue;
      }
      if (s[j] === q) {
        return { litRaw: s.slice(0, j + 1), litNorm: s.slice(1, j), length: j + 1, kind: "string" };
      }
      j++;
    }
    return null;
  }
  if (s.startsWith("true") && !/[A-Za-z0-9_$]/.test(s[4] || "")) {
    return { litRaw: "true", litNorm: "true", length: 4, kind: "bool" };
  }
  if (s.startsWith("false") && !/[A-Za-z0-9_$]/.test(s[5] || "")) {
    return { litRaw: "false", litNorm: "false", length: 5, kind: "bool" };
  }
  if (s.startsWith("null") && !/[A-Za-z0-9_$]/.test(s[4] || "")) {
    return { litRaw: "null", litNorm: "null", length: 4, kind: "null" };
  }
  const num = s.match(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/);
  if (num) {
    return { litRaw: num[0], litNorm: num[0], length: num[0].length, kind: "number" };
  }
  return null;
}
function extractSrcDataReturnLiterals(script) {
  const out = [];
  const dataRe = /\bdata\s*\(\s*\)\s*\{/;
  const dm = dataRe.exec(script);
  if (!dm) return out;
  let i = dm.index + dm[0].length;
  const retIdx = script.indexOf("return", i);
  if (retIdx < 0) return out;
  const braceOpen = script.indexOf("{", retIdx);
  if (braceOpen < 0) return out;
  i = braceOpen + 1;
  let depth = 1;
  const bodyStart = i;
  while (i < script.length && depth > 0) {
    const c = script[i];
    if (c === '"' || c === "'") {
      const lit = matchLiteralAt(script, i);
      if (!lit) break;
      i += lit.length;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") depth--;
    i++;
  }
  const body = script.slice(bodyStart, i - 1);
  let j = 0;
  while (j < body.length) {
    while (j < body.length && /[\s,]/.test(body[j])) j++;
    const keyM = body.slice(j).match(/^([A-Za-z_$][\w$]*)\s*:/);
    if (!keyM) break;
    const key = keyM[1];
    j += keyM[0].length;
    while (j < body.length && /\s/.test(body[j])) j++;
    const lit = matchLiteralAt(body, j);
    if (!lit) {
      let d = 0;
      while (j < body.length) {
        const c = body[j];
        if (c === '"' || c === "'") {
          const L = matchLiteralAt(body, j);
          if (L) {
            j += L.length;
            continue;
          }
        }
        if (c === "{" || c === "(" || c === "[") d++;
        else if (c === "}" || c === ")" || c === "]") d--;
        else if (c === "," && d === 0) {
          j++;
          break;
        }
        j++;
      }
      out.push({ key, litRaw: null, litNorm: null, nonLiteral: true });
      continue;
    }
    out.push({ key, litRaw: lit.litRaw, litNorm: lit.litNorm, kind: lit.kind, nonLiteral: false });
    j += lit.length;
  }
  return out;
}
function extractSrcPropsDefaultLiterals(script) {
  const out = [];
  if (!/\bdefineProps\s*\(/.test(script) && !/\bprops\s*:/.test(script)) return out;
  let start = -1;
  const dp = /\bdefineProps\s*\(\s*\{/.exec(script);
  if (dp) start = dp.index + dp[0].length;
  else {
    const pr = /\bprops\s*:\s*\{/.exec(script);
    if (pr) start = pr.index + pr[0].length;
  }
  if (start < 0) return out;
  let i = start;
  let depth = 1;
  const bodyStart = i;
  while (i < script.length && depth > 0) {
    const c = script[i];
    if (c === '"' || c === "'") {
      const lit = matchLiteralAt(script, i);
      if (!lit) break;
      i += lit.length;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") depth--;
    i++;
  }
  const body = script.slice(bodyStart, i - 1);
  const propKeyRe = /([A-Za-z_$][\w$]*)\s*:\s*\{/g;
  let m;
  while (m = propKeyRe.exec(body)) {
    const key = m[1];
    const objStart = m.index + m[0].length;
    let k = objStart;
    let d = 1;
    while (k < body.length && d > 0) {
      const c = body[k];
      if (c === '"' || c === "'") {
        const lit2 = matchLiteralAt(body, k);
        if (!lit2) break;
        k += lit2.length;
        continue;
      }
      if (c === "{") d++;
      else if (c === "}") d--;
      k++;
    }
    const objBody = body.slice(objStart, k - 1);
    const defM = /\bdefault\s*:\s*/.exec(objBody);
    if (!defM) continue;
    const lit = matchLiteralAt(objBody, defM.index + defM[0].length);
    if (!lit) {
      out.push({ key, litRaw: null, litNorm: null, nonLiteral: true });
      continue;
    }
    out.push({
      key,
      litRaw: lit.litRaw,
      litNorm: lit.litNorm,
      kind: lit.kind,
      nonLiteral: false
    });
  }
  return out;
}
function extractColdObjectKeyLiterals(coldJs, objectHintRe) {
  const m = objectHintRe.exec(coldJs);
  if (!m) return null;
  let i = m.index + m[0].length;
  while (i < coldJs.length && coldJs[i] !== "{") i++;
  if (coldJs[i] !== "{") return null;
  i++;
  let depth = 1;
  const bodyStart = i;
  while (i < coldJs.length && depth > 0) {
    const c = coldJs[i];
    if (c === '"' || c === "'") {
      const lit = matchLiteralAt(coldJs, i);
      if (!lit) return null;
      i += lit.length;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") depth--;
    i++;
  }
  const absEnd = i - 1;
  const pairs = /* @__PURE__ */ new Map();
  let j = bodyStart;
  while (j < absEnd) {
    while (j < absEnd && /[\s,]/.test(coldJs[j])) j++;
    const keyM = coldJs.slice(j, absEnd).match(/^([A-Za-z_$][\w$]*)\s*:/);
    if (!keyM) break;
    const key = keyM[1];
    j += keyM[0].length;
    while (j < absEnd && /\s/.test(coldJs[j])) j++;
    const lit = matchLiteralAt(coldJs, j);
    if (!lit) {
      let d = 0;
      while (j < absEnd) {
        const c = coldJs[j];
        if (c === '"' || c === "'") {
          const L = matchLiteralAt(coldJs, j);
          if (L) {
            j += L.length;
            continue;
          }
        }
        if (c === "{" || c === "(" || c === "[") d++;
        else if (c === "}" || c === ")" || c === "]") d--;
        else if (c === "," && d === 0) {
          j++;
          break;
        }
        j++;
      }
      continue;
    }
    pairs.set(key, {
      litRaw: lit.litRaw,
      litNorm: lit.litNorm,
      valueStart: j,
      valueEnd: j + lit.length
    });
    j += lit.length;
  }
  return pairs;
}
function patchColdPageJsOptionsDataLiterals(coldJs, oldScript, newScript) {
  if (/setup\s*\(\s*__props/.test(coldJs)) {
    return { ok: false, reason: "options-data-not-options-shell" };
  }
  const oldL = extractSrcDataReturnLiterals(oldScript);
  const newL = extractSrcDataReturnLiterals(newScript);
  if (!oldL.length && !newL.length) {
    return { ok: false, reason: "options-data-no-data-return" };
  }
  if (oldL.length !== newL.length) {
    return { ok: false, reason: "options-data-key-arity-mismatch", oldCount: oldL.length, newCount: newL.length };
  }
  const changes = [];
  for (let i = 0; i < oldL.length; i++) {
    if (oldL[i].key !== newL[i].key) {
      return { ok: false, reason: "options-data-key-order-changed", from: oldL[i].key, to: newL[i].key };
    }
    if (oldL[i].nonLiteral || newL[i].nonLiteral) {
      if (oldL[i].litNorm !== newL[i].litNorm || oldL[i].nonLiteral !== newL[i].nonLiteral) {
        return { ok: false, reason: "options-data-non-literal-change", key: oldL[i].key };
      }
      continue;
    }
    if (oldL[i].litNorm !== newL[i].litNorm) {
      changes.push({
        key: oldL[i].key,
        from: oldL[i].litNorm,
        to: newL[i].litNorm,
        toRaw: newL[i].litRaw,
        fromRaw: oldL[i].litRaw
      });
    }
  }
  const oldMethods = (oldScript.match(/\bmethods\s*:\s*\{[\s\S]*\}\s*(?:,\s*)?\}?\s*$/) || [])[0] || "";
  const newMethods = (newScript.match(/\bmethods\s*:\s*\{[\s\S]*\}\s*(?:,\s*)?\}?\s*$/) || [])[0] || "";
  if (oldMethods.replace(/\s+/g, "") !== newMethods.replace(/\s+/g, "")) {
    const om = oldScript.replace(/\bdata\s*\(\s*\)\s*\{[\s\S]*?\n\s*\},?/, "data(){},");
    const nm = newScript.replace(/\bdata\s*\(\s*\)\s*\{[\s\S]*?\n\s*\},?/, "data(){},");
    if (om.replace(/\s+/g, "") !== nm.replace(/\s+/g, "")) {
      return { ok: false, reason: "options-non-data-script-changed" };
    }
  }
  if (!changes.length) {
    return { ok: false, reason: "options-data-no-literal-change" };
  }
  const coldPairs = extractColdObjectKeyLiterals(
    coldJs,
    /\bdata\s*\(\s*\)\s*\{\s*return\s*/
  );
  if (!coldPairs) {
    return { ok: false, reason: "options-data-cold-return-missing" };
  }
  let next = coldJs;
  const ops = [];
  for (const ch of changes) {
    const cold = coldPairs.get(ch.key);
    if (!cold) {
      return { ok: false, reason: "options-data-cold-key-missing", key: ch.key };
    }
    if (cold.litNorm !== ch.from) {
      return {
        ok: false,
        reason: "options-data-cold-value-mismatch",
        key: ch.key,
        expected: ch.from,
        actual: cold.litNorm
      };
    }
    ops.push({ ...ch, valueStart: cold.valueStart, valueEnd: cold.valueEnd });
  }
  ops.sort((a, b) => b.valueStart - a.valueStart);
  for (const op of ops) {
    let replacement = op.toRaw;
    if (op.toRaw.startsWith("'") || op.toRaw.startsWith('"')) {
      const coldSlice = next.slice(op.valueStart, op.valueEnd);
      const q = coldSlice[0];
      if (q === '"' || q === "'") {
        replacement = q + op.to + q;
      }
    }
    next = next.slice(0, op.valueStart) + replacement + next.slice(op.valueEnd);
  }
  return {
    ok: true,
    reason: "options-data-literal-patch",
    emitClass: "surgical-options-data",
    changes: changes.map((c) => ({ key: c.key, from: c.from, to: c.to })),
    beforeSha: sha$5(coldJs),
    afterSha: sha$5(next),
    code: next
  };
}
function patchColdPageJsPropsDefaults(coldJs, oldScript, newScript) {
  const oldL = extractSrcPropsDefaultLiterals(oldScript);
  const newL = extractSrcPropsDefaultLiterals(newScript);
  if (!oldL.length && !newL.length) {
    return { ok: false, reason: "props-default-none" };
  }
  if (oldL.length !== newL.length) {
    return { ok: false, reason: "props-default-arity-mismatch" };
  }
  const changes = [];
  for (let i = 0; i < oldL.length; i++) {
    if (oldL[i].key !== newL[i].key) {
      return { ok: false, reason: "props-default-key-order-changed" };
    }
    if (oldL[i].nonLiteral || newL[i].nonLiteral) {
      if (oldL[i].litNorm !== newL[i].litNorm) {
        return { ok: false, reason: "props-default-non-literal-change", key: oldL[i].key };
      }
      continue;
    }
    if (oldL[i].litNorm !== newL[i].litNorm) {
      changes.push({
        key: oldL[i].key,
        from: oldL[i].litNorm,
        to: newL[i].litNorm,
        toRaw: newL[i].litRaw
      });
    }
  }
  const normProps = (s) => s.replace(/\bdefault\s*:\s*(['"]).*?\1/g, 'default:""').replace(/\bdefault\s*:\s*(true|false|null|-?\d+(?:\.\d+)?)/g, "default:0").replace(/\s+/g, "");
  if (normProps(oldScript) !== normProps(newScript)) {
    return { ok: false, reason: "props-non-default-script-changed" };
  }
  if (!changes.length) {
    return { ok: false, reason: "props-default-no-change" };
  }
  let next = coldJs;
  const applied = [];
  for (const ch of changes) {
    const keyRe = new RegExp(
      "\\b" + ch.key + "\\s*:\\s*\\{[^}]*?\\bdefault\\s*:\\s*"
    );
    const km = keyRe.exec(next);
    if (!km) {
      return { ok: false, reason: "props-default-cold-key-missing", key: ch.key };
    }
    const litStart = km.index + km[0].length;
    const lit = matchLiteralAt(next, litStart);
    if (!lit || lit.litNorm !== ch.from) {
      return {
        ok: false,
        reason: "props-default-cold-mismatch",
        key: ch.key,
        expected: ch.from,
        actual: lit && lit.litNorm
      };
    }
    let replacement = ch.toRaw;
    if (lit.kind === "string") {
      const q = next[litStart];
      replacement = q + ch.to + q;
    }
    next = next.slice(0, litStart) + replacement + next.slice(litStart + lit.length);
    applied.push({ key: ch.key, from: ch.from, to: ch.to });
  }
  return {
    ok: true,
    reason: "props-default-literal-patch",
    emitClass: "surgical-props-default",
    changes: applied,
    beforeSha: sha$5(coldJs),
    afterSha: sha$5(next),
    code: next
  };
}
function scriptLooksOptionsOnly(script) {
  if (/<script\s+setup\b/.test(script)) return false;
  if (/\bsetup\s*\(/.test(script) && /\bdefineProps\b|\bref\s*\(/.test(script)) return false;
  return /\bexport\s+default\s*\{/.test(script) || /\bdata\s*\(\s*\)\s*\{/.test(script);
}
function scriptHasVueMacros(script) {
  return /\b(defineProps|defineEmits|defineExpose|withDefaults|defineOptions|defineSlots)\b/.test(
    script
  );
}

const SRC_REF_RE = /\bref\(\s*(['"])([^'"]*)\1\s*\)/g;
const COLD_REF_RE = /\b(?:[\w$]+\.)?ref\(\s*(['"])(.*?)\1\s*\)/g;
const VUE_APIS = [
  "ref",
  "computed",
  "reactive",
  "readonly",
  "shallowRef",
  "shallowReactive",
  "shallowReadonly",
  "toRef",
  "toRefs",
  "toValue",
  "unref",
  "isRef",
  "watch",
  "watchEffect",
  "watchPostEffect",
  "watchSyncEffect",
  "onBeforeMount",
  "onMounted",
  "onBeforeUpdate",
  "onUpdated",
  "onBeforeUnmount",
  "onUnmounted",
  "onActivated",
  "onDeactivated",
  "onErrorCaptured",
  "provide",
  "inject",
  "nextTick",
  "getCurrentInstance",
  "useAttrs",
  "useSlots",
  "useCssModule",
  "useCssVars"
];
const UNI_APIS = [
  "onLoad",
  "onShow",
  "onHide",
  "onUnload",
  "onPullDownRefresh",
  "onReachBottom",
  "onShareAppMessage",
  "onShareTimeline",
  "onAddToFavorites",
  "onPageScroll",
  "onResize",
  "onTabItemTap",
  "onNavigationBarButtonTap",
  "onBackPress",
  "onInit",
  "onReady",
  "onLaunch",
  "onError",
  "onPageNotFound",
  "onUnhandledRejection",
  "onThemeChange"
];
const VENDOR_APIS = /* @__PURE__ */ new Set([...VUE_APIS, ...UNI_APIS]);
function sha$4(s) {
  return node_crypto.createHash("sha256").update(s).digest("hex");
}
function normalizePath$4(p) {
  return p.replace(/\\/g, "/");
}
function extractSrcRefLiterals(script) {
  const out = [];
  const re = new RegExp(SRC_REF_RE.source, "g");
  let m;
  while (m = re.exec(script)) out.push({ quote: m[1], value: m[2], index: m.index });
  return out;
}
function extractColdRefLiterals(code) {
  const out = [];
  const re = new RegExp(COLD_REF_RE.source, "g");
  let m;
  while (m = re.exec(code)) {
    out.push({
      quote: m[1],
      value: m[2],
      index: m.index,
      full: m[0],
      valueStart: m.index + m[0].indexOf(m[1] + m[2] + m[1]) + 1,
      valueEnd: m.index + m[0].indexOf(m[1] + m[2] + m[1]) + 1 + m[2].length
    });
  }
  return out;
}
function patchColdPageJs(coldJs, oldScript, newScript) {
  const oldRefs = extractSrcRefLiterals(oldScript);
  const newRefs = extractSrcRefLiterals(newScript);
  if (oldRefs.length !== newRefs.length) {
    return {
      ok: false,
      reason: "ref-arity-mismatch",
      oldCount: oldRefs.length,
      newCount: newRefs.length
    };
  }
  const changes = [];
  for (let i = 0; i < oldRefs.length; i++) {
    if (oldRefs[i].value !== newRefs[i].value) {
      changes.push({ index: i, from: oldRefs[i].value, to: newRefs[i].value });
    }
  }
  if (!changes.length) {
    return { ok: false, reason: "no-ref-literal-change" };
  }
  const coldRefs = extractColdRefLiterals(coldJs);
  if (coldRefs.length < oldRefs.length) {
    return {
      ok: false,
      reason: "cold-ref-underflow",
      coldCount: coldRefs.length,
      srcCount: oldRefs.length
    };
  }
  let offset = 0;
  const aligned = [];
  for (let i = 0; i < oldRefs.length; i++) {
    let found = -1;
    for (let j = offset; j < coldRefs.length; j++) {
      if (coldRefs[j].value === oldRefs[i].value) {
        found = j;
        break;
      }
    }
    if (found < 0) {
      return {
        ok: false,
        reason: "cold-ref-value-missing",
        missing: oldRefs[i].value,
        atSrcIndex: i
      };
    }
    aligned.push(found);
    offset = found + 1;
  }
  let next = coldJs;
  const applied = [];
  const ops = changes.map((ch) => {
    const cr = coldRefs[aligned[ch.index]];
    return { ...ch, valueStart: cr.valueStart, valueEnd: cr.valueEnd, quote: cr.quote };
  }).sort((a, b) => b.valueStart - a.valueStart);
  for (const op of ops) {
    const slice = next.slice(op.valueStart, op.valueEnd);
    if (slice !== op.from) {
      return {
        ok: false,
        reason: "cold-slice-mismatch",
        expected: op.from,
        actual: slice
      };
    }
    next = next.slice(0, op.valueStart) + op.to + next.slice(op.valueEnd);
    applied.push({ from: op.from, to: op.to });
  }
  return {
    ok: true,
    reason: "ref-literal-patch",
    changes: applied.reverse(),
    beforeSha: sha$4(coldJs),
    afterSha: sha$4(next),
    code: next
  };
}
function matchRefLitAt(code, i) {
  const s = code.slice(i);
  if (s.startsWith("true") && !/[A-Za-z0-9_$]/.test(s[4] || "")) {
    return { litRaw: "true", litNorm: "true", length: 4 };
  }
  if (s.startsWith("false") && !/[A-Za-z0-9_$]/.test(s[5] || "")) {
    return { litRaw: "false", litNorm: "false", length: 5 };
  }
  if (s.startsWith("null") && !/[A-Za-z0-9_$]/.test(s[4] || "")) {
    return { litRaw: "null", litNorm: "null", length: 4 };
  }
  if (s.startsWith("undefined") && !/[A-Za-z0-9_$]/.test(s[9] || "")) {
    return { litRaw: "undefined", litNorm: "undefined", length: 9 };
  }
  const num = s.match(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/);
  if (num) {
    return { litRaw: num[0], litNorm: num[0], length: num[0].length };
  }
  const q = s[0];
  if (q === '"' || q === "'") {
    let j = 1;
    while (j < s.length) {
      if (s[j] === "\\") {
        j += 2;
        continue;
      }
      if (s[j] === q) {
        const litRaw = s.slice(0, j + 1);
        return {
          litRaw,
          litNorm: { type: "str", value: litRaw.slice(1, -1) },
          length: litRaw.length
        };
      }
      j++;
    }
  }
  return null;
}
function extractSrcNamedRefLiterals(script) {
  const out = [];
  const headRe = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*ref\(\s*/g;
  let m;
  while (m = headRe.exec(script)) {
    const lit = matchRefLitAt(script, m.index + m[0].length);
    if (!lit) continue;
    const after = m.index + m[0].length + lit.length;
    let k = after;
    while (k < script.length && /[ \t]/.test(script[k])) k++;
    if (script[k] !== ")") continue;
    const valueStart = m.index + m[0].length;
    out.push({
      name: m[1],
      litRaw: lit.litRaw,
      litNorm: lit.litNorm,
      index: m.index,
      valueStart,
      valueEnd: valueStart + lit.length
    });
  }
  return out;
}
function extractColdNamedRefLiterals(code) {
  const out = [];
  const headRe = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:[\w$]+\.)?ref\(\s*/g;
  let m;
  while (m = headRe.exec(code)) {
    const lit = matchRefLitAt(code, m.index + m[0].length);
    if (!lit) continue;
    let k = m.index + m[0].length + lit.length;
    while (k < code.length && /[ \t]/.test(code[k])) k++;
    if (code[k] !== ")") continue;
    const valueStart = m.index + m[0].length;
    out.push({
      name: m[1],
      litRaw: lit.litRaw,
      litNorm: lit.litNorm,
      index: m.index,
      valueStart,
      valueEnd: valueStart + lit.length,
      full: code.slice(m.index, k + 1)
    });
  }
  return out;
}
function normalizeRefLit(litRaw) {
  const hit = matchRefLitAt(String(litRaw).trim(), 0);
  if (hit && hit.length === String(litRaw).trim().length) return hit.litNorm;
  return String(litRaw).trim();
}
function refLitNormEqual(a, b) {
  if (a && typeof a === "object" && b && typeof b === "object") {
    return a.type === b.type && a.value === b.value;
  }
  return a === b;
}
function formatRefLitForCold(litNorm, preferQuote = '"') {
  if (litNorm && typeof litNorm === "object" && litNorm.type === "str") {
    const q = preferQuote === "'" ? "'" : '"';
    const inner = litNorm.value;
    if (q === '"') return `"${inner.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    return `'${inner.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
  }
  return String(litNorm);
}
function replaceSrcNamedRefLit(script, name, newLitRaw) {
  const headRe = new RegExp(
    String.raw`\b(?:const|let|var)\s+${name}\s*=\s*ref\(\s*`
  );
  const m = headRe.exec(script);
  if (!m) return null;
  const lit = matchRefLitAt(script, m.index + m[0].length);
  if (!lit) return null;
  const valueStart = m.index + m[0].length;
  const valueEnd = valueStart + lit.length;
  let k = valueEnd;
  while (k < script.length && /[ \t]/.test(script[k])) k++;
  if (script[k] !== ")") return null;
  return script.slice(0, valueStart) + newLitRaw + script.slice(valueEnd);
}
function patchColdPageJsNamedLiterals(coldJs, oldScript, newScript) {
  const oldNamed = extractSrcNamedRefLiterals(oldScript);
  const newNamed = extractSrcNamedRefLiterals(newScript);
  if (!oldNamed.length && !newNamed.length) {
    return { ok: false, reason: "no-named-ref-literals" };
  }
  const oldBy = new Map(oldNamed.map((x) => [x.name, x]));
  const newBy = new Map(newNamed.map((x) => [x.name, x]));
  if (oldBy.size !== oldNamed.length || newBy.size !== newNamed.length) {
    return { ok: false, reason: "named-ref-duplicate-binding" };
  }
  if (oldBy.size !== newBy.size) {
    return {
      ok: false,
      reason: "named-ref-arity-mismatch",
      oldCount: oldBy.size,
      newCount: newBy.size
    };
  }
  const changes = [];
  for (const [name, ov] of oldBy) {
    const nv = newBy.get(name);
    if (!nv) {
      return { ok: false, reason: "named-ref-removed", name };
    }
    if (!refLitNormEqual(ov.litNorm, nv.litNorm)) {
      changes.push({
        name,
        from: ov.litRaw,
        to: nv.litRaw,
        fromNorm: ov.litNorm,
        toNorm: nv.litNorm
      });
    }
  }
  for (const name of newBy.keys()) {
    if (!oldBy.has(name)) {
      return { ok: false, reason: "named-ref-added", name };
    }
  }
  if (!changes.length) {
    return { ok: false, reason: "no-named-literal-change" };
  }
  let projected = oldScript;
  for (const ch of changes) {
    const next2 = replaceSrcNamedRefLit(projected, ch.name, ch.to);
    if (next2 == null) {
      return { ok: false, reason: "src-named-replace-failed", name: ch.name };
    }
    projected = next2;
  }
  if (stripImports(projected) !== stripImports(newScript)) {
    return {
      ok: false,
      reason: "named-literal-incomplete-diff",
      changeCount: changes.length,
      hint: "Script differs beyond named ref(literal) flips \u2014 use setup-body or full rebuild"
    };
  }
  const coldNamed = extractColdNamedRefLiterals(coldJs);
  const coldBy = /* @__PURE__ */ new Map();
  for (const c of coldNamed) {
    if (!coldBy.has(c.name)) coldBy.set(c.name, c);
  }
  const ops = [];
  for (const ch of changes) {
    const cr = coldBy.get(ch.name);
    if (!cr) {
      return {
        ok: false,
        reason: "cold-named-ref-missing",
        name: ch.name,
        hint: "Binding may have been DCE\u2019d in cold emit"
      };
    }
    if (!refLitNormEqual(cr.litNorm, ch.fromNorm)) {
      return {
        ok: false,
        reason: "cold-named-lit-mismatch",
        name: ch.name,
        expected: ch.from,
        actual: cr.litRaw
      };
    }
    const preferQuote = typeof ch.toNorm === "object" && ch.toNorm.type === "str" ? cr.litRaw[0] === "'" || cr.litRaw[0] === '"' ? cr.litRaw[0] : '"' : '"';
    const replacement = formatRefLitForCold(ch.toNorm, preferQuote);
    ops.push({
      name: ch.name,
      from: ch.from,
      to: ch.to,
      valueStart: cr.valueStart,
      valueEnd: cr.valueEnd,
      replacement
    });
  }
  let next = coldJs;
  ops.sort((a, b) => b.valueStart - a.valueStart);
  const applied = [];
  for (const op of ops) {
    const slice = next.slice(op.valueStart, op.valueEnd);
    const sliceNorm = normalizeRefLit(slice);
    const expectNorm = normalizeRefLit(op.from);
    if (!refLitNormEqual(sliceNorm, expectNorm) && slice !== op.from) {
      return {
        ok: false,
        reason: "cold-named-slice-mismatch",
        name: op.name,
        expected: op.from,
        actual: slice
      };
    }
    next = next.slice(0, op.valueStart) + op.replacement + next.slice(op.valueEnd);
    applied.push({ name: op.name, from: op.from, to: op.replacement });
  }
  return {
    ok: true,
    reason: "named-literal-patch",
    emitClass: "surgical-named",
    changes: applied.reverse(),
    beforeSha: sha$4(coldJs),
    afterSha: sha$4(next),
    code: next
  };
}
function stripImports(script) {
  let s = String(script);
  s = s.replace(/\bimport\s+[\s\S]*?\s+from\s+['"][^'"]+['"]\s*;?/g, "\n");
  s = s.replace(/\bimport\s+['"][^'"]+['"]\s*;?/g, "\n");
  return s.replace(/\n{2,}/g, "\n").trim();
}
function localImportsUsedInSetup(script) {
  const body = stripImports(script);
  const used = [];
  const re = /\bimport\s+(?:(\w+)|\{([^}]+)\}|\*\s+as\s+(\w+))\s+from\s+['"]([^'"]+)['"]/g;
  let m;
  while (m = re.exec(script)) {
    const spec = m[4];
    if (spec === "vue" || spec === "@dcloudio/uni-app" || spec.startsWith("vue/")) continue;
    const names = [];
    if (m[1]) names.push(m[1]);
    if (m[3]) names.push(m[3]);
    if (m[2]) {
      for (const part of m[2].split(",")) {
        const bit = part.trim();
        if (!bit) continue;
        const as = bit.split(/\s+as\s+/);
        names.push((as[1] || as[0]).trim());
      }
    }
    for (const name of names) {
      if (!name) continue;
      if (new RegExp(`\\b${name}\\b`).test(body)) {
        used.push({ name, spec });
      }
    }
  }
  return used;
}
function parseImportDecls(script) {
  const decls = [];
  const re = /\bimport\s+(?:(\w+)\s*,\s*)?(?:(\*\s+as\s+(\w+))|(\{([^}]*)\})|(\w+))\s+from\s+['"]([^'"]+)['"]|\bimport\s+['"]([^'"]+)['"]/g;
  let m;
  while (m = re.exec(script)) {
    const spec = m[7] || m[8];
    if (!spec) continue;
    if (m[8] && !m[7]) {
      decls.push({ kind: "side-effect", spec, local: null, imported: null });
      continue;
    }
    if (m[1]) {
      decls.push({ kind: "default", spec, local: m[1], imported: null });
    }
    if (m[3]) {
      decls.push({ kind: "namespace", spec, local: m[3], imported: null });
    } else if (m[5] != null) {
      for (const part of m[5].split(",")) {
        const bit = part.trim();
        if (!bit) continue;
        const as = bit.split(/\s+as\s+/);
        const imported = as[0].trim();
        const local = (as[1] || as[0]).trim();
        decls.push({ kind: "named", spec, local, imported });
      }
    } else if (m[6] && !m[1]) {
      decls.push({ kind: "default", spec, local: m[6], imported: null });
    }
  }
  return decls;
}
function parseColdRequires(coldJs) {
  const out = [];
  const re = /const\s+([A-Za-z_$][\w$]*)\s*=\s*require\(['"]([^'"]+)['"]\)/g;
  let m;
  while (m = re.exec(coldJs)) {
    out.push({ binding: m[1], rel: normalizePath$4(m[2]) });
  }
  return out;
}
function parseColdLazyComponents(coldJs) {
  const out = [];
  const re = /const\s+([A-Za-z_$][\w$]*)\s*=\s*\(\)\s*=>\s*['"]([^'"]+)['"]/g;
  let m;
  while (m = re.exec(coldJs)) {
    out.push({ binding: m[1], rel: normalizePath$4(m[2]) });
  }
  return out;
}
function readColdChunkExports(chunkAbs) {
  if (!node_fs.existsSync(chunkAbs) || node_fs.statSync(chunkAbs).isDirectory()) return [];
  const code = node_fs.readFileSync(chunkAbs, "utf8");
  const names = [];
  const re = /exports\.([A-Za-z_$][\w$]*)\s*=/g;
  let m;
  while (m = re.exec(code)) names.push(m[1]);
  return [...new Set(names)];
}
function specToCandidateKeys(spec, pagePath) {
  const keys = /* @__PURE__ */ new Set();
  let s = spec;
  if (s.startsWith("@/")) s = s.slice(2);
  else if (s.startsWith("./") || s.startsWith("../")) {
    const pageDir = pagePath.includes("/") ? pagePath.replace(/\/[^/]+$/, "") : "";
    s = normalizePath$4(node_path.join(pageDir, s));
  } else if (s.startsWith("@")) {
    keys.add(s);
    keys.add(s.replace(/^@[^/]+\//, ""));
    return [...keys];
  } else if (!s.includes("/")) {
    keys.add(s);
    return [...keys];
  }
  s = normalizePath$4(s).replace(/^\.\//, "");
  s = s.replace(/\.(vue|tsx|ts|jsx|mjs)$/i, "");
  keys.add(s);
  keys.add(s + ".js");
  keys.add(s.replace(/\/index$/, ""));
  keys.add(s + "/index");
  keys.add(s + "/index.js");
  if (s.endsWith(".js")) keys.add(s.slice(0, -3));
  return [...keys];
}
function matchRequireForSpec(spec, pagePath, requires) {
  const keys = specToCandidateKeys(spec, pagePath);
  for (const r of requires) {
    const pageDir = pagePath.includes("/") ? pagePath.replace(/\/[^/]+$/, "") : "";
    const absFromPage = normalizePath$4(node_path.normalize(node_path.join(pageDir, r.rel)));
    let cleaned = absFromPage;
    while (cleaned.startsWith("../")) cleaned = cleaned.slice(3);
    while (cleaned.startsWith("..")) cleaned = cleaned.slice(2);
    cleaned = cleaned.replace(/^\//, "");
    const candidates = [
      cleaned,
      cleaned.replace(/\.js$/, ""),
      cleaned.replace(/\/index\.js$/, ""),
      cleaned.replace(/\/index$/, ""),
      r.rel,
      r.rel.replace(/^\.\.\//, "").replace(/^\.\.\//, "")
    ];
    for (const c of candidates) {
      const cn = normalizePath$4(c).replace(/^\.\//, "");
      for (const k of keys) {
        if (cn === k || cn.endsWith("/" + k) || k.endsWith("/" + cn) || cn.replace(/\.js$/, "") === k) {
          return r;
        }
      }
    }
  }
  for (const r of requires) {
    r.rel.replace(/^\.\.\//g, "").replace(/^\.\//, "");
    const parts = r.rel.split("/");
    for (const p of parts) if (p === "..") ;
    const rest = parts.filter((p) => p !== ".." && p !== ".").join("/");
    for (const k of keys) {
      if (rest === k || rest === k + ".js" || rest.replace(/\.js$/, "") === k) return r;
      if (rest.endsWith("/" + k) || rest.endsWith("/" + k + ".js")) return r;
    }
  }
  return null;
}
function buildLocalRewriteMap(script, coldJs, pagePath, outDir) {
  const requires = parseColdRequires(coldJs);
  const lazys = parseColdLazyComponents(coldJs);
  const decls = parseImportDecls(script);
  const body = stripImports(script);
  const map = /* @__PURE__ */ Object.create(null);
  const mapped = [];
  const unmapped = [];
  for (const d of decls) {
    if (!d.local) continue;
    if (d.spec === "vue" || d.spec === "@dcloudio/uni-app" || d.spec && d.spec.startsWith("vue/")) {
      const exportName = d.imported || d.local;
      map[d.local] = `common_vendor.${exportName}`;
      mapped.push({ local: d.local, expr: map[d.local], via: "vendor-api", spec: d.spec });
    }
  }
  for (const d of decls) {
    if (!d.local) continue;
    if (d.spec === "vue" || d.spec === "@dcloudio/uni-app" || d.spec && d.spec.startsWith("vue/")) {
      continue;
    }
    if (!new RegExp(`\\b${d.local}\\b`).test(body)) {
      continue;
    }
    if (map[d.local]) continue;
    const lazyHit = lazys.find((l) => l.binding === d.local);
    if (lazyHit) {
      map[d.local] = d.local;
      mapped.push({ local: d.local, expr: d.local, via: "lazy-component", spec: d.spec });
      continue;
    }
    const req = matchRequireForSpec(d.spec, pagePath, requires);
    if (req) {
      if (d.kind === "named") {
        const chunkAbs = normalizePath$4(node_path.join(node_path.dirname(node_path.join(outDir, pagePath + ".js")), req.rel));
        const exports = readColdChunkExports(chunkAbs);
        if (exports.length && d.imported && !exports.includes(d.imported)) {
          unmapped.push({
            local: d.local,
            spec: d.spec,
            kind: d.kind,
            imported: d.imported,
            reason: "cold-chunk-export-missing",
            exportsSample: exports.slice(0, 8)
          });
          continue;
        }
        map[d.local] = `${req.binding}.${d.imported}`;
        mapped.push({ local: d.local, expr: map[d.local], via: "require-named", spec: d.spec });
        continue;
      }
      if (d.kind === "namespace") {
        map[d.local] = req.binding;
        mapped.push({ local: d.local, expr: map[d.local], via: "require-ns", spec: d.spec });
        continue;
      }
      if (d.kind === "default") {
        const chunkAbs = normalizePath$4(node_path.join(node_path.dirname(node_path.join(outDir, pagePath + ".js")), req.rel));
        const exports = readColdChunkExports(chunkAbs);
        let exportName = null;
        if (exports.includes(d.local)) exportName = d.local;
        else if (exports.length === 1) exportName = exports[0];
        else {
          const setupSplit = splitColdSetup(coldJs);
          const setup = setupSplit ? setupSplit.setupStmts : coldJs;
          const propRe = new RegExp(`\\b${req.binding}\\.([A-Za-z_$][\\w$]*)`, "g");
          const props = /* @__PURE__ */ new Set();
          let pm;
          while (pm = propRe.exec(setup)) props.add(pm[1]);
          if (props.size === 1) exportName = [...props][0];
          else if (props.has(d.local)) exportName = d.local;
          else if (exports.length) {
            for (const e of exports) {
              if (props.has(e)) {
                exportName = e;
                break;
              }
            }
          }
        }
        if (exportName) {
          map[d.local] = `${req.binding}.${exportName}`;
          mapped.push({
            local: d.local,
            expr: map[d.local],
            via: "require-default",
            spec: d.spec,
            exportName,
            exports
          });
          continue;
        }
      }
    }
    if (d.kind === "named") {
      const candidate = `common_vendor.${d.imported}`;
      if (coldJs.includes(candidate) || coldJs.includes(`common_vendor.${d.imported}`)) {
        map[d.local] = candidate;
        mapped.push({ local: d.local, expr: candidate, via: "vendor-fold-named", spec: d.spec });
        continue;
      }
    }
    if (d.kind === "default") {
      const candidate = `common_vendor.${d.local}`;
      if (coldJs.includes(candidate)) {
        map[d.local] = candidate;
        mapped.push({ local: d.local, expr: candidate, via: "vendor-fold-default", spec: d.spec });
        continue;
      }
    }
    unmapped.push({ local: d.local, spec: d.spec, kind: d.kind, imported: d.imported });
  }
  return { map, mapped, unmapped, requires, lazys };
}
function rewriteIdents(code, rewriteMap) {
  const names = Object.keys(rewriteMap).sort((a, b) => b.length - a.length);
  if (!names.length) return code;
  const nameSet = new Set(names);
  let out = "";
  let i = 0;
  const len = code.length;
  function isIdentStart(c) {
    return /[A-Za-z_$]/.test(c);
  }
  function isIdent(c) {
    return /[A-Za-z0-9_$]/.test(c);
  }
  while (i < len) {
    const c = code[i];
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      out += c;
      i++;
      while (i < len) {
        if (code[i] === "\\") {
          out += code[i] + (code[i + 1] || "");
          i += 2;
          continue;
        }
        out += code[i];
        if (code[i] === q) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === "/" && code[i + 1] === "/") {
      while (i < len && code[i] !== "\n") {
        out += code[i];
        i++;
      }
      continue;
    }
    if (c === "/" && code[i + 1] === "*") {
      out += "/*";
      i += 2;
      while (i < len && !(code[i] === "*" && code[i + 1] === "/")) {
        out += code[i];
        i++;
      }
      out += "*/";
      i += 2;
      continue;
    }
    if (isIdentStart(c)) {
      let j = i + 1;
      while (j < len && isIdent(code[j])) j++;
      const ident = code.slice(i, j);
      let k = i - 1;
      while (k >= 0 && /[ \t]/.test(code[k])) k--;
      const prev = k >= 0 ? code[k] : "";
      let n = j;
      while (n < len && /[ \t]/.test(code[n])) n++;
      const next = code[n];
      if (prev === ".") {
        out += ident;
        i = j;
        continue;
      }
      if (next === ":" && nameSet.has(ident)) {
        out += ident;
        i = j;
        continue;
      }
      if (nameSet.has(ident)) {
        out += rewriteMap[ident];
        i = j;
        continue;
      }
      out += ident;
      i = j;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}
function rewriteVueApisToCommonVendor(code) {
  let s = code;
  for (const api of VENDOR_APIS) {
    s = s.replace(new RegExp(`(?<!\\.)\\b${api}\\s*\\(`, "g"), `common_vendor.${api}(`);
  }
  return s;
}
function preferDoubleQuotes(code) {
  return code.replace(/(['"])((?:\\.|(?!\1).)*)\1/g, (all, q, inner) => {
    if (q === '"') return all;
    if (inner.includes('"') && !inner.includes("'")) return all;
    return `"${inner.replace(/"/g, '\\"')}"`;
  });
}
function splitColdSetup(coldJs) {
  const setupRe = /setup\s*\(\s*__props\s*(?:,\s*\{[^}]*\})?\s*\)\s*\{/;
  const m = setupRe.exec(coldJs);
  if (!m) return null;
  const bodyStart = m.index + m[0].length;
  let i = bodyStart;
  let depth = 0;
  let returnAt = -1;
  const len = coldJs.length;
  while (i < len) {
    const c = coldJs[i];
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      i++;
      while (i < len) {
        if (coldJs[i] === "\\") {
          i += 2;
          continue;
        }
        if (coldJs[i] === q) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === "/" && coldJs[i + 1] === "/") {
      i += 2;
      while (i < len && coldJs[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && coldJs[i + 1] === "*") {
      i += 2;
      while (i < len && !(coldJs[i] === "*" && coldJs[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (c === "{") {
      depth++;
      i++;
      continue;
    }
    if (c === "}") {
      if (depth === 0) {
        return null;
      }
      depth--;
      i++;
      continue;
    }
    if (depth === 0 && coldJs.startsWith("return", i) && /\breturn\s*\(/.test(coldJs.slice(i, i + 16))) {
      returnAt = i;
      break;
    }
    i++;
  }
  if (returnAt < 0) return null;
  return {
    beforeSetupBody: coldJs.slice(0, bodyStart),
    setupStmts: coldJs.slice(bodyStart, returnAt),
    returnAndAfter: coldJs.slice(returnAt),
    bodyStart,
    returnAt
  };
}
function assignedNames(stmts) {
  const names = /* @__PURE__ */ new Set();
  const re = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g;
  let m;
  while (m = re.exec(stmts)) names.add(m[1]);
  return names;
}
function renderReferencedNames(returnAndAfter) {
  const slice = returnAndAfter.slice(0, 8e3);
  const names = /* @__PURE__ */ new Set();
  const re = /\b([A-Za-z_$][\w$]*)\b/g;
  let m;
  while (m = re.exec(slice)) {
    const n = m[1];
    if (n === "return" || n === "_ctx" || n === "_cache" || n === "common_vendor" || n === "void" || n === "null" || n === "true" || n === "false" || n === "Math") {
      continue;
    }
    names.add(n);
  }
  return names;
}
function matchPlainLitAt(code, i) {
  return matchRefLitAt(code, i);
}
function extractSrcPlainConstLiterals(script) {
  const out = [];
  const headRe = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*/g;
  let m;
  while (m = headRe.exec(script)) {
    const afterEq = script.slice(m.index + m[0].length);
    if (/^ref\s*\(/.test(afterEq)) continue;
    if (/^(?:reactive|computed|shallowRef|readonly)\s*\(/.test(afterEq)) continue;
    const lit = matchPlainLitAt(script, m.index + m[0].length);
    if (!lit) continue;
    let k = m.index + m[0].length + lit.length;
    while (k < script.length && /[ \t]/.test(script[k])) k++;
    if (k < script.length && script[k] !== ";" && script[k] !== "\n" && script[k] !== "\r") {
      if (k < script.length) continue;
    }
    const valueStart = m.index + m[0].length;
    out.push({
      name: m[1],
      litRaw: lit.litRaw,
      litNorm: lit.litNorm,
      index: m.index,
      valueStart,
      valueEnd: valueStart + lit.length
    });
  }
  return out;
}
function extractColdPlainConstLiterals(code) {
  const out = [];
  const headRe = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*/g;
  let m;
  while (m = headRe.exec(code)) {
    const afterEq = code.slice(m.index + m[0].length);
    if (/^(?:[\w$]+\.)?ref\s*\(/.test(afterEq)) continue;
    if (/^require\s*\(/.test(afterEq)) continue;
    if (/^(?:reactive|computed|shallowRef|readonly)\s*\(/.test(afterEq)) continue;
    if (/^[({\[]/.test(afterEq)) continue;
    if (/^[A-Za-z_$][\w$.]*\s*\(/.test(afterEq)) continue;
    const lit = matchPlainLitAt(code, m.index + m[0].length);
    if (!lit) continue;
    let k = m.index + m[0].length + lit.length;
    while (k < code.length && /[ \t]/.test(code[k])) k++;
    if (k < code.length && code[k] !== ";" && code[k] !== "\n" && code[k] !== "\r" && code[k] !== ",") {
      continue;
    }
    const valueStart = m.index + m[0].length;
    out.push({
      name: m[1],
      litRaw: lit.litRaw,
      litNorm: lit.litNorm,
      index: m.index,
      valueStart,
      valueEnd: valueStart + lit.length
    });
  }
  return out;
}
function replaceSrcPlainConstLit(script, name, newLitRaw) {
  const headRe = new RegExp(
    String.raw`\b(?:const|let|var)\s+${name}\s*=\s*`
  );
  const m = headRe.exec(script);
  if (!m) return null;
  const afterEq = script.slice(m.index + m[0].length);
  if (/^ref\s*\(/.test(afterEq)) return null;
  const lit = matchPlainLitAt(script, m.index + m[0].length);
  if (!lit) return null;
  const valueStart = m.index + m[0].length;
  const valueEnd = valueStart + lit.length;
  return script.slice(0, valueStart) + newLitRaw + script.slice(valueEnd);
}
function patchColdPageJsPlainLiterals(coldJs, oldScript, newScript) {
  const oldPlain = extractSrcPlainConstLiterals(oldScript);
  const newPlain = extractSrcPlainConstLiterals(newScript);
  if (!oldPlain.length && !newPlain.length) {
    return { ok: false, reason: "no-plain-const-literals" };
  }
  const oldBy = new Map(oldPlain.map((x) => [x.name, x]));
  const newBy = new Map(newPlain.map((x) => [x.name, x]));
  if (oldBy.size !== oldPlain.length || newBy.size !== newPlain.length) {
    return { ok: false, reason: "plain-const-duplicate-binding" };
  }
  if (oldBy.size !== newBy.size) {
    return {
      ok: false,
      reason: "plain-const-arity-mismatch",
      oldCount: oldBy.size,
      newCount: newBy.size
    };
  }
  const changes = [];
  for (const [name, ov] of oldBy) {
    const nv = newBy.get(name);
    if (!nv) return { ok: false, reason: "plain-const-removed", name };
    if (!refLitNormEqual(ov.litNorm, nv.litNorm)) {
      changes.push({
        name,
        from: ov.litRaw,
        to: nv.litRaw,
        fromNorm: ov.litNorm,
        toNorm: nv.litNorm
      });
    }
  }
  for (const name of newBy.keys()) {
    if (!oldBy.has(name)) return { ok: false, reason: "plain-const-added", name };
  }
  if (!changes.length) {
    return { ok: false, reason: "no-plain-literal-change" };
  }
  let projected = oldScript;
  for (const ch of changes) {
    const next2 = replaceSrcPlainConstLit(projected, ch.name, ch.to);
    if (next2 == null) {
      return { ok: false, reason: "src-plain-replace-failed", name: ch.name };
    }
    projected = next2;
  }
  if (stripImports(projected) !== stripImports(newScript)) {
    return {
      ok: false,
      reason: "plain-literal-incomplete-diff",
      changeCount: changes.length,
      hint: "Script differs beyond plain const literal flips"
    };
  }
  const coldPlain = extractColdPlainConstLiterals(coldJs);
  const coldBy = /* @__PURE__ */ new Map();
  for (const c of coldPlain) {
    if (!coldBy.has(c.name)) coldBy.set(c.name, c);
  }
  const ops = [];
  for (const ch of changes) {
    const cr = coldBy.get(ch.name);
    if (!cr) {
      return {
        ok: false,
        reason: "cold-plain-const-missing",
        name: ch.name,
        hint: "Binding may have been DCE\u2019d or is not a plain literal in cold"
      };
    }
    if (!refLitNormEqual(cr.litNorm, ch.fromNorm)) {
      return {
        ok: false,
        reason: "cold-plain-lit-mismatch",
        name: ch.name,
        expected: ch.from,
        actual: cr.litRaw
      };
    }
    const preferQuote = typeof ch.toNorm === "object" && ch.toNorm.type === "str" ? cr.litRaw[0] === "'" || cr.litRaw[0] === '"' ? cr.litRaw[0] : '"' : '"';
    const replacement = formatRefLitForCold(ch.toNorm, preferQuote);
    ops.push({
      name: ch.name,
      from: ch.from,
      to: ch.to,
      valueStart: cr.valueStart,
      valueEnd: cr.valueEnd,
      replacement
    });
  }
  let next = coldJs;
  ops.sort((a, b) => b.valueStart - a.valueStart);
  const applied = [];
  for (const op of ops) {
    const slice = next.slice(op.valueStart, op.valueEnd);
    const sliceNorm = normalizeRefLit(slice);
    const expectNorm = normalizeRefLit(op.from);
    if (!refLitNormEqual(sliceNorm, expectNorm) && slice !== op.from) {
      return {
        ok: false,
        reason: "cold-plain-slice-mismatch",
        name: op.name,
        expected: op.from,
        actual: slice
      };
    }
    next = next.slice(0, op.valueStart) + op.replacement + next.slice(op.valueEnd);
    applied.push({ name: op.name, from: op.from, to: op.replacement });
  }
  return {
    ok: true,
    reason: "plain-literal-patch",
    emitClass: "surgical-plain-literal",
    changes: applied.reverse(),
    beforeSha: sha$4(coldJs),
    afterSha: sha$4(next),
    code: next
  };
}
function extractSrcLiteralCalls(script) {
  const body = stripImports(script);
  const out = [];
  const callRe = /\b([A-Za-z_$][\w$]*)\s*\(\s*/g;
  let m;
  while (m = callRe.exec(body)) {
    const callee = m[1];
    if (VENDOR_APIS.has(callee)) continue;
    if (callee === "ref" || callee === "require" || callee === "Component") continue;
    const argsStart = m.index + m[0].length;
    const args = [];
    let pos = argsStart;
    let aborted = false;
    if (body[pos] === ")") {
      continue;
    }
    while (pos < body.length) {
      while (pos < body.length && /[ \t\n\r]/.test(body[pos])) pos++;
      const lit = matchPlainLitAt(body, pos);
      if (!lit) {
        aborted = true;
        break;
      }
      args.push({
        litRaw: lit.litRaw,
        litNorm: lit.litNorm,
        valueStart: pos,
        valueEnd: pos + lit.length
      });
      pos += lit.length;
      while (pos < body.length && /[ \t\n\r]/.test(body[pos])) pos++;
      if (body[pos] === ",") {
        pos++;
        continue;
      }
      if (body[pos] === ")") break;
      aborted = true;
      break;
    }
    if (aborted || body[pos] !== ")") continue;
    out.push({
      callee,
      args,
      index: m.index,
      fullEnd: pos + 1,
      full: body.slice(m.index, pos + 1)
    });
  }
  return out;
}
function findColdMappedCalls(coldJs, coldExpr, arity) {
  const out = [];
  const esc = coldExpr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const headRe = new RegExp(esc + String.raw`\s*\(\s*`, "g");
  let m;
  while (m = headRe.exec(coldJs)) {
    const args = [];
    let pos = m.index + m[0].length;
    let aborted = false;
    if (coldJs[pos] === ")") {
      if (arity === 0) {
        out.push({ args: [], index: m.index, argsStart: pos, fullEnd: pos + 1 });
      }
      continue;
    }
    while (pos < coldJs.length) {
      while (pos < coldJs.length && /[ \t\n\r]/.test(coldJs[pos])) pos++;
      const lit = matchPlainLitAt(coldJs, pos);
      if (!lit) {
        aborted = true;
        break;
      }
      args.push({
        litRaw: lit.litRaw,
        litNorm: lit.litNorm,
        valueStart: pos,
        valueEnd: pos + lit.length
      });
      pos += lit.length;
      while (pos < coldJs.length && /[ \t\n\r]/.test(coldJs[pos])) pos++;
      if (coldJs[pos] === ",") {
        pos++;
        continue;
      }
      if (coldJs[pos] === ")") break;
      aborted = true;
      break;
    }
    if (aborted || coldJs[pos] !== ")") continue;
    if (args.length !== arity) continue;
    out.push({ args, index: m.index, argsStart: m.index + m[0].length, fullEnd: pos + 1 });
  }
  return out;
}
function replaceSrcCallArg(script, callee, argIndex, newLitRaw, occurrence = 0) {
  const callRe = new RegExp(String.raw`\b${callee}\s*\(\s*`, "g");
  let m;
  let seen = 0;
  while (m = callRe.exec(script)) {
    let pos = m.index + m[0].length;
    const args = [];
    let aborted = false;
    if (script[pos] === ")") continue;
    while (pos < script.length) {
      while (pos < script.length && /[ \t\n\r]/.test(script[pos])) pos++;
      const lit = matchPlainLitAt(script, pos);
      if (!lit) {
        aborted = true;
        break;
      }
      args.push({ valueStart: pos, valueEnd: pos + lit.length, litRaw: lit.litRaw });
      pos += lit.length;
      while (pos < script.length && /[ \t\n\r]/.test(script[pos])) pos++;
      if (script[pos] === ",") {
        pos++;
        continue;
      }
      if (script[pos] === ")") break;
      aborted = true;
      break;
    }
    if (aborted || script[pos] !== ")") continue;
    if (seen === occurrence) {
      if (argIndex >= args.length) return null;
      const a = args[argIndex];
      return script.slice(0, a.valueStart) + newLitRaw + script.slice(a.valueEnd);
    }
    seen++;
  }
  return null;
}
function patchColdPageJsCallArgs(coldJs, oldScript, newScript, opts = {}) {
  const pagePath = opts.pagePath || "";
  const outDir = opts.outDir || "";
  if (!pagePath || !outDir) {
    return { ok: false, reason: "call-arg-need-page-context" };
  }
  const oldCalls = extractSrcLiteralCalls(oldScript);
  const newCalls = extractSrcLiteralCalls(newScript);
  if (!oldCalls.length && !newCalls.length) {
    return { ok: false, reason: "no-literal-calls" };
  }
  const oldByCallee = /* @__PURE__ */ new Map();
  for (const c of oldCalls) {
    if (!oldByCallee.has(c.callee)) oldByCallee.set(c.callee, []);
    oldByCallee.get(c.callee).push(c);
  }
  const newByCallee = /* @__PURE__ */ new Map();
  for (const c of newCalls) {
    if (!newByCallee.has(c.callee)) newByCallee.set(c.callee, []);
    newByCallee.get(c.callee).push(c);
  }
  const rewriteInfo = buildLocalRewriteMap(newScript, coldJs, pagePath, outDir);
  const argChanges = [];
  for (const [callee, oList] of oldByCallee) {
    const nList = newByCallee.get(callee);
    if (!nList || nList.length !== oList.length) {
      return {
        ok: false,
        reason: "call-arg-arity-mismatch",
        callee,
        oldCount: oList.length,
        newCount: nList?.length || 0
      };
    }
    const coldExpr = rewriteInfo.map[callee];
    if (!coldExpr) {
      for (let i = 0; i < oList.length; i++) {
        for (let a = 0; a < oList[i].args.length; a++) {
          if (!refLitNormEqual(oList[i].args[a].litNorm, nList[i].args[a].litNorm)) {
            return {
              ok: false,
              reason: "call-arg-unmapped-callee",
              callee,
              hint: "Callee not in cold rewrite map"
            };
          }
        }
      }
      continue;
    }
    for (let i = 0; i < oList.length; i++) {
      if (oList[i].args.length !== nList[i].args.length) {
        return {
          ok: false,
          reason: "call-arg-count-mismatch",
          callee,
          occurrence: i
        };
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
            arity: oList[i].args.length
          });
        }
      }
    }
  }
  for (const callee of newByCallee.keys()) {
    if (!oldByCallee.has(callee)) {
      return { ok: false, reason: "call-arg-callee-added", callee };
    }
  }
  if (!argChanges.length) {
    return { ok: false, reason: "no-call-arg-change" };
  }
  let projected = oldScript;
  for (const ch of argChanges) {
    const next = replaceSrcCallArg(projected, ch.callee, ch.argIndex, ch.to, ch.occurrence);
    if (next == null) {
      return {
        ok: false,
        reason: "src-call-arg-replace-failed",
        callee: ch.callee,
        argIndex: ch.argIndex
      };
    }
    projected = next;
  }
  if (stripImports(projected) !== stripImports(newScript)) {
    return {
      ok: false,
      reason: "call-arg-incomplete-diff",
      changeCount: argChanges.length,
      hint: "Script differs beyond mapped call literal-arg flips \u2014 use setup-body or mid-path"
    };
  }
  const ops = [];
  for (const ch of argChanges) {
    const sites = findColdMappedCalls(coldJs, ch.coldExpr, ch.arity);
    if (sites.length <= ch.occurrence) {
      return {
        ok: false,
        reason: "cold-call-site-missing",
        callee: ch.callee,
        coldExpr: ch.coldExpr,
        occurrence: ch.occurrence,
        found: sites.length
      };
    }
    const site = sites[ch.occurrence];
    const arg = site.args[ch.argIndex];
    if (!arg) {
      return { ok: false, reason: "cold-call-arg-missing", callee: ch.callee };
    }
    if (!refLitNormEqual(arg.litNorm, ch.fromNorm)) {
      return {
        ok: false,
        reason: "cold-call-arg-mismatch",
        callee: ch.callee,
        expected: ch.from,
        actual: arg.litRaw
      };
    }
    const preferQuote = typeof ch.toNorm === "object" && ch.toNorm.type === "str" ? arg.litRaw[0] === "'" || arg.litRaw[0] === '"' ? arg.litRaw[0] : '"' : '"';
    const replacement = formatRefLitForCold(ch.toNorm, preferQuote);
    ops.push({
      callee: ch.callee,
      coldExpr: ch.coldExpr,
      argIndex: ch.argIndex,
      from: ch.from,
      to: ch.to,
      valueStart: arg.valueStart,
      valueEnd: arg.valueEnd,
      replacement
    });
  }
  let nextCode = coldJs;
  ops.sort((a, b) => b.valueStart - a.valueStart);
  const applied = [];
  for (const op of ops) {
    const slice = nextCode.slice(op.valueStart, op.valueEnd);
    const sliceNorm = normalizeRefLit(slice);
    const expectNorm = normalizeRefLit(op.from);
    if (!refLitNormEqual(sliceNorm, expectNorm) && slice !== op.from) {
      return {
        ok: false,
        reason: "cold-call-slice-mismatch",
        callee: op.callee,
        expected: op.from,
        actual: slice
      };
    }
    nextCode = nextCode.slice(0, op.valueStart) + op.replacement + nextCode.slice(op.valueEnd);
    applied.push({
      callee: op.callee,
      coldExpr: op.coldExpr,
      argIndex: op.argIndex,
      from: op.from,
      to: op.replacement
    });
  }
  return {
    ok: true,
    reason: "call-arg-patch",
    emitClass: "surgical-call-arg",
    changes: applied.reverse(),
    beforeSha: sha$4(coldJs),
    afterSha: sha$4(nextCode),
    code: nextCode,
    localMapped: rewriteInfo.mapped,
    localMappedCount: rewriteInfo.mapped.length
  };
}
function splitTopLevelStatements(code) {
  const stmts = [];
  let start = 0;
  let i = 0;
  const len = code.length;
  let depth = 0;
  const STMT_KW = /^(?:const|let|var|function|async\s+function|class|if|else|for|while|do|switch|try|catch|finally|throw|return|break|continue|debugger|import|export|void|with|await)\b/;
  function isIdentStart(ch) {
    return ch && /[A-Za-z_$]/.test(ch);
  }
  function looksLikeStmtStart(idx) {
    let j = idx;
    while (j < len && (code[j] === " " || code[j] === "	" || code[j] === "\r")) j++;
    if (j >= len) return false;
    if (code[j] === "/" && code[j + 1] === "/") {
      while (j < len && code[j] !== "\n") j++;
      return looksLikeStmtStart(j + 1);
    }
    if (code[j] === "/" && code[j + 1] === "*") {
      j += 2;
      while (j < len && !(code[j] === "*" && code[j + 1] === "/")) j++;
      return looksLikeStmtStart(j + 2);
    }
    const slice = code.slice(j, j + 24);
    if (STMT_KW.test(slice)) return true;
    if (isIdentStart(code[j])) return true;
    return false;
  }
  function asiNoSplitAfter(before) {
    const t = before.replace(/\s+$/, "");
    if (!t) return true;
    if (/[,.\\+\-*/%&|^?:=!<>~]$/.test(t)) return true;
    if (/\b(?:0[xXbB])?[0-9.]+e[+-]?$/i.test(t)) return true;
    if (/(?:^|[^$\w])(?:if|for|while|catch|switch|function|async\s+function)\s*\([^)]*\)$/.test(t)) return true;
    if (/(?:^|[^$\w])(?:else|do|try|finally)\s*$/.test(t)) return true;
    if (/(?:^|[^$\w])(?:else\s+if)\s*\([^)]*\)$/.test(t)) return true;
    if (/=>\s*$/.test(t)) return true;
    if (/(?:^|[^$\w])(?:return|throw|yield|break|continue)\s*$/.test(t)) return true;
    return false;
  }
  while (i < len) {
    const c = code[i];
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      i++;
      while (i < len) {
        if (code[i] === "\\") {
          i += 2;
          continue;
        }
        if (q === "`" && code[i] === "$" && code[i + 1] === "{") {
          i += 2;
          let td = 1;
          while (i < len && td > 0) {
            if (code[i] === "\\") {
              i += 2;
              continue;
            }
            if (code[i] === '"' || code[i] === "'") {
              const qq = code[i++];
              while (i < len) {
                if (code[i] === "\\") {
                  i += 2;
                  continue;
                }
                if (code[i] === qq) {
                  i++;
                  break;
                }
                i++;
              }
              continue;
            }
            if (code[i] === "{") td++;
            else if (code[i] === "}") td--;
            i++;
          }
          continue;
        }
        if (code[i] === q) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === "/" && code[i + 1] === "/") {
      i += 2;
      while (i < len && code[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && code[i + 1] === "*") {
      i += 2;
      while (i < len && !(code[i] === "*" && code[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") {
      depth++;
      i++;
      continue;
    }
    if (c === ")" || c === "]" || c === "}") {
      if (depth > 0) depth--;
      i++;
      continue;
    }
    if (c === ";" && depth === 0) {
      const s = code.slice(start, i).trim();
      if (s) stmts.push(s);
      i++;
      start = i;
      continue;
    }
    if (c === "\n" && depth === 0) {
      const before = code.slice(start, i);
      const trimmed = before.trim();
      if (trimmed && looksLikeStmtStart(i + 1) && !asiNoSplitAfter(trimmed)) {
        stmts.push(trimmed);
        start = i + 1;
      }
      i++;
      continue;
    }
    i++;
  }
  const tail = code.slice(start).trim();
  if (tail) stmts.push(tail);
  return stmts;
}
function stmtLooksMergedAsi(stmt) {
  return /\n\s*(?:const|let|var|function|async\s+function|class|if|for|while|switch|try|return|throw|export|import)\b/.test(
    String(stmt || "")
  );
}
function isPureLiteralExpr(rhs) {
  const t = String(rhs || "").trim();
  if (!t) return false;
  if (t === "true" || t === "false" || t === "null" || t === "undefined") return true;
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(t)) return true;
  if (/^(['"])(?:\\.|[^\\])*?\1$/.test(t)) return true;
  return false;
}
function isSideEffectFreeExpr(rhs) {
  const t = String(rhs || "").trim();
  if (!t) return false;
  if (isPureLiteralExpr(t)) return true;
  if (/\b(new|await|yield|delete|void|typeof)\b/.test(t)) return false;
  if (/[!=<>]=|[+]{2}|[-]{2}/.test(t)) return false;
  if (/[`]/.test(t)) return false;
  if (/\(/.test(t)) return false;
  if (/=/.test(t)) return false;
  if (/^[A-Za-z_$][\w$]*(?:\s*\.[A-Za-z_$][\w$]*)*(?:\s*[+\-*/%&|^?:<>]+\s*[A-Za-z_$0-9.\s]*)*$/.test(t)) {
    return true;
  }
  if (/^[A-Za-z_$0-9.\s+\-*/%()]+$/.test(t) && !/\(/.test(t)) return true;
  return false;
}
function detectForbiddenSetupResidues(code) {
  const s = String(code || "");
  const hits = [];
  if (/\bexport\s+(default\b|async\s+function\b|function\b|const\b|let\b|var\b|class\b|{)/.test(s)) {
    hits.push("export");
  }
  if (/\b(defineProps|defineEmits|defineExpose|withDefaults|defineOptions|defineSlots)\b/.test(s)) {
    hits.push("vue-macro");
  }
  if (/\benum\s+[A-Za-z_$]/.test(s)) hits.push("ts-enum");
  if (/\bimport\s*\(/.test(s)) hits.push("dynamic-import");
  if (/\)\s*as\s+[A-Za-z_$]/.test(s) || /['"][^'"]*['"]\s*as\s+[A-Za-z_$]/.test(s) || /\d\s+as\s+[A-Za-z_$]/.test(s) || /\bas\s+const\b/.test(s)) {
    hits.push("ts-as");
  }
  if (/\b(interface|type)\s+[A-Za-z_$]/.test(s)) hits.push("ts-type");
  if (/#[A-Za-z_$]/.test(s.replace(/#(?:ifdef|ifndef|endif)\b/g, ""))) hits.push("private-field");
  if (/\bgetCurrentInstance\b/.test(s)) hits.push("getCurrentInstance");
  if (/\bprovide\s*\(/.test(s) || /\binject\s*\(/.test(s)) hits.push("provide-inject");
  if (/\bimport\s+['"]/.test(s)) hits.push("side-effect-import");
  if (/\bimport\s+type\b/.test(s)) hits.push("import-type");
  return hits.length ? hits : null;
}
function formatSetupStmtsLikeUni(rewrittenBody, returnAndAfter = "") {
  let body = String(rewrittenBody || "").trim();
  if (!body) return "";
  body = body.replace(/\b(const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*/g, "$1 $2 = ");
  body = body.replace(/\s*;\s*/g, "; ");
  body = body.replace(/;\s*$/, "");
  const stmts = splitTopLevelStatements(body);
  for (const raw of stmts) {
    if (stmtLooksMergedAsi(raw)) {
      const err = new Error("setup-asi-ambiguous");
      err.code = "setup-asi-ambiguous";
      err.stmtHead = String(raw).slice(0, 120);
      throw err;
    }
  }
  const declRe = /^(const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([\s\S]+)$/;
  const parsed = stmts.map((raw) => {
    const stmt = raw.trim().replace(/;$/, "");
    const dm = declRe.exec(stmt);
    if (!dm) return { kind: "bare", stmt, name: null, rhs: null };
    return {
      kind: "decl",
      stmt,
      declKind: dm[1],
      name: dm[2],
      rhs: dm[3].trim().replace(/;$/, "")
    };
  }).filter((p) => p.stmt);
  const live = new Set(renderReferencedNames(returnAndAfter || ""));
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 64) {
    changed = false;
    const keptTexts = [];
    for (const p of parsed) {
      if (p.kind === "bare") keptTexts.push(p.stmt);
      else if (live.has(p.name)) keptTexts.push(p.declKind + " " + p.name + " = " + p.rhs);
      else if (!isSideEffectFreeExpr(p.rhs)) keptTexts.push(p.rhs);
    }
    for (const p of parsed) {
      if (p.kind !== "decl" || live.has(p.name)) continue;
      const nameRe = new RegExp(`\\b${p.name.replace(/[$]/g, "\\$&")}\\b`);
      if (nameRe.test(returnAndAfter || "")) {
        live.add(p.name);
        changed = true;
        continue;
      }
      for (const p2 of parsed) {
        if (p2 === p) continue;
        let text = "";
        if (p2.kind === "bare") text = p2.stmt;
        else if (live.has(p2.name)) text = p2.rhs;
        else continue;
        if (p2.kind === "decl" && !live.has(p2.name) && !isPureLiteralExpr(p2.rhs)) {
          text = p2.rhs;
        }
        if (text && nameRe.test(text)) {
          live.add(p.name);
          changed = true;
          break;
        }
      }
    }
  }
  const out = [];
  for (const p of parsed) {
    if (p.kind === "bare") {
      out.push(p.stmt);
      continue;
    }
    if (live.has(p.name)) {
      out.push(`${p.declKind} ${p.name} = ${p.rhs}`);
    } else if (isSideEffectFreeExpr(p.rhs)) {
      continue;
    } else {
      out.push(p.rhs);
    }
  }
  return out.map((s) => "    " + s + ";").join("\n");
}
function patchColdPageJsSetupBody(coldJs, oldScript, newScript, opts = {}) {
  const pagePath = opts.pagePath || "";
  const outDir = opts.outDir || "";
  const localUsed = localImportsUsedInSetup(newScript);
  let rewriteInfo = { map: {}, mapped: [], unmapped: [] };
  if (localUsed.length) {
    if (!pagePath || !outDir) {
      return {
        ok: false,
        reason: "local-import-in-setup",
        localUsed,
        hint: "Need pagePath+outDir to map local imports onto cold requires"
      };
    }
    rewriteInfo = buildLocalRewriteMap(newScript, coldJs, pagePath, outDir);
    if (rewriteInfo.unmapped.length) {
      return {
        ok: false,
        reason: "local-import-unmapped",
        localUsed,
        unmapped: rewriteInfo.unmapped,
        mapped: rewriteInfo.mapped,
        hint: "Some setup locals could not be mapped to cold require/vendor forms"
      };
    }
  }
  const split = splitColdSetup(coldJs);
  if (!split) {
    return { ok: false, reason: "setup-split-failed" };
  }
  const oldBody = stripImports(oldScript);
  const newBody = stripImports(newScript);
  if (!newBody) {
    return { ok: false, reason: "empty-setup-body" };
  }
  if (oldBody === newBody) {
    return { ok: false, reason: "setup-body-unchanged" };
  }
  let rewritten = rewriteIdents(newBody, rewriteInfo.map);
  rewritten = rewriteVueApisToCommonVendor(rewritten);
  rewritten = preferDoubleQuotes(rewritten);
  rewritten = rewritten.replace(/\b(const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*/g, "$1 $2 = ");
  rewritten = rewritten.replace(/\s*;\s*/g, "; ");
  rewritten = rewritten.replace(/;\s*$/, "");
  rewritten = rewritten.trim();
  if (!/[;\}]$/.test(rewritten)) rewritten += ";";
  rewritten = rewritten.replace(
    /process\.env\.NODE_ENV\s*===?\s*['"]development['"]/g,
    "true"
  );
  rewritten = rewritten.replace(
    /process\.env\.NODE_ENV\s*!==?\s*['"]production['"]/g,
    "true"
  );
  const forbidden = detectForbiddenSetupResidues(rewritten);
  if (forbidden) {
    return {
      ok: false,
      reason: "setup-forbidden-residue",
      forbidden,
      hint: "TS/macro/export/dynamic-import residue \u2014 fail-closed to full uni rebuild"
    };
  }
  const newAssigned = assignedNames(rewritten);
  const oldColdAssigned = assignedNames(split.setupStmts);
  const renderNames = renderReferencedNames(split.returnAndAfter);
  const missing = [];
  for (const n of oldColdAssigned) {
    if (renderNames.has(n) && !newAssigned.has(n)) missing.push(n);
  }
  if (missing.length) {
    return {
      ok: false,
      reason: "render-binding-removed",
      missing
    };
  }
  let indented;
  try {
    indented = formatSetupStmtsLikeUni(rewritten, split.returnAndAfter);
  } catch (e) {
    if (e && e.code === "setup-asi-ambiguous") {
      return {
        ok: false,
        reason: "setup-asi-ambiguous",
        stmtHead: e.stmtHead,
        hint: "ASI/no-semicolon setup could not be split safely \u2014 fail-closed to full"
      };
    }
    throw e;
  }
  const next = split.beforeSetupBody + "\n" + indented + "\n    " + split.returnAndAfter.trimStart();
  return {
    ok: true,
    reason: localUsed.length ? "setup-body-local-imports" : "setup-body-splice",
    changes: [{ from: oldBody.slice(0, 80), to: newBody.slice(0, 80) }],
    beforeSha: sha$4(coldJs),
    afterSha: sha$4(next),
    code: next,
    newAssigned: [...newAssigned],
    emitClass: localUsed.length ? "setup-body-local-imports" : "setup-body",
    localMapped: rewriteInfo.mapped,
    localMappedCount: rewriteInfo.mapped.length
  };
}
function pageJsPath(outDir, pagePath) {
  return normalizePath$4(node_path.join(outDir, pagePath + ".js"));
}
function atomicWriteFile(file, contents) {
  node_fs.mkdirSync(node_path.dirname(file), { recursive: true });
  const tmp = file + ".optc-tmp-" + process.pid + "-" + Date.now();
  node_fs.writeFileSync(tmp, contents);
  node_fs.renameSync(tmp, file);
}
function emitOptCExtPage({
  outDir,
  pagePath,
  oldScript,
  newScript,
  dryRun = false
}) {
  const t0 = performance.now();
  const file = pageJsPath(outDir, pagePath);
  if (!node_fs.existsSync(file)) {
    return {
      ok: false,
      reason: "cold-page-js-missing",
      file,
      timings: { totalMs: performance.now() - t0 }
    };
  }
  const coldJs = node_fs.readFileSync(file, "utf8");
  let patch = patchColdPageJs(coldJs, oldScript, newScript);
  let namedReason = null;
  let plainReason = null;
  let callArgReason = null;
  if (!patch.ok) {
    const namedPatch = patchColdPageJsNamedLiterals(coldJs, oldScript, newScript);
    namedReason = namedPatch.reason;
    if (namedPatch.ok) {
      patch = namedPatch;
    }
  }
  if (!patch.ok) {
    const plainPatch = patchColdPageJsPlainLiterals(coldJs, oldScript, newScript);
    plainReason = plainPatch.reason;
    if (plainPatch.ok) {
      patch = plainPatch;
    }
  }
  if (!patch.ok) {
    const callPatch = patchColdPageJsCallArgs(coldJs, oldScript, newScript, {
      pagePath,
      outDir
    });
    callArgReason = callPatch.reason;
    if (callPatch.ok) {
      patch = callPatch;
    }
  }
  let setupBodyReason = null;
  let optionsReason = null;
  let propsReason = null;
  if (!patch.ok) {
    const setupPatch = patchColdPageJsSetupBody(coldJs, oldScript, newScript, {
      pagePath,
      outDir
    });
    setupBodyReason = setupPatch.reason;
    if (setupPatch.ok) {
      patch = setupPatch;
    }
  }
  if (!patch.ok) {
    const optPatch = patchColdPageJsOptionsDataLiterals(coldJs, oldScript, newScript);
    optionsReason = optPatch.reason;
    if (optPatch.ok) {
      patch = optPatch;
    }
  }
  if (!patch.ok) {
    const propsPatch = patchColdPageJsPropsDefaults(coldJs, oldScript, newScript);
    propsReason = propsPatch.reason;
    if (propsPatch.ok) {
      patch = propsPatch;
    }
  }
  if (!patch.ok) {
    return {
      ok: false,
      reason: "emit-cascade-failed",
      surgicalReason: patch.reason,
      namedLiteralReason: namedReason,
      plainLiteralReason: plainReason,
      callArgReason,
      setupBodyReason,
      optionsDataReason: optionsReason,
      propsDefaultReason: propsReason,
      optionsOnlySource: scriptLooksOptionsOnly(oldScript || newScript),
      hasVueMacros: scriptHasVueMacros(oldScript || "") || scriptHasVueMacros(newScript || ""),
      file,
      timings: { totalMs: performance.now() - t0 }
    };
  }
  const tPatch = performance.now();
  const reqs = [...patch.code.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map((m) => m[1]);
  const externals = [];
  for (const r of reqs) {
    const abs = normalizePath$4(node_path.join(node_path.dirname(file), r));
    externals.push({
      require: r,
      exists: node_fs.existsSync(abs),
      bytes: node_fs.existsSync(abs) && !node_fs.statSync(abs).isDirectory() ? node_fs.statSync(abs).size : 0
    });
  }
  try {
    new Function(patch.code);
  } catch (err) {
    return {
      ok: false,
      reason: "emit-syntax-invalid",
      syntaxError: String(err && err.message ? err.message : err),
      file,
      beforeSha: patch.beforeSha,
      afterSha: patch.afterSha,
      emitClass: patch.emitClass || patch.reason,
      changes: patch.changes,
      timings: { totalMs: performance.now() - t0, patchMs: tPatch - t0 }
    };
  }
  if (!externals.every((e) => e.exists)) {
    return {
      ok: false,
      reason: "externals-missing",
      file,
      beforeSha: patch.beforeSha,
      afterSha: patch.afterSha,
      requireCount: reqs.length,
      externals,
      allExternalsOnDisk: false,
      emitClass: patch.emitClass || patch.reason,
      changes: patch.changes,
      timings: { totalMs: performance.now() - t0, patchMs: tPatch - t0 }
    };
  }
  if (!dryRun) {
    atomicWriteFile(file, patch.code);
  }
  const tWrite = performance.now();
  const editTokens = [];
  if (patch.changes) {
    for (const c of patch.changes) {
      if (c.to) editTokens.push(String(c.to));
    }
  }
  const newRefs = extractSrcRefLiterals(newScript);
  for (const r of newRefs) if (r.value) editTokens.push(r.value);
  if (/unifastProbeNum\s*=\s*(\d+)/.test(newScript)) {
    editTokens.push("unifastProbeNum");
    editTokens.push(RegExp.$1);
  }
  const numProbe = newScript.match(/unifastLocalImportProbe\s*=\s*(\d+)/);
  if (numProbe) {
    editTokens.push("unifastLocalImportProbe");
    editTokens.push(numProbe[1]);
  }
  if (/\bref\(\s*true\s*\)/.test(newScript) && !/\bref\(\s*true\s*\)/.test(oldScript)) {
    editTokens.push("true");
  }
  return {
    ok: true,
    reason: patch.reason,
    emitClass: patch.emitClass || (patch.reason === "ref-literal-patch" ? "surgical" : patch.reason === "named-literal-patch" ? "surgical-named" : patch.reason === "plain-literal-patch" ? "surgical-plain-literal" : patch.reason === "call-arg-patch" ? "surgical-call-arg" : patch.reason),
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
      writeMs: tWrite - tPatch
    }
  };
}

function sha$3(s) {
  return node_crypto.createHash("sha256").update(s).digest("hex");
}
function normalizePath$3(p) {
  return p.replace(/\\/g, "/");
}
function rewriteSetupBodyForCold(newScript, coldJs, pagePath, outDir) {
  const forbidden = detectForbiddenSetupResidues(String(newScript || "")) || [];
  if (forbidden.length) {
    return {
      ok: false,
      reason: "midpath-vue-macro-residue",
      forbidden,
      hint: "defineProps/macros must not be midpath-spliced into setup"
    };
  }
  const rewriteInfo = buildLocalRewriteMap(newScript, coldJs, pagePath, outDir);
  if (rewriteInfo.unmapped.length) {
    return {
      ok: false,
      reason: "midpath-local-unmapped",
      unmapped: rewriteInfo.unmapped,
      mapped: rewriteInfo.mapped
    };
  }
  let rewritten = rewriteIdents(stripImports(newScript), rewriteInfo.map);
  rewritten = rewriteVueApisToCommonVendor(rewritten);
  rewritten = preferDoubleQuotes(rewritten);
  rewritten = rewritten.replace(/\b(const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*/g, "$1 $2 = ");
  rewritten = rewritten.replace(/\s*;\s*/g, "; ");
  rewritten = rewritten.replace(/;\s*$/, "");
  rewritten = rewritten.trim();
  if (!/[;\}]$/.test(rewritten)) rewritten += ";";
  rewritten = rewritten.replace(
    /process\.env\.NODE_ENV\s*===?\s*['"]development['"]/g,
    "true"
  );
  rewritten = rewritten.replace(
    /process\.env\.NODE_ENV\s*!==?\s*['"]production['"]/g,
    "true"
  );
  return { ok: true, body: rewritten, rewriteInfo };
}
function emitOptCExtMidpathSync({
  outDir,
  pagePath,
  oldScript,
  newScript,
  dryRun = false,
  allowImportSetChange = false
}) {
  const t0 = performance.now();
  const file = pageJsPath(outDir, pagePath);
  if (!node_fs.existsSync(file)) {
    return {
      ok: false,
      reason: "cold-page-js-missing",
      file,
      emitClass: "midpath-sync",
      timings: { totalMs: performance.now() - t0 }
    };
  }
  const coldJs = node_fs.readFileSync(file, "utf8");
  const rewritten = rewriteSetupBodyForCold(newScript, coldJs, pagePath, outDir);
  if (!rewritten.ok) {
    return {
      ...rewritten,
      emitClass: "midpath-sync",
      timings: { totalMs: performance.now() - t0 }
    };
  }
  const split = splitColdSetup(coldJs);
  if (!split) {
    return {
      ok: false,
      reason: "midpath-setup-split-failed",
      emitClass: "midpath-sync",
      timings: { totalMs: performance.now() - t0 }
    };
  }
  const newAssigned = assignedNames(rewritten.body);
  const oldColdAssigned = assignedNames(split.setupStmts);
  const renderNames = renderReferencedNames(split.returnAndAfter);
  const missing = [];
  for (const n of oldColdAssigned) {
    if (renderNames.has(n) && !newAssigned.has(n)) missing.push(n);
  }
  if (missing.length) {
    return {
      ok: false,
      reason: "midpath-render-binding-removed",
      missing,
      emitClass: "midpath-sync",
      timings: { totalMs: performance.now() - t0 }
    };
  }
  const indented = formatSetupStmtsLikeUni(rewritten.body, split.returnAndAfter);
  const next = split.beforeSetupBody + "\n" + indented + "\n    " + split.returnAndAfter.trimStart();
  const reqs = [...next.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map((m) => m[1]);
  const externals = [];
  for (const r of reqs) {
    const abs = normalizePath$3(node_path.join(node_path.dirname(file), r));
    externals.push({
      require: r,
      exists: node_fs.existsSync(abs),
      bytes: node_fs.existsSync(abs) && !node_fs.statSync(abs).isDirectory() ? node_fs.statSync(abs).size : 0
    });
  }
  if (!externals.every((e) => e.exists)) {
    return {
      ok: false,
      reason: "externals-missing",
      emitClass: "midpath-sync",
      externals,
      allExternalsOnDisk: false,
      timings: { totalMs: performance.now() - t0 }
    };
  }
  if (!dryRun) {
    node_fs.mkdirSync(node_path.dirname(file), { recursive: true });
    atomicWriteFile(file, next);
  }
  return {
    ok: true,
    reason: allowImportSetChange ? "midpath-sync-import-set" : "midpath-sync-shell-splice",
    emitClass: "midpath-sync",
    file,
    filesWritten: dryRun ? 0 : 1,
    generated: 1,
    code: next,
    beforeSha: sha$3(coldJs),
    afterSha: sha$3(next),
    requireCount: reqs.length,
    externals,
    allExternalsOnDisk: true,
    note: "Sync mid-path: cold-shell splice after rewrite; Rollup proof is async emitOptCExtMidpath",
    allowImportSetChange,
    timings: { totalMs: performance.now() - t0 }
  };
}

function sha$2(s) {
  return node_crypto.createHash("sha256").update(s).digest("hex");
}
function normalizePath$2(p) {
  return p.replace(/\\/g, "/");
}
function extractEsmExportNames(code) {
  const names = /* @__PURE__ */ new Set();
  for (const m of code.matchAll(/export\s+function\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of code.matchAll(/export\s+(?:async\s+)?function\s*\*\s*([A-Za-z_$][\w$]*)/g))
    names.add(m[1]);
  for (const m of code.matchAll(/export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of code.matchAll(/export\s+class\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of code.matchAll(/export\s+\{([^}]+)\}/g)) {
    for (const part of m[1].split(",")) {
      const bit = part.trim();
      if (!bit) continue;
      const as = bit.split(/\s+as\s+/);
      const exported = (as[1] || as[0]).trim();
      if (exported && exported !== "default") names.add(exported);
    }
  }
  return [...names].sort();
}
function extractCjsExportNames(code) {
  const names = /* @__PURE__ */ new Set();
  for (const m of code.matchAll(/exports\.([A-Za-z_$][\w$]*)\s*=/g)) names.add(m[1]);
  for (const m of code.matchAll(/exports\[\s*['"]([^'"]+)['"]\s*\]\s*=/g)) names.add(m[1]);
  return [...names].sort();
}
function classifyExportSurfaceChange(coldExports, srcExports) {
  const cold = new Set(coldExports || []);
  const src = new Set(srcExports || []);
  const added = [];
  const removed = [];
  for (const n of src) if (!cold.has(n)) added.push(n);
  for (const n of cold) if (!src.has(n)) removed.push(n);
  added.sort();
  removed.sort();
  if (!added.length && !removed.length) return { kind: "same", added, removed };
  if (added.length && !removed.length) return { kind: "add-only", added, removed };
  if (!added.length && removed.length) return { kind: "remove-only", added, removed };
  return { kind: "rename-or-mixed", added, removed };
}
function extractNamedImportsForResolved(script, importerAbs, inputDir, targetAbs) {
  const names = [];
  const target = normalizePath$2(targetAbs);
  const re = /import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g;
  let m;
  while (m = re.exec(String(script || ""))) {
    const r = resolveUtilImportSpec(importerAbs, m[2], inputDir);
    if (!r.ok || normalizePath$2(r.abs) !== target) continue;
    for (const part of m[1].split(",")) {
      const bit = part.trim();
      if (!bit) continue;
      const as = bit.split(/\s+as\s+/);
      const imported = as[0].trim();
      if (imported) names.push(imported);
    }
  }
  return [...new Set(names)];
}
function stripCommentsForGate(code) {
  return String(code).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}
function parseStaticImports(code) {
  const gate = stripCommentsForGate(code);
  if (/\bimport\s*\(/.test(gate)) {
    return { ok: false, reason: "closure-dynamic-import", imports: [] };
  }
  const imports = [];
  for (const m of code.matchAll(/^\s*import\s+['"]([^'"]+)['"]\s*;?\s*$/gm)) {
    imports.push({ spec: m[1], names: [], defaultName: null, sideEffect: true, raw: m[0] });
  }
  for (const m of code.matchAll(
    /^\s*import\s+([A-Za-z_$][\w$]*)\s+from\s+['"]([^'"]+)['"]\s*;?\s*$/gm
  )) {
    imports.push({
      spec: m[2],
      names: [],
      defaultName: m[1],
      sideEffect: false,
      raw: m[0]
    });
  }
  for (const m of code.matchAll(
    /^\s*import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+['"]([^'"]+)['"]\s*;?\s*$/gm
  )) {
    imports.push({
      spec: m[2],
      names: null,
      defaultName: m[1],
      sideEffect: false,
      namespace: true,
      raw: m[0]
    });
  }
  for (const m of code.matchAll(
    /^\s*import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]\s*;?\s*$/gm
  )) {
    const names = [];
    for (const part of m[1].split(",")) {
      const bit = part.trim();
      if (!bit) continue;
      const as = bit.split(/\s+as\s+/);
      names.push({
        imported: as[0].trim(),
        local: (as[1] || as[0]).trim()
      });
    }
    imports.push({
      spec: m[2],
      names,
      defaultName: null,
      sideEffect: false,
      raw: m[0]
    });
  }
  for (const m of code.matchAll(
    /^\s*import\s+([A-Za-z_$][\w$]*)\s*,\s*\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]\s*;?\s*$/gm
  )) {
    const names = [];
    for (const part of m[2].split(",")) {
      const bit = part.trim();
      if (!bit) continue;
      const as = bit.split(/\s+as\s+/);
      names.push({
        imported: as[0].trim(),
        local: (as[1] || as[0]).trim()
      });
    }
    imports.push({
      spec: m[3],
      names,
      defaultName: m[1],
      sideEffect: false,
      raw: m[0]
    });
  }
  return { ok: true, imports };
}
function resolveUtilImportSpec(importerAbs, spec, inputDir) {
  const input = normalizePath$2(inputDir);
  if (spec.startsWith("@/")) {
    const cand2 = normalizePath$2(node_path.join(input, spec.slice(2)));
    return resolveWithExt(cand2);
  }
  if (spec.startsWith("/")) {
    const cand2 = normalizePath$2(node_path.join(input, spec.replace(/^\//, "")));
    return resolveWithExt(cand2);
  }
  if (!spec.startsWith(".")) {
    return { ok: false, reason: "closure-bare-specifier", spec };
  }
  const cand = normalizePath$2(node_path.resolve(node_path.dirname(importerAbs), spec));
  return resolveWithExt(cand);
}
function resolveWithExt(base) {
  const b = normalizePath$2(base);
  if (node_fs.existsSync(b) && !node_fs.statSync(b).isDirectory()) return { ok: true, abs: b };
  for (const ext of [".js", ".mjs", ".ts", ".json"]) {
    if (node_fs.existsSync(b + ext) && !node_fs.statSync(b + ext).isDirectory()) {
      return { ok: true, abs: normalizePath$2(b + ext) };
    }
  }
  for (const idx of ["index.js", "index.mjs", "index.ts"]) {
    const p = node_path.join(b, idx);
    if (node_fs.existsSync(p)) return { ok: true, abs: normalizePath$2(p) };
  }
  return { ok: false, reason: "closure-unresolved-import", spec: b };
}
function resolveSharedDistChunk(inputDir, outDir, sourceAbs) {
  const rel = normalizePath$2(node_path.relative(inputDir, sourceAbs));
  if (!rel || rel.startsWith("..")) return null;
  const candidates = [
    node_path.join(outDir, rel),
    node_path.join(outDir, rel.replace(/\.ts$/, ".js")),
    node_path.join(outDir, rel.replace(/\.mjs$/, ".js"))
  ];
  for (const c of candidates) {
    if (node_fs.existsSync(c) && !node_fs.statSync(c).isDirectory()) return normalizePath$2(c);
  }
  const base = node_path.basename(rel);
  const guess = node_path.join(outDir, node_path.dirname(rel), base);
  if (node_fs.existsSync(guess) && !node_fs.statSync(guess).isDirectory()) return normalizePath$2(guess);
  return null;
}
function relRequireBetween(fromDistFile, toDistFile) {
  let rel = normalizePath$2(node_path.relative(node_path.dirname(fromDistFile), toDistFile));
  if (!rel.startsWith(".")) rel = "./" + rel;
  return rel;
}
function findUtilImportersOf(inputDir, targetAbs, { maxFiles = 400 } = {}) {
  const target = normalizePath$2(targetAbs);
  const found = [];
  const roots = [
    node_path.join(inputDir, "modules"),
    node_path.join(inputDir, "utils"),
    node_path.join(inputDir, "common"),
    node_path.join(inputDir, "libs"),
    node_path.join(inputDir, "shared")
  ].filter((r) => node_fs.existsSync(r));
  if (!roots.length) roots.push(inputDir);
  let scanned = 0;
  function walk(dir, depth) {
    if (depth > 8 || scanned >= maxFiles || found.length >= 20) return;
    let entries;
    try {
      entries = node_fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (scanned >= maxFiles) return;
      const p = node_path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === "node_modules" || ent.name === "dist") continue;
        walk(p, depth + 1);
        continue;
      }
      if (!/\.(js|mjs|ts)$/i.test(ent.name)) continue;
      scanned++;
      const abs = normalizePath$2(p);
      if (abs === target) continue;
      let code;
      try {
        code = node_fs.readFileSync(abs, "utf8");
      } catch {
        continue;
      }
      const parsed = parseStaticImports(code);
      if (!parsed.ok) continue;
      for (const im of parsed.imports) {
        const r = resolveUtilImportSpec(abs, im.spec, inputDir);
        if (r.ok && r.abs === target) {
          found.push(abs);
          break;
        }
      }
    }
  }
  for (const r of roots) walk(r, 0);
  return found;
}
function transformUtilEsmToCjs(src, opts = {}) {
  const code = String(src);
  const gate = stripCommentsForGate(code);
  if (/\bexport\s+\*\s+from\b/.test(gate)) {
    return { ok: false, reason: "closure-reexport" };
  }
  if (/\bexport\s+\{[^}]*\}\s*from\b/.test(gate)) {
    return { ok: false, reason: "closure-reexport" };
  }
  if (/\bexport\s+default\b/.test(gate)) {
    return { ok: false, reason: "closure-default-export" };
  }
  const parsed = parseStaticImports(code);
  if (!parsed.ok) return { ok: false, reason: parsed.reason, imports: [] };
  const { inputDir, outDir, sourceAbs, distFile } = opts;
  const requireLines = [];
  const resolvedExternals = [];
  if (parsed.imports.length) {
    if (!inputDir || !outDir || !sourceAbs || !distFile) {
      return { ok: false, reason: "closure-source-has-imports" };
    }
    for (const im of parsed.imports) {
      const r = resolveUtilImportSpec(sourceAbs, im.spec, inputDir);
      if (!r.ok) {
        return { ok: false, reason: r.reason || "closure-unresolved-import", spec: im.spec };
      }
      let depDist = resolveSharedDistChunk(inputDir, outDir, r.abs);
      if (!depDist && (im.spec === "vue" || im.spec === "@dcloudio/uni-app" || im.spec.startsWith("@dcloudio/"))) {
        const vendor = node_path.join(outDir, "common/vendor.js");
        if (node_fs.existsSync(vendor)) depDist = normalizePath$2(vendor);
      }
      if (!depDist) {
        return {
          ok: false,
          reason: "closure-external-dist-missing",
          spec: im.spec,
          resolvedAbs: r.abs
        };
      }
      if (normalizePath$2(depDist) === normalizePath$2(distFile)) {
        return { ok: false, reason: "closure-circular-self", spec: im.spec };
      }
      const rel = relRequireBetween(distFile, depDist);
      resolvedExternals.push({ spec: im.spec, abs: r.abs, dist: depDist, rel });
      if (im.sideEffect) {
        requireLines.push(`require("${rel}");`);
        continue;
      }
      if (im.namespace || im.names === null && im.defaultName) {
        requireLines.push(`const ${im.defaultName} = require("${rel}");`);
        continue;
      }
      if (im.defaultName && (!im.names || !im.names.length)) {
        return { ok: false, reason: "closure-default-import", spec: im.spec };
      }
      if (im.names && im.names.length) {
        const locals = im.names.map(
          (n) => n.imported === n.local ? n.local : `${n.imported}: ${n.local}`
        );
        requireLines.push(`const { ${locals.join(", ")} } = require("${rel}");`);
        continue;
      }
      return { ok: false, reason: "closure-import-shape", spec: im.spec };
    }
  }
  const exportNames = extractEsmExportNames(code);
  if (!exportNames.length) {
    return { ok: false, reason: "closure-no-named-exports" };
  }
  let body = code;
  for (const im of parsed.imports) {
    body = body.replace(im.raw, "");
  }
  body = body.replace(/\bexport\s+(async\s+)?function\b/g, "$1function");
  body = body.replace(/\bexport\s+(const|let|var|class)\b/g, "$1");
  body = body.replace(/^\s*export\s*\{[^}]+\}\s*;?\s*$/gm, "");
  body = body.trim();
  if (!body.endsWith("\n")) body += "\n";
  const exportLines = exportNames.map((n) => `exports.${n} = ${n};`).join("\n");
  const preamble = requireLines.length ? requireLines.join("\n") + "\n" : "";
  const next = `"use strict";
${preamble}${body}${exportLines}
`;
  for (const n of exportNames) {
    const decl = new RegExp(`\\b(?:function|const|let|var|class)\\s+${n}\\b`).test(body) || new RegExp(`\\b${n}\\s*=`).test(body);
    if (!decl) {
      return { ok: false, reason: "closure-export-binding-missing", name: n };
    }
  }
  try {
    new Function(next);
  } catch (e) {
    return { ok: false, reason: "closure-cjs-syntax", error: e.message };
  }
  return {
    ok: true,
    code: next,
    exportNames,
    importCount: parsed.imports.length,
    resolvedExternals
  };
}
function normalizeReturnSemicolonsLikeUni(code) {
  return String(code).replace(/\breturn\s+([^;\n]+?)\s*\n(\s*)\}/g, (m, expr, ws) => {
    const e = expr.trimEnd();
    if (e.endsWith(";")) return m;
    return `return ${e};
${ws}}`;
  });
}
function stripJsCommentsLikeRollup(code) {
  let out = "";
  let i = 0;
  const s = String(code);
  while (i < s.length) {
    const c = s[i];
    const n = s[i + 1];
    if (c === "'" || c === '"' || c === "`") {
      const q = c;
      out += c;
      i++;
      while (i < s.length) {
        const ch = s[i];
        out += ch;
        if (ch === "\\") {
          out += s[i + 1] || "";
          i += 2;
          continue;
        }
        if (ch === q) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === "/" && n === "/") {
      i += 2;
      while (i < s.length && s[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && n === "*") {
      i += 2;
      while (i + 1 < s.length && !(s[i] === "*" && s[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}
function emitClosureSharedChunkSync({
  inputDir,
  outDir,
  sourceAbs,
  dryRun = false,
  /** F14: allow only-added named exports (chunk regen via transform). */
  allowExportAdd = false,
  /** F14 Option A: allow any export surface change (add/remove/rename) when pages re-emitted. */
  allowExportSurfaceChange = false
}) {
  const t0 = node_perf_hooks.performance.now();
  const srcPath = normalizePath$2(sourceAbs);
  if (!node_fs.existsSync(srcPath)) {
    return {
      ok: false,
      reason: "closure-source-missing",
      sourceAbs: srcPath,
      emitClass: "closure-chunk",
      timings: { totalMs: node_perf_hooks.performance.now() - t0 }
    };
  }
  const distFile = resolveSharedDistChunk(inputDir, outDir, srcPath);
  if (!distFile) {
    return {
      ok: false,
      reason: "closure-dist-chunk-missing",
      sourceAbs: srcPath,
      emitClass: "closure-chunk",
      optionACandidate: true,
      timings: { totalMs: node_perf_hooks.performance.now() - t0 }
    };
  }
  const coldChunk = node_fs.readFileSync(distFile, "utf8");
  const newSrc = node_fs.readFileSync(srcPath, "utf8");
  const coldExports = extractCjsExportNames(coldChunk);
  const srcExports = extractEsmExportNames(newSrc);
  const surface = classifyExportSurfaceChange(coldExports, srcExports);
  let exportSurfaceMode = "same";
  if (surface.kind !== "same") {
    if (allowExportSurfaceChange) {
      exportSurfaceMode = surface.kind;
    } else if (allowExportAdd && surface.kind === "add-only") {
      exportSurfaceMode = "add-only";
    } else {
      return {
        ok: false,
        reason: "closure-export-surface-changed",
        coldExports,
        srcExports,
        surface,
        emitClass: "closure-chunk",
        optionACandidate: true,
        timings: { totalMs: node_perf_hooks.performance.now() - t0 }
      };
    }
  }
  const parsed = parseStaticImports(newSrc);
  if (!parsed.ok) {
    return {
      ok: false,
      reason: parsed.reason,
      emitClass: "closure-chunk",
      timings: { totalMs: node_perf_hooks.performance.now() - t0 }
    };
  }
  let next = null;
  let writeMode = null;
  if (!parsed.imports.length && exportSurfaceMode === "same") {
    const simpleFns = [
      ...newSrc.matchAll(
        /export\s+function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{([\s\S]*?)\n\}/g
      )
    ];
    if (simpleFns.length && simpleFns.length === coldExports.length) {
      let patched = coldChunk;
      let allOk = true;
      for (const m of simpleFns) {
        const name = m[1];
        const params = m[2];
        const bodyInner = m[3];
        const re = new RegExp(
          `(function\\s+${name}\\s*\\()([^)]*)(\\)\\s*\\{)([\\s\\S]*?)(\\n\\})`
        );
        if (!re.test(patched)) {
          allOk = false;
          break;
        }
        patched = patched.replace(re, `$1${params}$3${bodyInner}$5`);
      }
      if (allOk) {
        try {
          new Function(patched);
          next = patched;
          writeMode = "cold-body-patch";
        } catch {
        }
      }
    }
  }
  if (!next) {
    if (parsed.imports.length && exportSurfaceMode === "same") {
      const simpleFns = [
        ...newSrc.matchAll(
          /export\s+function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{([\s\S]*?)\n\}/g
        )
      ];
      if (simpleFns.length) {
        let patched = coldChunk;
        let allOk = true;
        for (const m of simpleFns) {
          const name = m[1];
          const params = m[2];
          const bodyInner = m[3];
          const re = new RegExp(
            `(function\\s+${name}\\s*\\()([^)]*)(\\)\\s*\\{)([\\s\\S]*?)(\\n\\})`
          );
          if (!re.test(patched)) {
            allOk = false;
            break;
          }
          patched = patched.replace(re, `$1${params}$3${bodyInner}$5`);
        }
        if (allOk) {
          for (const im of parsed.imports) {
            const r = resolveUtilImportSpec(srcPath, im.spec, inputDir);
            if (!r.ok) {
              allOk = false;
              break;
            }
            const depDist = resolveSharedDistChunk(inputDir, outDir, r.abs);
            if (!depDist) {
              allOk = false;
              break;
            }
            const rel = relRequireBetween(distFile, depDist);
            if (!patched.includes(`require("${rel}")`) && !patched.includes(`require('${rel}')`)) {
              const base = node_path.basename(depDist);
              if (!new RegExp(`require\\(['"][^'"]*${base.replace(".", "\\.")}['"]\\)`).test(patched)) {
                allOk = false;
                break;
              }
            }
          }
        }
        if (allOk) {
          try {
            new Function(patched);
            next = patched;
            writeMode = "cold-body-patch-with-imports";
          } catch {
          }
        }
      }
    }
  }
  let transformed = null;
  if (!next) {
    transformed = transformUtilEsmToCjs(newSrc, {
      inputDir,
      outDir,
      sourceAbs: srcPath,
      distFile
    });
    if (!transformed.ok) {
      return {
        ...transformed,
        emitClass: "closure-chunk",
        distFile,
        optionACandidate: transformed.reason === "closure-source-has-imports" || transformed.reason === "closure-external-dist-missing",
        timings: { totalMs: node_perf_hooks.performance.now() - t0 }
      };
    }
    next = transformed.code;
    writeMode = transformed.importCount ? "transform-cjs-with-requires" : "transform-cjs";
  }
  const relatedChunks = (transformed?.resolvedExternals || []).map((e) => e.dist);
  next = normalizeReturnSemicolonsLikeUni(stripJsCommentsLikeRollup(next));
  if (!dryRun) {
    node_fs.mkdirSync(node_path.dirname(distFile), { recursive: true });
    atomicWriteFile(distFile, next);
  }
  return {
    ok: true,
    reason: "closure-shared-chunk-regen",
    emitClass: "closure-chunk",
    file: distFile,
    sourceAbs: srcPath,
    filesWritten: dryRun ? 0 : 1,
    filesWrittenList: dryRun ? [] : [distFile],
    relatedChunks,
    generated: 1,
    beforeSha: sha$2(coldChunk),
    afterSha: sha$2(next),
    exportNames: srcExports,
    writeMode,
    importCount: parsed.imports.length,
    allExternalsOnDisk: true,
    requireCount: (next.match(/require\(/g) || []).length,
    exportSurfaceMode,
    surface,
    note: exportSurfaceMode !== "same" ? `F14: chunk regen with export surface ${exportSurfaceMode}; pages may need Option A re-emit` : parsed.imports.length > 0 ? "F10: util with static imports \u2192 require() externals; pages untouched" : "F7 Option B: regenerate single shared dist chunk; pages untouched",
    timings: { totalMs: node_perf_hooks.performance.now() - t0 }
  };
}
function emitClosureMultiChunkSync({
  inputDir,
  outDir,
  sourceAbs,
  alsoRegenSources = [],
  dryRun = false
}) {
  const t0 = node_perf_hooks.performance.now();
  const written = [];
  const results = [];
  const primary = emitClosureSharedChunkSync({
    inputDir,
    outDir,
    sourceAbs,
    dryRun
  });
  results.push(primary);
  if (!primary.ok) {
    return {
      ...primary,
      emitClass: "closure-multi-chunk",
      results,
      timings: { totalMs: node_perf_hooks.performance.now() - t0 }
    };
  }
  if (primary.file) written.push(primary.file);
  for (const abs of alsoRegenSources) {
    if (normalizePath$2(abs) === normalizePath$2(sourceAbs)) continue;
    const r = emitClosureSharedChunkSync({
      inputDir,
      outDir,
      sourceAbs: abs,
      dryRun
    });
    results.push(r);
    if (!r.ok) {
      return {
        ok: false,
        reason: "closure-multi-chunk-dep-failed",
        depReason: r.reason,
        emitClass: "closure-multi-chunk",
        results,
        timings: { totalMs: node_perf_hooks.performance.now() - t0 }
      };
    }
    if (r.file) written.push(r.file);
  }
  return {
    ok: true,
    reason: "closure-multi-chunk-regen",
    emitClass: "closure-multi-chunk",
    filesWritten: dryRun ? 0 : written.length,
    filesWrittenList: dryRun ? [] : written,
    afterSha: primary.afterSha,
    writeMode: primary.writeMode,
    results,
    note: "F11: primary util (+ optional related utils) chunk regen; pages untouched",
    timings: { totalMs: node_perf_hooks.performance.now() - t0 }
  };
}
function emitClosureVueComponentSync({
  inputDir,
  outDir,
  sourceAbs,
  oldScript,
  newScript,
  dryRun = false
}) {
  const t0 = node_perf_hooks.performance.now();
  const srcPath = normalizePath$2(sourceAbs);
  if (!/\.vue$/i.test(srcPath)) {
    return {
      ok: false,
      reason: "closure-vue-not-vue",
      emitClass: "closure-vue",
      timings: { totalMs: node_perf_hooks.performance.now() - t0 }
    };
  }
  if (!node_fs.existsSync(srcPath)) {
    return {
      ok: false,
      reason: "closure-vue-source-missing",
      emitClass: "closure-vue",
      timings: { totalMs: node_perf_hooks.performance.now() - t0 }
    };
  }
  const rel = normalizePath$2(node_path.relative(inputDir, srcPath));
  if (!rel || rel.startsWith("..")) {
    return {
      ok: false,
      reason: "closure-vue-outside-input",
      emitClass: "closure-vue",
      timings: { totalMs: node_perf_hooks.performance.now() - t0 }
    };
  }
  const pagePath = rel.replace(/\.vue$/i, "");
  const distFile = node_path.join(outDir, pagePath + ".js");
  if (!node_fs.existsSync(distFile)) {
    return {
      ok: false,
      reason: "closure-vue-dist-missing",
      emitClass: "closure-vue",
      file: distFile,
      timings: { totalMs: node_perf_hooks.performance.now() - t0 }
    };
  }
  const scriptText = String(newScript || "");
  const vueImportSpecs = [];
  for (const m of scriptText.matchAll(
    /(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+\.vue)['"]/g
  )) {
    vueImportSpecs.push(m[1]);
  }
  if (vueImportSpecs.length) {
    return {
      ok: false,
      reason: "closure-vue-imports-sfc",
      spec: vueImportSpecs[0],
      emitClass: "closure-vue",
      timings: { totalMs: node_perf_hooks.performance.now() - t0 }
    };
  }
  if (/\bimport\s*\(/.test(scriptText)) {
    return {
      ok: false,
      reason: "closure-vue-dynamic-import",
      emitClass: "closure-vue",
      timings: { totalMs: node_perf_hooks.performance.now() - t0 }
    };
  }
  const emit = emitOptCExtPage({
    outDir,
    pagePath,
    oldScript: oldScript || "",
    newScript: newScript || "",
    dryRun
  });
  if (!emit.ok) {
    return {
      ok: false,
      reason: emit.reason || "closure-vue-emit-failed",
      emitClass: "closure-vue",
      pageEmitClass: emit.emitClass,
      cascadeReason: emit.reason,
      timings: { totalMs: node_perf_hooks.performance.now() - t0 }
    };
  }
  const companions = [".json", ".wxml", ".wxss"].map((ext) => node_path.join(outDir, pagePath + ext));
  const missingComp = companions.filter((c) => !node_fs.existsSync(c));
  if (missingComp.length) {
    return {
      ok: false,
      reason: "closure-vue-companions-missing",
      missing: missingComp,
      emitClass: "closure-vue",
      timings: { totalMs: node_perf_hooks.performance.now() - t0 }
    };
  }
  return {
    ok: true,
    reason: "closure-vue-script-only",
    emitClass: "closure-vue",
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
    note: "F12 MVP: script-only Vue component \u2192 page-style surgical cascade on dist JS; template/style untouched",
    timings: { totalMs: node_perf_hooks.performance.now() - t0, emitMs: emit.timings?.totalMs }
  };
}
function parseVueScriptParts(vueSource) {
  const text = String(vueSource);
  const templateMatch = text.match(/<template\b[^>]*>([\s\S]*?)<\/template>/i);
  const template = templateMatch ? templateMatch[0] : "";
  const styleMatches = [...text.matchAll(/<style\b[^>]*>[\s\S]*?<\/style>/gi)].map((m) => m[0]);
  const style = styleMatches.join("\n");
  const scriptBlocks = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let sm;
  while (sm = re.exec(text)) {
    const attrs = sm[1] || "";
    if (/\blang\s*=\s*["']wxs["']/i.test(attrs)) continue;
    if (/\bmodule\s*=/.test(attrs)) continue;
    scriptBlocks.push({ attrs, body: sm[2] || "", setup: /\bsetup\b/i.test(attrs) });
  }
  let script = "";
  if (scriptBlocks.length) {
    const setups = scriptBlocks.filter((b) => b.setup);
    const normals = scriptBlocks.filter((b) => !b.setup);
    script = [...normals, ...setups].map((b) => b.body).join("\n");
  }
  return {
    template,
    style,
    script,
    templateHash: sha$2(template),
    styleHash: sha$2(style),
    scriptHash: sha$2(script)
  };
}
function emitOptionABatchSync({
  inputDir,
  outDir,
  sourceAbs,
  pageUpdates = [],
  dryRun = false,
  allowExportAdd = true,
  allowExportSurfaceChange = true
}) {
  const t0 = node_perf_hooks.performance.now();
  const srcPath = normalizePath$2(sourceAbs);
  const clo = emitClosureSharedChunkSync({
    inputDir,
    outDir,
    sourceAbs: srcPath,
    dryRun,
    allowExportAdd,
    allowExportSurfaceChange
  });
  if (!clo.ok) {
    return {
      ok: false,
      reason: clo.reason || "option-a-chunk-failed",
      emitClass: "option-a-batch",
      chunk: clo,
      timings: { totalMs: node_perf_hooks.performance.now() - t0 }
    };
  }
  const srcExports = clo.exportNames || extractEsmExportNames(node_fs.readFileSync(srcPath, "utf8"));
  const pageResults = [];
  const written = [...clo.filesWrittenList || (clo.file ? [clo.file] : [])];
  for (const pu of pageUpdates) {
    const pagePath = pu.pagePath;
    const oldScript = pu.oldScript ?? "";
    const newScript = pu.newScript ?? "";
    const pageAbs = pu.pageAbs || null;
    if (pageAbs) {
      const used = extractNamedImportsForResolved(newScript, pageAbs, inputDir, srcPath);
      const missing = used.filter((n) => !srcExports.includes(n));
      if (missing.length) {
        pageResults.push({
          pagePath,
          ok: false,
          reason: "option-a-page-imports-missing-export",
          missing,
          used
        });
        return {
          ok: false,
          reason: "option-a-page-imports-missing-export",
          emitClass: "option-a-batch",
          chunk: clo,
          pageResults,
          timings: { totalMs: node_perf_hooks.performance.now() - t0 }
        };
      }
    }
    if (oldScript === newScript) {
      pageResults.push({ pagePath, ok: true, reason: "option-a-page-noop", emitClass: "noop" });
      continue;
    }
    let emit = emitOptCExtPage({
      outDir,
      pagePath,
      oldScript,
      newScript,
      dryRun
    });
    if (!emit.ok || emit.allExternalsOnDisk === false) {
      const mid = emitOptCExtMidpathSync({
        outDir,
        pagePath,
        oldScript,
        newScript,
        allowImportSetChange: true,
        dryRun
      });
      if (mid.ok && mid.allExternalsOnDisk !== false) {
        emit = mid;
      } else {
        pageResults.push({
          pagePath,
          ok: false,
          reason: "option-a-page-emit-failed",
          cascadeReason: emit.reason,
          midpathReason: mid.reason
        });
        return {
          ok: false,
          reason: "option-a-page-emit-failed",
          emitClass: "option-a-batch",
          chunk: clo,
          pageResults,
          timings: { totalMs: node_perf_hooks.performance.now() - t0 }
        };
      }
    }
    const f = emit.file || node_path.join(outDir, pagePath + ".js");
    if (!dryRun) written.push(normalizePath$2(f));
    pageResults.push({
      pagePath,
      ok: true,
      reason: emit.reason,
      emitClass: emit.emitClass,
      afterSha: emit.afterSha,
      allExternalsOnDisk: emit.allExternalsOnDisk
    });
  }
  return {
    ok: true,
    reason: "option-a-batch",
    emitClass: "option-a-batch",
    chunk: clo,
    pageResults,
    filesWritten: dryRun ? 0 : new Set(written).size,
    filesWrittenList: dryRun ? [] : [...new Set(written)],
    exportNames: srcExports,
    exportSurfaceMode: clo.exportSurfaceMode,
    afterSha: clo.afterSha,
    writeMode: clo.writeMode,
    generated: (dryRun ? 0 : 1) + pageResults.filter((p) => p.emitClass && p.emitClass !== "noop").length,
    note: "F14 Option A: chunk regen (export surface may change) + page surgical/midpath re-emit",
    timings: { totalMs: node_perf_hooks.performance.now() - t0 }
  };
}
function extractSimpleExportedFunctions(utilSrc) {
  const out = [];
  const re = /export\s+function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/g;
  let m;
  while (m = re.exec(utilSrc)) {
    const name = m[1];
    const params = m[2];
    let i = m.index + m[0].length;
    let depth = 1;
    while (i < utilSrc.length && depth > 0) {
      const c = utilSrc[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      i++;
    }
    if (depth !== 0) continue;
    const bodyInner = utilSrc.slice(m.index + m[0].length, i - 1);
    out.push({ name, params, bodyInner, end: i });
  }
  return out;
}
function patchInlinedUtilInPageJs(pageJs, utilSrc) {
  const fns = extractSimpleExportedFunctions(utilSrc);
  if (!fns.length) {
    return { ok: false, reason: "option-a-inlined-no-simple-exports", code: pageJs, patched: [], missing: [] };
  }
  let next = pageJs;
  const patched = [];
  const missing = [];
  for (const fn of fns) {
    const re = new RegExp(
      `(function\\s+${fn.name}\\s*\\()([^)]*)(\\)\\s*\\{)([\\s\\S]*?)(\\n\\})`
    );
    if (!re.test(next)) {
      const re2 = new RegExp(
        `(function\\s+${fn.name}\\s*\\()([^)]*)(\\)\\s*\\{)([\\s\\S]*?)(\\})`
      );
      if (!re2.test(next)) {
        missing.push(fn.name);
        continue;
      }
      next = next.replace(re2, `$1${fn.params}$3${fn.bodyInner}$5`);
      patched.push(fn.name);
      continue;
    }
    next = next.replace(re, `$1${fn.params}$3${fn.bodyInner}$5`);
    patched.push(fn.name);
  }
  if (!patched.length) {
    return {
      ok: false,
      reason: "option-a-inlined-no-anchor",
      code: pageJs,
      patched,
      missing
    };
  }
  try {
    new Function(next);
  } catch (e) {
    return {
      ok: false,
      reason: "option-a-inlined-syntax",
      error: e.message,
      code: pageJs,
      patched,
      missing
    };
  }
  return { ok: true, code: next, patched, missing, changed: next !== pageJs };
}
function emitOptionANoDistPageRebundleSync({
  inputDir,
  outDir,
  sourceAbs,
  pageUpdates = [],
  dryRun = false,
  /** When true, refuse if a dist chunk actually exists (strict no-dist). Default true. */
  requireNoDist = true
}) {
  const t0 = node_perf_hooks.performance.now();
  const srcPath = normalizePath$2(sourceAbs);
  if (!node_fs.existsSync(srcPath)) {
    return {
      ok: false,
      reason: "closure-source-missing",
      emitClass: "option-a-inlined-page-rebundle",
      timings: { totalMs: node_perf_hooks.performance.now() - t0 }
    };
  }
  const distFile = resolveSharedDistChunk(inputDir, outDir, srcPath);
  if (requireNoDist && distFile) {
    return {
      ok: false,
      reason: "option-a-inlined-dist-exists",
      distFile,
      emitClass: "option-a-inlined-page-rebundle",
      hint: "Use emitOptionABatchSync / closure-chunk when dist exists",
      timings: { totalMs: node_perf_hooks.performance.now() - t0 }
    };
  }
  if (!pageUpdates.length) {
    return {
      ok: false,
      reason: "option-a-inlined-no-pages",
      emitClass: "option-a-inlined-page-rebundle",
      timings: { totalMs: node_perf_hooks.performance.now() - t0 }
    };
  }
  const utilSrc = node_fs.readFileSync(srcPath, "utf8");
  const srcExports = extractEsmExportNames(utilSrc);
  const pageResults = [];
  const written = [];
  for (const pu of pageUpdates) {
    const pagePath = pu.pagePath;
    const oldScript = pu.oldScript ?? "";
    const newScript = pu.newScript ?? "";
    const pageAbs = pu.pageAbs || null;
    const file = node_path.join(outDir, pagePath + ".js");
    if (pageAbs) {
      const used = extractNamedImportsForResolved(newScript, pageAbs, inputDir, srcPath);
      const missingImps = used.filter((n) => !srcExports.includes(n));
      if (missingImps.length) {
        pageResults.push({
          pagePath,
          ok: false,
          reason: "option-a-page-imports-missing-export",
          missing: missingImps,
          used
        });
        return {
          ok: false,
          reason: "option-a-page-imports-missing-export",
          emitClass: "option-a-inlined-page-rebundle",
          pageResults,
          timings: { totalMs: node_perf_hooks.performance.now() - t0 }
        };
      }
    }
    if (!node_fs.existsSync(file)) {
      pageResults.push({ pagePath, ok: false, reason: "cold-page-js-missing" });
      return {
        ok: false,
        reason: "cold-page-js-missing",
        emitClass: "option-a-inlined-page-rebundle",
        pageResults,
        timings: { totalMs: node_perf_hooks.performance.now() - t0 }
      };
    }
    const coldJs = node_fs.readFileSync(file, "utf8");
    const beforeSha = sha$2(coldJs);
    let workingJs = coldJs;
    let cascade = null;
    if (oldScript !== newScript) {
      cascade = emitOptCExtPage({
        outDir,
        pagePath,
        oldScript,
        newScript,
        dryRun: true
      });
      if (cascade.ok && cascade.allExternalsOnDisk !== false && cascade.code) {
        workingJs = cascade.code;
      } else {
        const mid = emitOptCExtMidpathSync({
          outDir,
          pagePath,
          oldScript,
          newScript,
          allowImportSetChange: true,
          dryRun: true
        });
        if (mid.ok && mid.allExternalsOnDisk !== false && mid.code) {
          cascade = mid;
          workingJs = mid.code;
        }
      }
    }
    const patched = patchInlinedUtilInPageJs(workingJs, utilSrc);
    if (!patched.ok) {
      pageResults.push({
        pagePath,
        ok: false,
        reason: patched.reason || "option-a-inlined-no-anchor",
        missing: patched.missing,
        cascadeReason: cascade?.reason || null
      });
      return {
        ok: false,
        reason: patched.reason || "option-a-inlined-no-anchor",
        emitClass: "option-a-inlined-page-rebundle",
        pageResults,
        timings: { totalMs: node_perf_hooks.performance.now() - t0 }
      };
    }
    const next = patched.code;
    const afterSha = sha$2(next);
    if (!dryRun) {
      node_fs.mkdirSync(node_path.dirname(file), { recursive: true });
      atomicWriteFile(file, next);
      written.push(normalizePath$2(file));
    }
    pageResults.push({
      pagePath,
      ok: true,
      reason: oldScript !== newScript && cascade?.ok ? "option-a-inlined-cascade-plus-patch" : "option-a-inlined-util-patch",
      emitClass: "option-a-inlined-page-rebundle",
      beforeSha,
      afterSha,
      changed: beforeSha !== afterSha,
      patchedFns: patched.patched,
      missingFns: patched.missing,
      cascadeReason: cascade?.reason || null,
      cascadeEmitClass: cascade?.emitClass || null
    });
  }
  const anyChange = pageResults.some((p) => p.ok && p.changed);
  if (!anyChange) {
    return {
      ok: false,
      reason: "option-a-inlined-noop",
      emitClass: "option-a-inlined-page-rebundle",
      pageResults,
      note: "Util source produced no page byte change \u2014 fail-closed (avoid silent skip)",
      timings: { totalMs: node_perf_hooks.performance.now() - t0 }
    };
  }
  return {
    ok: true,
    reason: "option-a-inlined-page-rebundle",
    emitClass: "option-a-inlined-page-rebundle",
    proxyForInlined: true,
    note: "F16 proxy-for-inlined: no dist chunk \u2192 page-only rebundle by patching inlined function bodies (+ optional page cascade). Not a full Rollup graph-inline.",
    pageResults,
    filesWritten: dryRun ? 0 : written.length,
    filesWrittenList: dryRun ? [] : written,
    exportNames: srcExports,
    generated: dryRun ? 0 : written.length,
    afterSha: pageResults.find((p) => p.ok)?.afterSha,
    timings: { totalMs: node_perf_hooks.performance.now() - t0 }
  };
}

function sha$1(s) {
  return node_crypto.createHash("sha256").update(s).digest("hex");
}
function normalizePath$1(p) {
  return p.replace(/\\/g, "/");
}
const NATIVE_MP_TAGS = /* @__PURE__ */ new Set([
  "view",
  "text",
  "image",
  "button",
  "scroll-view",
  "swiper",
  "swiper-item",
  "block",
  "template",
  "slot",
  "navigator",
  "input",
  "textarea",
  "picker",
  "switch",
  "slider",
  "checkbox",
  "radio",
  "checkbox-group",
  "radio-group",
  "form",
  "label",
  "canvas",
  "video",
  "map",
  "web-view",
  "cover-view",
  "cover-image",
  "rich-text",
  "progress",
  "icon",
  "movable-area",
  "movable-view",
  "picker-view",
  "picker-view-column",
  "editor",
  "official-account",
  "open-data",
  "navigation-bar",
  "page-meta",
  "functional-page-navigator",
  "ad",
  "camera",
  "live-player",
  "live-pusher",
  "match-media",
  "voip-room",
  "page-container",
  "share-element",
  "keyboard-accessory",
  "root-portal",
  "span",
  "div",
  "p",
  "img",
  "a",
  "ul",
  "li",
  "table",
  "tr",
  "td",
  "th",
  "thead",
  "tbody",
  "br",
  "hr",
  "i",
  "b",
  "em",
  "strong",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "section",
  "header",
  "footer",
  "main",
  "nav",
  "aside",
  "article",
  "transition",
  "transition-group",
  "keep-alive",
  "component",
  "teleport",
  "suspense"
]);
function loadEasycomConfig(inputDir) {
  try {
    const pagesJson = JSON.parse(node_fs.readFileSync(node_path.join(inputDir, "pages.json"), "utf8"));
    const ec = pagesJson.easycom || {};
    return {
      autoscan: ec.autoscan !== false,
      custom: ec.custom && typeof ec.custom === "object" ? ec.custom : {}
    };
  } catch {
    return { autoscan: true, custom: {} };
  }
}
function extractTemplateComponentTags(vueRaw) {
  const tags = /* @__PURE__ */ new Set();
  const tm = String(vueRaw || "").match(/<template[^>]*>([\s\S]*?)<\/template>/i);
  if (!tm) return tags;
  const re = /<\/?([A-Za-z][\w-]*)\b/g;
  let m;
  while (m = re.exec(tm[1])) {
    const t = m[1];
    if (NATIVE_MP_TAGS.has(t)) continue;
    if (t.startsWith("uni-") || t.includes("-") || /^[A-Z]/.test(t)) {
      const kebab = t.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/_/g, "-").toLowerCase();
      tags.add(kebab);
    } else if (t.includes("-")) {
      tags.add(t.toLowerCase());
    }
  }
  return tags;
}
function resolveEasycomTag(tag, inputDir, easycom, aliases = []) {
  const custom = easycom?.custom || {};
  for (const [pattern, target] of Object.entries(custom)) {
    let re;
    try {
      re = new RegExp(pattern);
    } catch {
      continue;
    }
    const m = String(tag).match(re);
    if (!m) continue;
    let spec = String(target);
    for (let i = 1; i < m.length; i++) {
      spec = spec.replace(new RegExp("\\$" + i, "g"), m[i] || "");
    }
    if (spec.startsWith("@/")) {
      const abs = normalizePath$1(node_path.resolve(inputDir, spec.slice(2)));
      if (node_fs.existsSync(abs)) return abs;
      continue;
    }
    if (spec.startsWith(".") || spec.startsWith("/")) {
      const abs = normalizePath$1(node_path.resolve(inputDir, spec));
      if (node_fs.existsSync(abs)) return abs;
      continue;
    }
    const nm = normalizePath$1(node_path.resolve(inputDir, "../node_modules", spec));
    if (node_fs.existsSync(nm)) return nm;
    const nm2 = normalizePath$1(node_path.resolve(inputDir, "node_modules", spec));
    if (node_fs.existsSync(nm2)) return nm2;
  }
  if (easycom?.autoscan !== false) {
    const base = normalizePath$1(node_path.join(inputDir, "components"));
    const candidates = [
      node_path.join(base, tag + ".vue"),
      node_path.join(base, tag, "index.vue"),
      node_path.join(base, tag, tag + ".vue")
    ];
    const parts = tag.split("-");
    if (parts.length > 1) ;
    for (const c of candidates) {
      if (node_fs.existsSync(c)) return normalizePath$1(c);
    }
    try {
      const stack = [base];
      let seen = 0;
      while (stack.length && seen < 4e3) {
        const dir = stack.pop();
        let entries;
        try {
          entries = node_fs.readdirSync(dir, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const e of entries) {
          if (e.name.startsWith(".") || e.name === "node_modules") continue;
          const p = node_path.join(dir, e.name);
          if (e.isDirectory()) {
            stack.push(p);
            continue;
          }
          seen++;
          if (!e.name.endsWith(".vue")) continue;
          const stem = e.name === "index.vue" ? normalizePath$1(dir).split("/").pop() : e.name.slice(0, -4);
          const kebab = stem.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/_/g, "-").toLowerCase();
          if (kebab === tag || stem === tag) return normalizePath$1(p);
        }
      }
    } catch {
    }
  }
  return null;
}
function seedEasycomIntoFingerprints(inputDir, fingerprints, reverseDeps, aliases = []) {
  const easycom = loadEasycomConfig(inputDir);
  let edgeCount = 0;
  let fileCount = 0;
  const seenFiles = /* @__PURE__ */ new Set();
  const externalPaths = [];
  for (const [pagePath, meta] of fingerprints) {
    if (!meta?.file || !node_fs.existsSync(meta.file)) continue;
    let raw;
    try {
      raw = node_fs.readFileSync(meta.file, "utf8");
    } catch {
      continue;
    }
    const tags = extractTemplateComponentTags(raw);
    if (!meta.fp) meta.fp = { specs: [], contentHashes: {}, pathOnlyDigest: "", digest: "" };
    if (!meta.fp.contentHashes) meta.fp.contentHashes = {};
    for (const tag of tags) {
      const abs = resolveEasycomTag(tag, inputDir, easycom, aliases);
      if (!abs || !node_fs.existsSync(abs)) continue;
      try {
        if (node_fs.statSync(abs).isDirectory()) continue;
      } catch {
        continue;
      }
      const n = normalizePath$1(abs);
      if (meta.fp.contentHashes[n] == null) {
        try {
          meta.fp.contentHashes[n] = sha$1(node_fs.readFileSync(abs));
          edgeCount++;
        } catch {
          continue;
        }
      }
      if (!reverseDeps.has(n)) reverseDeps.set(n, /* @__PURE__ */ new Set());
      reverseDeps.get(n).add(pagePath);
      if (!seenFiles.has(n)) {
        seenFiles.add(n);
        fileCount++;
        if (!n.startsWith(normalizePath$1(inputDir))) externalPaths.push(n);
      }
    }
    try {
      const contentKey = Object.keys(meta.fp.contentHashes).sort().map((k) => k + "=" + meta.fp.contentHashes[k]).join("\0");
      meta.fp.digest = sha$1((meta.fp.specs || []).join("\0") + "\n" + contentKey);
    } catch {
    }
  }
  return { edgeCount, fileCount, externalPaths, easycom };
}

const IMPORT_RE = /(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
function sha(s) {
  return node_crypto.createHash("sha256").update(s).digest("hex");
}
function normalizePath(p) {
  return p.replace(/\\/g, "/");
}
function extractCjsRequires(code) {
  const specs = [];
  let m;
  const re = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while (m = re.exec(code)) {
    if (m[1]) specs.push(m[1]);
  }
  return [...new Set(specs)].sort();
}
function extractStaticImports(code) {
  const specs = [];
  let m;
  const re = new RegExp(IMPORT_RE.source, "g");
  while (m = re.exec(code)) {
    const spec = m[1] || m[2];
    if (spec) specs.push(spec);
  }
  for (const spec of extractCjsRequires(code)) specs.push(spec);
  return [...new Set(specs)].sort();
}
function parseVueSections(filePath) {
  if (node_fs.statSync(filePath).isDirectory()) throw new Error("EISDIR: " + filePath);
  const raw = node_fs.readFileSync(filePath, "utf8");
  if (!filePath.endsWith(".vue")) {
    return {
      raw,
      template: "",
      style: "",
      script: raw,
      templateHash: sha(""),
      styleHash: sha(""),
      scriptHash: sha(raw)
    };
  }
  const { descriptor } = compilerSfc.parse(raw, { filename: filePath });
  const template = descriptor.template?.content || "";
  const style = descriptor.styles.map((s) => s.content || "").join("\n");
  const script = [descriptor.script?.content, descriptor.scriptSetup?.content].filter(Boolean).join("\n");
  return {
    raw,
    template,
    style,
    script,
    templateHash: sha(template),
    styleHash: sha(style),
    scriptHash: sha(script)
  };
}
function resolveSpecifier(importerAbs, spec, inputDir, aliases) {
  if (spec.startsWith("@/")) {
    return normalizePath(node_path.resolve(inputDir, spec.slice(2)));
  }
  for (const [key, val] of aliases) {
    if (spec === key || spec.startsWith(key + "/")) {
      return normalizePath(node_path.resolve(val, spec.slice(key.length).replace(/^\//, "")));
    }
  }
  if (!spec.startsWith(".")) return null;
  let resolved = normalizePath(node_path.resolve(node_path.dirname(importerAbs), spec));
  if (!node_path.extname(resolved)) {
    for (const ext of [".vue", ".js", ".ts", ".mjs", ".json"]) {
      if (node_fs.existsSync(resolved + ext)) return resolved + ext;
    }
    if (node_fs.existsSync(node_path.join(resolved, "index.vue"))) return normalizePath(node_path.join(resolved, "index.vue"));
    if (node_fs.existsSync(node_path.join(resolved, "index.js"))) return normalizePath(node_path.join(resolved, "index.js"));
  }
  return node_fs.existsSync(resolved) ? resolved : null;
}
function fingerprintScript(script, pageAbs, inputDir, aliases) {
  const specs = extractStaticImports(script);
  const contentHashes = {};
  for (const spec of specs) {
    const abs = resolveSpecifier(pageAbs, spec, inputDir, aliases);
    if (abs && node_fs.existsSync(abs)) {
      try {
        if (node_fs.statSync(abs).isDirectory()) continue;
        contentHashes[abs] = sha(node_fs.readFileSync(abs));
      } catch {
      }
    }
  }
  const pathKey = specs.join("\0");
  const contentKey = Object.keys(contentHashes).sort().map((k) => k + "=" + contentHashes[k]).join("\0");
  return {
    specs,
    contentHashes,
    pathOnlyDigest: sha(pathKey),
    digest: sha(pathKey + "\n" + contentKey)
  };
}
function listPagesFromJson(inputDir) {
  const pagesJson = JSON.parse(node_fs.readFileSync(node_path.join(inputDir, "pages.json"), "utf8"));
  const pages = [];
  for (const p of pagesJson.pages || []) {
    const path = typeof p === "string" ? p : p.path;
    if (path && !path.startsWith("ext://")) pages.push(normalizePath(path));
  }
  for (const sub of pagesJson.subPackages || pagesJson.subpackages || []) {
    const root = sub.root || "";
    for (const p of sub.pages || []) {
      const path = typeof p === "string" ? p : p.path;
      if (!path || path.startsWith("ext://")) continue;
      pages.push(normalizePath(node_path.join(root, path)));
    }
  }
  return [...new Set(pages)];
}
function pageFileCandidates(inputDir, pagePath) {
  const base = node_path.join(inputDir, pagePath);
  const out = [];
  for (const ext of [".vue", ".nvue", ".js", ".ts"]) {
    if (node_fs.existsSync(base + ext)) out.push(normalizePath(base + ext));
  }
  return out;
}
const SKIP_ENTRY = "\0unifast-optc-ext-skip-entry";
function createInitialState() {
  return {
    enabled: true,
    mode: "optc-ext",
    active: false,
    dirtyPages: [],
    reason: "init",
    reasonCode: "init",
    path: "full",
    round: 0,
    lastDecision: null,
    seeded: false,
    pageCount: 0,
    viteSkipped: false,
    lastEmit: null,
    skipRebuild: false,
    // Risk-harden: dual-speed observability + integrity
    pathStats: { full: 0, "optc-ext": 0, incremental: 0 },
    reasonCounts: {},
    pageOnlyEmitCount: 0,
    integrityChecks: 0,
    lastIntegrity: null,
    vendorShaAtSeed: null,
    integrityForcedFull: 0
  };
}
function createOptCExtPlugin(opts = {}) {
  const state = createInitialState();
  globalThis.__UNI_FAST_OPTC_EXT__ = state;
  globalThis.__UNI_FAST_PAGE_INC__ = state;
  let inputDir = opts.inputDir || process.env.UNI_INPUT_DIR || "";
  let outDir = opts.outDir || process.env.UNI_OUTPUT_DIR || "";
  let aliases = Object.entries(opts.aliases || {});
  let allPages = [];
  let pageFiles = /* @__PURE__ */ new Map();
  let fingerprints = /* @__PURE__ */ new Map();
  let inputCaptured = false;
  let round = 0;
  let watchChangeAt = 0;
  let watchKeep = [];
  let reverseDeps = /* @__PURE__ */ new Map();
  let componentFp = /* @__PURE__ */ new Map();
  let pendingWatchIds = [];
  let watchFlushScheduled = false;
  function collectWatchKeep(root) {
    const out = [];
    const exts = /* @__PURE__ */ new Set([".vue", ".nvue", ".js", ".ts", ".mjs", ".scss", ".sass", ".css", ".json"]);
    function walk(dir, depth) {
      if (depth > 14) return;
      let entries;
      try {
        entries = node_fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.name === "node_modules" || e.name === "dist" || e.name.startsWith(".")) continue;
        const p = node_path.join(dir, e.name);
        if (e.isDirectory()) walk(p, depth + 1);
        else if (exts.has(node_path.extname(e.name))) out.push(normalizePath(p));
      }
    }
    if (root) walk(root, 0);
    return out;
  }
  function refreshAliasFromConfig(config) {
    const a = config?.resolve?.alias;
    const map = {};
    if (Array.isArray(a)) {
      for (const item of a) {
        if (item && item.find && item.replacement) map[String(item.find)] = String(item.replacement);
      }
    } else if (a && typeof a === "object") {
      Object.assign(map, a);
    }
    if (!map["@"] && inputDir) map["@"] = inputDir;
    aliases = Object.entries(map);
  }
  function seedAll() {
    fingerprints.clear();
    pageFiles.clear();
    allPages = listPagesFromJson(inputDir);
    state.pageCount = allPages.length;
    let seededOk = 0;
    let seededErr = 0;
    for (const pagePath of allPages) {
      try {
        const files = pageFileCandidates(inputDir, pagePath);
        for (const f of files) pageFiles.set(f, pagePath);
        if (!files.length) continue;
        if (node_fs.statSync(files[0]).isDirectory()) {
          seededErr++;
          continue;
        }
        const sections = parseVueSections(files[0]);
        const fp = fingerprintScript(sections.script, files[0], inputDir, aliases);
        fingerprints.set(pagePath, {
          file: files[0],
          templateHash: sections.templateHash,
          styleHash: sections.styleHash,
          scriptHash: sections.scriptHash,
          script: sections.script,
          fp
        });
        seededOk++;
      } catch (e) {
        seededErr++;
        console.warn("[unifast-optc-ext] seed skip", pagePath, e.message);
      }
    }
    reverseDeps = /* @__PURE__ */ new Map();
    for (const [pagePath, meta] of fingerprints) {
      const hashes = meta.fp?.contentHashes || {};
      for (const abs of Object.keys(hashes)) {
        const n = normalizePath(abs);
        if (!reverseDeps.has(n)) reverseDeps.set(n, /* @__PURE__ */ new Set());
        reverseDeps.get(n).add(pagePath);
      }
    }
    state.sharedMultiPageCount = [...reverseDeps.values()].filter((s) => s.size > 1).length;
    state.reverseDepFiles = reverseDeps.size;
    componentFp = /* @__PURE__ */ new Map();
    for (const abs of reverseDeps.keys()) {
      if (!/\.vue$/i.test(abs)) continue;
      try {
        const parts = parseVueScriptParts(node_fs.readFileSync(abs, "utf8"));
        componentFp.set(normalizePath(abs), {
          templateHash: parts.templateHash,
          styleHash: parts.styleHash,
          script: parts.script,
          scriptHash: parts.scriptHash
        });
      } catch (e) {
        console.warn("[unifast-optc-ext] componentFp seed skip", abs, e.message);
      }
    }
    state.componentFpCount = componentFp.size;
    try {
      const easy = seedEasycomIntoFingerprints(inputDir, fingerprints, reverseDeps, aliases);
      state.easycomSeedEdges = easy.edgeCount;
      state.easycomSeedFiles = easy.fileCount;
      state.easycomExternalFiles = (easy.externalPaths || []).length;
      state.easycomAutoscan = easy.easycom?.autoscan !== false;
      state.easycomCustomRules = Object.keys(easy.easycom?.custom || {}).length;
      state.sharedMultiPageCount = [...reverseDeps.values()].filter((s) => s.size > 1).length;
      state.reverseDepFiles = reverseDeps.size;
      for (const abs of reverseDeps.keys()) {
        if (!/\.vue$/i.test(abs)) continue;
        if (componentFp.has(normalizePath(abs))) continue;
        try {
          const parts = parseVueScriptParts(node_fs.readFileSync(abs, "utf8"));
          componentFp.set(normalizePath(abs), {
            templateHash: parts.templateHash,
            styleHash: parts.styleHash,
            script: parts.script,
            scriptHash: parts.scriptHash
          });
        } catch {
        }
      }
      state.componentFpCount = componentFp.size;
    } catch (e) {
      console.warn("[unifast-optc-ext] easycom seed failed", e.message);
      state.easycomSeedError = e.message;
    }
    state.seeded = true;
    state.seededOk = seededOk;
    state.seededErr = seededErr;
    watchKeep = collectWatchKeep(inputDir);
    state.watchKeepCount = watchKeep.length;
    snapshotVendorSha();
    state.pageOnlyEmitCount = 0;
    state.integrityChecks = 0;
  }
  function reasonCodeOf(path, reason) {
    const r = String(reason || "");
    if (path === "full") {
      if (r.startsWith("integrity")) return "FULL_INTEGRITY";
      if (r.includes("template")) return "FULL_TEMPLATE";
      if (r.includes("style")) return "FULL_STYLE";
      if (r.includes("shared") || r.includes("multi-page") || r.includes("over-threshold"))
        return "FULL_SHARED";
      if (r.includes("import-set") || r.includes("cjs-require")) return "FULL_IMPORT_SET";
      if (r.includes("manifest") || r.includes("pages-or")) return "FULL_CONFIG";
      if (r.includes("app-entry")) return "FULL_APP";
      if (r.includes("global-style")) return "FULL_STYLE";
      if (r.includes("easycom-external")) return "FULL_EASYCOM";
      if (r.includes("options-api") || r.includes("options-only")) return "FULL_OPTIONS";
      if (r.includes("vue-macro") || r.includes("macros")) return "FULL_MACROS";
      if (r.includes("new-file") || r.includes("never-seeded")) return "FULL_NEW_FILE";
      if (r.includes("fail") || r.includes("missing") || r.includes("unmapped"))
        return "FULL_FAIL_CLOSED";
      return "FULL_OTHER";
    }
    if (r.includes("midpath")) return "FAST_MIDPATH";
    if (r.includes("closure-vue")) return "FAST_CLOSURE_VUE";
    if (r.includes("closure")) return "FAST_CLOSURE";
    if (r.includes("option-a")) return "FAST_OPTION_A";
    if (r.includes("import-set-and-dep") || r.includes("stable")) return "FAST_PAGE";
    return "FAST_OTHER";
  }
  function setDecision(path, reason, extra = {}) {
    const reasonCode = reasonCodeOf(path, reason);
    state.path = path;
    state.reason = reason;
    state.reasonCode = reasonCode;
    state.active = path === "optc-ext" || path === "incremental";
    if (!state.pathStats) state.pathStats = { full: 0, "optc-ext": 0, incremental: 0 };
    if (!state.reasonCounts) state.reasonCounts = {};
    state.pathStats[path] = (state.pathStats[path] || 0) + 1;
    state.reasonCounts[reasonCode] = (state.reasonCounts[reasonCode] || 0) + 1;
    state.lastDecision = {
      path,
      reason,
      reasonCode,
      dirtyPages: [...state.dirtyPages],
      ...extra,
      at: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  function forceFull(reason, extra) {
    state.dirtyPages = [];
    state.skipRebuild = false;
    state.viteSkipped = false;
    setDecision("full", reason, extra);
  }
  function snapshotVendorSha() {
    try {
      const v = node_path.join(outDir, "common/vendor.js");
      if (outDir && node_fs.existsSync(v)) {
        state.vendorShaAtSeed = sha(node_fs.readFileSync(v));
      }
    } catch {
    }
  }
  function collectSharedSourceDrifts() {
    const drifts = [];
    for (const [, meta] of fingerprints) {
      const hashes = meta.fp?.contentHashes || {};
      for (const abs of Object.keys(hashes)) {
        const expected = hashes[abs];
        if (!node_fs.existsSync(abs)) {
          drifts.push({ abs, kind: "missing-source" });
          continue;
        }
        try {
          if (node_fs.statSync(abs).isDirectory()) continue;
          const now = sha(node_fs.readFileSync(abs));
          if (now !== expected) {
            drifts.push({
              abs,
              kind: "source-hash-mismatch",
              expected: String(expected).slice(0, 16),
              now: now.slice(0, 16)
            });
          }
        } catch (e) {
          drifts.push({ abs, kind: "read-error", message: e.message });
        }
      }
    }
    return drifts;
  }
  function checkVendorDrift() {
    if (!state.vendorShaAtSeed || !outDir) return null;
    const v = node_path.join(outDir, "common/vendor.js");
    if (!node_fs.existsSync(v)) return { kind: "vendor-missing" };
    const now = sha(node_fs.readFileSync(v));
    if (now !== state.vendorShaAtSeed) {
      return {
        kind: "vendor-sha-mismatch",
        expected: state.vendorShaAtSeed.slice(0, 16),
        now: now.slice(0, 16)
      };
    }
    return null;
  }
  function maybeIntegrityGate(context = {}) {
    state.pageOnlyEmitCount = (state.pageOnlyEmitCount || 0) + 1;
    const every = Number(process.env.UNI_FAST_OPTC_INTEGRITY_EVERY ?? 10);
    if (!Number.isFinite(every) || every <= 0) return false;
    if (state.pageOnlyEmitCount % every !== 0) return false;
    state.integrityChecks = (state.integrityChecks || 0) + 1;
    const drifts = collectSharedSourceDrifts();
    const vendorDrift = checkVendorDrift();
    const payload = {
      pageOnlyEmitCount: state.pageOnlyEmitCount,
      integrityChecks: state.integrityChecks,
      driftCount: drifts.length,
      drifts: drifts.slice(0, 12),
      vendorDrift,
      context,
      at: (/* @__PURE__ */ new Date()).toISOString()
    };
    state.lastIntegrity = payload;
    console.log("UNI_FAST_OPTC_EXT_INTEGRITY " + JSON.stringify(payload));
    if (drifts.length || vendorDrift) {
      state.integrityForcedFull = (state.integrityForcedFull || 0) + 1;
      forceFull("integrity-drift", {
        driftCount: drifts.length,
        vendorDrift,
        pageOnlyEmitCount: state.pageOnlyEmitCount
      });
      return true;
    }
    return false;
  }
  function commitFastPath(reason, extra = {}) {
    setDecision("optc-ext", reason, extra);
    maybeIntegrityGate({ reason, pagePath: extra.pagePath || extra.file || null });
  }
  function hasConditionalCompileDirectiveChange(oldScript, newScript) {
    const re = /#ifdef\b|#ifndef\b|#endif\b/;
    const o = re.test(oldScript || "");
    const n = re.test(newScript || "");
    if (o !== n) return true;
    if (!n) return false;
    return (oldScript || "") !== (newScript || "");
  }
  function tryOptC(pagePath, fileAbs) {
    const prev = fingerprints.get(pagePath);
    const sections = parseVueSections(fileAbs);
    const nextFp = fingerprintScript(sections.script, fileAbs, inputDir, aliases);
    if (!prev) {
      fingerprints.set(pagePath, {
        file: fileAbs,
        templateHash: sections.templateHash,
        styleHash: sections.styleHash,
        scriptHash: sections.scriptHash,
        script: sections.script,
        fp: nextFp
      });
      forceFull("no-prior-fingerprint", { pagePath });
      return;
    }
    if (sections.templateHash !== prev.templateHash) {
      Object.assign(prev, {
        templateHash: sections.templateHash,
        styleHash: sections.styleHash,
        scriptHash: sections.scriptHash,
        script: sections.script,
        fp: nextFp
      });
      forceFull("template-changed", { pagePath });
      return;
    }
    if (sections.styleHash !== prev.styleHash) {
      Object.assign(prev, {
        templateHash: sections.templateHash,
        styleHash: sections.styleHash,
        scriptHash: sections.scriptHash,
        script: sections.script,
        fp: nextFp
      });
      forceFull("style-changed", { pagePath });
      return;
    }
    if (hasConditionalCompileDirectiveChange(prev.script, sections.script)) {
      Object.assign(prev, {
        templateHash: sections.templateHash,
        styleHash: sections.styleHash,
        scriptHash: sections.scriptHash,
        script: sections.script,
        fp: nextFp
      });
      forceFull("conditional-compile-changed", { pagePath });
      return;
    }
    {
      const prevRequireList = extractCjsRequires(prev.script || "");
      const nextRequireList = extractCjsRequires(sections.script || "");
      if (prevRequireList.join("\0") !== nextRequireList.join("\0")) {
        Object.assign(prev, {
          templateHash: sections.templateHash,
          styleHash: sections.styleHash,
          scriptHash: sections.scriptHash,
          script: sections.script,
          fp: nextFp
        });
        forceFull("cjs-require-set-changed", {
          pagePath,
          prevRequires: prevRequireList,
          nextRequires: nextRequireList
        });
        return;
      }
    }
    const pathStable = prev.fp.pathOnlyDigest === nextFp.pathOnlyDigest;
    const contentStable = prev.fp.digest === nextFp.digest;
    scriptLooksOptionsOnly(sections.script);
    scriptHasVueMacros(sections.script);
    if (!pathStable) {
      const mid = emitOptCExtMidpathSync({
        outDir,
        pagePath,
        oldScript: prev.script,
        newScript: sections.script,
        allowImportSetChange: true
      });
      if (mid.ok && mid.allExternalsOnDisk !== false) {
        prev.fp = nextFp;
        prev.scriptHash = sections.scriptHash;
        prev.script = sections.script;
        state.dirtyPages = [pagePath];
        state.skipRebuild = true;
        state.viteSkipped = true;
        state.__benchEmitted = false;
        state.lastEmit = { ...mid, emitMs: mid.timings?.totalMs || 0, watchChangeAt };
        commitFastPath("midpath-import-set", {
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
          midpath: true
        });
        console.log(
          "UNI_FAST_OPTC_EXT_EMIT " + JSON.stringify({
            pagePath,
            filesWritten: mid.filesWritten,
            emitMs: mid.timings?.totalMs,
            emitClass: mid.emitClass,
            reason: mid.reason,
            afterSha: mid.afterSha,
            midpath: true
          })
        );
        return;
      }
      prev.fp = nextFp;
      prev.scriptHash = sections.scriptHash;
      prev.script = sections.script;
      forceFull("import-set-changed", {
        pagePath,
        pathStable,
        contentStable,
        midpathAttempt: { ok: mid.ok, reason: mid.reason }
      });
      return;
    }
    if (!contentStable) {
      prev.fp = nextFp;
      prev.scriptHash = sections.scriptHash;
      prev.script = sections.script;
      forceFull("dep-content-changed", { pagePath, pathStable, contentStable });
      return;
    }
    if (process.env.UNI_FAST_OPTC_FORCE_MIDPATH === "1") {
      const mid = emitOptCExtMidpathSync({
        outDir,
        pagePath,
        oldScript: prev.script,
        newScript: sections.script,
        allowImportSetChange: false
      });
      if (mid.ok && mid.allExternalsOnDisk !== false) {
        prev.fp = nextFp;
        prev.scriptHash = sections.scriptHash;
        prev.script = sections.script;
        state.dirtyPages = [pagePath];
        state.skipRebuild = true;
        state.viteSkipped = true;
        state.__benchEmitted = false;
        state.lastEmit = { ...mid, emitMs: mid.timings?.totalMs || 0, watchChangeAt };
        commitFastPath("midpath-forced", {
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
          forced: true
        });
        console.log(
          "UNI_FAST_OPTC_EXT_EMIT " + JSON.stringify({
            pagePath,
            filesWritten: mid.filesWritten,
            emitMs: mid.timings?.totalMs,
            emitClass: mid.emitClass,
            reason: mid.reason,
            afterSha: mid.afterSha,
            midpath: true,
            forced: true
          })
        );
        return;
      }
      prev.fp = nextFp;
      prev.scriptHash = sections.scriptHash;
      prev.script = sections.script;
      forceFull("optc-force-midpath-failed", {
        pagePath,
        midpathAttempt: { ok: mid.ok, reason: mid.reason }
      });
      return;
    }
    const emitStart = node_perf_hooks.performance.now();
    const emit = emitOptCExtPage({
      outDir,
      pagePath,
      oldScript: prev.script,
      newScript: sections.script
    });
    const emitMs = node_perf_hooks.performance.now() - emitStart;
    if (!emit.ok) {
      const mid = emitOptCExtMidpathSync({
        outDir,
        pagePath,
        oldScript: prev.script,
        newScript: sections.script,
        allowImportSetChange: false
      });
      if (mid.ok && mid.allExternalsOnDisk !== false) {
        prev.fp = nextFp;
        prev.scriptHash = sections.scriptHash;
        prev.script = sections.script;
        state.dirtyPages = [pagePath];
        state.skipRebuild = true;
        state.viteSkipped = true;
        state.__benchEmitted = false;
        state.lastEmit = { ...mid, emitMs: mid.timings?.totalMs || 0, watchChangeAt };
        commitFastPath("midpath-after-cascade-fail", {
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
          midpath: true
        });
        console.log(
          "UNI_FAST_OPTC_EXT_EMIT " + JSON.stringify({
            pagePath,
            filesWritten: mid.filesWritten,
            emitMs: mid.timings?.totalMs,
            emitClass: mid.emitClass,
            reason: mid.reason,
            priorCascadeReason: emit.reason,
            afterSha: mid.afterSha,
            midpath: true
          })
        );
        return;
      }
      prev.fp = nextFp;
      prev.scriptHash = sections.scriptHash;
      prev.script = sections.script;
      forceFull("optc-emit-failed", {
        pagePath,
        emitReason: emit.reason,
        emit,
        midpathAttempt: { ok: mid.ok, reason: mid.reason }
      });
      return;
    }
    if (emit.allExternalsOnDisk === false) {
      prev.fp = nextFp;
      prev.scriptHash = sections.scriptHash;
      prev.script = sections.script;
      forceFull("optc-externals-missing", {
        pagePath,
        emitReason: emit.reason,
        missing: (emit.externals || []).filter((e) => !e.exists),
        emit
      });
      return;
    }
    prev.scriptHash = sections.scriptHash;
    prev.script = sections.script;
    prev.fp = nextFp;
    state.dirtyPages = [pagePath];
    state.skipRebuild = true;
    state.viteSkipped = true;
    state.__benchEmitted = false;
    state.lastEmit = { ...emit, emitMs, watchChangeAt };
    commitFastPath("import-set-and-dep-content-stable", {
      pagePath,
      pathStable,
      contentStable,
      emitReason: emit.reason,
      emitClass: emit.emitClass || emit.reason,
      filesWritten: emit.filesWritten,
      afterSha: emit.afterSha,
      allExternalsOnDisk: emit.allExternalsOnDisk,
      requireCount: emit.requireCount,
      viteSkipped: true
    });
    console.log(
      "UNI_FAST_OPTC_EXT_EMIT " + JSON.stringify({
        pagePath,
        filesWritten: emit.filesWritten,
        emitMs,
        emitClass: emit.emitClass || emit.reason,
        reason: emit.reason,
        changes: emit.changes,
        afterSha: emit.afterSha,
        allExternalsOnDisk: emit.allExternalsOnDisk,
        requireCount: emit.requireCount
      })
    );
  }
  function absToPage(id) {
    const clean = normalizePath(id.split("?")[0]);
    if (pageFiles.has(clean)) return pageFiles.get(clean);
    if (inputDir && clean.startsWith(normalizePath(inputDir))) {
      const rel = node_path.relative(inputDir, clean);
      const noExt = normalizePath(rel).replace(/\.(vue|nvue|js|ts)$/, "");
      if (fingerprints.has(noExt)) return noExt;
    }
    return null;
  }
  function contentHashesHas(absPath) {
    const n = normalizePath(absPath);
    for (const meta of fingerprints.values()) {
      if (meta?.fp?.contentHashes && meta.fp.contentHashes[n]) return true;
    }
    return false;
  }
  function handleOneWatchFile(clean) {
    if (!inputDir) return;
    if (clean.endsWith("pages.json") || clean.endsWith("manifest.json")) {
      forceFull("pages-or-manifest-changed", { file: clean });
      return;
    }
    if (clean.endsWith("App.vue") || clean.endsWith("/main.js") || clean.endsWith("/main.ts")) {
      forceFull("app-entry-changed", { file: clean });
      return;
    }
    if (clean.endsWith("uni.scss") || clean.endsWith("uni.less") || clean.endsWith("/theme.scss") || clean.endsWith("/variables.scss")) {
      forceFull("global-style-changed", { file: clean });
      return;
    }
    const pagePath = absToPage(clean);
    if (pagePath) {
      tryOptC(pagePath, clean);
      return;
    }
    if (clean.startsWith(normalizePath(inputDir))) {
      {
        const known = reverseDeps.has(clean) || componentFp.has(clean) || contentHashesHas(clean) || pageFiles.has(clean);
        const isSource = /\.(vue|nvue|js|mjs|ts|tsx|jsx|json|scss|sass|less|css)$/i.test(clean);
        if (!known && isSource && !clean.endsWith("pages.json") && !clean.endsWith("manifest.json")) {
          try {
            const st = node_fs.statSync(clean);
            if (st.isFile()) {
              forceFull("new-file-never-seeded", {
                file: normalizePath(node_path.relative(inputDir, clean)),
                hint: "Path not in cold FP/reverseDeps \u2014 fail-closed full to seed"
              });
              return;
            }
          } catch {
          }
        }
      }
      const importers = reverseDeps.get(clean);
      const importerCount = importers ? importers.size : 0;
      const rel = normalizePath(node_path.relative(inputDir, clean));
      const closureMax = Number(process.env.UNI_FAST_OPTC_CLOSURE_MAX || 3);
      const looksSharedPath = /(^|\/)(components|modules|utils|common|libs|shared|store|mixins|plugins|composables|services|hooks|uni_modules)(\/|$)/.test(
        rel
      );
      const isVueSfc = /\.vue$/i.test(clean);
      const isScriptUtil = /\.(js|mjs|ts)$/i.test(clean);
      const vueMax = Number(process.env.UNI_FAST_OPTC_CLOSURE_VUE_MAX || 512);
      if (isVueSfc && importerCount >= 1 && importerCount <= vueMax) {
        const prevComp = componentFp.get(clean);
        const parts = parseVueScriptParts(node_fs.readFileSync(clean, "utf8"));
        if (!prevComp) {
          componentFp.set(clean, {
            templateHash: parts.templateHash,
            styleHash: parts.styleHash,
            script: parts.script,
            scriptHash: parts.scriptHash
          });
          forceFull("shared-vue-no-prior-fp", {
            file: rel,
            importerCount,
            hint: "F12: first sight of component \u2014 full once to seed"
          });
          return;
        }
        if (parts.templateHash !== prevComp.templateHash || parts.styleHash !== prevComp.styleHash) {
          componentFp.set(clean, {
            templateHash: parts.templateHash,
            styleHash: parts.styleHash,
            script: parts.script,
            scriptHash: parts.scriptHash
          });
          forceFull("shared-vue-template-or-style", {
            file: rel,
            importerCount,
            templateChanged: parts.templateHash !== prevComp.templateHash,
            styleChanged: parts.styleHash !== prevComp.styleHash
          });
          return;
        }
        if (parts.scriptHash === prevComp.scriptHash) {
          state.skipRebuild = true;
          state.viteSkipped = true;
          commitFastPath("closure-vue-noop", { file: rel });
          return;
        }
        const clo = emitClosureVueComponentSync({
          inputDir,
          outDir,
          sourceAbs: clean,
          oldScript: prevComp.script,
          newScript: parts.script
        });
        if (clo.ok) {
          componentFp.set(clean, {
            templateHash: parts.templateHash,
            styleHash: parts.styleHash,
            script: parts.script,
            scriptHash: parts.scriptHash
          });
          const nextHash = sha(node_fs.readFileSync(clean));
          for (const pagePath2 of importers) {
            const meta = fingerprints.get(pagePath2);
            if (!meta?.fp?.contentHashes) continue;
            meta.fp.contentHashes[clean] = nextHash;
            const contentKey = Object.keys(meta.fp.contentHashes).sort().map((k) => k + "=" + meta.fp.contentHashes[k]).join("\0");
            meta.fp.digest = sha((meta.fp.specs || []).join("\0") + "\n" + contentKey);
          }
          state.dirtyPages = [...importers].slice(0, 8);
          state.skipRebuild = true;
          state.viteSkipped = true;
          state.__benchEmitted = false;
          state.lastEmit = {
            ...clo,
            emitMs: clo.timings?.totalMs || 0,
            watchChangeAt,
            importerCount
          };
          commitFastPath("closure-vue-script", {
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
            closureRebuild: "vue-script-only"
          });
          console.log(
            "UNI_FAST_OPTC_EXT_EMIT " + JSON.stringify({
              file: rel,
              filesWritten: clo.filesWritten,
              emitMs: clo.timings?.totalMs,
              emitClass: clo.emitClass,
              pageEmitClass: clo.pageEmitClass,
              reason: clo.reason,
              afterSha: clo.afterSha,
              importerCount,
              closureVue: true
            })
          );
          return;
        }
        componentFp.set(clean, {
          templateHash: parts.templateHash,
          styleHash: parts.styleHash,
          script: parts.script,
          scriptHash: parts.scriptHash
        });
        forceFull("shared-vue-closure-failed", {
          file: rel,
          importerCount,
          closureAttempt: { ok: clo.ok, reason: clo.reason, pageEmitClass: clo.pageEmitClass }
        });
        return;
      }
      const utilImporters = isScriptUtil && !isVueSfc ? findUtilImportersOf(inputDir, clean) : [];
      const canTryUtilClosure = isScriptUtil && !isVueSfc && importerCount <= closureMax && (importerCount >= 1 || utilImporters.length > 0 || !!resolveSharedDistChunk(inputDir, outDir, clean));
      if (canTryUtilClosure && importerCount <= closureMax) {
        const clo = utilImporters.length > 0 && importerCount === 0 ? emitClosureMultiChunkSync({
          inputDir,
          outDir,
          sourceAbs: clean,
          alsoRegenSources: []
        }) : emitClosureSharedChunkSync({
          inputDir,
          outDir,
          sourceAbs: clean
        });
        if (clo.ok) {
          const nextHash = sha(node_fs.readFileSync(clean));
          for (const pagePath2 of importers || []) {
            const meta = fingerprints.get(pagePath2);
            if (!meta?.fp?.contentHashes) continue;
            meta.fp.contentHashes[clean] = nextHash;
            const contentKey = Object.keys(meta.fp.contentHashes).sort().map((k) => k + "=" + meta.fp.contentHashes[k]).join("\0");
            meta.fp.digest = sha((meta.fp.specs || []).join("\0") + "\n" + contentKey);
          }
          if (importerCount === 0 && utilImporters.length) {
            for (const uAbs of utilImporters) {
              const uImps = reverseDeps.get(normalizePath(uAbs));
              if (!uImps) continue;
              for (const pagePath2 of uImps) {
                const meta = fingerprints.get(pagePath2);
                if (!meta?.fp?.contentHashes) continue;
                if (meta.fp.contentHashes[clean] != null) {
                  meta.fp.contentHashes[clean] = nextHash;
                }
              }
            }
          }
          state.dirtyPages = importers ? [...importers].slice(0, 8) : [];
          state.skipRebuild = true;
          state.viteSkipped = true;
          state.__benchEmitted = false;
          state.lastEmit = {
            ...clo,
            emitMs: clo.timings?.totalMs || 0,
            watchChangeAt,
            importerCount,
            utilImporterCount: utilImporters.length
          };
          commitFastPath("closure-shared-chunk", {
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
            closureRebuild: importerCount === 0 ? "leaf-chunk-regen" : "chunk-regen"
          });
          console.log(
            "UNI_FAST_OPTC_EXT_EMIT " + JSON.stringify({
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
              closure: true
            })
          );
          return;
        }
        if (clo.optionACandidate && importerCount >= 1 && importerCount <= closureMax) {
          if (clo.reason === "closure-dist-chunk-missing") {
            const pageUpdatesNd = [];
            let pagesReadyNd = true;
            for (const pagePath2 of importers) {
              const meta = fingerprints.get(pagePath2);
              if (!meta?.file) {
                pagesReadyNd = false;
                break;
              }
              let sections;
              try {
                sections = parseVueSections(meta.file);
              } catch {
                pagesReadyNd = false;
                break;
              }
              pageUpdatesNd.push({
                pagePath: pagePath2,
                pageAbs: meta.file,
                oldScript: meta.script || "",
                newScript: sections.script
              });
            }
            if (!pagesReadyNd) {
              forceFull("shared-module-option-a-blocked", {
                file: rel,
                importerCount,
                reason: "option-a-inlined-pages-not-ready",
                hint: "F16 no-dist: missing page fingerprint/file"
              });
              return;
            }
            const usedNd = emitOptionANoDistPageRebundleSync({
              inputDir,
              outDir,
              sourceAbs: clean,
              pageUpdates: pageUpdatesNd,
              requireNoDist: true
            });
            if (usedNd.ok) {
              const nextHash = sha(node_fs.readFileSync(clean));
              for (const pr of usedNd.pageResults || []) {
                const meta = fingerprints.get(pr.pagePath);
                if (!meta) continue;
                if (pr.emitClass && pr.emitClass !== "noop") {
                  try {
                    const sections = parseVueSections(meta.file);
                    const nextFp = fingerprintScript(
                      sections.script,
                      meta.file,
                      inputDir,
                      aliases
                    );
                    meta.script = sections.script;
                    meta.scriptHash = sections.scriptHash;
                    meta.fp = nextFp;
                  } catch {
                  }
                }
                if (meta.fp?.contentHashes) {
                  meta.fp.contentHashes[clean] = nextHash;
                  const contentKey = Object.keys(meta.fp.contentHashes).sort().map((k) => k + "=" + meta.fp.contentHashes[k]).join("\0");
                  meta.fp.digest = sha((meta.fp.specs || []).join("\0") + "\n" + contentKey);
                }
              }
              for (const pagePath2 of importers) {
                const meta = fingerprints.get(pagePath2);
                if (!meta?.fp?.contentHashes) continue;
                meta.fp.contentHashes[clean] = nextHash;
                const contentKey = Object.keys(meta.fp.contentHashes).sort().map((k) => k + "=" + meta.fp.contentHashes[k]).join("\0");
                meta.fp.digest = sha((meta.fp.specs || []).join("\0") + "\n" + contentKey);
              }
              state.dirtyPages = [
                .../* @__PURE__ */ new Set([
                  ...importers,
                  ...(usedNd.pageResults || []).filter((p) => p.ok && p.changed).map((p) => p.pagePath)
                ])
              ].slice(0, 8);
              state.skipRebuild = true;
              state.viteSkipped = true;
              state.__benchEmitted = false;
              state.lastEmit = {
                ...usedNd,
                emitMs: usedNd.timings?.totalMs || 0,
                watchChangeAt,
                importerCount,
                optionA: "inlined-no-dist-page-rebundle"
              };
              commitFastPath("option-a-inlined-page-rebundle", {
                file: rel,
                importerCount,
                emitReason: usedNd.reason,
                emitClass: usedNd.emitClass,
                filesWritten: usedNd.filesWritten,
                pageResults: usedNd.pageResults,
                afterSha: usedNd.afterSha,
                viteSkipped: true,
                proxyForInlined: true,
                optionA: "inlined-no-dist-page-rebundle"
              });
              console.log(
                "UNI_FAST_OPTC_EXT_EMIT " + JSON.stringify({
                  file: rel,
                  filesWritten: usedNd.filesWritten,
                  emitMs: usedNd.timings?.totalMs,
                  emitClass: usedNd.emitClass,
                  reason: usedNd.reason,
                  pageEmits: (usedNd.pageResults || []).filter((p) => p.ok && p.changed).length,
                  afterSha: usedNd.afterSha,
                  importerCount,
                  optionA: "inlined-no-dist-page-rebundle",
                  proxyForInlined: true
                })
              );
              return;
            }
            forceFull("shared-module-option-a-blocked", {
              file: rel,
              importerCount,
              closureAttempt: { ok: clo.ok, reason: clo.reason },
              optionAAttempt: {
                ok: usedNd.ok,
                reason: usedNd.reason,
                pageResults: usedNd.pageResults
              },
              hint: "F16 no-dist inlined page rebundle failed \u2014 fail-closed to full"
            });
            return;
          }
          const coldExports = clo.coldExports || [];
          const srcExports = clo.srcExports || (node_fs.existsSync(clean) ? extractEsmExportNames(node_fs.readFileSync(clean, "utf8")) : []);
          const surface = classifyExportSurfaceChange(coldExports, srcExports);
          const pageUpdates = [];
          let pagesReady = true;
          for (const pagePath2 of importers) {
            const meta = fingerprints.get(pagePath2);
            if (!meta?.file) {
              pagesReady = false;
              break;
            }
            let sections;
            try {
              sections = parseVueSections(meta.file);
            } catch (e) {
              pagesReady = false;
              break;
            }
            const used = extractNamedImportsForResolved(
              sections.script,
              meta.file,
              inputDir,
              clean
            );
            const missing = used.filter((n) => !srcExports.includes(n));
            if (missing.length) {
              forceFull("shared-module-option-a-blocked", {
                file: rel,
                importerCount,
                surface,
                reason: "option-a-page-imports-missing-export",
                missing,
                pagePath: pagePath2,
                hint: "Page still imports removed/renamed export \u2014 fail-closed full"
              });
              return;
            }
            pageUpdates.push({
              pagePath: pagePath2,
              pageAbs: meta.file,
              oldScript: meta.script || "",
              newScript: sections.script
            });
          }
          if (!pagesReady) {
            forceFull("shared-module-option-a-blocked", {
              file: rel,
              importerCount,
              surface,
              hint: "Option A: missing page fingerprint/file"
            });
            return;
          }
          const dirtyPages = pageUpdates.filter((p) => p.oldScript !== p.newScript);
          const allowAdd = surface.kind === "add-only";
          const allowAny = surface.kind === "rename-or-mixed" || surface.kind === "remove-only" || process.env.UNI_FAST_OPTC_OPTION_A === "1";
          if (allowAdd && dirtyPages.length === 0) {
            const cloAdd = emitClosureSharedChunkSync({
              inputDir,
              outDir,
              sourceAbs: clean,
              allowExportAdd: true
            });
            if (cloAdd.ok) {
              const nextHash = sha(node_fs.readFileSync(clean));
              for (const pagePath2 of importers) {
                const meta = fingerprints.get(pagePath2);
                if (!meta?.fp?.contentHashes) continue;
                meta.fp.contentHashes[clean] = nextHash;
                const contentKey = Object.keys(meta.fp.contentHashes).sort().map((k) => k + "=" + meta.fp.contentHashes[k]).join("\0");
                meta.fp.digest = sha((meta.fp.specs || []).join("\0") + "\n" + contentKey);
              }
              state.dirtyPages = [...importers].slice(0, 8);
              state.skipRebuild = true;
              state.viteSkipped = true;
              state.__benchEmitted = false;
              state.lastEmit = {
                ...cloAdd,
                emitMs: cloAdd.timings?.totalMs || 0,
                watchChangeAt,
                importerCount,
                optionA: "export-add-chunk-only"
              };
              commitFastPath("option-a-export-add", {
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
                optionA: "export-add-chunk-only"
              });
              console.log(
                "UNI_FAST_OPTC_EXT_EMIT " + JSON.stringify({
                  file: rel,
                  filesWritten: cloAdd.filesWritten,
                  emitMs: cloAdd.timings?.totalMs,
                  emitClass: cloAdd.emitClass,
                  reason: cloAdd.reason,
                  exportSurfaceMode: cloAdd.exportSurfaceMode,
                  afterSha: cloAdd.afterSha,
                  importerCount,
                  optionA: "export-add-chunk-only"
                })
              );
              return;
            }
          }
          if (allowAdd || allowAny || dirtyPages.length > 0) {
            const used = emitOptionABatchSync({
              inputDir,
              outDir,
              sourceAbs: clean,
              pageUpdates: dirtyPages.length > 0 ? dirtyPages : allowAdd ? [] : pageUpdates,
              allowExportAdd: true,
              allowExportSurfaceChange: surface.kind !== "add-only" || dirtyPages.length > 0
            });
            if (used.ok) {
              const nextHash = sha(node_fs.readFileSync(clean));
              for (const pr of used.pageResults || []) {
                const meta = fingerprints.get(pr.pagePath);
                if (!meta) continue;
                if (pr.emitClass && pr.emitClass !== "noop") {
                  try {
                    const sections = parseVueSections(meta.file);
                    const nextFp = fingerprintScript(
                      sections.script,
                      meta.file,
                      inputDir,
                      aliases
                    );
                    meta.script = sections.script;
                    meta.scriptHash = sections.scriptHash;
                    meta.fp = nextFp;
                  } catch {
                  }
                }
                if (meta.fp?.contentHashes) {
                  meta.fp.contentHashes[clean] = nextHash;
                  const contentKey = Object.keys(meta.fp.contentHashes).sort().map((k) => k + "=" + meta.fp.contentHashes[k]).join("\0");
                  meta.fp.digest = sha((meta.fp.specs || []).join("\0") + "\n" + contentKey);
                }
              }
              for (const pagePath2 of importers) {
                const meta = fingerprints.get(pagePath2);
                if (!meta?.fp?.contentHashes) continue;
                meta.fp.contentHashes[clean] = nextHash;
                const contentKey = Object.keys(meta.fp.contentHashes).sort().map((k) => k + "=" + meta.fp.contentHashes[k]).join("\0");
                meta.fp.digest = sha((meta.fp.specs || []).join("\0") + "\n" + contentKey);
              }
              state.dirtyPages = [
                .../* @__PURE__ */ new Set([
                  ...importers,
                  ...(used.pageResults || []).filter((p) => p.emitClass && p.emitClass !== "noop").map((p) => p.pagePath)
                ])
              ].slice(0, 8);
              state.skipRebuild = true;
              state.viteSkipped = true;
              state.__benchEmitted = false;
              state.lastEmit = {
                ...used,
                emitMs: used.timings?.totalMs || 0,
                watchChangeAt,
                importerCount,
                optionA: dirtyPages.length ? "chunk-plus-pages" : "chunk-surface"
              };
              commitFastPath("option-a-batch", {
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
                optionA: dirtyPages.length ? "chunk-plus-pages" : "chunk-surface"
              });
              console.log(
                "UNI_FAST_OPTC_EXT_EMIT " + JSON.stringify({
                  file: rel,
                  filesWritten: used.filesWritten,
                  emitMs: used.timings?.totalMs,
                  emitClass: used.emitClass,
                  reason: used.reason,
                  exportSurfaceMode: used.exportSurfaceMode,
                  pageEmits: (used.pageResults || []).filter(
                    (p) => p.emitClass && p.emitClass !== "noop"
                  ).length,
                  afterSha: used.afterSha,
                  importerCount,
                  optionA: dirtyPages.length ? "chunk-plus-pages" : "chunk-surface"
                })
              );
              return;
            }
            forceFull("shared-module-option-a-blocked", {
              file: rel,
              importerCount,
              surface,
              closureAttempt: { ok: clo.ok, reason: clo.reason },
              optionAAttempt: {
                ok: used.ok,
                reason: used.reason,
                pageResults: used.pageResults
              },
              hint: "F14 Option A failed \u2014 fail-closed to full"
            });
            return;
          }
          forceFull("shared-module-option-a-blocked", {
            file: rel,
            importerCount,
            surface,
            closureAttempt: { ok: clo.ok, reason: clo.reason },
            hint: "F14 Option A: surface change not safely patchable \u2014 full"
          });
          return;
        }
        forceFull("shared-module-closure-failed", {
          file: rel,
          importerCount,
          utilImporterCount: utilImporters.length,
          importers: importers ? [...importers].slice(0, 8) : [],
          closureRebuild: "failed-to-full",
          closureAttempt: {
            ok: clo.ok,
            reason: clo.reason,
            coldExports: clo.coldExports,
            srcExports: clo.srcExports
          }
        });
        return;
      }
      if (looksSharedPath || importerCount >= 1 || isVueSfc) {
        forceFull("shared-module-multi-page", {
          file: rel,
          importerCount,
          importers: importers ? [...importers].slice(0, 8) : [],
          closureRebuild: importerCount > closureMax ? "over-threshold-full" : "stub-full",
          closureMax,
          vueMax: Number(process.env.UNI_FAST_OPTC_CLOSURE_VUE_MAX || 512),
          hint: isVueSfc ? importerCount > Number(process.env.UNI_FAST_OPTC_CLOSURE_VUE_MAX || 512) ? "Vue SFC over CLOSURE_VUE_MAX importers \u2192 full" : "Vue SFC \u2192 full (script-only path not taken)" : "Shared/util/component change \u2192 full (importerCount over threshold or not script util)"
        });
        return;
      }
      forceFull("non-page-or-shared-changed", { file: rel, importerCount });
    } else {
      const n = normalizePath(clean);
      const importers = reverseDeps.get(n);
      if (importers && importers.size > 0) {
        forceFull("easycom-external-changed", {
          file: n,
          importerCount: importers.size,
          hint: "easycom/custom component outside src \u2014 fail-closed full"
        });
        return;
      }
      if (/node_modules\/@dcloudio\//.test(n) || /node_modules\/(@[^/]+\/)?uni-/.test(n)) {
        forceFull("easycom-external-changed", {
          file: n,
          hint: "uni/dcloudio package change outside src \u2014 fail-closed full"
        });
        return;
      }
    }
  }
  function flushWatchBatch(ids) {
    watchChangeAt = node_perf_hooks.performance.now();
    const cleaned = [];
    for (const id of ids) {
      const c = normalizePath(String(id).split("?")[0]);
      if (c && !cleaned.includes(c)) cleaned.push(c);
    }
    cleaned.sort((a, b) => {
      const ap = absToPage(a) ? 1 : 0;
      const bp = absToPage(b) ? 1 : 0;
      return ap - bp;
    });
    for (const clean of cleaned) {
      handleOneWatchFile(clean);
      if (state.path === "full" && !state.skipRebuild && !absToPage(clean)) break;
    }
  }
  return {
    name: "unifast-optc-ext",
    enforce: "pre",
    configResolved(config) {
      inputDir = normalizePath(opts.inputDir || process.env.UNI_INPUT_DIR || config.root || inputDir);
      outDir = normalizePath(
        opts.outDir || process.env.UNI_OUTPUT_DIR || node_path.join(config.root, "dist/dev/mp-weixin")
      );
      refreshAliasFromConfig(config);
      try {
        allPages = listPagesFromJson(inputDir);
        state.pageCount = allPages.length;
        for (const pagePath of allPages) {
          for (const f of pageFileCandidates(inputDir, pagePath)) pageFiles.set(f, pagePath);
        }
      } catch (e) {
        console.warn("[unifast-optc-ext] pages.json parse failed:", e.message);
      }
      globalThis.__UNI_FAST_OPTC_EXT__ = state;
      globalThis.__UNI_FAST_PAGE_INC__ = state;
    },
    options(rollupOptions) {
      if (!inputCaptured && rollupOptions.input && rollupOptions.input !== SKIP_ENTRY) {
        rollupOptions.input;
        inputCaptured = true;
      }
      return null;
    },
    buildStart() {
      round++;
      state.round = round;
      if (round === 1) {
        state.active = false;
        state.dirtyPages = [];
        state.skipRebuild = false;
        state.viteSkipped = false;
        setDecision("full", "cold");
      }
      if (state.skipRebuild) {
        globalThis.__UNI_FAST_OPTC_EXT__ = state;
        globalThis.__UNI_FAST_PAGE_INC__ = state;
        const err = new Error("unifast-optc-ext-skip");
        err.unifastOptcSkip = true;
        throw err;
      }
      globalThis.__UNI_FAST_OPTC_EXT__ = state;
      globalThis.__UNI_FAST_PAGE_INC__ = state;
    },
    watchChange(id) {
      if (!inputDir) return;
      pendingWatchIds.push(id);
      if (!watchFlushScheduled) {
        watchFlushScheduled = true;
        queueMicrotask(() => {
          watchFlushScheduled = false;
          const ids = pendingWatchIds;
          pendingWatchIds = [];
          flushWatchBatch(ids);
        });
      }
    },
    generateBundle() {
    },
    writeBundle() {
      if (round === 1 && !state.seeded) {
        try {
          seedAll();
          setDecision("full", "cold-seeded", {
            seededPages: fingerprints.size,
            seededOk: state.seededOk,
            seededErr: state.seededErr
          });
        } catch (e) {
          console.warn("[unifast-optc-ext] seed failed:", e.message);
        }
      } else if (state.path === "optc-ext" && state.dirtyPages.length) ; else if (state.path === "full" && round > 1) {
        for (const pagePath of allPages) {
          const files = pageFileCandidates(inputDir, pagePath);
          if (!files.length) continue;
          try {
            if (node_fs.statSync(files[0]).isDirectory()) continue;
            const sections = parseVueSections(files[0]);
            const fp = fingerprintScript(sections.script, files[0], inputDir, aliases);
            fingerprints.set(pagePath, {
              file: files[0],
              templateHash: sections.templateHash,
              styleHash: sections.styleHash,
              scriptHash: sections.scriptHash,
              script: sections.script,
              fp
            });
          } catch {
          }
        }
      }
      globalThis.__UNI_FAST_OPTC_EXT__ = state;
      globalThis.__UNI_FAST_PAGE_INC__ = state;
    },
    closeBundle: {
      order: "post",
      sequential: true,
      handler() {
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
          lastIntegrity: state.lastIntegrity ? {
            pageOnlyEmitCount: state.lastIntegrity.pageOnlyEmitCount,
            driftCount: state.lastIntegrity.driftCount,
            vendorDrift: state.lastIntegrity.vendorDrift
          } : null,
          vendorShaAtSeed: state.vendorShaAtSeed ? String(state.vendorShaAtSeed).slice(0, 16) : null,
          lastEmit: state.lastEmit ? {
            filesWritten: state.lastEmit.filesWritten,
            emitMs: state.lastEmit.emitMs,
            afterSha: state.lastEmit.afterSha,
            changes: state.lastEmit.changes,
            allExternalsOnDisk: state.lastEmit.allExternalsOnDisk,
            requireCount: state.lastEmit.requireCount,
            emitClass: state.lastEmit.emitClass || state.lastEmit.reason
          } : null,
          lastDecision: state.lastDecision
        };
        console.log("UNI_FAST_OPTC_EXT_DECISION " + JSON.stringify(decision));
        console.log("UNI_FAST_PAGE_INC_DECISION " + JSON.stringify(decision));
        state.skipRebuild = false;
        globalThis.__UNI_FAST_OPTC_EXT__ = state;
        globalThis.__UNI_FAST_PAGE_INC__ = state;
      }
    }
  };
}

exports.createOptCExtPlugin = createOptCExtPlugin;
exports.extractTemplateComponentTags = extractTemplateComponentTags;
exports.loadEasycomConfig = loadEasycomConfig;
exports.resolveEasycomTag = resolveEasycomTag;
exports.seedEasycomIntoFingerprints = seedEasycomIntoFingerprints;
