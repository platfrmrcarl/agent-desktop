import { BrowserWindow } from 'electron'
import { getMainWindow } from '../index'
import { setChunkSender, setSessionManager, setPIBackend, setPiMcpSync, setEnsureFreshToken } from '../../core/services/streaming'
import { sendTurn, respondToSessionApproval, abortSession, hasActiveSession } from './sessionManager'
import { streamMessagePI } from './streamingPI'
import { syncPiMcpForProject } from './piMcpSync'
import { ensureFreshMacOSToken } from '../utils/env'

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

// Wire PI MCP sync into core streaming
setPiMcpSync(syncPiMcpForProject)

// Wire macOS OAuth token refresh into core streaming
setEnsureFreshToken(ensureFreshMacOSToken)

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
