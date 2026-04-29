import type { IpcMain } from 'electron'
import type Database from 'better-sqlite3'
import { promises as fsp } from 'fs'
import { join, extname } from 'path'
import os from 'os'
import { shell } from 'electron'
import { validateString, validatePathSafe, checkWriteAllowed, validatePathSafeAsync } from '../utils/validate'
import { expandTilde } from '../utils/paths'
import { getSetting } from '../../core/utils/db'

export { mimeToExt } from '../utils/mime'

// Extensions that can execute arbitrary code via the OS default handler.
// Refused in files:openWithDefault and files:revealInFileManager.
const EXECUTABLE_EXTENSIONS: ReadonlySet<string> = new Set([
  // Linux executables / launchers
  'sh', 'bash', 'zsh', 'desktop', 'appimage', 'run',
  // Windows executables / launchers
  'exe', 'bat', 'cmd', 'com', 'ps1', 'vbs', 'scr', 'pif', 'msi', 'lnk',
  // Cross-platform interpreted scripts
  'jar', 'py', 'rb', 'pl',
])

export function classifyFileExt(ext: string): string | null {
  switch (ext) {
    case 'html': case 'htm': return 'html'
    case 'svg': return 'svg'
    case 'css': return 'css'
    case 'js': case 'jsx': return 'javascript'
    case 'ts': case 'tsx': return 'typescript'
    case 'json': return 'json'
    case 'md': case 'markdown': return 'markdown'
    case 'py': return 'python'
    case 'rs': return 'rust'
    case 'go': return 'go'
    case 'sh': case 'bash': return 'bash'
    case 'yml': case 'yaml': return 'yaml'
    case 'toml': return 'toml'
    case 'sql': return 'sql'
    case 'xml': return 'xml'
    case 'scad': return 'scad'
    default: return ext || null
  }
}

export async function cleanupPastedFiles(): Promise<void> {
  const tmpDir = join(os.tmpdir(), 'agent-paste')
  try {
    const files = await fsp.readdir(tmpDir)
    const cutoff = Date.now() - 24 * 60 * 60 * 1000 // 24h
    for (const file of files) {
      const filePath = join(tmpDir, file)
      try {
        const stats = await fsp.stat(filePath)
        if (stats.mtimeMs < cutoff) await fsp.unlink(filePath)
      } catch { /* ignore per-file errors */ }
    }
  } catch { /* dir may not exist yet */ }
}

/** Read the global hooks_cwdWhitelist setting from the database. */
function getGlobalWhitelist(db: Database.Database): Array<{ path: string; access: 'read' | 'readwrite' }> {
  try {
    const value = getSetting(db, 'hooks_cwdWhitelist')
    if (!value) return []
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function registerHandlers(ipcMain: IpcMain, db: Database.Database): void {
  // files:listTree, files:listDir, files:readFile, files:rename, files:duplicate,
  // files:writeFile, files:move, files:createFile, files:createFolder,
  // files:savePastedFile, files:prepareSession, files:openTerminalHere
  // are all registered via core/handlers/files.ts (engine.dispatch).
  // main's ipc.ts withSanitizedErrors skips ipcMain.handle for channels already
  // in engine.dispatch, so registering them here would be dead at runtime.

  ipcMain.handle('files:revealInFileManager', async (_event, filePath: string) => {
    validateString(filePath, 'filePath')
    const resolved = expandTilde(filePath)
    validatePathSafe(resolved)
    const realResolved = await validatePathSafeAsync(resolved)
    const ext = extname(realResolved).slice(1).toLowerCase()
    if (EXECUTABLE_EXTENSIONS.has(ext)) {
      throw new Error(`Refused to reveal: .${ext} files are blocked for security`)
    }
    shell.showItemInFolder(realResolved)
  })

  ipcMain.handle('files:openWithDefault', async (_event, filePath: string) => {
    validateString(filePath, 'filePath')
    const resolved = expandTilde(filePath)
    validatePathSafe(resolved)
    const realResolved = await validatePathSafeAsync(resolved)
    const ext = extname(realResolved).slice(1).toLowerCase()
    if (EXECUTABLE_EXTENSIONS.has(ext)) {
      throw new Error(`Refused to open: .${ext} files are blocked for security`)
    }
    if (process.platform === 'linux') {
      const stat = await fsp.stat(realResolved)
      if ((stat.mode & 0o111) !== 0) {
        throw new Error(`Refused to open: file has executable permissions`)
      }
    }
    const result = await shell.openPath(realResolved)
    if (result) throw new Error(result)
  })

  ipcMain.handle('files:trash', async (_event, filePath: string) => {
    validateString(filePath, 'filePath')
    const resolved = expandTilde(filePath)
    validatePathSafe(resolved)
    const realResolved = await validatePathSafeAsync(resolved)
    const whitelist = getGlobalWhitelist(db)
    const outsideWrite = checkWriteAllowed(realResolved, whitelist)
    if (outsideWrite) throw new Error(`Write access denied: ${outsideWrite} is outside the allowed readwrite directories`)
    await shell.trashItem(realResolved)
  })
}
