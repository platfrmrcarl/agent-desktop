import type { IpcMain } from 'electron'
import type Database from 'better-sqlite3'
import { app, dialog, shell, Notification, BrowserWindow } from 'electron'
import { getSessionType } from '../utils/env'

export { log } from '../../core/handlers/system'

export function registerHandlers(ipcMain: IpcMain, _db: Database.Database): void {
  ipcMain.handle('system:getInfo', async () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    platform: process.platform,
    dbPath: app.getPath('userData'),
    configPath: app.getPath('userData'),
    sessionType: getSessionType(),
  }))

  ipcMain.handle('system:openExternal', async (_event, url: string) => {
    // Validate URL and restrict to safe protocols
    if (typeof url !== 'string') {
      throw new Error('Invalid URL')
    }
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw new Error('Invalid URL format')
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`Blocked protocol: ${parsed.protocol}`)
    }
    await shell.openExternal(url)
  })

  ipcMain.handle(
    'system:showNotification',
    async (_event, title: string, body: string) => {
      // Validate notification parameters
      if (typeof title !== 'string' || typeof body !== 'string') {
        throw new Error('Notification title and body must be strings')
      }
      if (title.length > 500 || body.length > 500) {
        throw new Error('Notification title or body exceeds maximum length (500 chars)')
      }
      new Notification({ title, body }).show()
    }
  )

  ipcMain.handle('system:selectFolder', async (event) => {
    // Parent window makes the dialog sheet-modal on Linux/macOS so input events
    // don't leak to the renderer and trigger click-outside handlers on popovers.
    const parent = event?.sender ? BrowserWindow.fromWebContents(event.sender) : null
    const options = {
      properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'>,
      title: 'Select working directory',
    }
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('system:selectFile', async (event) => {
    const parent = event?.sender ? BrowserWindow.fromWebContents(event.sender) : null
    const options = {
      properties: ['openFile'] as Array<'openFile'>,
      title: 'Select file',
    }
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })
}
