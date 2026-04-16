import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadCustomVariable, listCustomVariables, _resetCacheForTests } from './customLoader'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'varres-custom-'))
  _resetCacheForTests()
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('loadCustomVariable', () => {
  it('returns null when no .ts file exists for the name', async () => {
    const fn = await loadCustomVariable('nope', dir)
    expect(fn).toBeNull()
  })

  it('loads a sync default-exported function', async () => {
    writeFileSync(
      join(dir, 'greet.ts'),
      `export default (args: string[]) => 'hello ' + (args[0] ?? 'world')`
    )
    const fn = await loadCustomVariable('greet', dir)
    expect(fn).not.toBeNull()
    expect(await fn!(['laurent'], {} as any)).toBe('hello laurent')
  })

  it('loads an async default-exported function', async () => {
    writeFileSync(
      join(dir, 'async.ts'),
      `export default async (_args: string[]) => 'deferred'`
    )
    const fn = await loadCustomVariable('async', dir)
    expect(await fn!([], {} as any)).toBe('deferred')
  })

  it('rejects when export default is not a function', async () => {
    writeFileSync(join(dir, 'bad.ts'), `export default 42`)
    await expect(loadCustomVariable('bad', dir)).rejects.toThrow(/doit être une fonction/)
  })

  it('retranspile when mtime changes (hot-reload)', async () => {
    const file = join(dir, 'hot.ts')
    writeFileSync(file, `export default () => 'v1'`)
    const fn1 = await loadCustomVariable('hot', dir)
    expect(await fn1!([], {} as any)).toBe('v1')

    writeFileSync(file, `export default () => 'v2'`)
    const future = Date.now() / 1000 + 10
    utimesSync(file, future, future)

    const fn2 = await loadCustomVariable('hot', dir)
    expect(await fn2!([], {} as any)).toBe('v2')
  })

  it('serves from cache when mtime unchanged', async () => {
    const file = join(dir, 'cached.ts')
    writeFileSync(file, `export default () => 'cached'`)
    const fn1 = await loadCustomVariable('cached', dir)
    const fn2 = await loadCustomVariable('cached', dir)
    expect(fn1).toBe(fn2)
  })
})

describe('listCustomVariables', () => {
  it('returns empty array when directory does not exist', async () => {
    expect(await listCustomVariables(join(dir, 'missing'))).toEqual([])
  })

  it('returns basenames of .ts files (no extension)', async () => {
    writeFileSync(join(dir, 'weather.ts'), `export default () => ''`)
    writeFileSync(join(dir, 'holiday.ts'), `export default () => ''`)
    writeFileSync(join(dir, 'README.md'), `not a function`)
    const list = await listCustomVariables(dir)
    expect(list.sort()).toEqual(['holiday', 'weather'])
  })
})
