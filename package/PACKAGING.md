# vite-uniapp-fast 打包说明（pkgroll · ESM + CJS）

## 布局

| 路径 | 说明 |
|------|------|
| `src/` | **TypeScript 源码**（由原 `lib/optc-ext*.mjs` 迁入；算法未改） |
| `src/index.ts` | 公共入口：`createOptCExtPlugin` 等 |
| `src/optc-ext-plugin.ts` | 唯一 canonical 插件实现（合并原 `optc-ext.mjs` / `optc-ext-vite.mjs`） |
| `src/optc-ext.ts` / `src/optc-ext-vite.ts` | 历史路径别名，re-export 同一实现 |
| `dist/` | **pkgroll** 产物：`.mjs`（ESM）+ `.cjs`（CommonJS）+ `.d.mts`/`.d.cts` |
| `lib/` | 旧 `.mjs` 保留，供现有 fixture/project 脚本继续 `import …/lib/…`；新集成请改用 `dist/` |

大型模块顶部带 `// @ts-nocheck`（务实迁移）；公开类型在 `src/index.ts`。

## 构建

```bash
cd package
npm install
npm run build          # pkgroll --clean-dist
npm run build:check    # build + scripts/smoke-dual.mjs
```

## package.json 出口（摘要）

```json
{
  "main": "./dist/index.cjs",
  "module": "./dist/index.mjs",
  "types": "./dist/index.d.mts",
  "exports": {
    ".": {
      "import":  { "types": "./dist/index.d.mts", "default": "./dist/index.mjs" },
      "require": { "types": "./dist/index.d.cts", "default": "./dist/index.cjs" }
    },
    "./optc-ext": { "import": { "default": "./dist/optc-ext.mjs" }, "require": { "default": "./dist/optc-ext.cjs" } },
    "./optc-ext-vite": { "import": { "default": "./dist/optc-ext-vite.mjs" }, "require": { "default": "./dist/optc-ext-vite.cjs" } }
  }
}
```

peer：`vite`（可选）、`@vue/compiler-sfc`（**必需**，被静态 import；运行时解析 SFC，需由宿主工程提供）。

导出形式：所有入口**仅命名导出**（`createOptCExtPlugin` 等），无 default 导出。

## 消费者示例

### ESM（Vite / `"type":"module"`）

```js
import { createOptCExtPlugin } from 'vite-uniapp-fast'
// 或历史别名：
// import { createOptCExtPlugin } from 'vite-uniapp-fast/optc-ext-vite'

export default {
  plugins: [createOptCExtPlugin()],
}
```

本地未 publish 时可用相对路径：

```js
import { createOptCExtPlugin } from './package/dist/index.mjs'
```

### CommonJS

```js
const { createOptCExtPlugin } = require('vite-uniapp-fast')
// 或：require('./package/dist/index.cjs')
```

### 现有 fixture / project 接线

当前仍指向拷贝版：

- `compile-optimization/{fixture,project}/scripts/vite-plugins/optc-ext.mjs`
- `uni-vite-latest-fixture/scripts/vite-plugins/optc-ext.mjs`

**改用 dist（推荐）**：在对应 `vite.config.js` 里把 import 换成：

```js
import { createOptCExtPlugin } from '../../../optimize/dist/index.mjs'
// fixture 相对路径按实际深度调整
```

或暂时继续用 `lib/*.mjs` / 脚本目录里的拷贝（行为与迁 TS 前一致）。本任务未批量改 fixture，避免打断既有 warm 矩阵。

## 外部化

pkgroll 按 dependencies / peerDependencies 外部化：`vite`、`@vue/compiler-sfc`、`rollup`、`node:*`。不要把它们打进 bundle。

## Smoke

`scripts/smoke-dual.mjs`：`require(dist/index.cjs)` 与 `import(dist/index.mjs)` 均能得到 `createOptCExtPlugin`，并调用工厂返回插件对象；同时抽检 `./optc-ext` 与 `./optc-ext-vite` 别名。
