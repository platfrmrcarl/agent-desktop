import { describe, it, expect, vi, beforeEach } from 'vitest'
import { initBudgetTracker } from './index'
import type { ExtensionRuntimeContext, PiExtensionBridge } from '../../../../core/services/piExtensionBridge'
import type { AISettings } from '../../../../core/services/streaming'

type AnyEvent = Record<string, unknown>

function makeMockPi() {
  const handlers: Record<string, Array<(event: AnyEvent) => unknown>> = {}
  return {
    on(eventName: string, handler: (event: AnyEvent) => unknown) {
      ;(handlers[eventName] ||= []).push(handler)
    },
    async fire(eventName: string, event: AnyEvent) {
      const results: unknown[] = []
      for (const h of handlers[eventName] ?? []) results.push(await h(event))
      return results
    },
    handlers,
  }
}

function makeBridge(): PiExtensionBridge & {
  emitSystemMessage: ReturnType<typeof vi.fn>
  recordTokenUsage: ReturnType<typeof vi.fn>
} {
  return {
    emitSystemMessage: vi.fn(),
    emitTaskNotification: vi.fn(),
    emitMcpStatus: vi.fn(),
    recordTokenUsage: vi.fn(),
    getAccumulatedUsage: vi.fn(() => ({ totalTokens: 0, totalCostUsd: 0 })),
  }
}

function makeCtx(maxBudgetUsd: number | undefined, existingStore?: Map<string, unknown>): ExtensionRuntimeContext {
  return {
    version: 1,
    conversationId: 42,
    aiSettings: { maxBudgetUsd } as AISettings,
    db: null,
    bridge: makeBridge(),
    sessionStore: existingStore ?? new Map<string, unknown>(),
  }
}

function assistantMessageWithCost(totalCostUsd: number) {
  return {
    role: 'assistant',
    content: [],
    usage: {
      input: 100,
      output: 50,
      cacheRead: 10,
      cacheWrite: 5,
      totalTokens: 165,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: totalCostUsd },
    },
  }
}

describe('budgetTracker', () => {
  beforeEach(() => {})

  it('is a no-op when maxBudgetUsd is undefined', () => {
    const pi = makeMockPi()
    initBudgetTracker(pi as never, makeCtx(undefined))
    expect(pi.handlers['message_end']).toBeUndefined()
    expect(pi.handlers['tool_call']).toBeUndefined()
  })

  it('is a no-op when maxBudgetUsd is 0', () => {
    const pi = makeMockPi()
    initBudgetTracker(pi as never, makeCtx(0))
    expect(pi.handlers['message_end']).toBeUndefined()
    expect(pi.handlers['tool_call']).toBeUndefined()
  })

  it('registers message_end and tool_call handlers when cap is set', () => {
    const pi = makeMockPi()
    initBudgetTracker(pi as never, makeCtx(1.0))
    expect(pi.handlers['message_end']).toHaveLength(1)
    expect(pi.handlers['tool_call']).toHaveLength(1)
  })

  it('accumulates cost from assistant message_end into sessionStore', async () => {
    const pi = makeMockPi()
    const ctx = makeCtx(1.0)
    initBudgetTracker(pi as never, ctx)
    await pi.fire('message_end', { message: assistantMessageWithCost(0.03) })
    await pi.fire('message_end', { message: assistantMessageWithCost(0.07) })
    expect(ctx.sessionStore.get('budgetTracker.accumulatedCostUsd')).toBeCloseTo(0.10, 6)
  })

  it('feeds the bridge.recordTokenUsage for per-turn accounting', async () => {
    const pi = makeMockPi()
    const ctx = makeCtx(1.0)
    initBudgetTracker(pi as never, ctx)
    await pi.fire('message_end', { message: assistantMessageWithCost(0.05) })
    const bridge = ctx.bridge as ReturnType<typeof makeBridge>
    expect(bridge.recordTokenUsage).toHaveBeenCalledWith({
      input: 100, output: 50, cacheRead: 10, cacheWrite: 5, costUsd: 0.05,
    })
  })

  it('ignores user and toolResult messages', async () => {
    const pi = makeMockPi()
    const ctx = makeCtx(1.0)
    initBudgetTracker(pi as never, ctx)
    await pi.fire('message_end', { message: { role: 'user', content: 'hi' } })
    await pi.fire('message_end', { message: { role: 'toolResult', toolCallId: 'x', toolName: 'w', content: [] } })
    expect(ctx.sessionStore.get('budgetTracker.accumulatedCostUsd')).toBeUndefined()
    const bridge = ctx.bridge as ReturnType<typeof makeBridge>
    expect(bridge.recordTokenUsage).not.toHaveBeenCalled()
  })

  it('ignores assistant message with missing usage gracefully', async () => {
    const pi = makeMockPi()
    const ctx = makeCtx(1.0)
    initBudgetTracker(pi as never, ctx)
    await pi.fire('message_end', { message: { role: 'assistant', content: [] } })
    expect(ctx.sessionStore.get('budgetTracker.accumulatedCostUsd')).toBeUndefined()
  })

  it('tool_call allows when accumulated cost is under cap', async () => {
    const pi = makeMockPi()
    const ctx = makeCtx(1.0)
    initBudgetTracker(pi as never, ctx)
    await pi.fire('message_end', { message: assistantMessageWithCost(0.5) })
    const [result] = await pi.fire('tool_call', { toolName: 'write', input: {} })
    expect(result).toBeUndefined()
  })

  it('tool_call blocks exactly at the cap', async () => {
    const pi = makeMockPi()
    const ctx = makeCtx(1.0)
    initBudgetTracker(pi as never, ctx)
    await pi.fire('message_end', { message: assistantMessageWithCost(1.0) })
    const [result] = await pi.fire('tool_call', { toolName: 'write', input: {} })
    expect(result).toMatchObject({ block: true, reason: expect.stringContaining('Budget') })
  })

  it('tool_call blocks when accumulated cost exceeds cap', async () => {
    const pi = makeMockPi()
    const ctx = makeCtx(1.0)
    initBudgetTracker(pi as never, ctx)
    await pi.fire('message_end', { message: assistantMessageWithCost(1.5) })
    const [result] = await pi.fire('tool_call', { toolName: 'bash', input: {} })
    expect(result).toMatchObject({ block: true })
    const bridge = ctx.bridge as ReturnType<typeof makeBridge>
    expect(bridge.emitSystemMessage).toHaveBeenCalledWith(
      expect.stringMatching(/Budget.*1\.00/),
      expect.objectContaining({ hookName: 'budget-tracker', hookEvent: 'PreToolUse' }),
    )
  })

  it('accumulator persists across re-init via sessionStore (cross-turn enforcement)', async () => {
    const store = new Map<string, unknown>()
    const pi1 = makeMockPi()
    initBudgetTracker(pi1 as never, makeCtx(1.0, store))
    await pi1.fire('message_end', { message: assistantMessageWithCost(0.6) })

    const pi2 = makeMockPi()
    const ctx2 = makeCtx(1.0, store)
    initBudgetTracker(pi2 as never, ctx2)
    await pi2.fire('message_end', { message: assistantMessageWithCost(0.5) })
    const [result] = await pi2.fire('tool_call', { toolName: 'write', input: {} })
    expect(result).toMatchObject({ block: true })
  })

  it('emits system_message with accumulated-cost detail when blocking', async () => {
    const pi = makeMockPi()
    const ctx = makeCtx(0.5)
    initBudgetTracker(pi as never, ctx)
    await pi.fire('message_end', { message: assistantMessageWithCost(0.75) })
    await pi.fire('tool_call', { toolName: 'edit', input: {} })
    const bridge = ctx.bridge as ReturnType<typeof makeBridge>
    const [msg] = bridge.emitSystemMessage.mock.calls[0]
    expect(msg).toMatch(/0\.75/)
    expect(msg).toMatch(/0\.50/)
  })
})
