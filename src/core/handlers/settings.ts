import type { HandleRegistrar } from '../dispatch'
import type { SqlJsAdapter } from '../db/sqljs-adapter'
import { SettingsService } from '../services/settings'

export function registerSettingsHandlers(registrar: HandleRegistrar, db: SqlJsAdapter): void {
  const service = new SettingsService(db as any)

  registrar.handle('settings:get', async () => {
    try {
      return service.getAll()
    } catch (err) {
      throw new Error(`Failed to get settings: ${(err as Error).message}`)
    }
  })

  registrar.handle('settings:set', async (_event, key: unknown, value: unknown) => {
    try {
      service.set(key as string, value as string)
    } catch (err) {
      throw new Error(`Failed to set setting: ${(err as Error).message}`)
    }
  })
}
