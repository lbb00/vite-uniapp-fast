# 三方向收益/成本比较与优先选择

## 1. 模块级开发编译（绕过全图 Rollup generate）

**收益潜力：高**
- 根因 B/C 显示：即使 transform=1，graph+output 仍占 ~45–55s（全量 <private-app> 用户测）。
- 本机合成原型：warm full 随 N 近似增长（N=10→200：~31ms→263ms），incremental 持平 ~3–6ms；速度比随 N 升至 ~25×。
- 目标“秒级且不随无关页面数增长”与该路径一致。

**改造成本：高**
- 需持久化：模块依赖、编译产物、稳定的 common/vendor 路径与导出名。
- 需覆盖：Vue SFC → JS/WXML/WXSS、组件 usingComponents、分包、循环依赖、配置变更回退全量。
- uni-mp-compiler 可独立调用，但页面组装/注册仍绑在 vite 插件链上。

**风险：** 导出 facade / require 路径与全量不一致会导致运行错误（原型已见 binding 名与 `module.exports` vs `exports.default` 差异）。

## 2. 适配 Rolldown

**收益潜力：中（未测）**
- 原生打包可能缩短全图分析/生成；但若仍全量 generate 所有页面，未必达到“与 N 无关的秒级”。

**改造成本：高**
- 缺 `renderDynamicImport`、`shouldTransformCachedModule`（官方明确 unsupported）。
- 需 polyfill/改写 uni build 插件与 Vite CJS 插件；watch `options` 钩子语义也不同。
- 无现成 drop-in；需设计适配层并做产物等价验证。

## 3. 内存问题修复（在现有全图 Rollup 内）

**收益潜力：低–中**
- 可避免第 3 次 OOM、改善稳定性；cold-fast 显示单次 rebuild 后 heapUsed 已 ~7GiB。
- **不能**单独解决“每次仍全图 generate 5752 文件”的墙钟瓶颈（E 已证跳写无效）。

**改造成本：中，且归因不清**
- holder 未定位；可能是 cache AST 保留（`setSource`/`toJSON`）、插件状态或 Vite 侧。
- 修复泄漏 ≠ 增量编译。

## 优先选择

**选择：模块级增量开发编译（方向 1）。**

理由：唯一直接攻击 B/C 全图生成成本、并有本机可证伪原型支持“稳定脚本修改可绕过全图 generate”。Rolldown 与内存修复作为并行/后续：Rolldown 可作全量冷构建加速备选；内存修复保障长 watch 会话。

**除非被推翻的条件（尚未出现）：** 证明普通修改的墙钟几乎全在 Vue/WXML 单模块 transform 而非 Rollup generate——与现有 graphMs/outputMs 拆分矛盾。
