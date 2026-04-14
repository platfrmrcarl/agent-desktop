# Headless CLI & Engine-Owned Dispatch Refactor

**Date:** 2026-04-14
**Status:** Approved
**Goal:** Launch web server and Discord bot independently from CLI without Electron, by making the core engine own the dispatch registry and eliminating duplicated logic between Electron and headless modes.

---

## 1. Dispatch Registry

### Current architecture

```
ipcMain.handle('channel', handler)
       | side-effect
ipcDispatch.set('channel', handler)
       |
webServer/discord consume ipcDispatch
```

### Target architecture

```
engine.dispatch.set('channel', handler)     <-- source of truth
       | bridge (Electron only)
ipcMain.handle('channel', handler)          <-- consumer
       | direct (headless)
webServer/discord consume engine.dispatch
```

### Implementation

New class in `src/core/dispatch.ts`:

```ts
export interface HandleRegistrar {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void
}

export class DispatchRegistry implements HandleRegistrar {
  private handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()

  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void {
    this.handlers.set(channel, async (...args) => listener(null, ...args))
  }

  get(channel: string) { return this.handlers.get(channel) }
  has(channel: string) { return this.handlers.has(channel) }
  entries() { return this.handlers.entries() }
}
```

`AgentEngine` gains a `dispatch: DispatchRegistry` property, populated during `engine.init()`.

### What disappears

- `ipcDispatch` (global Map in `src/main/ipc.ts`)
- `withSanitizedErrors()` wrapper (absorbed into Electron bridge)
- `src/main/utils/broadcast.ts` and `src/core/utils/broadcast.ts` (replaced by engine events)

---

## 2. Service Migration Strategy

### Category A -- Pure CRUD (direct migration to core)

These services have existing core counterparts or are pure DB operations. The `registerHandlers` function moves to core, taking core services as parameters instead of raw DB.

| Service (main) | Core counterpart | Difficulty |
|---|---|---|
| `settings.ts` | `SettingsService` | Trivial |
| `folders.ts` | `FolderService` | Trivial |
| `conversations.ts` | `ConversationService` | Trivial |
| `tools.ts` | `ToolsService` | Trivial |
| `shortcuts.ts` | `ShortcutsService` | Trivial |
| `mcp.ts` | `McpService` | Trivial |
| `auth.ts` | -- (file read) | Easy |
| `attachments.ts` | -- (DB CRUD) | Easy |
| `whisper.ts` | -- (DB CRUD) | Easy |
| `piExtensions.ts` | -- (DB CRUD) | Easy |
| `commands.ts` | -- (parsing) | Easy |

### Category B -- Business logic + platform ports (migration via ports)

These services contain significant logic with injectable platform dependencies. Logic extracts to core; platform-specific behavior injected via ports (existing pattern: `PlatformIO`, `SystemUI`, `Broadcaster`).

| Service | Electron dep | Port needed |
|---|---|---|
| `messages.ts` + `streaming.ts` | `BrowserWindow`, `app`, hooks | **Main effort** -- StreamingService in core (see Section 3) |
| `themes.ts` | `app.getPath()` | Already injectable via `EngineOptions.themesDir` |
| `knowledge.ts` | `shell.openExternal`, `app` | `PlatformIO.openExternal()` (exists) |
| `files.ts` | `shell`, `app` | `PlatformIO` |
| `tts.ts` | broadcast, streaming | `Broadcaster` (exists) |
| `scheduler.ts` | `Notification` | `SystemUI.notify()` (exists) |

### Category C -- Electron-only (stay in `src/main/`)

Hard-coupled to Electron runtime. Not in engine dispatch; register directly on `ipcMain` via the bridge.

Services: `updater`, `quickChat`, `globalShortcuts`, `waylandShortcuts`, `deeplink`, `protocol`, `tray`, `openscad`, `system`, `webhook`, `jupyter`, `schedulerBridge`.

---

## 3. Streaming Unification

### Problem: duplicated logic

The same streaming orchestration exists in two places:

- `src/main/services/messages.ts` + `streaming.ts` (Electron path)
- `src/headless/headlessTaskContext.ts` (headless path -- 400 lines of reimplemented logic)

Both do: AI settings cascade, message history build, system prompt construction, SDK stream iteration, message save.

### Solution: `StreamingService` in core

```ts
// src/core/services/streaming.ts
export class StreamingService {
  private abortControllers = new Map<number, AbortController>()

  constructor(
    private db: SqlJsAdapter,
    private broadcaster: Broadcaster,
    private hooks: HookRunner,
  ) {}

  async sendMessage(conversationId: number, content: string, attachments?: ...): Promise<StreamResult>
  abort(conversationId: number): void
  // + auto-title, compact, session management
}
```

### New port: `HookRunner`

```ts
// src/core/ports/hookRunner.ts
export interface HookRunner {
  run(event: string, context: HookContext): Promise<HookResult | null>
}
export const noopHookRunner: HookRunner = {
  async run() { return null }
}
```

- **Electron:** injects the real `hookRunner.ts` (uses `app` for CWD paths)
- **Headless:** `noopHookRunner` (scheduled tasks use `bypassPermissions`)

### What migrates into `StreamingService`

| Logic | Current source | Notes |
|---|---|---|
| AI settings cascade | `messages.ts` + `headlessTaskContext.ts` | Single implementation |
| Build history | same | With compact summary injection |
| System prompt | same | With CWD injection |
| Stream SDK loop | `streaming.ts` + `headlessTaskContext.ts` | AbortController, chunks, tool calls |
| Auto-title | `messages.ts` | Haiku one-shot |
| Session management | `messages.ts` + `sessionManager.ts` | `sdk_session_id` resume/invalidation |

### What disappears

- `src/headless/headlessTaskContext.ts` -- replaced by engine + `StreamingService`
- Duplicated `buildMessageHistory`, `getAISettingsFromDb`, `getSystemPromptFromDb` in headless
- `streamBuffers` in `src/main/services/streaming.ts` -- absorbed by `StreamingService`

### What stays in `src/main/`

- `registerStreamWindow(win)` -- Electron bridge connecting `engine.on('stream:chunk')` to `webContents.send()`
- The concrete hookRunner (uses `app` for CWD paths)

---

## 4. Web Server Decoupling

### Electron dependencies to remove

#### 4.1 `app.getPath('userData')` -- injectable SSL dir

**Before:** `const sslDir = path.join(app.getPath('userData'), 'ssl')` (line 592)

**After:** `sslDir` becomes a parameter of `startServer()`:

```ts
export interface ServerStartOptions {
  shortCode?: string
  accessMode?: 'lan' | 'all'
  sslDir: string
  rendererDir: string
  dispatch: DispatchRegistry
}
```

- **Electron:** passes `path.join(app.getPath('userData'), 'ssl')`
- **Headless:** passes `path.join(homedir(), '.config', 'agent-desktop', 'ssl')`

#### 4.2 `ipcDispatch` -- replaced by `dispatch` (engine-owned)

The web server uses `ipcDispatch.get(channel)` in `handleWsMessage()` (line 531). Replaced by the `dispatch` passed via options.

#### 4.3 `setBroadcastHandler` -- explicit engine event subscription

**After:** the server subscribes to engine events:

```ts
for (const eventName of engineEventNames) {
  engine.on(eventName, (...args) => broadcastEvent(eventName, ...args))
}
```

#### 4.4 Module relocation

`src/main/services/webServer.ts` -> `src/core/services/webServer.ts`

Zero imports from `'electron'`. The 3 IPC handlers (`server:start`, `server:stop`, `server:getStatus`) register in `engine.dispatch` for UI control.

#### 4.5 Static files

`getRendererDir()` replaced by injectable `rendererDir`:
- **Electron:** `path.join(__dirname, '../renderer')`
- **Headless:** `path.resolve('out/renderer')` (after `npm run build`)

---

## 5. Discord Bot Decoupling

### 5.1 `ipcDispatch` -- replaced by `engine.dispatch`

Same treatment as web server: inject `dispatch` via `startBot()` options.

### 5.2 Token: env var with DB fallback

```ts
export async function startBot(options: {
  dispatch: DispatchRegistry
  token?: string
}): Promise<void> {
  const token = options.token
    || process.env.DISCORD_BOT_TOKEN
    || await getTokenFromDb(options.dispatch)
  if (!token) throw new Error('No Discord bot token configured')
}
```

### 5.3 Module relocation

`src/main/services/discord.ts` -> `src/core/services/discord.ts`

### 5.4 Auto-start

Entry point (Electron or headless) decides whether to start the bot:
- **Electron:** reads `discord_enabled` from DB
- **Headless:** `--discord` flag triggers `startBot()`

---

## 6. Headless CLI Entry Point

### Usage

```bash
# Web server only
node out/headless/index.js --server

# Web server with custom port
node out/headless/index.js --server --port 8080 --access-mode all

# Discord only
DISCORD_BOT_TOKEN=xxx node out/headless/index.js --discord

# Both together
DISCORD_BOT_TOKEN=xxx node out/headless/index.js --server --discord --port 3484

# Scheduler (unchanged)
node out/headless/index.js --tick
node out/headless/index.js --run-task 42
```

### CLI parsing

No external dependency -- parse `process.argv` directly (existing pattern for `--tick`/`--run-task`):

```ts
const args = process.argv.slice(2)
const flags = {
  server:     args.includes('--server'),
  discord:    args.includes('--discord'),
  tick:       args.includes('--tick'),
  runTask:    args.includes('--run-task'),
  port:       getArgValue(args, '--port'),
  accessMode: getArgValue(args, '--access-mode'),
}
```

### Startup flow

```
1. enrichHeadlessEnv()
2. engine = new AgentEngine({ dbPath, sslDir, themesDir, broadcaster, hooks: noopHookRunner })
3. await engine.init()         <-- populates engine.dispatch with all services
4. if (flags.server)  -> startServer({ port, dispatch: engine.dispatch, sslDir, rendererDir })
5. if (flags.discord) -> startBot({ dispatch: engine.dispatch, token })
6. if (flags.tick)    -> runTick(engine)
7. if (flags.runTask) -> runTask(engine, taskId)
8. SIGINT/SIGTERM     -> stopServer() + stopBot() + engine.shutdown()
```

### Mode constraints

- `--server` and `--discord` are **combinable** (long-running, same process)
- `--tick` and `--run-task` are **exclusive** and **one-shot** (execute then exit)
- `--server`/`--discord` + `--tick` = error (mixing long-running and one-shot is invalid)

### headlessTaskContext.ts elimination

```ts
// Before (headlessTaskContext.ts -- 400 lines of duplicated code)
const ctx = createHeadlessContext(engine.db)
await executeTask(scheduler, ctx, task)

// After
await executeTask(scheduler, engine, task)
// executeTask uses engine.dispatch.get('messages:send')
// -> same code as Electron and web clients
```

### Build script

```json
"build:headless": "esbuild src/headless/index.ts --bundle --platform=node --target=node18 --outfile=out/headless/index.js --external:@anthropic-ai/claude-agent-sdk --external:better-sqlite3 --external:discord.js"
```

---

## 7. Electron Bridge

### Bridge function

```ts
// src/main/ipc.ts (simplified)
export function bridgeDispatchToIpc(engine: AgentEngine, ipcMain: IpcMain): void {
  // 1. Register all core handlers on ipcMain
  for (const [channel, handler] of engine.dispatch.entries()) {
    ipcMain.handle(channel, async (_event, ...args) => {
      try {
        return await handler(...args)
      } catch (err) {
        throw new Error(sanitizeError(err))
      }
    })
  }

  // 2. Register Electron-only handlers directly
  updaterHandlers(ipcMain)
  quickChatHandlers(ipcMain)
  systemHandlers(ipcMain)
  openscadHandlers(ipcMain)
  jupyterHandlers(ipcMain)
  // ... other Category C services
}
```

### Impact on `src/main/index.ts`

```ts
// Before
await initDatabase(dbPath, wasmPath)
const db = getDatabase()
registerAllHandlers(ipcMain, db)

// After
const engine = new AgentEngine({ dbPath, wasmPath, themesDir, broadcaster, hooks: electronHookRunner })
await engine.init()
bridgeDispatchToIpc(engine, ipcMain)
```

`AgentEngine` becomes the first object created in the main process. Everything else derives from it.

### Broadcast bridge

```ts
engine.on('stream:chunk', (convId, chunk) => {
  mainWindow?.webContents.send('stream:chunk', convId, chunk)
})
engine.on('conversation:updated', (convId) => {
  mainWindow?.webContents.send('conversation:updated', convId)
})
```

The global `setBroadcastHandler` disappears. Each consumer (Electron window, web server WSS) subscribes explicitly to engine events.

### What stays in `src/main/services/`

Only Category C (Electron-only) services: `updater`, `quickChat`, `globalShortcuts`, `system`, `openscad`, `protocol`, `tray`, `deeplink`, `jupyter`, `waylandShortcuts`, `schedulerBridge`, `webhook`.

They keep their current `registerHandlers(ipcMain)` signature -- no changes.
