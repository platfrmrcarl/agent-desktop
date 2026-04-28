import { useEffect, useRef, useState } from 'react'
import { CheckIcon } from '../icons/CheckIcon'
import { ChevronDownIcon } from '../icons/ChevronDownIcon'
import { fuzzyHighlight, fuzzyMatch } from '../../utils/fuzzyMatch'
import { shortenModelName } from '../../../shared/constants'

export interface ModelPickerOption {
  value: string
  label: string
}

interface SearchableModelPickerProps {
  value: string
  options: ModelPickerOption[]
  onChange: (value: string) => void
  buttonLabel: string
  ariaLabel: string
  searchPlaceholder?: string
  emptyMessage?: string
  placement?: 'up' | 'down'
  extraOptions?: ModelPickerOption[]
  disabled?: boolean
  showChevron?: boolean
  className?: string
}

export function SearchableModelPicker({
  value,
  options,
  onChange,
  buttonLabel,
  ariaLabel,
  searchPlaceholder = 'Search models',
  emptyMessage = 'No models found',
  placement = 'down',
  extraOptions = [],
  disabled = false,
  showChevron = true,
  className,
}: SearchableModelPickerProps) {
  const allOptions = extraOptions.length > 0 ? [...options, ...extraOptions] : options
  const selected = allOptions.find((opt) => opt.value === value)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [open])

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('touchstart', handlePointerDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('touchstart', handlePointerDown)
    }
  }, [open])

  const filtered = !query.trim()
    ? allOptions.map((opt) => ({
        ...opt,
        match: { match: true, score: 0, indices: [] as number[] },
        labelMatch: { match: true, score: 0, indices: [] as number[] },
      }))
    : allOptions
        .map((opt) => {
          const match = fuzzyMatch(query, `${opt.label} ${opt.value}`)
          return {
            ...opt,
            match,
            labelMatch: fuzzyMatch(query, opt.label),
          }
        })
        .filter((opt) => opt.match.match)
        .sort((a, b) => b.match.score - a.match.score)

  const close = () => {
    setOpen(false)
    setQuery('')
  }

  return (
    <div ref={rootRef} className={`relative inline-flex flex-col items-end gap-1 ${className ?? ''}`}>
      <button
        type="button"
        onClick={() => {
          if (disabled) return
          setOpen((v) => !v)
        }}
        className="inline-flex items-center gap-0.5 hover:opacity-70 transition-opacity whitespace-nowrap mobile:py-1 mobile:px-1"
        style={{
          cursor: disabled ? 'default' : 'pointer',
          color: 'var(--color-text)',
        }}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={disabled}
      >
        <span>{selected?.label ?? shortenModelName(value) ?? value}</span>
        {!disabled && showChevron && <ChevronDownIcon className="opacity-60 mobile:hidden" />}
      </button>

      {open && !disabled && (
        <div
          className={`absolute ${placement === 'up' ? 'bottom-full mb-1' : 'top-full mt-1'} right-0 rounded shadow-lg text-xs min-w-[240px] max-w-[calc(100vw-2rem)] z-50`}
          style={{
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-text-muted)',
          }}
        >
          <div className="p-2 border-b border-[var(--color-text-muted)]/15">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              className="w-full px-2 py-1.5 rounded text-xs border outline-none"
              style={{
                backgroundColor: 'var(--color-bg)',
                color: 'var(--color-text)',
                borderColor: 'color-mix(in srgb, var(--color-text-muted) 25%, transparent)',
              }}
            />
          </div>
          <div
            className="max-h-72 overflow-y-auto py-1"
            role="listbox"
            aria-label={`${buttonLabel} options`}
          >
            {filtered.length === 0 ? (
              <div className="px-3 py-2" style={{ color: 'var(--color-text-muted)' }}>
                {emptyMessage}
              </div>
            ) : (
              filtered.map((opt) => {
                const isSelected = opt.value === value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => {
                      onChange(opt.value)
                      close()
                    }}
                    className="w-full text-left px-3 py-1.5 mobile:py-2.5 flex items-center justify-between gap-2 transition-colors"
                    style={{
                      color: isSelected ? 'var(--color-primary)' : 'var(--color-text)',
                      backgroundColor: isSelected ? 'var(--color-bg)' : 'transparent',
                    }}
                  >
                    <span className="min-w-0 truncate">
                      {query.trim() && opt.labelMatch.indices.length > 0
                        ? fuzzyHighlight(opt.label, opt.labelMatch.indices)
                        : opt.label}
                    </span>
                    {isSelected && <CheckIcon size={10} />}
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
