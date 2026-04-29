# Duplication Audit — Consolidated Report
*Generated: 2026-04-29 — post `messages.ts` dedup commit (5ec6619)*

This report combines four independent analyses to surface every layer of
duplication in the codebase, prioritized for remediation.

---

## TL;DR — How bad is it?

| Metric | Value |
|---|---|
| Functions in clones (Type-1 + Type-2) | **254 of 2226** = **11.4%** |
| SQL queries in clones | **108 of 256** = **42.2%** ⚠️ |
| Stem-name collisions across canonical dirs | 23 (9 triplons, 9 real dups) |
| Top-3 boundary-spanning functions | `streamMessagePI`, `buildContextBreakdown`, `consumeStream` |

**The most surprising number is 42% SQL duplication.** Every other DB query
in the codebase has a clone somewhere. That's a clear signal we lack a query
abstraction layer.

The function-clone number (11.4%) is dominated by the same migration debt that
`messages.ts` had: 6+ files exist in both `core/handlers/` and `main/services/`
with parallel implementations.

---

## Findings by analysis

### A — Function clones (TS AST, Type-2 normalized)

113 clusters, 254 instances. Top offenders, sorted by body size (worst first):

#### 🔴 Type-1 clones, 700+ bytes — same migration debt as messages.ts

| Function | Bytes | Locations |
|---|---|---|
| `validateConfig(db)` | 1774 | core/handlers/tts.ts:509, **main/services/tts.ts:420** |
| `findSupportedFiles(dirPath)` | 1410 | core/handlers/knowledge.ts:26, **main/services/knowledge.ts:27** |
| `scan(dir, depth)` | 1195 | core/handlers/knowledge.ts:30, **main/services/knowledge.ts:31** |
| `speakWithEdgeTts(...)` | 1156 | core/handlers/tts.ts:227, **main/services/tts.ts:204** |
| `listTree(...)` | 1023 | core/handlers/files.ts:82, **main/services/files.ts:65** |
| `getVolume(backend)` | 813 | core/handlers/whisper.ts:41, **main/utils/volume.ts:36** |
| `playAudioFile(...)` | 795 | core/handlers/tts.ts:61, **main/services/tts.ts:86** |
| `listDir(basePath)` | 784 | core/handlers/files.ts:124, **main/services/files.ts:110** |
| `speakWithSay(...)` | 777 | core/handlers/tts.ts:290, **main/services/tts.ts:274** |
| `extractDescription(...)` | 683 | core/handlers/commands.ts:33, **main/services/commands.ts:21** |
| `speakWithSpdSay(...)` | 625 | core/handlers/tts.ts:268, **main/services/tts.ts:251** |

**Pattern**: every cluster pairs `core/handlers/` with `main/services/`. Same
shape as the `messages.ts` we just fixed — migration in flight. Each one
should be its own PR following the same recipe (V1/V2/V3 → migrate consumers
→ delete legacy).

#### 🟠 Smaller clones, 100-400 bytes — refactor opportunities

- 5 copies of `useClickOutside` cleanup (UserProfile, FileMentionDropdown, SlashCommandDropdown, SearchableModelPicker, useClickOutside hook). The hook *exists* — 4 components don't use it.
- 4 copies of git-action one-liners in gitPanelStore (lines 117, 126, 135, 144) — could fold into a generic `gitMutation(name, fn)`.
- 4 copies of file-sort comparator (`(a, b) => isDir...`) split between core/handlers/files.ts and main/services/files.ts (Type-1, will be eliminated once files.ts is consolidated above).
- 4 copies of `parse<X>List(json)` in 4 different util files (`parseCustomModels`, `parseCwdWhitelist`, `parseStringList`, `parseMcpDisabledList`) — same try/catch JSON.parse pattern.
- 4 copies of MCP store action wrappers (`addServer`, `removeServer`, etc. in `mcpStore.ts` + `toolsStore.ts`).

### B — SQL query clones (TS AST, normalized)

38 clusters, 108 instances. **Most replicated queries**:

| Copies | Query | Where it lives |
|---|---|---|
| **8** | `SELECT id FROM folders WHERE is_default = 1` | schema.ts ×2, conversations.ts ×2, folders.ts, scheduler.ts ×3 |
| **7** | `SELECT value FROM settings WHERE key = ?` | migrations.ts, files.ts ×2, messages.ts, scheduler.ts, db.ts utility (! the helper exists), quickChat.ts |
| **6** | `SELECT * FROM conversations WHERE id = ?` | conversations.ts (6 calls in a single file) |
| 4 | `SELECT value FROM settings WHERE key = 'scheduler_background_enabled'` | scheduler.ts ×4 |
| 4 | `SELECT value FROM settings WHERE key = 'ai_model'` | conversations.ts, scheduler.ts ×3 |
| 4 | `SELECT id FROM conversations WHERE id = ?` | scheduler.ts ×3, schedulerBridge.ts |
| 4 | `SELECT count(*) as c FROM conversations` | system.ts ×4 (handler + main, twice each) |
| 4 | `DELETE FROM conversations` (.exec) | system.ts ×4 |
| 4 | `DELETE FROM folders` (.exec) | system.ts ×4 |
| 3 | `INSERT INTO conversations ...` | scheduler.ts ×3 |
| 3 | `UPDATE conversations SET sdk_session_id = NULL, pi_session_file = NULL ...` | messages.ts ×2, services/messages.ts |

**Pattern**: queries 4+ are **all in one or two files** — same query repeated
inside the same module. Ripe for local helper functions. Queries with broader
spread (settings lookups, default folder) deserve a centralized
`src/core/db/queries.ts` module.

The `getSetting()` helper already exists in `src/core/utils/db.ts` but **7
files don't use it**. Step zero: have an eslint rule or grep audit to make
those callsites use the existing helper.

### C — Stem name collisions across canonical dirs

23 stem collisions. Severity breakdown:

#### 🔴 Triplons with real export duplication (priority 1)

| Stem | Real dup count | Note |
|---|---|---|
| `whisper.ts` | 4 | findBinary, buildAdvancedArgs, transcribe, getVolume — full triplon migration debt |
| `scheduler.ts` | 2 | computeNextRun, getExpectedThemeFilename — but `main/services/scheduler.ts` re-exports them ([line 23 of current scheduler.ts is `export { computeNextRun, ... } from '../../core/services/scheduler'`](false positive) — the re-export is intentional |

Of the 9 triplons, 7 follow the **architectural pattern** (intentional):
- `core/handlers/<x>.ts` exports `register<X>Handlers` (dispatch wiring)
- `core/services/<x>.ts` exports `<X>Service` class (business logic)
- `main/services/<x>.ts` exports `registerHandlers` (Electron IPC bridge)

This pattern is documented in CLAUDE.md and is **OK** — these aren't dups.
But the 7 `main/services/<x>.ts` files each re-export `registerHandlers` and
likely contain Electron-specific glue. Need per-file inspection to confirm
they don't carry redundant logic.

#### 🟠 2-dir collisions with shared exports

| Stem | Shared export count | Severity |
|---|---|---|
| `streaming.ts` | 10 | core/services ↔ main/services. Includes `respondToApproval`, `setChunkSender`, `sendChunk`, `abortControllers`, `streamMessage`, `streamMessageOneShot`. Investigate whether main is a thin re-export. |
| `discord.ts` | 7 | core/services ↔ main/services. `splitMessage`, `BotStartOptions`, `startBot`, `stopBot`, etc. |
| `cwdHooks.ts` | 7 | All `reexport` kind — barrel pattern, **NOT** real duplication. |
| `webServer.ts` | 6 | core/services ↔ main/services. `getWsBroadcaster`, `startServer`, `stopServer`, `ServerStartOptions`. |
| `anthropic.ts` | 1 | `loadAgentSDK` in both core/services AND main/services |
| `system.ts` | 1 | `log()` in both core/handlers AND main/services |
| `messages.ts` | 1 | `copyAttachmentsToSession` in both core/handlers AND core/services (the 3rd messages file we left out of scope) |

### D — Cross-community boundary spanners (graphify-driven)

After filtering 9993 noise nodes (build artifacts, generic JS methods),
the top boundary-spanning real-code nodes are:

| Fanout | Degree | Node | Source |
|---|---|---|---|
| 5 | 54 | `streamMessagePI()` | core/services/streamingPI.ts |
| 5 | 45 | `on()` | extensions/agent-desktop-parity/modules/hooksSystem |
| 5 | 19 | `buildContextBreakdown()` | core/services/contextBreakdown.ts |
| 4 | 32 | `consumeStream()` | main/services/sessionManager.ts |
| 4 | 17 | `ensureFreshMacOSToken()` | main/utils/env.ts |
| 3 | 34 | `streamMessageOneShot()` | core/services/streaming.ts |
| 3 | 15 | `presentAskUser()` | core/services/discord.ts |
| 3 | 12 | `handleWsMessage()` | core/services/webServer.ts |
| 3 | 12 | `isPathOutsideCwd()` | core/services/guards/cwdGuard.ts |

**Interpretation**: these aren't necessarily "bad" — high fanout is expected
for streaming primitives. But `consumeStream` living in `main/services/` while
spanning 4 communities is a cross-cutting concern that probably belongs in
`core/`. Same for `ensureFreshMacOSToken` (currently in `main/utils/`).

`isPathOutsideCwd` in `core/services/guards/` already lives in the right
place — it's just used everywhere as it should be.

---

## Proposed remediation plan — phased PRs

Each phase is **independent and shippable**. Order by ROI/risk ratio.

### Phase 1 — Migration completion (mirror of `messages.ts` PR) — *batch of small PRs*

Each of these follows the recipe we just executed: V1 (behavioral parity), V2
(consumer call site enumeration), V3 (drift inventory) → Step 1 (migrate
scheduler / consumer imports) → Step 2 (find stray dynamic imports like
`tts.ts` had) → Step 3 (migrate/port tests) → Step 4 (delete legacy).

| PR | File | Est. LOC removed | Risk |
|---|---|---|---|
| 1 | `tts.ts` triplon | ~1500 | medium (5 functions, audio pipeline) |
| 2 | `knowledge.ts` triplon | ~600 | low (pure file walking) |
| 3 | `files.ts` triplon | ~700 | low (pure file ops) |
| 4 | `whisper.ts` triplon | ~400 | low (4 small functions) |
| 5 | `commands.ts` triplon | ~300 | low |
| 6 | `system.ts` log() dedup | ~50 | trivial |
| 7 | `anthropic.ts` loadAgentSDK | ~50 | trivial |

**Total bundle**: ~3600 LOC removed. Each PR < 1 hour after the recipe is
proven. Could be parallelized across reviewers.

### Phase 2 — Consolidate streaming + webServer + discord (the heavyweights)

These are bigger because the duplicated exports are 6-10 functions each. Need
careful inspection of whether `main/services/streaming.ts` is a thin re-export
or a parallel implementation.

| PR | File | Est. LOC removed | Risk |
|---|---|---|---|
| 8 | `streaming.ts` | ~unknown (need inspect) | high (streaming is the heart) |
| 9 | `discord.ts` | ~unknown | medium |
| 10 | `webServer.ts` | ~unknown | high (auth) |

These deserve a **read-before-plan** session each — the streaming.ts case in
particular might already be a delegation pattern that just *looks* like a
duplication to my export-name analysis.

### Phase 3 — Centralize SQL queries

Create `src/core/db/queries.ts` with named helpers for:

```ts
export function getDefaultFolderId(db: SqlJsAdapter): number | null
export function getConversationById(db: SqlJsAdapter, id: number): Conversation | null
export function getSettingValue(db: SqlJsAdapter, key: string): string | null   // wrapper for clarity
export function getBackgroundSchedulerEnabled(db: SqlJsAdapter): boolean
// ... etc.
```

Then incrementally migrate the 7 settings-lookup callsites to use the existing
`getSetting()` helper, and the 8 default-folder callsites to use the new
`getDefaultFolderId()`.

**Quantitative goal**: drop SQL-clone ratio from 42% to under 15%.

### Phase 4 — React renderer cleanup

- Adopt `useClickOutside` in 4 components that re-implement it.
- Extract `useEscapeKey` hook from 4 modal components.
- Generic `parseJsonList<T>(raw: string): T[]` helper for the 4 parse-list functions.

Low risk, mostly mechanical. Could be a single PR.

### Phase 5 — Investigate `core/services/messages.ts`

The third member of the original messages triplon. Used only by `engine.ts`
via `MessageService` class. Need to determine: is this a parallel
implementation, a wrapping facade, or genuinely independent? If it duplicates
logic, fold into `core/handlers/messages.ts`. If it's an architectural
boundary (engine class wrapping handler functions), document why and leave.

---

## Tooling produced (reusable for future audits)

Three scripts now live in `scripts/`:

1. `scripts/dedup-analyzer.cjs` — TypeScript AST clone detection (functions + SQL).
   Run: `node scripts/dedup-analyzer.cjs [--include-tests]`

2. `scripts/stem-collision-audit.cjs` — Cross-directory stem name + export
   collisions. Run: `node scripts/stem-collision-audit.cjs`

3. `scripts/cross-community-fanout.py` — Reads `graphify-out/graph.json`,
   ranks boundary-spanning nodes. Run: `$(cat graphify-out/.graphify_python)
   scripts/cross-community-fanout.py`

Add to `package.json` if recurring use:
```json
"scripts": {
  "audit:dedup": "node scripts/dedup-analyzer.cjs",
  "audit:stems": "node scripts/stem-collision-audit.cjs",
  "audit:fanout": "python3 scripts/cross-community-fanout.py"
}
```
