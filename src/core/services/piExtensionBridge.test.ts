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

describe('createBridge.recordTokenUsage / getAccumulatedUsage', () => {
  it('accumulates input + output + cacheRead + cacheWrite', () => {
    const bridge = createBridge(42, { chunkSender: vi.fn() })
    bridge.recordTokenUsage({ input: 100, output: 50, cacheRead: 1000, cacheWrite: 10 })
    expect(bridge.getAccumulatedUsage()).toEqual({ totalTokens: 1160, totalCostUsd: 0 })
  })

  it('accumulates cost across multiple calls', () => {
    const bridge = createBridge(42, { chunkSender: vi.fn() })
    bridge.recordTokenUsage({ input: 10, costUsd: 0.001 })
    bridge.recordTokenUsage({ input: 20, costUsd: 0.002 })
    const { totalTokens, totalCostUsd } = bridge.getAccumulatedUsage()
    expect(totalTokens).toBe(30)
    expect(totalCostUsd).toBeCloseTo(0.003, 6)
  })

  it('treats missing fields as zero', () => {
    const bridge = createBridge(42, { chunkSender: vi.fn() })
    bridge.recordTokenUsage({})
    expect(bridge.getAccumulatedUsage()).toEqual({ totalTokens: 0, totalCostUsd: 0 })
  })

  it('each bridge instance has its own accumulator', () => {
    const bridgeA = createBridge(1, { chunkSender: vi.fn() })
    const bridgeB = createBridge(2, { chunkSender: vi.fn() })
    bridgeA.recordTokenUsage({ input: 100, costUsd: 0.5 })
    bridgeB.recordTokenUsage({ input: 200, costUsd: 1.0 })
    expect(bridgeA.getAccumulatedUsage()).toEqual({ totalTokens: 100, totalCostUsd: 0.5 })
    expect(bridgeB.getAccumulatedUsage()).toEqual({ totalTokens: 200, totalCostUsd: 1.0 })
  })
})

describe('createBridge.requestPlanApproval', () => {
  it('emits a tool_approval chunk with toolName=ExitPlanMode and the plan as toolInput.plan', async () => {
    const chunkSender = vi.fn()
    const registerPending = vi.fn()
    const bridge = createBridge(42, { chunkSender, registerPending })
    void bridge.requestPlanApproval('# My plan')
    expect(chunkSender).toHaveBeenCalledWith(
      'tool_approval',
      undefined,
      expect.objectContaining({
        conversationId: 42,
        toolName: 'ExitPlanMode',
        toolInput: JSON.stringify({ plan: '# My plan' }),
      }),
    )
    expect(registerPending).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Function),
      42,
    )
  })

  it('resolves with { approved: true } when registerPending resolver is called with behavior=allow', async () => {
    const chunkSender = vi.fn()
    let resolver: ((v: unknown) => void) | null = null
    const registerPending = vi.fn((_id, resolve) => { resolver = resolve })
    const bridge = createBridge(42, { chunkSender, registerPending })
    const promise = bridge.requestPlanApproval('plan')
    resolver!({ behavior: 'allow' })
    const result = await promise
    expect(result).toEqual({ approved: true })
  })

  it('resolves with { approved: false, rejectReason } when resolver is called with behavior=deny + message', async () => {
    const chunkSender = vi.fn()
    let resolver: ((v: unknown) => void) | null = null
    const registerPending = vi.fn((_id, resolve) => { resolver = resolve })
    const bridge = createBridge(42, { chunkSender, registerPending })
    const promise = bridge.requestPlanApproval('plan')
    resolver!({ behavior: 'deny', message: 'missing tests' })
    const result = await promise
    expect(result).toEqual({ approved: false, rejectReason: 'missing tests' })
  })

  it('fails safe (rejected) when registerPending is not injected', async () => {
    const bridge = createBridge(42, { chunkSender: vi.fn() })
    const result = await bridge.requestPlanApproval('plan')
    expect(result.approved).toBe(false)
  })
})

describe('createBridge.updateConversationSetting', () => {
  it('invokes the injected writer with bound conversationId and key/value patch', async () => {
    const { setConversationOverridesWriter } = await import('./streaming')
    const writer = vi.fn()
    setConversationOverridesWriter(writer)
    const bridge = createBridge(42, { chunkSender: vi.fn() })
    bridge.updateConversationSetting('ai_permissionMode', 'bypassPermissions')
    expect(writer).toHaveBeenCalledWith(42, { ai_permissionMode: 'bypassPermissions' })
  })

  it('is a no-op when the writer is not injected (e.g. headless tests)', async () => {
    const { setConversationOverridesWriter } = await import('./streaming')
    setConversationOverridesWriter(null as never)
    const bridge = createBridge(42, { chunkSender: vi.fn() })
    // Should not throw — logs a warning and returns.
    expect(() => bridge.updateConversationSetting('k', 'v')).not.toThrow()
  })
})
