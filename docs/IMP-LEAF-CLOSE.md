# Imp leaf close (Measured · Asia/Shanghai)

**When:** 2026-10-20 17:08:20 CST (Asia/Shanghai)  
**Harness:** `verify/run-imp-leaf-duals.sh` + fix re-dual `perf-hash-imp-require`  
**Log:** `verify/logs/imp-leaf-duals.log`, `verify/logs/imp-require-fix.log`

## Score

| | After imp-leaf duals | After require fix |
|--|--------|-------|
| honest ex-BLOCKED | 99.88% | **100%** |
| uncovered weight | 0.1188% | **0** |
| HASH_DIFF_BUG | 1 (imp-require) | **0** |
| projectBackedStratifiedHash | 16 | 16 |

## Five import leaves

| Leaf | Suite | baseline/optc | diff | vsCold | viteSkipped | reason | Covered? |
|------|-------|---------------|------|--------|-------------|--------|----------|
| `imp.import_star` | perf-hash-imp-star | exit 0 / 0 | 0 | 1 | true | import-set-and-dep-content-stable | **YES** IDENTICAL_HASH |
| `imp.relative_multihop` | perf-hash-imp-rel | 0 / 0 | 0 | 3 | false | import-set-changed | **YES** FAIL_CLOSED_HASH_MATCH |
| `imp.barrel_reexport` | perf-hash-imp-barrel | 0 / 0 | 0 | 2 | false | import-set-changed | **YES** FAIL_CLOSED_HASH_MATCH |
| `imp.default_plus_named` | perf-hash-imp-defnamed | 0 / 0 | 0 | 2 | false | import-set-changed | **YES** FAIL_CLOSED_HASH_MATCH |
| `imp.require_in_setup` | perf-hash-imp-require | 0 / 0 | **0** | 1 | false | cjs-require-set-changed | **YES** FAIL_CLOSED_HASH_MATCH |

### imp-require fix (was HASH_DIFF_BUG)

- Edit: tip0→tip1 **and** inject `require('../../modules/utils/unifast-probe.js')` in setup.
- Bug: fingerprint ignored CJS `require()` → false `import-set-and-dep-content-stable` → surgical tip-only (752B vs baseline 804B).
- Fix: `extractCjsRequires` in Opt B fingerprint; on require-set change `forceFull('cjs-require-set-changed')` (no surgical/midpath).
- Re-measure: routeA.js **804=804**, sha EQ, viteSkipped=false, reasonCode=FULL_IMPORT_SET. Leaf credited; not faked.

## Messy vsCold re-proof

All seven re-run suites: dual exit 0, **diff=0**, **vsCold≥1** (content delta proved).  
priv/dyn/getci → IDENTICAL (surgical tip); circ/missing/defmulti/other → FAIL_CLOSED (FULL_IMPORT_SET).

## Still BLOCKED

- DevTools GUI hot-reload — no Mac.
