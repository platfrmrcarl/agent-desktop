// PI-SDK custom tools assembly: scheduler tool (trusted, not gated) + MCP tools (gated).
//
// Scheduler tool is NOT gated via canUseTool (it is a trusted internal tool).
// MCP tools ARE gated (except when bypass=true).

import { setupMcp } from './setupMcp'
import type { CanUseToolFn } from '../canUseTool'
import type { McpClientHandle } from '../mcpClient'
import type { ToolDefinition } from '@mariozechner/pi-coding-agent'

interface BuildCustomToolsOptions {
  createSchedulerTool: () => ToolDefinition
  schedulerBridge: {
    getMcpConfig(convKey: number): unknown
    getSocketPath(): string | null
    getAuthToken(): string | null
  } | null
  convKey: number
  isUnattended: boolean
  mcpServers: Record<string, import('../streaming').McpTransportConfig>
  canUseTool: CanUseToolFn
  bypass: boolean
  convExtra: Record<string, string | number>
}

interface BuildCustomToolsResult {
  customTools: ToolDefinition[]
  mcpHandles: McpClientHandle[]
}

export async function buildCustomTools(opts: BuildCustomToolsOptions): Promise<BuildCustomToolsResult> {
  const { createSchedulerTool, schedulerBridge, convKey, isUnattended, mcpServers, canUseTool, bypass, convExtra } = opts

  const customTools: ToolDefinition[] = []
  const schedulerConfig = schedulerBridge?.getMcpConfig(convKey) ?? null
  if (schedulerConfig && !isUnattended && schedulerBridge?.getSocketPath() && schedulerBridge.getAuthToken()) {
    customTools.push(createSchedulerTool())
  }

  const { mcpTools, mcpHandles } = await setupMcp({ mcpServers, canUseTool, bypass, convExtra })
  customTools.push(...mcpTools)

  return { customTools, mcpHandles }
}
