import { tint } from '../../../../utils/colorMix'

export interface ToggleRowProps {
  label: string
  description: string
  checked: boolean
  disabled?: boolean
  ariaLabel: string
  onChange: () => void
}

export function ToggleRow({ label, description, checked, disabled = false, ariaLabel, onChange }: ToggleRowProps) {
  const dimmed = disabled ? 0.5 : 1
  const active = checked && !disabled

  return (
    <div
      className="flex items-center justify-between py-3 border-b"
      style={{ borderColor: tint('--color-text-muted', 10) }}
    >
      <div className="flex flex-col gap-0.5 pr-4">
        <span className="text-sm font-medium" style={{ color: 'var(--color-text)', opacity: dimmed }}>
          {label}
        </span>
        <span className="text-xs" style={{ color: 'var(--color-text-muted)', opacity: dimmed }}>
          {description}
        </span>
      </div>
      <button
        onClick={onChange}
        disabled={disabled}
        className="relative w-10 h-5 rounded-full transition-colors"
        style={{
          backgroundColor: active ? 'var(--color-primary)' : 'var(--color-text-muted)',
          opacity: disabled ? 0.3 : (checked ? 1 : 0.4),
        }}
        role="switch"
        aria-checked={active}
        aria-label={ariaLabel}
      >
        <span
          className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform"
          style={{ left: active ? '1.25rem' : '0.125rem' }}
        />
      </button>
    </div>
  )
}
