import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { McpClientHandle, McpToolSpec } from './mcpClient'
import { mcpServerToPiTools } from './mcpToPiTools'

function makeHandle(overrides?: Partial<McpClientHandle>): McpClientHandle {
  return {
    name: 'fs',
    tools: [
      {
        name: 'read_file',
        description: 'Read a file',
        inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      } as McpToolSpec,
    ],
    callTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'hello' }] }),
    close: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe('mcpServerToPiTools — naming & schema', () => {
  it('prefixes tool names with mcp__<server>__', () => {
    const handle = makeHandle()
    const defs = mcpServerToPiTools(handle)
    expect(defs).toHaveLength(1)
    expect(defs[0].name).toBe('mcp__fs__read_file')
    expect(defs[0].label).toBe('fs: read_file')
    expect(defs[0].description).toBe('Read a file')
  })

  it('uses empty string description when MCP tool has none', () => {
    const handle = makeHandle({
      tools: [{ name: 't', inputSchema: { type: 'object' } } as McpToolSpec],
    })
    const defs = mcpServerToPiTools(handle)
    expect(defs[0].description).toBe('')
  })

  it('wraps JSON schema in Type.Unsafe', () => {
    const handle = makeHandle()
    const defs = mcpServerToPiTools(handle)
    // Typebox Unsafe schemas are plain objects mirroring the input
    expect((defs[0].parameters as unknown as { type: string }).type).toBe('object')
  })
})

describe('mcpServerToPiTools — execute', () => {
  it('forwards name (without prefix), args, and signal to client.callTool', async () => {
    const handle = makeHandle()
    const [def] = mcpServerToPiTools(handle)
    const ac = new AbortController()
    await def.execute('call-1', { path: '/tmp/x' }, ac.signal, undefined, {} as never)
    expect(handle.callTool).toHaveBeenCalledWith('read_file', { path: '/tmp/x' }, ac.signal)
  })

  it('maps MCP text content to PI AgentToolResult', async () => {
    const handle = makeHandle()
    const [def] = mcpServerToPiTools(handle)
    const result = await def.execute('c1', {}, undefined, undefined, {} as never)
    expect(result).toMatchObject({
      content: [{ type: 'text', text: 'hello' }],
    })
  })

  it('forwards image content blocks natively', async () => {
    const handle = makeHandle({
      callTool: vi.fn().mockResolvedValue({
        content: [
          { type: 'text', text: 'ok' },
          { type: 'image', data: 'base64...', mimeType: 'image/png' },
        ],
      }),
    })
    const [def] = mcpServerToPiTools(handle)
    const result = await def.execute('c1', {}, undefined, undefined, {} as never)
    expect(result.content).toHaveLength(2)
    expect(result.content[1]).toMatchObject({ type: 'image', data: 'base64...', mimeType: 'image/png' })
  })

  it('stringifies unknown content block types', async () => {
    const handle = makeHandle({
      callTool: vi.fn().mockResolvedValue({
        content: [{ type: 'resource', uri: 'file:///foo' }],
      }),
    })
    const [def] = mcpServerToPiTools(handle)
    const result = await def.execute('c1', {}, undefined, undefined, {} as never)
    expect(result.content).toHaveLength(1)
    expect(result.content[0]).toMatchObject({ type: 'text' })
    expect((result.content[0] as { text: string }).text).toContain('resource')
  })

  it('propagates isError flag', async () => {
    const handle = makeHandle({
      callTool: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'boom' }],
        isError: true,
      }),
    })
    const [def] = mcpServerToPiTools(handle)
    const result = await def.execute('c1', {}, undefined, undefined, {} as never)
    expect((result as { isError?: boolean }).isError).toBe(true)
  })

  it('converts thrown errors into isError results', async () => {
    const handle = makeHandle({
      callTool: vi.fn().mockRejectedValue(new Error('transport dead')),
    })
    const [def] = mcpServerToPiTools(handle)
    const result = await def.execute('c1', {}, undefined, undefined, {} as never)
    expect((result as { isError?: boolean }).isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toContain('transport dead')
  })
})
