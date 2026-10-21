# MIDPATH-WARM — F6 warm Vite rebench (box · Asia/Shanghai)

Constraint: **BOX ONLY** — no Mac / WeChat.

## Verdict

| Path | Verdict | Wall (warm) | generated | viteSkipped | SHA vs uni baseline |
|------|---------|-------------|-----------|-------------|---------------------|
| **surgical-call-arg** | **ENABLE Measured** | **~12.9 ms** | 1 | true | **MATCH** `bb954f69…` |
| **midpath-sync (forced)** | **ENABLE Measured** | **~4.5 ms** | 1 | true | **MATCH** `bb954f69…` |
| baseline full warm | reference | **~1628 ms** | 1007 | false | gold |

Edit: fixture `probeMul(21→22)` (`perf-optc-local-import` / `perf-optc-midpath`).

## How midpath was exercised

Natural cascade now prefers **surgical-call-arg** for this edit (F2). To hit midpath in warm Vite:

```bash
UNI_FAST_OPTC_FORCE_MIDPATH=1 BENCH_MODE=optc-ext \
  BENCH_BACKUP=…/fixture-source-backup \
  node bench/run.cjs box-fixture-f6-optc-midpath perf-optc-midpath
```

Decision reason: `midpath-forced` → `emitClass=midpath-sync` (`midpath-sync-shell-splice`).

## SHA / shape anatomy

For this **literal call-arg** edit:

- baseline / call-arg / forced-midpath page JS **byte-identical** (SHA `bb954f69abf8a15b9ddc85f5f7ee892b86f489fa74ef3e32d2649c90f2617428`, 670 B)
- require graph: 2 (`common/vendor`, `modules/utils/unifast-probe`) — all on disk
- Offline suite `f6-call-arg-vs-midpath-offline` also shaEq=true

**Expect mismatch** on complex setup-body-class rewrites (formatting / DCE). Not rebench’d on a harder forced-midpath edit this push — residual **Unverified** for “midpath ≠ uni” cases.

## Artifacts

- `verify/midpath-warm.json`
- reports: `box-fixture-f6-baseline-callarg`, `box-fixture-f6-optc-callarg`, `box-fixture-f6-optc-midpath`
- logs: `verify/logs/box-fixture-f6-*-stdout.log`

## Speedup

| | vs baseline ~1628 ms |
|--|--|
| call-arg | **~126×** |
| midpath forced | **~363×** |
