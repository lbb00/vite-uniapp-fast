# Classic uni-app Vite 最新工具链 × optc-ext

**裁决：`ENABLE`**  
机器可读：`verify/uni-vite-latest.json` · 分模式：`uni-vite-latest-baseline.json` / `uni-vite-latest-optc-ext.json`  
工程：`<workspace>/uni-vite-latest-fixture`  
时区：Asia/Shanghai · 主机：box-linux · **不碰 Mac / 微信**

## 澄清（相对 UNI-X-COMPAT）

此前 `UNI-X-COMPAT.md` 的 **`NOT_APPLICABLE`** 针对的是 **uni-app x**（`.uvue` / UTS / HBuilderX）。  
用户后续澄清要测的是 **经典 uni-app Vue3 Vite 工具链升级**（`@dcloudio/vite-plugin-uni` 改版号线，不是换产品名）。  
本文件跟踪该经典线；`UNI-X-COMPAT.md` 已加更正脚注。

## 版本

| 项 | 值 |
|----|-----|
| 尝试目标 | npm `vue3` dist-tag 最新 |
| **实际跑通** | **`3.0.0-alpha-5030220261016001`** |
| 对照 <private-app> 钉死 | `3.0.0-4020420240722002` |
| 备选未用 | `3.0.0-5000720260410001`（alpha 已通，无需回退） |
| Compiler banner | **5.32（vue3）** |
| vite | **5.2.8**（peer 硬钉） |
| vue | 3.5.44 |
| rollup（运行时） | 4.64.9 |
| Node（box） | v20.19.2（包要求 `>=22.12.0` → **仅 EBADENGINE 警告，冷暖编均成功**） |

安装：`npm install --legacy-peer-deps`（与社区 uvm 升级常见做法一致）。

## 产物形状（vs 40204）

| 检查 | 结果 |
|------|------|
| `pages/**/index.js` | **是**（`pages/index/index.js`） |
| `require("../../common/vendor.js")` | **是** |
| `const common_vendor = …` + `common_vendor.ref(...)` | **是** |
| `wx.createPage` / `_export_sfc` | **是** |
| companions `.json/.wxml/.wxss` | **是** |
| **破坏性形状变化** | **无**（`breakages: []`） |

结论：optc 依赖的冷编页 JS 模型在最新经典工具链上 **仍然成立**。

## 墙钟（1 页最小 fixture · Measured）

> 注意：这是 **1 页玩具工程**，baseline 暖编本身只有 ~350ms，不能拿来和 <private-app> ~59s 比绝对收益；用途是验证 **挂钩 + 形状 + surgical 路径**。

| 模式 | 冷编 | 暖编（改 `ref('…-0'→'…-1')`） | generated | transform | emitClass |
|------|------|-------------------------------|-----------|-----------|-----------|
| **baseline** | 2833 ms | **~350 ms**（bench 349.7） | 6 | 1 | — |
| **optc-ext** | 2768 ms | **~2.3 ms**（wall ~11 ms） | **1** | 0 | **surgical** |

- `viteSkipped: true` / `abortedRebuild: true`
- `reasonCode: FAST_PAGE` · `import-set-and-dep-content-stable`
- 页 JS probe 已变为 `unifast-compile-probe-1`；vendor SHA 未因 page-only 漂

约略：**~151×**（相对同 fixture 的 baseline 暖编）。

## 怎么挂

与 <private-app> 相同：Vite 插件，**开发者自挂**，无需官方合入。

```js
import { createOptCExtPlugin } from './scripts/vite-plugins/optc-ext.mjs'
// BENCH_MODE=optc-ext 时
plugins.push(createOptCExtPlugin())
```

本 fixture 插件拷自 `<workspace>/optimize/lib/`。

## 风险 / 诚实边界

1. **Node 22**：官方 engines 已抬到 `>=22.12`；box 用 20 能跑，生产建议跟官方 Node。  
2. **规模**：未在最新工具链上复跑 500 页 / <private-app>；形状兼容是强信号，墙钟外推需在真实工程再测。  
3. **alpha**：跑的是 `vue3` dist-tag 最新 alpha，不是 `3.0.0-50007*` 稳定号；稳定号未单独测（因 alpha 已 ENABLE）。  
4. **微信模拟器**仍未验。

## 复现

```bash
cd <workspace>/uni-vite-latest-fixture
BENCH_MODE=baseline node bench/run-latest.mjs
BENCH_MODE=optc-ext node bench/run-latest.mjs
```
