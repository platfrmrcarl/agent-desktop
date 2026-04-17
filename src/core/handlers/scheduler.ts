import type { HandleRegistrar } from '../dispatch'
import type { SqlJsAdapter } from '../db/sqljs-adapter'
import { SchedulerService } from '../services/scheduler'
import { listVariables } from '../services/variableResolver'

export function registerSchedulerHandlers(registrar: HandleRegistrar, db: SqlJsAdapter): void {
  let service: SchedulerService | null = null
  const svc = () => {
    if (!service) service = new SchedulerService(db as any)
    return service
  }

  registrar.handle('scheduler:list', async () => svc().list())

  registrar.handle('scheduler:get', async (_event, id: unknown) => {
    return svc().get(id as number)
  })

  registrar.handle('scheduler:create', async (_event, data: unknown) => {
    return svc().create(data as any)
  })

  registrar.handle('scheduler:update', async (_event, id: unknown, data: unknown) => {
    svc().update(id as number, data as any)
  })

  registrar.handle('scheduler:delete', async (_event, id: unknown) => {
    svc().delete(id as number)
  })

  registrar.handle('scheduler:toggle', async (_event, id: unknown, enabled: unknown) => {
    svc().toggle(id as number, enabled as boolean)
  })

  registrar.handle('scheduler:conversationTasks', async (_event, conversationId: unknown) => {
    return svc().conversationTasks(conversationId as number)
  })

  registrar.handle('scheduler:toggleBackground', async (_event, enabled: unknown) => {
    ;(db as any).prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('scheduler_background_enabled', ?, datetime('now'))")
      .run((enabled as boolean) ? 'true' : 'false')
    // Platform scheduler install/uninstall is Electron-only — not available headless
    return enabled as boolean
  })

  registrar.handle('scheduler:listVariables', async () => listVariables({}))

  registrar.handle('scheduler:backgroundStatus', async () => {
    const setting = (db as any).prepare("SELECT value FROM settings WHERE key = 'scheduler_background_enabled'")
      .get() as { value: string } | undefined
    const enabled = setting?.value === 'true'
    // Platform scheduler status check is Electron-only — report not installed in headless
    return { enabled, installed: false }
  })
}
