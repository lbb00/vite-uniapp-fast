/**
 * unifast-optc-ext — True Opt C Vite plugin for classic uni-app (mp-weixin).
 * Dual-published as ESM + CommonJS via pkgroll.
 */
import { createOptCExtPlugin as createOptCExtPluginFn } from './optc-ext-plugin'
export {
  createOptCExtPlugin,
  loadEasycomConfig,
  extractTemplateComponentTags,
  resolveEasycomTag,
  seedEasycomIntoFingerprints,
} from './optc-ext-plugin'

/** Options accepted by {@link createOptCExtPlugin}. Kept loose — plugin reads env + optional bag. */
export type OptCExtPluginOptions = Record<string, unknown>

/** Vite plugin-shaped object returned by the factory (hooks vary by Vite major). */
export type OptCExtPlugin = ReturnType<typeof createOptCExtPluginFn>
