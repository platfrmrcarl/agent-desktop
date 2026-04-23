import { describe, it, expect, vi } from 'vitest'
import type { ToolDefinition, AgentToolResult } from '@mariozechner/pi-coding-agent'
import { Type } from '@sinclair/typebox'
import { gatePiTools } from './piPermissionGate'
import type { CanUseToolFn } from '../../core/services/canUseTool'

function makeTool(
  name: string,
  execImpl?: (params: unknown) => Promise<AgentToolResult>,
): ToolDefinition {
  return {
    name,
    label: name,
    description: '',
    parameters: Type.Object({}) as never,
    execute: vi.fn(async (_id, params) =>
      (execImpl ? execImpl(params) : { content: [{ type: 'text', text: 'ran' }] }) as AgentToolResult,
    ) as ToolDefinition['execute'],
  }
}

describe('gatePiTools — bypass mode', () => {
  it('returns tools unchanged when bypass is true', () => {
    const tools = [makeTool('mcp__fs__read')]
    const canUse = vi.fn() as unknown as CanUseToolFn
    const gated = gatePiTools(tools, { canUseTool: canUse, bypass: true })
    expect(gated).toBe(tools)
  })
})

describe('gatePiTools — approval flow', () => {
  it('allows execute when canUseTool resolves allow', async () => {
    const tool = makeTool('mcp__fs__read')
    const canUse: CanUseToolFn = vi.fn(async () => ({ behavior: 'allow', updatedInput: { path: '/tmp' } }))
    const [gated] = gatePiTools([tool], { canUseTool: canUse, bypass: false })
    const result = await gated.execute('c1', { path: '/tmp' }, undefined, undefined, {} as never)
    expect(canUse).toHaveBeenCalled()
    expect(tool.execute).toHaveBeenCalledWith('c1', { path: '/tmp' }, undefined, undefined, expect.anything())
    expect((result.content[0] as { text: string }).text).toBe('ran')
  })

  it('threads onUpdate and ctx through to the underlying execute', async () => {
    const tool = makeTool('mcp__fs__read')
    const canUse: CanUseToolFn = vi.fn(async () => ({ behavior: 'allow', updatedInput: {} }))
    const onUpdate = vi.fn()
    const ctx = { cwd: '/test' } as never
    const [gated] = gatePiTools([tool], { canUseTool: canUse, bypass: false })
    await gated.execute('c1', {}, undefined, onUpdate, ctx)
    expect(tool.execute).toHaveBeenCalledWith('c1', {}, undefined, onUpdate, ctx)
  })

  it('passes updatedInput from approval through to the underlying execute', async () => {
    const tool = makeTool('mcp__fs__read')
    const canUse: CanUseToolFn = vi.fn(async () => ({
      behavior: 'allow',
      updatedInput: { path: '/redacted' },
    }))
    const [gated] = gatePiTools([tool], { canUseTool: canUse, bypass: false })
    await gated.execute('c1', { path: '/original' }, undefined, undefined, {} as never)
    expect(tool.execute).toHaveBeenCalledWith('c1', { path: '/redacted' }, undefined, undefined, expect.anything())
  })

  it('returns isError result when canUseTool resolves deny', async () => {
    const tool = makeTool('mcp__fs__read')
    const canUse: CanUseToolFn = vi.fn(async () => ({ behavior: 'deny', message: 'nope' }))
    const [gated] = gatePiTools([tool], { canUseTool: canUse, bypass: false })
    const result = await gated.execute('c1', {}, undefined, undefined, {} as never)
    expect(tool.execute).not.toHaveBeenCalled()
    expect((result as { isError?: boolean }).isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toContain('nope')
  })

  it('returns isError result when signal is already aborted', async () => {
    const tool = makeTool('mcp__fs__read')
    const canUse: CanUseToolFn = vi.fn()
    const ac = new AbortController()
    ac.abort()
    const [gated] = gatePiTools([tool], { canUseTool: canUse, bypass: false })
    const result = await gated.execute('c1', {}, ac.signal, undefined, {} as never)
    expect(canUse).not.toHaveBeenCalled()
    expect((result as { isError?: boolean }).isError).toBe(true)
  })

  it('returns isError when canUseTool throws', async () => {
    const tool = makeTool('mcp__fs__read')
    const canUse: CanUseToolFn = vi.fn(async () => {
      throw new Error('approval UI died')
    })
    const [gated] = gatePiTools([tool], { canUseTool: canUse, bypass: false })
    const result = await gated.execute('c1', {}, undefined, undefined, {} as never)
    expect((result as { isError?: boolean }).isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toContain('approval UI died')
  })
})
