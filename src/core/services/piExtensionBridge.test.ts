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

describe('createBridge.emitTaskNotification', () => {
  it('sends a task_notification chunk with summary and meta', () => {
    const chunkSender = vi.fn()
    const bridge = createBridge(42, { chunkSender })
    bridge.emitTaskNotification('Task done', { taskId: 't1', status: 'completed', outputFile: '/tmp/out' })
    expect(chunkSender).toHaveBeenCalledWith(
      'task_notification',
      'Task done',
      { conversationId: 42, taskId: 't1', status: 'completed', outputFile: '/tmp/out' },
    )
  })

  it('works without meta', () => {
    const chunkSender = vi.fn()
    const bridge = createBridge(42, { chunkSender })
    bridge.emitTaskNotification('just a summary')
    expect(chunkSender).toHaveBeenCalledWith('task_notification', 'just a summary', { conversationId: 42 })
  })
})

describe('createBridge.emitMcpStatus', () => {
  it('sends mcp_status chunk with JSON-stringified server list', () => {
    const chunkSender = vi.fn()
    const bridge = createBridge(42, { chunkSender })
    bridge.emitMcpStatus([{ name: 'local', status: 'connected' }])
    expect(chunkSender).toHaveBeenCalledWith(
      'mcp_status',
      undefined,
      { conversationId: 42, mcpServers: JSON.stringify([{ name: 'local', status: 'connected' }]) },
    )
  })
})
