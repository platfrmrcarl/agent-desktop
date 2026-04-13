import type { IpcMain } from 'electron'
import type Database from 'better-sqlite3'
import { SettingsService } from '../../core/services/settings'
import { syncPiMcpGlobal } from './piMcpSync'

export function registerHandlers(ipcMain: IpcMain, db: Database.Database): void {
  const service = new SettingsService(db)

  ipcMain.handle('settings:get', async () => {
    try {
      return service.getAll()
    } catch (err) {
      throw new Error(`Failed to get settings: ${(err as Error).message}`)
    }
  })

  ipcMain.handle('settings:set', async (_event, key: string, value: string) => {
    try {
      service.set(key, value)
      // Side effect: sync PI MCP config when backend or MCP disabled changes
      if (key === 'ai_sdkBackend' || key === 'ai_mcpDisabled') {
        syncPiMcpGlobal(db)
      }
    } catch (err) {
      throw new Error(`Failed to set setting: ${(err as Error).message}`)
    }
  })
}
