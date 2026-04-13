import type { IpcMain } from 'electron'
import type Database from 'better-sqlite3'
import { transcribe, validateConfig } from '../../core/services/whisper'
import { getSetting } from '../utils/db'
import { duckVolume, restoreVolume } from '../utils/volume'

export function registerHandlers(ipcMain: IpcMain, db: Database.Database): void {
  ipcMain.handle('whisper:transcribe', async (_event, wavBuffer: Uint8Array | Buffer) => {
    const buf = Buffer.isBuffer(wavBuffer) ? wavBuffer : Buffer.from(wavBuffer)
    return transcribe(db, buf)
  })

  ipcMain.handle('whisper:validateConfig', async () => validateConfig(db))

  ipcMain.handle('voice:duck', async () => {
    const duck = Number(getSetting(db, 'voice_volumeDuck')) || 0
    if (duck > 0) await duckVolume(duck)
  })

  ipcMain.handle('voice:restore', async () => { await restoreVolume() })
}

// Re-export for testing
export { transcribe, validateConfig, findBinary, buildAdvancedArgs } from '../../core/services/whisper'
export { getSetting } from '../utils/db'
