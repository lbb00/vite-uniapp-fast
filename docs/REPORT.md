# <private-app> uni-app（mp-weixin）开发编译性能独立验证报告

## 0. 环境与范围

| 项 | 用户原测 | 本机 Box |
|----|----------|----------|
| OS | macOS ARM64 | Linux x86_64 |
| Node | 24.18.0 | 20.19.2 |
| 堆上限 | 8 GiB | 原型用 4 GiB |
| 项目 | <private-app> ~495 页 | **未重跑全量**（内存紧 + `@private-scope/*` 私有依赖） |
| 依据 | WORKLOG / cold-fast-summary / 隔离工程 | 提取的 uni/Vite/Rollup 源码 + 合成 Rollup 原型 |

输出目录：`<workspace>/verify/`  
未修改用户 Mac 上的 <private-app> 仓库。

---

## 1. 根因裁决表

| ID | 主张 | 裁决 |
|----|------|------|
| A | 全部页面进入一个 Rollup 图（importPagesCode + uniPage://） | **确认** |
| B | watch 缓存跳过 transform，但仍每次 `new Graph` 并分析/生成 | **确认** |
| C | 单页改：~1 transform，仍 ~5752 generate | **确认** |
| D | 约第 3 次 8GiB OOM | **确认(事件)** / **证据不足(泄漏归因)** |
| E | esbuild 缓存 + 跳写未稳定加速 | **确认** |
| F | 关 tree-shake 大量字节差，运行时未验 | **确认** |
| G | 模块级增量优先；脏页丢全图有风险 | **确认(方向)** / **推断(风险)** |
| H | Rolldown 缺关键 hook，非 drop-in | **确认** |

详细引用见 `claims.md`。

关键源码锚点：
- `pagesJson.js` L91–111 `importPagesCode`
- `entry.js` L56–63 `uniPage://` load
- `build.js` L48–61 `renderDynamicImport`；L94–129 `manualChunks`
- Rollup `watch.js` L9885–9901 → `node-entry.js` L24482 `new Graph`
- Rollup L22496–22526 缓存跳过 transform；L23800–23806 仍 bind/include
- Vite `dep-whKeNLxG.js` L9926 CommonJS `shouldTransformCachedModule`
- Rolldown 官方文档：上述两 hook unsupported

---

## 2. 优先方向

**优先：模块级增量开发编译（绕过全图 Rollup generate）。**

| 方向 | 收益 | 成本 | 结论 |
|------|------|------|------|
| 模块级增量 | 高（直击 B/C） | 高（依赖/导出/回退） | **首选** |
| Rolldown 适配 | 中（未测；仍可能全量 generate） | 高（缺 hook） | 备选冷构建 |
| 内存修复 | 低–中（稳会话，不消墙钟主因） | 中（holder 不明） | 并行保障 |

详见 `priority.md`。

---

## 3. 原型设计与结果

### 假设（可证伪）

> 对 **import/export 结构不变** 的单页脚本修改，模块作用域重编译可在 **不重跑全部页面的 Rollup generate** 的前提下产出正确页面 JS，且耗时 **不明显随无关页面数 N 线性增长**。

### 设计（最短）

路径：`verify/proto-incremental/`  
合成多页小程序拓扑（对齐 uni）：
- `main.js` 对全部页面 `import()`（全图动态入口；Rollup 4 下用 `void [import(),…]` 代替会被摇掉的 `if(!Math)`）
- `manualChunks` 固定 `common/*`
- CJS + `renderDynamicImport` → `Promise.resolve(require(…))`
- **Baseline：** watch 式 `cache` 全图 rebuild  
- **Incremental：** 仅打包脏页，将 `common/*` external 为稳定 `../common/…`，其它产物不动

规模：N = 10 / 50 / 100 / 200。

### 结果（已测）

| N | 冷构建 ms | 全图 warm ms | 增量 warm ms | 相对加速 | 全图 generate 文件数 | 其它页是否被改 |
|---|-----------|--------------|--------------|----------|----------------------|----------------|
| 10 | 73 | 31 | 4.9 | ~6× | 13 | 否 |
| 50 | 97 | 52 | 3.5 | ~15× | 53 | 否 |
| 100 | 110 | 98 | 6.1 | ~16× | 103 | 否 |
| 200 | 219 | 263 | 5.2 | ~51× | 203 | 否 |

- 全图 warm：transform 始终为 **1**，但仍 generate **全部** chunk（与主张 C 同构）。
- 增量：transform=1，**只写脏页**；vendor/common SHA 不变；其它 pages 文件未变。
- 全图路径在「仅改页内字面量」时 vendor 也未变（本合成拓扑）。
- 共享模块修改（N=50）：全图仅 `common/helpers.js` 内容变；**若无依赖图就只重编脏页会不安全**（推断已记录）。

### 能否绕过全图打包？

**是（在合成 uni 拓扑、稳定脚本修改前提下）。**

`bypassFullGraph: YES`（见 `proto-results.json`）。

限制（必须写明）：
1. **不是**真实 uni Vue/WXML/WXSS/组件 JSON 流水线。
2. 页 JS **非字节级一致**：全量动态入口为 `exports.default` + `common_helpers` 绑定名；增量为 `module.exports` + `helpers_js`。`require('../common/…')` 路径已对齐。属 **语义等价、非 SHA 等价**。
3. 未跑微信开发者工具。
4. 依赖/导出集合变化必须回退全量——原型未自动实现该判定器。

---

## 4. 已测结果 / 推断 / 未验证

### 已测结果
- A/B/H 源码级确认（本机阅读提取包）。
- C/E 与用户 cold-fast 日志一致复核（未在本机重跑 495 页）。
- 合成原型：增量绕过全图 generate；耗时不随 N 增长；其它页与 vendor 在稳定脚本改下保持不动。
- 跳过写盘不能当作加速成功（E + 用户 output 阶段拆分）。

### 推断
- <private-app> 单次改页的墙钟主要在 graph+output，而非那 1 次 transform。
- `manualChunks`/`staticImportedByEntry` 使「依赖变化时的脏页-only 全图 Rollup」存在 vendor/分块风险。
- `uni-mp-compiler.compile` 可脱离 Vite 调用，但页面注册/JSON/样式归属仍耦合插件。

### 未验证
- 本机全量 495 页冷/热构建与 OOM 复现。
- 微信运行时正确性。
- SFC→WXML/WXSS/组件 JSON 的增量管线。
- 内存 holder 身份。
- Rolldown 适配后的速度与产物。
- 增量与全量页 JS 字节级一致。

---

## 5. 下一步最短实验

1. **在 fixture（500 页）上**接「冷全量一次 → 稳定脚本改走增量发射器」，对比：
   - 墙钟 vs uni watch 全量；
   - 脏页之外文件 mtime/SHA 不变；
   - 用同一 `exports`/`interop` 配置把增量发射对齐到 `exports.default`，争取脏页 SHA 一致。
2. 实现最小 **依赖指纹**：import 源集合或 resolved 列表变化 → 强制全量。
3. 对单页 Vue SFC：只调用 uni 的 template/script 编译器写回对应 wxml/js，**不**进 Rollup，再人工/脚本对比。
4. 内存：在 Mac 全量 watch 上对 `graph.getCache()` / module AST 做 heap snapshot（本方向不阻塞增量原型）。

---

## 6. 结论（给决策）

1. 既有根因判断 **整体成立**；写盘优化 **不能**当突破。  
2. **优先做模块级增量**；Rolldown/内存为辅。  
3. 最短原型已表明：在 uni 式全图动态 import 拓扑下，**稳定单页脚本修改可以绕过全图 generate，且耗时不随 N 涨**。  
4. 距离「真实 <private-app> 秒级」仍差：Vue/WXML/组件管线、导出字节对齐、依赖变化回退、运行时验证。
