import { ToolUseShell } from './ToolUseShell'
import type { StreamPart } from '../../../../shared/types'

type ToolPart = Extract<StreamPart, { type: 'tool' }>

interface ShellToolProps {
  tool: ToolPart
}

/** Renders Bash tool calls, showing the description as context */
export function ShellTool({ tool }: ShellToolProps) {
  const context = (tool.input?.description as string) || null

  return <ToolUseShell tool={tool} context={context} />
}
