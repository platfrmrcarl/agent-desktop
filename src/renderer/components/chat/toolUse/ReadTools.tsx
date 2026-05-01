import { ToolUseShell } from './ToolUseShell'
import { getFilePath, truncatePath } from './toolInputUtils'
import type { StreamPart } from '../../../../shared/types'

type ToolPart = Extract<StreamPart, { type: 'tool' }>

interface ReadToolsProps {
  tool: ToolPart
}

/** Renders Read / Glob / Grep / LSP tool calls */
export function ReadTools({ tool }: ReadToolsProps) {
  const filePath = tool.input ? getFilePath(tool.input) : null
  const context = filePath ? truncatePath(filePath) : null

  return <ToolUseShell tool={tool} context={context} />
}
