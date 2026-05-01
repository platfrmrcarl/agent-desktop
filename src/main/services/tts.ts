import type { IpcMain } from 'electron'
import type Database from 'better-sqlite3'
import { getMainWindow } from '../mainContext'
import { broadcast } from '../utils/broadcast'
import {
  stop,
  speak,
  speakResponse,
  speakMessage,
  validateConfig,
  detectPlayers,
  listSayVoices,
  setSpeakingStateListener,
} from '../../core/handlers/tts'

// ─── Electron state notification ────────────────────────────

setSpeakingStateListener((speaking, messageId) => {
  const win = getMainWindow()
  if (win && !win.isDestroyed()) {
    win.webContents.send('tts:stateChange', { speaking, messageId })
  }
  broadcast('tts:stateChange', { speaking, messageId })
})

// ─── Re-exports (for main/index.ts consumers) ───────────────

export { stop, speak, speakResponse, speakMessage, validateConfig, detectPlayers, listSayVoices }

// ─── IPC handler registration (Category C — Electron-only) ──
// NOTE: tts:* channels are already registered in core dispatch.
// This registerHandlers is kept for ipc.ts compatibility but the
// withSanitizedErrors wrapper in ipc.ts skips duplicate channels,
// so these calls are effectively no-ops at runtime.
// They are preserved to avoid breaking the import chain in ipc.ts.

export function registerHandlers(_ipcMain: IpcMain, _db: Database.Database): void {
  // All tts:* channels are owned by core dispatch (registerTtsHandlers).
  // ipc.ts mirrors them to ipcMain automatically. Nothing to register here.
}
