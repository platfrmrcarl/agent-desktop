import type { HandleRegistrar } from '../dispatch'
import { ThemesService } from '../services/themes'

export function registerThemesHandlers(registrar: HandleRegistrar, themesDir: string): void {
  const service = new ThemesService(themesDir)

  registrar.handle('themes:list', async () => service.list())

  registrar.handle('themes:read', async (_event, filename: unknown) => {
    return service.read(filename as string)
  })

  registrar.handle('themes:create', async (_event, filename: unknown, css: unknown) => {
    return service.create(filename as string, css as string)
  })

  registrar.handle('themes:save', async (_event, filename: unknown, css: unknown) => {
    return service.save(filename as string, css as string)
  })

  registrar.handle('themes:delete', async (_event, filename: unknown) => {
    return service.delete(filename as string)
  })

  registrar.handle('themes:getDir', async () => service.getDir())

  registrar.handle('themes:refresh', async () => service.list())
}
