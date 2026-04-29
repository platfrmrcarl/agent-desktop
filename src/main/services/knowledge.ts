import type { IpcMain } from 'electron'
import type Database from 'better-sqlite3'
import { shell } from 'electron'
import { app } from 'electron'
import { join } from 'path'
import { promises as fsp } from 'fs'
import { TEXT_EXTENSIONS } from '../utils/mime'

const KNOWLEDGES_DIR = join(app.getPath('home'), '.agent-desktop', 'knowledges')

export async function ensureKnowledgesDir(): Promise<void> {
  await fsp.mkdir(KNOWLEDGES_DIR, { recursive: true })
}

export function getKnowledgesDir(): string {
  return KNOWLEDGES_DIR
}

export function getSupportedExtensions(): Set<string> {
  return TEXT_EXTENSIONS
}

export function registerHandlers(ipcMain: IpcMain, _db: Database.Database): void {
  ipcMain.handle('kb:openKnowledgesFolder', async () => {
    await ensureKnowledgesDir()
    shell.showItemInFolder(KNOWLEDGES_DIR)
  })
}
