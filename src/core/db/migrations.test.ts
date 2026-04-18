import { describe, it, expect } from 'vitest'
import { initMemoryAdapter } from './sqljs-adapter'
import { createTables } from './schema'
import { runMigrations, stripClaudeDateSuffix } from './migrations'

async function createTestDb() {
  const db = await initMemoryAdapter()
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  createTables(db as any)
  return db
}

describe('stripClaudeDateSuffix', () => {
  it('strips trailing -YYYYMMDD from Claude IDs', () => {
    expect(stripClaudeDateSuffix('claude-sonnet-4-6-20250514')).toBe('claude-sonnet-4-6')
    expect(stripClaudeDateSuffix('claude-opus-4-7-20260101')).toBe('claude-opus-4-7')
    expect(stripClaudeDateSuffix('anthropic/claude-sonnet-4-6-20250514')).toBe('anthropic/claude-sonnet-4-6')
  })

  it('passes through Claude IDs without date suffix', () => {
    expect(stripClaudeDateSuffix('claude-sonnet-4-6')).toBe('claude-sonnet-4-6')
    expect(stripClaudeDateSuffix('claude-opus-4-7')).toBe('claude-opus-4-7')
  })

  it('does not touch non-Claude model IDs', () => {
    expect(stripClaudeDateSuffix('ollama/qwen3-coder-next:latest')).toBe('ollama/qwen3-coder-next:latest')
    expect(stripClaudeDateSuffix('gpt-4-20240101')).toBe('gpt-4-20240101')
    expect(stripClaudeDateSuffix('opus-4-7')).toBe('opus-4-7') // missing claude- prefix → untouched
  })

  it('returns non-string inputs unchanged', () => {
    expect(stripClaudeDateSuffix(null)).toBeNull()
    expect(stripClaudeDateSuffix(undefined)).toBeUndefined()
    expect(stripClaudeDateSuffix(42)).toBe(42)
  })
})

describe('runMigrations v3 — stale Claude model IDs', () => {
  it('normalizes ai_model and tts_summaryModel settings', async () => {
    const db = await createTestDb()
    db.prepare("INSERT INTO settings (key, value) VALUES ('ai_model', 'claude-sonnet-4-6-20250514')").run()
    db.prepare("INSERT INTO settings (key, value) VALUES ('tts_summaryModel', 'claude-opus-4-7-20260101')").run()

    runMigrations(db as any)

    const ai = db.prepare("SELECT value FROM settings WHERE key='ai_model'").get() as { value: string }
    const tts = db.prepare("SELECT value FROM settings WHERE key='tts_summaryModel'").get() as { value: string }
    expect(ai.value).toBe('claude-sonnet-4-6')
    expect(tts.value).toBe('claude-opus-4-7')
  })

  it('normalizes ai_customModels JSON array, leaving non-Claude entries untouched', async () => {
    const db = await createTestDb()
    db.prepare("INSERT INTO settings (key, value) VALUES ('ai_customModels', ?)").run(
      JSON.stringify(['claude-sonnet-4-6-20250514', 'ollama/qwen3:latest', 'opus-4-7'])
    )

    runMigrations(db as any)

    const r = db.prepare("SELECT value FROM settings WHERE key='ai_customModels'").get() as { value: string }
    expect(JSON.parse(r.value)).toEqual(['claude-sonnet-4-6', 'ollama/qwen3:latest', 'opus-4-7'])
  })

  it('normalizes conversation.model and ai_overrides.ai_model', async () => {
    const db = await createTestDb()
    db.prepare("INSERT INTO folders (id, name) VALUES (2, 'F')").run()
    db.prepare(
      "INSERT INTO conversations (id, title, folder_id, position, model, ai_overrides) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(
      1, 'Test', 2, 0, 'claude-opus-4-7-20260101',
      JSON.stringify({ ai_model: 'claude-sonnet-4-6-20250514', ai_maxTurns: 10 })
    )

    runMigrations(db as any)

    const c = db.prepare("SELECT model, ai_overrides FROM conversations WHERE id=1").get() as
      { model: string; ai_overrides: string }
    expect(c.model).toBe('claude-opus-4-7')
    expect(JSON.parse(c.ai_overrides)).toEqual({ ai_model: 'claude-sonnet-4-6', ai_maxTurns: 10 })
  })

  it('normalizes folder.ai_overrides.ai_model', async () => {
    const db = await createTestDb()
    db.prepare(
      "INSERT INTO folders (id, name, ai_overrides) VALUES (2, 'F', ?)"
    ).run(JSON.stringify({ ai_model: 'claude-opus-4-7-20260101' }))

    runMigrations(db as any)

    const f = db.prepare("SELECT ai_overrides FROM folders WHERE id=2").get() as { ai_overrides: string }
    expect(JSON.parse(f.ai_overrides).ai_model).toBe('claude-opus-4-7')
  })

  it('is idempotent — second run is a no-op once db_version is 3', async () => {
    const db = await createTestDb()
    db.prepare("INSERT INTO settings (key, value) VALUES ('ai_model', 'claude-sonnet-4-6-20250514')").run()

    runMigrations(db as any)
    runMigrations(db as any)

    const v = db.prepare("SELECT value FROM settings WHERE key='db_version'").get() as { value: string }
    expect(v.value).toBe('3')
    const ai = db.prepare("SELECT value FROM settings WHERE key='ai_model'").get() as { value: string }
    expect(ai.value).toBe('claude-sonnet-4-6')
  })

  it('handles malformed JSON in ai_overrides gracefully', async () => {
    const db = await createTestDb()
    db.prepare("INSERT INTO folders (id, name, ai_overrides) VALUES (2, 'F', ?)").run('{not json')

    expect(() => runMigrations(db as any)).not.toThrow()
  })
})
