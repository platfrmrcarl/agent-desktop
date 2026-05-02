import { ToolUseShell } from './ToolUseShell'
import type { StreamPart } from '../../../../shared/types'

type ToolPart = Extract<StreamPart, { type: 'tool' }>

interface McpToolProps {
  tool: ToolPart
}

/** Renders MCP tool calls (tool names matching mcp__<server>__<tool> pattern) */
export function McpTool({ tool }: McpToolProps) {
  return <ToolUseShell tool={tool} />
}
