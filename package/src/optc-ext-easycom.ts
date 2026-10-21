// @ts-nocheck — pragmatic conversion from .mjs; public API typed in index.ts
/**
 * Easycom / autoscan helpers for optc-ext (no Vue compiler dependency).
 * Used by seed + integrity to close template-only component fingerprint gaps.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

function sha(s) {
  return createHash('sha256').update(s).digest('hex')
}

function normalizePath(p) {
  return p.replace(/\\/g, '/')
}

/** Native + built-in tags that are never easycom components. */
const NATIVE_MP_TAGS = new Set([
  'view','text','image','button','scroll-view','swiper','swiper-item','block','template','slot',
  'navigator','input','textarea','picker','switch','slider','checkbox','radio','checkbox-group',
  'radio-group','form','label','canvas','video','map','web-view','cover-view','cover-image',
  'rich-text','progress','icon','movable-area','movable-view','picker-view','picker-view-column',
  'editor','official-account','open-data','navigation-bar','page-meta','functional-page-navigator',
  'ad','camera','live-player','live-pusher','match-media','voip-room','page-container','share-element',
  'keyboard-accessory','root-portal','span','div','p','img','a','ul','li','table','tr','td','th',
  'thead','tbody','br','hr','i','b','em','strong','h1','h2','h3','h4','h5','h6','section','header',
  'footer','main','nav','aside','article','transition','transition-group','keep-alive','component',
  'teleport','suspense',
])

function loadEasycomConfig(inputDir) {
  try {
    const pagesJson = JSON.parse(readFileSync(join(inputDir, 'pages.json'), 'utf8'))
    const ec = pagesJson.easycom || {}
    return {
      autoscan: ec.autoscan !== false,
      custom: ec.custom && typeof ec.custom === 'object' ? ec.custom : {},
    }
  } catch {
    return { autoscan: true, custom: {} }
  }
}

function extractTemplateComponentTags(vueRaw) {
  const tags = new Set()
  const tm = String(vueRaw || '').match(/<template[^>]*>([\s\S]*?)<\/template>/i)
  if (!tm) return tags
  const re = /<\/?([A-Za-z][\w-]*)\b/g
  let m
  while ((m = re.exec(tm[1]))) {
    const t = m[1]
    if (NATIVE_MP_TAGS.has(t)) continue
    if (t.startsWith('uni-') || t.includes('-') || /^[A-Z]/.test(t)) {
      // PascalCase → kebab
      const kebab = t
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .replace(/_/g, '-')
        .toLowerCase()
      tags.add(kebab)
    } else if (t.includes('-')) {
      tags.add(t.toLowerCase())
    }
  }
  return tags
}

/**
 * Resolve an easycom tag to an absolute .vue path (autoscan components/ + custom rules).
 * Custom targets may point outside inputDir (e.g. @dcloudio/uni-ui).
 */
function resolveEasycomTag(tag, inputDir, easycom, aliases = []) {
  const custom = easycom?.custom || {}
  for (const [pattern, target] of Object.entries(custom)) {
    let re
    try {
      re = new RegExp(pattern)
    } catch {
      continue
    }
    const m = String(tag).match(re)
    if (!m) continue
    let spec = String(target)
    for (let i = 1; i < m.length; i++) {
      spec = spec.replace(new RegExp('\\$' + i, 'g'), m[i] || '')
    }
    // package / alias / relative
    if (spec.startsWith('@/')) {
      const abs = normalizePath(resolve(inputDir, spec.slice(2)))
      if (existsSync(abs)) return abs
      continue
    }
    if (spec.startsWith('.') || spec.startsWith('/')) {
      const abs = normalizePath(resolve(inputDir, spec))
      if (existsSync(abs)) return abs
      continue
    }
    // node_modules package path e.g. @dcloudio/uni-ui/lib/uni-badge/uni-badge.vue
    const nm = normalizePath(resolve(inputDir, '../node_modules', spec))
    if (existsSync(nm)) return nm
    const nm2 = normalizePath(resolve(inputDir, 'node_modules', spec))
    if (existsSync(nm2)) return nm2
  }
  if (easycom?.autoscan !== false) {
    const base = normalizePath(join(inputDir, 'components'))
    const candidates = [
      join(base, tag + '.vue'),
      join(base, tag, 'index.vue'),
      join(base, tag, tag + '.vue'),
    ]
    // also nested: components/**/tag.vue — shallow known dirs only via direct join of tag path segments
    const parts = tag.split('-')
    if (parts.length > 1) {
      // routeA-banner style won't match; try first segment as folder: components/routeA/tag-a already covered if tag is tag-a under routeA — handled by page-local below
    }
    for (const c of candidates) {
      if (existsSync(c)) return normalizePath(c)
    }
    // deep scan components/ for basename match (bounded)
    try {
      const stack = [base]
      let seen = 0
      while (stack.length && seen < 4000) {
        const dir = stack.pop()
        let entries
        try {
          entries = readdirSync(dir, { withFileTypes: true })
        } catch {
          continue
        }
        for (const e of entries) {
          if (e.name.startsWith('.') || e.name === 'node_modules') continue
          const p = join(dir, e.name)
          if (e.isDirectory()) {
            stack.push(p)
            continue
          }
          seen++
          if (!e.name.endsWith('.vue')) continue
          const stem = e.name === 'index.vue' ? normalizePath(dir).split('/').pop() : e.name.slice(0, -4)
          const kebab = stem.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/_/g, '-').toLowerCase()
          if (kebab === tag || stem === tag) return normalizePath(p)
        }
      }
    } catch {
      /* ignore */
    }
  }
  return null
}

/**
 * Seed easycom-only component files into page fingerprints + reverseDeps so
 * integrity and shared-change gates see them (close R2/c17 gap).
 */
function seedEasycomIntoFingerprints(inputDir, fingerprints, reverseDeps, aliases = []) {
  const easycom = loadEasycomConfig(inputDir)
  let edgeCount = 0
  let fileCount = 0
  const seenFiles = new Set()
  const externalPaths = []
  for (const [pagePath, meta] of fingerprints) {
    if (!meta?.file || !existsSync(meta.file)) continue
    let raw
    try {
      raw = readFileSync(meta.file, 'utf8')
    } catch {
      continue
    }
    const tags = extractTemplateComponentTags(raw)
    if (!meta.fp) meta.fp = { specs: [], contentHashes: {}, pathOnlyDigest: '', digest: '' }
    if (!meta.fp.contentHashes) meta.fp.contentHashes = {}
    for (const tag of tags) {
      const abs = resolveEasycomTag(tag, inputDir, easycom, aliases)
      if (!abs || !existsSync(abs)) continue
      try {
        if (statSync(abs).isDirectory()) continue
      } catch {
        continue
      }
      const n = normalizePath(abs)
      if (meta.fp.contentHashes[n] == null) {
        try {
          meta.fp.contentHashes[n] = sha(readFileSync(abs))
          edgeCount++
        } catch {
          continue
        }
      }
      if (!reverseDeps.has(n)) reverseDeps.set(n, new Set())
      reverseDeps.get(n).add(pagePath)
      if (!seenFiles.has(n)) {
        seenFiles.add(n)
        fileCount++
        if (!n.startsWith(normalizePath(inputDir))) externalPaths.push(n)
      }
    }
    // refresh digest
    try {
      const contentKey = Object.keys(meta.fp.contentHashes)
        .sort()
        .map((k) => k + '=' + meta.fp.contentHashes[k])
        .join('\0')
      meta.fp.digest = sha((meta.fp.specs || []).join('\0') + '\n' + contentKey)
    } catch {
      /* ignore */
    }
  }
  return { edgeCount, fileCount, externalPaths, easycom }
}


export {
  NATIVE_MP_TAGS,
  loadEasycomConfig,
  extractTemplateComponentTags,
  resolveEasycomTag,
  seedEasycomIntoFingerprints,
}
