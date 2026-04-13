import type { IpcMain } from 'electron'
import type Database from 'better-sqlite3'
import { ShortcutsService } from '../../core/services/shortcuts'

export function registerHandlers(ipcMain: IpcMain, db: Database.Database): void {
  const service = new ShortcutsService(db)

  ipcMain.handle('shortcuts:list', async () => {
    try {
      return service.list()
    } catch (err) {
      throw new Error(`Failed to list shortcuts: ${(err as Error).message}`)
    }
  })

  ipcMain.handle('shortcuts:update', async (_event, id: number, keybinding: string) => {
    try {
      service.update(id, keybinding)
    } catch (err) {
      throw new Error(`Failed to update shortcut: ${(err as Error).message}`)
    }
  })
}
