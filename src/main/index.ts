import './utils/coloredConsole'
import { ErrorBuffer } from '../core/services/errorBuffer'
import { patchConsoleError } from './bootstrap/mainErrorCapture'

export const mainErrorBuffer = new ErrorBuffer()
patchConsoleError(mainErrorBuffer)

import { app, BrowserWindow, ipcMain, Menu, session, shell } from 'electron'
import type { Session } from 'electron'
import { join } from 'path'
import { AgentEngine } from '../core'
import type { Broadcaster } from '../core/ports/broadcaster'
import { getDatabase, closeDatabase } from '../core/db/database'
import { bridgeDispatchToIpc } from './ipc'
import { createTray, setTrayUpdateCallbacks, rebuildTrayMenu, toggleAppWindow } from './services/tray'
import { initAutoUpdater, stopAutoUpdater, checkForUpdates, installUpdate } from './services/updater'
import { setupDeepLinks } from './services/deeplink'
import { registerPreviewScheme, registerPreviewProtocol } from './services/protocol'
import { registerStreamWindow } from './services/streaming'
import { cleanupPastedFiles } from './services/files'
import { registerGlobalShortcuts, unregisterAll as unregisterGlobalShortcuts } from './services/globalShortcuts'
import { showOverlay } from './services/quickChat'
import { startScheduler, stopScheduler } from './services/scheduler'
import { startBridge, stopBridge } from './services/schedulerBridge'
import { shutdownAllKernels } from './services/jupyter'
import { shutdownAllSessions } from './services/sessionManager'
import { stop as stopTts } from './services/tts'
import { startServer, stopServer } from './services/webServer'
import { loadFromDisk, attachPersistence } from './services/errorBufferPersist'
import { sendBugReport } from './services/bugReport'
import { scrub as scrubLog } from './services/logScrubber'
import { registerBugReportHandlers } from '../core/handlers/bugReport'

// Custom protocol — must be registered before app.ready
registerPreviewScheme()

// Enrich PATH/HOME for AppImage and non-standard environments — before GPU flags
// (enrichEnvironment discovers WAYLAND_DISPLAY which affects Ozone platform choice)
import { enrichEnvironment } from './utils/env'
import { killExistingInstances } from './utils/singleInstance'
enrichEnvironment()

// GPU / Ozone flags — Linux only
if (process.platform === 'linux') {
  // Force Wayland backend when a Wayland compositor is running.
  // 'auto' hint tries X11 first when DISPLAY is set (XWayland), which is wrong on Hyprland/Sway.
  if (process.env.WAYLAND_DISPLAY) {
    app.commandLine.appendSwitch('ozone-platform', 'wayland')
  } else {
    app.commandLine.appendSwitch('ozone-platform-hint', 'auto')
  }
  // Disable GPU compositing only: ANGLE+OpenGL fails on eglCreateImage with Ozone/Wayland
  // buffer import, ANGLE+Vulkan crashes Hyprland's EGL compositor (cross-API fence sync).
  // GPU remains available for WebGL, 3D previews, and CSS transforms.
  app.commandLine.appendSwitch('disable-gpu-compositing')
}

// Kill existing instances — new instance wins, old ones are terminated
if (process.platform === 'linux') {
  killExistingInstances()
}

// Windows taskbar identity — affects notifications, jump lists, taskbar pinning.
// Must happen before any BrowserWindow is created.
if (process.platform === 'win32') {
  app.setAppUserModelId('com.agent.desktop')
}

// --- Security hardening -----------------------------------------------------
//
// Single-patch consolidation of the Electron hardening review
// (.claude/reviews/2026-04-23/07-electron-packaging.md +
//  .claude/reviews/2026-04-23/01-security.md #14, #18).
//
// Kept as pure exported helpers so tests can exercise them against mock
// session / window objects without spinning up an Electron runtime.

/**
 * Content-Security-Policy served on every main-window response.
 *
 * Tight enough to foreclose script injection (`script-src 'self'`) while
 * still allowing the preview protocol to serve images/stylesheets into
 * iframes. Crucially, `connect-src` does NOT list `agent-preview:` — a
 * compromised renderer therefore cannot fetch arbitrary files through
 * the preview channel (e.g. `fetch('agent-preview:///home/<u>/.ssh/id_rsa')`).
 */
export const CSP_POLICY = [
  "default-src 'self' agent-preview:",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: agent-preview:",
  "connect-src 'self' ws: wss: https:",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
].join('; ')

/**
 * Renderer permission allowlist. Anything not in this set is denied when
 * the page calls a gated API (navigator.mediaDevices, Notification, etc.).
 */
export const PERMISSION_ALLOWLIST: ReadonlySet<string> = new Set([
  'media',
  'notifications',
  'clipboard-sanitized-write',
])

/** Install CSP + permission filter on an Electron Session. */
export function applySessionHardening(target: Session): void {
  target.webRequest.onHeadersReceived((details, cb) => {
    cb({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [CSP_POLICY],
      },
    })
  })
  target.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(PERMISSION_ALLOWLIST.has(permission))
  })
}

/**
 * Lock a BrowserWindow to its launch origin:
 *   - `window.open()` / `target=_blank` is denied in-window; http(s) URLs
 *     are farmed out to the OS shell.
 *   - Cross-origin top-level navigations are blocked; http(s) URLs are
 *     opened externally, everything else is silently prevented.
 *
 * MUST be called before `loadURL`/`loadFile`, otherwise the first
 * navigation slips past the guards.
 */
export function hardenBrowserWindow(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (ev, targetUrl) => {
    const currentUrl = win.webContents.getURL()
    if (!currentUrl) return
    try {
      if (new URL(targetUrl).origin !== new URL(currentUrl).origin) {
        ev.preventDefault()
        if (/^https?:\/\//i.test(targetUrl)) shell.openExternal(targetUrl)
      }
    } catch {
      // Unparseable target → safest to refuse the navigation outright.
      ev.preventDefault()
    }
  })
}

let mainWindow: BrowserWindow | null = null
let isShuttingDown = false

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

// Window control IPC — registered once, use module-level mainWindow via closure
let windowIpcRegistered = false
function registerWindowIpc(): void {
  if (windowIpcRegistered) return
  windowIpcRegistered = true

  ipcMain.on('window:minimize', () => mainWindow?.minimize())
  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow?.maximize()
    }
  })
  ipcMain.on('window:close', () => {
    try {
      const db = getDatabase()
      const row = db.prepare("SELECT value FROM settings WHERE key = 'minimizeToTray'").get() as { value: string } | undefined
      if (row?.value === 'true') {
        mainWindow?.hide()
        return
      }
    } catch {
      // Fall through to close
    }
    mainWindow?.close()
  })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    frame: false,
    backgroundColor: '#1a1a2e',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // Required: electron-vite preload needs Node.js access for ipcRenderer
    },
  })

  registerWindowIpc()

  // Origin-lock the window BEFORE loadURL/loadFile — otherwise the first
  // navigation dispatches before setWindowOpenHandler/will-navigate are wired.
  hardenBrowserWindow(mainWindow)

  // Load renderer
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// Request single instance lock for deep links
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    // Register the Claude Agent SDK with Core BEFORE any engine init.
    // Core's anthropic.ts is now a registry-only module — entry points own SDK resolution.
    // Function trick avoids esbuild bundling the SDK into asar (where node can't read it).
    {
      const { registerAgentSDK } = await import('../core/services/anthropic')
      const sdk = await (Function('return import("@anthropic-ai/claude-agent-sdk")')() as Promise<typeof import('@anthropic-ai/claude-agent-sdk')>)
      registerAgentSDK(sdk)
    }

    registerPreviewProtocol()

    // Security hardening — session CSP + permission filter + app-level
    // guards. Must run after ready; defaultSession is not available before.
    //
    // CSP `script-src 'self'` would block Vite HMR's inline scripts in dev
    // (React preamble injected by @vitejs/plugin-react, /@vite/client wiring).
    // ELECTRON_RENDERER_URL is set by electron-vite only when a dev server
    // is attached, so skipping CSP under that signal keeps the prod
    // hardening tight without breaking dev iteration.
    if (!process.env.ELECTRON_RENDERER_URL) {
      applySessionHardening(session.defaultSession)
    }
    if (app.isPackaged) Menu.setApplicationMenu(null)
    app.on('certificate-error', (_e, _wc, _url, _err, _cert, cb) => cb(false))
    app.on('render-process-gone', (_e, _wc, details) => {
      console.error('[crash] renderer', details)
    })
    app.on('child-process-gone', (_e, details) => {
      // Electron 33 folds the former `gpu-process-crashed` event into
      // child-process-gone with type==='GPU'.
      if (details.type === 'GPU') console.error('[crash] gpu', details)
      else console.error('[crash] child-process', details)
    })

    const errorBufferPath = join(app.getPath('userData'), 'error-buffer.json')
    await loadFromDisk(mainErrorBuffer, errorBufferPath)
    attachPersistence(mainErrorBuffer, errorBufferPath)
    const dbPath = join(app.getPath('userData'), 'agent.db')
    const wasmPath = app.isPackaged ? join(process.resourcesPath, 'sql-wasm.wasm') : undefined

    // Broadcaster adapter — forwards engine events to Electron renderer
    const electronBroadcaster: Broadcaster = {
      broadcast(channel: string, data: unknown): void {
        const win = getMainWindow()
        if (win && !win.isDestroyed()) {
          win.webContents.send(channel, data)
        }
      },
    }

    // HookRunner adapter — delegates to Electron-side hook execution
    const { electronHookRunner } = await import('./services/hookRunner')

    const engine = new AgentEngine({
      dbPath,
      wasmPath,
      themesDir: join(app.getPath('home'), '.agent-desktop', 'themes'),
      broadcaster: electronBroadcaster,
      hookRunner: electronHookRunner,
    })
    await engine.init()
    const db = engine.db as any

    // Override the placeholder bug-report handlers that engine.init() registered
    // (with undefined opts, because engine has no knowledge of bugReport) with
    // real ones that have access to app-level state.
    // MUST happen BEFORE bridgeDispatchToIpc, because the bridge captures
    // handler references by value — any later re-registration on engine.dispatch
    // would not propagate to ipcMain.
    registerBugReportHandlers(engine.dispatch, {
      mainBuffer: mainErrorBuffer,
      getMetadata: async () => {
        const aiBackendRow = db
          .prepare("SELECT value FROM settings WHERE key = 'ai_sdkBackend'")
          .get() as { value: string } | undefined
        const themeRow = db
          .prepare("SELECT value FROM settings WHERE key = 'activeTheme'")
          .get() as { value: string } | undefined
        return {
          version: app.getVersion(),
          platform: `${process.platform} (${process.arch})`,
          session:
            process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY
              ? ('Wayland' as const)
              : process.env.DISPLAY
                ? ('X11' as const)
                : ('unknown' as const),
          electron: process.versions.electron ?? 'unknown',
          node: process.versions.node ?? 'unknown',
          aiBackend: aiBackendRow?.value ?? 'claude-agent-sdk',
          theme: themeRow?.value ?? 'default',
          webMode: process.env.AGENT_WEB_MODE ? ('yes' as const) : ('no' as const),
        }
      },
      getWebhookUrl: () =>
        (import.meta.env.MAIN_VITE_BUG_WEBHOOK_URL as string | undefined) ?? '',
      sendBugReport,
      scrub: scrubLog,
    })

    bridgeDispatchToIpc(engine, ipcMain)

    cleanupPastedFiles().catch(() => {}) // fire-and-forget: remove stale paste temp files
    setupDeepLinks(app)
    createWindow()
    registerStreamWindow(mainWindow!)
    registerGlobalShortcuts(db, {
      onQuickChat: () => showOverlay('text'),
      onQuickVoice: () => showOverlay('voice'),
      onShowApp: () => toggleAppWindow(),
      onStopTts: () => stopTts(),
    })

    startBridge(db)
    startScheduler(db).catch(err => console.error('[scheduler] Start failed:', err))
    createTray(getMainWindow, createWindow)

    // Auto-start web server if configured
    const autoStartRow = db.prepare("SELECT value FROM settings WHERE key = 'server_autoStart'").get() as { value: string } | undefined
    if (autoStartRow?.value === 'true') {
      const portRow = db.prepare("SELECT value FROM settings WHERE key = 'server_port'").get() as { value: string } | undefined
      const shortCodeRow = db.prepare("SELECT value FROM settings WHERE key = 'server_shortCode'").get() as { value: string } | undefined
      const accessModeRow = db.prepare("SELECT value FROM settings WHERE key = 'server_accessMode'").get() as { value: string } | undefined
      const port = parseInt(portRow?.value || '3484', 10) || 3484
      startServer(port, {
        shortCode: shortCodeRow?.value || undefined,
        accessMode: accessModeRow?.value === 'all' ? 'all' : 'lan',
        sslDir: join(app.getPath('userData'), 'ssl'),
        rendererDir: join(__dirname, '../renderer'),
        dispatch: engine.dispatch,
      }).then(() => {
        db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('server_enabled', 'true')").run()
      }).catch(err => console.error('[webServer] Auto-start failed:', err.message))
    }

    if (app.isPackaged) {
      setTrayUpdateCallbacks(checkForUpdates, installUpdate)
      initAutoUpdater(getMainWindow, () => rebuildTrayMenu(true))
    }
  }).catch((err) => {
    // dialog must be required inline — not available if app.ready fails
    const { dialog } = require('electron')
    console.error('[startup] Fatal:', err)
    dialog.showErrorBox('Startup Failed', err.message || String(err))
    app.quit()
  })

  app.on('before-quit', (e) => {
    if (isShuttingDown) return
    e.preventDefault()
    isShuttingDown = true

    // Sync cleanup
    shutdownAllSessions()
    shutdownAllKernels()
    stopScheduler()
    stopBridge()
    unregisterGlobalShortcuts() // async but fire-and-forget OK
    stopAutoUpdater()
    stopTts()
    closeDatabase() // flush() + close() — ensures all pending writes are persisted

    // Async cleanup with timeout safety (3s max)
    Promise.race([
      stopServer(),
      new Promise(resolve => setTimeout(resolve, 3000)),
    ]).finally(() => app.exit())
  })

  app.on('window-all-closed', () => {
    try {
      const db = getDatabase()
      const row = db.prepare("SELECT value FROM settings WHERE key = 'minimizeToTray'").get() as { value: string } | undefined
      if (row?.value === 'true') return
    } catch {
      // Fall through to quit
    }
    app.quit()
  })
}
