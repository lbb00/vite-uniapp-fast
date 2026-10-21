# vite-uniapp-fast

经典 **`@dcloudio/vite-plugin-uni`（Vue3 + Vite）mp-weixin** 的**暖编加速 Vite 插件**（内部代号 optc-ext）。
**不适用 uni-app-x**（见 `docs/UNI-X-COMPAT.md`）。

原理：Opt B 指纹（ES import 集 + CJS `require` 集 + 直接依赖内容）判定改动“安全”时，直接在冷编产物的页 JS 上做手术（surgical / setup-body / midpath / closure / Option A），只写 1 个文件并**跳过 Vite/Rollup**；任何不确定 → **fail-closed 回全量**（与不装插件一致）。

## 关键数字（实测，均摘自 `docs/`）

| 场景 | 基线 | 本插件 |
|------|------|--------|
| 真实工程（~479 路由）页脚本稳定字面量改动 | ~58721 ms · generate 5658 文件 | **~4 ms** · generate **1** · 跳过 Vite |
| 共享 util（≤CLOSURE_MAX）/ Vue script-only（≤CLOSURE_VUE_MAX） | 全量 | ~2 ms |
| Fixture 500 页同类 | 1646 ms | ~2 ms |
| 改 template / style / 超扇出共享 | 全量 | **仍全量（~64 s 量级）**，正确回退 |

## 诚实口径：两个不同的数

| 口径 | 含义 | 数值 |
|------|------|------|
| **正确性 / 诚实 hash 覆盖** | 加权场景下快路径产物与关插件一致，或 fail-closed 与关插件一致 | **100%**（ex-BLOCKED），HASH_DIFF_BUG = **0** |
| **加速覆盖** | 加权场景中能走毫秒快路径的比例 | **约 40%–45%，不是 99%** |

- template + style 族约占 **~32%** 权重且高频，**不加速**，直接回全量。
- 要加速 template/style，需要接入 uni mp 模板/样式编译层（`@dcloudio/uni-mp-compiler` 级的脏模块增量编译 + 组装），本插件层做不到。
- 一句话：**改页 script 文案 / ref / setup → 毫秒级且 SHA 对齐；改 WXML / WXSS / 大共享 → 正确但慢。**

详见 `docs/OVERALL-REPORT.md`（权威总报告）。

## 使用

```bash
cd package && npm install && npm run build:check   # pkgroll ESM+CJS + 冒烟
```

ESM（`vite.config.js`）：

```js
import uni from '@dcloudio/vite-plugin-uni'
import { createOptCExtPlugin } from 'vite-uniapp-fast' // 未发布时可用相对路径 ./package/dist/index.mjs

export default {
  plugins: [uni(), createOptCExtPlugin()], // 与验证 fixture 一致：放在 uni() 之后（插件自身 enforce: 'pre'）
}
```

CommonJS：

```js
const { createOptCExtPlugin } = require('vite-uniapp-fast') // 或 ./package/dist/index.cjs
```

peer：`vite`、`@vue/compiler-sfc`（由宿主工程提供）。别名出口：`vite-uniapp-fast/optc-ext`、`vite-uniapp-fast/optc-ext-vite`。

> `package.json` 保留了 `"private": true`，防止误发 npm；需要发布时再去掉。

### 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `UNI_FAST_OPTC_CLOSURE_MAX` | 3 | 共享 JS util 被 ≤N 个页引用时走 closure-chunk，否则全量 |
| `UNI_FAST_OPTC_CLOSURE_VUE_MAX` | 512 | 共享 Vue 组件 script-only 改动的引用页上限；独立取值，**不会**回退到 `UNI_FAST_OPTC_CLOSURE_MAX` |
| `UNI_FAST_OPTC_INTEGRITY_EVERY` | 10 | 每 N 次快路径做一次完整性校验；0 关闭 |

调试/日志：`UNI_FAST_OPTC_FORCE_MIDPATH=1`、`UNI_FAST_OPTC_OPTION_A=1`；日志行前缀 `UNI_FAST_OPTC_EXT_EMIT` / `UNI_FAST_OPTC_EXT_DECISION` / `UNI_FAST_OPTC_EXT_INTEGRITY`；Vite 插件名 `unifast-optc-ext`。

大工程建议 `NODE_OPTIONS=--max-old-space-size=8192`（实测 6144 曾 OOM）。

## 限制

- **微信 DevTools GUI 热更：BLOCKED**（无 Mac 未验证；Linux 上仅有静态写盘代理验证）。
- **Zig WASM 热路径：** 已评估但未发布（微基准收益对墙钟可忽略），本仓库不含该实验代码。
- 必须用 content + require 指纹，不要用纯 path 指纹；跳写盘 / esbuild cache 实测无墙钟收益。
- import / require 集合变化、新文件未 seed、store / easycom / pages.json / uni.scss 等副作用面 → 全量。

## 目录

```
package/    插件源码 src/（TS）、dist/（pkgroll 产物 ESM+CJS+d.ts）、scripts/、PACKAGING.md、OPTIMIZATIONS.md
docs/       全部结论报告（Markdown）
evidence/   机器可读分数 / 矩阵 JSON；evidence/harness/ 为验证脚本（依赖私有工程，仅供参考，不能直接复跑）
```

### 文档索引

| 文档 | 内容 |
|------|------|
| `docs/OVERALL-REPORT.md` | **总报告**（能优化什么 / 注意什么 / 99% 口径更正） |
| `docs/EVIDENCE-SUMMARY.md` | 证据摘要 |
| `docs/OPTC-EXT-REPORT.md` · `package/OPTIMIZATIONS.md` | 墙钟与机制 |
| `docs/OPTC-EXT-CORRECTNESS.md` · `docs/SHA-ALIGN.md` | 正确性与 SHA 对齐 |
| `docs/EXHAUSTIVE-*.md` · `docs/HASH-*.md` | 场景 taxonomy、覆盖分、成对 hash 矩阵 |
| `docs/DEEP-MESSY-RISK.md` · `docs/RISK-*.md` · `docs/CLOSE-UNKNOWNS.md` | 风险与未知项收口 |
| `docs/IMP-LEAF-CLOSE.md` | import / CJS require leaf 收口 |
| `docs/MIDPATH-*.md` · `docs/CLOSURE-*.md` · `docs/OPTION-A.md` | 各快路径族 |
| `docs/PLUGIN-DIFF-MATRIX.md` · `docs/REGRESSION-SUITE.md` · `docs/LINUX-DEEP-VERIFY.md` | 开/关插件对照、回归、Linux 深验 |
| `docs/UNI-VITE-LATEST.md` · `docs/UNI-X-COMPAT.md` | 版本兼容 |
| `docs/claims.md` · `docs/priority.md` · `docs/REPORT.md` | 早期结论与优先级 |
| `evidence/hash-honest-score.json` | 诚实分数权威折分 |

文档中的 `verify/…`、`optimize/…` 路径分别对应本仓库的 `docs/` + `evidence/` 与 `package/`。

## 隐私说明

原验证工程为私有业务代码，未包含在本仓库：私有依赖、工程源码与构建产物、原始日志均已排除；个别证据中的私有产物片段（dist 代码片段）与私有工程的标识符清单（如 `identifiersOnlyInOptcNotGold`、`unmappedSample`）已整体替换为 `[redacted: …]`，仅保留计数；工程名、私有包名、路由与模块路径、文中出现的业务标识符统一替换为占位符（如 `<private-app>`、`@private-scope/pkg-a`、`pages-tab/routeA`、`seg-NNN`、`refA`、`trackerA`）；机器绝对路径替换为 `<workspace>/…`、`<local-dir>/…`，设备标识替换为 `<redacted>`。证据与文档中剩余的标识符为验证用 fixture/探针名（如 `probeMul`、`shared-popup`、`unifast-probe`）或框架/库公开 API。所有数字、hash、裁决原样保留——hash 对应的是脱敏前的原始产物，因此无法用本仓库内容逐字节复现。
