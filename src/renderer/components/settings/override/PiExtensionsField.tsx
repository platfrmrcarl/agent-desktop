import type { PIExtensionInfo } from '../../../../shared/constants'
import { Checkbox } from '../../ui/Checkbox'
import { FieldCard, InheritedText } from './primitives'

export interface PiExtensionsFieldProps {
  piExtensions: PIExtensionInfo[]
  piExtDisabledDraft: string[]
  piExtDisabledInherited: string[]
  isPiExtOverridden: boolean
  inheritedSource: string
  onTogglePiExtOverride: () => void
  onTogglePiExtension: (path: string) => void
}

export function PiExtensionsField({
  piExtensions,
  piExtDisabledDraft,
  piExtDisabledInherited,
  isPiExtOverridden,
  inheritedSource,
  onTogglePiExtOverride,
  onTogglePiExtension,
}: PiExtensionsFieldProps) {
  if (isPiExtOverridden) {
    return (
      <FieldCard label="PI Extensions" active onToggle={onTogglePiExtOverride} wide>
        <div
          className="flex flex-col gap-0.5 rounded px-1 py-1 max-h-[120px] overflow-y-auto"
          style={{ backgroundColor: 'var(--color-surface)' }}
          role="group"
          aria-label="PI extension toggles"
        >
          {piExtensions.map((ext) => {
            const extActive = !piExtDisabledDraft.includes(ext.path)
            return (
              <button
                key={ext.path}
                onClick={() => onTogglePiExtension(ext.path)}
                className="flex items-center gap-2 py-0.5 text-xs text-left hover:opacity-80"
                style={{ color: 'var(--color-text)' }}
                role="checkbox"
                aria-checked={extActive}
              >
                <Checkbox checked={extActive} />
                <span style={{ opacity: extActive ? 1 : 0.5 }}>{ext.name}</span>
              </button>
            )
          })}
        </div>
      </FieldCard>
    )
  }

  return (
    <FieldCard label="PI Extensions" active={false} onToggle={onTogglePiExtOverride}>
      <InheritedText
        value={piExtDisabledInherited.length > 0
          ? `${piExtensions.length - piExtDisabledInherited.length}/${piExtensions.length} enabled`
          : `All ${piExtensions.length} enabled`}
        source={inheritedSource}
      />
    </FieldCard>
  )
}
