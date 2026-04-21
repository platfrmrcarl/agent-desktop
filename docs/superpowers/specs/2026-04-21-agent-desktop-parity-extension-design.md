# Agent Desktop Parity Extension — Design Spec

- **Date**: 2026-04-21
- **Status**: Approved (brainstorming phase complete, revised after PI native-feature audit)
- **Author**: Laurent Baaziz (via brainstorming session)
- **Scope**: Bring the PI backend of Agent Desktop to feature parity with the Claude Agent SDK backend, via a bundled PI extension that consumes shared core policies + direct usage of PI-native features.

---

## 1. Motivation

Agent Desktop supports two AI backends: `claude-agent-sdk` (default) and `pi` (`@mariozechner/pi-coding-agent`). The Claude path exposes rich safety and UX features — CWD write restriction, permission modes, hook system messages, skills, budget caps — implemented directly in `src/core/services/streaming.ts` and the related hook/guard modules.

The PI path (`src/main/services/streamingPI.ts`) currently maps only the minimum set of PI session events to the existing stream chunk protocol. After auditing the PI documentation (`packages/coding-agent/docs/*`), we find that **PI natively implements much of what we thought was missing** (plan mode, skills discovery, per-turn usage normalization, persistent session manager, native compaction). The actual work is smaller than initially scoped: an extension that **adapts our app's settings cascade to PI's native facilities**, plus a thin layer of genuinely new logic (CWD write guard, hook config file runner, multi-mode permission state machine, budget cap enforcement).

Switching to PI today loses:
- **CWD write protection** — PI has no native CWD-scoped write guard
- **Permission modes** (`bypassPermissions`/`acceptEdits`/`default`/`dontAsk`) + interactive approval — PI has no mode state machine; plan mode has a reference example extension
- **Automatic wiring** of our `ai_skills` scope to PI's native `skills` setting array
- **User-defined hooks** driven by `~/.claude/settings.json` / `~/.agent-desktop/hooks.json` — PI has the event primitives but not the config-driven runner
- **Budget caps** (`maxBudgetUsd` enforcement) — PI exposes usage but does not cap spend
- **Task notifications**, **webhook completion** — custom

And two features that are natively supported by PI but not currently wired up:
- **Persistent session resume** — PI has a first-class `SessionManager` with JSONL persistence; we force `SessionManager.inMemory()`
- **Native conversation compaction** — PI has `session_before_compact` / `session_compact` events and `ctx.compact()` API; our app currently falls back to Claude Haiku even in PI mode

Goal of this spec: ship a **single bundled extension** (`agent-desktop-parity`) plus two streamingPI-level wiring changes (session persistence + native compaction adoption) that together close the parity gap. The extension is loaded automatically when PI backend is active and receives per-conversation settings via an `extensionFactories` closure documented in PI's SDK.

---

## 2. Decisions Record

Summarized from the brainstorming Q&A + PI documentation audit.

| # | Decision | Choice |
|---|---|---|
| Q1 | Distribution model | **Bundled with the app** — lives in `src/extensions/`, auto-pointed by `streamingPI.ts`, no user install |
| Q2 | Scope | **Five modules + two wiring phases**: `cwdGuard`, `permissionModes`, `skillsBridge`, `hooksSystem`, `budgetTracker` + native compaction + persistent session |
| Q3 | Config bridge | **`extensionFactories` closure** (PI-native, documented in `sdk.md`) — `streamingPI.ts` builds a closure that receives `pi: ExtensionAPI` and calls our extension's default export with the captured `{ conversationId, aiSettings, db, bridge }` context. Supersedes the push/consume registry idea. |
| Q4 | UI return channel | **Two-track**: (1) a typed bridge exposing `emitSystemMessage`, `emitTaskNotification`, `emitMcpStatus`, `recordTokenUsage`, `getAccumulatedUsage` for stream-protocol concerns; (2) PI-native `ctx.ui.confirm/select/input/editor` routed through a custom adapter on `PiUIContext` for user interactions. |
| Q5 | Relation to Claude path | **Extension consumes Claude's existing logic** — pure policies extracted to `src/core/services/guards/` and reused by both backends; Claude path structure unchanged |
| Q5.1 | Bridge dependency injection | **Decoupled via callbacks** — `createBridge(convId, { chunkSender })` |
| Q5.2 | Approval timeout | **Moot** — removed. Approvals use `ctx.ui.*` which has its own `{timeout, signal}` parameters (per `extensions.md`). |
| Q5.3 | (superseded) Context storage | **Superseded by Q3 (`extensionFactories`)** |
| Q5.4 | Handler `tool_call` throw semantics | **Fail-safe block** (PI default) — handlers return explicit `{ block, reason }` |
| Q5.5 | (superseded) Budget provider parsing | **Superseded** — PI normalizes `Usage` per `AssistantMessage`; no multi-provider extractor needed |
| Q5.6 | Integration test fidelity | **Spawn real PI process** (not mock) via `pi-coding-agent` subprocess harness |
| Q5.7 | Settings migration | **No migration** for approval timeout (Q5.2 removed). **DB migration v4** still needed if any new setting lands in Phase 2+ (TBD per module). |
| Q5.8 | Phase 5 (budgetTracker) | **Skippable** — if phases 0–4 reveal architectural issues, budget moves to its own future spec |
| Q5.9 | Skills scope in PI backend | **Write our `ai_skills` scope to PI's native `skills` setting** via `settingsManager.applyOverrides({ skills: [...] })` at turn start. Do not register slash commands or inject prompts (PI native). `disabledSkills` is best-effort (see Open Question 5). |
| Q5.10 | Compaction | **Adopt PI-native compaction** — hook `session_before_compact` with our prompt, let PI run the summarization with the active model. Remove the "Haiku always" fallback from PI path. |
| Q5.11 | Session persistence | **Replace `SessionManager.inMemory()` with `SessionManager.create/open(sessionFile)`** — store `sessionFile` path per conversation (new column), pass to `createAgentSession`. Enables true resume across app restarts. |
| Q5.12 | Approval UI strategy | **Custom `ctx.ui` adapter** (not RPC mode) — keep PI in-process, extend the existing `PiUIContext` class in `src/main/services/piUIContext.ts` to back all `confirm/select/input/editor` calls via our stream protocol. Aligns with current architecture, no subprocess overhead. |

---

## 3. Architecture

### 3.1 File layout

```
src/
├── core/
│   ├── services/
│   │   ├── piExtensionBridge.ts          [NEW] typed facade (emit-style, no approvals)
│   │   ├── guards/                        [NEW] pure policies
│   │   │   ├── cwdGuard.ts                extracted from cwdHooks.ts
│   │   │   ├── permissionPolicy.ts        extracted from canUseTool.ts
│   │   │   └── skillsResolver.ts          new — maps ai_skills scope → path list
│   │   ├── hooks/                         [NEW or moved]
│   │   │   └── hookRunner.ts              moved from src/main/ if needed
│   │   ├── cwdHooks.ts                    unchanged behavior, imports guards/cwdGuard
│   │   ├── canUseTool.ts                  unchanged behavior, imports guards/permissionPolicy
│   │   └── streaming.ts                   unchanged
│   └── db/
│       └── migrations/
│           └── v4_pi_session_file.ts      [NEW] adds sessionFile column on conversations
├── main/
│   └── services/
│       ├── streamingPI.ts                 [MODIFIED] extensionFactories closure + SessionManager.open + native compaction
│       └── piUIContext.ts                 [EXTENDED] adapter methods for custom ctx.ui routing
└── extensions/                            [NEW — excluded from Vite bundle]
    └── agent-desktop-parity/
        ├── package.json
        ├── index.ts                       default export: (pi, ctx) => void; composes modules
        ├── modules/
        │   ├── cwdGuard/{index.ts,*.test.ts}
        │   ├── permissionModes/{index.ts,*.test.ts}      uses PI's plan-mode example as base
        │   ├── skillsBridge/{index.ts,*.test.ts}
        │   ├── hooksSystem/{index.ts,*.test.ts}
        │   └── budgetTracker/{index.ts,*.test.ts}
        └── shared/types.ts
```

### 3.2 Packaging

1. `electron-vite.config.ts` copies `src/extensions/**` (as `.ts` source) to `out/extensions/`. PI compiles at load time via its own ts-node/esbuild.
2. `electron-builder.yml` already includes `out/**` — no change.
3. `streamingPI.ts` resolves the bundled path and injects an `extensionFactories` closure (see §4).

### 3.3 Settings surface

| Setting | Type | Cascadable | Default | Consumed by |
|---|---|---|---|---|
| `agent_parity_disabledModules` | `string[]` | yes | `[]` | Extension `index.ts` factory (early-return per module) |

Note: `ai_approvalTimeoutMs` from the original draft is **removed** (Q5.2 moot — `ctx.ui` methods accept `timeout` / `signal` parameters natively). Per-module settings that require DB migration will be declared in the corresponding phase's PR.

Settings UI: `agent_parity_disabledModules` is exposed in `AISettings.tsx` under the `!isClaudeBackend` gate as a "PI Extension Modules" toggle list.

### 3.4 Principles (per CLAUDE.md)

- Barrel discipline, deep modules, DRY on knowledge, new features = new modules, abstraction at external boundaries (bridge + `extensionFactories` closure).

---

## 4. Wiring: `extensionFactories` closure + Bridge

File: `src/core/services/piExtensionBridge.ts`.

### 4.1 Context delivery via `extensionFactories` (PI-native)

Per `packages/coding-agent/docs/sdk.md`, `DefaultResourceLoader` accepts an `extensionFactories` option: an array of functions receiving the extension `pi: ExtensionAPI` and returning (or awaiting) registrations.

`streamingPI.ts` (simplified):

```ts
import extensionDefault from '<bundledPath>/index.ts'  // dynamic import at runtime
import { createBridge, type ExtensionRuntimeContext } from '../../core/services/piExtensionBridge'

// inside streamMessagePI(), before createAgentSession:
const bridge = createBridge(conversationId, { chunkSender: sendChunk })
const runtimeCtx: ExtensionRuntimeContext = {
  version: 1,
  conversationId,
  aiSettings,
  db,
  bridge,
}

const resourceLoader = new pi.DefaultResourceLoader({
  additionalExtensionPaths: [bundledExtDir, ...(userExtDir ? [userExtDir] : [])],
  extensionFactories: [(piApi) => extensionDefault(piApi, runtimeCtx)],
  ...
})
await resourceLoader.reload()
```

Extension entry (`src/extensions/agent-desktop-parity/index.ts`):

```ts
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'
import type { ExtensionRuntimeContext } from '../../core/services/piExtensionBridge'
import { initCwdGuard } from './modules/cwdGuard'
import { initPermissionModes } from './modules/permissionModes'
import { initSkillsBridge } from './modules/skillsBridge'
import { initHooksSystem } from './modules/hooksSystem'
import { initBudgetTracker } from './modules/budgetTracker'

export default function (pi: ExtensionAPI, ctx: ExtensionRuntimeContext): void {
  const disabled = new Set(ctx.aiSettings.agent_parity_disabledModules ?? [])
  if (!disabled.has('cwd-guard'))       initCwdGuard(pi, ctx)
  if (!disabled.has('permission-modes'))initPermissionModes(pi, ctx)
  if (!disabled.has('skills-bridge'))   initSkillsBridge(pi, ctx)
  if (!disabled.has('hooks-system'))    initHooksSystem(pi, ctx)
  if (!disabled.has('budget-tracker'))  initBudgetTracker(pi, ctx)
}
```

**Benefits over push/consume:**
- No module-level state, no concurrency concerns, no `version` handshake needed (TypeScript signature is the contract)
- Each session's ResourceLoader carries its own closure — perfect isolation
- Documented idiom, not a workaround

### 4.2 Bridge facade (simplified)

```ts
export interface ExtensionRuntimeContext {
  version: 1
  conversationId: number
  aiSettings: AISettings
  db: Database.Database
  bridge: PiExtensionBridge
}

export interface PiExtensionBridge {
  /** Emit a system message chunk to the UI stream. */
  emitSystemMessage(content: string, meta?: { hookName?: string; hookEvent?: string }): void

  /** Task-notification-style chunk. */
  emitTaskNotification(summary: string, meta?: { taskId?: string; status?: string; outputFile?: string }): void

  /** MCP status chunk. */
  emitMcpStatus(servers: Array<{ name: string; status: string; error?: string }>): void

  /** Record turn usage (extension reads AssistantMessage.usage directly from PI events). */
  recordTokenUsage(usage: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; costUsd?: number }): void

  /** Read accumulated usage for budget decisions. */
  getAccumulatedUsage(): { totalTokens: number; totalCostUsd: number }
}

interface BridgeDeps {
  chunkSender: (type: string, content?: string, extra?: Record<string, unknown>) => void
}

export function createBridge(conversationId: number, deps: BridgeDeps): PiExtensionBridge
```

**Explicitly NOT in the bridge** (deferred to PI-native):
- `requestApproval`, `emitAskUser` — routed via `ctx.ui.confirm/select/input/editor` and intercepted by our custom adapter on `PiUIContext` (see §4.3).
- Multi-provider usage parsing — PI normalizes on `AssistantMessage.usage`.

### 4.3 Custom `ctx.ui` adapter via `PiUIContext`

Our existing `src/main/services/piUIContext.ts` already implements the PI `ExtensionUIContext` interface (select/confirm/input/editor/notify/setStatus/setWidget) and routes them via `pi:uiRequest`/`pi:uiResponse` IPC channels to the renderer. Extension modules call `ctx.ui.confirm("Allow write to /etc/passwd?")` — our adapter handles the rest.

For Phase 2 (`permissionModes`), the only extension work is calling `ctx.ui.confirm/select` as documented. No new protocol. A small renderer task in this phase: polish the `pi:uiRequest` modal UI to match Claude's tool-approval affordances.

### 4.4 Invariants

- Bridge functions **never throw**
- Bridge state (`accumulated`) is closure-scoped per conversation
- Extension entry `default(pi, ctx)` is synchronous or returns a Promise that awaits any async init (PI handles both)

---

## 5. Modules

### 5.1 `cwdGuard`

| Field | Value |
|---|---|
| Responsibility | Block file writes and bash commands outside CWD + whitelist |
| PI events | `tool_call` |
| Settings read | `cwdRestrictionEnabled`, `cwd`, `cwdWhitelist` |
| Core imports | `guards/cwdGuard.isPathAllowedForWrite`, `isBashCommandAllowed` |
| Bridge calls | `emitSystemMessage` |
| No-op if | `!cwdRestrictionEnabled` |

Align with PI's `protected-paths.ts` example (`packages/coding-agent/examples/extensions/protected-paths.ts`) — same `tool_call` + `{ block, reason }` idiom. Handles `write`, `edit`, `bash`. Relative paths resolved against `cwd`. Symlinks not resolved (matches Claude's policy).

### 5.2 `permissionModes` (based on PI's `plan-mode` example)

| Field | Value |
|---|---|
| Responsibility | Implement 5 permission modes + plan-mode exit, based on PI's reference `plan-mode/` example |
| Base | `packages/coding-agent/examples/extensions/plan-mode/{index.ts, utils.ts}` — forked, not redesigned |
| PI events | `tool_call` (consumed), also uses `setActiveTools` for plan mode read-only switch |
| Tools registered | `exit_plan_mode` (from PI's example, adapted) |
| Settings read | `permissionMode`, `requirePlanApproval` |
| Core imports | `guards/permissionPolicy.shouldRequireApproval` |
| UI calls | `ctx.ui.confirm`, `ctx.ui.select` (native PI, via our custom adapter) |
| Internal state | `approvalCache: Map<string,boolean>` (for `dontAsk` mode), `planModeActive: boolean` |

Modes (on top of PI's plan-mode base):
- `bypassPermissions`: allow all, `tool_call` returns undefined
- `acceptEdits`: auto-approve edits, `ctx.ui.confirm` for bash
- `default`: `ctx.ui.confirm(reason)` for write/edit/bash
- `dontAsk`: like default but caches decisions by `(toolName, hashInput(input))`
- `plan`: fork PI's `plan-mode` behavior — `setActiveTools(['read', 'grep', 'find', ...])` to block mutations, `exit_plan_mode` tool flips the flag and restores full tools (with optional `ctx.ui.confirm` gated by `requirePlanApproval`)

### 5.3 `skillsBridge` (native settings writer)

| Field | Value |
|---|---|
| Responsibility | Map our `ai_skills` scope to PI's native `skills` setting array |
| Events | None (runs at factory init) |
| Settings read | `skills` (off/user/project/local), `skillsEnabled`, `disabledSkills`, `cwd` |
| Core imports | `guards/skillsResolver.getSkillPaths(cwd, scope)` |
| PI API used | `pi.settingsManager.applyOverrides({ skills: [...] })` (per `sdk.md` §"Settings Management") |

At factory init, write the paths corresponding to our scope into PI's in-memory settings. PI handles the rest natively (discovery, `/skill:name` commands, system-prompt XML injection, on-demand load).

```ts
if (!ctx.aiSettings.skills || ctx.aiSettings.skills === 'off' || ctx.aiSettings.skillsEnabled === false) {
  pi.settingsManager.applyOverrides({ skills: [] })  // explicit empty disables
  return
}
const paths = getSkillPaths(ctx.aiSettings.cwd ?? process.cwd(), ctx.aiSettings.skills)
pi.settingsManager.applyOverrides({ skills: paths })
```

`disabledSkills` filtering: see Open Question 5 — no PI-native hook; best-effort via `pi.getCommands()` + attempted unregister. If PI exposes no unregister for skill-registered commands, we document the gap and fall back to emitting a system message at turn start listing the skills that will still be visible to the agent.

### 5.4 `hooksSystem` (config-file adapter on top of PI events)

| Field | Value |
|---|---|
| Responsibility | Run user-defined hooks from `~/.claude/settings.json` (shared) or `~/.agent-desktop/hooks.json`, bridge their output to PI events |
| PI events | `input`, `tool_call`, `tool_result`, `session_start` (reason:"startup"), `agent_end` |
| Settings read | `sharedHooks`, `webhookCompletionUrl`, `cwd` |
| Core imports | `hooks/hookRunner.runHooks` (moved to core if not already) |
| Bridge calls | `emitSystemMessage` |

Reframe: this is **not** a hook system — PI has one. This is the app-side **config-file adapter** that translates our users' hook declarations (inherited from Claude setup) into calls against PI's native event API. Webhook completion is a single `fetch()` inside the `agent_end` handler (not a separate feature).

### 5.5 `budgetTracker` (reads `AssistantMessage.usage`)

| Field | Value |
|---|---|
| Responsibility | Accumulate tokens/cost from PI's normalized `Usage`; block `tool_call` when `maxBudgetUsd` exceeded |
| PI events | `message_end` (reads `message.usage`), `tool_call` (enforces cap) |
| Settings read | `maxBudgetUsd` |
| Bridge calls | `recordTokenUsage`, `getAccumulatedUsage`, `emitSystemMessage` |
| No-op if | `!maxBudgetUsd` or `maxBudgetUsd === 0` |

PI normalizes `Usage` across Anthropic/OpenAI/Groq/Cohere/Together in `AssistantMessage.usage` (`input`, `output`, `cacheRead`, `cacheWrite`, `totalTokens`, `cost: { total, ... }`). No custom extractor needed. The module reads directly:

```ts
pi.on('message_end', (event) => {
  const msg = event.message
  if (msg.role === 'assistant' && msg.usage) {
    ctx.bridge.recordTokenUsage({
      input: msg.usage.input,
      output: msg.usage.output,
      cacheRead: msg.usage.cacheRead,
      cacheWrite: msg.usage.cacheWrite,
      costUsd: msg.usage.cost?.total,
    })
  }
})

pi.on('tool_call', (event) => {
  const { totalCostUsd } = ctx.bridge.getAccumulatedUsage()
  if (totalCostUsd >= ctx.aiSettings.maxBudgetUsd!) {
    ctx.bridge.emitSystemMessage(`Budget cap $${ctx.aiSettings.maxBudgetUsd} reached ($${totalCostUsd.toFixed(4)})`, { hookName: 'budget-tracker', hookEvent: 'PreToolUse' })
    return { block: true, reason: 'Budget cap exceeded' }
  }
})
```

---

## 6. Streaming-PI wiring additions (not extensions)

Two changes to `streamingPI.ts` that complement the extension but live in app code because they concern session lifecycle, not per-turn hooks.

### 6.1 Native compaction adoption (Phase 6)

Today our `/compact` command forces a Claude Haiku summarization regardless of backend (cf. CLAUDE.md gotcha and MEMORY.md note). PI natively supports compaction per `packages/coding-agent/docs/compaction.md`: threshold-based trigger (`reserveTokens`, `keepRecentTokens` settings), `ctx.compact()` API, `session_before_compact` event exposing `preparation.messagesToSummarize` / `turnPrefixMessages` / `previousSummary` / `fileOps`, structured `CompactionEntry` persisted in session, cumulative file tracking across compactions.

**Plan:**
- Remove the "Haiku always in PI mode" fallback from the `/compact` handler.
- In PI mode, invoke `session.compact()` (or equivalent PI API) — let PI run summarization with the active model.
- Optionally: hook `session_before_compact` to inject our custom summary prompt template (`ai_compactSummaryPrompt` setting) if set.
- Update `CLAUDE.md` gotcha entry.

### 6.2 Persistent session (Phase 7)

Today `streamingPI.ts:230` uses `SessionManager.inMemory()` — no persistence, no resume.

PI documents `SessionManager.create(cwd)`, `SessionManager.open(path)`, `SessionManager.continueRecent(cwd)`, JSONL persistence at `~/.pi/agent/sessions/--<path>--/<timestamp>_<uuid>.jsonl`, plus tree API (`getTree`, `getBranch`, `branch`, `fork`, `clone`, `navigate`).

**Plan:**
- DB migration v4: add `pi_session_file TEXT` column on `conversations`.
- In `streamMessagePI`:
  - First turn of a conversation → `SessionManager.create(cwd)`, capture `.filepath`, write to `pi_session_file`.
  - Subsequent turns → `SessionManager.open(pi_session_file)`.
  - On corruption/file-missing → fall back to `SessionManager.create`, clear the column (same resilience pattern as the Claude path's `sdk_session_id` retry).
- Map our `/clear` command to `SessionManager.create` (new file), keeping the old session file on disk for audit.

Both changes are **orthogonal to the extension** but shipped in this spec because they complete the parity story.

---

## 7. Data Flow

### 7.1 Happy path — write inside CWD (with `ctx.ui.confirm`)

```
User sends message
  → streamingPI.streamMessagePI()
    → bridge = createBridge(42, { chunkSender: sendChunk })
    → runtimeCtx = { version:1, conversationId:42, aiSettings, db, bridge }
    → resourceLoader = new DefaultResourceLoader({ extensionFactories: [(pi) => extensionDefault(pi, runtimeCtx)], ... })
    → resourceLoader.reload()
      → extensionDefault(piApi, runtimeCtx)
        → initCwdGuard(pi, ctx); initPermissionModes(pi, ctx); ...
    → SessionManager.open(pi_session_file) or create(cwd)
    → session.prompt(userMessage)
      → PI emits tool_call {toolName:'write', input:{path:'/project/foo.ts'}}
        → cwdGuard: allowed → undefined
        → permissionModes: mode==='default' → await ctx.ui.confirm("Allow write to /project/foo.ts?")
          → PiUIContext routes via pi:uiRequest to renderer
          → User clicks Allow → pi:uiResponse resolves the promise
          → permissionModes returns undefined (allow)
        → hooksSystem: PreToolUse hooks run
        → budgetTracker: totalCost < cap → undefined
      → PI executes the write, emits message_end with usage
        → budgetTracker accumulates usage via bridge
      → tool_result → hooksSystem PostToolUse
```

### 7.2 Block — write outside CWD

```
tool_call → cwdGuard: isPathAllowedForWrite('/etc/passwd') = { allowed: false, reason }
  → bridge.emitSystemMessage('Write blocked: ...', { hookName:'cwd-guard', hookEvent:'PreToolUse' })
  → return { block: true, reason }
PI short-circuits subsequent handlers and synthesizes a "Blocked by extension" tool_result.
```

### 7.3 Plan mode exit

```
User sets permissionMode='plan'
  → permissionModes init: setActiveTools(['read', 'grep', 'find', 'ls', ...])   // read-only subset
  → Agent proposes plan, calls exit_plan_mode
  → permissionModes: if requirePlanApproval, await ctx.ui.confirm('Exit plan mode and make changes?')
  → On approve: setActiveTools([...originalTools]); planModeActive = false; return success
```

### 7.4 Concurrent conversations

Each call to `streamMessagePI` builds its own `ExtensionRuntimeContext` (closure) and its own `ResourceLoader`. No shared module-level state. PI loads a fresh extension instance per ResourceLoader. Perfect isolation.

---

## 8. Error Handling

| Scenario | Behavior | Owner |
|---|---|---|
| Extension factory throws | PI catches, logs, session continues without the extension | PI SDK |
| `tool_call` handler throws | PI fail-safe blocks the tool | Modules avoid throws; always return explicit `{block, reason}` or undefined |
| `ctx.ui.confirm` never answered | Either timeout (if passed) or indefinite until conversation abort | PI + our `PiUIContext` |
| `abortStream` during pending UI | `PiUIContext.dispose()` resolves all pending with `undefined`/`false` (already implemented) | `piUIContext.ts` (existing) |
| `bridge.emitSystemMessage` after conv finished | `sendChunk` forwards; renderer ignores stale convIds | `core/streaming.ts` (existing) |
| Webhook fetch fails | Caught, logged, turn unaffected | `hooksSystem` |
| Hook runner throws/times out | `runHooks` catches, returns `[]` | `hookRunner.ts` |
| Bundled extension dir missing | PI logs "no extensions", session continues | `streamingPI.ts` |
| `pi_session_file` points to corrupted file | `SessionManager.open` throws → fallback `SessionManager.create`, clear column | `streamingPI.ts` §6.2 |
| `pi.settingsManager.applyOverrides` throws | Caught, logged, skills fall back to PI defaults | `skillsBridge` |
| PI command-unregister API missing for `disabledSkills` | Emit warning system_message at turn start, user informed | `skillsBridge` (Open Q5) |

**Invariant**: no module throws unhandled. Every failure path is caught or typed.

---

## 9. Testing Strategy

### 9.1 Layers

| Level | Target | Tool |
|---|---|---|
| 0 | Pure policies (`guards/*`) | Vitest, table-driven |
| 1 | Bridge (`createBridge`) + `PiUIContext` adapter | Vitest with mocked callbacks |
| 2 | Each module in isolation | Vitest with mocked `pi` event registry + minimal ctx |
| 3 | Integration: real PI subprocess + loaded extension | Vitest + `pi-coding-agent` spawn harness |
| 4 | `streamingPI` wiring (session persistence, compaction) | Vitest integration tests against real sqlite temp DB |

Coverage targets: **≥ 85% lines, ≥ 75% branches** for extension modules and guards.

### 9.2 Integration approach

Integration tests spawn a real `pi-coding-agent` process, feed scripted prompts, inject a capturing `chunkSender` via `setChunkSender`, and assert the resulting chunk sequence. Slower (~seconds/test) but catches wiring bugs mocks miss. 2–3 key tests minimum per phase; fall back to mocked harness if CI time becomes painful.

---

## 10. Phasing

Seven sequential PRs. Each independently mergeable.

### Phase 0 — Infrastructure (~350 lines code + tests)
- `piExtensionBridge.ts` (no push/consume — just `createBridge` + types + `ExtensionRuntimeContext`)
- `guards/` extraction (`cwdGuard`, `permissionPolicy`, `skillsResolver`)
- `streamingPI.ts` wiring: `extensionFactories` closure
- `src/extensions/agent-desktop-parity/` scaffold (package.json, no-op index.ts with default export, shared/types.ts)
- `electron-vite.config.ts` copy rule
- Tests: level 0 (policies), level 1 (bridge), skeleton integration test

### Phase 1 — `cwdGuard` (~150 lines)
- Module + level 2 tests + integration test

### Phase 2 — `permissionModes` based on PI's plan-mode (~200 lines)
- Fork `plan-mode/` example into `modules/permissionModes/`; extend with 4 non-plan modes + approval cache
- `PiUIContext` adapter polish for approval-style dialogs (small ChatView change if needed)
- Tests: mode transitions, cache, plan-mode read-only lockdown

### Phase 3 — `hooksSystem` (~400 lines)
- Move `hookRunner.ts` to `src/core/services/hooks/` if needed
- Five hook points + webhook on `agent_end`
- Tests with mocked `child_process`

### Phase 4 — `skillsBridge` (~50 lines)
- `settingsManager.applyOverrides({ skills: paths })` at factory init
- `disabledSkills` best-effort (document limitation if PI lacks command unregister)
- Tests: path list per scope, empty for `off`

### Phase 5 — `budgetTracker` (~150 lines, may be deferred)
- `message_end` accumulator + `tool_call` cap check (no multi-provider extractor)
- Tests: usage accumulation, block threshold

### Phase 6 — Native compaction adoption (~200 lines)
- Remove Haiku fallback for PI backend in `/compact` handler
- Wire `session.compact()` API
- Optional `session_before_compact` hook for custom summary prompt
- Update CLAUDE.md gotcha
- Tests: compaction triggers, result persists in session

### Phase 7 — Persistent PI session (~250 lines)
- DB migration v4: `pi_session_file TEXT` column
- `streamingPI.ts`: `SessionManager.create` on first turn, `SessionManager.open` on subsequent
- Corrupted-file fallback (mirror Claude's `sdk_session_id` retry)
- `/clear` maps to new-session-file
- Tests: create, resume, corrupted-fallback, `/clear` behavior

**Total**: ~1750 lines code + ~2000 lines tests. Lines are similar to pre-audit despite module simplifications because Phases 6 and 7 were added.

### Per-phase completion criteria

- Tests at appropriate level pass, coverage thresholds met
- `npm run build` clean, `npm test` no regression
- Manual smoke passes
- CHANGELOG + CLAUDE.md updated for new gotchas

---

## 11. Out of Scope

- **Claude path migration to the same extension system** — the extension consumes Claude policies; Claude path structure stays.
- **MCP migration from `syncPiMcpForProject` into the extension** — stays in `streamingPI.ts` (setup time, not runtime hook).
- **Upstream PI changes** (e.g. a `skills_filter` event for our `disabledSkills` case) — pursued via issue/PR to `pi-mono`, not blocking this spec.
- **Custom `AskUserQuestion` tool wrapper** — `ctx.ui.*` covers the runtime need. A dedicated tool with schema validation can land post-v1.

---

## 12. Open Questions / Risks

1. **Real PI subprocess integration tests are slow.** Fall back to curated mock harness if CI time suffers; keep 2–3 real-PI tests as smoke.
2. **`pi-coding-agent` version pinning.** Currently `^0.55.1`. Event shape or `ExtensionAPI` breaking changes require extension updates. Pin exact version, bump deliberately.
3. **Shared-code imports from `src/core/services/*`.** Works for bundled extension (same app). Would not work for external npm publish — acceptable per Q1.
4. **`settings_sharedAcrossBackends` path resolution for hooks.** Confirm during Phase 3 whether `~/.claude/settings.json` vs `~/.agent-desktop/hooks.json` is correct.
5. **`disabledSkills` filtering in `skillsBridge`.** PI does not document an unregister method for skill-registered slash commands. v1 fallback: emit a system message listing undisabled skills. Long-term: propose upstream hook.
6. **`PiUIContext` adapter completeness.** The existing class implements most of the `ExtensionUIContext` interface. Audit during Phase 2 that all methods used by PI's `plan-mode` example are covered; extend as needed.
7. **Compaction with custom prompt template.** Whether `session_before_compact` exposes enough to fully customize the summary is TBD during Phase 6 spike.
8. **`/clear` semantics on PI sessions.** New session file (preserves history on disk) vs truncate existing (loses history). Recommend new-file; confirm during Phase 7.

---

## 13. Next Step

Invoke the `writing-plans` skill to produce a detailed phase-by-phase implementation plan.
