import type { HandleRegistrar } from '../dispatch'
import type { SqlJsAdapter } from '../db/sqljs-adapter'
import { ShortcutsService } from '../services/shortcuts'

export function registerShortcutsHandlers(registrar: HandleRegistrar, db: SqlJsAdapter): void {
  const service = new ShortcutsService(db as any)

  registrar.handle('shortcuts:list', async () => {
    try {
      return service.list()
    } catch (err) {
      throw new Error(`Failed to list shortcuts: ${(err as Error).message}`)
    }
  })

  registrar.handle('shortcuts:update', async (_event, id: unknown, keybinding: unknown) => {
    try {
      service.update(id as number, keybinding as string)
    } catch (err) {
      throw new Error(`Failed to update shortcut: ${(err as Error).message}`)
    }
  })
}
