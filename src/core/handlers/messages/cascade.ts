// Settings cascade: Conversation > Folder > Global.
//
// `null`/`{}`/empty-string at any level falls through to the next level.
// Used by both `getSystemPrompt` (per-key string lookups) and
// `getAISettings` (whole-map merge) to honor the cascade documented in
// CLAUDE.md > "Settings cascade".

import type { SqlJsAdapter } from '../../db/sqljs-adapter'
import { safeJsonParse } from '../../utils/json'

export interface ConversationCascadeRow {
  folder_id: number | null
  ai_overrides: string | null
}

export function getFolderOverrides(db: SqlJsAdapter, folderId: number): Record<string, string> {
  const row = (db as any)
    .prepare('SELECT ai_overrides FROM folders WHERE id = ?')
    .get(folderId) as { ai_overrides: string | null } | undefined
  return row?.ai_overrides ? safeJsonParse<Record<string, string>>(row.ai_overrides, {}) : {}
}

/**
 * Cascade a single string key Conversation > Folder > Global. Returns
 * `undefined` when no level has a non-empty value.
 *
 * `convOverrides` is the already-parsed conversation override map (callers
 * that fetched the conversation row pass it through to avoid re-parsing).
 */
export function cascadeStringKey(
  db: SqlJsAdapter,
  key: string,
  convOverrides: Record<string, string> | null,
  folderId: number | null,
): string | undefined {
  if (convOverrides && convOverrides[key]) return convOverrides[key]
  if (folderId) {
    const folderOv = getFolderOverrides(db, folderId)
    if (folderOv[key]) return folderOv[key]
  }
  const globalRow = (db as any)
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(key) as { value: string } | undefined
  return globalRow?.value || undefined
}

/**
 * Apply Folder then Conversation overrides on top of a global settings map.
 * Empty strings and `undefined` are treated as inherited (skip).
 */
export function applyCascadeOnto(
  map: Record<string, string>,
  db: SqlJsAdapter,
  folderId: number | null,
  convOverridesRaw: string | null,
): void {
  if (folderId) {
    const folderOverrides = getFolderOverrides(db, folderId)
    for (const [k, v] of Object.entries(folderOverrides)) {
      if (v !== undefined && v !== '') map[k] = v
    }
  }
  if (convOverridesRaw) {
    const convOverrides = safeJsonParse<Record<string, string>>(convOverridesRaw, {})
    for (const [k, v] of Object.entries(convOverrides)) {
      if (v !== undefined && v !== '') map[k] = v
    }
  }
}

export function parseConvOverrides(raw: string | null | undefined): Record<string, string> {
  return raw ? safeJsonParse<Record<string, string>>(raw, {}) : {}
}
