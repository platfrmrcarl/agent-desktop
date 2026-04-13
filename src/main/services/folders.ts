import type { IpcMain } from 'electron'
import type Database from 'better-sqlite3'
import { FolderService } from '../../core/services/folders'

export function registerHandlers(ipcMain: IpcMain, db: Database.Database): void {
  const service = new FolderService(db)

  ipcMain.handle('folders:list', () => service.list())
  ipcMain.handle('folders:create', (_e, name: string, parentId?: number) => service.create(name, parentId))
  ipcMain.handle('folders:update', (_e, id: number, data: Record<string, unknown>) => service.update(id, data))
  ipcMain.handle('folders:delete', (_e, id: number, mode?: string) => service.delete(id, mode))
  ipcMain.handle('folders:reorder', (_e, ids: number[]) => service.reorder(ids))
  ipcMain.handle('folders:getDefault', () => service.getDefault())
}
