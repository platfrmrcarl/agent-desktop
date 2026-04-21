# Agent Desktop Parity Extension — Design Spec

- **Date**: 2026-04-21
- **Status**: Approved (brainstorming phase complete)
- **Author**: Laurent Baaziz (via brainstorming session)
- **Scope**: Bring the PI backend of Agent Desktop to feature parity with the Claude Agent SDK backend, via a bundled PI extension that consumes shared core policies.

---

## 1. Motivation

Agent Desktop supports two AI backends: `claude-agent-sdk` (default) and `pi` (`@mariozechner/pi-coding-agent`). The Claude path exposes rich safety and UX features — CWD write restriction, permission modes, hook system messages, skills, budget caps — implemented directly in `src/core/services/streaming.ts` and the related hook/guard modules.

The PI path (`src/main/services/streamingPI.ts`) currently maps only the minimum set of PI session events to the existing stream chunk protocol. Users switching backend lose:

- CWD write protection (PI writes anywhere without prompting)
- Permission modes and interactive tool approval
- Skills discovery and the `Skill` tool
- User-defined hooks (PreToolUse, PostToolUse, UserPromptSubmit, Stop)
- Budget caps (`maxBudgetUsd`)
- Task notifications, webhook completion

The PI SDK exposes a **rich extension system** (factory signature, event bus, tool/command registration, UI context, resource loaders, provider registration). Nearly all Claude-only features can be replicated via extensions without patching `pi-coding-agent`.

The goal of this spec: design a **single bundled extension** (`agent-desktop-parity`) containing five independent modules that together close the parity gap. The extension is shipped with the app, loaded automatically when the PI backend is active, and reads per-conversation settings via a typed in-process bridge.

---

## 2. Decisions Record

Summarized from the brainstorming Q&A:

| # | Decision | Choice |
|---|---|---|
| Q1 | Distribution model | **Bundled with the app** — lives in `src/extensions/`, auto-pointed by `streamingPI.ts`, no user install |
| Q2 | Scope | **All five modules** in v1: `cwdGuard`, `permissionModes`, `skillsBridge`, `hooksSystem`, `budgetTracker` |
| Q3 | Config bridge | **In-process registry with closure capture** — `setPendingExtensionContext` before `resourceLoader.reload()`, extension factory consumes and captures in closure |
| Q4 | UI return channel | **Bidirectional typed bridge** exposing `emitSystemMessage`, `requestApproval`, `emitAskUser`, `emitTaskNotification`, `emitMcpStatus`, `recordTokenUsage`, `getAccumulatedUsage` |
| Q5 | Relation to Claude path | **Extension consumes Claude's existing logic** — pure policies extracted to `src/core/services/guards/` and reused by both backends; Claude path structure unchanged |
| Q5.1 | Bridge dependency injection | **Decoupled via callbacks** — `createBridge(convId, { chunkSender, registerPending })` rather than passing the `pendingRequests` Map |
| Q5.2 | Approval timeout | **Configurable via `ai_approvalTimeoutMs` setting** (cascadable, 0 = disabled, default 0) |
| Q5.3 | `consumePendingExtensionContext` storage | **Simple field** (not LIFO stack) — sequential `await resourceLoader.reload()` guarantees ordering |
| Q5.4 | Handler `tool_call` throw semantics | **Fail-safe block** (PI default) — handlers return explicit `{ block, reason }`; throws are caught by PI and treated as block |
| Q5.5 | Budget provider support | **All providers** — `usageExtractor` covers Anthropic, OpenAI (completions/chat/responses), Groq, Cohere, Together |
| Q5.6 | Integration test fidelity | **Spawn real PI process** (not mock) via `pi-coding-agent` subprocess harness |
| Q5.7 | Settings migration | **DB migration v4** for `ai_approvalTimeoutMs` |
| Q5.8 | Phase 5 (budgetTracker) | **Skippable** — if phases 0–4 reveal architectural issues, budget moves to its own future spec |

---

## 3. Architecture

### 3.1 File layout

```
src/
├── core/
│   ├── services/
│   │   ├── piExtensionBridge.ts          [NEW] bidirectional bridge
│   │   ├── guards/                        [NEW] pure policies
│   │   │   ├── cwdGuard.ts                extracted from cwdHooks.ts
│   │   │   ├── permissionPolicy.ts        extracted from canUseTool.ts
│   │   │   ├── skillsResolver.ts          new
│   │   │   └── usageExtractor.ts          new (multi-provider usage parsing)
│   │   ├── hooks/                         [NEW or moved]
│   │   │   └── hookRunner.ts              moved from src/main/ if needed
│   │   ├── cwdHooks.ts                    unchanged behavior, imports guards/cwdGuard
│   │   ├── canUseTool.ts                  unchanged behavior, imports guards/permissionPolicy
│   │   └── streaming.ts                   unchanged
│   └── db/
│       └── migrations/
│           └── v4_approval_timeout.ts     [NEW] adds ai_approvalTimeoutMs setting
├── main/
│   └── services/
│       └── streamingPI.ts                 [MODIFIED] push context + register bundled ext dir
└── extensions/                            [NEW — excluded from Vite bundle]
    └── agent-desktop-parity/
        ├── package.json
        ├── index.ts                       factory, composes modules
        ├── modules/
        │   ├── cwdGuard/{index.ts,*.test.ts}
        │   ├── permissionModes/{index.ts,*.test.ts}
        │   ├── skillsBridge/{index.ts,*.test.ts}
        │   ├── hooksSystem/{index.ts,*.test.ts}
        │   └── budgetTracker/{index.ts,*.test.ts}
        └── shared/types.ts
```

### 3.2 Packaging

1. `electron-vite.config.ts` copies `src/extensions/**` (as `.ts` source) to `out/extensions/`. PI compiles at load time via its own ts-node/esbuild.
2. `electron-builder.yml` already includes `out/**` — no change.
3. `streamingPI.ts` computes the bundled path:
   ```ts
   const bundledExtDir = path.join(app.getAppPath(), 'out/extensions/agent-desktop-parity')
   ```
4. The existing `pi_extensionsDir` user setting still takes effect — the user's directory is appended after the bundled one.

### 3.3 Settings surface

| Setting | Type | Cascadable | Default | Consumed by |
|---|---|---|---|---|
| `agent_parity_disabledModules` | `string[]` | yes | `[]` | `index.ts` factory (early-return per module if listed) |
| `ai_approvalTimeoutMs` | `number` | yes | `0` (disabled) | `bridge.requestApproval`, `bridge.emitAskUser` |

Settings `agent_parity_disabledModules` is exposed in `AISettings.tsx` under the `!isClaudeBackend` gate as a "PI Extension Modules" section with a toggle per module.

### 3.4 Principles (per CLAUDE.md)

- **Barrel file discipline**: `extensions/agent-desktop-parity/index.ts` is the sole public entry.
- **Deep module**: external interface is one factory function; internal complexity (five modules + shared types) is hidden.
- **DRY on knowledge**: business policies live once in `guards/`; Claude and PI are thin adapters.
- **New features = new modules**: no structural changes to Claude path.
- **Abstraction at external boundaries**: the bridge is the seam between app core and extension package.

---

## 4. Bridge Contract

File: `src/core/services/piExtensionBridge.ts`.

### 4.1 Context push/pull

```ts
export interface PendingExtensionContext {
  version: 1
  conversationId: number
  aiSettings: AISettings
  db: Database.Database
  bridge: PiExtensionBridge
}

let pending: PendingExtensionContext | null = null

export function setPendingExtensionContext(ctx: PendingExtensionContext): void {
  if (pending !== null) {
    console.warn('[piExtensionBridge] overwriting unconsumed pending context')
  }
  pending = ctx
}

export function consumePendingExtensionContext(): PendingExtensionContext | null {
  const ctx = pending
  pending = null
  return ctx
}
```

- **Simple field** (not stack) — sequential `await resourceLoader.reload()` in `streamingPI.ts` guarantees `push → load → consume` ordering for a single turn.
- **`console.warn` on overwrite** — surfaces the bug where a dev forgot to `await` between two turns.
- **`version: 1`** — breaking changes bump this; extension can fail-fast on mismatch.

### 4.2 Bridge facade

```ts
export interface PiExtensionBridge {
  emitSystemMessage(content: string, meta?: { hookName?: string; hookEvent?: string }): void
  requestApproval(toolName: string, toolInput: unknown, reason: string): Promise<ToolApprovalResponse>
  emitAskUser(question: string, options?: { choices?: string[]; placeholder?: string }): Promise<string | undefined>
  emitTaskNotification(summary: string, meta?: { taskId?: string; status?: string; outputFile?: string }): void
  emitMcpStatus(servers: Array<{ name: string; status: string; error?: string }>): void
  recordTokenUsage(usage: UsageRecord): void
  getAccumulatedUsage(): { totalTokens: number; totalCostUsd: number }
}

interface BridgeDeps {
  chunkSender: (type: string, content?: string, extra?: Record<string, unknown>) => void
  registerPending: (id: string, resolve: (value: unknown) => void, conversationId: number) => void
  approvalTimeoutMs?: number  // 0 or undefined = no timeout
}

export function createBridge(conversationId: number, deps: BridgeDeps): PiExtensionBridge
```

### 4.3 Invariants

- Bridge functions **never throw**. Errors surface via Promise reject (for approval/ask-user) or are swallowed silently (for fire-and-forget emits).
- Bridge state (`accumulated`) is closure-scoped to the conversation — two concurrent conversations have two independent bridges.
- `requestApproval` with `approvalTimeoutMs > 0`: auto-resolves with `{ behavior: 'deny', message: 'Approval timeout' }` after timeout. Pending entry is cleaned up.

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

Handles `Write`, `Edit`, `Bash`. Relative paths resolved against `cwd`. Symlinks not resolved (same policy as Claude path).

### 5.2 `permissionModes`

| Field | Value |
|---|---|
| Responsibility | Implement the five permission modes + plan-mode exit |
| PI events | `tool_call` |
| Tools registered | `exitPlanMode` (custom tool) |
| Settings read | `permissionMode`, `requirePlanApproval`, `ai_approvalTimeoutMs` |
| Core imports | `guards/permissionPolicy.shouldRequireApproval` |
| Bridge calls | `requestApproval` |
| Internal state | `approvalCache: Map<string,boolean>` (for `dontAsk` mode), `planModeActive: boolean` |

Modes:
- `bypassPermissions`: allow all
- `acceptEdits`: auto-approve edits, require approval for bash
- `default`: require approval for write/edit/bash
- `dontAsk`: like default but caches decisions by `(toolName, inputHash)`
- `plan`: block all mutating tools, only reads allowed; `exitPlanMode` tool sets `planModeActive = false` (with optional approval via `requirePlanApproval`)

`planModeActive` is session-scoped (`let` in closure), not a static setting.

### 5.3 `skillsBridge`

| Field | Value |
|---|---|
| Responsibility | Expose `.claude/skills/` as PI slash commands |
| PI events | `resources_discover` |
| Commands registered | One per discovered `SKILL.md` |
| Settings read | `skills` (off/user/project/local), `skillsEnabled`, `disabledSkills`, `cwd` |
| Core imports | `guards/skillsResolver.discoverSkills`, `getSkillPaths` |
| Bridge calls | — |

Discovery happens at factory time (per-turn). Changes to `disabledSkills` mid-turn take effect on the next turn (same as Claude's semantics).

### 5.4 `hooksSystem`

| Field | Value |
|---|---|
| Responsibility | Execute user-defined hooks + webhook completion |
| PI events | `input`, `tool_call`, `tool_result`, `before_agent_start`, `agent_end` |
| Settings read | `sharedHooks`, `webhookCompletionUrl`, `cwd` |
| Core imports | `hooks/hookRunner.runHooks` |
| Bridge calls | `emitSystemMessage` |

Hook types:
- `UserPromptSubmit` → `input` event
- `PreToolUse` → `tool_call` event (can return `{ block: true, reason }` if hook says deny)
- `PostToolUse` → `tool_result` event
- `SessionStart` → `before_agent_start` event (first turn only; tracked via closure flag)
- `Stop` → `agent_end` event

Hook definitions loaded from `~/.claude/settings.json` if `sharedHooks === true`, else from `~/.agent-desktop/hooks.json`. Output parsed for `systemMessage` field (JSON); non-JSON output silently ignored (matches Claude behavior per CLAUDE.md).

Webhook on `agent_end`: POST to `webhookCompletionUrl` with `{ conversationId, timestamp }`; `fetch` failures caught and logged, never affect the turn.

### 5.5 `budgetTracker`

| Field | Value |
|---|---|
| Responsibility | Accumulate tokens/cost; block tool calls when `maxBudgetUsd` exceeded |
| PI events | `after_provider_response`, `tool_call` |
| Settings read | `maxBudgetUsd` |
| Core imports | `guards/usageExtractor.extractUsageFromResponse` |
| Bridge calls | `recordTokenUsage`, `getAccumulatedUsage`, `emitSystemMessage` |
| No-op if | `!maxBudgetUsd` or `maxBudgetUsd === 0` |

`usageExtractor` handles Anthropic (`usage.input_tokens/output_tokens/cache_*`), OpenAI (completions/chat/responses `usage.prompt_tokens/completion_tokens`), Groq (OpenAI-compatible), Cohere (`meta.billed_units`), Together (OpenAI-compatible). Each provider maps to a common `UsageRecord { input, output, cache_read, cache_creation, costUsd }`. Cost computed from model pricing table (or provider-reported `cost` field if present).

---

## 6. Data Flow

### 6.1 Happy path — write inside CWD

```
User sends message
  → streamingPI.streamMessagePI()
    → setPendingExtensionContext({ version:1, convId:42, aiSettings, db, bridge })
    → resourceLoader.reload()
      → agent-desktop-parity factory executes
        → consumePendingExtensionContext() returns ctx
        → initCwdGuard, initPermissionModes, ..., initBudgetTracker
    → session.prompt(userMessage)
      → PI emits tool_call {toolName:'write', input:{path:'/project/foo.ts'}}
        → cwdGuard: allowed → undefined
        → permissionModes: mode==='default' → requestApproval(...)
          → bridge.requestApproval()
            → chunkSender('tool_approval_request', ..., {requestId, toolName, toolInput})
              → IPC to renderer → ApprovalPrompt UI
            → registerPending(id, resolve, 42)
            → Promise pending
          → User clicks Allow → IPC respondToApproval(id, {behavior:'allow'}) → resolve
          → permissionModes returns undefined (allow)
        → hooksSystem: PreToolUse hooks run, no block
        → budgetTracker: totalCost < max → undefined
      → PI executes the write, emits tool_result
      → hooksSystem: PostToolUse hooks fire, may emit system_message
```

### 6.2 Block path — write outside CWD

```
tool_call → cwdGuard: isPathAllowedForWrite('/etc/passwd') = { allowed: false, reason }
  → bridge.emitSystemMessage('Write blocked: ...', { hookName:'cwd-guard', hookEvent:'PreToolUse' })
  → return { block: true, reason }
PI short-circuits subsequent handlers. Synthesizes a tool_result of "Blocked by extension".
```

### 6.3 Budget exceeded

```
after_provider_response → extractUsageFromResponse → bridge.recordTokenUsage({..., costUsd: 0.03})
accumulated.totalCostUsd grows turn by turn.
Next tool_call → budgetTracker: totalCostUsd > maxBudgetUsd
  → emitSystemMessage('Budget cap reached ...')
  → return { block: true, reason }
```

### 6.4 Concurrent conversations

Each call to `streamMessagePI` creates its own ResourceLoader, pushes its own context, loads a fresh extension instance with its own closure. No shared module-level state. Stack is not needed because `await resourceLoader.reload()` enforces sequential push/consume per call.

---

## 7. Error Handling

| Scenario | Behavior | Owner |
|---|---|---|
| `consumePendingExtensionContext()` returns null | Factory returns early, no handlers registered | `extensions/.../index.ts` |
| Factory throws | PI catches, logs, session continues without the extension | PI SDK (documented) |
| `tool_call` handler throws | PI fail-safe blocks the tool | PI SDK — we avoid throws, always return explicit `{ block, reason }` |
| `bridge.requestApproval` never resolves (user never answers) | Timeout auto-deny after `ai_approvalTimeoutMs` if set; otherwise indefinite until conversation abort | `piExtensionBridge` |
| `abortStream` during pending approval | `pendingRequests` entries auto-resolve with `{ behavior: 'deny', message: 'Request cancelled' }` (existing core logic) | `core/streaming.ts` |
| `bridge.emitSystemMessage` after conv finished | `sendChunk` forwards anyway; renderer ignores stale convIds | `core/streaming.ts` (existing) |
| Webhook fetch fails | Caught, logged, turn unaffected | `hooksSystem` module |
| Hook runner throws or times out | `runHooks` catches, returns `[]` | `hookRunner.ts` |
| Bundled extension dir missing | PI logs "no extensions", session continues | `streamingPI.ts` |
| `aiSettings.cwd` undefined | Fallback to `process.cwd()` | `cwdGuard` module |
| `db` in ctx null | v1 modules do not re-query DB, so this is tolerated | — |

**Invariant**: no module throws unhandled. Every failure path is either caught and logged, or converted to a typed return.

---

## 8. Testing Strategy

### 8.1 Layers

| Level | Target | Tool |
|---|---|---|
| 0 | Pure policies (`guards/*`, `usageExtractor`) | Vitest, table-driven |
| 1 | Bridge (`createBridge`, push/consume) | Vitest with mocked callbacks |
| 2 | Each module in isolation | Vitest with mocked `pi` event registry + minimal ctx |
| 3 | Integration: `streamingPI` + loaded extension + real PI subprocess | Vitest with spawned `pi-coding-agent` harness |
| 4 | Invariants: push/consume ordering, isolation | Vitest |

Coverage targets: **≥ 85% lines, ≥ 75% branches** for extension modules and guards (above project default of 70/60).

### 8.2 Integration test approach

Integration tests spawn a **real PI process** via `pi-coding-agent` and feed it scripted prompts. The extension is loaded from the source tree (not a compiled asar). The test observes `sendChunk` calls by injecting a capturing `chunkSender` via `setChunkSender`. Slower (~seconds per test) but catches wiring bugs the mocks would miss.

### 8.3 Manual smoke per phase

After each module ships:
1. Launch app with PI backend selected.
2. Trigger the module's intended behavior (e.g., ask PI to write `/etc/passwd` for cwdGuard).
3. Verify stream chunks in DevTools + UI rendering in ChatView.
4. Toggle the module off via `agent_parity_disabledModules` — behavior disappears, no crash.

---

## 9. Phasing

Six sequential PRs. Each is independently mergeable.

### Phase 0 — Infrastructure (~400 lines code + tests)
- `piExtensionBridge.ts` (push/consume + `createBridge`)
- `guards/` extraction (`cwdGuard`, `permissionPolicy`, `skillsResolver`, `usageExtractor`)
- `streamingPI.ts` wiring (push context, append bundled path)
- `src/extensions/agent-desktop-parity/` scaffold (package.json, no-op index.ts, shared/types.ts)
- `electron-vite.config.ts` copy rule for `src/extensions/**` → `out/extensions/`
- Tests: level 0 (policies), level 1 (bridge), level 4 (invariants)

### Phase 1 — `cwdGuard` (~150 lines)
- Module + level 2 tests
- Integration test: block write outside CWD

### Phase 2 — `permissionModes` (~300 lines)
- Five modes + `exitPlanMode` tool + approval cache
- DB migration v4 adding `ai_approvalTimeoutMs`
- Settings UI exposure in `AISettings.tsx` (under `!isClaudeBackend` gate) + `OverrideFormFields.tsx` with `piOnly: true` metadata entry
- Tests: approval flow, cache, timeout behavior

### Phase 3 — `hooksSystem` (~400 lines)
- Optional move of `hookRunner.ts` to `src/core/services/hooks/`
- Five hook points + webhook completion
- Tests with mocked `child_process`

### Phase 4 — `skillsBridge` (~150 lines)
- Discovery + slash command registration
- Tests with fake fs

### Phase 5 — `budgetTracker` (~350 lines, may be deferred)
- `usageExtractor` table for 5+ providers
- Accumulator + block logic
- Tests per provider

**Total**: ~1750 lines code + ~2000 lines tests.

### Per-phase completion criteria

- Tests at the appropriate level pass, coverage thresholds met
- `npm run build` clean
- `npm test` no regression
- Manual smoke passes
- CHANGELOG updated; `CLAUDE.md` updated if a new gotcha surfaces

---

## 10. Out of Scope

The following are explicitly **not** in this spec and would require separate specs:

- **Session resume** for PI (currently `SessionManager.inMemory()`). Would require persistent session manager + schema extension in `streamingPI.ts`.
- **Exact SDK-native usage/cost streaming** (as opposed to estimated via `usageExtractor`). Would need a separate bridge event from the extension back to `streamingPI.ts` for live `usage` chunks.
- **Claude path migration to the same extension system**. Extension consumes Claude's policies; Claude does not consume PI's extension. Unifying would be a follow-up refactor.
- **AskUserQuestion tool as a custom PI tool**. Already covered partially by `bridge.emitAskUser`; a proper custom tool wrapper (with schema validation) can be added in a v1.1.
- **MCP migration from `syncPiMcpForProject` into the extension**. Deemed setup-time (not runtime hook), stays in `streamingPI.ts`.

---

## 11. Open Questions / Risks

1. **Real PI process integration tests are slow.** If CI time becomes painful, fall back to a curated mock harness for most tests and keep 2-3 real-PI tests as smoke.
2. **`pi-coding-agent` version pinning.** Currently `^0.55.1`. Breaking changes in PI's event shape or `ExtensionAPI` contract would require extension updates. Strategy: pin to an exact version in `package.json`, bump deliberately.
3. **Shared-code pattern for extensions.** The extension imports from `src/core/services/*` via relative paths. Since the extension is bundled as `.ts` and compiled by PI at load time, the import paths must resolve at runtime. This works for same-app bundling but would not work for an external npm-published extension — which is acceptable because Q1 decided on bundled-only.
4. **`settings_sharedAcrossBackends` semantics for hooks.** Need confirmation that the user-level hooks config path (`~/.claude/settings.json` vs `~/.agent-desktop/hooks.json`) is right. May require adjustment during Phase 3.
5. **`exitPlanMode` UX.** Claude natively has plan mode semantics recognized by the UI. For PI, the UI needs to detect the `exitPlanMode` custom tool and show similar affordances. May require a small ChatView change in Phase 2.
6. **Bridge API stability.** The bridge is a public contract between app core and extension package. Future breaking changes (e.g., renaming `emitSystemMessage`) will silently break the bundled extension at runtime. Mitigation: `version: 1` field in `PendingExtensionContext`, typed tests.

---

## 12. Next Step

Invoke the `writing-plans` skill to produce a detailed phase-by-phase implementation plan.
