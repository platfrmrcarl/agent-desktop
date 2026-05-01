import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createRateLimiter } from './rateLimiter'

describe('RateLimiter', () => {
  beforeEach(() => { vi.useFakeTimers({ now: 1_000_000 }) })
  afterEach(() => { vi.useRealTimers() })

  it('allows first attempt', () => {
    const rl = createRateLimiter()
    expect(rl.check('1.2.3.4')).toEqual({ allowed: true })
  })

  it('allows 5 failures then bans on the 6th', () => {
    const rl = createRateLimiter()
    for (let i = 0; i < 5; i++) {
      expect(rl.check('1.2.3.4').allowed).toBe(true)
      rl.recordAttempt('1.2.3.4', false)
    }
    const r = rl.check('1.2.3.4')
    expect(r.allowed).toBe(false)
    if (!r.allowed) expect(r.retryAfterSeconds).toBeGreaterThan(0)
  })

  it('success resets the counter', () => {
    const rl = createRateLimiter()
    for (let i = 0; i < 4; i++) rl.recordAttempt('1.2.3.4', false)
    rl.recordAttempt('1.2.3.4', true)
    for (let i = 0; i < 5; i++) {
      expect(rl.check('1.2.3.4').allowed).toBe(true)
      rl.recordAttempt('1.2.3.4', false)
    }
  })

  it('ban expires after 60s window', () => {
    const rl = createRateLimiter()
    for (let i = 0; i < 6; i++) rl.recordAttempt('1.2.3.4', false)
    expect(rl.check('1.2.3.4').allowed).toBe(false)
    vi.advanceTimersByTime(61_000)
    expect(rl.check('1.2.3.4').allowed).toBe(true)
  })

  it('long ban after 20 failures lasts 15 minutes', () => {
    const rl = createRateLimiter()
    for (let i = 0; i < 20; i++) rl.recordAttempt('1.2.3.4', false)
    expect(rl.check('1.2.3.4').allowed).toBe(false)
    vi.advanceTimersByTime(14 * 60 * 1000)
    expect(rl.check('1.2.3.4').allowed).toBe(false)
    vi.advanceTimersByTime(2 * 60 * 1000)
    expect(rl.check('1.2.3.4').allowed).toBe(true)
  })

  it('tracks IPs independently', () => {
    const rl = createRateLimiter()
    for (let i = 0; i < 6; i++) rl.recordAttempt('1.2.3.4', false)
    expect(rl.check('1.2.3.4').allowed).toBe(false)
    expect(rl.check('5.6.7.8').allowed).toBe(true)
  })

  it('normalizes IPv6-mapped before tracking', () => {
    const rl = createRateLimiter()
    for (let i = 0; i < 6; i++) rl.recordAttempt('::ffff:1.2.3.4', false)
    expect(rl.check('1.2.3.4').allowed).toBe(false)
  })
})
