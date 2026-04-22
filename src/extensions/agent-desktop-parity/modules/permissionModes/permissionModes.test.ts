import { describe, it, expect, vi, beforeEach } from 'vitest'
import { initPermissionModes } from './index'
import type { ExtensionRuntimeContext, PiExtensionBridge } from '../../../../core/services/piExtensionBridge'
import type { AISettings } from '../../../../core/services/streaming'

type ToolCallEvent = { toolName: string; input: Record<string, unknown> }

function makeMockPi() {
  const handlers: Record<string, Array<(event: ToolCallEvent, extCtx: unknown) => unknown>> = {}
  const registeredTools: Array<{ name: string; execute: (...a: unknown[]) => unknown }> = []
  let activeTools: string[] | null = null

  return {
    on(eventName: string, handler: (event: ToolCallEvent, extCtx: unknown) => unknown) {
      ;(handlers[eventName] ||= []).push(handler)
    },
    setActiveTools(names: string[]) {
      activeTools = names
    },
    registerTool(def: { name: string; execute: (...a: unknown[]) => unknown }) {
      registeredTools.push(def)
    },
    async fireToolCall(event: ToolCallEvent, extCtx: unknown) {
      const results: unknown[] = []
      for (const h of handlers['tool_call'] ?? []) results.push(await h(event, extCtx))
      return results
    },
    handlers,
    registeredTools,
    get activeTools() { return activeTools },
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

function makeUiCtx(confirmReturn: boolean = true) {
  const confirm = vi.fn(async () => confirmReturn)
  return { ui: { confirm } }
}

function makeCtx(permissionMode: string, extras: Partial<AISettings> = {}): ExtensionRuntimeContext {
  return {
    version: 1,
    conversationId: 42,
    aiSettings: {
      permissionMode,
      requirePlanApproval: true,
      ...extras,
    } as AISettings,
    db: null,
    bridge: makeBridge(),
    sessionStore: new Map<string, unknown>(),
  }
}

describe('permissionModes — bypass', () => {
  it('allows every tool without confirming', async () => {
    const pi = makeMockPi()
    const ctx = makeCtx('bypassPermissions')
    initPermissionModes(pi as never, ctx)
    const uiCtx = makeUiCtx()
    const [result] = await pi.fireToolCall({ toolName: 'write', input: { path: '/etc/x' } }, uiCtx)
    expect(result).toBeUndefined()
    expect(uiCtx.ui.confirm).not.toHaveBeenCalled()
  })
})

describe('permissionModes — acceptEdits', () => {
  it('auto-allows Write and Edit without confirming', async () => {
    const pi = makeMockPi()
    const ctx = makeCtx('acceptEdits')
    initPermissionModes(pi as never, ctx)
    const uiCtx = makeUiCtx()
    for (const tool of ['write', 'edit']) {
      const [result] = await pi.fireToolCall({ toolName: tool, input: { path: '/x' } }, uiCtx)
      expect(result).toBeUndefined()
    }
    expect(uiCtx.ui.confirm).not.toHaveBeenCalled()
  })

  it('asks for Bash', async () => {
    const pi = makeMockPi()
    const ctx = makeCtx('acceptEdits')
    initPermissionModes(pi as never, ctx)
    const uiCtx = makeUiCtx(true)
    const [result] = await pi.fireToolCall({ toolName: 'bash', input: { command: 'ls' } }, uiCtx)
    expect(uiCtx.ui.confirm).toHaveBeenCalledOnce()
    expect(result).toBeUndefined()
  })
})

describe('permissionModes — default', () => {
  it('asks before allowing write', async () => {
    const pi = makeMockPi()
    const ctx = makeCtx('default')
    initPermissionModes(pi as never, ctx)
    const uiCtx = makeUiCtx(true)
    const [result] = await pi.fireToolCall({ toolName: 'write', input: { path: '/x' } }, uiCtx)
    expect(uiCtx.ui.confirm).toHaveBeenCalledOnce()
    expect(result).toBeUndefined()
  })

  it('blocks when user denies', async () => {
    const pi = makeMockPi()
    const ctx = makeCtx('default')
    initPermissionModes(pi as never, ctx)
    const uiCtx = makeUiCtx(false)
    const [result] = await pi.fireToolCall({ toolName: 'write', input: { path: '/x' } }, uiCtx)
    expect(result).toMatchObject({ block: true, reason: expect.stringContaining('denied') })
  })

  it('allows reads without asking', async () => {
    const pi = makeMockPi()
    const ctx = makeCtx('default')
    initPermissionModes(pi as never, ctx)
    const uiCtx = makeUiCtx()
    const [result] = await pi.fireToolCall({ toolName: 'read', input: { path: '/x' } }, uiCtx)
    expect(result).toBeUndefined()
    expect(uiCtx.ui.confirm).not.toHaveBeenCalled()
  })
})

describe('permissionModes — dontAsk (caches decisions)', () => {
  it('asks once per (toolName, input) combo and caches the answer', async () => {
    const pi = makeMockPi()
    const ctx = makeCtx('dontAsk')
    initPermissionModes(pi as never, ctx)
    const uiCtx = makeUiCtx(true)

    for (let i = 0; i < 3; i++) {
      await pi.fireToolCall({ toolName: 'write', input: { path: '/same/file' } }, uiCtx)
    }
    expect(uiCtx.ui.confirm).toHaveBeenCalledOnce()
  })

  it('asks again for a different input', async () => {
    const pi = makeMockPi()
    const ctx = makeCtx('dontAsk')
    initPermissionModes(pi as never, ctx)
    const uiCtx = makeUiCtx(true)

    await pi.fireToolCall({ toolName: 'write', input: { path: '/a' } }, uiCtx)
    await pi.fireToolCall({ toolName: 'write', input: { path: '/b' } }, uiCtx)
    expect(uiCtx.ui.confirm).toHaveBeenCalledTimes(2)
  })

  it('cached deny blocks subsequent calls without re-asking', async () => {
    const pi = makeMockPi()
    const ctx = makeCtx('dontAsk')
    initPermissionModes(pi as never, ctx)
    const uiCtx = makeUiCtx(false)

    const [first] = await pi.fireToolCall({ toolName: 'write', input: { path: '/x' } }, uiCtx)
    expect(first).toMatchObject({ block: true })
    const [second] = await pi.fireToolCall({ toolName: 'write', input: { path: '/x' } }, uiCtx)
    expect(second).toMatchObject({ block: true })
    expect(uiCtx.ui.confirm).toHaveBeenCalledOnce()
  })
})

describe('permissionModes — plan', () => {
  // PLAN_READONLY_TOOLS MUST include exit_plan_mode — otherwise the LLM
  // is trapped with no way to leave plan mode.
  const PLAN_READONLY_TOOLS = ['read', 'grep', 'find', 'ls', 'exit_plan_mode']
  const DEFAULT_TOOLS = ['read', 'grep', 'find', 'ls', 'bash', 'edit', 'write']

  it('does NOT call setActiveTools at init (PI forbids action methods during extension loading)', () => {
    const pi = makeMockPi()
    const ctx = makeCtx('plan')
    initPermissionModes(pi as never, ctx)
    // Factory-time call is deferred — activeTools stays null until a
    // lifecycle event fires.
    expect(pi.activeTools).toBeNull()
  })

  it('registers lifecycle lockdown hooks (before_agent_start, session_start)', () => {
    const pi = makeMockPi()
    const ctx = makeCtx('plan')
    initPermissionModes(pi as never, ctx)
    expect(pi.handlers['before_agent_start']).toHaveLength(1)
    expect(pi.handlers['session_start']).toHaveLength(1)
  })

  it('sets PLAN_READONLY_TOOLS when before_agent_start fires', async () => {
    const pi = makeMockPi()
    const ctx = makeCtx('plan')
    initPermissionModes(pi as never, ctx)
    const handler = pi.handlers['before_agent_start']![0]
    await handler({} as never)
    expect(pi.activeTools).toEqual(PLAN_READONLY_TOOLS)
  })

  it('includes exit_plan_mode in the plan-mode active tool set', async () => {
    const pi = makeMockPi()
    const ctx = makeCtx('plan')
    initPermissionModes(pi as never, ctx)
    const handler = pi.handlers['session_start']![0]
    await handler({} as never)
    expect(pi.activeTools).toContain('exit_plan_mode')
  })

  it('registers an exit_plan_mode custom tool', () => {
    const pi = makeMockPi()
    const ctx = makeCtx('plan')
    initPermissionModes(pi as never, ctx)
    expect(pi.registeredTools.map(t => t.name)).toContain('exit_plan_mode')
  })

  it('exit_plan_mode tool restores default tools and flips state', async () => {
    const pi = makeMockPi()
    const ctx = makeCtx('plan', { requirePlanApproval: false })
    initPermissionModes(pi as never, ctx)
    const exitTool = pi.registeredTools.find(t => t.name === 'exit_plan_mode')!
    const uiCtx = makeUiCtx()
    const result = await exitTool.execute('call-1', {}, new AbortController().signal, vi.fn(), uiCtx) as { content: Array<{ text: string }> }
    expect(pi.activeTools).toEqual(DEFAULT_TOOLS)
    expect(result.content[0].text).toMatch(/Plan mode exited/i)
  })

  it('exit_plan_mode prompts via ctx.ui.confirm when requirePlanApproval is true', async () => {
    const pi = makeMockPi()
    const ctx = makeCtx('plan', { requirePlanApproval: true })
    initPermissionModes(pi as never, ctx)
    const exitTool = pi.registeredTools.find(t => t.name === 'exit_plan_mode')!
    const uiCtx = makeUiCtx(true)
    await exitTool.execute('call-1', {}, new AbortController().signal, vi.fn(), uiCtx)
    expect(uiCtx.ui.confirm).toHaveBeenCalledOnce()
    expect(pi.activeTools).toEqual(DEFAULT_TOOLS)
  })

  it('exit_plan_mode aborts and keeps read-only when user denies approval', async () => {
    const pi = makeMockPi()
    const ctx = makeCtx('plan', { requirePlanApproval: true })
    initPermissionModes(pi as never, ctx)
    // Fire the lifecycle lockdown first so activeTools is populated
    await pi.handlers['before_agent_start']![0]({} as never)
    const exitTool = pi.registeredTools.find(t => t.name === 'exit_plan_mode')!
    const uiCtx = makeUiCtx(false)
    const result = await exitTool.execute('call-1', {}, new AbortController().signal, vi.fn(), uiCtx) as { content: Array<{ text: string }> }
    expect(pi.activeTools).toEqual(PLAN_READONLY_TOOLS)
    expect(result.content[0].text).toMatch(/denied/i)
  })

  it('blocks mutating tools while plan mode is active', async () => {
    const pi = makeMockPi()
    const ctx = makeCtx('plan')
    initPermissionModes(pi as never, ctx)
    const uiCtx = makeUiCtx()
    const [result] = await pi.fireToolCall({ toolName: 'write', input: { path: '/x' } }, uiCtx)
    expect(result).toMatchObject({ block: true })
    expect(uiCtx.ui.confirm).not.toHaveBeenCalled()
  })

  it('allows reads while plan mode is active', async () => {
    const pi = makeMockPi()
    const ctx = makeCtx('plan')
    initPermissionModes(pi as never, ctx)
    const uiCtx = makeUiCtx()
    const [result] = await pi.fireToolCall({ toolName: 'read', input: { path: '/x' } }, uiCtx)
    expect(result).toBeUndefined()
  })
})
