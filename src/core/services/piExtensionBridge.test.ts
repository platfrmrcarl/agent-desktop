import { describe, it, expect, vi } from 'vitest'
import { createBridge } from './piExtensionBridge'

describe('createBridge.emitSystemMessage', () => {
  it('calls chunkSender with system_message type and conversationId', () => {
    const chunkSender = vi.fn()
    const bridge = createBridge(42, { chunkSender })
    bridge.emitSystemMessage('hello world')
    expect(chunkSender).toHaveBeenCalledWith(
      'system_message',
      'hello world',
      { conversationId: 42 },
    )
  })

  it('forwards hookName and hookEvent in extra', () => {
    const chunkSender = vi.fn()
    const bridge = createBridge(42, { chunkSender })
    bridge.emitSystemMessage('blocked!', { hookName: 'cwd-guard', hookEvent: 'PreToolUse' })
    expect(chunkSender).toHaveBeenCalledWith(
      'system_message',
      'blocked!',
      { conversationId: 42, hookName: 'cwd-guard', hookEvent: 'PreToolUse' },
    )
  })

  it('omits undefined meta fields', () => {
    const chunkSender = vi.fn()
    const bridge = createBridge(42, { chunkSender })
    bridge.emitSystemMessage('plain')
    const [, , extra] = chunkSender.mock.calls[0]
    expect(extra).not.toHaveProperty('hookName')
    expect(extra).not.toHaveProperty('hookEvent')
  })
})
