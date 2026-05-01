import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockSendChunk, mockCreateMcpClient, MockMcpConnectError, mockMcpServerToPiTools, mockGatePiTools } = vi.hoisted(() => {
  class _MockMcpConnectError extends Error {
    serverName: string
    constructor(name: string, cause: unknown) {
      const causeMsg = cause instanceof Error ? cause.message : String(cause)
      super(`MCP server '${name}' failed to connect: ${causeMsg}`)
      this.name = 'McpConnectError'
      this.serverName = name
    }
  }
  const _mockGatePiTools = vi.fn()
  _mockGatePiTools.mockImplementation((tools: unknown[]) => tools)
  return {
    mockSendChunk: vi.fn(),
    mockCreateMcpClient: vi.fn(),
    MockMcpConnectError: _MockMcpConnectError,
    mockMcpServerToPiTools: vi.fn().mockReturnValue([]),
    mockGatePiTools: _mockGatePiTools,
  }
})

vi.mock('../streaming', async () => {
  const actual = await vi.importActual<typeof import('../streaming')>('../streaming')
  return { ...actual, sendChunk: (...args: unknown[]) => mockSendChunk(...args) }
})

vi.mock('../mcpClient', () => ({
  createMcpClient: (...args: unknown[]) => mockCreateMcpClient(...args),
  McpConnectError: MockMcpConnectError,
}))

vi.mock('../mcpToPiTools', () => ({
  mcpServerToPiTools: (...args: unknown[]) => mockMcpServerToPiTools(...args),
}))

vi.mock('../piPermissionGate', () => ({
  gatePiTools: (...args: unknown[]) => mockGatePiTools(...args),
}))

import { setupMcp } from './setupMcp'
import type { CanUseToolFn } from '../canUseTool'
import type { McpTransportConfig } from '../streaming'

function makeCanUseTool(): CanUseToolFn {
  return vi.fn().mockResolvedValue({ behavior: 'allow', updatedInput: {} })
}

function makeHandle(name = 'fs') {
  return { name, tools: [], callTool: vi.fn(), close: vi.fn().mockResolvedValue(undefined) }
}

const stdioConfig: McpTransportConfig = { command: 'node', args: ['server.js'] }
const convExtra = { conversationId: 1 }

describe('setupMcp — empty mcpServers', () => {
  beforeEach(() => { mockSendChunk.mockClear(); mockCreateMcpClient.mockClear() })

  it('returns empty arrays without emitting any chunks', async () => {
    const result = await setupMcp({
      mcpServers: {},
      canUseTool: makeCanUseTool(),
      bypass: false,
      convExtra,
    })
    expect(result.mcpTools).toEqual([])
    expect(result.mcpHandles).toEqual([])
    expect(mockSendChunk).not.toHaveBeenCalled()
  })
})

describe('setupMcp — double-underscore server names are filtered', () => {
  beforeEach(() => { mockSendChunk.mockClear(); mockCreateMcpClient.mockClear() })

  it('excludes servers whose name contains "__"', async () => {
    const result = await setupMcp({
      mcpServers: { 'bad__name': stdioConfig, normal: stdioConfig },
      canUseTool: makeCanUseTool(),
      bypass: false,
      convExtra,
    })
    // Only 'normal' should spawn
    expect(mockCreateMcpClient).toHaveBeenCalledTimes(1)
    expect(mockCreateMcpClient).toHaveBeenCalledWith('normal', stdioConfig)
    // mcpHandles is empty because mockCreateMcpClient doesn't resolve by default
    // (we check spawn call, not result, to avoid deep mock complexity here)
    expect(result).toBeDefined()
  })
})

describe('setupMcp — all-success path', () => {
  beforeEach(() => {
    mockSendChunk.mockClear()
    mockCreateMcpClient.mockClear()
    mockMcpServerToPiTools.mockClear()
    mockGatePiTools.mockClear()
  })

  it('emits spawn_started and spawn_complete system_message chunks', async () => {
    const handle = makeHandle('fs')
    mockCreateMcpClient.mockResolvedValueOnce(handle)
    mockMcpServerToPiTools.mockReturnValueOnce([{ name: 'mcp__fs__read', execute: vi.fn() }])

    await setupMcp({ mcpServers: { fs: stdioConfig }, canUseTool: makeCanUseTool(), bypass: false, convExtra })

    const startCall = mockSendChunk.mock.calls.find(
      (c: unknown[]) => (c[2] as { hookEvent?: string })?.hookEvent === 'spawn_started',
    )
    const completeCall = mockSendChunk.mock.calls.find(
      (c: unknown[]) => (c[2] as { hookEvent?: string })?.hookEvent === 'spawn_complete',
    )
    expect(startCall).toBeDefined()
    expect(completeCall).toBeDefined()
    expect(startCall![0]).toBe('system_message')
    expect(completeCall![0]).toBe('system_message')
  })

  it('populates mcpHandles from successful spawns', async () => {
    const handle = makeHandle('fs')
    mockCreateMcpClient.mockResolvedValueOnce(handle)
    mockMcpServerToPiTools.mockReturnValueOnce([])

    const result = await setupMcp({ mcpServers: { fs: stdioConfig }, canUseTool: makeCanUseTool(), bypass: false, convExtra })
    expect(result.mcpHandles).toHaveLength(1)
    expect(result.mcpHandles[0]).toBe(handle)
  })

  it('calls gatePiTools with the raw tools', async () => {
    const handle = makeHandle('db')
    const fakeTools = [{ name: 'mcp__db__query', execute: vi.fn() }]
    mockCreateMcpClient.mockResolvedValueOnce(handle)
    mockMcpServerToPiTools.mockReturnValueOnce(fakeTools)

    await setupMcp({ mcpServers: { db: stdioConfig }, canUseTool: makeCanUseTool(), bypass: false, convExtra })
    expect(mockGatePiTools).toHaveBeenCalledWith(fakeTools, expect.objectContaining({ bypass: false }))
  })

  it('passes bypass=true through to gatePiTools', async () => {
    const handle = makeHandle('fs')
    mockCreateMcpClient.mockResolvedValueOnce(handle)
    mockMcpServerToPiTools.mockReturnValueOnce([])

    await setupMcp({ mcpServers: { fs: stdioConfig }, canUseTool: makeCanUseTool(), bypass: true, convExtra })
    expect(mockGatePiTools).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({ bypass: true }))
  })

  it('uses singular "server" and "tool" labels in spawn_complete message for single items', async () => {
    const handle = makeHandle('fs')
    const fakeTool = { name: 'mcp__fs__read', execute: vi.fn() }
    mockCreateMcpClient.mockResolvedValueOnce(handle)
    mockMcpServerToPiTools.mockReturnValueOnce([fakeTool])
    mockGatePiTools.mockReturnValueOnce([fakeTool])

    await setupMcp({ mcpServers: { fs: stdioConfig }, canUseTool: makeCanUseTool(), bypass: false, convExtra })
    const completeCall = mockSendChunk.mock.calls.find(
      (c: unknown[]) => (c[2] as { hookEvent?: string })?.hookEvent === 'spawn_complete',
    )
    expect(completeCall![1]).toMatch(/1\/1 server,/)
    expect(completeCall![1]).toMatch(/1 tool /)
  })

  it('uses plural "servers" and "tools" labels when multiple', async () => {
    const handle1 = makeHandle('fs')
    const handle2 = makeHandle('db')
    const tools1 = [{ name: 'mcp__fs__read', execute: vi.fn() }, { name: 'mcp__fs__write', execute: vi.fn() }]
    mockCreateMcpClient
      .mockResolvedValueOnce(handle1)
      .mockResolvedValueOnce(handle2)
    mockMcpServerToPiTools
      .mockReturnValueOnce(tools1)
      .mockReturnValueOnce([])
    mockGatePiTools.mockReturnValueOnce(tools1)

    await setupMcp({ mcpServers: { fs: stdioConfig, db: stdioConfig }, canUseTool: makeCanUseTool(), bypass: false, convExtra })
    const completeCall = mockSendChunk.mock.calls.find(
      (c: unknown[]) => (c[2] as { hookEvent?: string })?.hookEvent === 'spawn_complete',
    )
    expect(completeCall![1]).toMatch(/2\/2 servers,/)
    expect(completeCall![1]).toMatch(/2 tools /)
  })
})

describe('setupMcp — partial / full spawn failures', () => {
  beforeEach(() => {
    mockSendChunk.mockClear()
    mockCreateMcpClient.mockClear()
    mockMcpServerToPiTools.mockClear()
    mockGatePiTools.mockClear()
  })

  it('emits spawn_failed with McpConnectError message on connection failure', async () => {
    mockCreateMcpClient.mockRejectedValueOnce(new MockMcpConnectError('bad-server', new Error('ENOENT')))

    await setupMcp({ mcpServers: { 'bad-server': stdioConfig }, canUseTool: makeCanUseTool(), bypass: false, convExtra })

    const failCall = mockSendChunk.mock.calls.find(
      (c: unknown[]) => (c[2] as { hookEvent?: string })?.hookEvent === 'spawn_failed',
    )
    expect(failCall).toBeDefined()
    expect(failCall![1]).toContain("MCP server 'bad-server' failed to connect")
    // Stream is not aborted — spawn_complete still emitted
    const completeCall = mockSendChunk.mock.calls.find(
      (c: unknown[]) => (c[2] as { hookEvent?: string })?.hookEvent === 'spawn_complete',
    )
    expect(completeCall).toBeDefined()
  })

  it('emits spawn_failed with generic Error.message for non-McpConnectError', async () => {
    mockCreateMcpClient.mockRejectedValueOnce(new Error('unexpected crash'))

    await setupMcp({ mcpServers: { srv: stdioConfig }, canUseTool: makeCanUseTool(), bypass: false, convExtra })

    const failCall = mockSendChunk.mock.calls.find(
      (c: unknown[]) => (c[2] as { hookEvent?: string })?.hookEvent === 'spawn_failed',
    )
    expect(failCall![1]).toBe('unexpected crash')
  })

  it('emits spawn_failed with stringified reason for non-Error rejection', async () => {
    mockCreateMcpClient.mockRejectedValueOnce('just a string')

    await setupMcp({ mcpServers: { srv: stdioConfig }, canUseTool: makeCanUseTool(), bypass: false, convExtra })

    const failCall = mockSendChunk.mock.calls.find(
      (c: unknown[]) => (c[2] as { hookEvent?: string })?.hookEvent === 'spawn_failed',
    )
    expect(failCall![1]).toBe('just a string')
  })

  it('returns empty mcpHandles and still emits spawn_complete when all fail', async () => {
    mockCreateMcpClient.mockRejectedValueOnce(new Error('dead'))

    const result = await setupMcp({ mcpServers: { srv: stdioConfig }, canUseTool: makeCanUseTool(), bypass: false, convExtra })
    expect(result.mcpHandles).toEqual([])
    const completeCall = mockSendChunk.mock.calls.find(
      (c: unknown[]) => (c[2] as { hookEvent?: string })?.hookEvent === 'spawn_complete',
    )
    expect(completeCall![1]).toMatch(/0\/1 server/)
  })
})
