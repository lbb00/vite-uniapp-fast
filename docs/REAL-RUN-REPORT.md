# Real uni-app mp-weixin run report (box)

Host: box · Node v20.19.2 · Rollup 4.64.6 · Vite 5.2.8 · `@dcloudio/vite-plugin-uni` 3.0.0-4020420240722002  
Private deps: `full-deps/node_modules` (18+2 `@private-scope/*`, ui-lib, etc.)  
Date: 2026-10-15 (Asia/Shanghai)

## Measured

### Deps resolve
- Path: `verify/real-deps-check.json`
- Compile-critical OK: vite, rollup@4.64.6, `@dcloudio/vite-plugin-uni`
- `@private-scope/pkg-c@1.6.0`, `@private-scope/pkg-d@1.2.0` present (post-build; not required for `uni -p mp-weixin`)

### Fixture baseline (500 pages, real uni pipeline)
- Path: `verify/fixture-baseline-real.json` · artifacts: `verify/fixture-baseline-real/` · reports: `compile-optimization/reports/box-fixture-baseline-real/`
- Mode: `BENCH_MODE=baseline`, heap 6144 MiB, suite `perf-script` (cold + script1)
- Exit 0

| step | totalMs | graphMs | outputMs | transforms | generated | outputFiles | changedContents | updatedMtimes |
|------|---------|---------|----------|------------|-----------|-------------|-----------------|---------------|
| cold | **5740** | 4820 | 920 | 1515 | 2009 | 2009 | 2009 | 2009 |
| script1 | **1646** | 1051 | 595 | **1** | **1006** | 2009 | **1** | **1006** |

### Fixture write-skip modes (same suite)
- Path: `verify/fixture-incremental-opt.json`
- script1 wall: baseline **1646** ms · fs **1622** ms · both **1818** ms
- fs/both: disk `written=1`, `skipped=1005`, `updatedMtimes=1` — but **generated still 1006**
- **Wall clock not improved** (noise / slight regression). Fewer writes alone ≠ speedup.

### Real project baseline (chaowanzu, ~479 routes after hydrate)
- Path: `verify/project-real.json` · artifacts: `verify/project-baseline-real/` · log: `verify/project-cold.log`
- Mode: `BENCH_MODE=baseline`, heap **8192** MiB (6144: cold OK, script1 **OOM**)
- Exit 0 · completed 2/2

| step | totalMs | graphMs | outputMs | transforms | generated | outputFiles | changedContents | updatedMtimes | peakRss |
|------|---------|---------|----------|------------|-----------|-------------|-----------------|---------------|---------|
| cold | **134497** (~134.5s) | 107848 | 26649 | 8577 | 10707 | 10797 | 10797 | 10797 | ~5.97 GiB |
| script1 | **58721** (~58.7s) | 43853 | 14868 | **1** | **5658** | 10797 | **3** | **5658** | ~7.95 GiB |

Prior heap-6144 attempt: cold ~133.5s measured, then `JavaScript heap out of memory` on script1 (`verify/project-baseline-real/metrics-cold-only-6144.json`).

Mac reference (`reports/cold-fast-summary.json`): cold ~51.4s, template warm ~48.4s, warm transforms=1 / generated=5752 — same pattern, box slower.

## Inferred

- Warm cost on real uni is dominated by **full generate** (~N-scale chunk emit), not transform (transforms=1 on ordinary script edit).
- Fixture (~1.6s @ 500 synthetic pages) vs project (~59s @ 479 real routes) gap is mostly **graph/module weight** (8577 vs 1515 transforms on cold; warm generate 5658 vs 1006), not a different algorithm.
- Synthetic Opt A/C (ms-scale, N-independent) remains the right direction **if** wired into uni’s page emit path; write-skip (`fs`/`both`) will not deliver that.

## Unverified / blockers

- Opt A/C **not** integrated into real `@dcloudio/vite-plugin-uni` Vue SFC → WXML/WXSS/JSON / `uniPage://` pipeline (blocker documented in `fixture-incremental-opt.json`).
- WeChat DevTools runtime correctness not checked.
- Project route count here is **479** after chaowanzu hydrate (not full 495 Mac cohort); still same full-generate pathology.
- Byte-identical Opt C vs uni emit on real pages: unverified.
- No claim that private `pkg-c` post-build affects compile wall time.

## Verdict

**No — on the real uni mp-weixin pipeline, ordinary page script edits are not seconds-scale and are not independent of unrelated page count.**

Evidence: project script1 **~58.7s** with transforms=1 but **generated=5658** / updatedMtimes=5658; fixture script1 **~1.6s** with generated=1006. Write-skip modes do not fix wall clock.

## Next concrete optimization step (backed by these numbers)

1. **Do not pursue write-skip / esbuild cache as the primary win** — measured no wall improvement on fixture while generate stays O(pages).
2. **Wire Opt B(content) + Opt C page-only emit into uni’s watch rebuild** so a stable script edit regenerates **only the dirty page chunk** (target: filesWritten≈1, generated≪5658), falling back to full generate when import set / dep content changes.
3. Validate on this box’s project bench: script1 wall ≪ 58s with `changedContents` small **and** `generated` small; keep SHA/runtime checks before claiming success.

## Artifact index

| file | what |
|------|------|
| `verify/real-deps-check.json` | resolve check |
| `verify/fixture-baseline-real.json` | fixture baseline numbers |
| `verify/fixture-incremental-opt.json` | fs/both vs baseline + Opt A/C blocker |
| `verify/project-real.json` | project cold+script1 numbers |
| `verify/project-cold.log` | project compiler log (8192 run in `project-baseline-real/compiler.log`) |
| `optimize/OPTIMIZATIONS.md` | synthetic Opt A/B/C + real appendix |
