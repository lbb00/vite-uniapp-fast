# Deep messy / complex-ref 风险评估 — optc-ext

**Host:** box-linux · **Zone:** Asia/Shanghai · **Date:** 2026-10-18  
**Label:** Measured（对抗套件 + close-unknowns）  
**机器可读:** `verify/deep-messy-risk.json` · `verify/close-unknowns.json`  
**Harness:** `verify/deep-messy-risk.mjs` · `verify/close-unknowns.mjs`  
**回归:** harden + close-unknowns 后 `node verify/regression-suite.mjs` → **33/33 PASS**

---

## 一句话

乱代码 / 复杂引用里，**最危险的是「静默写错页 JS」**。加固后对抗套件 **CRITICAL_WRONG = 0**，且原 **UNVERIFIED = 0**（Pinia/Vuex、easycom、无分号 DCE、integrity 缺口均已 Measured；DevTools GUI 仅 **BLOCKED**，有 Linux 静态代理证明）。

---

## 项目真实分布（Measured census · project/src）

| 模式 | 数量 |
|------|------|
| `.vue` 总计 | **7024** |
| `<script setup>` | 1777 |
| Options API only（无 setup） | **1721** |
| `defineProps/Emits/Expose/withDefaults` | **1250** |
| vuex-ish（原 piniaOrVuexish 宽松计数） | 509 |
| **真实 Pinia（defineStore/createPinia）** | **0**（项目用 Vuex `createStore`） |
| ASI 倾向脚本（const≥2 且分号 < const） | **~1724** |
| provide/inject | 239 |
| `lang=ts` | 7 |
| dynamic `import()` | 3 |

---

## 裁决一览（close-unknowns 后）

| 裁决 | 数量 | 含义 |
|------|------|------|
| **FAIL_CLOSED / FAIL_CLOSED_OK** | 17+2 | 不写盘 / 回全量 — **可接受** |
| **FAST_OK** | 16 | 快路径产物语法 OK |
| **UNVERIFIED** | **0** | 已全部闭环 |
| **DOCUMENTED / OK** | 2 | R4 独立 chunk 等 |
| **CRITICAL_WRONG** | **0** | — |
| **BLOCKED**（仅 GUI） | 1 | 微信 DevTools 登录态（见 close-unknowns） |

---

## 严重度表（当前）

| Sev | ID | 问题 | 状态 | 证据 |
|-----|----|------|------|------|
| ~~CRITICAL~~ | c5 / m5–m9 / m3 | 默认导出猜映射；TS/宏/export 写入 | **已封** | Measured |
| ~~HIGH~~ | m4 | wxs 抢 FP | **已封** | Measured |
| ~~MED~~ | c17 / integrity-easycom | easycom 未进指纹 | **已封** seed+gate | Measured close-unknowns b3→b4 |
| ~~MED~~ | dce-no-semicolons | 无分号 DCE 静默写坏 | **已封** ASI splitter | Measured c23/c24；项目 ~1724 ASI |
| ~~MED~~ | c16 | Pinia/store | **FAIL_CLOSED_OK**（无 Pinia；Vuex→FULL_SHARED/closure） | Measured |
| **MED** | Options×1721 / macros×1250 | 只能全量 | 仍在：安全双速 | M1/M2/M8 |
| **LOW** | DevTools 中途写盘 GUI | Mac+登录不可用 | **BLOCKED** + Linux proxy Measured | close-unknowns e-* |

---

## 本轮关闭的未知（摘要）

详见 `verify/CLOSE-UNKNOWNS.md`。

| 原未知 | 最终裁决 | 证据 |
|--------|----------|------|
| c16 Pinia | **FAIL_CLOSED_OK**（项目无 Pinia；Vuex store 门闩 Measured） | close-unknowns a0/a1/a2/c16 |
| c17 easycom | **FAIL_CLOSED_OK** + seed 加固 | b1–b4/c17；`optc-ext-easycom.mjs` |
| DCE 无分号 | **FAST_OK**（修复后） | c23/c24；曾可 CRITICAL 已复现再封 |
| integrity 副作用图 | **FAIL_CLOSED_OK** 分门类 Measured | d-app/main/pages/manifest/uni.scss/mixins/store/plugins |
| DevTools 中途写盘 | **BLOCKED**(GUI) + **MEASURED_PROXY** | surgical 写盘：syn OK、companions 不动、require 可解析 |

---

## 分类结果：乱代码 / 复杂引用

| 模式 | 裁决 | 说明 |
|------|------|------|
| Options / 宏 / TS / dynamic import / `export default` 混写 | **FAIL_CLOSED** | setup-forbidden-residue / emit-syntax-invalid |
| ASI 无分号多 `const` | **FAST_OK**（修复后） | ASI-aware split；残留合并 → setup-asi-ambiguous |
| `@/` · barrel · `import *` · 多跳 · `?.` | **FAST_OK** | |
| 环 / 超扇出 | **FAIL_CLOSED** | |
| Vuex store / easycom 组件 | **FAIL_CLOSED_OK** / closure-vue 候选 | looksSharedPath + seed |
| Pinia | **N/A（项目无）** | |

---

## 代码落地

| 改动 | 文件 |
|------|------|
| ASI `splitTopLevelStatements` + `stmtLooksMergedAsi` + setup-asi-ambiguous | `optc-ext-emitter.mjs` |
| easycom resolve/seed | **`optc-ext-easycom.mjs`（新）** |
| seed 进 FP/reverseDeps；looksSharedPath 扩展；uni.scss；easycom-external | `optc-ext.mjs` / `optc-ext-vite.mjs` |
| sync | fixture/project `scripts/vite-plugins/` |

---

## 复现

```bash
node verify/close-unknowns.mjs    # → close-unknowns.json
node verify/deep-messy-risk.mjs   # → deep-messy-risk.json  UNVERIFIED=0
node verify/regression-suite.mjs  # 33/33
```

---

## 对用户的直接回答

- **不规范代码？** 会折腾快路径，但加固后是 **回全量** 而不是静默错写；无分号 setup 曾可写坏，**已修**。  
- **复杂引用？** `@/`/barrel/多跳可用；easycom 曾漏指纹，**已 seed**；Vuex store 走共享门闩。  
- **还有未知吗？** 报告内 **UNVERIFIED=0**。唯一 **BLOCKED** 是微信 DevTools GUI（无 Mac 登录）；Linux 上已用真实 surgical 写盘做静态代理证明。
