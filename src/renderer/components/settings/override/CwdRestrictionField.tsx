import { FieldCard, InheritedText } from './primitives'

export interface CwdRestrictionFieldProps {
  draftValue: string | undefined
  inheritedValue: string
  inheritedSource: string
  onToggle: () => void
  onChange: (value: string) => void
}

export function CwdRestrictionField({
  draftValue,
  inheritedValue,
  inheritedSource,
  onToggle,
  onChange,
}: CwdRestrictionFieldProps) {
  if (draftValue !== undefined) {
    const isEnabled = draftValue === 'true'
    return (
      <FieldCard label="CWD Restriction" active onToggle={onToggle} wide>
        <button
          onClick={() => onChange(isEnabled ? 'false' : 'true')}
          className="flex items-center gap-2 px-2 py-1 rounded text-xs"
          style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }}
          role="switch"
          aria-checked={isEnabled}
        >
          <span
            className="relative w-8 h-4 rounded-full transition-colors flex-shrink-0"
            style={{
              backgroundColor: isEnabled ? 'var(--color-primary)' : 'var(--color-text-muted)',
              opacity: isEnabled ? 1 : 0.4,
            }}
          >
            <span
              className="absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform"
              style={{ left: isEnabled ? '1rem' : '0.125rem' }}
            />
          </span>
          <span style={{ opacity: 0.8 }}>
            {isEnabled ? 'Enabled' : 'Disabled'}
          </span>
        </button>
      </FieldCard>
    )
  }

  const effectiveValue = (inheritedValue ?? 'true') === 'true' ? 'Enabled' : 'Disabled'
  return (
    <FieldCard label="CWD Restriction" active={false} onToggle={onToggle}>
      <InheritedText value={effectiveValue} source={inheritedSource} />
    </FieldCard>
  )
}
