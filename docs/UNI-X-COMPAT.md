# uni-app x / uni-x × optc-ext 兼容性

> **更正（2026-10-18）**：本文 `NOT_APPLICABLE` 仅针对 **uni-app x**（UTS / `.uvue` / HBuilderX）。  
> 若指 **经典 uni-app Vue3 Vite 构建工具升级**（`@dcloudio/vite-plugin-uni` 新版本线，如 `3.0.0-alpha-50302…` / `3.0.0-50007…`），见 **`verify/UNI-VITE-LATEST.md`** —— 裁决 **`ENABLE`**（产物形状未破，optc surgical 可用）。


**裁决：`NOT_APPLICABLE`（不兼容于当前 optc-ext 设计面）**  
机器可读：`verify/uni-x-compat.json` · 探针：`verify/uni-x-probe/`

时区：Asia/Shanghai · 主机：box-linux · 不碰 Mac / 微信登录

## 背景：两套产品

| | **<private-app> / optc-ext 目标** | **uni-app x（uni-x）** |
|--|--|--|
| 产品 | uni-app **vue3 + Vite** | uni-app **x**（UTS / vapor） |
| 页面 | `.vue` | `.uvue`（script `lang="uts"`） |
| 创建 | `npx degit dcloudio/uni-preset-vue#vite` 等 | **仅 HBuilderX**（2026-09 官方答：无 CLI 创建） |
| 编译器位置 | 项目 `node_modules`（`@dcloudio/*`） | **HBuilderX 内置**；工程 `dependencies: {}` |
| 出包布局 | CLI：`src` → `dist/dev/mp-weixin` | 根目录源码 → `unpackage` |
| npm `@dcloudio/uni-app-x` | — | **0.7.137 types only**（2026-10-14），不是编译器 |

## Measured 证据

1. **克隆**官方 [hello-uni-app-x](https://gitcode.com/dcloud/hello-uni-app-x) → `<workspace>/hello-uni-app-x`  
   - `engines.HBuilderX: ^3.99`  
   - `dependencies: {}`，无 `vite` / `@dcloudio/vite-plugin-uni`  
   - **无** `vite.config.*`  
   - **582** `.uvue` / **70** `.uts`；`manifest.json` 含 `"uni-app-x": { "vapor": true }`  
   - 页脚本示例：`<script setup lang="uts">` + `ref<string>(...)`

2. **npm** `pack @dcloudio/uni-app-x@0.7.137`：只有 `index.d.ts` / `types/` —— description = “uni-app x types”

3. **Box**：无 HBuilderX / 无 `cli` 打包器；无法在 Linux 上对 hello 工程跑出 mp-weixin / web 冷编产物

4. **optc-ext 假设**（均不满足）：  
   - Vite `watchChange` + 可挂 `createOptCExtPlugin`  
   - `pages/**/*.js` + `require("../../common/vendor.js")` 冷图  
   - `pageFileCandidates` 仅 `.vue|.nvue|.js|.ts` —— **不含 `.uvue`**

## 尝试挂载？

| 步骤 | 结果 |
|------|------|
| 在 hello 找 vite.config 挂插件 | **无文件** |
| `npm i` 拉编译器再 `dev:mp-weixin` | **无依赖可装**；官方不支持 CLI 创建/运行该模板 |
| 假定「web 也用 Vite」强行挂 | 文档称 web 在 **HBuilderX 内**按需 Vite；即使用户自建 `vite.config.js`，产物也不是 optc 补丁的 mp-weixin Rollup 页 JS 模型 |
| 结论 | **不伪造 ENABLE** |

## 文档口径（2026）

- 工程化：[doc.dcloud.net.cn/uni-app-x/worktile](https://doc.dcloud.net.cn/uni-app-x/worktile/) — 不支持 CLI 创建；HX CLI 仅打包已有工程  
- 项目结构：[…/uni-app-x/project.html](https://doc.dcloud.net.cn/uni-app-x/project.html) — 蒸汽模式、`.uvue`、根目录布局  
- 问答 2026-09：仍只能 HBuilderX 新建  

## 对 <private-app> 的含义

当前 <private-app> 是 **uni-app vue3 vite mp-weixin**，与 uni-x **不是同一条链**。  
optc-ext 继续服务这条链即可。若未来迁 uni-x，需要 **另起** 针对 UTS/HX 增量模型的方案，不能直接复用本插件。

## 裁决句

> **NOT_APPLICABLE** — latest uni-app-x cannot host optc-ext on Linux CLI; toolchain/page/output model differ. Types package ≠ compiler.
