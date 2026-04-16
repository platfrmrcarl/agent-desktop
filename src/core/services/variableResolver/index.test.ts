import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveVariables, resolveVariablesWithReport, listVariables } from './index'
import { _resetCacheForTests } from './customLoader'
import type { ResolverCtx } from './types'

function ctx(overrides: Partial<ResolverCtx> = {}): ResolverCtx {
  return {
    task: {
      id: 1, name: 'T', prompt: '', conversation_id: 1,
      enabled: true, interval_value: 1, interval_unit: 'hours',
      schedule_time: null, catch_up: false, max_runs: null,
      last_run_at: null, next_run_at: null, last_status: null,
      last_error: null, run_count: 0, notify_desktop: false, notify_voice: false,
    } as any,
    cwd: '/tmp',
    db: {} as any,
    now: new Date('2026-04-16T12:00:00.000Z'),
    ...overrides,
  }
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'varres-index-'))
  _resetCacheForTests()
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('resolveVariables', () => {
  it('returns input unchanged when no variables are present', async () => {
    expect(await resolveVariables('hello world', ctx())).toBe('hello world')
  })

  it('resolves a single builtin', async () => {
    expect(await resolveVariables('today is {today_date}', ctx())).toBe('today is 2026-04-16')
  })

  it('resolves multiple builtins in one prompt', async () => {
    const out = await resolveVariables('task {task_name} runs {task_run_count} times', ctx())
    expect(out).toBe('task T runs 1 times')
  })

  it('leaves unknown variables as passthrough (option D)', async () => {
    const out = await resolveVariables('{unknown_var} + {today_date}', ctx(), { functionsDir: dir })
    expect(out).toBe('{unknown_var} + 2026-04-16')
  })

  it('replaces thrown errors with [erreur: ...] marker', async () => {
    const out = await resolveVariables('x = {random:abc}', ctx())
    expect(out).toMatch(/^x = \[erreur: random — /)
  })

  it('replaces timeouts with [erreur: ... timeout ...] marker', async () => {
    writeFileSync(
      join(dir, 'slow.ts'),
      `export default () => new Promise((r) => setTimeout(() => r('never'), 1000))`
    )
    const out = await resolveVariables('result: {slow}', ctx(), {
      functionsDir: dir,
      timeoutMs: 50,
    })
    expect(out).toMatch(/^result: \[erreur: slow — timeout 50ms\]$/)
  })

  it('resolves custom variables from functionsDir', async () => {
    writeFileSync(
      join(dir, 'hello.ts'),
      `export default (args: string[]) => 'hi ' + (args[0] ?? 'world')`
    )
    const out = await resolveVariables('{hello:laurent}', ctx(), { functionsDir: dir })
    expect(out).toBe('hi laurent')
  })

  it('custom overrides builtin with the same name', async () => {
    writeFileSync(
      join(dir, 'today_date.ts'),
      `export default () => 'CUSTOM_DATE'`
    )
    const out = await resolveVariables('{today_date}', ctx(), { functionsDir: dir })
    expect(out).toBe('CUSTOM_DATE')
  })

  it('resolves variables in parallel (runs concurrently)', async () => {
    writeFileSync(
      join(dir, 'slow1.ts'),
      `export default () => new Promise((r) => setTimeout(() => r('A'), 80))`
    )
    writeFileSync(
      join(dir, 'slow2.ts'),
      `export default () => new Promise((r) => setTimeout(() => r('B'), 80))`
    )
    const start = Date.now()
    const out = await resolveVariables('{slow1}+{slow2}', ctx(), {
      functionsDir: dir,
      timeoutMs: 500,
    })
    const duration = Date.now() - start
    expect(out).toBe('A+B')
    expect(duration).toBeLessThan(200)
  })
})

describe('resolveVariablesWithReport', () => {
  it('reports unknown variables with reason "unknown"', async () => {
    const report = await resolveVariablesWithReport('{nope}', ctx(), { functionsDir: dir })
    expect(report.resolved).toBe('{nope}')
    expect(report.errors).toHaveLength(1)
    expect(report.errors[0]).toMatchObject({ variable: 'nope', reason: 'unknown' })
  })

  it('reports throws with reason "throw"', async () => {
    const report = await resolveVariablesWithReport('{random:nope}', ctx())
    expect(report.errors[0]).toMatchObject({ variable: 'random', reason: 'throw' })
  })

  it('has empty errors array on clean resolution', async () => {
    const report = await resolveVariablesWithReport('{today_date}', ctx())
    expect(report.errors).toEqual([])
  })
})

describe('listVariables', () => {
  it('includes all builtins', async () => {
    const list = await listVariables({ functionsDir: dir })
    const names = list.map(v => v.name)
    expect(names).toContain('today_date')
    expect(names).toContain('task_name')
    expect(names).toContain('previous_output')
  })

  it('marks custom overrides of builtins as source: custom', async () => {
    writeFileSync(join(dir, 'today_date.ts'), `export default () => ''`)
    const list = await listVariables({ functionsDir: dir })
    const td = list.find(v => v.name === 'today_date')
    expect(td?.source).toBe('custom')
  })

  it('includes custom-only variables', async () => {
    writeFileSync(join(dir, 'weather.ts'), `export default () => ''`)
    const list = await listVariables({ functionsDir: dir })
    expect(list.find(v => v.name === 'weather')?.source).toBe('custom')
  })
})
