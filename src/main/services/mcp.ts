import type { IpcMain } from 'electron'
import type Database from 'better-sqlite3'
import { McpService } from '../../core/services/mcp'

export function registerHandlers(ipcMain: IpcMain, db: Database.Database): void {
  const service = new McpService(db)

  ipcMain.handle('mcp:listServers', async () => {
    try { return service.listServers() }
    catch (err) { throw new Error(`Failed to list MCP servers: ${(err as Error).message}`) }
  })

  ipcMain.handle('mcp:addServer', async (_e, config) => {
    try { return service.addServer(config) }
    catch (err) { throw new Error(`Failed to add MCP server: ${(err as Error).message}`) }
  })

  ipcMain.handle('mcp:updateServer', async (_e, id: number, config) => {
    try { service.updateServer(id, config) }
    catch (err) { throw new Error(`Failed to update MCP server: ${(err as Error).message}`) }
  })

  ipcMain.handle('mcp:removeServer', async (_e, id: number) => {
    try { service.removeServer(id) }
    catch (err) { throw new Error(`Failed to remove MCP server: ${(err as Error).message}`) }
  })

  ipcMain.handle('mcp:toggleServer', async (_e, id: number) => {
    try { service.toggleServer(id) }
    catch (err) { throw new Error(`Failed to toggle MCP server: ${(err as Error).message}`) }
  })

  ipcMain.handle('mcp:testConnection', async (_e, id: number) => {
    try { return await service.testConnection(id) }
    catch (err) { return { success: false, output: `Test failed: ${(err as Error).message}` } }
  })
}
