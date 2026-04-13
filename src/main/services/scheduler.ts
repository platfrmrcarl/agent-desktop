import type { IpcMain } from 'electron'
import type Database from 'better-sqlite3'
import { Notification } from 'electron'
import { join } from 'path'
import { homedir } from 'os'
import { promises as fsp } from 'fs'
import { getMainWindow } from '../index'
import { buildMessageHistory, getAISettings, getSystemPrompt, saveMessage } from './messages'
import { streamMessage, injectApiKeyEnv, registerStreamWindow } from './streaming'
import { broadcast } from '../utils/broadcast'
import { speak as ttsSpeak } from './tts'
import {
  SchedulerService,
} from '../../core/services/scheduler'
import { executeTask as coreExecuteTask } from '../../core/services/taskExecutor'
import type { TaskRunContext } from '../../core/services/taskExecutor'
import type { ScheduledTask } from '../../core/types'
import { createPlatformScheduler } from './platformScheduler'
import { findBinaryInPath } from '../utils/env'

// Re-export core functions for backward compatibility with existing importers
export { computeNextRun, getExpectedThemeFilename } from '../../core/services/scheduler'

let tickInterval: ReturnType<typeof setInterval> | null = null
let schedulerService: SchedulerService | null = null
let schedulerDb: Database.Database | null = null

const HEADLESS_DIR = join(homedir(), '.config', 'agent-desktop', 'headless')

// ─── Electron TaskRunContext ───────────────────────────────

function notifyRenderer(event: string, data: unknown): void {
  const win = getMainWindow()
  if (win && !win.isDestroyed()) {
    win.webContents.send(event, data)
  }
  broadcast(event, data)
}

function createElectronContext(db: Database.Database): TaskRunContext {
  return {
    buildHistory(conversationId: number) {
      return buildMessageHistory(db, conversationId)
    },
    getAISettings(conversationId: number) {
      return getAISettings(db, conversationId)
    },
    async getSystemPrompt(conversationId: number, cwd: string) {
      return getSystemPrompt(db, conversationId, cwd)
    },
    async streamMessage(history, systemPrompt, aiSettings, conversationId) {
      // Inject API key env if configured
      const restoreEnv = injectApiKeyEnv(aiSettings.apiKey, aiSettings.baseUrl)

      // Ensure main window is registered for streaming
      const win = getMainWindow()
      if (win && !win.isDestroyed()) {
        registerStreamWindow(win)
      }

      try {
        return await streamMessage(history, systemPrompt, aiSettings, conversationId)
      } finally {
        restoreEnv?.()
      }
    },
    saveMessage(conversationId, role, content, attachments?, toolCalls?) {
      saveMessage(db, conversationId, role, content, attachments, toolCalls)
    },
    async notify(title, body) {
      try {
        new Notification({ title, body }).show()
      } catch { /* notification may fail in some environments */ }
    },
    onTaskUpdate(task: ScheduledTask) {
      notifyRenderer('scheduler:taskUpdate', task)
    },
    onConversationsRefresh() {
      notifyRenderer('conversations:refresh', undefined)
    },
  }
}

// ─── Task execution (backward-compatible wrapper) ──────────

export async function executeTask(db: Database.Database, task: ScheduledTask): Promise<void> {
  if (!schedulerService || schedulerDb !== db) {
    schedulerDb = db
    schedulerService = new SchedulerService(db)
  }
  const ctx = createElectronContext(db)

  await coreExecuteTask(schedulerService, ctx, task)

  // Voice notification (TTS) — Electron-only, not in core
  if (task.notify_voice) {
    const updated = schedulerService.get(task.id)
    const content = updated?.last_status === 'success' ? 'Task completed' : 'Task failed'
    ttsSpeak(content, db).catch(err => console.error('[scheduler] Voice notification error:', err))
  }
}

/** Backward-compatible reassignOrphanedTasks for existing callers (conversations.ts) */
export function reassignOrphanedTasks(db: Database.Database, conversationId: number): void {
  if (!schedulerService || schedulerDb !== db) {
    schedulerDb = db
    schedulerService = new SchedulerService(db)
  }
  schedulerService.reassignOrphanedTasks(conversationId)
}

// ─── Scheduler engine ──────────────────────────────────────

function tick(): void {
  if (!schedulerService || !schedulerDb) return

  // Auto-theme check
  const themeChange = schedulerService.checkAutoTheme()
  if (themeChange) {
    notifyRenderer('theme:autoSwitch', themeChange)
  }

  // Get due tasks and execute
  const dueTasks = schedulerService.getDueTasks()
  for (const task of dueTasks) {
    executeTask(schedulerDb, task).catch((err) => {
      console.error(`[scheduler] Unexpected error in task ${task.id}:`, err)
    })
  }
}

export async function startScheduler(db: Database.Database): Promise<void> {
  schedulerDb = db
  schedulerService = new SchedulerService(db)

  // Check if background mode is active
  const bgRow = db.prepare("SELECT value FROM settings WHERE key = 'scheduler_background_enabled'")
    .get() as { value: string } | undefined
  const backgroundMode = bgRow?.value === 'true'

  if (backgroundMode) {
    // Background mode: systemd timer / cron handles scheduling.
    // Electron does NOT run its own tick loop — avoids lock conflicts.
    // We only do startup recovery (safe: just resets stuck tasks).
    schedulerService.recoverStuckTasks()

    const taskCount = schedulerService.list().filter(t => t.enabled).length
    console.log('[scheduler] Background mode — in-memory tick disabled, OS timer active.', taskCount, 'enabled tasks')

    // Verify platform scheduler is installed
    verifyPlatformScheduler(db).catch(err =>
      console.error('[scheduler] Platform scheduler verification failed:', err)
    )
  } else {
    // Standard mode: in-memory tick loop. OS timer is not installed, so no lock needed.
    schedulerService.recoverStuckTasks()
    schedulerService.recomputeMissedRuns()

    // Auto-theme: check on startup
    const themeChange = schedulerService.checkAutoTheme()
    if (themeChange) {
      notifyRenderer('theme:autoSwitch', themeChange)
    }

    // 1-minute tick resolution
    tickInterval = setInterval(tick, 60_000)

    const taskCount = schedulerService.list().filter(t => t.enabled).length
    console.log('[scheduler] Standard mode — in-memory tick active.', taskCount, 'enabled tasks')
  }
}

export async function stopScheduler(): Promise<void> {
  if (tickInterval) {
    clearInterval(tickInterval)
    tickInterval = null
  }
  schedulerService = null
  schedulerDb = null
  console.log('[scheduler] Stopped')
}

// ─── Platform scheduler management ─────────────────────────

/** Extract headless script to stable path and install/verify OS scheduler */
async function verifyPlatformScheduler(db: Database.Database): Promise<void> {
  const bgEnabled = db.prepare("SELECT value FROM settings WHERE key = 'scheduler_background_enabled'")
    .get() as { value: string } | undefined
  if (bgEnabled?.value !== 'true') return

  const platformScheduler = createPlatformScheduler()

  // Find node executable
  const nodePath = findBinaryInPath('node') ?? process.execPath
  if (!nodePath) {
    console.warn('[scheduler] Cannot find node binary — platform scheduler not installed')
    return
  }

  // Extract headless script + WASM to stable location
  const scriptPath = join(HEADLESS_DIR, 'taskRunner.js')
  try {
    const { app } = await import('electron')
    const isPackaged = app.isPackaged

    const scriptSource = isPackaged
      ? join(process.resourcesPath, 'headless', 'taskRunner.js')
      : join(app.getAppPath(), 'out', 'headless', 'taskRunner.js')
    const wasmSource = isPackaged
      ? join(process.resourcesPath, 'sql-wasm.wasm')
      : join(app.getAppPath(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')

    await fsp.mkdir(HEADLESS_DIR, { recursive: true })
    await fsp.copyFile(scriptSource, scriptPath)
    await fsp.copyFile(wasmSource, join(HEADLESS_DIR, 'sql-wasm.wasm'))

    // Symlink node_modules so the headless runner can resolve @anthropic-ai/claude-agent-sdk
    // (ESM import() resolves relative to the file, so NODE_PATH alone isn't enough)
    const nodeModulesPath = isPackaged
      ? join(process.resourcesPath, 'app', 'node_modules')
      : join(app.getAppPath(), 'node_modules')
    const symlinkTarget = join(HEADLESS_DIR, 'node_modules')
    try {
      const existing = await fsp.readlink(symlinkTarget).catch(() => null)
      if (existing !== nodeModulesPath) {
        await fsp.rm(symlinkTarget, { force: true, recursive: true })
        await fsp.symlink(nodeModulesPath, symlinkTarget, 'dir')
      }
    } catch {
      // Symlink creation may fail (permissions) — write NODE_PATH as fallback
      await fsp.writeFile(join(HEADLESS_DIR, 'node_path.txt'), nodeModulesPath, 'utf-8')
    }
  } catch (err) {
    console.error('[scheduler] Failed to extract headless script:', err)
    return
  }

  // Install if not already installed
  if (!(await platformScheduler.isInstalled())) {
    await platformScheduler.install(nodePath, scriptPath)
    console.log('[scheduler] Platform scheduler installed')
  }
}

/** Install or uninstall the platform scheduler based on the setting */
export async function togglePlatformScheduler(db: Database.Database, enabled: boolean): Promise<void> {
  const platformScheduler = createPlatformScheduler()

  if (enabled) {
    await verifyPlatformScheduler(db)
  } else {
    await platformScheduler.uninstall()
    console.log('[scheduler] Platform scheduler uninstalled')
  }
}

/** Expose the SchedulerService instance for use by other main process modules */
export function getSchedulerService(): SchedulerService | null {
  return schedulerService
}

// ─── IPC Handlers ───────────────────────────────────────────

export function registerHandlers(ipcMain: IpcMain, db: Database.Database): void {
  // Ensure service exists for IPC calls (startScheduler may not have been called yet)
  const svc = () => {
    if (!schedulerService) schedulerService = new SchedulerService(db)
    return schedulerService
  }

  ipcMain.handle('scheduler:list', () => svc().list())

  ipcMain.handle('scheduler:get', (_event, id: number) => svc().get(id))

  ipcMain.handle('scheduler:create', (_event, data) => {
    const task = svc().create(data)
    notifyRenderer('conversations:refresh', undefined)
    return task
  })

  ipcMain.handle('scheduler:update', (_event, id: number, data) => {
    svc().update(id, data)
  })

  ipcMain.handle('scheduler:delete', (_event, id: number) => {
    svc().delete(id)
  })

  ipcMain.handle('scheduler:toggle', (_event, id: number, enabled: boolean) => {
    svc().toggle(id, enabled)
  })

  ipcMain.handle('scheduler:runNow', (_event, id: number) => {
    const task = svc().get(id)
    if (!task) throw new Error('Task not found')
    if (task.last_status === 'running') throw new Error('Task is already running')
    executeTask(db, task).catch((err) => {
      console.error(`[scheduler] Manual run of task ${id} failed:`, err)
    })
  })

  ipcMain.handle('scheduler:conversationTasks', (_event, conversationId: number) => {
    return svc().conversationTasks(conversationId)
  })

  ipcMain.handle('scheduler:toggleBackground', async (_event, enabled: boolean) => {
    // Save setting
    db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('scheduler_background_enabled', ?, datetime('now'))")
      .run(enabled ? 'true' : 'false')
    // Install/uninstall platform scheduler
    await togglePlatformScheduler(db, enabled)
    return enabled
  })

  ipcMain.handle('scheduler:backgroundStatus', async () => {
    const setting = db.prepare("SELECT value FROM settings WHERE key = 'scheduler_background_enabled'")
      .get() as { value: string } | undefined
    const enabled = setting?.value === 'true'
    const platformScheduler = createPlatformScheduler()
    const installed = await platformScheduler.isInstalled()
    return { enabled, installed }
  })
}
