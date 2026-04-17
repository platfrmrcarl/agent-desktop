import { describe, it, expect } from 'vitest'
import { parseDbTimestamp } from './dbTime'

describe('parseDbTimestamp', () => {
  it('treats SQLite datetime output as UTC', () => {
    expect(parseDbTimestamp('2026-04-17 14:30:00').toISOString()).toBe('2026-04-17T14:30:00.000Z')
  })

  it('preserves ISO strings with Z', () => {
    expect(parseDbTimestamp('2026-04-17T14:30:00.123Z').toISOString()).toBe('2026-04-17T14:30:00.123Z')
  })

  it('preserves ISO strings with numeric offset', () => {
    expect(parseDbTimestamp('2026-04-17T16:30:00+02:00').toISOString()).toBe('2026-04-17T14:30:00.000Z')
  })

  it('handles SQLite datetime with fractional seconds', () => {
    expect(parseDbTimestamp('2026-04-17 14:30:00.500').toISOString()).toBe('2026-04-17T14:30:00.500Z')
  })
})
