# Exhaustive coverage score (Measured · Asia/Shanghai)

**When:** 2026-10-20T09:08:20.000Z (UTC) · 2026-10-20 17:08:20 CST (Asia/Shanghai)  
**Bar:** honest hash-weighted coverage ex-BLOCKED ≥99%（正确性/诚实 hash 口径；加速覆盖约 40–45%，见 OVERALL-REPORT §4）  
**Implementer fold:** fix-imp-require-cjs-gate-2026-10-20

| Metric | Value |
|--------|-------|
| hashWeightedCoverageMechanical | 100% |
| **hashWeightedCoverageHonest** | **100%** (was 99.88%) |
| HASH_DIFF_BUG | **0** |
| reuseCounting | **0** |
| projectBackedStratifiedHash | **16** (target ≥15; **PASS**) |
| static equal/diff | 2024/0 |
| uncovered honest | _(none)_ |

## Imp leaves

| Leaf | Case | Verdict |
|------|------|---------|
| `imp.import_star` | hash-gap-imp-star | IDENTICAL_HASH |
| `imp.relative_multihop` | hash-gap-imp-rel | FAIL_CLOSED_HASH_MATCH |
| `imp.barrel_reexport` | hash-gap-imp-barrel | FAIL_CLOSED_HASH_MATCH |
| `imp.default_plus_named` | hash-gap-imp-defnamed | FAIL_CLOSED_HASH_MATCH |
| `imp.require_in_setup` | hash-gap-imp-require | **FAIL_CLOSED_HASH_MATCH** (fixed) |

## Fix (imp.require_in_setup)

- Root: Opt B fingerprint ignored static CJS `require()`, so tip+require inject looked import-set-stable → surgical tip-only (752B vs baseline 804B).
- Change: `extractCjsRequires` folded into fingerprint; `cjs-require-set-changed` → fail-closed full (skip surgical/midpath).
- Re-dual `perf-hash-imp-require`: diff=0, vsCold=1, viteSkipped=false, routeA.js 804=804, reason=`cjs-require-set-changed`.

## Verdict

Honest ≥99%: **PASS** (100%)（正确性/诚实 hash 口径；加速覆盖约 40–45%，见 OVERALL-REPORT §4）.  
projectBackedStratifiedHash ≥15: **PASS (16)**.  
reuseCounting: **0**.  
HASH_DIFF_BUG: **0**.
