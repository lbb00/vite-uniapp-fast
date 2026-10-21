# <private-app> / optc-ext 整体报告

**时间：** 2026-10-20 17:08 Asia/Shanghai（分数折分）· 报告整理同日  
**工程：** <private-app> ~479 路由 · 经典 `@dcloudio/vite-plugin-uni` Vue3 Vite（非 uni-app-x）  
**主产物：** `optimize/`（TS + pkgroll ESM/CJS）· 证据根 `verify/`

---

## 1. 一句话结论

- **能优化：** 稳定页脚本暖改（字面量 / setup-body / 可映射 local-import / 小扇出共享 script）可从 **~59s → ~几毫秒～几十毫秒**，且页 JS 与关插件暖编 **字节 SHA 对齐或诚实 fail-closed**。
- **不能当加速：** 改 template / style / 共享超扇出 Vue / Options 结构 / import·require 集合变化等 → **回全量**（安全，不静默写错）。
- **正确性：** 加权 taxonomy 诚实 hash **100%**（ex-BLOCKED），HASH_DIFF_BUG=0。  
- **加速：** **不是 99%。** template+style 族约 **32%** 权重且高频，这些 **不加速**；可加速大约 **四成** 场景（脚本字面量/setup/小共享）。勿把正确性说成「99% 开发场景都优化了」。

| 指标 | 值 |
|------|-----|
| hashWeightedCoverageHonest（ex-BLOCKED） | **100%** |
| HASH_DIFF_BUG | **0** |
| projectBackedStratifiedHash | **16**（目标 ≥15） |
| 静态冷编开/关插件 | equal **2024** / diff **0** |
| 唯一 BLOCKED | DevTools GUI 热更（无 Mac） |

---

## 2. 到底能优化哪些

### 2.1 墙钟收益（Measured · project ~479）

| 场景 | 基线 | optc-ext | 产物 |
|------|------|----------|------|
| 页脚本稳定字面量（script1） | **~58721 ms** · gen 5658 | **~4 ms** · gen **1** | 跳过 Vite |
| routeA bool / named 类 | ~55–59 s | **~3–50 ms** | SHA==金样（surgical-named） |
| local-import setup | 全量级 | **~几十 ms** · gen 1 | 冷 require 外置 |
| 共享 util ≤CLOSURE_MAX | 全量 | **~2 ms** · 只改 chunk | closure |
| Vue script-only ≤CLOSURE_VUE_MAX | 全量 | **~2 ms** | closure-vue |
| 共享组件 / template / style | 全量 | **仍全量 ~64 s** | 正确回退 |

Fixture 500 页同类：script1 **1646 ms → ~2 ms**。

### 2.2 快路径族（发射级联）

```
Opt B 指纹（ES import 集 + CJS require 集 + 直接依赖内容）
  → surgical / surgical-named / call-arg / Options·props 字面量
  → setup-body / setup-body-local-imports
  → midpath
  → closure-chunk / closure-vue / Option A（export-add / 页内联 rebundle）
  → 否则 full（fail-closed）
```

### 2.3 已验证「会加速」的编辑类（摘要）

- `<script setup>`：`ref('…')` / bool·num·null / call-arg 字面量  
- 复杂 setup-body（与 uni partial-DCE 对齐后 SHA MATCH）  
- Options `data()` 字面量、`defineProps` default 字面量（PARTIAL 快路径）  
- `@/`、barrel、多跳、import *（可快或诚实 fail-closed）  
- 小扇出共享 util / leaf util / Vue script-only  
- Option A：export 增删后受影响页重发  

### 2.4 打包与范围

- **pkgroll** 双出口：`optimize/dist/*.mjs` + `*.cjs`（见 `PACKAGING.md`）  
- **Zig WASM：** 曾评估热路径改写为 Zig→WASM，微基准收益对墙钟可忽略，未纳入发布（本仓库不含该实验代码）  
- **uni-app-x：** NOT_APPLICABLE（非本挂载面）  
- **经典 vite-plugin-uni 5.x/503xx：** 冒烟通过，产物形状未破  

---

## 3. 要注意哪些

### 3.1 正确性红线（已加固）

| 风险 | 现状 |
|------|------|
| 静默写错页 JS | **CRITICAL_WRONG=0**；不确定 → **fail-closed 全量** |
| CJS `require()` 漏进指纹 | **已修**（`cjs-require-set-changed` → 全量）；曾致 HASH_DIFF_BUG |
| 无分号 ASI / DCE | 已修；项目 ~1724 ASI 脚本 |
| easycom / store / pages.json / uni.scss 等副作用 | seed + FULL_* 门闩 |
| 中途写盘 | `atomicWriteFile`；GUI 仍 BLOCKED |

### 3.2 双速体验（产品事实，不是 bug）

下列 **常见但高权重** 编辑 **不会** 走毫秒快路径，会回全量（墙钟仍接近基线）：

| 类 | <private-app> 权重量级 | 行为 |
|----|-----------------|------|
| 只改 template | ~14.5% | 全量（需 uni 模板管线） |
| 只改 style | ~8.4% | 全量 |
| template+script | ~6.6% | 全量 |
| Options 方法/结构 / 宏类型形状 | 合计可观 | 仅字面量可 surgical；结构 → 全量 |
| 共享 Vue 超扇出（如被约 500 页引用的公共组件） | — | 超 `CLOSURE_VUE_MAX` → 全量 |
| import / require 集合变化 | — | **强制全量**（含 CJS） |
| 新文件从未 seed | — | FULL_NEW_FILE |

**含义：** 日常「改文案 / 改 ref / 改 setup 逻辑」体感极快；「改 WXML 结构 / 改样式 / 大范围共享」仍慢——与关插件一致，但正确。

### 3.3 环境与接入

- **Linux / Node** 验证充分；**微信 DevTools GUI 热更** 无 Mac → **BLOCKED**（Linux 有静态写盘代理）。  
- 堆内存：project 暖编建议 **≥8192**（曾 6144 OOM）。  
- 接入：`createOptCExtPlugin()`（`optimize/dist`）；现有 fixture/project 仍有 `scripts/vite-plugins/` 拷贝。  
- 勿单独启用「纯 path 指纹」——共享模块会假阴性；必须 **content + require 集**。  
- 勿把「跳写盘 / esbuild cache」当主优化——实测墙钟无收益。

### 3.4 明确未宣称

- 未宣称「任意脚本改动都毫秒级」。  
- 未宣称 Mac 上 DevTools 热更已验。  
- 未宣称 uni-app-x 可用。  
- 诚实 100% ≠ 机械注水；不以 `hash-reuse` / cold-dup 充数。

---

## 4. 「99%」口径更正（重要）

> **先前「满足 99% 开发场景」容易误解成「常见改动能加速」——这不对。**  
> template / style 确实是高频日常；这些 **没有加速**，只是正确回全量。

### 4.1 两个完全不同的数

| 口径 | 含义 | 数值 |
|------|------|------|
| **正确性 / 诚实 hash 覆盖** | 加权场景下：快路径产物 EQ，或 fail-closed 与关插件一致；无 HASH_DIFF_BUG | **100%**（ex-BLOCKED） |
| **加速覆盖（体感秒级）** | 加权场景里能走毫秒快路径的比例 | **约 40%–45%**（非 99%） |

按 taxonomy 粗分（同权重量纲）：

| 桶 | 约权重 | 说明 |
|----|--------|------|
| 可加速（字面量 / setup / 小闭包等） | **~40%** | 秒级 |
| 看情况（import 集变、messy 等） | **~10%** | midpath 或全量 |
| **不加速（含 template/style 族）** | **~50%** | 回全量 ≈ 基线 |
| 其中 template+style 族 alone | **~32%** | `tpl.*` + `style.*` — **高频且未加速** |

### 4.2 对「常见开发」的诚实说法

- **改 template / style：** 很常见 → **optc 帮不上墙钟**，和没装插件一样慢（但产物应对齐）。  
- **改 script 字面量 / setup：** 也常见 → **这才是 optc 的主收益**（~59s→~几 ms）。  
- 若有人问「日常开发是不是 99% 都变快了？」→ **不是；大约四成场景有加速，模板样式那一大块没有。**

### 4.3 实用判断（改口后）

| 问题 | 答案 |
|------|------|
| 改页 script 文案 / ref / 简单逻辑？ | **秒级且 SHA 对齐** |
| 改 WXML / WXSS / 共享组件模板样式？ | **不加速，回全量**（正确） |
| 「99% 开发场景都优化了」？ | **不应这么说**；应说「正确性覆盖 100%；加速覆盖约四成」 |

---

## 5. 证据索引

| 文档 | 内容 |
|------|------|
| `verify/hash-honest-score.json` | 诚实分数权威折分 |
| `verify/EXHAUSTIVE-COVERAGE-SCORE.md` / `GAPS.md` | 覆盖与缺口 |
| `verify/EXHAUSTIVE-TAXONOMY.md` · `HASH-PAIRED-MATRIX.md` | 叶权重与成对矩阵 |
| `verify/OPTC-EXT-REPORT.md` · `OPTIMIZATIONS.md` | 墙钟与机制 |
| `verify/DEEP-MESSY-RISK.md` · `RISK-FURTHER.md` | 风险与可解性 |
| `verify/IMP-LEAF-CLOSE.md` | import/require leaf 收口 |
| `optimize/PACKAGING.md` | 打包说明 |

---

## 6. 总裁决

| 项 | 裁决 |
|----|------|
| optc-ext 作为经典 uni 暖编加速器 | **ENABLE**（稳定页脚本类） |
| 正确性（诚实 hash）覆盖 | **100%**（ex-BLOCKED）；加速覆盖约 40–45%，template/style 不加速 |
| 模板/样式/超扇出共享加速 | **不宣称**；回全量 |
| DevTools GUI | **BLOCKED** |
| 继续投入方向（若需要） | Mac 上验 GUI；或扩 template 管线（成本高、收益另估） |
