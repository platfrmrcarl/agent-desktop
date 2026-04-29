import type { IpcMain } from 'electron'
import type Database from 'better-sqlite3'

// All whisper channels (whisper:transcribe, whisper:validateConfig, voice:duck, voice:restore)
// are registered by core/handlers/whisper.ts via engine.dispatch.
// withSanitizedErrors in ipc.ts skips any ipcMain.handle for channels already in dispatch,
// so this function is a no-op at runtime. Kept as a stub so ipc.ts import compiles.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function registerHandlers(_ipcMain: IpcMain, _db: Database.Database): void {}

// Re-export for testing — pure logic lives in core/services/whisper
export { transcribe, validateConfig, findBinary, buildAdvancedArgs } from '../../core/services/whisper'
export { getSetting } from '../utils/db'
