import fs from 'fs'
import { initAdapter, SqlJsAdapter } from './sqljs-adapter'
import { createTables } from './schema'
import { runMigrations } from './migrations'
import { seedDefaults } from './seed'
import { createLogger } from '../utils/logger'

const log = createLogger('database')

let db: SqlJsAdapter | null = null

/**
 * Initialize the database singleton.
 * @param dbPath Absolute path to the .db file
 * @param wasmPath Optional path to sql-wasm.wasm (for packaged Electron apps)
 */
export async function initDatabase(dbPath: string, wasmPath?: string): Promise<void> {
  if (db) return

  try {
    db = await initAdapter(dbPath, wasmPath)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    createTables(db as any)
    runMigrations(db as any)
    seedDefaults(db as any)
  } catch (err) {
    // Backup corrupted DB, recreate from scratch
    const backupPath = dbPath + '.corrupt.' + Date.now()
    try { fs.renameSync(dbPath, backupPath) } catch {}
    db = await initAdapter(dbPath, wasmPath)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    createTables(db as any)
    seedDefaults(db as any)
    log.error('Recreated after corruption', undefined, { backupPath })
  }
}

export function getDatabase(): SqlJsAdapter {
  if (!db) throw new Error('Database not initialized — call initDatabase() first')
  return db
}

export function closeDatabase(): void {
  if (db) {
    db.flush()
    db.close()
    db = null
  }
}
