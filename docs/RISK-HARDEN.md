# Risk harden (R1–R5) — Measured · box-linux · Asia/Shanghai

目标：针对已列潜在问题做可证伪加固，而不是口号。

机器可读：`verify/risk-harden.json` · 脚本：`verify/risk-harden.mjs`  
回归：`node verify/regression-suite.mjs` → **30/30 PASS**（本轮后）

## 裁决一览

| ID | 风险 | 动作 | 裁决 |
|----|------|------|------|
| **R1** | 双速 / 覆盖面难预期 | `reasonCode` 分类 + `pathStats`/`reasonCounts` 打进 `UNI_FAST_OPTC_EXT_DECISION`；fixture 编辑套件分布计量 | **ENABLE** |
| **R2** | 指纹漏判 / vendor 陈旧 | `UNI_FAST_OPTC_INTEGRITY_EVERY`（默认 10）次 page-only 后校验共享源 content hash + `common/vendor.js` SHA；漂移 → `integrity-drift` 全量 | **ENABLE** |
| **R3** | 复杂 DCE 漂移 | `formatSetupStmtsLikeUni` 改为**迭代 liveness** + 无副作用死绑定整段丢弃；新增 4 个 hardening case | **ENABLE** |
| **R4** | 内联 util 真实性 | fixture 冷产物：`probeMul` **独立** `modules/utils/unifast-probe.js`，页 JS `require` 之；F16 仍为「假设内联」代理 | **DOCUMENTED-SEPARATE-CHUNK** |
| **R5** | 长会话漂移 | 20× page-only call-arg：vendor SHA 稳定、页 JS 语法/require 连贯 | **ENABLE** |

## R1 — 决策码与路径分布

插件 `setDecision` / `commitFastPath` 现写入：

- `reasonCode`：`FAST_PAGE` / `FAST_MIDPATH` / `FAST_CLOSURE` / `FAST_CLOSURE_VUE` / `FAST_OPTION_A` / `FULL_TEMPLATE` / `FULL_STYLE` / `FULL_SHARED` / `FULL_IMPORT_SET` / `FULL_CONFIG` / `FULL_APP` / `FULL_FAIL_CLOSED` / `FULL_INTEGRITY` / …
- 累计：`pathStats`、`reasonCounts`、`pageOnlyEmitCount`

合成编辑套件（10 类）：`fastRatio=0.5`（字面量/midpath/closure/option-a vs template/style/shared/integrity/config）— **不是**生产流量，只作观测契约。

## R2 — 完整性门闩（最小版）

```
UNI_FAST_OPTC_INTEGRITY_EVERY=10   # 0 关闭
```

每次成功 fast path：`pageOnlyEmitCount++`；每 N 次：

1. 重算各页指纹里的 **共享 import 源文件** SHA，对比 seed  
2. 对比 seed 时的 `common/vendor.js` SHA  

任一漂移 → `forceFull('integrity-drift')` + `UNI_FAST_OPTC_EXT_INTEGRITY` 日志。  
离线 5 轮 page emit：`vendorStable=true`。

## R3 — DCE

- 从 render/return 引用出发迭代求活绑定  
- 死 + 无副作用（字面量 / 纯算术 / 无 call）→ 整段删除  
- 死 + 有副作用（`ref(...)` 等）→ 保留裸 RHS（对齐 uni partial-DCE）  
- Case：`unused lit+ref` / `unused pure chain` / `helper kept via live` / `setupOnlyMark`

## R4 — 内联 util

| 证据 | 结果 |
|------|------|
| `pages-tab/routeA/index.js` | `require("../../modules/utils/unifast-probe.js")` |
| 页内是否内联 `function probeMul` | **否** |
| F16 `option-a-inlined-page-rebundle` | 仍 ENABLE，但标注 **proxy-for-inlined**（合成无 dist） |

结论：当前 uni 暖编对这种 util **走独立 chunk**；不要把 F16 说成「已覆盖真·Rollup inline」。

## R5 — 长会话

20 轮 `probeMul(n→n+1)` surgical-call-arg：

- `vendorSha` 不变  
- 页 JS `new Function` OK，probe require 仍在  
- 结束后还原 cold 文件  

## 代码落点

- `optimize/lib/optc-ext-vite.mjs`（= `optc-ext.mjs`）— reasonCode / integrity / commitFastPath  
- `optimize/lib/optc-ext-emitter.mjs` — iterative DCE + `isSideEffectFreeExpr`  
- 已 sync → fixture/project `scripts/vite-plugins/`

## 仍存在的限制（已不再标 UNVERIFIED）

- 微信 DevTools **GUI** 运行时：Linux **BLOCKED**；静态写盘代理见 `CLOSE-UNKNOWNS.md` e-*  
- Integrity 现已 **seed easycom 模板组件** + 扩展 looksSharedPath（store/mixins/…）+ uni.scss 门闩；见 close-unknowns  
- 高扇出 Vue / 模板改动仍全量（双速仍在，reasonCode 可解释）  
- 回归现 **33/30→33** PASS（含 ASI + easycom seed）  
