import { describe, it, expect, vi, beforeEach } from 'vitest'
import { addBroadcastHandler, setBroadcastHandler, broadcast } from './broadcast'

describe('broadcast', () => {
  beforeEach(() => {
    setBroadcastHandler(null as any) // clears all handlers
  })

  it('is no-op without handler', () => {
    broadcast('test:channel', { data: 1 })
  })

  it('calls handler when set', () => {
    const handler = vi.fn()
    setBroadcastHandler(handler)
    broadcast('test:channel', { data: 1 }, 'extra')
    expect(handler).toHaveBeenCalledWith('test:channel', { data: 1 }, 'extra')
  })

  it('replaces previous handler via setBroadcastHandler', () => {
    const handler1 = vi.fn()
    const handler2 = vi.fn()
    setBroadcastHandler(handler1)
    setBroadcastHandler(handler2)
    broadcast('ch', 42)
    expect(handler1).not.toHaveBeenCalled()
    expect(handler2).toHaveBeenCalledWith('ch', 42)
  })

  it('supports multiple handlers via addBroadcastHandler', () => {
    const h1 = vi.fn()
    const h2 = vi.fn()
    addBroadcastHandler(h1)
    addBroadcastHandler(h2)
    broadcast('ch', 'data')
    expect(h1).toHaveBeenCalledWith('ch', 'data')
    expect(h2).toHaveBeenCalledWith('ch', 'data')
  })

  it('returns unsubscribe function from addBroadcastHandler', () => {
    const h1 = vi.fn()
    const h2 = vi.fn()
    const unsub1 = addBroadcastHandler(h1)
    addBroadcastHandler(h2)

    unsub1()
    broadcast('ch', 99)

    expect(h1).not.toHaveBeenCalled()
    expect(h2).toHaveBeenCalledWith('ch', 99)
  })

  it('setBroadcastHandler clears addBroadcastHandler handlers', () => {
    const added = vi.fn()
    const set = vi.fn()
    addBroadcastHandler(added)
    setBroadcastHandler(set) // should clear added
    broadcast('ch', 1)
    expect(added).not.toHaveBeenCalled()
    expect(set).toHaveBeenCalledWith('ch', 1)
  })
})
