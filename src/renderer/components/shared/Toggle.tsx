interface ToggleProps {
  enabled: boolean
  onToggle: () => void
  /** Used both as the visible-meaning indicator for screen readers and (with prefix) as the aria-label fallback. */
  label: string
  /** Override the aria-label exactly (defaults to `label`). */
  ariaLabel?: string
}

/**
 * Pill-style on/off toggle button. Shared across Settings pages
 * (Discord, WebServer, General). 44×24px hit area; primary color when
 * enabled, muted when disabled.
 */
export function Toggle({ enabled, onToggle, label, ariaLabel }: ToggleProps) {
  return (
    <button
      onClick={onToggle}
      className="relative w-11 h-6 rounded-full flex-shrink-0 overflow-hidden transition-colors"
      style={{
        backgroundColor: enabled ? 'var(--color-primary)' : 'var(--color-text-muted)',
        opacity: enabled ? 1 : 0.3,
      }}
      role="switch"
      aria-checked={enabled}
      aria-label={ariaLabel ?? label}
    >
      <span
        className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform"
        style={{ transform: enabled ? 'translateX(20px)' : 'translateX(0)' }}
      />
    </button>
  )
}
