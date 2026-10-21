# Exhaustive coverage math (Measured)

## Formula

```
weightedCoverage = sum(weight of leaves with ≥1 Measured case) / sum(weight of all positive-weight leaves)
weightedCoverageExBlocked = sum(weight covered non-BLOCKED leaves) / sum(weight non-BLOCKED positive leaves)
```

Weight definition: see `EXHAUSTIVE-TAXONOMY.md` (warm-edit action surface, L1-normalized to 100%).

## Numbers

| metric | value |
|---|---:|
| positive leaves | 68 |
| covered leaves | 68 |
| totalWeight | 100.0000% |
| coveredWeight | 100.0000% |
| blockedWeight | 0.9900% |
| **weightedCoverage** | **100.0000%** |
| **weightedCoverage ex-BLOCKED** | **100.0000%** |
| meets ≥99% overall（正确性/诚实 hash 口径；加速覆盖约 40–45%，见 OVERALL-REPORT §4） | true |
| meets ≥99% ex-BLOCKED（正确性/诚实 hash 口径；加速覆盖约 40–45%，见 OVERALL-REPORT §4） | true |

Uncovered positive leaves: (none)

BLOCKED leaf: `blocked.devtools_gui_hot_reload` (0.9900%) — WeChat DevTools GUI, no Mac login.

## Hash bar update (2026-10-19 18:11:34 CST)

Superseded for hash bar by `HASH-COVERAGE.md`: **hashWeightedCoverage=100%**, hashPairedCaseCount=90, HASH_DIFF_BUG=0. Author 100% leaf claim without SHA pairs is not used.
