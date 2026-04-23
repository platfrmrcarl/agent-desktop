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
    // The tool's return text must tell the agent to stop and wait for
    // the user's next message — mid-turn tool-list refresh is unreliable
    // in PI, so mutating tools only reliably land on the NEXT turn.
    expect(result.content[0].text).toMatch(/stop/i)
    expect(result.content[0].text).toMatch(/next message/i)
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

  it('allows exit_plan_mode tool_call even though it is not in READ_TOOLS', async () => {
    // exit_plan_mode is OUR escape hatch. The shouldRequireApproval policy
    // would return 'deny' in plan mode for any tool not in READ_TOOLS —
    // including exit_plan_mode. Without the special-case in the handler,
    // calling exit_plan_mode from the LLM would deadlock the session.
    const pi = makeMockPi()
    const ctx = makeCtx('plan')
    initPermissionModes(pi as never, ctx)
    const uiCtx = makeUiCtx()
    const [result] = await pi.fireToolCall({ toolName: 'exit_plan_mode', input: {} }, uiCtx)
    expect(result).toBeUndefined()
  })

  it('exit_plan_mode sets a sessionStore flag so later turns skip lockdown', async () => {
    const store = new Map<string, unknown>()
    const pi = makeMockPi()
    const ctx: ExtensionRuntimeContext = { ...makeCtx('plan', { requirePlanApproval: false }), sessionStore: store }
    initPermissionModes(pi as never, ctx)
    const exitTool = pi.registeredTools.find(t => t.name === 'exit_plan_mode')!
    const uiCtx = makeUiCtx()
    await exitTool.execute('call-1', {}, new AbortController().signal, vi.fn(), uiCtx)
    expect(store.get('permissionModes.planExited')).toBe(true)
  })

  it('does NOT set the exited flag when user denies approval', async () => {
    const store = new Map<string, unknown>()
    const pi = makeMockPi()
    const ctx: ExtensionRuntimeContext = { ...makeCtx('plan', { requirePlanApproval: true }), sessionStore: store }
    initPermissionModes(pi as never, ctx)
    const exitTool = pi.registeredTools.find(t => t.name === 'exit_plan_mode')!
    const uiCtx = makeUiCtx(false)  // denies
    await exitTool.execute('call-1', {}, new AbortController().signal, vi.fn(), uiCtx)
    expect(store.get('permissionModes.planExited')).toBeUndefined()
  })

  it('post-exit: factory short-circuits on subsequent turns (no handler, no tool)', () => {
    // After exit_plan_mode succeeded on a previous turn, planExited is set
    // in sessionStore. The NEXT factory init should treat effective mode
    // as bypassPermissions and return early: no tool_call handler, no
    // lifecycle lockdown, no exit_plan_mode re-registration. This ensures
    // the LLM's default tool set (write/edit/bash included) is untouched.
    const store = new Map<string, unknown>()
    store.set('permissionModes.planExited', true)
    const pi = makeMockPi()
    const ctx: ExtensionRuntimeContext = { ...makeCtx('plan'), sessionStore: store }
    initPermissionModes(pi as never, ctx)
    expect(pi.handlers['tool_call']).toBeUndefined()
    expect(pi.handlers['before_agent_start']).toBeUndefined()
    expect(pi.handlers['session_start']).toBeUndefined()
    expect(pi.registeredTools).toHaveLength(0)
  })

  it('post-exit: a tool_call for write is not blocked (handler does not exist)', async () => {
    const store = new Map<string, unknown>()
    store.set('permissionModes.planExited', true)
    const pi = makeMockPi()
    const ctx: ExtensionRuntimeContext = { ...makeCtx('plan'), sessionStore: store }
    initPermissionModes(pi as never, ctx)
    // No tool_call handler registered → fireToolCall returns empty results.
    const results = await pi.fireToolCall({ toolName: 'write', input: { path: '/x' } }, makeUiCtx())
    expect(results).toEqual([])
  })
})
