# 根因主张裁决（独立源码/实验复核）

环境差异：本机 Box 为 Linux x86_64、Node v20.19.2、可用内存约 6 GiB；用户原测为 macOS ARM64、Node 24.18.0、8 GiB 堆。全量 495 页冷构建未在本机重跑（内存与私有 `@private-scope/*` 依赖）；裁决优先依据已提取的 uni/Vite/Rollup 源码 + 用户侧 cold-fast 日志 + 本机合成原型。

---

## A. uni-app 将全部页面放进一个 Rollup 构建图（importPagesCode 动态 import + entry.js uniPage://）

**裁决：确认**

证据：
- `uni-packages/@dcloudio/uni-mp-vite/dist/plugins/pagesJson.js` L91–111：`importPagesCode()` 对 `pagesJson.pages` 与 `subPackages` 全部调用 `import('uniPage://...')`，并以 `if(!Math){...}` 包起来。
- 同文件 L64–65：transform 返回 `import './manifest...'` + `importPagesCode(appJson)`，作为 pages.json 模块代码进入图。
- `.../plugins/entry.js` L10–18、L56–63：`uniPage://` / `uniComponent://` 虚拟模块 resolve/load，load 时 `import MiniProgramPage from '<filepath>'` + `createPage`。
- `.../plugin/build.js` L24–65：`formats: ['cjs']`、`manualChunks`、`renderDynamicImport` 将动态 import 编成 `Promise.resolve(require(...))`；`chunkFileNames` 对 dynamic entry 的 facade 解出页面路径。

---

## B. Rollup watch 缓存可跳过未变模块 transform，但每次重建仍 `new Graph`，重新绑定/分析/生成

**裁决：确认**

证据：
- `uni-packages/rollup/dist/es/shared/watch.js` L9883–9901：每次 `run()` 调用 `rollupInternal({ ...options, cache: this.cache })`。
- `.../node-entry.js` L24482：`const graph = new Graph(inputOptions, registerWatchHooks)` —— 每次 rollup 调用新建 Graph。
- L22496–22526：`originalCode` 相同且 `shouldTransformCachedModule` 未要求重转时，走 `module.setSource(cachedModule)` 跳过 transform。
- L18271–18276 / L23800–23806：`setSource` 仍构建 `ModuleScope` 并从缓存 AST `parseNode`；随后 `sortAndBindModules()` + `includeStatements()` 全图分析。
- L24540–24548：`generate`/`write` 仍走完整输出路径。

---

## C. 真实项目单页修改：约 1 个模块 transform，仍约 3123 chunk 输出处理、约 5752 产物 regenerate

**裁决：确认**（数字来自用户侧实测日志；本机未重跑全量）

证据：
- `compile-optimization/reports/cold-fast-summary.json` baseline-1 template：`transformedModules: 1`，`generated: 5752`。
- 同文件 current-1 template：`transformedModules: 1`，`generated: 5752`，cache `hits: 2479` / `misses: 644`（esbuild renderChunk 缓存口径，与 “3123 chunk 输出处理” 一致量级：cold misses 3123）。
- `cold-fast-baseline-1.log` 第二行：同上。

说明：`generated: 5752` 是 Rollup 输出阶段处理的文件数；内容变化仅约 3 个（`changedContents: 3`）。

---

## D. 重复全量构建在约第 3 次耗尽 8 GiB 堆（holder 未知，不能直接称泄漏）

**裁决：确认（OOM 事件）/ 证据不足（泄漏归因）**

证据：
- WORKLOG `full_old_baseline_isolated` / `full_new_baseline`：第三次构建命中 V8 8GiB 堆上限 SIGABRT。
- cold-fast 仅 2 step/进程时，template 后 `heapUsed` 已达 ~7.0–7.1e9（baseline-1/2 log）——内存压力真实。
- WORKLOG breakthrough：`oldGraphretention hypothesis NOT confirmed, no explicit source holder located`。

本机合成 N=100 连续 5 次重建 heapUsed 约 23→57 MB，**不能**复现 8GiB OOM（图规模远小于 <private-app>）。

---

## E. esbuild renderChunk 缓存 + 跳过相同写盘未稳定加速全量项目

**裁决：确认**

证据：
- `cold-fast-summary.json` 串行 B-C-C-B：
  - baseline 冷/模板：51.4s / 48.4s 与 44.7s / 55.8s
  - current（both）冷/模板：56.2s / 50.3s 与 47.9s / 58.5s
- 模板写盘：baseline 5752 write；current written 3 / skipped 5749；但 `outputMs` 仍 27.9s / 33.0s，不低于 baseline。
- WORKLOG A9：performance NO IMPROVEMENT。

不得将 “跳过写入” 单独宣称为优化成功。

---

## F. 关闭 tree-shaking 导致大量文件字节变化；运行时未验证

**裁决：确认**

证据：WORKLOG `no_tree`：500 页 fixture 每步 502 文件内容不同；vendor 210348→357859；总 632550→819063；微信运行时未跑；未启用。

---

## G. 模块级增量（复用 Vue/WXML/WXSS 编译器、跳过全图）是优选突破；仅脏页丢进完整 Rollup 可能破坏 vendor 导出/分块

**裁决：确认（方向判断）**；脏页-only 全图 Rollup 的风险为 **推断（有机制依据）**

证据：
- `build.js` `manualChunks` + `staticImportedByEntry` 依赖全图 `getModuleInfo`；导出 facade / chunk 边界由全图 tree-shake 与动态入口集合决定。
- 本机原型：import/export 稳定的单页脚本修改时，**全图 warm rebuild** 的 vendor SHA **未变**（合成拓扑下）；但若依赖集合变化，则无此保证。
- `@dcloudio/uni-mp-compiler` 导出独立 `compile`/`parse`（`dist/index.js`），支持“复用编译器、换组装层”的技术前提。
- 模块级路径尚未在真实 uni 流水线落地；组件 JSON/样式归属/分包仍 **未验证**。

---

## H. Rolldown 1.2.13 缺少 uni/Vite 使用的 `renderDynamicImport` 与 `shouldTransformCachedModule`，非 drop-in

**裁决：确认**

证据：
- 官方 Plugin API（2026 抓取 https://rolldown.rs/apis/plugin-api）：Unsupported — `shouldTransformCachedModule`、`renderDynamicImport`。
- uni：`build.js` L48–61 使用 `renderDynamicImport`。
- Vite 5.2.8：`dep-whKeNLxG.js` L9926–9927 CommonJS 插件实现 `shouldTransformCachedModule`。
- `rolldown-registry.json`：version 1.2.13，engines Node `^20.19.0 || >=22.12.0`。

---

## 汇总表

| 主张 | 裁决 |
|------|------|
| A 全图动态 import | 确认 |
| B 每次 new Graph + 全量分析/生成 | 确认 |
| C 1 transform / ~5752 generate | 确认 |
| D 第3次 8GiB OOM | 确认(事件) / 证据不足(泄漏) |
| E 缓存+跳写未稳定加速 | 确认 |
| F 关 tree-shake 字节大变、运行时未验 | 确认 |
| G 模块级增量优先；脏页全图有风险 | 确认(方向) / 推断(风险细节) |
| H Rolldown 非 drop-in | 确认 |
