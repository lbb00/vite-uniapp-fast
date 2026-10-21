# SHA align — project local-import vs uni warm (box · 2026-10-15 16:27 CST)

## Verdict: **MATCH_Measured**

| | Value |
|--|-------|
| Edit | `flagA` `ref(false)` → `ref(true)` on `pages-tab/routeA/index` (local-import page) |
| Gold uni warm | SHA `4ff68d48e498260829b466b5a4dce648d7d3d4b6b4b042211f5b10ce97d77d2a` · 28818 B · report `box-project-baseline-local-import-deep` · wall ~54933 ms · gen 5658 |
| Optc (new) | **same SHA** · emitClass **`surgical-named`** · dryRun cascade Measured |
| Prior optc | SHA `201782d2…` · 25562 B · `setup-body-local-imports` · **MISMATCH** (formatting + no uni DCE) |

## Mechanism

Cascade now:

1. Surgical **string** ref-literal patch  
2. **Cold-guided named** `ref(true|false|num|null|string)` patch by binding name (new)  
3. Setup-body splice (incl. local-import map)  
4. Fail → full rebuild  

Named path patches the literal **inside the cold setup body in place**, so uni semicolons, indentation, and DCE’d unused bindings stay intact. Only applies when every script diff is explained by those named literal flips (else fail-closed → setup-body / full).

## Evidence

- `verify/sha-align-verify.json` — 12/12 PASS  
- `verify/logs/sha-anatomy/diff-anatomy.json` — `MATCH_Measured`, `byteIdentical: true`  
- Code: `optimize/lib/optc-ext-emitter.mjs` (`patchColdPageJsNamedLiterals`) + synced fixture/project copies  

## Still not byte-SHA via named path

- Edits that are **not** named ref-literal flips (e.g. fixture `probeMul(21→22)`) still use **setup-body-local-imports** — fixture SHA match for that class was already Measured separately.  
- DCE’d bindings (no `const name =` in cold) → `cold-named-ref-missing` → fall through.  

## Unverified

- WeChat DevTools / Mac (deferred).  


## F2 update

Fixture `probeMul(n)` flips now prefer **`surgical-call-arg`** (cold in-place) over setup-body; sha-align case id `fixture-local-import-probeMul-call-arg`.
