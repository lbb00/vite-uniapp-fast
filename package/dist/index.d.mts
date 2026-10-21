import { createOptCExtPlugin } from './optc-ext-vite.mjs';
export { extractTemplateComponentTags, loadEasycomConfig, resolveEasycomTag, seedEasycomIntoFingerprints } from './optc-ext-vite.mjs';

/**
 * unifast-optc-ext — True Opt C Vite plugin for classic uni-app (mp-weixin).
 * Dual-published as ESM + CommonJS via pkgroll.
 */

/** Options accepted by {@link createOptCExtPlugin}. Kept loose — plugin reads env + optional bag. */
type OptCExtPluginOptions = Record<string, unknown>;
/** Vite plugin-shaped object returned by the factory (hooks vary by Vite major). */
type OptCExtPlugin = ReturnType<typeof createOptCExtPlugin>;

export { createOptCExtPlugin };
export type { OptCExtPlugin, OptCExtPluginOptions };
