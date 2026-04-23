import type Database from 'better-sqlite3'

const CURRENT_VERSION = 4

export function runMigrations(db: Database.Database): void {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'db_version'").get() as
    | { value: string }
    | undefined

  const currentVersion = row ? parseInt(row.value, 10) : 0

  // Version 1: initial schema (already created by schema.ts)

  if (currentVersion < 2) {
    // Version 2: add max_runs to scheduled_tasks (replaces one_shot boolean)
    // Column addition + backfill handled in schema.ts runMigrations (idempotent ALTER TABLE)
  }

  if (currentVersion < 3) {
    // Version 3: strip stale -YYYYMMDD date suffixes from Claude model IDs.
    // Anthropic alias-style IDs (no date) keep working across releases; dated
    // snapshots get retired and the SDK CLI exits 1 with "model does not exist"
    // when called with a stale ID. Affects ai_model, tts_summaryModel,
    // ai_customModels, conversations.model, conversations.ai_overrides.ai_model,
    // folders.ai_overrides.ai_model.
    normalizeStaleClaudeModelIds(db)
  }

  if (currentVersion < 4) {
    // Version 4: add pi_session_file column to conversations table.
    // Column addition handled in schema.ts runMigrations (idempotent ALTER).
    // PI stores session state as JSONL under ~/.pi/agent/sessions/; this
    // column remembers which file to `SessionManager.open()` on resume.
  }

  if (currentVersion < CURRENT_VERSION) {
    db.prepare(
      "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('db_version', ?, datetime('now'))"
    ).run(String(CURRENT_VERSION))
  }
}

/** Strip trailing -YYYYMMDD from Claude model IDs only. Pass-through for other prefixes. */
export function stripClaudeDateSuffix(id: unknown): unknown {
  if (typeof id !== 'string') return id
  if (!id.startsWith('claude-') && !id.startsWith('anthropic/claude-')) return id
  return id.replace(/-(\d{8})$/, '')
}

function normalizeStaleClaudeModelIds(db: Database.Database): void {
  let changes = 0

  // Scalar settings
  for (const key of ['ai_model', 'tts_summaryModel'] as const) {
    const r = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
      | { value: string }
      | undefined
    if (!r) continue
    const next = stripClaudeDateSuffix(r.value) as string
    if (next !== r.value) {
      db.prepare("UPDATE settings SET value = ? WHERE key = ?").run(next, key)
      changes++
    }
  }

  // ai_customModels (JSON array of strings)
  const custom = db.prepare("SELECT value FROM settings WHERE key = 'ai_customModels'").get() as
    | { value: string }
    | undefined
  if (custom) {
    try {
      const arr = JSON.parse(custom.value)
      if (Array.isArray(arr)) {
        const next = arr.map(stripClaudeDateSuffix)
        if (JSON.stringify(next) !== custom.value) {
          db.prepare("UPDATE settings SET value = ? WHERE key = 'ai_customModels'").run(
            JSON.stringify(next)
          )
          changes++
        }
      }
    } catch { /* malformed JSON — leave alone */ }
  }

  // conversations.model (scalar) + conversations.ai_overrides.ai_model (JSON)
  const convs = db
    .prepare("SELECT id, model, ai_overrides FROM conversations")
    .all() as { id: number; model: string | null; ai_overrides: string | null }[]
  for (const c of convs) {
    if (c.model) {
      const next = stripClaudeDateSuffix(c.model) as string
      if (next !== c.model) {
        db.prepare("UPDATE conversations SET model = ? WHERE id = ?").run(next, c.id)
        changes++
      }
    }
    const updated = rewriteOverrideModel(c.ai_overrides)
    if (updated !== null) {
      db.prepare("UPDATE conversations SET ai_overrides = ? WHERE id = ?").run(updated, c.id)
      changes++
    }
  }

  // folders.ai_overrides.ai_model (JSON)
  const folders = db
    .prepare("SELECT id, ai_overrides FROM folders")
    .all() as { id: number; ai_overrides: string | null }[]
  for (const f of folders) {
    const updated = rewriteOverrideModel(f.ai_overrides)
    if (updated !== null) {
      db.prepare("UPDATE folders SET ai_overrides = ? WHERE id = ?").run(updated, f.id)
      changes++
    }
  }

  if (changes > 0) {
    console.log(`[migration v3] Normalized ${changes} stale Claude model ID(s).`)
  }
}

/** Returns the rewritten JSON when ai_model needed normalization, null when no change. */
function rewriteOverrideModel(raw: string | null): string | null {
  if (!raw) return null
  try {
    const obj = JSON.parse(raw)
    if (!obj || typeof obj !== 'object' || typeof obj.ai_model !== 'string') return null
    const next = stripClaudeDateSuffix(obj.ai_model) as string
    if (next === obj.ai_model) return null
    obj.ai_model = next
    return JSON.stringify(obj)
  } catch {
    return null
  }
}
