import { describe, it, expect, vi, beforeEach } from 'vitest'
import { initCwdGuard } from './index'
import type { ExtensionRuntimeContext, PiExtensionBridge } from '../../../../core/services/piExtensionBridge'
import type { AISettings } from '../../../../core/services/streaming'

type ToolCallEvent = { toolName: string; input: Record<string, unknown> }

function makeMockPi() {
  const handlers: Record<string, Array<(event: ToolCallEvent) => unknown>> = {}
  return {
    on(eventName: string, handler: (event: ToolCallEvent) => unknown) {
      ;(handlers[eventName] ||= []).push(handler)
    },
    async fireToolCall(event: ToolCallEvent) {
      const results: unknown[] = []
      for (const h of handlers['tool_call'] ?? []) results.push(await h(event))
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

function makeCtx(overrides: Partial<AISettings> = {}): ExtensionRuntimeContext {
  return {
    version: 1,
    conversationId: 42,
    aiSettings: {
      cwdRestrictionEnabled: true,
      cwd: '/project',
      cwdWhitelist: [],
      ...overrides,
    } as AISettings,
    db: null,
    bridge: makeBridge(),
    sessionStore: new Map<string, unknown>(),
  }
}

describe('cwdGuard module', () => {
  let pi: ReturnType<typeof makeMockPi>

  beforeEach(() => {
    pi = makeMockPi()
  })

  it('is a no-op when cwdRestrictionEnabled is false', async () => {
    const ctx = makeCtx({ cwdRestrictionEnabled: false })
    initCwdGuard(pi as never, ctx)
    expect(pi.handlers['tool_call']).toBeUndefined()
  })

  it('registers a tool_call handler when cwdRestrictionEnabled is true', () => {
    const ctx = makeCtx()
    initCwdGuard(pi as never, ctx)
    expect(pi.handlers['tool_call']).toHaveLength(1)
  })

  it('allows writes inside CWD', async () => {
    const ctx = makeCtx()
    initCwdGuard(pi as never, ctx)
    const [result] = await pi.fireToolCall({ toolName: 'write', input: { path: '/project/foo.ts' } })
    expect(result).toBeUndefined()
    expect((ctx.bridge as ReturnType<typeof makeBridge>).emitSystemMessage).not.toHaveBeenCalled()
  })

  it('blocks writes outside CWD with no whitelist', async () => {
    const ctx = makeCtx()
    initCwdGuard(pi as never, ctx)
    const [result] = await pi.fireToolCall({ toolName: 'write', input: { path: '/etc/passwd' } })
    expect(result).toMatchObject({ block: true, reason: expect.stringContaining('outside') })
    expect((ctx.bridge as ReturnType<typeof makeBridge>).emitSystemMessage).toHaveBeenCalledWith(
      expect.stringContaining('Write blocked'),
      expect.objectContaining({ hookName: 'cwd-guard', hookEvent: 'PreToolUse' }),
    )
  })

  it('allows writes inside a readwrite whitelist entry', async () => {
    const ctx = makeCtx({ cwdWhitelist: [{ path: '/data', access: 'readwrite' }] })
    initCwdGuard(pi as never, ctx)
    const [result] = await pi.fireToolCall({ toolName: 'write', input: { path: '/data/x.csv' } })
    expect(result).toBeUndefined()
  })

  it('blocks writes targeting a read-only whitelist entry', async () => {
    const ctx = makeCtx({ cwdWhitelist: [{ path: '/data', access: 'read' }] })
    initCwdGuard(pi as never, ctx)
    const [result] = await pi.fireToolCall({ toolName: 'write', input: { path: '/data/x.csv' } })
    expect(result).toMatchObject({ block: true })
  })

  it('blocks edit tool on out-of-CWD paths just like write', async () => {
    const ctx = makeCtx()
    initCwdGuard(pi as never, ctx)
    const [result] = await pi.fireToolCall({ toolName: 'edit', input: { path: '/etc/hosts' } })
    expect(result).toMatchObject({ block: true })
  })

  it('blocks bash commands that redirect output outside CWD', async () => {
    const ctx = makeCtx()
    initCwdGuard(pi as never, ctx)
    const [result] = await pi.fireToolCall({ toolName: 'bash', input: { command: 'echo pwned > /tmp/out' } })
    expect(result).toMatchObject({ block: true, reason: expect.stringContaining('outside') })
    expect((ctx.bridge as ReturnType<typeof makeBridge>).emitSystemMessage).toHaveBeenCalledWith(
      expect.stringContaining('Bash blocked'),
      expect.objectContaining({ hookName: 'cwd-guard', hookEvent: 'PreToolUse' }),
    )
  })

  it('allows bash commands that only write inside CWD', async () => {
    const ctx = makeCtx()
    initCwdGuard(pi as never, ctx)
    const [result] = await pi.fireToolCall({ toolName: 'bash', input: { command: 'echo ok > /project/out.log' } })
    expect(result).toBeUndefined()
  })

  it('allows read-only bash commands regardless of cwd', async () => {
    const ctx = makeCtx()
    initCwdGuard(pi as never, ctx)
    const [result] = await pi.fireToolCall({ toolName: 'bash', input: { command: 'cat /etc/hosts' } })
    expect(result).toBeUndefined()
  })

  it('ignores non-mutating tool events', async () => {
    const ctx = makeCtx()
    initCwdGuard(pi as never, ctx)
    const [result] = await pi.fireToolCall({ toolName: 'read', input: { path: '/etc/hosts' } })
    expect(result).toBeUndefined()
  })

  it('falls back to process.cwd() when aiSettings.cwd is missing', async () => {
    const ctx: ExtensionRuntimeContext = {
      version: 1,
      conversationId: 1,
      aiSettings: { cwdRestrictionEnabled: true, cwdWhitelist: [] } as AISettings,
      db: null,
      bridge: makeBridge(),
      sessionStore: new Map<string, unknown>(),
    }
    initCwdGuard(pi as never, ctx)
    const [result] = await pi.fireToolCall({ toolName: 'write', input: { path: '/nonexistent/out-of-tree.xyz' } })
    expect(result).toMatchObject({ block: true })
  })
})
