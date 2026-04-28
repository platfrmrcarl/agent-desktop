import { BrowserWindow } from 'electron'
import { getMainWindow } from '../index'
import {
  setChunkSender,
  setSessionManager,
  setPIBackend,
  setEnsureFreshToken,
  setConversationOverridesWriter,
  notifyConversationUpdated,
  setPIUIWindowProvider,
  setPISchedulerBridge,
} from '../../core/services/streaming'
import { getDatabase } from '../../core/db/database'
import { sendTurn, respondToSessionApproval, abortSession, hasActiveSession } from './sessionManager'
import { streamMessagePI } from '../../core/services/streamingPI'
import { ensureFreshMacOSToken } from '../utils/env'
import { getSchedulerMcpConfig, socketPath as schedSocketPath, authToken as schedAuthToken } from './schedulerBridge'

// Registry of windows that receive stream events (main window + overlay)
const streamWindows = new Set<BrowserWindow>()

export function registerStreamWindow(win: BrowserWindow): void {
  streamWindows.add(win)
  win.on('closed', () => streamWindows.delete(win))
}

// Wire the Electron chunk sender into the core streaming module
setChunkSender((channel: string, payload: Record<string, unknown>) => {
  for (const win of streamWindows) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, channel === 'messages:conversationUpdated' ? payload.conversationId : payload)
    }
  }
  if (streamWindows.size === 0) {
    const win = getMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, channel === 'messages:conversationUpdated' ? payload.conversationId : payload)
    }
  }
})

// Wire session manager into core streaming
setSessionManager({
  sendTurn,
  respondToApproval: respondToSessionApproval,
  abortSession,
  hasActiveSession,
})

// Wire PI backend into core streaming
setPIBackend(streamMessagePI)

// Wire the PI UI window provider — main process binds to the Electron BrowserWindow.
setPIUIWindowProvider(() => getMainWindow())

// Wire the in-process scheduler bridge for PI's `agent_scheduler` custom tool.
// Live bindings: reading socketPath/authToken returns whatever startBridge() has set.
setPISchedulerBridge({
  getMcpConfig: (conversationId: number) => getSchedulerMcpConfig(conversationId),
  getSocketPath: () => schedSocketPath,
  getAuthToken: () => schedAuthToken,
})

// Wire macOS OAuth token refresh into core streaming
setEnsureFreshToken(ensureFreshMacOSToken)

// Wire the conversation-overrides writer (used by PI parity extension's
// permission-modes module to persist exit_plan_mode back to ai_overrides).
// Resolves db lazily so this module can import before initDatabase() runs.
setConversationOverridesWriter((conversationId, patch) => {
  const db = getDatabase()
  const row = db.prepare('SELECT ai_overrides FROM conversations WHERE id = ?').get(conversationId) as { ai_overrides: string | null } | undefined
  const current: Record<string, string> = row?.ai_overrides ? JSON.parse(row.ai_overrides) : {}
  const next = { ...current, ...patch }
  db.prepare('UPDATE conversations SET ai_overrides = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(next),
    new Date().toISOString(),
    conversationId,
  )
  // Notify the renderer so the conversation store (and status bar) refresh.
  notifyConversationUpdated(conversationId)
})

// Re-export everything from core so existing imports work
export {
  abortControllers,
  respondToApproval,
  sendChunk,
  setChunkSender,
  buildPromptWithHistory,
  injectApiKeyEnv,
  streamMessage,
  notifyConversationUpdated,
  abortStream,
} from '../../core/services/streaming'

export type { AISettings } from '../../core/services/streaming'
