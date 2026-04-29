/**
 * Tests that clearConversation uses Date.now()-1 for cleared_at so that a user
 * message saved immediately after (with the same Date.now()) passes the strict
 * `created_at > cleared_at` filter in buildMessageHistory.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('electron', () => ({
  Notification: vi.fn().mockImplementation(() => ({ show: vi.fn() })),
  app: {
    getPath: vi.fn(() => '/tmp/test-agent'),
  },
}))

vi.mock('../index', () => ({
  getMainWindow: vi.fn(() => null),
}))

vi.mock('./streaming', () => ({
  streamMessage: vi.fn().mockResolvedValue({ content: '', toolCalls: [], aborted: false, sessionId: null }),
  injectApiKeyEnv: vi.fn(() => null),
  registerStreamWindow: vi.fn(),
}))

vi.mock('./tts', () => ({
  speak: vi.fn().mockResolvedValue(undefined),
}))

// NOTE: ./messages is NOT mocked here — we test the real buildMessageHistory
// and saveMessage so we can verify the ms-collision mitigation end-to-end.

import { createElectronContext } from './scheduler'
import { buildMessageHistory, saveMessage } from '../../core/handlers/messages'
import { createTestDb } from '../__tests__/db-helper'
import type { SqlJsAdapter } from '../../core/db/sqljs-adapter'

const FIXED_MS = new Date('2025-06-01T12:00:00.000Z').getTime()

describe('clearConversation ms-collision mitigation', () => {
  let db: SqlJsAdapter
  let convId: number

  beforeEach(async () => {
    db = await createTestDb()
    const result = db
      .prepare("INSERT INTO conversations (title, model, updated_at) VALUES ('Test Conv', 'claude-sonnet-4-6', datetime('now'))")
      .run()
    convId = result.lastInsertRowid as number
  })

  afterEach(() => {
    vi.useRealTimers()
    db.close()
  })

  it('user message saved at the same millisecond as clearConversation is visible in history', () => {
    // Freeze time so cleared_at and the message's created_at land on the same millisecond
    vi.useFakeTimers()
    vi.setSystemTime(FIXED_MS)

    const ctx = createElectronContext(db as any)

    // Act: clear, then immediately save user message — same frozen ms
    ctx.clearConversation(convId)
    saveMessage(db as any, convId, 'user', 'hello from the scheduled task')

    // Assert: buildMessageHistory must include the new user message
    const history = buildMessageHistory(db as any, convId)
    expect(history).toHaveLength(1)
    expect(history[0]).toEqual({ role: 'user', content: 'hello from the scheduled task' })
  })

  it('cleared_at is set 1ms before the frozen clock', () => {
    vi.useFakeTimers()
    vi.setSystemTime(FIXED_MS)

    const ctx = createElectronContext(db as any)
    ctx.clearConversation(convId)

    const row = db
      .prepare('SELECT cleared_at FROM conversations WHERE id = ?')
      .get(convId) as { cleared_at: string }

    const clearedAtMs = new Date(row.cleared_at).getTime()
    expect(clearedAtMs).toBe(FIXED_MS - 1)
  })
})
