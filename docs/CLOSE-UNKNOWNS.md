# Close unknowns — punch list

**When:** 2026-10-18 Asia/Shanghai · box-linux  
**Machine:** `verify/close-unknowns.json` · harness `verify/close-unknowns.mjs`  
**Result:** **UNVERIFIED = 0** · **CRITICAL_WRONG = 0** · **BLOCKED = 1**（仅 DevTools GUI）

## Former unknown → now known

| ID | Was | Now | Evidence |
|----|-----|-----|----------|
| **c16 Pinia** | UNVERIFIED | **FAIL_CLOSED_OK** | 项目 **0** 处 `defineStore`/`pinia`；实为 Vuex。`store/` 进 looksSharedPath → `FULL_SHARED`；低扇出 util → `FAST_CLOSURE` 候选。`close-unknowns` a0/a1/a2/c16 |
| **c17 easycom** | UNVERIFIED | **FAIL_CLOSED_OK** | `pages.json` autoscan+`uni-*`；routeB 页 `<tag-a>` **无 script import**；script-only FP **漏检**（b3）→ seed 后进 contentHashes+reverseDeps（b4）；watch → shared/closure-vue；`@dcloudio` 包外 → `FULL_EASYCOM` |
| **dce-no-semicolons** | MED / CodeReview | **FAST_OK**（曾 CRITICAL） | 无分号多 `const` 曾被拼成一条 decl，DCE 丢掉 `const a` 留下对 `a` 的引用。项目 **~1724** ASI 脚本。已 ASI-aware split + `setup-asi-ambiguous` fail-closed。c23/c24 |
| **integrity-easycom / 副作用图** | UNVERIFIED | **FAIL_CLOSED_OK** | App/main → FULL_APP；pages/manifest → FULL_CONFIG；**uni.scss** → FULL_STYLE（新门）；mixins/store/plugins/components → FULL_SHARED；easycom seed 覆盖模板标签 |
| **DevTools mid-write** | UNVERIFIED | **BLOCKED** + **MEASURED_PROXY** | GUI：无 Mac 登录（`wechat-devtools-optc.json`）。代理：对 fixture cold `pages-tab/routeA/index.js` 做 `surgical-call-arg` 真写盘 → `new Function` OK、json/wxml/wxss SHA 不变、`require` 可解析、vendor 在盘；随后还原 |

## Code landed

1. `optimize/lib/optc-ext-emitter.mjs` — ASI splitter + fail-closed  
2. `optimize/lib/optc-ext-easycom.mjs` — **new**  
3. `optimize/lib/optc-ext.mjs` / `optc-ext-vite.mjs` — seed + path gates  
4. synced → `compile-optimization/{fixture,project}/scripts/vite-plugins/`  
5. regression +3 cases → **33/33 PASS**

## True BLOCKED

| Item | Why |
|------|-----|
| WeChat DevTools GUI runtime | Needs Mac CLI + logged-in session. Box is Linux. `miniprogram-ci` needs appid/private key not on box. |

**Mac one-liner (user):**  
`cli islogin && cli open --project <mp-weixin-dist> --lang zh` — then warm-edit via optc; confirm IDE has no compile error. See `verify/wechat-devtools-optc.json`.
