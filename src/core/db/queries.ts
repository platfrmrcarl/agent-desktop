import type { SqlJsAdapter } from './sqljs-adapter'
import { getSetting } from '../utils/db'

/** Returns the id of the default folder, or null if none exists (should not happen in normal operation). */
export function getDefaultFolderId(db: SqlJsAdapter): number | null {
  const row = (db as any).prepare('SELECT id FROM folders WHERE is_default = 1').get() as { id: number } | undefined
  return row?.id ?? null
}

/** Returns true if a conversation with the given id exists. */
export function conversationExists(db: SqlJsAdapter, id: number): boolean {
  return (db as any).prepare('SELECT 1 FROM conversations WHERE id = ?').get(id) !== undefined
}

/** Returns the total number of conversations. */
export function countConversations(db: SqlJsAdapter): number {
  const row = (db as any).prepare('SELECT COUNT(*) as c FROM conversations').get() as { c: number }
  return row.c
}

/** Returns true if the background scheduler mode is enabled. */
export function getBackgroundSchedulerEnabled(db: SqlJsAdapter): boolean {
  return getSetting(db as any, 'scheduler_background_enabled') === 'true'
}

/** Returns the globally configured default AI model, or null if unset. */
export function getDefaultModel(db: SqlJsAdapter): string | null {
  return getSetting(db as any, 'ai_model') || null
}
