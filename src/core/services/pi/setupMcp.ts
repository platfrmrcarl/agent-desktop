// PI-SDK MCP setup: spawn, gate, and schedule teardown of MCP clients per-turn.
//
// Per-turn spawn/teardown is required because the PI SDK has no cross-turn session
// object that could hold persistent handles (unlike the Claude Agent SDK, which manages
// MCP connections internally). Callers must call teardown() in their own try/finally.

import { createMcpClient, McpConnectError, type McpClientHandle } from '../mcpClient'
import { mcpServerToPiTools } from '../mcpToPiTools'
import { gatePiTools } from '../piPermissionGate'
import { sendChunk } from '../streaming'
import type { CanUseToolFn } from '../canUseTool'
import type { McpTransportConfig } from '../streaming'
import type { ToolDefinition } from '@mariozechner/pi-coding-agent'

interface SetupMcpOptions {
  mcpServers: Record<string, McpTransportConfig>
  canUseTool: CanUseToolFn
  bypass: boolean
  convExtra: Record<string, string | number>
}

interface SetupMcpResult {
  mcpTools: ToolDefinition[]
  mcpHandles: McpClientHandle[]
}

export async function setupMcp(opts: SetupMcpOptions): Promise<SetupMcpResult> {
  const { mcpServers, canUseTool, bypass, convExtra } = opts
  const mcpEntries = Object.entries(mcpServers).filter(([name]) => !name.includes('__'))

  if (mcpEntries.length === 0) {
    return { mcpTools: [], mcpHandles: [] }
  }

  const mcpServerNames = mcpEntries.map(([name]) => name)
  sendChunk(
    'system_message',
    `Loading ${mcpServerNames.length} MCP server${mcpServerNames.length === 1 ? '' : 's'}: ${mcpServerNames.join(', ')}…`,
    { hookName: 'mcp', hookEvent: 'spawn_started', ...convExtra },
  )

  const spawnStart = Date.now()
  const spawnResults = await Promise.allSettled(
    mcpEntries.map(async ([name, config]) => ({ name, handle: await createMcpClient(name, config) })),
  )

  const rawMcpTools: ToolDefinition[] = []
  const mcpHandles: McpClientHandle[] = []
  let okCount = 0

  for (const r of spawnResults) {
    if (r.status === 'fulfilled') {
      mcpHandles.push(r.value.handle)
      rawMcpTools.push(...mcpServerToPiTools(r.value.handle))
      okCount++
    } else {
      const errMsg =
        r.reason instanceof McpConnectError
          ? r.reason.message
          : r.reason instanceof Error
            ? r.reason.message
            : String(r.reason)
      sendChunk('system_message', errMsg, {
        hookName: 'mcp',
        hookEvent: 'spawn_failed',
        ...convExtra,
      })
    }
  }

  const elapsedSec = ((Date.now() - spawnStart) / 1000).toFixed(1)
  sendChunk(
    'system_message',
    `MCP ready: ${okCount}/${mcpServerNames.length} server${mcpServerNames.length === 1 ? '' : 's'}, ${rawMcpTools.length} tool${rawMcpTools.length === 1 ? '' : 's'} (${elapsedSec}s)`,
    { hookName: 'mcp', hookEvent: 'spawn_complete', ...convExtra },
  )

  // Gate MCP tools — scheduler is a trusted internal customTool and must not go through canUseTool.
  const mcpTools = gatePiTools(rawMcpTools, { canUseTool, bypass })
  return { mcpTools, mcpHandles }
}
