import type { IpcMain } from 'electron'
import type Database from 'better-sqlite3'
import { ToolsService } from '../../core/services/tools'

export function registerHandlers(ipcMain: IpcMain, db: Database.Database): void {
  const service = new ToolsService(db)

  ipcMain.handle('tools:listAvailable', async () => service.listAvailable())
  ipcMain.handle('tools:setEnabled', async (_event, value: string) => service.setEnabled(value))
  ipcMain.handle('tools:toggle', async (_event, toolName: string) => service.toggle(toolName))
}
