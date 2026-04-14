import { describe, it, expect } from 'vitest'
import { DispatchRegistry } from './dispatch'

describe('DispatchRegistry', () => {
  it('registers and retrieves a handler', async () => {
    const registry = new DispatchRegistry()
    registry.handle('test:echo', async (_event, msg: string) => `echo:${msg}`)

    const handler = registry.get('test:echo')
    expect(handler).toBeDefined()
    const result = await handler!('hello')
    expect(result).toBe('echo:hello')
  })

  it('returns undefined for unknown channels', () => {
    const registry = new DispatchRegistry()
    expect(registry.get('unknown')).toBeUndefined()
  })

  it('reports has() correctly', () => {
    const registry = new DispatchRegistry()
    registry.handle('test:exists', async () => {})
    expect(registry.has('test:exists')).toBe(true)
    expect(registry.has('test:missing')).toBe(false)
  })

  it('iterates all entries', () => {
    const registry = new DispatchRegistry()
    registry.handle('a:one', async () => 1)
    registry.handle('b:two', async () => 2)

    const channels = Array.from(registry.entries()).map(([ch]) => ch)
    expect(channels).toContain('a:one')
    expect(channels).toContain('b:two')
  })

  it('passes null as event to handlers', async () => {
    const registry = new DispatchRegistry()
    let receivedEvent: unknown = 'not-set'
    registry.handle('test:event', async (event) => { receivedEvent = event })

    await registry.get('test:event')!()
    expect(receivedEvent).toBeNull()
  })

  it('overwrites handler on duplicate channel', async () => {
    const registry = new DispatchRegistry()
    registry.handle('test:dup', async () => 'first')
    registry.handle('test:dup', async () => 'second')

    const result = await registry.get('test:dup')!()
    expect(result).toBe('second')
  })
})
