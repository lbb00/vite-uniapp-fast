# <private-app> uni-app 开发编译优化（Box 实测）

目录：本仓库 `package/`（原验证环境 `<workspace>/optimize/`）  
复现：`NODE_OPTIONS=--max-old-space-size=5120 node run-bench.mjs`  
数据：`measurements.json`、`logs/`

## 范围声明

| 类别 | 内容 |
|------|------|
| **已测** | 合成 uni-mp-vite 拓扑（全页动态 `import` + `manualChunks` → `common/*` + CJS `renderDynamicImport`）；N=50/100/200/500；Baseline / Opt A / B / C |
| **推断** | <private-app> ~495 页墙钟主因同构（1 transform + 全量 generate） |
| **未验证** | 真实 Vue SFC→WXML/WXSS/JSON；微信开发者工具；<private-app> 全量工程（私有 `@private-scope/*`） |

**不要**把「跳过写盘」或「构建成功」单独当成优化成功。下列每项都有墙钟、generate/write 计数与正确性字段。

---

## Baseline（全图 Rollup watch 式重编）

**改动：** 无优化；`rollup({ cache })` + 全量 `generate` 写回全部 chunk。

| N | coldMs | warmFullMs (median) | transforms | filesGenerated | vendorShaStable | pageEditPresent |
|---|--------|---------------------|------------|----------------|-----------------|-----------------|
| 50 | 171.7 | **53.9** | 1 | 53 | true | true |
| 100 | 67.1 | **62.4** | 1 | 103 | true | true |
| 200 | 155.7 | **115.8** | 1 | 203 | true | true |
| 500 | 372.9 | **263.2** | 1 | 503 | true | true |

**结论：** 稳定脚本修改时 transform=1，但仍 generate **N+common** 个文件；warm 随 N 近似线性上升（53→263 ms）。  
**裁决：ENABLE_AS_CONTROL**（对照，不作为优化接入）。

---

## Opt A — 仅脏页增量发射（common/* external）

**改动：** 只对脏页 `rollup({ input: page })`；`common/*` external 为固定 `../common/...`；其它产物不动。emit：`exports:'default'` → `module.exports`；绑定名 `helpers_js` 等。

| N | warmFullMs | warmIncMs (median) | speedup | filesWritten | otherPagesTouched | vendorShaStable | pageShaMatch vs full |
|---|------------|--------------------|---------|--------------|-------------------|-----------------|----------------------|
| 50 | 53.9 | **4.2** | 12.7× | 1 | 0 | true | **false** |
| 100 | 62.4 | **2.6** | 24.4× | 1 | 0 | true | **false** |
| 200 | 115.8 | **2.9** | 40.6× | 1 | 0 | true | **false** |
| 500 | 263.2 | **3.2** | 83.0× | 1 | 0 | true | **false** |

样本（N=500，2 runs）：inc ≈ 3.5 / 2.8 ms；full ≈ 271 / 256 ms。

**正确性：** 编辑字面量出现在产物中；vendor SHA 不变；其它页文件未改。  
**字节差异：** `module.exports` vs `exports.default`；`helpers_js` vs `common_helpers`（见 `logs/page-optA-N*.js`）。

**裁决：ENABLE_SPEED_NOT_BYTE_IDENTICAL**  
作为增量路径的速度基座启用；若需要与全量 emit 字节一致，叠加 Opt C。  
**目标核对：** 稳定页改 **毫秒级**，且 **不随无关 N 增长**（3.2 ms @ N=500）— **已测达成（合成拓扑）**。

---

## Opt B — 依赖指纹门控

**改动：** `DevCompiler.rebuildPage`：

1. **import 集合变化** → 强制全量  
2. **content 模式**：直接依赖文件内容 hash 变化 → 强制全量  
3. 否则走 Opt A/C 增量  

| 用例 | 模式 | 期望 | 实际 | falseNeg/Pos | warmMs | filesGenerated |
|------|------|------|------|--------------|--------|----------------|
| 稳定脚本改 | path | incremental | incremental | — | 5.0 | 1 |
| 共享模块改 | path | full | **incremental** | **FN=true** | 4.1 | 1（helpers 未更新） |
| 共享模块改 | content | full | full | FN=false | 83.7 | 103 |
| import 集合变 | content | full | full | — | 60.5 | 104 |
| 稳定脚本×3 | content | inc | all inc | — | median **2.9** vs full **48.5**（16.8×） | 1 |

**裁决：ENABLE_WITH_CONTENT_FINGERPRINT**  
纯 path 门控在共享模块修改上 **假阴性**（已测）— **不要单独启用**。  
content 指纹（直接依赖内容）正确回退全量 — **启用**。

---

## Opt C — export/interop 对齐（SHA）

**改动：** external id = 全量 `manualChunks` 绑定名（`common_helpers` / `common_vendorLib`）；`output.paths` 映回 `../common/...`；`exports:'named'` → `exports.default`。

| N | warmIncMs | speedup vs full | pageShaMatch | exports.default | common_helpers 绑定 |
|---|-----------|-----------------|--------------|-----------------|---------------------|
| 50 | **2.8** | 19.2× | **true** | true | true |
| 100 | **2.1** | 29.8× | **true** | true | true |
| 200 | **1.7** | 68.0× | **true** | true | true |
| 500 | **2.1** | 123.9× | **true** | true | true |

SHA 命中率：**4/4 = 100%**（相对同一次全量 emit 的脏页）。

**裁决：ENABLE**（推荐与 Opt B content 门控组合为默认增量发射器）。

---

## Opt D — 真实 fixture（可选）

- fixture 依赖（公开 `@dcloudio/*@3.0.0-4020420240722002`）**npm install 成功**，`vite-plugin-uni` 可 import。  
- **未跑**完整 fixture Vite 冷/热构建（Box 内存紧；避免无墙钟数据的成功宣称）。  
- **裁决：superseded** — 见下方 Page-inc appendix（私有依赖已就绪；page-inc 已接入真实 uni watch）。

---

## 优先栈与总裁决

```
冷启动 → 全图 Baseline
   ↓
稳定页脚本修改 → Opt B(content) 门控
   ├─ 指纹稳定 → Opt C 增量发射（1 文件）
   └─ import/依赖内容变化 → 全图 Baseline
```

| 优化 | 裁决 |
|------|------|
| Baseline | ENABLE_AS_CONTROL |
| Opt A | ENABLE_SPEED_NOT_BYTE_IDENTICAL |
| Opt B | ENABLE_WITH_CONTENT_FINGERPRINT |
| Opt C | **ENABLE** |
| Opt D | partial（无完整墙钟） |

**相对此前「缓存 esbuild + 跳写」：** 那些未稳定降墙钟；本方案直接砍掉无关页的 generate，数据上 12×–120×（随 N 增大更明显）。

---

## 代码入口

| 文件 | 作用 |
|------|------|
| `run-bench.mjs` | 一键实测，写 `measurements.json` |
| `lib/build-full.mjs` | Baseline 全图 |
| `lib/build-incremental.mjs` | Opt A / Opt C |
| `lib/fingerprint.mjs` + `lib/dev-compiler.mjs` | Opt B 门控编排 |
| `lib/generate-app.mjs` | 合成多页应用 |
| `demo.mjs` | 最小可运行 A+B+C 演示 |

---

## 明确未宣称

- 未宣称真实 <private-app> 495 页已达秒级（本机未跑该工程）。  
- 未宣称微信运行时正确。  
- 未宣称 Opt A 字节等价（已测 pageShaMatch=false）。  
- 跳写次数减少 ≠ 优化成功（本报告不以跳写为成功标准）。

---

## Appendix — Real fixture / project (box, 2026-10-15)

Measured on linked private deps + real `@dcloudio/vite-plugin-uni` (not synthetic-only).

| target | coldMs | warm script1 Ms | warm transforms | warm generated | warm changedContents | warm updatedMtimes |
|--------|--------|-----------------|-----------------|----------------|----------------------|--------------------|
| fixture 500p baseline | 5740 | **1646** | 1 | 1006 | 1 | 1006 |
| fixture 500p fs | 5158 | 1622 | 1 | 1006 | 1 | 1 (written=1, skipped=1005) |
| fixture 500p both | 5379 | 1818 | 1 | 1006 | 1 | 1 |
| project ~479 routes baseline (heap 8192) | **134497** | **58721** | 1 | **5658** | 3 | 5658 |

- Write-skip: **no wall-clock win** on fixture.
- Project script1 OOM at heap 6144 after cold; OK at 8192.
- Sources: `verify/fixture-baseline-real.json`, `verify/fixture-incremental-opt.json`, `verify/project-real.json`, `verify/REAL-RUN-REPORT.md`.
- **Verdict:** ordinary script edits on real uni are **not** seconds-scale / N-independent. Next: integrate Opt B+C into uni watch emit (not more skip-write).

---

## Appendix — Page-inc on real uni (box, 2026-10-15)

Wired Opt B(content) + importPagesCode filter (Opt C-style entry pruning) into fixture/project via `BENCH_MODE=page-inc`.

### Fixture (measured)

| | baseline | page-inc |
|--|----------|----------|
| script1 wall | 1646 ms | **610 ms** (2.7×) |
| generated | 1006 | **8** |
| decision | full generate | **incremental** |
| shared component | — | **full** (Opt B / non-page) |

Correctness: pageEditPresent, vendorShaStable, other pages untouched — **true**.

**裁决：ENABLE_ON_FIXTURE**（真实 uni 管线已测墙钟下降；未达合成 Opt C 的毫秒级）。

### Project (measured)

| | baseline | page-inc |
|--|----------|----------|
| script1 wall | 58721 ms | 54490 ms (~7% only) |
| graphMs | 43853 | **4724** |
| generated | 5658 | **546** |
| decision | full | **incremental** (fastPath) |

RouteA 页依赖闭包仍 generate ~546 chunks → outputMs 仍 ~50s。

**裁决：PARTIAL** — 路径已触发且 generate/graph 下降，但墙钟未到秒级；下一步需真正 Opt C externalize 发射。

详情：`verify/PAGE-INC-REPORT.md`、`verify/page-inc-fixture.json`、`verify/page-inc-project.json`。

---

## Appendix — True Opt C / `BENCH_MODE=optc-ext` (2026-10-15)

Wired into real uni watch: Opt B gate → surgical page-JS `ref()` literal patch → **abort Vite rebuild** (`unifast-optc-ext-skip` in `enforce:pre` `buildStart`). Externals = cold `common/*` + other `require()` targets on disk.

| Surface | baseline script1 | page-inc | **optc-ext** | generated | viteSkipped | shared→full |
|---------|------------------|----------|--------------|-----------|-------------|-------------|
| Fixture 500 | 1646 ms | 610 ms | **~2 ms** | **1** | true | yes (1606 ms) |
| Project 479 | **58721 ms** | 54490 ms | **~4 ms** | **1** | true | yes (~64 s) |

**裁决：ENABLE** for stable page script edits of the proven string-literal class. Reports: `verify/OPTC-EXT-REPORT.md`, `verify/optc-ext-*.json`.

---

## Appendix — True Opt C ext (uni watch) correctness 2026-10-15

| Claim | Measured |
|-------|----------|
| Surgical script1 SHA == uni warm | fixture + project **match** |
| Rename binding → full | fixture **~1841 ms**, generated 1006, `optc-emit-failed` |
| Setup-body `ref(42)` | fixture **~3.6 ms**, generated 1, SHA **match** vs uni warm |
| WeChat DevTools | Unverified |

Details: `verify/OPTC-EXT-CORRECTNESS.md`. Emitter cascade: surgical → setup-body → full.


---

## Appendix — True Opt C ext + local-import (uni mp-weixin, 2026-10-15)

Flag: `BENCH_MODE=optc-ext`. Emitter: `optimize/lib/optc-ext-emitter.mjs`.

| Class | Fixture wall | Project wall | generated | notes |
|-------|--------------|--------------|-----------|-------|
| Surgical string `ref` | ~2 ms | ~4 ms | 1 | SHA match vs uni warm |
| Setup-body `ref(42)` vue-only | ~3.6 ms | — | 1 | SHA match |
| **Local-import setup-body** | **~6.7 ms** | **~50 ms** | **1** | fixture SHA match; project 19 requires externalized |
| Rename / unmapped | full ~1.8 s | full ~64 s | ~1006 / ~5659 | Opt B stable but emit fails → full |

**Local-import mechanism:** cold `require` + chunk exports → SFC local rewrite → setup splice; skip Vite.  
**裁决：ENABLE** for stable page-script edits including composable/util imports when Opt B content fingerprint is stable.

