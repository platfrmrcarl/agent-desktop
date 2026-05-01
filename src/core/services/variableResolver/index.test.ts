import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveVariablesWithReport, listVariables } from './index'
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

describe('variable resolution — resolved string', () => {
  it('returns input unchanged when no variables are present', async () => {
    expect((await resolveVariablesWithReport('hello world', ctx())).resolved).toBe('hello world')
  })

  it('resolves a single builtin', async () => {
    expect((await resolveVariablesWithReport('today is {today_date}', ctx())).resolved)
      .toBe('today is 2026-04-16')
  })

  it('resolves multiple builtins in one prompt', async () => {
    const { resolved } = await resolveVariablesWithReport(
      'task {task_name} runs {task_run_count} times',
      ctx(),
    )
    expect(resolved).toBe('task T runs 1 times')
  })

  it('leaves unknown variables as passthrough (option D)', async () => {
    const { resolved } = await resolveVariablesWithReport(
      '{unknown_var} + {today_date}',
      ctx(),
      { functionsDir: dir },
    )
    expect(resolved).toBe('{unknown_var} + 2026-04-16')
  })

  it('replaces thrown errors with [erreur: ...] marker', async () => {
    const { resolved } = await resolveVariablesWithReport('x = {random:abc}', ctx())
    expect(resolved).toMatch(/^x = \[erreur: random — /)
  })

  it('replaces timeouts with [erreur: ... timeout ...] marker', async () => {
    writeFileSync(
      join(dir, 'slow.ts'),
      `export default () => new Promise((r) => setTimeout(() => r('never'), 1000))`
    )
    const { resolved } = await resolveVariablesWithReport('result: {slow}', ctx(), {
      functionsDir: dir,
      timeoutMs: 50,
    })
    expect(resolved).toMatch(/^result: \[erreur: slow — timeout 50ms\]$/)
  })

  it('resolves custom variables from functionsDir', async () => {
    writeFileSync(
      join(dir, 'hello.ts'),
      `export default (args: string[]) => 'hi ' + (args[0] ?? 'world')`
    )
    const { resolved } = await resolveVariablesWithReport(
      '{hello:laurent}',
      ctx(),
      { functionsDir: dir },
    )
    expect(resolved).toBe('hi laurent')
  })

  it('custom overrides builtin with the same name', async () => {
    writeFileSync(
      join(dir, 'today_date.ts'),
      `export default () => 'CUSTOM_DATE'`
    )
    const { resolved } = await resolveVariablesWithReport(
      '{today_date}',
      ctx(),
      { functionsDir: dir },
    )
    expect(resolved).toBe('CUSTOM_DATE')
  })

  it('resolves variables in parallel (runs concurrently)', async () => {
    writeFileSync(
      join(dir, 'slow1.ts'),
      `export default () => new Promise((r) => setTimeout(() => r('A'), 200))`
    )
    writeFileSync(
      join(dir, 'slow2.ts'),
      `export default () => new Promise((r) => setTimeout(() => r('B'), 200))`
    )
    const start = Date.now()
    const { resolved } = await resolveVariablesWithReport('{slow1}+{slow2}', ctx(), {
      functionsDir: dir,
      timeoutMs: 1000,
    })
    const duration = Date.now() - start
    expect(resolved).toBe('A+B')
    expect(duration).toBeLessThan(350)
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

  it('extracts description from JSDoc block of custom variable', async () => {
    writeFileSync(
      join(dir, 'weather.ts'),
      `/**
 * Fetches current weather for a given city.
 */
export default (args: string[]) => 'sunny'`
    )
    const list = await listVariables({ functionsDir: dir })
    const weather = list.find(v => v.name === 'weather')
    expect(weather?.description).toBe('Fetches current weather for a given city.')
  })

  it('extracts argsHint from @arg tags, joining with ":"', async () => {
    writeFileSync(
      join(dir, 'fetch.ts'),
      `/**
 * Does stuff.
 * @arg city - City name
 * @arg country - Country code
 */
export default () => ''`
    )
    const list = await listVariables({ functionsDir: dir })
    expect(list.find(v => v.name === 'fetch')?.argsHint).toBe('city:country')
  })

  it('marks [name] bracketed args as optional with "?" suffix', async () => {
    writeFileSync(
      join(dir, 'greet.ts'),
      `/**
 * Greets someone.
 * @arg name - required name
 * @arg [style] - optional style
 */
export default () => ''`
    )
    const list = await listVariables({ functionsDir: dir })
    expect(list.find(v => v.name === 'greet')?.argsHint).toBe('name:style?')
  })

  it('supports @param as alternative to @arg', async () => {
    writeFileSync(
      join(dir, 'legacy.ts'),
      `/**
 * Old-style.
 * @param {string} foo - foo
 * @param {string} [bar] - bar
 */
export default () => ''`
    )
    const list = await listVariables({ functionsDir: dir })
    expect(list.find(v => v.name === 'legacy')?.argsHint).toBe('foo:bar?')
  })

  it('falls back to "(custom function)" when no JSDoc present', async () => {
    writeFileSync(join(dir, 'bare.ts'), `export default () => ''`)
    const list = await listVariables({ functionsDir: dir })
    expect(list.find(v => v.name === 'bare')?.description).toBe('(custom function)')
  })

  it('collapses multi-line JSDoc description into single line', async () => {
    writeFileSync(
      join(dir, 'multi.ts'),
      `/**
 * Line one of description
 * continues on line two.
 */
export default () => ''`
    )
    const list = await listVariables({ functionsDir: dir })
    expect(list.find(v => v.name === 'multi')?.description)
      .toBe('Line one of description continues on line two.')
  })

  it('override of builtin uses custom JSDoc description, not builtin', async () => {
    writeFileSync(
      join(dir, 'today_date.ts'),
      `/**
 * My special today implementation.
 */
export default () => 'X'`
    )
    const list = await listVariables({ functionsDir: dir })
    const td = list.find(v => v.name === 'today_date')
    expect(td?.source).toBe('custom')
    expect(td?.description).toBe('My special today implementation.')
  })

  it('override without JSDoc falls back to builtin description', async () => {
    writeFileSync(join(dir, 'today_date.ts'), `export default () => ''`)
    const list = await listVariables({ functionsDir: dir })
    const td = list.find(v => v.name === 'today_date')
    expect(td?.source).toBe('custom')
    expect(td?.description).toMatch(/Date du jour/)
  })
})
