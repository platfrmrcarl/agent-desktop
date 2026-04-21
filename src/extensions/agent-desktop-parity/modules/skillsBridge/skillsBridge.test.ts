import { describe, it, expect, vi, beforeEach } from 'vitest'
import { initSkillsBridge } from './index'
import type { ExtensionRuntimeContext, PiExtensionBridge } from '../../../../core/services/piExtensionBridge'
import type { AISettings } from '../../../../core/services/streaming'
import { homedir } from 'node:os'
import path from 'node:path'

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
    aiSettings: { cwd: '/project', skills: 'user', skillsEnabled: true, ...extras } as AISettings,
    db: null,
    bridge: makeBridge(),
    sessionStore: new Map<string, unknown>(),
  }
}

describe('skillsBridge', () => {
  beforeEach(() => {})

  it('is a no-op when skills scope is "off"', () => {
    const pi = makeMockPi()
    initSkillsBridge(pi as never, makeCtx({ skills: 'off' }))
    expect(pi.handlers['resources_discover']).toBeUndefined()
  })

  it('is a no-op when skills is undefined', () => {
    const pi = makeMockPi()
    initSkillsBridge(pi as never, makeCtx({ skills: undefined }))
    expect(pi.handlers['resources_discover']).toBeUndefined()
  })

  it('is a no-op when skillsEnabled === false', () => {
    const pi = makeMockPi()
    initSkillsBridge(pi as never, makeCtx({ skillsEnabled: false }))
    expect(pi.handlers['resources_discover']).toBeUndefined()
  })

  it('registers a resources_discover handler when skills are enabled', () => {
    const pi = makeMockPi()
    initSkillsBridge(pi as never, makeCtx())
    expect(pi.handlers['resources_discover']).toHaveLength(1)
  })

  it('returns user-scope paths on resources_discover', async () => {
    const pi = makeMockPi()
    initSkillsBridge(pi as never, makeCtx({ skills: 'user' }))
    const [result] = await pi.fire('resources_discover', { cwd: '/fallback' })
    expect(result).toEqual({
      skillPaths: [
        path.join(homedir(), '.claude/skills'),
        path.join(homedir(), '.claude/plugins'),
      ],
    })
  })

  it('returns project-scope paths (user + project)', async () => {
    const pi = makeMockPi()
    initSkillsBridge(pi as never, makeCtx({ skills: 'project' }))
    const [result] = await pi.fire('resources_discover', { cwd: '/fallback' })
    expect(result).toMatchObject({
      skillPaths: expect.arrayContaining([
        path.join(homedir(), '.claude/skills'),
        '/project/.claude/skills',
      ]),
    })
    const paths = (result as { skillPaths: string[] }).skillPaths
    expect(paths).toHaveLength(4)
  })

  it('returns local-scope paths (user + project + local)', async () => {
    const pi = makeMockPi()
    initSkillsBridge(pi as never, makeCtx({ skills: 'local' }))
    const [result] = await pi.fire('resources_discover', { cwd: '/fallback' })
    const paths = (result as { skillPaths: string[] }).skillPaths
    expect(paths).toHaveLength(6)
    expect(paths).toContain('/project/.claude.local/skills')
  })

  it('falls back to event.cwd when aiSettings.cwd is missing', async () => {
    const ctx: ExtensionRuntimeContext = {
      version: 1,
      conversationId: 1,
      aiSettings: { skills: 'project', skillsEnabled: true } as AISettings,
      db: null,
      bridge: makeBridge(),
      sessionStore: new Map<string, unknown>(),
    }
    const pi = makeMockPi()
    initSkillsBridge(pi as never, ctx)
    const [result] = await pi.fire('resources_discover', { cwd: '/event-provided' })
    const paths = (result as { skillPaths: string[] }).skillPaths
    expect(paths).toContain('/event-provided/.claude/skills')
  })

  it('emits a one-time warning when disabledSkills is non-empty', () => {
    const ctx = makeCtx({ disabledSkills: ['risky-skill', 'secret-skill'] })
    const pi = makeMockPi()
    initSkillsBridge(pi as never, ctx)
    const bridge = ctx.bridge as ReturnType<typeof makeBridge>
    expect(bridge.emitSystemMessage).toHaveBeenCalledOnce()
    const [msg, meta] = bridge.emitSystemMessage.mock.calls[0]
    expect(msg).toMatch(/risky-skill/)
    expect(msg).toMatch(/secret-skill/)
    expect(meta).toMatchObject({ hookName: 'skills-bridge' })
  })

  it('does not repeat the disabledSkills warning across re-init within the same session', () => {
    const ctx = makeCtx({ disabledSkills: ['foo'] })
    initSkillsBridge(makeMockPi() as never, ctx)
    initSkillsBridge(makeMockPi() as never, ctx)
    const bridge = ctx.bridge as ReturnType<typeof makeBridge>
    expect(bridge.emitSystemMessage).toHaveBeenCalledOnce()
  })

  it('does not emit the warning when disabledSkills is empty', () => {
    const ctx = makeCtx({ disabledSkills: [] })
    initSkillsBridge(makeMockPi() as never, ctx)
    const bridge = ctx.bridge as ReturnType<typeof makeBridge>
    expect(bridge.emitSystemMessage).not.toHaveBeenCalled()
  })
})
