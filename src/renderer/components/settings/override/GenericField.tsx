import { useState } from 'react'
import type { SettingDef } from '../../../../shared/constants'
import { SystemPromptEditorModal } from '../SystemPromptEditorModal'
import { FieldCard, InheritedText, INPUT_STYLE } from './primitives'

export interface GenericFieldProps {
  def: SettingDef
  draftValue: string | undefined
  inherited: string
  source: string
  customModels?: string[]
  shortenModelName?: (m: string) => string
  onToggle: () => void
  onChange: (value: string) => void
}

export function GenericField({
  def,
  draftValue,
  inherited,
  source,
  customModels = [],
  shortenModelName,
  onToggle,
  onChange,
}: GenericFieldProps) {
  const [showEditor, setShowEditor] = useState(false)
  const active = draftValue !== undefined
  const isTextarea = def.type === 'textarea'

  const expandButton = active && isTextarea ? (
    <button
      onClick={() => setShowEditor(true)}
      className="text-[0.5625rem] hover:opacity-80"
      style={{ color: 'var(--color-text-muted)' }}
    >
      Expand ↗
    </button>
  ) : undefined

  return (
    <FieldCard
      label={def.label}
      active={active}
      onToggle={onToggle}
      wide={isTextarea}
      extra={expandButton}
    >
      {active ? (
        isTextarea ? (
          <>
            <textarea
              value={draftValue || ''}
              onChange={(e) => onChange(e.target.value)}
              rows={3}
              placeholder={`Enter ${def.label.toLowerCase()}...`}
              className="w-full px-2 py-1 rounded text-xs border outline-none resize-y"
              style={INPUT_STYLE}
            />
            {showEditor && (
              <SystemPromptEditorModal
                value={draftValue || ''}
                onChange={(v) => onChange(v)}
                onClose={() => setShowEditor(false)}
              />
            )}
          </>
        ) : def.type === 'select' ? (
          <select
            value={draftValue || ''}
            onChange={(e) => onChange(e.target.value)}
            className="w-full px-2 py-1 rounded text-xs border outline-none"
            style={INPUT_STYLE}
          >
            {def.options!.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
            {def.key === 'ai_model' && customModels.map((m) => (
              <option key={m} value={m}>{shortenModelName ? shortenModelName(m) : m}</option>
            ))}
          </select>
        ) : (
          <input
            type="number"
            min={def.min}
            max={def.max}
            step={def.step}
            value={draftValue || ''}
            onChange={(e) => onChange(e.target.value)}
            className="w-full px-2 py-1 rounded text-xs border outline-none"
            style={INPUT_STYLE}
          />
        )
      ) : (
        <InheritedText value={inherited} source={source} />
      )}
    </FieldCard>
  )
}
