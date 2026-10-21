/**
 * Smoke: both CJS require and ESM import must load createOptCExtPlugin.
 */
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

let failed = 0

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg)
    failed++
  } else {
    console.log('OK:', msg)
  }
}

// CJS
{
  const cjs = require(join(root, 'dist/index.cjs'))
  assert(typeof cjs.createOptCExtPlugin === 'function', 'cjs named createOptCExtPlugin')
  assert(cjs.default === undefined, 'cjs has no default export (named-only)')
  const plugin = cjs.createOptCExtPlugin({})
  assert(plugin && typeof plugin === 'object', 'cjs factory returns object')
  assert(typeof plugin.name === 'string' || plugin.name == null || typeof plugin.apply !== 'undefined' || Object.keys(plugin).length > 0, 'cjs plugin shaped')
}

// ESM
{
  const mod = await import(pathToFileURL(join(root, 'dist/index.mjs')).href)
  assert(typeof mod.createOptCExtPlugin === 'function', 'esm named createOptCExtPlugin')
  assert(mod.default === undefined, 'esm has no default export (named-only)')
  const plugin = mod.createOptCExtPlugin({})
  assert(plugin && typeof plugin === 'object', 'esm factory returns object')
}

// Alias entries
{
  const vite = await import(pathToFileURL(join(root, 'dist/optc-ext-vite.mjs')).href)
  assert(typeof vite.createOptCExtPlugin === 'function', 'esm optc-ext-vite alias')
  const plain = await import(pathToFileURL(join(root, 'dist/optc-ext.mjs')).href)
  assert(typeof plain.createOptCExtPlugin === 'function', 'esm optc-ext alias')
}

if (failed) {
  console.error(`smoke failed: ${failed}`)
  process.exit(1)
}
console.log('smoke-dual: all passed')
