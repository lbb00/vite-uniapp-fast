# Exhaustive coverage gaps (Measured · Asia/Shanghai)

**When:** 2026-10-20 17:08:20 CST (Asia/Shanghai)

## Uncovered leaves (honest)

_(none)_ — honest weight 100%.

Closed this fix: `imp.require_in_setup` → `FAIL_CLOSED_HASH_MATCH` (`cjs-require-set-changed`, routeA.js 804B EQ).

Prior closed (imp-leaf duals): `imp.barrel_reexport`, `imp.default_plus_named`, `imp.relative_multihop`, `imp.import_star`.

## Project stratified

- Target `projectBackedStratifiedHash` ≥15; **have 16** (PASS).
- Remaining nonCounting strat: `spotProbeBody` only — **HASH_DIFF_EXPECTED** (DCE).

## Messy vsCold (re-proved 2026-10-20)

Re-ran tip0→tip1 content-changing duals. All compared paths now **vsCold≥1**; still EQ baseline↔optc:

| short | verdict | viteSkipped | note |
|-------|---------|-------------|------|
| messy-priv | IDENTICAL_HASH | true | surgical tip; construct elided in emit |
| messy-dyn | IDENTICAL_HASH | true | surgical tip |
| messy-getci | IDENTICAL_HASH | true | surgical tip |
| messy-circ | FAIL_CLOSED_HASH_MATCH | false | FULL_IMPORT_SET |
| messy-missing | FAIL_CLOSED_HASH_MATCH | false | FULL_IMPORT_SET |
| messy-defmulti | FAIL_CLOSED_HASH_MATCH | false | FULL_IMPORT_SET |
| messy-other | FAIL_CLOSED_HASH_MATCH | false | FULL_IMPORT_SET |

No fake EQ. Prior vsCold=0 gate-only annotations superseded where vsCold≥1.

## BLOCKED

- `blocked.devtools_gui_hot_reload` — no Mac / WeChat DevTools GUI.
