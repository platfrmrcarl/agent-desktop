import { useState } from 'react'
import { useSettingsStore } from '../../../stores/settingsStore'
import { DiffView } from '../DiffView'
import { ToolUseShell } from './ToolUseShell'
import { getFilePath, getEditDiffStrings, truncatePath } from './toolInputUtils'
import type { StreamPart } from '../../../../shared/types'

type ToolPart = Extract<StreamPart, { type: 'tool' }>

interface EditToolsProps {
  tool: ToolPart
}

/** Renders Edit / Write / MultiEdit / NotebookEdit tool calls with an optional diff view */
export function EditTools({ tool }: EditToolsProps) {
  const diffExpandedByDefault = useSettingsStore(
    (s) => (s.settings.diffExpandedByDefault ?? 'false') === 'true',
  )

  const diffStrings = tool.input ? getEditDiffStrings(tool.input) : null
  const hasDiff = diffStrings !== null
  const [showDiff, setShowDiff] = useState(hasDiff && diffExpandedByDefault)

  const filePath = tool.input ? getFilePath(tool.input) : null
  const context = filePath ? truncatePath(filePath) : null

  const diffButton = hasDiff ? (
    <button
      onClick={() => setShowDiff((s) => !s)}
      className="rounded transition-opacity hover:opacity-80 px-1.5 py-0.5 text-[0.625rem] mobile:px-3 mobile:py-2 mobile:text-xs"
      style={{ color: 'var(--color-tool)' }}
      aria-expanded={showDiff}
      aria-label="Toggle diff view"
    >
      {showDiff ? '▼' : '▶'} Diff
    </button>
  ) : null

  const diffBody = showDiff && diffStrings ? (
    <div className="px-3 pb-2">
      <DiffView oldStr={diffStrings.oldStr} newStr={diffStrings.newStr} />
    </div>
  ) : null

  return (
    <ToolUseShell
      tool={tool}
      context={context}
      extraButtons={diffButton}
      extraBody={diffBody}
    />
  )
}
