import { join } from 'path'
import { homedir } from 'os'
import { TypedEventEmitter } from './events'
import { initDatabase, getDatabase, closeDatabase } from './db/database'
import type { SqlJsAdapter } from './db/sqljs-adapter'
import { SettingsService } from './services/settings'
import { FolderService } from './services/folders'
import { ConversationService } from './services/conversations'
import { MessageService } from './services/messages'
import { ToolsService } from './services/tools'
import { ShortcutsService } from './services/shortcuts'
import { ThemesService } from './services/themes'
import { McpService } from './services/mcp'
import { SchedulerService } from './services/scheduler'
import { createWebPasswordService, type WebPasswordService } from './auth'
import { DispatchRegistry } from './dispatch'
import { registerCoreHandlers } from './handlers'
import type { BugReportHandlerOptions } from './handlers/bugReport'
import type { Broadcaster } from './ports/broadcaster'
import type { HookRunner } from './ports/hookRunner'
import { noopHookRunner } from './ports/hookRunner'
import type { PlatformIO } from './ports/platformIO'
import { noopPlatformIO } from './ports/platformIO'
import type { SystemUI } from './ports/systemUI'
import { noopSystemUI } from './ports/systemUI'
import type {
  StreamChunk,
  JupyterOutputChunk,
  ScheduledTask,
  UpdateStatus,
} from './types'

// ─── Engine Events ─────────────────────────────────────────
// These replace the 12 one-way webContents.send() broadcast channels.
// Adapters subscribe and forward to their transport.

export interface EngineEvents {
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

// ─── Engine Options ────────────────────────────────────────

export interface EngineOptions {
  dbPath: string
  wasmPath?: string
  themesDir: string
  broadcaster: Broadcaster
  platformIO?: PlatformIO
  systemUI?: SystemUI
  hookRunner?: HookRunner
  bugReport?: BugReportHandlerOptions
}

// ─── Agent Engine ──────────────────────────────────────────

export class AgentEngine extends TypedEventEmitter<EngineEvents> {
  readonly broadcaster: Broadcaster
  readonly platformIO: PlatformIO
  readonly systemUI: SystemUI
  readonly hookRunner: HookRunner
  readonly dispatch: DispatchRegistry

  // Services (initialized after DB is ready)
  private _settings!: SettingsService
  private _folders!: FolderService
  private _conversations!: ConversationService
  private _messages!: MessageService
  private _tools!: ToolsService
  private _shortcuts!: ShortcutsService
  private _themes!: ThemesService
  private _mcp!: McpService
  private _scheduler!: SchedulerService
  private _webPassword!: WebPasswordService

  private readonly dbPath: string
  private readonly wasmPath?: string
  private readonly themesDir: string
  private readonly bugReportOpts?: BugReportHandlerOptions

  constructor(options: EngineOptions) {
    super()
    this.dbPath = options.dbPath
    this.wasmPath = options.wasmPath
    this.themesDir = options.themesDir
    this.broadcaster = options.broadcaster
    this.platformIO = options.platformIO ?? noopPlatformIO
    this.systemUI = options.systemUI ?? noopSystemUI
    this.hookRunner = options.hookRunner ?? noopHookRunner
    this.bugReportOpts = options.bugReport
    this.dispatch = new DispatchRegistry()
  }

  /** Get the database instance (throws if not initialized) */
  get db(): SqlJsAdapter {
    return getDatabase()
  }

  get settings(): SettingsService { return this._settings }
  get folders(): FolderService { return this._folders }
  get conversations(): ConversationService { return this._conversations }
  get messages(): MessageService { return this._messages }
  get tools(): ToolsService { return this._tools }
  get shortcuts(): ShortcutsService { return this._shortcuts }
  get themes(): ThemesService { return this._themes }
  get mcp(): McpService { return this._mcp }
  get scheduler(): SchedulerService { return this._scheduler }
  get webPassword(): WebPasswordService { return this._webPassword }

  async init(): Promise<void> {
    await initDatabase(this.dbPath, this.wasmPath)
    const db = getDatabase() as any
    this._settings = new SettingsService(db)
    this._folders = new FolderService(db)
    this._conversations = new ConversationService(db)
    this._messages = new MessageService(db)
    this._tools = new ToolsService(db)
    this._shortcuts = new ShortcutsService(db)
    this._themes = new ThemesService(this.themesDir)
    this._mcp = new McpService(db)
    this._scheduler = new SchedulerService(db)
    this._webPassword = createWebPasswordService({
      get: (k) => {
        const all = this._settings.getAll()
        return Object.prototype.hasOwnProperty.call(all, k) ? all[k] : undefined
      },
      set: (k, v) => this._settings.set(k, v),
      delete: (k) => { this._settings.set(k, '') },
    })
    registerCoreHandlers(this.dispatch, db, {
      broadcaster: this.broadcaster,
      hookRunner: this.hookRunner,
      sessionsBase: join(homedir(), '.agent-desktop', 'sessions-folder'),
      themesDir: this.themesDir,
      knowledgesDir: join(homedir(), '.agent-desktop', 'knowledges'),
      bugReport: this.bugReportOpts,
      webPassword: this._webPassword,
    })
  }

  async shutdown(): Promise<void> {
    // Phase 3+ will wire: session shutdown, scheduler stop, etc.
    closeDatabase()
    this.removeAllListeners()
  }
}
