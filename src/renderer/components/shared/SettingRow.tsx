import { tint } from '../../utils/colorMix'

interface SettingRowProps {
  label: string
  description: string
  children: React.ReactNode
}

/**
 * Standard row layout used across Settings pages: label + description on
 * the left, an arbitrary control (`children`) on the right, separated by
 * a thin bottom border. Replaces the pattern that was duplicated 17×
 * in AISettings.tsx and 6× in GeneralSettings.tsx.
 */
export function SettingRow({ label, description, children }: SettingRowProps) {
  return (
    <div
      className="flex items-center justify-between py-3 border-b"
      style={{ borderColor: tint('--color-text-muted', 10) }}
    >
      <div className="flex flex-col gap-0.5 pr-4">
        <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
          {label}
        </span>
        <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          {description}
        </span>
      </div>
      {children}
    </div>
  )
}
