import { describe, it, expect, vi } from 'vitest'

// safeJsonParse migrated from console.warn → structured log.warn in Phase 4.B.
// Mock the logger so the warn-on-failure assertions still observe it.
const mockLog = vi.hoisted(() => ({
  trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn(),
}))
mockLog.child.mockReturnValue(mockLog)
vi.mock('../../core/utils/logger', () => ({
  createLogger: () => mockLog,
}))

import { safeJsonParse } from './json'

describe('safeJsonParse', () => {
  it('parses valid JSON', () => {
    expect(safeJsonParse('{"a":1}', {})).toEqual({ a: 1 })
  })

  it('parses valid JSON array', () => {
    expect(safeJsonParse('["a","b"]', [])).toEqual(['a', 'b'])
  })

  it('returns fallback for null', () => {
    expect(safeJsonParse(null, { default: true })).toEqual({ default: true })
  })

  it('returns fallback for undefined', () => {
    expect(safeJsonParse(undefined, 'fallback')).toBe('fallback')
  })

  it('returns fallback for empty string', () => {
    expect(safeJsonParse('', [])).toEqual([])
  })

  it('returns fallback for invalid JSON', () => {
    mockLog.warn.mockClear()
    expect(safeJsonParse('{invalid', {})).toEqual({})
    expect(mockLog.warn).toHaveBeenCalledOnce()
  })

  it('logs truncated content on parse failure', () => {
    mockLog.warn.mockClear()
    // First 100 chars 'a' followed by 100 chars 'b' so the slices are distinguishable
    const longInvalid = 'a'.repeat(100) + 'b'.repeat(100)
    safeJsonParse(longInvalid, null)
    expect(mockLog.warn).toHaveBeenCalled()
    const [, ctx] = mockLog.warn.mock.calls[0]
    expect(typeof ctx).toBe('object')
    const ctxStr = JSON.stringify(ctx)
    // First 100 ('a') must be in the preview
    expect(ctxStr).toContain('a'.repeat(100))
    // Second 100 ('b') must be truncated out
    expect(ctxStr).not.toContain('b'.repeat(100))
  })

  it('preserves generic type', () => {
    const result = safeJsonParse<string[]>('["hello"]', [])
    expect(result).toEqual(['hello'])
  })
})
