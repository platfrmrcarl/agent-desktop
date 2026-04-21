import { describe, it, expect, vi, beforeEach } from 'vitest'
import { initHooksSystem } from './index'
import type { ExtensionRuntimeContext, PiExtensionBridge } from '../../../../core/services/piExtensionBridge'
import type { AISettings } from '../../../../core/services/streaming'

// Mock the core hookRunner — we validate THIS module's wiring, not the runner.
vi.mock('../../../../core/services/hooks/hookRunner', () => ({
  runHooks: vi.fn(async () => []),
}))
import { runHooks } from '../../../../core/services/hooks/hookRunner'
const mockRunHooks = vi.mocked(runHooks)

type AnyEvent = Record<string, unknown>

function makeMockPi() {
  const handlers: Record<string, Array<(event: AnyEvent, extCtx?: unknown) => unknown>> = {}
  return {
    on(eventName: string, handler: (event: AnyEvent, extCtx?: unknown) => unknown) {
      ;(handlers[eventName] ||= []).push(handler)
    },
    async fire(eventName: string, event: AnyEvent, extCtx?: unknown) {
      const results: unknown[] = []
      for (const h of handlers[eventName] ?? []) results.push(await h(event, extCtx))
      return results
    },
    handlers,
  }
}

function makeBridge(): PiExtensionBridge & { emitSystemMessage: ReturnType<typeof vi.fn> } {
  return {
    emitSystemMessage: vi.fn(),
    emitTaskNotification: vi.fn(),
    emitMcpStatus: vi.fn(),
    recordTokenUsage: vi.fn(),
    getAccumulatedUsage: vi.fn(() => ({ totalTokens: 0, totalCostUsd: 0 })),
  }
}

function makeCtx(extras: Partial<AISettings> = {}): ExtensionRuntimeContext {
  return {
    version: 1,
    conversationId: 42,
    aiSettings: { cwd: '/project', sharedHooks: true, ...extras } as AISettings,
    db: null,
    bridge: makeBridge(),
    sessionStore: new Map<string, unknown>(),
  }
}

describe('hooksSystem', () => {
  beforeEach(() => {
    mockRunHooks.mockReset()
    mockRunHooks.mockResolvedValue([])
  })

  it('registers handlers for all 5 PI events', () => {
    const pi = makeMockPi()
    initHooksSystem(pi as never, makeCtx())
    for (const evt of ['input', 'tool_call', 'tool_result', 'session_start', 'agent_end']) {
      expect(pi.handlers[evt], `no handler on ${evt}`).toHaveLength(1)
    }
  })

  it('UserPromptSubmit: emits systemMessage from hook output', async () => {
    mockRunHooks.mockResolvedValueOnce([{ content: 'context!', hookEvent: 'UserPromptSubmit' }])
    const pi = makeMockPi()
    const ctx = makeCtx()
    initHooksSystem(pi as never, ctx)
    await pi.fire('input', { text: 'hello' })
    expect(mockRunHooks).toHaveBeenCalledWith('UserPromptSubmit', { prompt: 'hello' }, expect.objectContaining({ cwd: '/project' }))
    expect((ctx.bridge as ReturnType<typeof makeBridge>).emitSystemMessage).toHaveBeenCalledWith(
      'context!',
      expect.objectContaining({ hookName: 'UserPromptSubmit', hookEvent: 'UserPromptSubmit' }),
    )
  })

  it('PreToolUse: block from hook decision=deny', async () => {
    mockRunHooks.mockResolvedValueOnce([
      { content: '', hookEvent: 'PreToolUse', decision: 'deny', reason: 'forbidden' },
    ])
    const pi = makeMockPi()
    const ctx = makeCtx()
    initHooksSystem(pi as never, ctx)
    const [result] = await pi.fire('tool_call', { toolName: 'write', input: { path: '/x' } })
    expect(result).toMatchObject({ block: true, reason: 'forbidden' })
  })

  it('PreToolUse: no deny + systemMessage → emits and allows', async () => {
    mockRunHooks.mockResolvedValueOnce([{ content: 'caution', hookEvent: 'PreToolUse' }])
    const pi = makeMockPi()
    const ctx = makeCtx()
    initHooksSystem(pi as never, ctx)
    const [result] = await pi.fire('tool_call', { toolName: 'write', input: { path: '/x' } })
    expect(result).toBeUndefined()
    expect((ctx.bridge as ReturnType<typeof makeBridge>).emitSystemMessage).toHaveBeenCalledWith(
      'caution',
      expect.objectContaining({ hookEvent: 'PreToolUse' }),
    )
  })

  it('PostToolUse: emits only, never blocks', async () => {
    mockRunHooks.mockResolvedValueOnce([{ content: 'after', hookEvent: 'PostToolUse' }])
    const pi = makeMockPi()
    const ctx = makeCtx()
    initHooksSystem(pi as never, ctx)
    const [result] = await pi.fire('tool_result', { toolName: 'write', result: 'ok' })
    expect(result).toBeUndefined()
    expect((ctx.bridge as ReturnType<typeof makeBridge>).emitSystemMessage).toHaveBeenCalledWith(
      'after',
      expect.objectContaining({ hookEvent: 'PostToolUse' }),
    )
  })

  it('SessionStart: fires once per turn', async () => {
    mockRunHooks.mockResolvedValueOnce([])
    const pi = makeMockPi()
    initHooksSystem(pi as never, makeCtx())
    await pi.fire('session_start', { reason: 'startup' })
    expect(mockRunHooks).toHaveBeenCalledWith('SessionStart', expect.any(Object), expect.any(Object))
  })

  it('Stop: emits any systemMessages', async () => {
    mockRunHooks.mockResolvedValueOnce([{ content: 'bye', hookEvent: 'Stop' }])
    const pi = makeMockPi()
    const ctx = makeCtx()
    initHooksSystem(pi as never, ctx)
    await pi.fire('agent_end', {})
    expect((ctx.bridge as ReturnType<typeof makeBridge>).emitSystemMessage).toHaveBeenCalledWith(
      'bye',
      expect.objectContaining({ hookEvent: 'Stop' }),
    )
  })

  it('webhook: fires fetch on agent_end when webhookCompletionUrl is set', async () => {
    const originalFetch = globalThis.fetch
    const fetchMock = vi.fn(async () => new Response('', { status: 200 }))
    globalThis.fetch = fetchMock as typeof fetch
    try {
      const pi = makeMockPi()
      initHooksSystem(pi as never, makeCtx({ webhookCompletionUrl: 'https://example.test/hook' }))
      await pi.fire('agent_end', {})
      expect(fetchMock).toHaveBeenCalledWith(
        'https://example.test/hook',
        expect.objectContaining({ method: 'POST' }),
      )
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('webhook: swallows fetch errors silently', async () => {
    const originalFetch = globalThis.fetch
    const fetchMock = vi.fn(async () => { throw new Error('network down') })
    globalThis.fetch = fetchMock as typeof fetch
    try {
      const pi = makeMockPi()
      initHooksSystem(pi as never, makeCtx({ webhookCompletionUrl: 'https://example.test/hook' }))
      await expect(pi.fire('agent_end', {})).resolves.toBeDefined()
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('uses ~/.agent-desktop/hooks.json when sharedHooks is false', async () => {
    const pi = makeMockPi()
    initHooksSystem(pi as never, makeCtx({ sharedHooks: false }))
    await pi.fire('input', { text: 'hi' })
    const [, , opts] = mockRunHooks.mock.calls[0]
    expect((opts as { settingsPath?: string }).settingsPath).toMatch(/\.agent-desktop[/\\]hooks\.json$/)
  })
})
