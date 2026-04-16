import { describe, it, expect, vi } from 'vitest'
import { builtinRegistry } from './builtins'
import type { ResolverCtx } from './types'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

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

describe('builtins — task context', () => {
  it('task_name returns ctx.task.name', () => {
    const fn = builtinRegistry.get('task_name')!.fn
    const ctx = makeCtx({ task: { ...makeCtx().task, name: 'Daily report' } as any })
    expect(fn([], ctx)).toBe('Daily report')
  })

  it('task_run_count returns run_count + 1 (1-indexed)', () => {
    const fn = builtinRegistry.get('task_run_count')!.fn
    const ctx = makeCtx({ task: { ...makeCtx().task, run_count: 5 } as any })
    expect(fn([], ctx)).toBe('6')
  })

  it('task_run_count returns 1 when run_count is 0', () => {
    const fn = builtinRegistry.get('task_run_count')!.fn
    expect(fn([], makeCtx())).toBe('1')
  })

  it('last_run_at returns empty string on first run', () => {
    const fn = builtinRegistry.get('last_run_at')!.fn
    expect(fn([], makeCtx())).toBe('')
  })

  it('last_run_at formats the previous run timestamp', () => {
    const fn = builtinRegistry.get('last_run_at')!.fn
    const ctx = makeCtx({
      task: { ...makeCtx().task, last_run_at: '2026-04-15T10:00:00.000Z' } as any,
    })
    expect(fn(['YYYY-MM-DD'], ctx)).toBe('2026-04-15')
  })

  it('last_run_at uses ISO date by default', () => {
    const fn = builtinRegistry.get('last_run_at')!.fn
    const ctx = makeCtx({
      task: { ...makeCtx().task, last_run_at: '2026-04-15T10:00:00.000Z' } as any,
    })
    expect(fn([], ctx)).toBe('2026-04-15')
  })
})

describe('builtins — async git/fs', () => {
  it('last_commit returns short hash and subject from git log in cwd', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'varres-git-'))
    try {
      execFileSync('git', ['init', '-q'], { cwd: repo })
      execFileSync('git', ['config', 'user.email', 't@t.test'], { cwd: repo })
      execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repo })
      writeFileSync(join(repo, 'a.txt'), 'hello')
      execFileSync('git', ['add', '.'], { cwd: repo })
      execFileSync('git', ['commit', '-q', '-m', 'initial commit'], { cwd: repo })

      const fn = builtinRegistry.get('last_commit')!.fn
      const out = await fn([], makeCtx({ cwd: repo }))
      expect(out).toMatch(/^[a-f0-9]{7,} initial commit$/)
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  }, 10000)

  it('file_contents reads a file relative to cwd', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'varres-fs-'))
    try {
      writeFileSync(join(dir, 'greeting.txt'), 'bonjour')
      const fn = builtinRegistry.get('file_contents')!.fn
      const out = await fn(['greeting.txt'], makeCtx({ cwd: dir }))
      expect(out).toBe('bonjour')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('file_contents accepts absolute paths', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'varres-fs-'))
    try {
      const abs = join(dir, 'abs.txt')
      writeFileSync(abs, 'absolute content')
      const fn = builtinRegistry.get('file_contents')!.fn
      const out = await fn([abs], makeCtx({ cwd: '/somewhere/else' }))
      expect(out).toBe('absolute content')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('file_contents throws when path arg is missing', async () => {
    const fn = builtinRegistry.get('file_contents')!.fn
    await expect(fn([], makeCtx())).rejects.toThrow(/chemin requis/)
  })
})
