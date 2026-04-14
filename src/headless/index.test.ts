import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { AgentEngine, noopPlatformIO, noopSystemUI, noopHookRunner } from '../core'
import type { Broadcaster } from '../core'

describe('headless engine with dispatch', () => {
  let engine: AgentEngine
  const dbPath = join(tmpdir(), `agent-headless-test-${Date.now()}.db`)
  const themesDir = join(tmpdir(), `agent-themes-test-${Date.now()}`)

  beforeAll(async () => {
    const broadcaster: Broadcaster = { broadcast: () => {} }
    engine = new AgentEngine({
      dbPath,
      themesDir,
      broadcaster,
      platformIO: noopPlatformIO,
      systemUI: noopSystemUI,
      hookRunner: noopHookRunner,
    })
    await engine.init()
  })

  afterAll(async () => {
    await engine.shutdown()
  })

  it('dispatch is populated after init', () => {
    expect(engine.dispatch.has('settings:get')).toBe(true)
    expect(engine.dispatch.has('settings:set')).toBe(true)
    expect(engine.dispatch.has('folders:list')).toBe(true)
    expect(engine.dispatch.has('conversations:list')).toBe(true)
    expect(engine.dispatch.has('messages:send')).toBe(true)
  })

  it('settings:get returns object via dispatch', async () => {
    const handler = engine.dispatch.get('settings:get')!
    const result = await handler()
    expect(result).toBeDefined()
    expect(typeof result).toBe('object')
  })

  it('settings:set + get round-trip via dispatch', async () => {
    const set = engine.dispatch.get('settings:set')!
    const get = engine.dispatch.get('settings:get')!
    await set('theme', 'dark-test')
    const all = await get() as Record<string, string>
    expect(all['theme']).toBe('dark-test')
  })
})
