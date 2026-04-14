import type { HandleRegistrar } from '../dispatch'
import type { SqlJsAdapter } from '../db/sqljs-adapter'
import { ToolsService } from '../services/tools'

export function registerToolsHandlers(registrar: HandleRegistrar, db: SqlJsAdapter): void {
  const service = new ToolsService(db as any)

  registrar.handle('tools:listAvailable', async () => {
    try {
      return service.listAvailable()
    } catch (err) {
      throw new Error(`Failed to list available tools: ${(err as Error).message}`)
    }
  })

  registrar.handle('tools:setEnabled', async (_event, value: unknown) => {
    try {
      service.setEnabled(value as string)
    } catch (err) {
      throw new Error(`Failed to set enabled tools: ${(err as Error).message}`)
    }
  })

  registrar.handle('tools:toggle', async (_event, toolName: unknown) => {
    try {
      service.toggle(toolName as string)
    } catch (err) {
      throw new Error(`Failed to toggle tool: ${(err as Error).message}`)
    }
  })
}
