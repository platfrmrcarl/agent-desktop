import { EditTools } from './toolUse/EditTools'
import { ReadTools } from './toolUse/ReadTools'
import { ShellTool } from './toolUse/ShellTool'
import { McpTool } from './toolUse/McpTool'
import { GenericTool } from './toolUse/GenericTool'
import type { StreamPart } from '../../../shared/types'

type ToolPart = Extract<StreamPart, { type: 'tool' }>

interface ToolUseBlockProps {
  tool: ToolPart
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'edit'])
const READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LSP', 'read'])

/** Dispatcher: routes a tool to its specialized renderer based on tool.name. */
export function ToolUseBlock({ tool }: ToolUseBlockProps) {
  if (EDIT_TOOLS.has(tool.name)) return <EditTools tool={tool} />
  if (READ_TOOLS.has(tool.name)) return <ReadTools tool={tool} />
  if (tool.name === 'Bash') return <ShellTool tool={tool} />
  if (tool.name.startsWith('mcp__')) return <McpTool tool={tool} />
  return <GenericTool tool={tool} />
}
