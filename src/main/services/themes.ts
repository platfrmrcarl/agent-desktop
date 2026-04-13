import type { IpcMain } from 'electron'
import { app } from 'electron'
import { join } from 'path'
import { ThemesService } from '../../core/services/themes'

const THEMES_DIR = join(app.getPath('home'), '.agent-desktop', 'themes')
const service = new ThemesService(THEMES_DIR)

export async function ensureThemeDir(): Promise<void> {
  return service.ensureDir()
}

export function registerHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('themes:list', () => service.list())
  ipcMain.handle('themes:read', (_e, filename: string) => service.read(filename))
  ipcMain.handle('themes:create', (_e, filename: string, css: string) => service.create(filename, css))
  ipcMain.handle('themes:save', (_e, filename: string, css: string) => service.save(filename, css))
  ipcMain.handle('themes:delete', (_e, filename: string) => service.delete(filename))
  ipcMain.handle('themes:getDir', () => service.getDir())
  ipcMain.handle('themes:refresh', () => service.list())
}
