import { BrowserWindow } from 'electron'
import { getMainWindow } from '../index'
import { setChunkSender } from '../../core/services/streaming'

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
