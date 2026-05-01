import type { ReactNode } from 'react'

// ─── Shared display primitives ───────────────────────────────

function ToggleButton({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick() }}
      className={`text-[0.5625rem] px-1.5 py-0.5 rounded flex-shrink-0 transition-opacity
        ${active ? 'bg-primary text-contrast' : 'bg-base text-muted opacity-30 group-hover:opacity-80 focus:opacity-80'}`}
    >
      {active ? 'Override' : 'Inherited'}
    </button>
  )
}

export function FieldCard({ label, active, onToggle, wide, extra, children }: {
  label: string
  active: boolean
  onToggle: () => void
  wide?: boolean
  extra?: ReactNode
  children: ReactNode
}) {
  return (
    <div
      className={`group flex flex-col gap-1 rounded-md px-3 py-2 transition-opacity
        ${wide ? 'col-span-3' : ''}
        ${!active ? 'cursor-pointer hover:opacity-80' : ''}`}
      style={{ backgroundColor: 'var(--color-bg)' }}
      onClick={!active ? onToggle : undefined}
    >
      <div className="flex items-center justify-between gap-1">
        <span
          className="text-[0.6875rem] font-medium truncate"
          style={{ color: active ? 'var(--color-text)' : 'var(--color-text-muted)' }}
        >
          {label}
        </span>
        <div className="flex items-center gap-1 flex-shrink-0">
          {extra}
          {active && <ToggleButton active onClick={onToggle} />}
        </div>
      </div>
      {children}
    </div>
  )
}

export function InheritedText({ value, source }: { value: string; source: string }) {
  return (
    <span className="text-[0.6875rem] truncate block" style={{ color: 'var(--color-text-muted)' }}>
      {value || '(default)'}
      <span className="opacity-40 ml-1">from {source}</span>
    </span>
  )
}

export function SectionHeader({ label }: { label: string }) {
  return (
    <span
      className="text-[0.625rem] font-semibold uppercase tracking-widest"
      style={{ color: 'var(--color-text-muted)', opacity: 0.5 }}
    >
      {label}
    </span>
  )
}

export const INPUT_STYLE = {
  backgroundColor: 'var(--color-surface)',
  color: 'var(--color-text)',
  borderColor: 'var(--color-primary)',
} as const
