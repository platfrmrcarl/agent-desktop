import { describe, it, expect, beforeEach } from 'vitest'
import { buildContextBreakdown } from './contextBreakdown'
import { createTestDb } from '../../main/__tests__/db-helper'
import { createTables } from '../db/schema'

async function seedConversation(db: Awaited<ReturnType<typeof createTestDb>>, overrides: Record<string, unknown> = {}) {
  const cols = {
    title: 'Test',
    model: 'claude-opus-4-7',
    last_input_tokens: null,
    last_output_tokens: null,
    last_cache_read_tokens: null,
    last_cache_creation_tokens: null,
    last_context_window: null,
    compact_summary: null,
    cleared_at: null,
    ...overrides,
  }
  const stmt = db.prepare(`INSERT INTO conversations (
    title, model, last_input_tokens, last_output_tokens,
    last_cache_read_tokens, last_cache_creation_tokens, last_context_window,
    compact_summary, cleared_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`)
  const result = stmt.run(
    cols.title, cols.model,
    cols.last_input_tokens, cols.last_output_tokens,
    cols.last_cache_read_tokens, cols.last_cache_creation_tokens, cols.last_context_window,
    cols.compact_summary, cols.cleared_at
  )
  return Number(result.lastInsertRowid)
}

describe('buildContextBreakdown', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>

  beforeEach(async () => {
    db = await createTestDb()
    createTables(db as never)
  })

  it('returns a pre-first-turn breakdown when no SDK usage has been persisted yet', async () => {
    const id = await seedConversation(db)
    const result = buildContextBreakdown({
      db: db as never,
      conversationId: id,
      systemPrompt: 'You are a helpful assistant.',
      mode: 'local',
    })
    expect(result.preFirstTurn).toBe(true)
    expect(result.totalIsExact).toBe(false)
    // Tools & SDK overhead is unknown before the first turn
    const overhead = result.categories.find((c) => c.label === 'Tools & SDK overhead')
    expect(overhead?.tokens).toBeNull()
    // Opus 4.7 is 1M natively per static table
    expect(result.window).toBe(1_000_000)
    // Autocompact buffer is ~3% of window
    expect(result.autocompactBuffer).toBe(30_000)
  })

  it('uses the SDK-reported total once a turn has completed', async () => {
    const id = await seedConversation(db, {
      last_input_tokens: 10,
      last_cache_read_tokens: 50_000,
      last_cache_creation_tokens: 20_000,
      last_context_window: 1_000_000,
    })
    const result = buildContextBreakdown({
      db: db as never,
      conversationId: id,
      systemPrompt: 'System prompt content.',
      mode: 'local',
    })
    expect(result.preFirstTurn).toBe(false)
    expect(result.total).toBe(70_010) // 10 + 50k + 20k
    // Overhead is derived: SDK total minus what we counted locally
    const overhead = result.categories.find((c) => c.label === 'Tools & SDK overhead')
    expect(overhead?.tokens).not.toBeNull()
    expect(overhead!.tokens!).toBeGreaterThan(60_000)
  })

  it('respects totalOverride when mode is anthropic', async () => {
    const id = await seedConversation(db, {
      last_input_tokens: 10,
      last_cache_read_tokens: 50_000,
      last_cache_creation_tokens: 20_000,
    })
    const result = buildContextBreakdown({
      db: db as never,
      conversationId: id,
      systemPrompt: 'sp',
      mode: 'anthropic',
      totalOverride: 75_000,
    })
    expect(result.total).toBe(75_000)
    expect(result.totalIsExact).toBe(true)
    expect(result.mode).toBe('anthropic')
  })

  it('falls back to an empty breakdown for a missing conversation', () => {
    const result = buildContextBreakdown({
      db: db as never,
      conversationId: 999_999,
      systemPrompt: '',
      mode: 'local',
    })
    expect(result.total).toBe(0)
    expect(result.categories).toEqual([])
  })

  it('includes a compact summary category when one is present', async () => {
    const id = await seedConversation(db, {
      compact_summary: 'Previous turns summarized here.',
      last_input_tokens: 5,
      last_cache_read_tokens: 0,
      last_cache_creation_tokens: 0,
    })
    const result = buildContextBreakdown({
      db: db as never,
      conversationId: id,
      systemPrompt: 'sp',
      mode: 'local',
    })
    const summary = result.categories.find((c) => c.label === 'Compact summary')
    expect(summary).toBeDefined()
    expect(summary!.tokens).toBeGreaterThan(0)
  })
})
