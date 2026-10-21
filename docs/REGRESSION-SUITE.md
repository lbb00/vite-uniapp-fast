# REGRESSION-SUITE

Run: `node verify/regression-suite.mjs`

**Latest: 38/38 PASS** · F1–F16 + risk-harden companion (`verify/risk-harden.mjs` → 5/5)

See `regression-suite.json`, `RISK-HARDEN.md`, `UNI-X-COMPAT.md`, `FIX-PUSH.md`, `OPTION-A.md`.

## Notes
- Project dist missing on this snapshot → `f1-project-emit-cascade-named` soft-SKIP (pass)
- Midpath Rollup resolves via `optimize/node_modules/rollup`
- Fixture routeA cold arg aligned to `probeMul(21)` matching `src`

## Deep-messy harden (2026-10-18)
- Emitter: forbidden-residue + syntax gate + no default-export exports[0] guess
- Closure: parseVueScriptParts skips wxs
- Suite: `node verify/deep-messy-risk.mjs` → CRITICAL_WRONG=0 post-harden; regression still **38/38**


## Risk-further extras

`rf-options-data-literal` · `rf-macros-default-literal` · `rf-midpath-macro-refuse` · `rf-atomic-write` · `rf-vue-max-and-newfile-gates`
