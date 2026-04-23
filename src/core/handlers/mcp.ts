import type { HandleRegistrar } from '../dispatch'
import type { SqlJsAdapter } from '../db/sqljs-adapter'
import { McpService } from '../services/mcp'

export function registerMcpHandlers(registrar: HandleRegistrar, db: SqlJsAdapter): void {
  const service = new McpService(db as any)

  registrar.handle('mcp:listServers', async () => {
    try {
      return service.listServers()
    } catch (err) {
      throw new Error(`Failed to list MCP servers: ${(err as Error).message}`)
    }
  })

  registrar.handle('mcp:addServer', async (_event, config: unknown) => {
    try {
      return service.addServer(config as any)
    } catch (err) {
      throw new Error(`Failed to add MCP server: ${(err as Error).message}`)
    }
  })

  registrar.handle('mcp:updateServer', async (_event, id: unknown, config: unknown) => {
    try {
      service.updateServer(id as number, config as any)
    } catch (err) {
      throw new Error(`Failed to update MCP server: ${(err as Error).message}`)
    }
  })

  registrar.handle('mcp:removeServer', async (_event, id: unknown) => {
    try {
      service.removeServer(id as number)
    } catch (err) {
      throw new Error(`Failed to remove MCP server: ${(err as Error).message}`)
    }
  })

  registrar.handle('mcp:toggleServer', async (_event, id: unknown) => {
    try {
      service.toggleServer(id as number)
    } catch (err) {
      throw new Error(`Failed to toggle MCP server: ${(err as Error).message}`)
    }
  })

  registrar.handle('mcp:testConnection', async (_event, id: unknown) => {
    try {
      return await service.testConnection(id as number)
    } catch (err) {
      return { success: false, output: `Test failed: ${(err as Error).message}` }
    }
  })
}
