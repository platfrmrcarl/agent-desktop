import { describe, it, expect, vi } from 'vitest'
import { builtinRegistry } from './builtins'
import type { ResolverCtx } from './types'

function makeCtx(overrides: Partial<ResolverCtx> = {}): ResolverCtx {
  return {
    task: {
      id: 1, name: 'test-task', prompt: '', conversation_id: 1,
      enabled: true, interval_value: 1, interval_unit: 'hours',
      schedule_time: null, catch_up: false, max_runs: null,
      last_run_at: null, next_run_at: null, last_status: null,
      last_error: null, run_count: 0, notify_desktop: false, notify_voice: false,
    } as any,
    cwd: '/tmp',
    db: {} as any,
    now: new Date('2026-04-16T12:34:56.000Z'),
    ...overrides,
  }
}

describe('builtins — date/time', () => {
  it('today_date returns ISO date by default', () => {
    const fn = builtinRegistry.get('today_date')!.fn
    expect(fn([], makeCtx())).toBe('2026-04-16')
  })

  it('today_date formats with DD/MM/YYYY', () => {
    const fn = builtinRegistry.get('today_date')!.fn
    expect(fn(['DD/MM/YYYY'], makeCtx())).toBe('16/04/2026')
  })

  it('today_date respects HH:mm:ss tokens', () => {
    const fn = builtinRegistry.get('today_date')!.fn
    const localNow = new Date(2026, 3, 16, 9, 5, 7)
    expect(fn(['HH:mm:ss'], makeCtx({ now: localNow }))).toBe('09:05:07')
  })

  it('now returns ISO string', () => {
    const fn = builtinRegistry.get('now')!.fn
    expect(fn([], makeCtx())).toBe('2026-04-16T12:34:56.000Z')
  })

  it('time returns local HH:mm', () => {
    const fn = builtinRegistry.get('time')!.fn
    const localNow = new Date(2026, 3, 16, 14, 30)
    expect(fn([], makeCtx({ now: localNow }))).toBe('14:30')
  })

  it('timestamp returns unix seconds', () => {
    const fn = builtinRegistry.get('timestamp')!.fn
    expect(fn([], makeCtx())).toBe(String(Math.floor(new Date('2026-04-16T12:34:56.000Z').getTime() / 1000)))
  })

  it('day_of_week returns French weekday', () => {
    const fn = builtinRegistry.get('day_of_week')!.fn
    const thu = new Date(2026, 3, 16)
    expect(fn([], makeCtx({ now: thu }))).toBe('jeudi')
  })
})

describe('builtins — random', () => {
  it('random returns integer in default range 0-100', () => {
    const fn = builtinRegistry.get('random')!.fn
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    expect(fn([], makeCtx())).toBe('50')
    vi.restoreAllMocks()
  })

  it('random respects custom min and max', () => {
    const fn = builtinRegistry.get('random')!.fn
    vi.spyOn(Math, 'random').mockReturnValue(0)
    expect(fn(['10', '20'], makeCtx())).toBe('10')
    vi.spyOn(Math, 'random').mockReturnValue(0.999999)
    expect(fn(['10', '20'], makeCtx())).toBe('20')
    vi.restoreAllMocks()
  })

  it('random throws on non-numeric args', () => {
    const fn = builtinRegistry.get('random')!.fn
    expect(() => fn(['abc', '10'], makeCtx())).toThrow(/args invalides/)
  })
})
