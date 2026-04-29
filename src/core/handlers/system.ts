import type { HandleRegistrar } from '../dispatch'
import type { SqlJsAdapter } from '../db/sqljs-adapter'
import { countConversations } from '../db/queries'

// ─── Log buffer ─────────────────────────────────────────────

interface LogEntry {
  level: 'info' | 'warn' | 'error'
  message: string
  timestamp: string
  details?: string
}

const LOG_BUFFER_MAX = 500
const logBuffer: LogEntry[] = []

export function log(level: LogEntry['level'], message: string, details?: string): void {
  logBuffer.push({ level, message, timestamp: new Date().toISOString(), details })
  if (logBuffer.length > LOG_BUFFER_MAX) {
    logBuffer.shift()
  }
}

// ─── Handler registration ───────────────────────────────────

export function registerSystemHandlers(registrar: HandleRegistrar, db: SqlJsAdapter): void {
  registrar.handle('system:getLogs', async (_event, limit?: unknown) => {
    if (limit !== undefined && (typeof limit !== 'number' || limit < 0)) {
      throw new Error('Invalid limit parameter')
    }
    const maxEntries = Math.min((limit as number) ?? 100, 1000)
    return logBuffer.slice(-maxEntries)
  })

  registrar.handle('system:clearCache', async () => {
    logBuffer.length = 0
  })

  registrar.handle('system:purgeConversations', async () => {
    const d = db as any
    const purge = d.transaction(() => {
      const convCount = countConversations(db)
      const folderCount = (d.prepare('SELECT COUNT(*) as c FROM folders').get() as { c: number }).c
      d.exec('DELETE FROM conversations')
      d.exec('DELETE FROM folders')
      return { conversations: convCount, folders: folderCount }
    })
    return purge()
  })

  registrar.handle('system:purgeAll', async () => {
    const d = db as any
    const purge = d.transaction(() => {
      const convCount = countConversations(db)
      d.exec('DELETE FROM conversations')
      d.exec('DELETE FROM folders')
      d.exec('DELETE FROM knowledge_files')
      d.exec('DELETE FROM mcp_servers')
      d.exec('DELETE FROM keyboard_shortcuts')
      return { conversations: convCount }
    })
    return purge()
  })
}
