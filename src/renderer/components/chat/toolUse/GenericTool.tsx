import { ToolUseShell } from './ToolUseShell'
import type { StreamPart } from '../../../../shared/types'

type ToolPart = Extract<StreamPart, { type: 'tool' }>

interface GenericToolProps {
  tool: ToolPart
}

/** Fallback renderer for tools not matched by a specialized component (Task, WebFetch, etc.) */
export function GenericTool({ tool }: GenericToolProps) {
  return <ToolUseShell tool={tool} />
}
