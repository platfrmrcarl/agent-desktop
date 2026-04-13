# Core Engine Decoupling — Design Spec

## Context

Agent Desktop is an Electron app (React + Zustand + sql.js) with 127 IPC channels across 48 service modules. The main process mixes pure business logic (DB, AI streaming, MCP management) with Electron-specific code (BrowserWindow, tray, global shortcuts, dialogs).

**Problem:** This coupling prevents:
- Running the AI/DB/MCP engine without a UI (headless mode)
- Swapping the frontend for a different technology
- Modifying or expanding services without cascading breakages

**Current state (strengths):**
- Zero cross-boundary imports between `main/` and `renderer/`
- All renderer calls go through `window.agent` preload bridge (127 channels)
- WebSocket bridge in `webServer.ts` already mirrors the full API (proves transport is abstractable)
- Shared types live in `src/shared/` — no circular dependencies

**Current state (coupling points):**
- `getMainWindow()` singleton called from `streaming.ts`, `messages.ts`, `scheduler.ts`
- `sendChunk()` calls `webContents.send()` directly from business logic
- Electron-only services (tray, globalShortcuts, quickChat, updater) coexist with pure services
- `index.ts` mixes Electron lifecycle with business bootstrap (DB, scheduler, AI sessions)
- `scheduler.ts` uses Electron `Notification` class directly

## Architecture: Core Engine + Adapters

Extract a `src/core/` package that is pure TypeScript (zero Electron imports), exposes an in-process typed API, and uses interfaces ("ports") for platform-specific capabilities.

### Directory Structure

```
src/
  core/                           # Pure TypeScript engine
    index.ts                     # Barrel: exports AgentEngine + public types
    engine.ts                    # AgentEngine class — single entry point
    events.ts                    # TypedEventEmitter (typed event system)
    types/                       # Shared types (migrated from shared/)
      types.ts
      piUITypes.ts
      constants.ts
      index.ts                   # Re-exports
    db/                          # Database layer (migrated from main/db/)
      database.ts
      sqljs-adapter.ts
      schema.ts
      migrations.ts
      seed.ts
    services/                    # Business logic — pure, no Electron
      conversations.ts           # ConversationService
      messages.ts                # MessageService
      streaming.ts               # StreamingService (emits events, not webContents.send)
      sessionManager.ts          # SessionManager
      settings.ts                # SettingsService
      folders.ts                 # FolderService
      mcp.ts                     # McpService
      tools.ts                   # ToolsService
      auth.ts                    # AuthService
      scheduler.ts               # SchedulerService
      themes.ts                  # ThemesService
      commands.ts                # CommandsService
      knowledge.ts               # KnowledgeService
      tts.ts                     # TtsService
      whisper.ts                 # WhisperService
      jupyter.ts                 # JupyterService
      openscad.ts                # OpenScadService
      discord.ts                 # DiscordService
    ports/                       # Interfaces for platform capabilities
      broadcaster.ts             # Push events to clients
      platformIO.ts              # File reveal, terminal, shell open
      systemUI.ts                # Dialogs (file picker), notifications

  main/                          # Electron shell (thinner)
    index.ts                    # Electron lifecycle + AgentEngine bootstrap
    adapters/                   # Electron implementations of ports
      ipcAdapter.ts             # core API -> ipcMain.handle (channel mapping)
      electronBroadcaster.ts    # engine events -> webContents.send
      electronPlatformIO.ts     # shell.showItemInFolder, openPath, etc.
      electronSystemUI.ts       # dialog.showOpenDialog, Notification
    services/                   # Electron-only (NOT in core)
      tray.ts
      globalShortcuts.ts
      quickChat.ts
      updater.ts
      deeplink.ts
      protocol.ts

  headless/                      # Headless entry point (no UI)
    index.ts                    # Bootstrap AgentEngine + optional HTTP/WS
    adapters/
      consoleBroadcaster.ts     # events -> stdout/log
      noopPlatformIO.ts         # no-ops for file reveal, etc.

  renderer/                      # Unchanged
  preload/                       # Unchanged
  shared/                        # Deprecated -> re-exports from core/types/
```

### AgentEngine API

```typescript
// src/core/engine.ts

interface EngineOptions {
  dbPath: string
  broadcaster: Broadcaster
  platformIO?: PlatformIO       // Optional: no-op in headless
  systemUI?: SystemUI           // Optional: no-op in headless
}

class AgentEngine extends TypedEventEmitter<EngineEvents> {
  readonly conversations: ConversationService
  readonly messages: MessageService
  readonly streaming: StreamingService
  readonly folders: FolderService
  readonly settings: SettingsService
  readonly mcp: McpService
  readonly tools: ToolsService
  readonly auth: AuthService
  readonly scheduler: SchedulerService
  readonly themes: ThemesService
  readonly commands: CommandsService
  readonly knowledge: KnowledgeService
  readonly tts: TtsService
  readonly whisper: WhisperService
  readonly jupyter: JupyterService
  readonly openscad: OpenScadService
  readonly discord: DiscordService

  constructor(options: EngineOptions)
  async init(): Promise<void>       // DB init, migrations, seed
  async shutdown(): Promise<void>   // Graceful: sessions, kernels, scheduler, DB
}
```

### Typed Events (replaces webContents.send)

```typescript
// src/core/events.ts

interface EngineEvents {
  'stream:chunk':              [conversationId: number, chunk: StreamChunk]
  'conversation:updated':      [conversationId: number]
  'conversation:titleUpdated': [id: number, title: string]
  'conversations:refresh':     []
  'tts:stateChange':           [state: { speaking: boolean; messageId?: number }]
  'jupyter:output':            [chunk: JupyterOutputChunk]
  'scheduler:taskUpdate':      [task: ScheduledTask]
  'updates:status':            [status: UpdateStatus]
  'theme:autoSwitch':          [filename: string]
  'tray:newConversation':      []
  'deeplink:navigate':         [conversationId: number]
  'overlay:stopRecording':     []
}
```

Current `sendChunk(win, chunk)` -> `engine.emit('stream:chunk', convId, chunk)`.
Adapters subscribe and forward to their transport.

### Ports (3 interfaces)

```typescript
// src/core/ports/broadcaster.ts
interface Broadcaster {
  broadcast(channel: string, data: unknown): void
}

// src/core/ports/platformIO.ts
interface PlatformIO {
  revealInFileManager(path: string): Promise<void>
  openTerminalHere(path: string): Promise<void>
  openWithDefault(path: string): Promise<void>
  openExternal(url: string): Promise<void>
}

// src/core/ports/systemUI.ts
interface SystemUI {
  selectFolder(): Promise<string | null>
  selectFile(): Promise<string | null>
  showNotification(title: string, body: string): Promise<void>
}
```

**Why only 3 ports?** Everything else (DB, AI SDK, MCP, auth, file read/write) is pure Node.js already. These 3 are the only places where business logic needs platform capabilities. We don't abstract what doesn't need abstracting.

**Optional ports:** `PlatformIO` and `SystemUI` are optional in `EngineOptions`. When absent, the engine provides graceful no-ops (same behavior as existing WebSocket shim stubs).

### Usage Examples

**Electron:**
```typescript
const engine = new AgentEngine({
  dbPath: path.join(app.getPath('userData'), 'agent.db'),
  broadcaster: new ElectronBroadcaster(mainWindow),
  platformIO: new ElectronPlatformIO(),
  systemUI: new ElectronSystemUI(),
})
await engine.init()
new IpcAdapter(ipcMain, engine)  // maps IPC channels to engine methods
```

**Headless:**
```typescript
const engine = new AgentEngine({
  dbPath: resolve('~/.config/agent-desktop/agent.db'),
  broadcaster: new ConsoleBroadcaster(),
})
await engine.init()
// Direct usage as library:
const conv = await engine.conversations.create('My conversation')
await engine.messages.send(conv.id, 'Hello!')
// Or expose via HTTP/WS:
new HttpAdapter(engine, { port: 3000 })
```

## Migration Plan (Strangler Fig)

Each phase produces a fully functional app. Can stop and resume at any point.

### Phase 0 — Foundations (zero functional change)

1. Create `src/core/` directory structure
2. Move `src/shared/types.ts`, `piUITypes.ts`, `constants.ts` -> `src/core/types/`
3. Leave `src/shared/` as re-exports: `export * from '../core/types'`
4. Create `src/core/events.ts` — TypedEventEmitter class (~40 lines)
5. Create the 3 port interfaces (Broadcaster, PlatformIO, SystemUI)
6. Create AgentEngine skeleton (constructor + empty init/shutdown)
7. All tests pass, zero functional diff

**Files created:** ~10
**Files modified:** 0 (re-exports preserve imports)
**Risk:** None

### Phase 1 — Database Layer

1. Move `src/main/db/` -> `src/core/db/` (already pure — sql.js WASM, zero Electron)
2. `AgentEngine.init()` calls `initDatabase(dbPath)`
3. `AgentEngine.shutdown()` calls `closeDatabase()`
4. Main process switches from direct `initDatabase()` -> `engine.init()`
5. Services still access `db` via shared reference (no change yet)

**Files moved:** 5 (database.ts, sqljs-adapter.ts, schema.ts, migrations.ts, seed.ts)
**Files modified:** ~3 (main/index.ts, import paths)
**Risk:** Low — DB layer has zero Electron deps

### Phase 2 — CRUD Services (establish pattern)

Order: **settings -> folders -> conversations** (increasing dependency)

For each service:
1. Create class in `src/core/services/` (e.g., `SettingsService`)
2. Extract business logic from `src/main/services/` (SQL queries, validation)
3. Main handler becomes one-liner: `ipcMain.handle('settings:get', () => engine.settings.getAll())`
4. Original main service file reduced to thin IPC adapter

Example — SettingsService:
```typescript
// src/core/services/settings.ts
export class SettingsService {
  constructor(private db: Database) {}
  getAll(): Record<string, string> { /* SQL query */ }
  set(key: string, value: string | null): void { /* SQL update */ }
}

// src/main/services/settings.ts (reduced to adapter)
export function registerHandlers(ipcMain: IpcMain, engine: AgentEngine) {
  ipcMain.handle('settings:get', () => engine.settings.getAll())
  ipcMain.handle('settings:set', (_, key, val) => engine.settings.set(key, val))
}
```

**Files created:** 3 (one per service)
**Files modified:** 3 (main handlers thinned) + engine.ts (wire services)
**Risk:** Low — CRUD is straightforward

### Phase 3 — AI/Streaming (unlocks headless)

This is the critical phase. After this, AgentEngine can send messages and stream responses without Electron.

1. Extract `SessionManager` -> `src/core/services/sessionManager.ts`
   - Replace `getMainWindow()` -> use `Broadcaster` port
   - Replace `sendChunk(win, chunk)` -> `engine.emit('stream:chunk', convId, chunk)`
2. Extract `StreamingService` -> `src/core/services/streaming.ts`
   - `streamMessage()` becomes a service method
   - `abortControllers` Map stays in service (internal state)
   - `pendingRequests` (tool approval) stays in service
3. Extract `MessageService` -> `src/core/services/messages.ts`
   - `buildMessageHistory()`, `saveMessage()` — already pure logic
   - `send()` orchestrates: save -> stream -> save response
4. Create `ElectronBroadcaster` that subscribes to engine events and forwards via `webContents.send()`

**Files created:** 3 core services + 1 adapter
**Files modified:** ~5 (main handlers, main/index.ts)
**Risk:** Medium — streaming has the most Electron entanglement (`streamWindows`, `sendChunk`, `getMainWindow`)

**Key refactors in this phase:**
- `sendChunk()` (streaming.ts:L~80): currently iterates `streamWindows` (BrowserWindow[]) calling `webContents.send()` -> becomes `engine.emit()`
- `getMainWindow()` calls in streaming/messages/scheduler -> replaced by Broadcaster port
- `broadcast()` util (utils/broadcast.ts): already an abstraction, wire it to engine events
- PI SDK integration: `streamingPI.ts` and `piSdk.ts` extracted alongside Claude SDK streaming — both backends become strategies within `StreamingService` (the existing `ai_sdkBackend` branch stays, just moves into core)

### Phase 4 — Remaining Services

Same pattern as Phase 2, applied to all remaining services:

| Service | Complexity | Notes |
|---------|-----------|-------|
| McpService | Low | CRUD + testConnection (child process spawn — pure Node) |
| ToolsService | Low | Settings CRUD |
| AuthService | Low | File reads + SDK calls |
| SchedulerService | Medium | Remove `Notification` import -> use SystemUI port |
| ThemesService | Low | File I/O only |
| CommandsService | Low | File scanning |
| KnowledgeService | Low | File I/O, one Electron call (openFolder -> PlatformIO) |
| TtsService | Medium | Process spawn + state management |
| WhisperService | Low | Process spawn |
| JupyterService | Low | Process spawn + event emission |
| OpenScadService | Low | Process spawn |
| DiscordService | Low | Network only |

Services that stay in `src/main/services/` (Electron-only):
- `tray.ts`, `globalShortcuts.ts`, `quickChat.ts`, `updater.ts`, `deeplink.ts`, `protocol.ts`

### Phase 5 — Headless Entry Point

1. Create `src/headless/index.ts` — bootstraps AgentEngine without Electron
2. Create `ConsoleBroadcaster` (logs events to stdout)
3. Create `NoopPlatformIO` (graceful no-ops)
4. Optionally: HTTP/WS adapter reusing logic from current `webServer.ts`
5. Add npm script: `npm run headless` or build as standalone binary

### Phase 6 — Cleanup

1. Remove `src/shared/` (re-exports from Phase 0)
2. Remove dead code in `src/main/services/` (logic moved to core)
3. Update WebSocket bridge to use `engine.*` directly instead of `ipcDispatch` map
4. Update tests to test core services directly (without IPC mocking)
5. Update CLAUDE.md architecture section

## What Does NOT Change

- **Renderer code** — continues calling `window.agent.*` via preload bridge
- **Preload bridge** — still maps `window.agent` to `ipcRenderer.invoke`
- **IPC channel names** — preserved for backward compat with preload
- **WebSocket shim** — still works (eventually simplified to use engine directly)
- **Test infrastructure** — `createTestDb()` pattern preserved, tests just move closer to core

## Verification Plan

### Per-Phase Verification
- `npm run build` — TypeScript compiles with zero errors
- `npm test` — all 1917 tests pass
- Manual smoke test: start app, send a message, verify streaming works

### Phase 3 Specific (streaming)
- Verify stream chunks reach renderer (send message, watch for response)
- Verify abort works (stop mid-stream)
- Verify tool approval flow (MCP tool triggers approval dialog)
- Verify concurrent conversations stream independently

### Phase 5 Specific (headless)
- `node src/headless/index.ts` starts without errors
- Can create conversation and send message via API
- Stream chunks logged to stdout
- Graceful shutdown on SIGTERM

### Final Verification
- No Electron imports in `src/core/**/*.ts` (grep verification)
- No `getMainWindow()`, `webContents`, `BrowserWindow` in core
- Core services testable without Electron test harness
- WebSocket bridge still works for mobile/remote access
