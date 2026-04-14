# Headless CLI & Engine-Owned Dispatch Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Launch web server and Discord bot independently from CLI without Electron, by making the core engine own the dispatch registry and eliminating duplicated logic.

**Architecture:** `AgentEngine` gains a `DispatchRegistry` that services register into during `init()`. In Electron, a bridge copies dispatch entries to `ipcMain`. In headless, the dispatch is consumed directly by the web server and Discord bot. The duplicated streaming/message logic in `headlessTaskContext.ts` is eliminated.

**Tech Stack:** TypeScript, Vitest, sql.js (WASM SQLite), Node.js net/https/ws, discord.js, Claude Agent SDK

**Spec:** `docs/superpowers/specs/2026-04-14-headless-cli-dispatch-refactor-design.md`

---

## File Structure

### New files (core)
- `src/core/dispatch.ts` — `DispatchRegistry` class + `HandleRegistrar` interface
- `src/core/ports/hookRunner.ts` — `HookRunner` interface + `noopHookRunner`
- `src/core/handlers/settings.ts` — settings dispatch handlers (moved from main)
- `src/core/handlers/folders.ts` — folders dispatch handlers
- `src/core/handlers/conversations.ts` — conversations dispatch handlers
- `src/core/handlers/tools.ts` — tools dispatch handlers
- `src/core/handlers/shortcuts.ts` — shortcuts dispatch handlers
- `src/core/handlers/mcp.ts` — mcp dispatch handlers
- `src/core/handlers/auth.ts` — auth dispatch handlers
- `src/core/handlers/attachments.ts` — attachments dispatch handlers
- `src/core/handlers/messages.ts` — messages dispatch handlers (streamAndSave, getAISettings, getSystemPrompt, buildMessageHistory, auto-title, compact, retry)
- `src/core/handlers/index.ts` — barrel: registerCoreHandlers()

### Modified files (core)
- `src/core/engine.ts` — add `dispatch: DispatchRegistry`, call `registerCoreHandlers()` in `init()`
- `src/core/index.ts` — export `DispatchRegistry`, `HandleRegistrar`, `HookRunner`, `noopHookRunner`
- `src/core/services/streaming.ts` — remove imports from `../../main/` (resolve circular deps)

### Modified files (main — Electron bridge)
- `src/main/ipc.ts` — replace `registerAllHandlers` + `ipcDispatch` with `bridgeDispatchToIpc(engine, ipcMain)` + Category C registration
- `src/main/index.ts` — create `AgentEngine` first, pass to bridge
- `src/main/services/streaming.ts` — simplify: only wires ChunkSender to BrowserWindow (no re-exports)

### Modified files (main — Category C services stay)
- `src/main/services/messages.ts` — becomes thin: re-exports from core handlers, or deleted if fully absorbed
- `src/main/services/settings.ts` — deleted (moved to core handler)
- All other Category A services — deleted (moved to core handlers)

### Modified files (headless)
- `src/headless/index.ts` — add `--server`, `--discord` flags, use `engine.dispatch`
- `src/headless/taskRunner.ts` — use `engine.dispatch` instead of `createHeadlessContext`
- `src/headless/headlessTaskContext.ts` — deleted (replaced by core handlers)

### Relocated files
- `src/main/services/webServer.ts` → `src/core/services/webServer.ts` (remove Electron imports)
- `src/main/services/discord.ts` → `src/core/services/discord.ts` (remove Electron imports)

### Test files
- `src/core/dispatch.test.ts`
- `src/core/handlers/settings.test.ts`
- `src/core/handlers/messages.test.ts`
- `src/core/services/webServer.test.ts` (adapted from existing if any)
- `src/headless/index.test.ts`

---

## Task 1: DispatchRegistry + HandleRegistrar

**Files:**
- Create: `src/core/dispatch.ts`
- Create: `src/core/dispatch.test.ts`
- Modify: `src/core/index.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/core/dispatch.test.ts
import { describe, it, expect } from 'vitest'
import { DispatchRegistry } from './dispatch'

describe('DispatchRegistry', () => {
  it('registers and retrieves a handler', async () => {
    const registry = new DispatchRegistry()
    registry.handle('test:echo', async (_event, msg: string) => `echo:${msg}`)

    const handler = registry.get('test:echo')
    expect(handler).toBeDefined()
    const result = await handler!('hello')
    expect(result).toBe('echo:hello')
  })

  it('returns undefined for unknown channels', () => {
    const registry = new DispatchRegistry()
    expect(registry.get('unknown')).toBeUndefined()
  })

  it('reports has() correctly', () => {
    const registry = new DispatchRegistry()
    registry.handle('test:exists', async () => {})
    expect(registry.has('test:exists')).toBe(true)
    expect(registry.has('test:missing')).toBe(false)
  })

  it('iterates all entries', () => {
    const registry = new DispatchRegistry()
    registry.handle('a:one', async () => 1)
    registry.handle('b:two', async () => 2)

    const channels = Array.from(registry.entries()).map(([ch]) => ch)
    expect(channels).toContain('a:one')
    expect(channels).toContain('b:two')
  })

  it('passes null as event to handlers', async () => {
    const registry = new DispatchRegistry()
    let receivedEvent: unknown = 'not-set'
    registry.handle('test:event', async (event) => { receivedEvent = event })

    await registry.get('test:event')!()
    expect(receivedEvent).toBeNull()
  })

  it('overwrites handler on duplicate channel', async () => {
    const registry = new DispatchRegistry()
    registry.handle('test:dup', async () => 'first')
    registry.handle('test:dup', async () => 'second')

    const result = await registry.get('test:dup')!()
    expect(result).toBe('second')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/core/dispatch.test.ts`
Expected: FAIL — module `./dispatch` not found

- [ ] **Step 3: Implement DispatchRegistry**

```ts
// src/core/dispatch.ts

/**
 * Interface for registering IPC-style handlers.
 * Satisfied by both DispatchRegistry (headless) and Electron's IpcMain (via bridge).
 */
export interface HandleRegistrar {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void
}

/**
 * Engine-owned dispatch registry.
 * Canonical source of truth for all callable operations.
 * Replaces the side-effect-based ipcDispatch Map.
 */
export class DispatchRegistry implements HandleRegistrar {
  private handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()

  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void {
    this.handlers.set(channel, async (...args: unknown[]) => listener(null, ...args))
  }

  get(channel: string): ((...args: unknown[]) => Promise<unknown>) | undefined {
    return this.handlers.get(channel)
  }

  has(channel: string): boolean {
    return this.handlers.has(channel)
  }

  entries(): IterableIterator<[string, (...args: unknown[]) => Promise<unknown>]> {
    return this.handlers.entries()
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/core/dispatch.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 5: Export from core barrel**

Add to `src/core/index.ts`:

```ts
// Dispatch
export { DispatchRegistry } from './dispatch'
export type { HandleRegistrar } from './dispatch'
```

- [ ] **Step 6: Commit**

```bash
git add src/core/dispatch.ts src/core/dispatch.test.ts src/core/index.ts
git commit -m "feat(core): add DispatchRegistry — engine-owned handler registry"
```

---

## Task 2: HookRunner port

**Files:**
- Create: `src/core/ports/hookRunner.ts`
- Modify: `src/core/index.ts`

- [ ] **Step 1: Implement HookRunner interface**

```ts
// src/core/ports/hookRunner.ts

export interface HookSystemMessage {
  content: string
  hookEvent: string
}

export interface HookRunner {
  /**
   * Run UserPromptSubmit hooks for the given user message.
   * Returns system messages to inject into the conversation.
   */
  runUserPromptSubmitHooks(
    userContent: string,
    cwd: string,
    permissionMode: string,
  ): Promise<HookSystemMessage[]>
}

/** No-op hook runner for headless/test contexts. */
export const noopHookRunner: HookRunner = {
  async runUserPromptSubmitHooks() { return [] },
}
```

- [ ] **Step 2: Export from core barrel**

Add to `src/core/index.ts`:

```ts
// Ports
export type { HookRunner, HookSystemMessage } from './ports/hookRunner'
export { noopHookRunner } from './ports/hookRunner'
```

- [ ] **Step 3: Commit**

```bash
git add src/core/ports/hookRunner.ts src/core/index.ts
git commit -m "feat(core): add HookRunner port — injectable hook execution"
```

---

## Task 3: Integrate DispatchRegistry into AgentEngine

**Files:**
- Modify: `src/core/engine.ts`

- [ ] **Step 1: Add dispatch to EngineOptions and AgentEngine**

In `src/core/engine.ts`, add the import and property:

```ts
import { DispatchRegistry } from './dispatch'
import type { HookRunner } from './ports/hookRunner'
import { noopHookRunner } from './ports/hookRunner'
```

Add `hookRunner` to `EngineOptions`:

```ts
export interface EngineOptions {
  dbPath: string
  wasmPath?: string
  themesDir: string
  broadcaster: Broadcaster
  platformIO?: PlatformIO
  systemUI?: SystemUI
  hookRunner?: HookRunner
}
```

Add fields to `AgentEngine`:

```ts
export class AgentEngine extends TypedEventEmitter<EngineEvents> {
  // ... existing fields ...
  readonly hookRunner: HookRunner
  readonly dispatch: DispatchRegistry

  constructor(options: EngineOptions) {
    super()
    // ... existing assignments ...
    this.hookRunner = options.hookRunner ?? noopHookRunner
    this.dispatch = new DispatchRegistry()
  }
```

- [ ] **Step 2: Verify build passes**

Run: `npx vitest run --config vitest.config.main.ts` (subset — just verify no type errors)
Expected: Existing tests still PASS (dispatch is empty, no behavior change)

- [ ] **Step 3: Commit**

```bash
git add src/core/engine.ts
git commit -m "feat(core): add dispatch + hookRunner to AgentEngine"
```

---

## Task 4: Migrate Category A handlers — settings

This establishes the pattern for all Category A handler migrations.

**Files:**
- Create: `src/core/handlers/settings.ts`
- Create: `src/core/handlers/settings.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/core/handlers/settings.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { DispatchRegistry } from '../dispatch'
import { registerSettingsHandlers } from './settings'
import { createTestDb } from '../db/database'

describe('settings handlers', () => {
  let dispatch: DispatchRegistry

  beforeEach(async () => {
    dispatch = new DispatchRegistry()
    const db = await createTestDb()
    registerSettingsHandlers(dispatch, db as any)
  })

  it('registers settings:get handler', () => {
    expect(dispatch.has('settings:get')).toBe(true)
  })

  it('registers settings:set handler', () => {
    expect(dispatch.has('settings:set')).toBe(true)
  })

  it('settings:get returns all settings', async () => {
    const get = dispatch.get('settings:get')!
    const result = await get() as Record<string, string>
    expect(result).toBeDefined()
    expect(typeof result).toBe('object')
  })

  it('settings:set persists a value', async () => {
    const set = dispatch.get('settings:set')!
    const get = dispatch.get('settings:get')!
    await set('test_key', 'test_value')
    const all = await get() as Record<string, string>
    expect(all['test_key']).toBe('test_value')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/handlers/settings.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement settings handler**

```ts
// src/core/handlers/settings.ts
import type { HandleRegistrar } from '../dispatch'
import { SettingsService } from '../services/settings'
import type { SqlJsAdapter } from '../db/sqljs-adapter'

export function registerSettingsHandlers(registrar: HandleRegistrar, db: SqlJsAdapter): void {
  const service = new SettingsService(db)

  registrar.handle('settings:get', async () => {
    return service.getAll()
  })

  registrar.handle('settings:set', async (_event, key: string, value: string) => {
    service.set(key, value)
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/handlers/settings.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/handlers/settings.ts src/core/handlers/settings.test.ts
git commit -m "feat(core): migrate settings handlers to core dispatch"
```

---

## Task 5: Migrate remaining Category A handlers

**Files:**
- Create: `src/core/handlers/folders.ts`
- Create: `src/core/handlers/conversations.ts`
- Create: `src/core/handlers/tools.ts`
- Create: `src/core/handlers/shortcuts.ts`
- Create: `src/core/handlers/mcp.ts`
- Create: `src/core/handlers/auth.ts`
- Create: `src/core/handlers/attachments.ts`

Each follows the exact same pattern as Task 4. For each service:

1. Read the existing `src/main/services/<name>.ts` to understand what handlers it registers
2. Create `src/core/handlers/<name>.ts` that takes `(registrar: HandleRegistrar, db: SqlJsAdapter)` (or the appropriate core service)
3. Copy the handler logic, replacing `ipcMain` with `registrar`
4. Remove `import type { IpcMain } from 'electron'`
5. Replace `import type Database from 'better-sqlite3'` with `import type { SqlJsAdapter } from '../db/sqljs-adapter'`

- [ ] **Step 1: Create folders handler**

Read `src/main/services/folders.ts`, then create `src/core/handlers/folders.ts` using `FolderService` and registering on the `HandleRegistrar`. Follow the exact pattern from Task 4 Step 3.

- [ ] **Step 2: Create conversations handler**

Read `src/main/services/conversations.ts`, then create `src/core/handlers/conversations.ts` using `ConversationService`.

- [ ] **Step 3: Create tools handler**

Read `src/main/services/tools.ts`, then create `src/core/handlers/tools.ts` using `ToolsService`.

- [ ] **Step 4: Create shortcuts handler**

Read `src/main/services/shortcuts.ts`, then create `src/core/handlers/shortcuts.ts` using `ShortcutsService`.

- [ ] **Step 5: Create mcp handler**

Read `src/main/services/mcp.ts`, then create `src/core/handlers/mcp.ts` using `McpService`.

- [ ] **Step 6: Create auth handler**

Read `src/main/services/auth.ts`, then create `src/core/handlers/auth.ts`. Auth reads `~/.claude/.credentials.json` — no Electron deps.

- [ ] **Step 7: Create attachments handler**

Read `src/main/services/attachments.ts`, then create `src/core/handlers/attachments.ts`. Pure DB CRUD.

- [ ] **Step 8: Run all core handler tests**

Run: `npx vitest run src/core/handlers/`
Expected: All PASS

- [ ] **Step 9: Commit**

```bash
git add src/core/handlers/
git commit -m "feat(core): migrate Category A handlers — folders, conversations, tools, shortcuts, mcp, auth, attachments"
```

---

## Task 6: Migrate messages handler (the big one)

This is the core of the refactor. Move `streamAndSave`, `getAISettings`, `getSystemPrompt`, `buildMessageHistory`, `generateConversationTitle`, `compactConversation` from `src/main/services/messages.ts` to `src/core/handlers/messages.ts`.

**Files:**
- Create: `src/core/handlers/messages.ts`
- Create: `src/core/handlers/messages.test.ts`

**Key dependencies to resolve:**
- `app` from electron → replace `app.getPath('home')` with `homedir()` from `os`
- `getMainWindow` → replace with engine events (`engine.emit('conversation:titleUpdated', ...)`)
- `broadcast()` → replace with engine `broadcaster`
- `runUserPromptSubmitHooks` → use `engine.hookRunner`
- `speakResponse` → optional TTS callback (or skip in core, fire via engine event)
- `fireCompletionWebhook` → optional webhook callback (or skip in core, fire via engine event)
- `getSchedulerMcpConfig` → move to core or inject
- `validateString`, `validatePositiveInt`, `validatePathSafe` → move validators to core utils
- `getKnowledgesDir`, `getSupportedExtensions` → already available or move to core

- [ ] **Step 1: Write failing test for messages:send**

```ts
// src/core/handlers/messages.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DispatchRegistry } from '../dispatch'
import { registerMessagesHandlers } from './messages'
import { createTestDb } from '../db/database'
import { noopHookRunner } from '../ports/hookRunner'
import type { Broadcaster } from '../ports/broadcaster'

// Mock the SDK to avoid real API calls
vi.mock('../services/anthropic', () => ({
  loadAgentSDK: vi.fn().mockResolvedValue({
    query: vi.fn().mockReturnValue({
      [Symbol.asyncIterator]: () => ({
        next: vi.fn().mockResolvedValue({ done: true }),
      }),
    }),
  }),
}))

describe('messages handlers', () => {
  let dispatch: DispatchRegistry
  const broadcaster: Broadcaster = { broadcast: vi.fn() }

  beforeEach(async () => {
    dispatch = new DispatchRegistry()
    const db = await createTestDb()

    // Seed a conversation for testing
    ;(db as any).prepare(
      "INSERT INTO conversations (id, title, created_at, updated_at, folder_id) VALUES (1, 'Test', datetime('now'), datetime('now'), 1)"
    ).run()

    registerMessagesHandlers(dispatch, db as any, {
      broadcaster,
      hookRunner: noopHookRunner,
      sessionsBase: '/tmp/test-sessions',
    })
  })

  it('registers messages:send handler', () => {
    expect(dispatch.has('messages:send')).toBe(true)
  })

  it('registers messages:compact handler', () => {
    expect(dispatch.has('messages:compact')).toBe(true)
  })

  it('registers messages:stop handler', () => {
    expect(dispatch.has('messages:stop')).toBe(true)
  })

  it('registers messages:regenerate handler', () => {
    expect(dispatch.has('messages:regenerate')).toBe(true)
  })

  it('registers messages:edit handler', () => {
    expect(dispatch.has('messages:edit')).toBe(true)
  })

  it('registers messages:respondToApproval handler', () => {
    expect(dispatch.has('messages:respondToApproval')).toBe(true)
  })

  it('registers conversations:generateTitle handler', () => {
    expect(dispatch.has('conversations:generateTitle')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/handlers/messages.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement messages handler**

Create `src/core/handlers/messages.ts`. This file absorbs the following from `src/main/services/messages.ts`:

- `buildMessageHistory()` (lines 87-114)
- `getFolderOverrides()` (lines 116-121)
- `getSystemPrompt()` (lines 123-274)
- `getConversationCwd()` (lines 279-306)
- `filterMcpServers()` (lines 308-321)
- `getAISettings()` (lines 323-458)
- `saveMessage()` (lines 460-487)
- `getConversationSdkSessionId()`, `saveConversationSdkSessionId()`, `clearConversationSdkSessionId()` (lines 489-500)
- `updateConversationTimestamp()` (lines 502-507)
- `streamAndSave()` (lines 519-665)
- `generateConversationTitle()` (lines 667-732)
- `compactConversation()` (lines 734-796)
- `registerHandlers()` (lines 798-943) — adapted to use `HandleRegistrar`

Key changes:
1. Replace `import { app } from 'electron'` with `import { homedir } from 'os'` — `SESSIONS_BASE` becomes `join(homedir(), '.agent-desktop', 'sessions-folder')` (or injected via options)
2. Replace `getMainWindow()?.webContents.send(channel, data)` with `broadcaster.broadcast(channel, data)`
3. Replace `runUserPromptSubmitHooks(...)` with `hookRunner.runUserPromptSubmitHooks(...)`
4. Replace `broadcast(...)` (from `core/utils/broadcast`) with `broadcaster.broadcast(...)`
5. Replace `getSchedulerMcpConfig(conversationId)` — inline or move to core
6. `speakResponse` and `fireCompletionWebhook` become optional callbacks in handler options (or engine events)

The function signature:

```ts
export interface MessagesHandlerOptions {
  broadcaster: Broadcaster
  hookRunner: HookRunner
  sessionsBase: string
  onTitleGenerated?: (conversationId: number, title: string) => void
  onTtsSpeak?: (content: string, db: SqlJsAdapter, conversationId: number, aiSettings: AISettings) => void
  onWebhookFire?: (url: string, payload: Record<string, unknown>) => void
}

export function registerMessagesHandlers(
  registrar: HandleRegistrar,
  db: SqlJsAdapter,
  options: MessagesHandlerOptions,
): void {
  // ... all handler registrations using registrar.handle()
}
```

- [ ] **Step 4: Move utility functions to core**

Move these from `src/main/utils/` to `src/core/utils/` if not already there:
- `validate.ts` → `validateString`, `validatePositiveInt`, `validatePathSafe`
- `json.ts` → `safeJsonParse`

Check if they already exist in core before moving. If `src/main/utils/validate.ts` has no Electron deps, move it. If it does, extract the pure functions.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/core/handlers/messages.test.ts`
Expected: All 7 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/handlers/messages.ts src/core/handlers/messages.test.ts src/core/utils/
git commit -m "feat(core): migrate messages handler — streamAndSave, AI settings, system prompt"
```

---

## Task 7: Core handlers barrel + engine registration

**Files:**
- Create: `src/core/handlers/index.ts`
- Modify: `src/core/engine.ts`

- [ ] **Step 1: Create barrel file**

```ts
// src/core/handlers/index.ts
import type { HandleRegistrar } from '../dispatch'
import type { SqlJsAdapter } from '../db/sqljs-adapter'
import type { Broadcaster } from '../ports/broadcaster'
import type { HookRunner } from '../ports/hookRunner'
import { registerSettingsHandlers } from './settings'
import { registerFoldersHandlers } from './folders'
import { registerConversationsHandlers } from './conversations'
import { registerToolsHandlers } from './tools'
import { registerShortcutsHandlers } from './shortcuts'
import { registerMcpHandlers } from './mcp'
import { registerAuthHandlers } from './auth'
import { registerAttachmentsHandlers } from './attachments'
import { registerMessagesHandlers } from './messages'

export interface CoreHandlerOptions {
  broadcaster: Broadcaster
  hookRunner: HookRunner
  sessionsBase: string
}

export function registerCoreHandlers(
  registrar: HandleRegistrar,
  db: SqlJsAdapter,
  options: CoreHandlerOptions,
): void {
  registerSettingsHandlers(registrar, db)
  registerFoldersHandlers(registrar, db)
  registerConversationsHandlers(registrar, db)
  registerToolsHandlers(registrar, db)
  registerShortcutsHandlers(registrar, db)
  registerMcpHandlers(registrar, db)
  registerAuthHandlers(registrar)
  registerAttachmentsHandlers(registrar, db)
  registerMessagesHandlers(registrar, db, {
    broadcaster: options.broadcaster,
    hookRunner: options.hookRunner,
    sessionsBase: options.sessionsBase,
  })
}
```

- [ ] **Step 2: Wire into AgentEngine.init()**

In `src/core/engine.ts`, at the end of `init()`:

```ts
import { registerCoreHandlers } from './handlers'

// In init():
async init(): Promise<void> {
  await initDatabase(this.dbPath, this.wasmPath)
  const db = getDatabase() as any
  // ... existing service init ...

  // Populate dispatch with core handlers
  registerCoreHandlers(this.dispatch, db, {
    broadcaster: this.broadcaster,
    hookRunner: this.hookRunner,
    sessionsBase: join(this.dbPath, '..', '..', '.agent-desktop', 'sessions-folder'),
  })
}
```

Note: `sessionsBase` derivation may need adjustment — check the actual path relative to `dbPath`. In practice it's `~/.agent-desktop/sessions-folder`.

- [ ] **Step 3: Export registerCoreHandlers from core barrel**

Add to `src/core/index.ts`:

```ts
export { registerCoreHandlers } from './handlers'
export type { CoreHandlerOptions } from './handlers'
```

- [ ] **Step 4: Run full core test suite**

Run: `npx vitest run --config vitest.config.main.ts`
Expected: All existing tests PASS + new handler tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/handlers/index.ts src/core/engine.ts src/core/index.ts
git commit -m "feat(core): wire core handlers into AgentEngine.init()"
```

---

## Task 8: Resolve circular imports in core/services/streaming.ts

The current `src/core/services/streaming.ts` imports from `../../main/services/` (sessionManager, cwdHooks, piMcpSync, env utils). These circular deps must be broken.

**Files:**
- Modify: `src/core/services/streaming.ts`

- [ ] **Step 1: Audit imports from main**

Current problematic imports in `src/core/services/streaming.ts` (lines 4-8):
```ts
import { streamMessagePI } from '../../main/services/streamingPI'
import { sendTurn, respondToSessionApproval, abortSession, hasActiveSession } from '../../main/services/sessionManager'
import { buildCwdRestrictionHooks } from '../../main/services/cwdHooks'
import { syncPiMcpForProject } from '../../main/services/piMcpSync'
import { findBinaryInPath, ensureFreshMacOSToken } from '../../main/utils/env'
```

- [ ] **Step 2: Extract portable utilities to core**

Move or copy the following to `src/core/utils/`:
- `findBinaryInPath` from `src/main/utils/env.ts` — pure Node, no Electron
- `buildCwdRestrictionHooks` from `src/main/services/cwdHooks.ts` — pure logic

For `ensureFreshMacOSToken` — only needed on macOS, make it optional via a setter like `setChunkSender`.

- [ ] **Step 3: Inject session manager and PI backend as optional deps**

Replace direct imports with injectable functions:

```ts
// At module level in src/core/services/streaming.ts
type SessionTurnFn = (convId: number, messages: MessageParam[], systemPrompt?: string, aiSettings?: AISettings, sdkSessionId?: string | null) => Promise<StreamResult>
type SessionApprovalFn = (requestId: string, response: ToolApprovalResponse | AskUserResponse) => void

let _sendTurn: SessionTurnFn | null = null
let _respondToSessionApproval: SessionApprovalFn | null = null

export function setSessionManager(fns: { sendTurn: SessionTurnFn; respondToApproval: SessionApprovalFn }): void {
  _sendTurn = fns.sendTurn
  _respondToSessionApproval = fns.respondToApproval
}
```

Same pattern for PI backend:

```ts
type PIStreamFn = (...) => Promise<StreamResult>
let _streamMessagePI: PIStreamFn | null = null
export function setPIBackend(fn: PIStreamFn): void { _streamMessagePI = fn }
```

- [ ] **Step 4: Update streamMessage() to use injected deps**

Replace direct calls with injected function calls:

```ts
export async function streamMessage(...): Promise<StreamResult> {
  if (aiSettings?.sdkBackend === 'pi' && _streamMessagePI) {
    // ... use _streamMessagePI
  }
  if (persistSession !== false && conversationId != null && _sendTurn) {
    return _sendTurn(conversationId, messages, systemPrompt, aiSettings, sdkSessionId ?? null)
  }
  return streamMessageOneShot(...)
}
```

- [ ] **Step 5: Wire injections from Electron side**

In `src/main/services/streaming.ts`, after the existing `setChunkSender` call, add:

```ts
import { setSessionManager, setPIBackend } from '../../core/services/streaming'
import { sendTurn, respondToSessionApproval } from './sessionManager'
import { streamMessagePI } from './streamingPI'

setSessionManager({ sendTurn, respondToApproval: respondToSessionApproval })
setPIBackend(streamMessagePI)
```

- [ ] **Step 6: Remove broadcast import from core streaming**

Replace `import { broadcast } from '../utils/broadcast'` in core streaming with the existing `_chunkSender` mechanism (already there). The `sendChunk` function already uses `_chunkSender` — just remove the fallback `broadcast()` call since broadcast will be handled by the engine events.

- [ ] **Step 7: Verify build and tests pass**

Run: `npm run build && npx vitest run --config vitest.config.main.ts`
Expected: Build succeeds, all tests pass

- [ ] **Step 8: Commit**

```bash
git add src/core/services/streaming.ts src/core/utils/ src/main/services/streaming.ts
git commit -m "refactor(core): break circular deps in streaming — inject session manager + PI backend"
```

---

## Task 9: Decouple web server from Electron

**Files:**
- Move: `src/main/services/webServer.ts` → `src/core/services/webServer.ts`

- [ ] **Step 1: Copy file to core**

```bash
cp src/main/services/webServer.ts src/core/services/webServer.ts
```

- [ ] **Step 2: Remove Electron imports and make deps injectable**

In `src/core/services/webServer.ts`:

1. Remove `import { app } from 'electron'` and `import type { IpcMain } from 'electron'`
2. Remove `import { ipcDispatch } from '../ipc'`
3. Remove `import { setBroadcastHandler } from '../utils/broadcast'`
4. Add `import type { DispatchRegistry } from '../dispatch'`

5. Change `startServer` signature:

```ts
export interface ServerStartOptions {
  shortCode?: string
  accessMode?: 'lan' | 'all'
  sslDir: string
  rendererDir: string
  dispatch: DispatchRegistry
}

export async function startServer(port: number, options: ServerStartOptions): Promise<{ url: string; token: string }>
```

6. Replace `app.getPath('userData')` (line 592) with `options.sslDir`:
```ts
// Before: const sslDir = path.join(app.getPath('userData'), 'ssl')
// After: const sslDir = options.sslDir
```

7. Replace `ipcDispatch.get(msg.channel)` (line 531) with a module-level reference:
```ts
let serverDispatch: DispatchRegistry | null = null
// In startServer(): serverDispatch = options.dispatch
// In handleWsMessage(): const handler = serverDispatch?.get(msg.channel)
```

8. Replace `getRendererDir()` with `options.rendererDir`:
```ts
// Store in module state alongside serverDispatch
let rendererDir: string = ''
// In startServer(): rendererDir = options.rendererDir
```

9. Replace `setBroadcastHandler(broadcastEvent)` with a module-level export:
```ts
export function getWsBroadcaster(): ((channel: string, ...args: unknown[]) => void) | null {
  if (authenticatedClients.size === 0) return null
  return broadcastEvent
}
```

10. Change `registerHandlers` to take `HandleRegistrar`:
```ts
import type { HandleRegistrar } from '../dispatch'

export function registerHandlers(registrar: HandleRegistrar): void {
  registrar.handle('server:start', async (_event, port?: number, opts?: Partial<ServerStartOptions>) => {
    // merge opts with defaults
  })
  registrar.handle('server:stop', async () => { await stopServer() })
  registrar.handle('server:getStatus', async () => { return getServerStatus() })
}
```

- [ ] **Step 3: Create a re-export stub in main for backward compat during migration**

```ts
// src/main/services/webServer.ts (temporary — slim re-export)
export { startServer, stopServer, getServerStatus, registerHandlers, getWsBroadcaster } from '../../core/services/webServer'
export type { ServerStartOptions } from '../../core/services/webServer'
```

- [ ] **Step 4: Verify build and tests pass**

Run: `npm run build && npx vitest run --config vitest.config.main.ts`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add src/core/services/webServer.ts src/main/services/webServer.ts
git commit -m "refactor: decouple web server from Electron — injectable sslDir, rendererDir, dispatch"
```

---

## Task 10: Decouple Discord bot from Electron

**Files:**
- Move: `src/main/services/discord.ts` → `src/core/services/discord.ts`

- [ ] **Step 1: Copy file to core**

```bash
cp src/main/services/discord.ts src/core/services/discord.ts
```

- [ ] **Step 2: Remove Electron imports and make deps injectable**

In `src/core/services/discord.ts`:

1. Remove `import type { IpcMain } from 'electron'`
2. Remove `import { ipcDispatch } from '../ipc'`
3. Add `import type { DispatchRegistry } from '../dispatch'`

4. Replace all `ipcDispatch.get('channel')!(...)` calls with a module-level dispatch reference:

```ts
let botDispatch: DispatchRegistry | null = null
```

5. Change `startBot` to accept options:

```ts
export interface BotStartOptions {
  dispatch: DispatchRegistry
  token?: string
}

export async function startBot(options: BotStartOptions): Promise<void> {
  botDispatch = options.dispatch
  const token = options.token
    || process.env.DISCORD_BOT_TOKEN
    || await getTokenFromDb()
  if (!token) throw new Error('No Discord bot token configured')
  // ... existing bot startup logic, using botDispatch instead of ipcDispatch
}
```

6. In `loadBindings()` and all other functions that call `ipcDispatch.get(...)!()`, replace with `botDispatch!.get(...)!(...)`.

7. Change `registerHandlers` to take `HandleRegistrar`:

```ts
import type { HandleRegistrar } from '../dispatch'

export function registerHandlers(registrar: HandleRegistrar): void {
  registrar.handle('discord:connect', async () => { /* ... */ })
  registrar.handle('discord:disconnect', async () => { await stopBot() })
  registrar.handle('discord:status', async () => { return getStatus() })
}
```

8. Remove the auto-start `setTimeout` from `registerHandlers` — auto-start is now the caller's responsibility.

- [ ] **Step 3: Create re-export stub in main**

```ts
// src/main/services/discord.ts (temporary — slim re-export)
export { startBot, stopBot, registerHandlers } from '../../core/services/discord'
export type { BotStartOptions } from '../../core/services/discord'
```

- [ ] **Step 4: Verify build and tests pass**

Run: `npm run build && npx vitest run --config vitest.config.main.ts`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add src/core/services/discord.ts src/main/services/discord.ts
git commit -m "refactor: decouple Discord bot from Electron — injectable dispatch + token"
```

---

## Task 11: Electron bridge — replace registerAllHandlers

**Files:**
- Modify: `src/main/ipc.ts`
- Modify: `src/main/index.ts`
- Modify: `src/main/services/streaming.ts`

- [ ] **Step 1: Rewrite ipc.ts as a bridge**

Replace the entire `src/main/ipc.ts` with:

```ts
import type { IpcMain } from 'electron'
import { sanitizeError } from './utils/errors'
import type { AgentEngine } from '../core'

// Category C — Electron-only services
import { registerHandlers as updaterHandlers } from './services/updater'
import { registerHandlers as quickChatHandlers } from './services/quickChat'
import { registerHandlers as systemHandlers } from './services/system'
import { registerHandlers as openscadHandlers } from './services/openscad'
import { registerHandlers as jupyterHandlers } from './services/jupyter'
import { registerHandlers as whisperHandlers } from './services/whisper'
import { registerHandlers as commandsHandlers } from './services/commands'
import { registerHandlers as ttsHandlers } from './services/tts'
import { registerHandlers as filesHandlers } from './services/files'
import { registerHandlers as knowledgeHandlers, ensureKnowledgesDir } from './services/knowledge'
import { registerHandlers as schedulerHandlers } from './services/scheduler'
import { registerHandlers as piExtensionsHandlers } from './services/piExtensions'
import { ensureThemeDir } from './services/themes'

/**
 * Bridge engine dispatch to Electron IPC.
 * Core handlers are already in engine.dispatch — just mirror to ipcMain.
 * Category C (Electron-only) handlers register directly.
 */
export function bridgeDispatchToIpc(engine: AgentEngine, ipcMain: IpcMain): void {
  // 1. Mirror all core dispatch handlers to ipcMain
  for (const [channel, handler] of engine.dispatch.entries()) {
    ipcMain.handle(channel, async (_event, ...args) => {
      try {
        return await handler(...args)
      } catch (err) {
        throw new Error(sanitizeError(err))
      }
    })
  }

  // 2. Register Category C (Electron-only) services directly
  const db = engine.db as any
  updaterHandlers(ipcMain)
  quickChatHandlers(ipcMain)
  systemHandlers(ipcMain, db)
  openscadHandlers(ipcMain, db)
  jupyterHandlers(ipcMain)
  whisperHandlers(ipcMain, db)
  commandsHandlers(ipcMain, db)
  ttsHandlers(ipcMain, db)
  filesHandlers(ipcMain, db)
  knowledgeHandlers(ipcMain, db)
  schedulerHandlers(ipcMain, db)
  piExtensionsHandlers(ipcMain, db)

  ensureThemeDir().catch((err) => console.error('[themes] Failed to ensure theme dir:', err))
  ensureKnowledgesDir().catch((err) => console.error('[knowledge] Failed to ensure knowledges dir:', err))
}
```

- [ ] **Step 2: Update main/index.ts to use AgentEngine**

```ts
// In app.whenReady() handler:

// Before:
// await initDatabase(dbPath, wasmPath)
// const db = getDatabase()
// registerAllHandlers(ipcMain, db)

// After:
import { AgentEngine } from '../core'
import { bridgeDispatchToIpc } from './ipc'
import { electronHookRunner } from './services/hookRunner' // adapt existing hookRunner to implement HookRunner port

const engine = new AgentEngine({
  dbPath,
  wasmPath,
  themesDir: join(app.getPath('home'), '.agent-desktop', 'themes'),
  broadcaster: { broadcast: (channel, ...args) => { /* webContents.send + WS broadcast */ } },
  hookRunner: electronHookRunner,
})
await engine.init()
bridgeDispatchToIpc(engine, ipcMain)
```

- [ ] **Step 3: Wire broadcast bridge**

Create the Electron broadcaster that forwards engine events to BrowserWindow:

```ts
const broadcaster: Broadcaster = {
  broadcast(channel: string, ...args: unknown[]): void {
    const win = getMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, args.length === 1 ? args[0] : args)
    }
  },
}
```

- [ ] **Step 4: Adapt existing hookRunner to implement HookRunner port**

In `src/main/services/hookRunner.ts`, export an object implementing the `HookRunner` interface:

```ts
import type { HookRunner } from '../../core/ports/hookRunner'

export const electronHookRunner: HookRunner = {
  async runUserPromptSubmitHooks(userContent, cwd, permissionMode) {
    return runUserPromptSubmitHooks(userContent, cwd, permissionMode)
  },
}
```

- [ ] **Step 5: Delete old ipcDispatch references**

Remove the `ipcDispatch` export from the old `ipc.ts` (already replaced). Update any remaining imports:
- `src/core/services/webServer.ts` — already migrated to use `dispatch` parameter
- `src/core/services/discord.ts` — already migrated to use `dispatch` parameter

- [ ] **Step 6: Verify build and ALL tests pass**

Run: `npm run build && npm test`
Expected: Build: 0 errors. Tests: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/main/ipc.ts src/main/index.ts src/main/services/hookRunner.ts src/main/services/streaming.ts
git commit -m "refactor: replace registerAllHandlers with bridgeDispatchToIpc — engine owns dispatch"
```

---

## Task 12: Headless CLI — --server and --discord flags

**Files:**
- Modify: `src/headless/index.ts`

- [ ] **Step 1: Rewrite the headless entry point**

```ts
// src/headless/index.ts

/**
 * Headless entry point for Agent Desktop core engine.
 *
 * Runs without Electron — no UI, no BrowserWindow, no tray.
 *
 * Usage:
 *   node out/headless/index.js --server [--port N] [--access-mode lan|all]
 *   node out/headless/index.js --discord
 *   node out/headless/index.js --server --discord
 *   node out/headless/index.js --tick
 *   node out/headless/index.js --run-task <id>
 */

import { resolve, join } from 'path'
import { homedir } from 'os'
import { AgentEngine, noopPlatformIO, noopSystemUI, noopHookRunner } from '../core'
import type { Broadcaster } from '../core'
import { enrichHeadlessEnv } from './headlessEnv'

// ─── CLI parsing ──────────────────────────────────────

function getArgValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag)
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined
}

const args = process.argv.slice(2)
const flags = {
  server: args.includes('--server'),
  discord: args.includes('--discord'),
  tick: args.includes('--tick'),
  runTask: args.includes('--run-task'),
  port: getArgValue(args, '--port'),
  accessMode: getArgValue(args, '--access-mode') as 'lan' | 'all' | undefined,
}

// Validate: long-running vs one-shot modes are mutually exclusive
const isLongRunning = flags.server || flags.discord
const isOneShot = flags.tick || flags.runTask

if (isLongRunning && isOneShot) {
  console.error('[headless] Error: --server/--discord cannot be combined with --tick/--run-task')
  process.exit(1)
}

if (!isLongRunning && !isOneShot) {
  // Interactive mode (legacy)
  runInteractive().catch(fatal)
} else if (isOneShot) {
  import('./taskRunner').then(({ main }) => main(args)).catch(fatal)
} else {
  runServices().catch(fatal)
}

function fatal(err: unknown): never {
  console.error('[headless] Fatal:', err)
  process.exit(1)
}

// ─── Paths ────────────────────────────────────────────

const DEFAULT_DB_PATH = join(homedir(), '.config', 'agent-desktop', 'agent.db')
const DEFAULT_THEMES_DIR = join(homedir(), '.agent-desktop', 'themes')
const DEFAULT_SSL_DIR = join(homedir(), '.config', 'agent-desktop', 'ssl')
const DEFAULT_RENDERER_DIR = resolve(__dirname, '../renderer')

// ─── Service mode ─────────────────────────────────────

async function runServices(): Promise<void> {
  enrichHeadlessEnv()

  const dbPath = process.env.AGENT_DB_PATH || DEFAULT_DB_PATH
  const themesDir = process.env.AGENT_THEMES_DIR || DEFAULT_THEMES_DIR

  const broadcaster: Broadcaster = {
    broadcast(channel: string, ...args: unknown[]): void {
      // Forward to web server WS clients if running
      wsBroadcast?.(channel, ...args)
    },
  }

  console.log(`[headless] Starting Agent Engine...`)
  console.log(`[headless] DB: ${dbPath}`)

  const engine = new AgentEngine({
    dbPath: resolve(dbPath),
    themesDir: resolve(themesDir),
    broadcaster,
    platformIO: noopPlatformIO,
    systemUI: noopSystemUI,
    hookRunner: noopHookRunner,
  })

  await engine.init()
  console.log(`[headless] Engine initialized. ${engine.conversations.list().length} conversations in DB.`)

  // Track WS broadcaster for dynamic wiring
  let wsBroadcast: ((channel: string, ...args: unknown[]) => void) | null = null

  // Start web server if requested
  if (flags.server) {
    const { startServer, getWsBroadcaster } = await import('../core/services/webServer')
    const port = flags.port ? parseInt(flags.port, 10) : 3484
    const result = await startServer(port, {
      dispatch: engine.dispatch,
      sslDir: DEFAULT_SSL_DIR,
      rendererDir: DEFAULT_RENDERER_DIR,
      accessMode: flags.accessMode || 'lan',
    })
    wsBroadcast = getWsBroadcaster() ?? null
    console.log(`[headless] Web server: ${result.url}`)
  }

  // Start Discord bot if requested
  if (flags.discord) {
    const { startBot } = await import('../core/services/discord')
    await startBot({ dispatch: engine.dispatch })
    console.log(`[headless] Discord bot started.`)
  }

  // Graceful shutdown
  const shutdown = async () => {
    console.log(`[headless] Shutting down...`)
    if (flags.server) {
      const { stopServer } = await import('../core/services/webServer')
      await stopServer()
    }
    if (flags.discord) {
      const { stopBot } = await import('../core/services/discord')
      await stopBot()
    }
    await engine.shutdown()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  console.log(`[headless] Services running. Press Ctrl+C to stop.`)
}

// ─── Interactive mode (legacy) ────────────────────────

async function runInteractive(): Promise<void> {
  const dbPath = process.env.AGENT_DB_PATH || DEFAULT_DB_PATH
  const themesDir = process.env.AGENT_THEMES_DIR || DEFAULT_THEMES_DIR

  const broadcaster: Broadcaster = {
    broadcast(channel: string, data: unknown): void {
      console.log(`[broadcast] ${channel}:`, JSON.stringify(data, null, 2).slice(0, 200))
    },
  }

  const engine = new AgentEngine({
    dbPath: resolve(dbPath),
    themesDir: resolve(themesDir),
    broadcaster,
    platformIO: noopPlatformIO,
    systemUI: noopSystemUI,
  })

  await engine.init()
  console.log(`[headless] Engine ready. Press Ctrl+C to exit.`)

  const shutdown = async () => {
    await engine.shutdown()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add src/headless/index.ts
git commit -m "feat(headless): add --server and --discord CLI flags"
```

---

## Task 13: Eliminate headlessTaskContext.ts

**Files:**
- Modify: `src/headless/taskRunner.ts`
- Delete: `src/headless/headlessTaskContext.ts`

- [ ] **Step 1: Update taskRunner to use engine dispatch**

In `src/headless/taskRunner.ts`, replace `createHeadlessContext` usage with `engine.dispatch`:

```ts
// Before:
import { createHeadlessContext } from './headlessTaskContext'
const ctx = createHeadlessContext(engine.db as any)
await executeTask(scheduler, ctx, task)

// After:
// executeTask needs to be adapted to accept the engine directly,
// OR we build a TaskRunContext from the engine's dispatch:
const ctx: TaskRunContext = {
  buildHistory(conversationId) {
    // Use dispatch to call messages handler
    return engine.dispatch.get('messages:buildHistory')!(conversationId)
  },
  getAISettings(conversationId) {
    return engine.dispatch.get('messages:getAISettings')!(conversationId)
  },
  async getSystemPrompt(conversationId, cwd) {
    return engine.dispatch.get('messages:getSystemPrompt')!(conversationId, cwd)
  },
  async streamMessage(history, systemPrompt, aiSettings, conversationId) {
    // Use the core streaming directly
    const { streamMessage } = await import('../core/services/streaming')
    return streamMessage(history, systemPrompt, aiSettings, conversationId, null, false)
  },
  saveMessage(conversationId, role, content, _attachments, toolCalls) {
    engine.dispatch.get('messages:saveMessage')!(conversationId, role, content, [], toolCalls)
  },
  async notify(title, body) {
    // Reuse the existing headless notification logic
    await headlessNotify(title, body)
  },
  onTaskUpdate(task) {
    console.log(`[task] ${task.name} (id=${task.id}): ${task.last_status}`)
  },
  onConversationsRefresh() {},
}
```

**Approach:** Refactor `executeTask` to accept an `AgentEngine` directly and call core services without going through dispatch. `executeTask` is internal to core, not an IPC consumer — it should use the engine's services directly. This avoids polluting the dispatch with internal-only channels.

In Task 6 (messages handler), export the following functions from `src/core/handlers/messages.ts` so `executeTask` can call them directly:
- `buildMessageHistory(db, conversationId)`
- `getAISettings(db, conversationId)`
- `getSystemPrompt(db, conversationId, cwd)`
- `saveMessage(db, conversationId, role, content, attachments, toolCalls)`

- [ ] **Step 2: Delete headlessTaskContext.ts**

```bash
rm src/headless/headlessTaskContext.ts
```

- [ ] **Step 3: Verify build and tests**

Run: `npm run build && npm test`
Expected: All pass. No references to deleted file.

- [ ] **Step 4: Commit**

```bash
git add src/headless/taskRunner.ts
git rm src/headless/headlessTaskContext.ts
git commit -m "refactor: eliminate headlessTaskContext — use engine dispatch instead"
```

---

## Task 14: Update build scripts

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Update build:headless to include new core modules**

```json
"build:headless": "esbuild src/headless/index.ts --bundle --platform=node --target=node18 --outfile=out/headless/index.js --external:@anthropic-ai/claude-agent-sdk --external:better-sqlite3 --external:discord.js"
```

The entry point hasn't changed — just verify esbuild picks up the new core imports transitively.

- [ ] **Step 2: Add convenience scripts**

```json
"start:server": "node out/headless/index.js --server",
"start:discord": "node out/headless/index.js --discord",
"start:headless": "node out/headless/index.js --server --discord"
```

- [ ] **Step 3: Verify headless build**

Run: `npm run build:headless`
Expected: Produces `out/headless/index.js` with no errors

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore: update build scripts — add start:server, start:discord, start:headless"
```

---

## Task 15: Cleanup — remove dead code

**Files:**
- Delete: `src/core/utils/broadcast.ts` (replaced by engine broadcaster port)
- Delete: `src/main/utils/broadcast.ts` (re-export of deleted module)
- Modify: Any files still importing old broadcast

- [ ] **Step 1: Search for remaining broadcast imports**

Run: `rg "from.*utils/broadcast" src/`

Remove or replace each import. The `broadcast()` function is now `engine.broadcaster.broadcast()` — all call sites should already be updated from Tasks 6-8.

- [ ] **Step 2: Search for remaining ipcDispatch references**

Run: `rg "ipcDispatch" src/`

Should return zero results. If any remain, update them.

- [ ] **Step 3: Delete deprecated main service files**

The following `src/main/services/` files are now either:
- Re-export stubs pointing to core (can be deleted once all imports are updated)
- Or fully absorbed into core handlers

Delete re-export stubs for Category A services that have been fully migrated:
```bash
rm src/main/services/settings.ts   # if fully migrated
rm src/main/services/folders.ts    # if fully migrated
rm src/main/services/conversations.ts  # if fully migrated
rm src/main/services/tools.ts     # if fully migrated
rm src/main/services/shortcuts.ts  # if fully migrated
rm src/main/services/mcp.ts       # if fully migrated
rm src/main/services/auth.ts      # if fully migrated
rm src/main/services/attachments.ts  # if fully migrated
```

Only delete a file AFTER verifying no remaining imports reference it.

- [ ] **Step 4: Run full test suite**

Run: `npm test`
Expected: All tests pass. No dead code warnings.

- [ ] **Step 5: Run build**

Run: `npm run build`
Expected: 0 errors, 0 warnings

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: remove dead broadcast utils + migrated main service files"
```

---

## Task 16: Integration test — headless server

**Files:**
- Create: `src/headless/index.test.ts`

- [ ] **Step 1: Write integration test**

```ts
// src/headless/index.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { resolve, join } from 'path'
import { homedir } from 'os'
import { AgentEngine, noopPlatformIO, noopSystemUI, noopHookRunner } from '../core'
import type { Broadcaster } from '../core'

describe('headless engine with dispatch', () => {
  let engine: AgentEngine

  beforeAll(async () => {
    const broadcaster: Broadcaster = { broadcast: () => {} }
    engine = new AgentEngine({
      dbPath: ':memory:',
      themesDir: join(homedir(), '.agent-desktop', 'themes'),
      broadcaster,
      platformIO: noopPlatformIO,
      systemUI: noopSystemUI,
      hookRunner: noopHookRunner,
    })
    await engine.init()
  })

  afterAll(async () => {
    await engine.shutdown()
  })

  it('dispatch is populated after init', () => {
    expect(engine.dispatch.has('settings:get')).toBe(true)
    expect(engine.dispatch.has('settings:set')).toBe(true)
    expect(engine.dispatch.has('folders:list')).toBe(true)
    expect(engine.dispatch.has('conversations:list')).toBe(true)
    expect(engine.dispatch.has('messages:send')).toBe(true)
  })

  it('settings:get returns object via dispatch', async () => {
    const handler = engine.dispatch.get('settings:get')!
    const result = await handler()
    expect(result).toBeDefined()
    expect(typeof result).toBe('object')
  })

  it('settings:set + get round-trip via dispatch', async () => {
    const set = engine.dispatch.get('settings:set')!
    const get = engine.dispatch.get('settings:get')!
    await set('test_integration', 'hello')
    const all = await get() as Record<string, string>
    expect(all['test_integration']).toBe('hello')
  })
})
```

- [ ] **Step 2: Run integration test**

Run: `npx vitest run src/headless/index.test.ts`
Expected: All 3 tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/headless/index.test.ts
git commit -m "test: headless engine integration — dispatch populated and functional"
```

---

## Task 17: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add headless CLI documentation**

Add to the Architecture Decisions section:

```markdown
- **Engine-owned dispatch** — `AgentEngine.dispatch` is the canonical handler registry; Electron's `ipcMain` is a consumer via `bridgeDispatchToIpc()`; headless CLI uses dispatch directly
- **Headless CLI** — `node out/headless/index.js --server [--port N] [--discord]` runs web server and/or Discord bot without Electron
```

Add to Conventions:

```markdown
- **New IPC handlers**: register in `src/core/handlers/`, not `src/main/services/` — unless Electron-only (Category C)
- **Category C services**: `updater`, `quickChat`, `globalShortcuts`, `system`, `openscad`, `jupyter`, `tray`, `deeplink`, `protocol`, `waylandShortcuts`, `schedulerBridge`, `webhook` — stay in `src/main/services/`
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md — engine-owned dispatch, headless CLI, handler categories"
```

---

## Summary

| Task | Description | Effort |
|------|-------------|--------|
| 1 | DispatchRegistry + HandleRegistrar | Small |
| 2 | HookRunner port | Small |
| 3 | Integrate dispatch into AgentEngine | Small |
| 4 | Migrate settings handlers (pattern) | Small |
| 5 | Migrate remaining Category A handlers | Medium |
| 6 | Migrate messages handler (the big one) | Large |
| 7 | Core handlers barrel + engine registration | Small |
| 8 | Resolve circular imports in streaming | Medium |
| 9 | Decouple web server from Electron | Medium |
| 10 | Decouple Discord bot from Electron | Medium |
| 11 | Electron bridge — replace registerAllHandlers | Large |
| 12 | Headless CLI — --server and --discord flags | Medium |
| 13 | Eliminate headlessTaskContext.ts | Medium |
| 14 | Update build scripts | Small |
| 15 | Cleanup — remove dead code | Medium |
| 16 | Integration test | Small |
| 17 | Update CLAUDE.md | Small |

**Critical path:** Tasks 1-3 (foundation) → 4-7 (handlers) → 8 (circular deps) → 9-10 (decouple services) → 11 (bridge) → 12-13 (headless CLI)

**Parallelizable:** Tasks 4-5 can run in parallel. Tasks 9 and 10 can run in parallel. Tasks 14-17 can run in parallel.
