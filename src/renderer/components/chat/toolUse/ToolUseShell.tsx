import { useState } from 'react'
import { CodeBlock } from '../CodeBlock'
import type { StreamPart } from '../../../../shared/types'

type ToolPart = Extract<StreamPart, { type: 'tool' }>

export interface ToolUseShellProps {
  tool: ToolPart
  /** Short contextual label shown next to the tool name (e.g. path, description) */
  context?: string | null
  /** Extra toggle buttons injected between Output and the right edge (e.g. Diff button) */
  extraButtons?: React.ReactNode
  /** Extra collapsible sections rendered below the standard Input/Output panels */
  extraBody?: React.ReactNode
}

export function ToolUseShell({ tool, context, extraButtons, extraBody }: ToolUseShellProps) {
  const isRunning = tool.status === 'running'
  const hasInput = tool.input != null && Object.keys(tool.input).length > 0
  const hasOutput = !isRunning && !!tool.output

  const [showInput, setShowInput] = useState(false)
  const [showOutput, setShowOutput] = useState(false)

  const containerStyle: React.CSSProperties = {
    borderLeft: '3px solid var(--color-tool)',
    backgroundColor: 'color-mix(in srgb, var(--color-tool) 8%, transparent)',
    ...(isRunning ? { animation: 'tool-pulse 1.5s ease-in-out infinite' } : {}),
  }

  const header = (
    <div className="flex items-center gap-2 min-w-0">
      <span style={{ color: 'var(--color-tool)' }} className="font-semibold shrink-0">
        {isRunning ? '⚙️' : '✅'} {tool.name}
      </span>
      {context && (
        <span
          className="truncate min-w-0"
          style={{ color: 'var(--color-text-muted)' }}
          title={context}
        >
          · {context}
        </span>
      )}
      {isRunning && (
        <span
          className="inline-block w-3 h-3 rounded-full border-2 border-t-transparent animate-spin shrink-0"
          style={{ borderColor: 'var(--color-tool)', borderTopColor: 'transparent' }}
        />
      )}
      <div className="flex gap-1 ml-auto shrink-0">
        {extraButtons}
        {hasInput && (
          <button
            onClick={() => setShowInput((s) => !s)}
            className="rounded transition-opacity hover:opacity-80 px-1.5 py-0.5 text-[0.625rem] mobile:px-3 mobile:py-2 mobile:text-xs"
            style={{ color: 'var(--color-tool)' }}
            aria-expanded={showInput}
            aria-label="Toggle tool input"
          >
            {showInput ? '▼' : '▶'} Input
          </button>
        )}
        {hasOutput && (
          <button
            onClick={() => setShowOutput((s) => !s)}
            className="rounded transition-opacity hover:opacity-80 px-1.5 py-0.5 text-[0.625rem] mobile:px-3 mobile:py-2 mobile:text-xs"
            style={{ color: 'var(--color-tool)' }}
            aria-expanded={showOutput}
            aria-label="Toggle tool output"
          >
            {showOutput ? '▼' : '▶'} Output
          </button>
        )}
      </div>
    </div>
  )

  // Compact view: no input, no output
  if (!hasInput && !hasOutput) {
    return (
      <div className="my-2 rounded-md px-3 py-2 text-xs font-mono" style={containerStyle}>
        {header}
        {tool.summary && !context && (
          <div
            className="mt-1 text-xs truncate"
            style={{ color: 'var(--color-text-muted)' }}
            title={tool.summary}
          >
            {tool.summary}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="my-2 rounded-md text-xs font-mono overflow-hidden" style={containerStyle}>
      <div className="px-3 py-2">
        {header}
        {tool.summary && !showOutput && !context && (
          <div
            className="mt-1 text-xs truncate"
            style={{ color: 'var(--color-text-muted)' }}
            title={tool.summary}
          >
            {tool.summary}
          </div>
        )}
      </div>

      {showInput && hasInput && (
        <div className="px-3 pb-2">
          <CodeBlock language="json" defaultCollapsed={false}>
            {JSON.stringify(tool.input, null, 2)}
          </CodeBlock>
        </div>
      )}

      {showOutput && hasOutput && (
        <div className="px-3 pb-2">
          <CodeBlock language="text" defaultCollapsed={false}>
            {tool.output!}
          </CodeBlock>
        </div>
      )}

      {extraBody}
    </div>
  )
}
