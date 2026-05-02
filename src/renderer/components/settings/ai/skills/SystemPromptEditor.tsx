import { useState } from 'react'
import { SystemPromptEditorModal } from '../../SystemPromptEditorModal'
import { tint } from '../../../../utils/colorMix'

export interface SystemPromptEditorProps {
  value: string
  onChange: (value: string) => void
}

export function SystemPromptEditor({ value, onChange }: SystemPromptEditorProps) {
  const [showModal, setShowModal] = useState(false)

  return (
    <div className="flex flex-col gap-2 py-3">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
            Default System Prompt
          </span>
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            Global system prompt. Per-conversation prompts override this.
          </span>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="px-2.5 py-1 rounded text-xs font-medium transition-colors hover:opacity-80 mobile:px-4 mobile:py-3 mobile:text-sm"
          style={{
            backgroundColor: 'var(--color-bg)',
            color: 'var(--color-text-muted)',
            border: '1px solid color-mix(in srgb, var(--color-text-muted) 20%, transparent)',
          }}
          aria-label="Expand system prompt editor"
        >
          Expand ↗
        </button>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        placeholder="Enter a default system prompt..."
        className="w-full px-3 py-2 rounded text-sm border outline-none resize-y mobile:text-base"
        style={{
          backgroundColor: 'var(--color-bg)',
          color: 'var(--color-text)',
          borderColor: tint('--color-text-muted', 20),
        }}
        aria-label="Default system prompt"
      />
      {showModal && (
        <SystemPromptEditorModal
          value={value}
          onChange={onChange}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  )
}
