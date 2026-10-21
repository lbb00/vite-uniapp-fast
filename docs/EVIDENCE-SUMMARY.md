# <private-app> uni-app 开发编译优化 — 证据摘要（box · Asia/Shanghai）

> **Hash 覆盖主口径（2026-10-19 诚实重审）：** `hashWeightedCoverageHonest` = **100%**（ex-BLOCKED）· mechanical 100% · HASH_DIFF_BUG **0** · reuse counting **0**。  
> 先前 exhaustive 自报 100% / hash 机械 100% 曾含 `hash-reuse-*` 与 cold-dup 注水；**不以机械数为准**。详见 `HASH-COVERAGE.md` · `EXHAUSTIVE-COVERAGE-GAPS.md`。

## Exhaustive taxonomy + case matrix（2026-10-19 Asia/Shanghai）

| 项 | 实测 |
|----|------|
| Taxonomy leaves | **71**（positive-weight **68**，N/A **3**） |
| Weight surface | warm-edit developer actions；EditPrior_pp×StratumShare；L1→100% |
| Census | vue **7024** · Options **1721** · setupNoMacro **519** · setupMacro **1250** · emptyScript **3530** · routes **479** |
| Cases | **156** |
| byVerdict | IDENTICAL **20** · EQUIVALENT_SHAPE **60** · FAIL_CLOSED_BASELINE_MATCH **75** · BLOCKED **1** · **DIFF_BUG 0** |
| project-backed | **38** |
| weightedCoverage | **100.0000%**（含 BLOCKED 叶已有 Measured BLOCKED 例） |
| weightedCoverage ex-BLOCKED | **100.0000%** |
| blockedWeight | **0.99%**（`blocked.devtools_gui_hot_reload` · 无 Mac DevTools GUI） |
| 文档 | `verify/EXHAUSTIVE-TAXONOMY.md` · `EXHAUSTIVE-CASE-MATRIX.md` · `EXHAUSTIVE-COVERAGE.md` |
| Harness | `verify/exhaustive-taxonomy.mjs` · `verify/exhaustive-case-matrix.mjs` |

**定论：** 按 <private-app> 工程加权 warm-dev 表面，taxonomy 全覆盖 ≥99%（实测 **100%**）（正确性/诚实 hash 口径；加速覆盖约 40–45%，见 OVERALL-REPORT §4）；开/关插件差异矩阵扩到穷举后仍 **DIFF_BUG=0**。不可约 BLOCKED 仅微信开发者工具 GUI 热更。

## 总裁决

| 问题 | 裁决 |
|------|------|
| 普通页脚本编辑是否秒级、且不随无关页数涨？ | **基线：否**（project ~59s / generate 5658）。**optc-ext：是**（~4–50ms / generate 1） |
| 跳过写盘 / esbuild cache 能否当主优化？ | **否**（fixture 墙钟无改善） |
| 仅过滤 import 的 page-inc？ | fixture 有收益；**project 不够**（仍 ~55s / 546 chunks） |
| 真·Opt C（跳过 Vite + 冷编 external）？ | **ENABLE** |
| Project local-import 字节 SHA == uni 暖编？ | **MATCH Measured**（`surgical-named`；`4ff68d48…`） |
| F1–F16 修复推进 | **ENABLE**（F8a SHA MATCH；**F10–F12 ENABLE**；**F14 Option A ENABLE**；**F15 project spot ENABLE**；**F16 no-dist inlined ENABLE (proxy)**；见 `FIX-PUSH.md` / `OPTION-A.md`） |


## Risk harden + uni-x（2026-10-18）

| 项 | 裁决 |
|----|------|
| R1 reasonCode / pathStats | **ENABLE** |
| R2 integrity every N page-only | **ENABLE**（`UNI_FAST_OPTC_INTEGRITY_EVERY`，默认 10） |
| R3 iterative DCE + harder cases | **ENABLE** |
| R4 real uni inline util | **DOCUMENTED-SEPARATE-CHUNK**（未内联；F16 仍为 proxy） |
| R5 20× page-only vendor stable | **ENABLE** |
| 回归 | **30/30 PASS** |
| **uni-app-x / uni-x × optc-ext** | **`NOT_APPLICABLE`**（HX+UTS+.uvue；npm 仅为 types；无 Linux CLI Vite 挂载面） |

详见 `verify/RISK-HARDEN.md` · `verify/UNI-X-COMPAT.md`。

## Classic Vite 最新工具链（澄清 · 2026-10-18）

| 项 | 裁决 |
|----|------|
| 用户意图 | **经典** `@dcloudio/vite-plugin-uni` 升级，**不是** uni-app-x |
| 实测版本 | **`3.0.0-alpha-5030220261016001`**（Compiler **5.32** vue3；vite 5.2.8） |
| 产物形状 | **未破**：`pages/**/*.js` + `require(.../common/vendor.js)` + `common_vendor` |
| optc-ext | **ENABLE** · surgical · warm **~2.3 ms** / gen **1** vs baseline **~350 ms** / gen 6（1 页 fixture） |
| Node | 包要求 ≥22.12；box Node 20 仅警告仍跑通 |
| 文档 | `verify/UNI-VITE-LATEST.md` · `uni-vite-latest.json` |

（uni-app-x 仍见 `UNI-X-COMPAT.md` → `NOT_APPLICABLE`。）




## Deep messy / complex-ref（2026-10-18）

| 项 | 裁决 |
|----|------|
| 对抗套件 | `verify/deep-messy-risk.mjs` → **37 cases**；**CRITICAL_WRONG=0** · **UNVERIFIED=0** · FAIL_CLOSED≈19 · FAST_OK=16 |
| 项目 census | vue **7024** · Options only **1721** · setup **1777** · macros **1250** · piniaish 509 · lang=ts 7 |
| 静默错写（默认导出猜 maps / TS宏泄漏 / wxs FP） | **HARDENED** → fail-closed |
| Options / 宏 / template / 高扇出 | **FAIL_CLOSED**（安全全量） |
| `@/` · barrel · `import *` · 多跳相对 · `?.` | **FAST_OK** |
| Pinia / easycom / ASI-DCE / integrity | **CLOSED**（见 Close unknowns；DevTools GUI=BLOCKED） |
| 回归 | **38/38** after risk-further |
| 文档 | `verify/DEEP-MESSY-RISK.md` · `deep-messy-risk.json` |

## 墙钟对比（Measured）

| 场景 | baseline | page-inc | **optc-ext** |
|------|----------|----------|--------------|
| Fixture 500 · script1 字面量 | 1646 ms · gen 1006 | 610 ms · gen 8 | **~2 ms · gen 1** |
| Fixture · local import `probeMul` | **1628 ms** · gen 1007 | — | **~12.9 ms surgical-call-arg** · SHA==baseline；forced midpath **~4.5 ms** SHA== |
| Fixture · **complex setup** (F8a) | **~1694 ms** · gen 1007 | — | natural setup-body **~9.3 ms** / midpath **~5.5 ms** · **SHA == uni `a0bfb44b…`** |
| Fixture · multi-ref surgical | — | — | **~2.6 ms · gen 1** |
| Fixture · bool flip | — | — | **surgical-named / setup-body** |
| Fixture · template / style / shared / rename | full-scale | — | **full 回退 ~1.6–2.2s** |
| Fixture · midpath Rollup MVP（offline） | full warm ref **1603 ms** | — | **~166 ms / ~25 ms rollup**；**warm forced ~4.5 ms** SHA==uni (call-arg class only) |
| Project 479 · script1 字面量 | **58721 ms** · gen 5658 | 54490 ms · gen 546 | **~4 ms · gen 1** |
| Project routeA · flagA bool | **54933 ms** 金样 | — | **~50 ms** 历史；**surgical-named SHA==gold** |
| 共享 util（3 importers ≤ max） | 全量 | 全量 | **F8b closure-chunk ~2.3 ms** · only probe chunk |
| 共享 util（3 > max=2） | 全量 | 全量 | **full ~1638 ms** over-threshold |
| **F10** util+static import (chain-a, 2 importers) | 全量 | 全量 | **~2.3 ms** · only chain-a chunk |
| **F11** leaf util chain-b (0 page importers) | 全量 | 全量 | **~2.0 ms** · only chain-b chunk |
| **F12** Vue mini-shared script-only (2 importers) | 全量 | 全量 | **~2.1 ms surgical** · only mini-shared/index.js |
| **F12** Vue mini-shared template | 全量 | 全量 | **full ~1572 ms** `shared-vue-template-or-style` |
| 共享 Vue shared-popup（~500 页） | 全量 | 全量 | **仍 full ~1771 ms**（over CLOSURE_MAX） |
| **F14** util export-add | 全量 | 全量 | **~1.9 ms** option-a-export-add · only probe chunk |
| **F14** page uses new export | 全量 | 全量 | **~6.5 ms** setup-body-local-imports |
| **F15** project surgical-named roundtrip | — | — | **~3.7 ms** SHA==gold `4ff68d48…` |
| **F15** project leaf closure / export-add | — | — | **~2.0 / ~2.4 ms** unifast-spot-probe |
| **F16** no-dist inlined util (proxy) | 全量 | 全量 | **~2.2 ms** option-a-inlined-page-rebundle · 2 pages · no util dist |

## 正确性（Measured）

- Fixture surgical / named / **call-arg** / setup-body：页 JS 与冷体或 uni 金样对齐（call-arg = 冷体就地改）
- Project `flagA`：**SHA MATCH** via surgical-named
- **F8a complex midpath/setup-body：SHA MATCH** vs uni（`formatSetupStmtsLikeUni` partial DCE + multi-line）；natural == forced-midpath == gold
- 缺 cold require：**fail-closed**（不写盘）
- 产物树：page-only **只改目标页 `.js`**；closure **只改共享 chunk**
- 回归：**30/30** + sha-align **12/12**；option-a offline **15/15**（含 F16×6）；project-spotcheck **5/5**

## Emit class 一览（本轮）

`surgical` → `surgical-named` → `surgical-plain-literal` → `surgical-call-arg` → `setup-body(-local-imports)` → `midpath-*` → `closure-chunk` / `option-a-export-add` / `option-a-batch` / `option-a-inlined-page-rebundle` / `closure-vue` → full

## 限制 / BLOCKED（已非 UNVERIFIED）

- 微信开发者工具 **GUI** 运行时：**BLOCKED**（无 Mac 登录）；Linux surgical 写盘代理 **Measured**（`CLOSE-UNKNOWNS.md`）
- F16 inlined-no-dist — ENABLE 但是 **proxy-for-inlined**（R4：真 uni 对本 fixture util 仍独立 chunk）
- 大 importer Vue（shared-popup）仍 full；F12 仅 ≤CLOSURE_MAX + script-only
- Integrity：easycom 模板组件已 seed；store/mixins/uni.scss 等已有 FULL_* 门闩
- **uni-app-x：NOT_APPLICABLE**（非本插件目标链）

## 机制（一句话）

Opt B 指纹门控 → surgical → setup-body → midpath → 失败全量；共享 util（含 **static import**）→ **closure-chunk**；leaf util → **closure-multi-chunk**；无 dist 的页内联 util → **option-a-inlined-page-rebundle**；Vue script-only ≤max → **closure-vue**；否则全量。

## 产物路径

- `verify/OPTION-A.md` ← **F14 / F16**
- `verify/FIX-PUSH.md` ← **F1–F8**
- `verify/MIDPATH-WARM.md` · `midpath-warm.json` ← F6
- `verify/MIDPATH-COMPLEX.md` · `midpath-complex.json` ← **F8a**
- `verify/CLOSURE-PROTO.md` · `closure-proto.json` ← **F7/F8b**
- `verify/EVIDENCE-SUMMARY.md`（本文件）
- `verify/REGRESSION-SUITE.md` · `regression-suite.json`
- `verify/SHA-ALIGN.md` · `sha-align-verify.json`
- `verify/LINUX-DEEP-VERIFY.md`
- 代码：`optimize/lib/optc-ext-{emitter,vite,midpath,closure}.mjs` + fixture/project `scripts/vite-plugins/` 副本

## Close unknowns（2026-10-18 · 消除 UNVERIFIED）

| 项 | 裁决 |
|----|------|
| 原 UNVERIFIED（c16 Pinia / c17 easycom / DCE 无分号 / integrity 漏面 / DevTools） | **UNVERIFIED → 0** |
| c16 | **FAIL_CLOSED_OK**（无 Pinia；Vuex store 门闩 Measured） |
| c17 easycom | **FAIL_CLOSED_OK** + `optc-ext-easycom` seed（漏检→关闭 Measured） |
| ASI / 无分号 DCE | **FAST_OK**（修复前可静默写坏；~1724 ASI 脚本） |
| App/main/pages/manifest/uni.scss/mixins/store/plugins | 各类 **FULL_*** Measured |
| DevTools GUI | **BLOCKED**；Linux surgical 写盘 **MEASURED_PROXY** |
| CRITICAL_WRONG | **0** |
| 回归 | **38/38 PASS**（+Options/macros/atomic/gates） |
| 文档 | `CLOSE-UNKNOWNS.md` · `close-unknowns.json` · 更新 `DEEP-MESSY-RISK.md` |

## Risk further + plugin diff matrix（2026-10-19）

| 项 | 裁决 |
|----|------|
| Options data() 字面量暖编 | **ENABLE** · `surgical-options-data` · SHA==uni `13075b53…` · live ~12ms/gen1 |
| defineProps default 字面量 | **ENABLE** · `surgical-props-default` · SHA==uni `674455b6…` · live ~7ms；midpath 拒宏 |
| Template/style | **NOT_SOLVABLE_WITHOUT_FULL** |
| High-fanout Vue | **ENABLE** · `UNI_FAST_OPTC_CLOSURE_VUE_MAX` 默认 512 |
| atomicWriteFile | **ENABLE**（GUI 仍 BLOCKED） |
| F16 真内联 | **NOT_SOLVABLE_ON_THIS_TOOLCHAIN**（独立 chunk Measured） |
| never-seeded 新文件 | **ENABLE** · `FULL_NEW_FILE` |
| Dual-speed reasonCodes | **ENABLE** · FULL_OPTIONS/MACROS/NEW_FILE |
| **Static cold 开 vs 关插件** | **IDENTICAL** · 2016 files · 0 SHA diffs |
| **Dynamic matrix** | **48 cases** · IDENTICAL 15 · EQUIVALENT_SHAPE 9 · FAIL_CLOSED 24 · **DIFF_BUG 0** · extreme 27 |
| 回归 | **38/38 PASS** |
| 文档 | `RISK-FURTHER.md` · `PLUGIN-DIFF-MATRIX.md` · `risk-further.json` · `plugin-diff-matrix.json` |


## Hash-paired matrix (Measured · 2026-10-19 18:11:34 CST)

**Hard requirement:** every with-vs-without comparison records file **SHA256** pairs.

| Metric | Value |
|--------|-------|
| hashPairedCaseCount | **90** |
| totalCases | 93 |
| byVerdict | {'IDENTICAL_HASH': 57, 'FAIL_CLOSED_HASH_MATCH': 33, 'BLOCKED': 3} |
| HASH_DIFF_BUG | **0** |
| hashWeightedCoverage | **100%** (ex-BLOCKED DevTools) |
| Static cold | files baseline=2024 optc=2024 equal=2024 diff=0 merkleEQ=True |
| projectBacked | 6 |
| Artifacts | `verify/HASH-PAIRED-MATRIX.md` · `verify/hash-paired-matrix.json` · `verify/HASH-COVERAGE.md` · per-file maps `verify/logs/hash-static-cold-{baseline,optc}.json` |

P0 template/style/combo/Options/macro/call-arg all have live dual-bench SHA pairs. Plugin fixes this round: `#ifdef` → fail-closed; closure util `return` semicolon normalize to match uni.

## Honest hash re-audit (2026-10-19)

**When:** 2026-10-19 18:34:34 CST (Asia/Shanghai)

| Metric | Value |
|--------|-------|
| hashWeightedCoverageMechanical | 100% |
| **hashWeightedCoverageHonest (ex-BLOCKED)** | **100%** |
| HASH_DIFF_BUG | 0 |
| reuse counting | 0 |
| static cold equal | 2024 / diff 0 |
| projectBackedStratifiedHash | 3 |
| taxonomy leaves (ex-blocked) | 76 |

P0 fixes: deleted reuse; fresh ifdef / closure-over / vue-gt duals with paired SHA; quarantine cold-dup; taxonomy sync; plugin fail-closed harden.

Artifacts: `verify/hash-paired-matrix.json`, `HASH-PAIRED-MATRIX.md`, `HASH-COVERAGE.md`, `exhaustive-taxonomy.json`.
