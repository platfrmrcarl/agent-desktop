import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ErrorBuffer, type ErrorEntry } from './errorBuffer'

function entry(overrides: Partial<ErrorEntry> = {}): ErrorEntry {
  return {
    timestamp: '2026-04-18T10:00:00.000Z',
    source: 'main',
    level: 'error',
    message: 'boom',
    ...overrides,
  }
}

describe('ErrorBuffer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-18T10:00:00.000Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('stores pushed entries in FIFO order', () => {
    const buf = new ErrorBuffer()
    buf.push(entry({ message: 'a' }))
    buf.push(entry({ message: 'b' }))
    expect(buf.getAll().map((e) => e.message)).toEqual(['a', 'b'])
  })

  it('drops oldest entries when count > 50', () => {
    const buf = new ErrorBuffer()
    for (let i = 0; i < 55; i++) buf.push(entry({ message: String(i) }))
    const all = buf.getAll()
    expect(all).toHaveLength(50)
    expect(all[0].message).toBe('5')
    expect(all[49].message).toBe('54')
  })

  it('drops oldest entries when total size > 10KB', () => {
    const buf = new ErrorBuffer()
    const big = 'x'.repeat(2000)
    for (let i = 0; i < 10; i++) buf.push(entry({ message: big + i }))
    const total = buf.getAll().reduce((n, e) => n + e.message.length, 0)
    expect(total).toBeLessThanOrEqual(10_000)
  })

  it('evicts entries older than 60 min on push', () => {
    const buf = new ErrorBuffer()
    buf.push(entry({ timestamp: '2026-04-18T08:59:00.000Z', message: 'old' }))
    vi.setSystemTime(new Date('2026-04-18T10:00:00.000Z'))
    buf.push(entry({ timestamp: '2026-04-18T10:00:00.000Z', message: 'new' }))
    expect(buf.getAll().map((e) => e.message)).toEqual(['new'])
  })

  it('evicts entries older than 60 min on getAll', () => {
    const buf = new ErrorBuffer()
    vi.setSystemTime(new Date('2026-04-18T09:00:00.000Z'))
    buf.push(entry({ timestamp: '2026-04-18T09:00:00.000Z', message: 'a' }))
    vi.setSystemTime(new Date('2026-04-18T10:30:00.000Z'))
    expect(buf.getAll()).toHaveLength(0)
  })

  it('keeps entry exactly at TTL boundary', () => {
    const buf = new ErrorBuffer()
    vi.setSystemTime(new Date('2026-04-18T10:00:00.000Z'))
    // Exactly 60 min ago — boundary kept
    buf.push(entry({ timestamp: '2026-04-18T09:00:00.000Z', message: 'boundary' }))
    expect(buf.getAll().map((e) => e.message)).toEqual(['boundary'])
  })

  it('evicts entry 1ms past TTL boundary', () => {
    const buf = new ErrorBuffer()
    vi.setSystemTime(new Date('2026-04-18T10:00:00.000Z'))
    // 60 min + 1 ms ago — just past boundary, dropped
    buf.push(entry({ timestamp: '2026-04-18T08:59:59.999Z', message: 'past' }))
    expect(buf.getAll()).toEqual([])
  })

  it('notifies onPush listeners', () => {
    const buf = new ErrorBuffer()
    const cb = vi.fn()
    buf.onPush(cb)
    buf.push(entry())
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('unsubscribes onPush listeners', () => {
    const buf = new ErrorBuffer()
    const cb = vi.fn()
    const unsub = buf.onPush(cb)
    unsub()
    buf.push(entry())
    expect(cb).not.toHaveBeenCalled()
  })

  it('clear() empties the buffer', () => {
    const buf = new ErrorBuffer()
    buf.push(entry())
    buf.clear()
    expect(buf.getAll()).toEqual([])
  })
})
